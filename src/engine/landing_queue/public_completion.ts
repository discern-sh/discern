import { completionRecordBlocker } from "../completion/compatibility.ts";
import { waitForCompletionCapacity } from "../completion/capacity.ts";
import {
  emitCompletionEvent,
  emitCompletionProgress,
} from "../completion/events.ts";
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import { emitComponentUse } from "../completion/events.ts";
import { producerLabel } from "../validation/public_run.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { retainExecutionCandidate } from "../execution/validation_binding.ts";
/** One active completion invocation selects, composes, validates and admits its immutable candidate. */
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { resolveGeneratedGroups } from "../../shared/generated_artifacts.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { runGit } from "../../shared/subprocess.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
  CompletionEvent,
  ValidationPlan,
} from "../completion/protocol.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { Executor, SourceRevision } from "../completion/identity.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { configuredValidation } from "../validation/configuration.ts";
import { finishedValidationAttempts } from "../validation/selection.ts";
import { requirementSetIdentity } from "../validation/catalog.ts";
import type { PublicValidationRun } from "../validation/public_run.ts";
import { createEnvironmentExecutor } from "../execution/executor.ts";
import { IdentityError, resolveIdentity } from "../worktree/identity.ts";
import {
  ownValidationEnvironment,
  releasedValidationEnvironment,
} from "../execution/public_environment.ts";
import { integrationBranch, worktreeGitKey } from "../worktree/git.ts";
import { classifyScopeImpact } from "../scopes/scopes.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { compositionRecipe } from "./generation.ts";
import {
  composeCandidate,
  discoverSourceDependencies,
  gitValue,
  observeSource,
  publishCandidate,
} from "./composition.ts";
import { predecessorPolicyIdentity } from "./policy.ts";
import { expectedPredecessor, sameSource } from "./model.ts";
import {
  initializeQueue,
  observedRecords,
  REPOSITORY_QUEUE_ID,
  requireQueue,
  reserveQueueAttempt,
  withQueueLock,
} from "./repository.ts";
import { mutateQueue } from "./mutations.ts";
import {
  checkQueueClaim,
  claimQueueAssembly,
  claimQueueWork,
  releaseQueueClaim,
  settleQueueClaim,
} from "./claims.ts";
import { publishAdmission } from "./admission.ts";

import {
  observeClaimCapacity,
  releaseExecutionEnvironment,
  requireEnvironment,
} from "../execution/registry.ts";
import { unprovenSpeculationBlocker } from "../execution/probe_record.ts";

export interface ReleasedCompletionExecution {
  readonly source: SourceRevision;
  readonly executor: Executor;
  readonly released: {
    readonly environment_id: string;
    readonly expected_stamp: string;
  };
}

export const COMPLETION_CLAIM_BOUNDARIES = [
  "reservation",
  "environment",
  "execution",
] as const;

export interface CompletionSession {
  readonly execution: ClaimedExecution;
  readonly context: string;
  readonly mode: "strict" | "report";
  readonly rerun_of?: string;
}
export interface CompletionRunValue<T> {
  readonly value: T;
  readonly passed: boolean;
  readonly validation?: PublicValidationRun;
  readonly blockers?: readonly CompletionBlocker[];
  readonly review?: import("../execution/types.ts").EnvironmentArtifact;
}
export interface CompletedCandidate<T> {
  readonly kind: "completed";
  readonly value: T;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly environment_id: string;
  readonly proof_id?: string;
  readonly blockers: readonly CompletionBlocker[];
}

/** The lease covers the canonical graph, composition, and both environment procedures. */
export async function completionLease(config: DiscernConfig): Promise<number> {
  const graph = await configuredValidation(config, Object.keys(config.scopes));
  const seconds = (timeout: number | undefined): number => {
    const value = timeout ?? config.gate.timeout;
    return value > 0 ? value : 86_400;
  };
  const producers = Object.values(graph.producers).reduce(
    (total, producer) => total + seconds(producer.timeout),
    0,
  );
  // Generators can run once during composition and again during validation.
  const generators = resolveGeneratedGroups(config).reduce(
    (total, group) => total + seconds(group.timeout),
    0,
  );
  const extraction = graph.obligations.reduce(
    (total, obligation) =>
      total +
      (obligation.input.extract === undefined ? 0 : seconds(
        graph.timeouts.get(`standards.${obligation.requirement.id}`)?.seconds,
      )),
    0,
  );
  const procedures = 2 * Math.max(1, config.gate.timeout);
  return 60_000 + (producers + generators + extraction + procedures) * 1000;
}

/** Compiled obligations are computed on the candidate after generated convergence. */
async function requirementsAt(root: string): Promise<string> {
  const config = await loadConfig(root);
  const impact = await classifyScopeImpact(root, config);
  return await requirementSetIdentity(
    (await configuredValidation(config, impact.scopes)).obligations.map((
      entry,
    ) => entry.requirement),
  );
}

/** Source ownership and explicit release are checked before any temporary checkout effect. */
export async function withPublicCompletion<T>(
  rootInput: string,
  options: {
    readonly context: string;
    readonly retainCheckout?: boolean;
    readonly released?: ReleasedCompletionExecution["released"];
    readonly mode: "strict" | "report";
    readonly rerun?: boolean;
    readonly signal?: AbortSignal;
    readonly source?: SourceRevision;
    readonly executor?: Executor;
    /** Exercise death before execution without substituting clock expiry for exclusion. */
    readonly afterClaim?: (
      boundary: (typeof COMPLETION_CLAIM_BOUNDARIES)[number],
    ) => Promise<void>;
  },
  run: (session: CompletionSession) => Promise<CompletionRunValue<T>>,
  finalize?: (value: T, pointer: CompletionProofPointer) => Promise<boolean>,
): Promise<
  CompletedCandidate<T> | CompletionBlocker | { readonly kind: "replan" }
> {
  const requestedAt = SYSTEM_CLOCK.wallNow();
  let attribution: Omit<CompletionEvent, "id" | "at" | "fact"> | undefined;
  const root = await Deno.realPath(rootInput);
  const completed = await withCompletionCheckout<
    CompletedCandidate<T> | CompletionBlocker | { readonly kind: "replan" }
  >(root, async (signal) => {
    const config = await loadConfig(root);
    let identity;
    try {
      identity = await resolveIdentity(root, root);
    } catch (error) {
      if (error instanceof IdentityError) {
        return {
          kind: "environment-unavailable" as const,
          reason: error.message,
        };
      }
      throw error;
    }
    const branch = await gitValue(root, ["symbolic-ref", "--quiet", "HEAD"]);
    const source = options.source ??
      await observeSource(root, identity.id, branch);
    const actor = options.executor ??
      {
        operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
        originating_effort: source.effort_id,
        started_at: SYSTEM_CLOCK.wallNow(),
      };
    attribution = {
      effort_id: source.effort_id,
      source_head: source.head,
      candidate_id: null,
      environment_id: null,
      attempt_id: null,
      executor_operation: actor.operation_id,
    };
    const trunk = integrationBranch(config.repository.trunk);
    const trunkHead = await gitValue(root, ["rev-parse", `${trunk}^{commit}`]);
    const queueReading = await readCompletionRecord(root, {
      kind: "queue",
      id: REPOSITORY_QUEUE_ID,
    });
    const unsupported = completionRecordBlocker({
      records: [{
        selector: { kind: "queue", id: REPOSITORY_QUEUE_ID },
        reading: queueReading,
      }],
    });
    if (unsupported !== undefined) return unsupported;
    if (queueReading.kind === "missing") await initializeQueue(root, trunkHead);
    let queue = await requireQueue(root);
    if (queue.record.data.trunk !== trunkHead) {
      const changed = await mutateQueue({
        root,
        trunk,
        expected_stamp: queue.stamp,
        mutation: { kind: "trunk-moved" },
      });
      if (changed.kind !== "changed") return changed;
      queue = await requireQueue(root);
    }
    let observation = await observeCompletionRecords(root);
    let records = observedRecords(observation);
    const dependencies = await discoverSourceDependencies(
      root,
      source,
      trunkHead,
      queue.record.data.entries.map((entry) => entry.source),
    );
    const existing = queue.record.data.entries.find((entry) =>
      entry.source.effort_id === source.effort_id
    );
    const selected = await mutateQueue({
      root,
      trunk,
      expected_stamp: queue.stamp,
      mutation: {
        kind: existing !== undefined && !sameSource(existing.source, source)
          ? "source-replaced"
          : "select",
        source,
        dependencies: dependencies.map((dependency) => dependency.effort_id),
      },
    });
    if (selected.kind !== "changed") return selected;
    queue = await requireQueue(root);
    const candidates = new Map(
      records.filter((record) => record.kind === "candidate").map((
        record,
      ) => [record.id, record.data]),
    );
    const entry = queue.record.data.entries.find((entry) =>
      entry.source.effort_id === source.effort_id
    );
    const ordered = expectedPredecessor(
      queue.record.data,
      source.effort_id,
      candidates,
    );
    // Ordinary author validation can establish its current source before unrelated approval.
    const predecessor = entry?.eligible_order === null
      ? { head: trunkHead, candidate_id: null }
      : ordered;
    if ("kind" in predecessor) return predecessor;
    const policy = await predecessorPolicyIdentity(root, predecessor.head);
    const recipe = await compositionRecipe(
      root,
      config,
      DISCERN_VERSION,
      Math.max(1, config.gate.timeout),
      {},
    );
    const requirementSet = await requirementsAt(root);
    const previous =
      entry?.candidate_id === null || entry?.candidate_id === undefined
        ? undefined
        : candidates.get(entry.candidate_id);
    const reusable = previous !== undefined &&
      sameSource(previous.source, source) &&
      previous.expected_predecessor.head === predecessor.head &&
      previous.policy === policy &&
      previous.requirement_set === requirementSet &&
      previous.composition.procedure === recipe.identity.procedure;
    const candidateId = reusable && entry?.candidate_id !== null &&
        entry?.candidate_id !== undefined
      ? entry.candidate_id
      : SYSTEM_SECURE_ENTROPY.uuid();
    let candidate: Candidate = reusable ? previous : {
      attempt_id: SYSTEM_SECURE_ENTROPY.uuid(),
      source,
      dependencies,
      expected_predecessor: predecessor,
      head: source.head,
      tree: source.tree,
      policy,
      requirement_set: requirementSet,
      composition: {
        ...recipe.identity,
        merge_commit: null,
        regeneration_commit: null,
      },
    };
    const contained = await runGit([
      "merge-base",
      "--is-ancestor",
      predecessor.head,
      source.head,
    ], { cwd: root });
    if (!contained.success && contained.code !== 1) {
      throw new Error("Candidate predecessor ancestry is unavailable.");
    }
    const temporary = !contained.success || candidate.head !== source.head;
    const declaration = temporary || options.released !== undefined
      ? config.execution[options.context] ?? (temporary ? undefined : null)
      : null;
    if (declaration === undefined) {
      return {
        kind: "environment-unavailable",
        reason:
          `This candidate needs temporary composition. Declare execution.${options.context}, or run discern update in the source worktree and then discern done.`,
      };
    }
    if (declaration?.kind === "isolated") {
      return {
        kind: "environment-unavailable",
        reason:
          "This source checkout cannot be used as an isolated slot. Select an explicitly provisioned execution environment.",
      };
    }
    const capabilities = options.released === undefined
      ? await ownValidationEnvironment(
        root,
        config,
        source,
        actor,
        declaration,
        signal,
      )
      : await releasedValidationEnvironment(
        root,
        config,
        source,
        declaration,
        options.released,
      );
    if ("kind" in capabilities) return capabilities;
    const { environmentId, workspace, lifetime } = capabilities;
    const observeCapacityWait =
      (boundary: string, attemptId: string | null = null) =>
      (interval: { started_at: number; finished_at: number }): void => {
        const intervalId = `${candidateId}:${boundary}`;
        emitCompletionEvent({
          id: `${actor.operation_id}:${intervalId}`,
          effort_id: source.effort_id,
          source_head: source.head,
          candidate_id: candidateId,
          environment_id: environmentId,
          attempt_id: attemptId,
          executor_operation: actor.operation_id,
          at: interval.finished_at,
          fact: {
            kind: "timing",
            category: "capacity-wait",
            interval_id: intervalId,
            ...interval,
          },
        });
      };

    observation = await observeCompletionRecords(root);
    records = observedRecords(observation);
    const rerunOf = options.rerun
      ? finishedValidationAttempts(records)[0]?.id ?? null
      : null;
    const leaseMs = await completionLease(config);
    // Early validation installs a differing candidate through the declared
    // environment, so it runs only where setup has proved that declaration.
    const unproven = declaration === null
      ? undefined
      : await unprovenSpeculationBlocker(root, options.context, declaration);
    const claim = await waitForCompletionCapacity({
      signal,
      onWaited: observeCapacityWait("queue"),
      waiting: (value) =>
        "kind" in value && value.kind === "capacity-unavailable" &&
        value.transient,
      onWait: (value) =>
        emitCompletionProgress({
          phase: "pending",
          state: "capacity-wait",
          candidate_id: candidateId,
          ...("kind" in value && value.kind === "capacity-unavailable"
            ? { capacity: value.capacity, reason: value.reason }
            : { reason: JSON.stringify(value) }),
        }),
      observe: async () =>
        await claimQueueWork({
          root,
          effort: source.effort_id,
          candidate_id: candidateId,
          candidate,
          environment_id: environmentId,
          ...(options.afterClaim === undefined ? {} : {
            afterReservation: () =>
              options.afterClaim?.("reservation") ?? Promise.resolve(),
          }),
          executor: actor,
          policy: config.completion,
          lease_ms: leaseMs,
          rerun_of: rerunOf,
          mode: options.mode,
          ...(unproven === undefined ? {} : { unproven }),
        }),
    });
    if ("kind" in claim) {
      return claim;
    }
    attribution = {
      ...attribution,
      candidate_id: candidateId,
      environment_id: environmentId,
      attempt_id: claim.fence.attempt_id,
    };
    const executor = createEnvironmentExecutor({
      ...(options.afterClaim === undefined ? {} : {
        afterClaimPublication: () =>
          options.afterClaim?.("environment") ?? Promise.resolve(),
      }),
      root,
      environmentId,
      declaration,
      workspace,
      lifetime,
      leaseMs,
      signal,
      reserveAttempt: (plan, executor) =>
        reserveQueueAttempt(root, plan, executor, rerunOf),
      preserveReleaseOnReturn: options.released !== undefined,
      validationOutcome: (value) =>
        typeof value === "object" && value !== null && "passed" in value &&
          value.passed === true
          ? "passed"
          : "failed",
    });
    const empty: ValidationPlan = {
      candidate_id: candidateId,
      candidate,
      demand: {
        kind: "compose",
        context: options.context,
        mode: options.mode,
      },
      producers: [],
      reused: [],
      blockers: [],
    };
    const environmentPlan = executor.plan(
      await observeCompletionRecords(root),
      empty,
    );
    if ("kind" in environmentPlan) {
      await releaseQueueClaim(root, claim, candidate);
      return environmentPlan;
    }
    const capacity = await waitForCompletionCapacity({
      signal,
      onWaited: observeCapacityWait("environment", claim.fence.attempt_id),
      waiting: (value) =>
        value !== null && value.kind === "waiting-for-operation",
      onWait: (value) =>
        emitCompletionProgress({
          phase: "pending",
          state: "execution-capacity-wait",
          candidate_id: candidateId,
          ...(value?.kind === "waiting-for-operation"
            ? { attempt_id: value.attempt_id }
            : {}),
          reason: `execution capacity ${
            declaration?.capacity ?? 1
          } is occupied; waiting for an environment return: ${
            JSON.stringify(value)
          }`,
        }),
      observe: async () =>
        await observeClaimCapacity(
          root,
          (await requireEnvironment(root, environmentId)).record.data,
          declaration?.capacity ?? 1,
        ),
    });
    if (capacity !== null) {
      await releaseQueueClaim(root, claim, candidate);
      return capacity;
    }
    const execution = await executor.claim(environmentPlan, actor);
    if ("kind" in execution) {
      await releaseQueueClaim(root, claim, candidate);
      return execution;
    }
    let executionFailure: string | undefined;
    let compositionFailure: CompletionBlocker | undefined;
    let publicationFailure: CompletionBlocker | undefined;
    await options.afterClaim?.("execution");
    const returned = await executor.execute(execution, async (claimed) => {
      try {
        if (!reusable) {
          const composed = await composeCandidate({
            root,
            execution: claimed,
            prepare: () =>
              workspace.run(
                claimed,
                environmentPlan,
                "prepare",
                claimed.signal,
              ),
            recipe,
            dependencies,
            predecessor,
            policy,
            requirement_set: requirementSet,
            requirements: requirementsAt,
          });
          if ("kind" in composed) {
            compositionFailure = composed;
            throw new Error(JSON.stringify(composed));
          }
          candidate = composed;
          await publishCandidate(root, candidateId, candidate, claimed.fence);
          await retainExecutionCandidate(
            root,
            claimed,
            candidate,
            options.context,
          );
        }
        const result = await run({
          execution: { ...claimed, candidate },
          context: options.context,
          mode: options.mode,
          ...(rerunOf === null ? {} : { rerun_of: rerunOf }),
        });
        for (const component of result.validation?.outcome.evidence ?? []) {
          await withQueueLock(root, async () => {
            // The producer claim binds immutable applicability. Queue admission
            // has a separate fence and may already have lost eligibility.
            const evidenceId = SYSTEM_SECURE_ENTROPY.uuid();
            const written = await writeCompletionRecord(
              root,
              {
                version: ON_DISK_FORMATS.completionRecord.version,
                kind: "evidence",
                id: evidenceId,
                revision: 1,
                data: component,
              },
              null,
              claimed.fence,
            );
            if (written.kind !== "written") {
              publicationFailure =
                written.kind === "newer" || written.kind === "older" ||
                  written.kind === "invalid" || written.kind === "unavailable"
                  ? completionRecordBlocker({
                    records: [{
                      selector: { kind: "evidence", id: evidenceId },
                      reading: written,
                    }],
                  })
                  : {
                    kind: "stale-evidence",
                    evidence_ids: [],
                    reason: "artifact-unavailable",
                  };
              return;
            }
            emitComponentUse(
              { ...claimed, candidate },
              component,
              evidenceId,
              "executed",
              (result.validation?.results.get(
                producerLabel(component.applicability.producer),
              )?.durationS ?? 0) * 1000,
              component.finished_at,
            );
          });
        }
        return result;
      } catch (error) {
        executionFailure = error instanceof Error
          ? error.message
          : String(error);
        throw error;
      }
    });
    const result = returned.validation;
    const base = {
      kind: "completed" as const,
      candidate_id: candidateId,
      candidate,
      environment_id: environmentId,
    };
    if (returned.returned.kind === "recovery-incomplete") {
      // The executor's environment retains recovery ownership. This actor has
      // stopped advancing the queue, so its separate scheduling claim must end.
      await releaseQueueClaim(root, claim, candidate);
      const blocker = {
        kind: "recovery-incomplete" as const,
        record_id: environmentId,
        recovery: {
          ...returned.returned.recovery,
          reason: executionFailure === undefined
            ? returned.returned.recovery.reason
            : `${executionFailure} Environment return also needs recovery: ${returned.returned.recovery.reason}`,
        },
      };
      return result === null
        ? blocker
        : { ...base, value: result.value, blockers: [blocker] };
    }
    if (signal.aborted) {
      await releaseQueueClaim(root, claim, candidate);
      const cancelled = {
        kind: "cancelled" as const,
        reason:
          "Completion was cancelled; its environment and queue claim have returned.",
      };
      return result === null
        ? cancelled
        : { ...base, value: result.value, blockers: [cancelled] };
    }
    if (result === null) {
      await releaseQueueClaim(root, claim, candidate);
      if (compositionFailure !== undefined) return compositionFailure;
      return {
        kind: "validation-failed",
        evidence_ids: [],
        reason: executionFailure ??
          "Candidate execution did not produce a result. Inspect its durable attempt and recovery.",
      };
    }
    if (publicationFailure !== undefined) {
      await releaseQueueClaim(root, claim, candidate);
      return { ...base, value: result.value, blockers: [publicationFailure] };
    }
    if (result.blockers !== undefined && result.blockers.length > 0) {
      await releaseQueueClaim(root, claim, candidate);
      return { ...base, value: result.value, blockers: result.blockers };
    }
    const validation = result.validation;
    if (
      !result.passed || validation === undefined ||
      validation.outcome.blockers.length > 0
    ) {
      await withQueueLock(root, async () => {
        if (!await checkQueueClaim(root, claim, candidate)) return;
        await settleQueueClaim(root, claim, "failed");
        const current = await requireQueue(root);
        await mutateQueue({
          root,
          trunk,
          expected_stamp: current.stamp,
          mutation: { kind: "candidate-failed", effort: source.effort_id },
        });
      });
      return {
        ...base,
        value: result.value,
        blockers: validation?.outcome.blockers.length
          ? validation.outcome.blockers
          : [{ kind: "validation-failed", evidence_ids: [] }],
      };
    }
    const assembly = await withQueueLock(
      root,
      async () =>
        await checkQueueClaim(root, claim, candidate)
          ? await claimQueueAssembly(root, claim, candidate, 60_000)
          : null,
    );
    if (assembly === null) {
      return {
        ...base,
        value: result.value,
        blockers: [{
          kind: "stale-evidence",
          evidence_ids: [],
          reason: "predecessor-changed",
        }],
      };
    }
    await validation.evaluator.observe(candidateId);
    const admission = await publishAdmission({
      root,
      trunk,
      claim: assembly,
      candidate,
      evaluator: validation.evaluator,
      requirements: validation.snapshot.requirements,
      mode: options.mode,
      ...(result.review === undefined ? {} : { review: result.review }),
    });
    if (admission.kind !== "admitted") {
      await releaseQueueClaim(root, assembly, candidate);
      return {
        ...base,
        value: result.value,
        blockers: [
          admission.kind === "replan"
            ? {
              kind: "stale-evidence",
              evidence_ids: [],
              reason: "external-trunk",
            }
            : admission,
        ],
      };
    }
    // Final source checks and Proof presentation finish under the same checkout
    // exclusion before another actor can claim or retire the released state.
    const finalized = await finalize?.(result.value, {
      candidate_id: candidateId,
      proof_id: admission.proof_id,
    }) ?? true;
    if (
      finalized && options.released === undefined &&
      options.mode === "strict" &&
      !options.retainCheckout
    ) {
      // Source execution needs no temporary installation. Its owner's later
      // release can still enroll the declared borrowed contract for composition.
      // Only a linked worktree can be borrowed; the main checkout is released
      // as source only, whatever the configuration declares.
      const configured = config.execution[options.context];
      const linked = await worktreeGitKey(root) !== undefined;
      const releaseDeclaration = declaration ??
        (linked && configured?.kind === "borrowed" ? configured : null);
      const release = releaseDeclaration === declaration
        ? { environmentId, lifetime, workspace }
        : await ownValidationEnvironment(
          root,
          config,
          source,
          actor,
          releaseDeclaration,
          signal,
        );
      if ("kind" in release) {
        return {
          ...base,
          value: result.value,
          proof_id: admission.proof_id,
          blockers: [release],
        };
      }
      const returnedEnvironment = await requireEnvironment(
        root,
        release.environmentId,
      );
      await releaseExecutionEnvironment(
        root,
        release.environmentId,
        returnedEnvironment.stamp,
        actor,
        releaseDeclaration,
        release,
        { retirement: true, signal },
      );
    }
    return {
      ...base,
      value: result.value,
      proof_id: admission.proof_id,
      blockers: [],
    };
  }, options.signal);
  if (attribution !== undefined) {
    const finishedAt = SYSTEM_CLOCK.wallNow();
    emitCompletionEvent({
      ...attribution,
      id: `${attribution.executor_operation}:validation-feedback`,
      at: finishedAt,
      fact: {
        kind: "timing",
        interval_id: attribution.executor_operation,
        category: "validation-feedback",
        started_at: requestedAt,
        finished_at: finishedAt,
      },
    });
  }
  return completed;
}
