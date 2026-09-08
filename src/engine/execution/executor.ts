import { EXECUTION_INTENT_FORMAT } from "./intent.ts";
import { statIfExists } from "../../shared/fs_presence.ts";
import { withRecoveryStorage } from "./storage_lifetime.ts";
import { executionRecoveryCommand } from "../../shared/execution_recovery.ts";
import {
  emitCompletionEvent,
  emitCompletionProgress,
  executionEvent,
} from "../completion/events.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Environment scheduling owns no queue order, evidence verdict, or authority. */
import type { EnvironmentDeclaration } from "../../shared/config_schema.ts";
import { applicabilitySubject } from "../completion/evidence.ts";
import {
  type CompletionAttempt,
  type CompletionRecovery,
  environmentAvailability,
} from "../completion/environment.ts";
import {
  type AttemptIdentity,
  AttemptIdentitySchema,
  type Executor,
  ExecutorSchema,
} from "../completion/identity.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
  EnvironmentExecutor,
  EnvironmentPlan,
  EnvironmentReturn,
} from "../completion/protocol.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";
import {
  withCompletionCheckout,
  withCompletionPublication,
} from "../operation_lock.ts";
import { validationPurpose } from "../completion/protocol.ts";
import { restoreValidationBinding } from "./validation_binding.ts";
import { saveEnvironmentArtifact } from "./artifacts.ts";
import {
  type ExecutionIntent,
  ExecutionIntentSchema,
  loadExecutionIntent,
} from "./intent.ts";
import {
  planEnvironment,
  type RecordedEnvironment,
  replaceEnvironment,
  requireEnvironment,
  unavailable,
  verifyClaimCapacity,
} from "./registry.ts";
import {
  declarationIdentity,
  releasedSubject,
  releaseMatchesSnapshot,
} from "./subjects.ts";
import {
  type EnvironmentPhase,
  errorReason,
  type ExecutionLifetime,
  type ExecutionWorkspace,
  recoveryFor,
  type WorkspaceSnapshot,
} from "./types.ts";

export interface EnvironmentExecutorOptions {
  readonly root: string;
  readonly environmentId: string;
  readonly declaration: EnvironmentDeclaration | null;
  readonly workspace: ExecutionWorkspace;
  readonly lifetime: ExecutionLifetime;
  /** 3A reserves repository sequence numbers. The environment never allocates order. */
  readonly reserveAttempt: (
    plan: EnvironmentPlan,
    executor: Executor,
  ) => Promise<AttemptIdentity>;
  /** The evaluator classifies its return; a resolved callback alone is not success. */
  readonly validationOutcome: (
    value: unknown,
  ) => "passed" | "failed" | "cancelled";
  /** Preserve an existing release only after the frozen return contract and quiescence pass. */
  readonly preserveReleaseOnReturn?: boolean;
  readonly leaseMs: number;
  readonly signal?: AbortSignal;
  readonly clock?: Clock;
  readonly entropy?: SecureEntropy;
  readonly scheduler?: Scheduler;
  /** Deterministic interruption seam after a phase is durable, before its effect. */
  readonly afterReturn?: () => Promise<void>;
  readonly afterPhase?: (
    phase: EnvironmentPhase,
    execution: ClaimedExecution,
  ) => Promise<void>;
}

/** Report the recorded project's return route rather than rereading current config. */
function cleanupCommands(intent: ExecutionIntent): string[] {
  const declaration = intent.recipe.declaration;
  if (declaration === null) return [];
  const commands = declaration.kind === "borrowed"
    ? declaration.restore
    : declaration.reusable
    ? declaration.reset
    : declaration.dispose;
  return commands === undefined
    ? []
    : typeof commands === "string"
    ? [commands]
    : commands;
}

class ExecutorImplementation implements EnvironmentExecutor {
  readonly clock: Clock;
  readonly entropy: SecureEntropy;
  readonly scheduler: Scheduler;
  constructor(readonly options: EnvironmentExecutorOptions) {
    if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs <= 0) {
      throw new TypeError(
        "An environment claim needs a finite positive lease.",
      );
    }
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.entropy = options.entropy ?? SYSTEM_SECURE_ENTROPY;
    this.scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  }

  async observe(
    environmentId: string,
  ): ReturnType<EnvironmentExecutor["observe"]> {
    return await readCompletionRecord(this.options.root, {
      kind: "environment",
      id: environmentId,
    });
  }

  plan(
    ...args: Parameters<EnvironmentExecutor["plan"]>
  ): ReturnType<EnvironmentExecutor["plan"]> {
    return planEnvironment(
      this.options.environmentId,
      this.options.declaration,
      ...args,
    );
  }

  async claim(
    plan: EnvironmentPlan,
    executor: Executor,
  ): Promise<ClaimedExecution | CompletionBlocker> {
    const { root, workspace, lifetime } = this.options;
    ExecutorSchema.parse(executor);
    if (
      plan.environment_id !== this.options.environmentId ||
      plan.candidate_id !== plan.validation.candidate_id ||
      plan.validation.blockers.length !== 0
    ) {
      return unavailable(
        "Execution plan has another environment, candidate, or unresolved validation blockers; replan before claiming.",
      );
    }
    try {
      const observed = await requireEnvironment(root, plan.environment_id);
      const environment = observed.record.data;
      const selected = planEnvironment(
        this.options.environmentId,
        this.options.declaration,
        {
          trunk: "",
          observed_at: this.clock.wallNow(),
          records: [{
            selector: observed.record,
            reading: { kind: "recorded", ...observed },
          }],
        },
        plan.validation,
      );
      if ("kind" in selected) return selected;
      if (
        selected.action !== plan.action ||
        selected.expected_stamp !== plan.expected_stamp ||
        JSON.stringify(selected.declaration) !==
          JSON.stringify(plan.declaration)
      ) {
        return unavailable(
          "The execution plan does not match current eligibility; observe and replan.",
        );
      }
      if (
        environment.declaration !== await declarationIdentity(plan.declaration)
      ) {
        return unavailable(
          "The execution declaration differs from the enrolled contract.",
        );
      }
      const use = await lifetime.inspect(environment.path);
      if (!use.quiescent) {
        return unavailable(
          `Environment has conflicting or uncertain use: ${use.reason}`,
        );
      }
      return await withCompletionCheckout(
        await statIfExists(environment.path) === undefined
          ? root
          : environment.path,
        async (signal) => {
          const sourceRetirementRelease = plan.action === "source-tip" &&
            environment.release.kind === "released" &&
            environment.release.retirement;
          // A cleanup release binds file hashes. Source-only validation must
          // retain that exact subject without copying restoration payloads.
          const source = await workspace.inspect(
            environment,
            plan.declaration,
            sourceRetirementRelease ? "release" : undefined,
            signal,
          );
          if (
            !await releaseMatchesSnapshot(environment, source)
          ) {
            return unavailable(
              "Source, index, resources, or ignored state changed after release; return control to its source owner for a new release.",
            );
          }
          const identity = AttemptIdentitySchema.parse(
            await this.options.reserveAttempt(plan, executor),
          );
          if (
            identity.candidate_id !== plan.candidate_id ||
            JSON.stringify(identity.executor) !== JSON.stringify(executor)
          ) {
            return unavailable(
              "The reserved attempt names another candidate or executor.",
            );
          }
          const now = this.clock.wallNow();
          const claim = {
            token: this.entropy.uuid(),
            executor,
            acquired_at: now,
            expires_at: now + this.options.leaseMs,
          };
          const subjects = [
            ...new Set(
              await Promise.all(
                plan.validation.producers.flatMap((producer) =>
                  producer.evidence_subjects.map(applicabilitySubject)
                ),
              ),
            ),
          ];
          const attempt: CompletionAttempt = {
            identity,
            environment_id: plan.environment_id,
            subjects,
            purpose: validationPurpose(plan.validation.demand),
            mode: plan.validation.demand.mode,
            state: {
              kind: plan.validation.demand.kind === "compose"
                ? "composing"
                : "claimed",
              claim,
            },
          };
          const intent = ExecutionIntentSchema.parse({
            format: EXECUTION_INTENT_FORMAT,
            environment_id: plan.environment_id,
            environment,
            candidate_id: plan.candidate_id,
            candidate: plan.validation.candidate,
            context: plan.validation.demand.context,
            recipe: { action: plan.action, declaration: plan.declaration },
            attempt,
            source,
          });
          const intentArtifact = await saveEnvironmentArtifact(
            root,
            {
              attempt_id: identity.id,
              candidate_id: plan.candidate_id,
              context: intent.context,
            },
            "intent",
            intent,
            async () => {
              signal.throwIfAborted();
              const current = await requireEnvironment(
                root,
                plan.environment_id,
              );
              if (current.stamp !== observed.stamp) {
                throw new Error(
                  "Environment ownership changed during capture; preserve its checkout and retry from the current record.",
                );
              }
            },
          );
          await workspace.verify(environment, source, signal);
          return await withCompletionPublication(root, async () => {
            const current = await requireEnvironment(root, plan.environment_id);
            if (
              current.stamp !== plan.expected_stamp ||
              environmentAvailability(current.record.data, this.clock.wallNow())
                  .kind !== "available"
            ) {
              return unavailable(
                "The environment changed before claim; observe and replan.",
              );
            }
            await verifyClaimCapacity(
              root,
              environment,
              plan.declaration?.capacity ?? 1,
            );
            const claimed = await replaceEnvironment(root, current, {
              ...environment,
              state: {
                kind: "executing",
                attempt_id: identity.id,
                candidate_id: plan.candidate_id,
                release_id: environment.release.kind === "released"
                  ? environment.release.id
                  : "",
                claim,
                capture: intentArtifact,
                phase: "install",
              },
            }, this.clock);
            const written = await writeCompletionRecord(
              root,
              {
                version: ON_DISK_FORMATS.completionRecord.version,
                kind: "attempt",
                id: identity.id,
                revision: 1,
                data: attempt,
              },
              null,
              undefined,
              this.clock,
            );
            if (written.kind !== "written") {
              const recovery = recoveryFor(
                "install",
                `Attempt publication failed (${written.kind}). Recover this environment before another claim.`,
                environment.path,
                cleanupCommands(intent),
              );
              await replaceEnvironment(root, claimed, {
                ...claimed.record.data,
                state: { kind: "recovery", attempt_id: identity.id, recovery },
              }, this.clock);
              return {
                kind: "recovery-incomplete",
                record_id: plan.environment_id,
                recovery,
              };
            }
            return {
              fence: { attempt_id: identity.id, token: claim.token },
              attempt,
              environment_id: plan.environment_id,
              environment: claimed.record.data,
              candidate_id: plan.candidate_id,
              candidate: plan.validation.candidate,
              signal: this.options.signal ?? new AbortController().signal,
            };
          });
        },
        this.options.signal,
      );
    } catch (error) {
      return unavailable(errorReason(error));
    }
  }

  async current(
    execution: ClaimedExecution,
    allowExpired = false,
  ): Promise<RecordedEnvironment> {
    const current = await requireEnvironment(
      this.options.root,
      execution.environment_id,
    );
    const state = current.record.data.state;
    if (
      state.kind !== "executing" ||
      state.attempt_id !== execution.fence.attempt_id ||
      state.candidate_id !== execution.candidate_id ||
      state.claim.token !== execution.fence.token ||
      current.record.data.path !== execution.environment.path ||
      current.record.data.declaration !== execution.environment.declaration ||
      JSON.stringify(current.record.data.ownership) !==
        JSON.stringify(execution.environment.ownership) ||
      JSON.stringify(current.record.data.release) !==
        JSON.stringify(execution.environment.release) ||
      (!allowExpired && state.claim.expires_at <= this.clock.wallNow())
    ) {
      throw new Error(
        "Environment claim was lost or expired. Do not publish or change this checkout; observe its recovery record.",
      );
    }
    return current;
  }

  async phase(
    execution: ClaimedExecution,
    phase: EnvironmentPhase,
    allowExpired = false,
  ): Promise<void> {
    const current = await this.current(execution, allowExpired);
    if (current.record.data.state.kind !== "executing") {
      throw new Error("Execution phase is unavailable.");
    }
    await replaceEnvironment(this.options.root, current, {
      ...current.record.data,
      state: { ...current.record.data.state, phase },
    }, this.clock);
    emitCompletionProgress({
      phase: "environment",
      state: phase,
      candidate_id: execution.candidate_id,
      reason: `Environment ${execution.environment_id}: ${phase}.`,
      environment_id: execution.environment_id,
      attempt_id: execution.fence.attempt_id,
    });
    await this.options.afterPhase?.(phase, execution);
  }

  async settleAttempt(
    execution: ClaimedExecution,
    state: CompletionAttempt["state"],
  ): Promise<void> {
    const current = await readCompletionRecord(this.options.root, {
      kind: "attempt",
      id: execution.fence.attempt_id,
    });
    if (current.kind !== "recorded" || current.record.kind !== "attempt") {
      throw new Error(
        "Attempt record is unavailable; retain environment recovery.",
      );
    }
    if (current.record.data.state.kind === "finished") return;
    if (
      (current.record.data.state.kind === "claimed" ||
        current.record.data.state.kind === "composing") &&
      current.record.data.state.claim.token !== execution.fence.token
    ) {
      throw new Error(
        "Attempt token changed; a superseded executor cannot settle it.",
      );
    }
    const written = await writeCompletionRecord(
      this.options.root,
      {
        ...current.record,
        revision: current.record.revision + 1,
        data: { ...current.record.data, state },
      },
      current.stamp,
      undefined,
      this.clock,
    );
    if (written.kind !== "written") {
      throw new Error(
        `Attempt settlement refused (${written.kind}); retain environment recovery.`,
      );
    }
  }

  async unfinished(
    execution: ClaimedExecution,
    recovery: CompletionRecovery,
  ): Promise<EnvironmentReturn> {
    try {
      const current = await this.current(execution, true);
      await this.settleAttempt(execution, { kind: "recovery", recovery });
      await replaceEnvironment(this.options.root, current, {
        ...current.record.data,
        state: {
          kind: "recovery",
          attempt_id: execution.fence.attempt_id,
          recovery,
        },
      }, this.clock);
    } catch (error) {
      return {
        kind: "recovery-incomplete",
        recovery: {
          ...recovery,
          reason: `${recovery.reason} Recovery publication also refused: ${
            errorReason(error)
          }`,
        },
      };
    }
    emitCompletionProgress({
      phase: "environment",
      state: "recovery",
      candidate_id: execution.candidate_id,
      environment_id: execution.environment_id,
      attempt_id: execution.fence.attempt_id,
      reason: recovery.reason,
      recovery,
    });
    return { kind: "recovery-incomplete", recovery };
  }

  /** The shared storage lease spans capture and publication, never project commands. */
  async snapshotArtifact(
    execution: ClaimedExecution,
    intent: ExecutionIntent,
    kind: "installed" | "drift" | "disposal",
    capture: () => Promise<WorkspaceSnapshot>,
  ): Promise<
    {
      snapshot: WorkspaceSnapshot;
      artifact: Awaited<ReturnType<typeof saveEnvironmentArtifact>>;
    }
  > {
    return await withRecoveryStorage(this.options.root, async () => {
      const snapshot = await capture();
      const artifact = await saveEnvironmentArtifact(
        this.options.root,
        {
          attempt_id: execution.fence.attempt_id,
          candidate_id: execution.candidate_id,
          context: intent.context,
        },
        kind === "installed" ? kind : `${kind}-${snapshot.digest}`,
        snapshot,
        async () => {
          await this.current(execution, true);
        },
      );
      const current = await this.current(execution, true);
      if (current.record.data.state.kind !== "executing") {
        throw new Error("Capture publication requires the current execution.");
      }
      await replaceEnvironment(this.options.root, current, {
        ...current.record.data,
        state: { ...current.record.data.state, capture: artifact },
      }, this.clock);
      return { snapshot, artifact };
    });
  }

  async returnEnvironment(
    execution: ClaimedExecution,
    intent: ExecutionIntent,
  ): Promise<EnvironmentReturn> {
    const { workspace, lifetime, root } = this.options;
    // A stopped producer still owes return work. A cancellation arriving during
    // that return stops its children and leaves the frozen recovery contract.
    const recoverySignal = execution.signal.aborted
      ? new AbortController().signal
      : execution.signal;
    execution = { ...execution, signal: recoverySignal };
    let phase: EnvironmentPhase = "capture";
    let drift: CompletionRecovery["drift"] = {
      kind: "uncaptured",
      reason: "Candidate capture is unfinished.",
    };
    let quiescent = false;
    try {
      const beforeReturn = await this.current(execution, true);
      quiescent = await lifetime.quiesce(
        execution.environment.path,
        execution.fence.attempt_id,
      );
      if (!quiescent) {
        throw new Error(
          "Child quiescence is unproved. Stop or reconcile the recorded attempt's children before retrying recovery.",
        );
      }
      await this.phase(execution, "capture", true);
      const { snapshot: captured, artifact } = await this.snapshotArtifact(
        execution,
        intent,
        "drift",
        () => workspace.capture(execution, intent.recipe),
      );
      drift = { kind: "captured", artifacts: [artifact] };
      const unprovisioned = await workspace.unprovisioned(
        { ...execution, environment: beforeReturn.record.data },
        intent.source,
        captured,
      );
      const disposable = unprovisioned ||
        (execution.environment.ownership.kind === "isolated" &&
          execution.environment.ownership.disposable);
      phase = disposable ? "dispose" : intent.recipe.action === "source-tip" ||
          execution.environment.ownership.kind === "borrowed"
        ? "restore"
        : "reset";
      await this.phase(execution, phase, true);
      if (unprovisioned) {
        await workspace.verify(
          execution.environment,
          captured,
          execution.signal,
        );
      } else if (disposable) {
        await workspace.restore(
          execution,
          intent.recipe,
          intent.source,
          captured,
        );
        await workspace.run(
          execution,
          intent.recipe,
          "dispose",
          recoverySignal,
        );
        const { snapshot: disposal } = await this.snapshotArtifact(
          execution,
          intent,
          "disposal",
          () => workspace.capture(execution, intent.recipe),
        );
        await workspace.dispose(execution, intent.recipe, disposal);
      } else {
        await workspace.restore(
          execution,
          intent.recipe,
          intent.source,
          captured,
        );
        if (intent.recipe.action !== "source-tip") {
          await workspace.run(
            execution,
            intent.recipe,
            phase === "reset" ? "reset" : "restore",
            recoverySignal,
          );
        }
        await workspace.verifyReturned(execution, intent.recipe, intent.source);
      }
      if (
        !await lifetime.quiesce(
          execution.environment.path,
          execution.fence.attempt_id,
        )
      ) {
        throw new Error(
          "A child remains active after the return procedure; reconcile it before reuse.",
        );
      }
      const current = await this.current(execution, true);
      const environment = {
        ...current.record.data,
        release: execution.environment.ownership.kind === "borrowed" &&
            !this.options.preserveReleaseOnReturn
          ? { kind: "held" as const }
          : current.record.data.release,
        state: disposable
          ? { kind: "disposed" as const, at: this.clock.wallNow() }
          : {
            kind: "idle" as const,
            returned_attempt_id: execution.fence.attempt_id,
          },
      };
      if (
        !disposable && environment.release.kind === "released"
      ) {
        environment.release = {
          ...environment.release,
          subject: await releasedSubject(
            environment,
            await workspace.inspect(
              environment,
              intent.recipe.declaration,
              environment.release.retirement ? "release" : undefined,
              execution.signal,
            ),
          ),
        };
      }
      const returned = await replaceEnvironment(
        root,
        current,
        environment,
        this.clock,
      );
      return {
        kind: disposable
          ? "disposed"
          : phase === "reset"
          ? "reset"
          : "restored",
        environment: returned.record.data,
      };
    } catch (error) {
      try {
        quiescent = await lifetime.quiesce(
          execution.environment.path,
          execution.fence.attempt_id,
        );
      } catch {
        quiescent = false;
      }
      return await this.unfinished(
        execution,
        recoveryFor(
          phase,
          `${errorReason(error)} After reconciling the retained paths, run ${
            executionRecoveryCommand(execution.environment_id)
          } from the owning worktree.`,
          execution.environment.path,
          cleanupCommands(intent),
          quiescent,
          drift,
        ),
      );
    }
  }

  async execute<T>(
    execution: ClaimedExecution,
    validate: (execution: ClaimedExecution) => Promise<T>,
  ): Promise<
    { readonly validation: T | null; readonly returned: EnvironmentReturn }
  > {
    let intent: ExecutionIntent;
    try {
      if (execution.environment_id !== this.options.environmentId) {
        throw new Error("Execution belongs to another enrolled environment.");
      }
      intent = await loadExecutionIntent(
        this.options.root,
        execution.fence.attempt_id,
        execution.environment_id,
      );
    } catch (error) {
      return {
        validation: null,
        returned: {
          kind: "recovery-incomplete",
          recovery: recoveryFor(
            "install",
            `Frozen execution intent is unavailable: ${
              errorReason(error)
            } No checkout effect ran. Restore the recorded intent before retrying recovery.`,
            execution.environment.path,
            [],
          ),
        },
      };
    }
    if (
      JSON.stringify(execution.candidate) !==
        JSON.stringify(intent.candidate) ||
      execution.candidate_id !== intent.candidate_id ||
      JSON.stringify(execution.attempt) !== JSON.stringify(intent.attempt) ||
      JSON.stringify(execution.environment.ownership) !==
        JSON.stringify(intent.environment.ownership) ||
      execution.environment.path !== intent.environment.path ||
      (intent.attempt.state.kind !== "claimed" &&
        intent.attempt.state.kind !== "composing") ||
      execution.fence.token !== intent.attempt.state.claim.token
    ) {
      return {
        validation: null,
        returned: {
          kind: "recovery-incomplete",
          recovery: recoveryFor(
            "install",
            "Execution differs from its frozen intent; observe the recorded candidate and claim. No checkout effect ran.",
            intent.environment.path,
            cleanupCommands(intent),
          ),
        },
      };
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([execution.signal, controller.signal]);
    let active = { ...execution, signal };
    const state = execution.environment.state;
    const timer = this.scheduler.scheduleTimeout(
      () => controller.abort(),
      state.kind === "executing"
        ? Math.max(0, state.claim.expires_at - this.clock.wallNow())
        : 0,
    );
    let validation: T | null = null;
    try {
      const returned = await this.options.lifetime.exclusive(
        execution.environment.path,
        execution.fence,
        async () => {
          let phase: EnvironmentPhase = "install";
          try {
            await this.current(active);
            signal.throwIfAborted();
            await this.options.workspace.verify(
              active.environment,
              intent.source,
              signal,
            );
            await this.phase(active, "install");
            await this.snapshotArtifact(
              active,
              intent,
              "installed",
              () =>
                this.options.workspace.install(
                  active,
                  intent.recipe,
                  intent.source,
                ),
            );
            phase = "prepare";
            await this.phase(active, phase);
            if (intent.recipe.action !== "source-tip") {
              await this.options.workspace.run(
                active,
                intent.recipe,
                "prepare",
                signal,
              );
            }
            signal.throwIfAborted();
            phase = "validate";
            await this.phase(active, phase);
            const validating = await this.current(active);
            validation = await validate({
              ...active,
              environment: validating.record.data,
            });
            await this.current(active);
            await this.settleAttempt(active, {
              kind: "finished",
              outcome: signal.aborted
                ? "cancelled"
                : this.options.validationOutcome(validation),
              finished_at: this.clock.wallNow(),
            });
          } catch (error) {
            await this.settleAttempt(active, {
              kind: "recovery",
              recovery: recoveryFor(
                phase,
                errorReason(error),
                active.environment.path,
                cleanupCommands(intent),
              ),
            });
          }
          active = await restoreValidationBinding(this.options.root, active);
          const returned = await this.returnEnvironment(active, intent);
          if (returned.kind !== "recovery-incomplete") {
            await this.settleAttempt(active, {
              kind: "finished",
              outcome: signal.aborted ? "cancelled" : "failed",
              finished_at: this.clock.wallNow(),
            });
          }
          return returned;
        },
      );
      emitCompletionEvent(
        executionEvent(
          active,
          `${active.attempt.identity.id}:return`,
          this.clock.wallNow(),
          { kind: "restoration", outcome: returned.kind },
        ),
      );
      return { validation, returned };
    } catch (error) {
      const returned = await this.unfinished(
        active,
        recoveryFor(
          "validate",
          errorReason(error),
          active.environment.path,
          cleanupCommands(intent),
        ),
      );
      emitCompletionEvent(
        executionEvent(
          active,
          `${active.attempt.identity.id}:return`,
          this.clock.wallNow(),
          { kind: "restoration", outcome: returned.kind },
        ),
      );
      return { validation, returned };
    } finally {
      this.scheduler.cancelTimeout(timer);
    }
  }

  async recover(
    environmentId: string,
    expectedStamp: string,
    executor: Executor,
  ): Promise<EnvironmentReturn> {
    let current: RecordedEnvironment;
    try {
      ExecutorSchema.parse(executor);
      if (environmentId !== this.options.environmentId) {
        throw new Error(
          "Recovery belongs to another enrolled environment; use its owning executor adapter.",
        );
      }
      current = await requireEnvironment(this.options.root, environmentId);
    } catch (error) {
      return {
        kind: "recovery-incomplete",
        recovery: recoveryFor(
          "restore",
          `${
            errorReason(error)
          } No checkout effect ran; observe and reconcile the exact environment record before retrying recovery.`,
          this.options.root,
          [],
        ),
      };
    }
    const environment = current.record.data;
    const state = environment.state;
    const pending = recoveryFor(
      "restore",
      "Observe the exact recovery record before retrying; this call made no checkout change.",
      environment.path,
      [],
    );
    if (current.stamp !== expectedStamp) {
      return { kind: "recovery-incomplete", recovery: pending };
    }
    if (state.kind === "disposed") return { kind: "disposed", environment };
    if (state.kind === "idle") {
      if (state.returned_attempt_id !== undefined) {
        const intent = await loadExecutionIntent(
          this.options.root,
          state.returned_attempt_id,
          environmentId,
        );
        if (
          JSON.stringify(intent.environment.ownership) !==
            JSON.stringify(environment.ownership) ||
          intent.environment.path !== environment.path
        ) {
          throw new Error(
            "Returned attempt disagrees with frozen environment ownership.",
          );
        }
        const execution: ClaimedExecution = {
          fence: {
            attempt_id: state.returned_attempt_id,
            token: intent.attempt.state.kind === "claimed" ||
                intent.attempt.state.kind === "composing"
              ? intent.attempt.state.claim.token
              : executor.operation_id,
          },
          attempt: intent.attempt,
          environment_id: environmentId,
          environment,
          candidate_id: intent.candidate_id,
          candidate: intent.candidate,
          signal: new AbortController().signal,
        };
        await this.options.workspace.verifyReturned(
          execution,
          intent.recipe,
          intent.source,
        );
        if (
          !await this.options.lifetime.quiesce(
            environment.path,
            state.returned_attempt_id,
          )
        ) {
          return {
            kind: "recovery-incomplete",
            recovery: {
              ...pending,
              reason: "Returned attempt child quiescence remains unproved.",
            },
          };
        }
        await this.settleAttempt(execution, {
          kind: "finished",
          outcome: "cancelled",
          finished_at: this.clock.wallNow(),
        });
      }
      return {
        kind: environment.ownership.kind === "borrowed" ? "restored" : "reset",
        environment,
      };
    }
    if (
      state.kind === "executing" &&
      state.claim.expires_at > this.clock.wallNow()
    ) {
      return {
        kind: "recovery-incomplete",
        recovery: {
          ...pending,
          reason:
            "The recorded executor still has a live claim. Wait for it to finish or expire; do not take its environment.",
        },
      };
    }
    try {
      const intent = await loadExecutionIntent(
        this.options.root,
        state.attempt_id,
        environmentId,
      );
      if (
        JSON.stringify(intent.environment.ownership) !==
          JSON.stringify(environment.ownership) ||
        intent.environment.path !== environment.path ||
        intent.environment.declaration !== environment.declaration ||
        environment.release.kind !== "released"
      ) {
        throw new Error(
          "Recovery intent disagrees with the environment's frozen ownership or release.",
        );
      }
      const now = this.clock.wallNow();
      const claim = {
        token: this.entropy.uuid(),
        executor,
        acquired_at: now,
        expires_at: now + this.options.leaseMs,
      };
      const recovering = await replaceEnvironment(this.options.root, current, {
        ...environment,
        state: {
          kind: "executing",
          attempt_id: state.attempt_id,
          candidate_id: intent.candidate_id,
          release_id: environment.release.id,
          claim,
          phase: state.kind === "executing"
            ? state.phase
            : state.recovery.phase === "install"
            ? "install"
            : "capture",
        },
      }, this.clock);
      const execution: ClaimedExecution = {
        fence: { attempt_id: state.attempt_id, token: claim.token },
        attempt: intent.attempt,
        environment_id: environmentId,
        environment: recovering.record.data,
        candidate_id: intent.candidate_id,
        candidate: intent.candidate,
        signal: new AbortController().signal,
      };
      // Fence the original publisher before obtaining child or checkout capabilities.
      const oldExecution = {
        ...execution,
        fence: {
          attempt_id: state.attempt_id,
          token: (intent.attempt.state.kind === "claimed" ||
              intent.attempt.state.kind === "composing")
            ? intent.attempt.state.claim.token
            : "",
        },
      };
      await this.settleAttempt(oldExecution, {
        kind: "recovery",
        recovery: {
          ...pending,
          reason:
            "The original validation attempt is closed; only environment return may resume.",
        },
      });
      return await this.options.lifetime.exclusive(
        environment.path,
        execution.fence,
        async () => {
          const bound = await restoreValidationBinding(
            this.options.root,
            execution,
          );
          const returned = await this.returnEnvironment(bound, intent);
          if (returned.kind !== "recovery-incomplete") {
            await this.options.afterReturn?.();
            await this.settleAttempt(execution, {
              kind: "finished",
              outcome: "cancelled",
              finished_at: this.clock.wallNow(),
            });
          }
          emitCompletionEvent(
            executionEvent(
              execution,
              `${execution.attempt.identity.id}:return`,
              this.clock.wallNow(),
              { kind: "restoration", outcome: returned.kind },
            ),
          );
          return returned;
        },
      );
    } catch (error) {
      return {
        kind: "recovery-incomplete",
        recovery: { ...pending, reason: errorReason(error) },
      };
    }
  }
}

/** Bind the frozen port to explicit workspace, lifetime, and sequence capabilities. */
export function createEnvironmentExecutor(
  options: EnvironmentExecutorOptions,
): EnvironmentExecutor {
  const executor = new ExecutorImplementation(options);
  return {
    observe: (...args) => executor.observe(...args),
    plan: (...args) => executor.plan(...args),
    claim: (...args) =>
      withRecoveryStorage(options.root, () => executor.claim(...args)),
    execute: (execution, validate) => executor.execute(execution, validate),
    recover: (...args) => executor.recover(...args),
  };
}
