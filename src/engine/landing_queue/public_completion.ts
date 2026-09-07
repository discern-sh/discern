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
import { inLinkedWorktree, integrationBranch } from "../worktree/git.ts";
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
  releaseExecutionEnvironment,
  requireEnvironment,
} from "../execution/registry.ts";

export interface ReleasedCompletionExecution {
  readonly source: SourceRevision;
  readonly executor: Executor;
  readonly released: {
    readonly environment_id: string;
    readonly expected_stamp: string;
  };
}

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
  },
  run: (session: CompletionSession) => Promise<CompletionRunValue<T>>,
  finalize?: (value: T, pointer: CompletionProofPointer) => Promise<boolean>,
): Promise<
  CompletedCandidate<T> | CompletionBlocker | { readonly kind: "replan" }
> {
  const root = await Deno.realPath(rootInput);
  return await withCompletionCheckout(root, async (signal) => {
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
    const trunk = integrationBranch(config.repository.trunk);
    const trunkHead = await gitValue(root, ["rev-parse", `${trunk}^{commit}`]);
    const queueReading = await readCompletionRecord(root, {
      kind: "queue",
      id: REPOSITORY_QUEUE_ID,
    });
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
    const declaration = !temporary && !await inLinkedWorktree(root)
      ? null
      : config.execution[options.context] ?? (temporary ? undefined : null);
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
    observation = await observeCompletionRecords(root);
    records = observedRecords(observation);
    const rerunOf = options.rerun
      ? finishedValidationAttempts(records)[0]?.id ?? null
      : null;
    const leaseMs = await completionLease(config);
    queue = await requireQueue(root);
    const claim = await claimQueueWork({
      root,
      expected_stamp: queue.stamp,
      effort: source.effort_id,
      candidate_id: candidateId,
      candidate,
      environment_id: environmentId,
      executor: actor,
      policy: config.completion,
      lease_ms: leaseMs,
      rerun_of: rerunOf,
      mode: options.mode,
    });
    if ("kind" in claim) {
      return claim;
    }
    const executor = createEnvironmentExecutor({
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
    const execution = await executor.claim(environmentPlan, actor);
    if ("kind" in execution) {
      await releaseQueueClaim(root, claim, candidate);
      return execution;
    }
    let executionFailure: string | undefined;
    let compositionFailure: CompletionBlocker | undefined;
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
            if (!await checkQueueClaim(root, claim, candidate)) {
              throw new Error(
                "Queue work expired or was superseded before component publication.",
              );
            }
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
              throw new Error(
                `Component publication ${written.kind}; preserve the attempt.`,
              );
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
        kind: "environment-unavailable" as const,
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
        kind: "environment-unavailable",
        reason: executionFailure ??
          "Candidate execution did not produce a result. Inspect its durable attempt and recovery.",
      };
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
    const assembly = await claimQueueAssembly(root, claim, candidate, 60_000);
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
      const returnedEnvironment = await requireEnvironment(root, environmentId);
      await releaseExecutionEnvironment(
        root,
        environmentId,
        returnedEnvironment.stamp,
        actor,
        declaration,
        { lifetime, workspace },
        { retirement: true },
      );
    }
    return {
      ...base,
      value: result.value,
      proof_id: admission.proof_id,
      blockers: [],
    };
  }, options.signal);
}
