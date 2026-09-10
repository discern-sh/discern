/** An active accept actor advances one audited, separately authorized effort at a time. */
import { QUEUE_DECISION_SUBJECT } from "./queue_decision_subjects.ts";
import { loadModule } from "../../shared/module_loading.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import { landingAdvanced } from "../completion/records.ts";
import type { FinishResultSurface } from "../gate/finish.ts";
import { inspectLandingAuthority } from "../worktree/landing_authority.ts";
import {
  type LandingConverger,
  landingNeedsRecovery,
  readLandingConvergenceResult,
} from "./convergence.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { observeCheckpointActivity } from "../../shared/result_capture.ts";
import { declarationIsCurrent } from "../checkpoints/open_questions.ts";
import type { AcceptData, Proof } from "../../shared/result_schemas.ts";
import type {
  AttemptIdentity,
  Executor,
  SourceRevision,
} from "../completion/identity.ts";
import type {
  CompletionObservation,
  QueuePlan,
} from "../completion/protocol.ts";
import { requireEnvironment } from "../execution/registry.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { OperationLockError } from "../operation_lock.ts";
import { inspectAcceptanceCheckpoints } from "../worktree/acceptance_checkpoints.ts";
import {
  integrationBranch,
  mainRepoPath,
  worktreePathForBranch,
} from "../worktree/git.ts";
import { resolveWorktreeTarget } from "../worktree/target_resolution.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { cancelQueueClaim, type QueueWorkClaim } from "./claims.ts";
import { createSourceAncestry, observeSource } from "./composition.ts";
import { orderedEntries, sameSource } from "./model.ts";
import { queueEntryReadiness, queueRowFacts } from "./queue_projection.ts";
import { mutateQueue } from "./mutations.ts";
import {
  type CandidateAssessment,
  claimAssessedLanding,
  createQueuePlanner,
} from "./planner.ts";
import {
  assessLandingPrefix,
  assessPublicCandidate,
  type CandidateDecisionRequest,
  type PublicCandidateAssessment,
} from "./public_assessment.ts";
import {
  previewQueueAuthorities,
  synchronizeQueueAuthorities,
} from "./public_authority.ts";
import {
  type AcceptancePending,
  acceptancePending,
  type AcceptancePrefix,
  acceptancePrefix,
  displayBranch,
  queueAcceptanceResult as formatQueueAcceptanceResult,
} from "./public_result.ts";
import {
  type LandingRecord,
  publishQueueLanding,
  type QueueLandingRuntime,
  readLandingProof,
  recoverQueueLanding,
} from "./publication.ts";
import {
  observedRecords,
  observeQueue,
  requireQueue,
  withQueueLock,
} from "./repository.ts";
import { planQueueRetirement, retireQueueLanding } from "./retirement.ts";
import { completionRecordBlocker } from "../completion/compatibility.ts";
import { reclaimRetirementStorage } from "./retirement_storage.ts";

export interface PublicAcceptOptions {
  readonly validationSurface: FinishResultSurface;
  readonly signal?: AbortSignal;
  readonly cliModel: CliModelProvider;
  readonly converge: LandingConverger;
  readonly dryRun?: boolean;
  readonly target?: string;
  readonly confirmed?: boolean;
  readonly variance?: string[];
  readonly approveStandard?: string[];
}

/** Public entry points share this actor; status and dry-run never instantiate a publication claim. */
export async function acceptQueueResult(
  ctx: LifecycleContext,
  options: PublicAcceptOptions,
): Promise<DiscernResult<AcceptData>> {
  const main = await mainRepoPath(ctx.cwd);
  const result = await acceptQueueImplementation(ctx, options);
  if (
    options.dryRun || main === undefined || result.data?.queue === undefined
  ) return result;
  const landings = new Set(
    result.data.queue.filter((row) => row.retirement === "retired").map((row) =>
      row.landing_id
    ),
  );
  if (landings.size === 0) return result;
  const retirements = observedRecords(
    await observeQueue(main, integrationBranch(ctx.config.repository.trunk)),
  )
    .filter((record) => record.kind === "retirement")
    .filter((record) =>
      record.data.outcome.kind === "retired" &&
      record.data.landing_id !== null && landings.has(record.data.landing_id)
    )
    .map((record) => record.id);
  const storage = await reclaimRetirementStorage(
    main,
    retirements,
    false,
    options.signal,
  );
  return {
    ...result,
    data: { ...result.data, storage_cleanup: storage },
    ...(storage.state === "retained"
      ? {
        message: `${
          result.message ?? "Acceptance state recorded."
        } Recovery artifact cleanup remains pending: ${storage.reason} Preserve these artifacts and retry each returned retirement id with discern accept --reclaim <retirement-id> from the main checkout.`,
      }
      : {}),
  };
}

/** Advance authorized prefixes and finish their checkout retirement before artifact cleanup. */
async function acceptQueueImplementation(
  ctx: LifecycleContext,
  options: PublicAcceptOptions,
): Promise<DiscernResult<AcceptData>> {
  const main = await mainRepoPath(ctx.cwd);
  if (main === undefined) {
    return {
      ok: false,
      verb: "accept",
      error: "no_repository",
      message: "The main checkout cannot be located.",
    };
  }
  const root = await Deno.realPath(main);
  const trunk = integrationBranch(ctx.config.repository.trunk);
  const identity = await resolveIdentity(ctx.cwd, ctx.cwd);
  const initialObservation = await observeQueue(root, trunk);
  const initialQueue = observedRecords(initialObservation).find((
    record,
  ) => record.kind === "queue");
  let selected = identity.id;
  if (options.target !== undefined) {
    const exact = initialQueue?.data.entries.find((entry) =>
      entry.source.effort_id === options.target
    );
    if (exact !== undefined) selected = exact.source.effort_id;
    else {
      const target = await resolveWorktreeTarget(root, options.target, {
        cwd: ctx.cwd,
        mode: "branch",
        command: "accept --target",
      });
      const entry = initialQueue?.data.entries.find((entry) =>
        entry.source.effort_id === target.id ||
        entry.source.branch === target.ref
      );
      if (entry === undefined) {
        return {
          ok: false,
          verb: "accept",
          error: "no_target",
          message:
            "The selected effort has no completion candidate. Run discern done on its clean committed source.",
        };
      }
      selected = entry.source.effort_id;
    }
  } else if (identity.id === "main") {
    const active = initialQueue === undefined
      ? []
      : orderedEntries(initialQueue.data);
    if (active.length > 1) {
      return {
        ok: false,
        verb: "accept",
        error: "no_target",
        message:
          "Select the effort to accept with --target <effort-id>. Each predecessor needs its own authority.",
      };
    }
    selected = active[0]?.source.effort_id ?? "main";
  }
  // The owner selected one effort, implicitly by running from its worktree or
  // explicitly with --target. The walk may land or stop on efforts ahead of it,
  // so the shared formatter leads with the selected effort's own verdict and
  // always carries its row; a landing headline for a predecessor is never the
  // answer. This wrapper only supplies the selected identity and, when the walk
  // never produced the row, synthesizes it from the observed queue entry.
  const queueAcceptanceResult = (
    ...args: Parameters<typeof formatQueueAcceptanceResult>
  ): Promise<DiscernResult<AcceptData>> => {
    if (selected === "main") return formatQueueAcceptanceResult(...args);
    const [root, rows, pendingBlockers, proof, dryRun = false, drops] = args;
    const entry = initialQueue?.data.entries.find((candidate) =>
      candidate.source.effort_id === selected
    );
    const stoppedAt = [...rows].reverse().find((row) =>
      row.state !== "landed" && row.effort !== selected
    );
    let synthesized: AcceptancePrefix | undefined;
    if (
      !rows.some((row) =>
        row.effort === selected &&
        (entry === undefined || row.source_head === entry.source.head)
      ) && entry !== undefined
    ) {
      const assessed = acceptancePrefix(
        entry,
        entry.candidate_id === null
          ? undefined
          : details.get(entry.candidate_id),
      );
      const conditions =
        assessed.pending.length > 0 || entry.candidate_id !== null
          ? assessed.pending
          : [acceptancePending({ kind: "missing-evidence", requirements: [] })];
      synthesized = {
        ...assessed,
        pending: stoppedAt === undefined ? conditions : [{
          kind: "not-reached",
          reason: `Acceptance stopped at ${
            displayBranch(stoppedAt.branch)
          }, which is ahead of this effort in the queue.`,
        }, ...conditions],
      };
    }
    return formatQueueAcceptanceResult(
      root,
      rows,
      pendingBlockers,
      proof,
      dryRun,
      drops,
      {
        effort: selected,
        branch: displayBranch(
          rows.find((row) => row.effort === selected)?.branch ??
            entry?.source.branch ?? `refs/heads/${identity.branch}`,
        ),
        ...(entry === undefined ? {} : { sourceHead: entry.source.head }),
        ...(synthesized === undefined ? {} : { synthesized }),
        queueOrder: initialQueue === undefined
          ? []
          : orderedEntries(initialQueue.data, { includeHeld: true }).map(
            (candidate) => candidate.source.effort_id,
          ),
        // Each waiting row leads with the same single reason the status queue
        // shows — including a stale entry's withdrawal or reconciliation
        // offer instead of advice to rerun checks for integrated work.
        resolveQueueReason: async (row) => {
          const listed = initialQueue?.data.entries.find((candidate) =>
            candidate.source.effort_id === row.effort
          );
          if (listed === undefined) return undefined;
          const facts = await queueRowFacts(
            root,
            () => Promise.resolve(initialObservation),
            listed,
            trunk,
            initialQueue?.data.entries ?? [],
          );
          const readiness = queueEntryReadiness(listed, facts);
          return readiness.reason === undefined ? undefined : {
            kind: facts.onTrunk
              ? "already-on-trunk"
              : listed.held === true
              ? "effort-held"
              : "queued",
            reason: readiness.reason,
          };
        },
      },
    );
  };
  const sourceEntry = initialQueue?.data.entries.find((entry) =>
    entry.source.effort_id === selected
  );
  let source: SourceRevision | undefined;
  if (sourceEntry !== undefined) {
    const path = await worktreePathForBranch(
      root,
      sourceEntry.source.branch.slice("refs/heads/".length),
    );
    if (path !== undefined) {
      const pin = await pinValidatedTree(path);
      if (pin.clean && pin.head === sourceEntry.source.head) {
        source = await observeSource(path, selected, sourceEntry.source.branch);
      }
    }
  }
  const request: CandidateDecisionRequest = {
    confirmed: options.confirmed ?? false,
    variance: options.variance ?? [],
    approveStandard: options.approveStandard ?? [],
    ...(source === undefined ? {} : { source }),
  };
  const actor: Executor = {
    operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
    originating_effort: identity.id,
    started_at: SYSTEM_CLOCK.wallNow(),
  };
  const attempts = new Map<string, AttemptIdentity>();
  const claims = new Map<string, QueueWorkClaim>();
  const refreshed = new Set<string>();
  const rows: AcceptancePrefix[] = [];
  let finalProof: Proof | undefined;
  let details = new Map<string, PublicCandidateAssessment>();
  const ancestry = createSourceAncestry(root);
  const assess = async (
    observation: CompletionObservation,
  ): Promise<ReadonlyMap<string, CandidateAssessment>> => {
    details = await assessLandingPrefix(
      observation,
      selected,
      (candidate) =>
        assessPublicCandidate({
          root,
          trunk,
          observation,
          candidate,
          context: "local",
          request,
          ancestry,
        }),
    );
    return new Map(
      [...details].map(([id, evaluated]) => [id, evaluated.assessment]),
    );
  };
  const planner = createQueuePlanner({
    root,
    trunk,
    executor: actor,
    transition_attempts: attempts,
    assess,
    ...(options.dryRun
      ? {
        preview: true,
        observation: () =>
          previewQueueAuthorities(
            root,
            trunk,
            request.confirmed ? source : undefined,
            source?.effort_id,
          ),
      }
      : {}),
  });
  let auditedLanding: {
    readonly record: LandingRecord;
    readonly observation: CompletionObservation;
  } | undefined;
  const runtime: QueueLandingRuntime = {
    root,
    mainRepo: root,
    trunk,
    converge: options.converge,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourceCheckout: (record) =>
      worktreePathForBranch(
        root,
        record.data.source.branch.slice("refs/heads/".length),
      ),
    audit: (record) =>
      Promise.resolve(
        auditedLanding !== undefined &&
          JSON.stringify(auditedLanding.record) === JSON.stringify(record)
          ? auditedLanding.observation
          : {
            kind: "stale-evidence" as const,
            evidence_ids: [],
            reason: "claim-lost" as const,
          },
      ),
  };
  try {
    let observation = await observeQueue(root, trunk);
    const unreadable = completionRecordBlocker(observation);
    if (unreadable !== undefined) {
      return queueAcceptanceResult(root, rows, [unreadable]);
    }
    const queue = observedRecords(observation).find((record) =>
      record.kind === "queue"
    );
    if (queue === undefined) {
      const authority = await inspectLandingAuthority(ctx.cwd, trunk, {
        includeScopeEvidence: true,
      });
      const missing = await queueAcceptanceResult(
        root,
        rows,
        [{ kind: "missing-evidence", requirements: [] }],
        undefined,
        options.dryRun,
        (await inspectAcceptanceCheckpoints(ctx.cwd, ctx.config)).drops,
      );
      return authority.warnings.length === 0 ? missing : {
        ...missing,
        message: `${missing.message ?? ""}\n\n${authority.warnings.join("\n")}`,
        data: { ...missing.data, authority_warnings: [...authority.warnings] },
      };
    }
    const requested = selected === "main" ? undefined : selected;

    // Recovery relies on the durable transition, never on another grant or a fresh validation.
    for (const recorded of observedRecords(observation)) {
      if (
        recorded.kind !== "landing" ||
        !await landingNeedsRecovery(root, recorded.data)
      ) continue;
      if (options.dryRun) continue;
      const attempt = observedRecords(observation).find((record) =>
        record.kind === "attempt" && record.id === recorded.data.attempt_id
      );
      if (
        attempt?.kind === "attempt" && attempt.data.state.kind === "claimed" &&
        attempt.data.state.claim.expires_at > observation.observed_at
      ) {
        return queueAcceptanceResult(root, rows, [{
          kind: "waiting-for-operation",
          attempt_id: attempt.id,
          expires_at: attempt.data.state.claim.expires_at,
        }]);
      }
      ctx.log.info(
        `Recovering the recorded landing for ${recorded.data.source.branch}.`,
      );
      const recovered = await recoverQueueLanding(runtime, recorded.id);
      if ("kind" in recovered) {
        return queueAcceptanceResult(root, rows, [recovered]);
      }
      if (recovered.outcome.kind === "recovery") {
        return queueAcceptanceResult(root, rows, [{
          kind: "recovery-incomplete",
          record_id: recorded.id,
          recovery: recovered.outcome.recovery,
        }]);
      }
    }
    if (!options.dryRun) {
      const recoveryRecords = observedRecords(await observeQueue(root, trunk));
      for (const landing of recoveryRecords) {
        if (
          landing.kind !== "landing" ||
          landing.data.outcome.kind !== "landed" ||
          recoveryRecords.some((record) =>
              record.kind === "retirement" &&
              record.data.landing_id === landing.id &&
              record.data.outcome.kind === "retired"
            ) && (await readLandingConvergenceResult(root, landing.data))?.ok
        ) continue;
        const plan = planQueueRetirement(landing, recoveryRecords);
        // Retention owned by another effort is not an effect of this acceptance. Keep a
        // requested landing and real recovery visible without relaying every
        // earlier owner's held checkout as part of the current result.
        if (
          requested !== undefined && plan.kind === "settled" &&
          plan.outcome.kind === "retained" &&
          landing.data.source.effort_id !== requested &&
          !recoveryRecords.some((record) =>
            record.kind === "retirement" &&
            record.data.landing_id === landing.id &&
            (record.data.outcome.kind === "pending" ||
              record.data.outcome.kind === "recovery")
          ) &&
          (await readLandingConvergenceResult(root, landing.data))?.ok
        ) continue;
        const retirement = await retireQueueLanding({
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          root,
          trunk,
          config: ctx.config,
          executor: actor,
          log: ctx.log,
        }, landing);
        rows.push({
          effort: landing.data.source.effort_id,
          branch: landing.data.source.branch,
          source_head: landing.data.source.head,
          candidate_id: landing.data.candidate_id,
          expected_trunk: landing.data.expected_trunk,
          target: landing.data.target,
          state: "landed",
          landing_id: landing.id,
          note: landing.data.note,
          authority_id: landing.data.claim.kind === "normal"
            ? landing.data.claim.authority_id
            : null,
          authority_settlement: landing.data.authority_settlement,
          retirement: retirement.kind === "retired"
            ? "retired"
            : retirement.kind === "recovery"
            ? "recovery"
            : "retained",
          pending: [],
          ...(retirement.kind === "retained"
            ? { retirement_reason: retirement.reason }
            : retirement.kind === "recovery"
            ? { retirement_reason: retirement.recovery.reason }
            : {}),
        });
        finalProof = landing.data.claim.kind === "normal"
          ? await readLandingProof(runtime, landing)
          : undefined;
      }
    }
    const recoveredResult = await queueAcceptanceResult(
      root,
      rows,
      [],
      finalProof,
      options.dryRun,
    );
    if (!recoveredResult.ok) return recoveredResult;
    if (requested === undefined) {
      return queueAcceptanceResult(root, rows, [], finalProof, options.dryRun);
    }
    while (true) {
      if (options.signal?.aborted) {
        return queueAcceptanceResult(root, rows, [{
          kind: "cancelled",
          reason:
            "Acceptance was cancelled. Recorded landings remain settled; retry from the main checkout to inspect and finish pending work.",
        }], finalProof);
      }
      if (!options.dryRun) {
        const current = await requireQueue(root);
        observation = await observeQueue(root, trunk);
        if (current.record.data.trunk !== observation.trunk) {
          const changed = await mutateQueue({
            root,
            trunk,
            expected_stamp: current.stamp,
            mutation: { kind: "trunk-moved" },
          });
          if (changed.kind !== "changed") {
            return queueAcceptanceResult(root, rows, [{
              kind: "stale-evidence",
              evidence_ids: [],
              reason: "external-trunk",
            }], finalProof);
          }
        }
        await synchronizeQueueAuthorities(
          root,
          trunk,
          request.confirmed ? source : undefined,
          requested,
        );
      }
      observation = await planner.observe();
      const queue = observedRecords(observation).find((record) =>
        record.kind === "queue"
      );
      if (queue === undefined) {
        throw new Error("The observed queue is unavailable.");
      }
      const current = { record: queue };
      const ordered = orderedEntries(current.record.data);
      const target = current.record.data.entries.find((entry) =>
        entry.source.effort_id === requested
      );
      if (target?.state === "landed") {
        if (rows.length === 0) {
          const landing = observedRecords(observation).find((
            record,
          ): record is LandingRecord =>
            record.kind === "landing" &&
            sameSource(record.data.source, target.source) &&
            record.data.outcome.kind === "landed"
          );
          if (landing !== undefined) {
            rows.push({
              effort: target.source.effort_id,
              branch: target.source.branch,
              source_head: target.source.head,
              candidate_id: landing.data.candidate_id,
              expected_trunk: landing.data.expected_trunk,
              target: landing.data.target,
              state: "landed",
              landing_id: landing.id,
              note: landing.data.note,
              authority_id: landing.data.claim.kind === "normal"
                ? landing.data.claim.authority_id
                : null,
              authority_settlement: landing.data.authority_settlement,
              retirement: "retained",
              pending: [],
            });
            finalProof = landing.data.claim.kind === "normal"
              ? await readLandingProof(runtime, landing)
              : undefined;
          }
        }
        return queueAcceptanceResult(
          root,
          rows,
          [],
          finalProof,
          options.dryRun,
        );
      }
      if (target === undefined) {
        return queueAcceptanceResult(
          root,
          rows,
          [{ kind: "missing-evidence", requirements: [] }],
          finalProof,
          options.dryRun,
        );
      }
      if (target.held || target.state === "withdrawn") {
        return queueAcceptanceResult(
          root,
          [
            ...rows,
            acceptancePrefix(
              target,
              target.candidate_id === null
                ? undefined
                : details.get(target.candidate_id),
            ),
          ],
          [{
            kind: "missing-judgment",
            subjects: [
              target.held
                ? QUEUE_DECISION_SUBJECT["effort-held"]
                : QUEUE_DECISION_SUBJECT["effort-withdrawn"],
            ],
          }],
          finalProof,
          options.dryRun,
        );
      }
      const entry = ordered[0];
      if (entry === undefined) {
        return queueAcceptanceResult(
          root,
          rows,
          [{ kind: "missing-authority", sources: [target.source] }],
          finalProof,
          options.dryRun,
        );
      }
      const evaluated = entry.candidate_id === null
        ? undefined
        : details.get(entry.candidate_id);
      const assessment = evaluated?.assessment;
      const row = acceptancePrefix(entry, evaluated);
      if (options.dryRun) {
        rows.push(row);
        for (const peer of ordered.slice(1, ordered.indexOf(target) + 1)) {
          rows.push(
            acceptancePrefix(
              peer,
              peer.candidate_id === null
                ? undefined
                : details.get(peer.candidate_id),
            ),
          );
        }
        const plan = planner.plan(
          observation,
          ctx.config.completion,
          requested,
        );
        for (let index = 0; index < rows.length; index++) {
          const item = rows[index];
          if (item === undefined) continue;
          const action = plan.actions.find((action) =>
            action.kind === "ready"
              ? action.candidate_id === item.candidate_id
              : action.kind === "validate"
              ? action.plan.candidate_id === item.candidate_id
              : action.kind === "compose" &&
                action.source.effort_id === item.effort
          );
          rows[index] = {
            ...item,
            state: action?.kind === "ready" ? "ready" : "pending",
            planned_action:
              action?.kind === "ready" || action?.kind === "compose" ||
                action?.kind === "validate"
                ? action.kind
                : "blocked",
            planned_producers: action?.kind === "validate"
              ? action.plan.producers.map((producer) => producer.selector)
              : [],
          };
        }
        // The preview lists the whole queue — the same ordered list status
        // shows: efforts behind the selected one and held efforts appear in
        // place, each with the single reason it waits.
        const present = new Map(rows.map((item) => [item.effort, item]));
        const merged: AcceptancePrefix[] = [];
        for (
          const listed of orderedEntries(current.record.data, {
            includeHeld: true,
          })
        ) {
          const existing = present.get(listed.source.effort_id);
          if (existing !== undefined) {
            merged.push(existing);
            continue;
          }
          const facts = await queueRowFacts(
            root,
            () => Promise.resolve(observation),
            listed,
            trunk,
            current.record.data.entries,
          );
          const readiness = queueEntryReadiness(listed, facts);
          merged.push({
            ...acceptancePrefix(
              listed,
              listed.candidate_id === null
                ? undefined
                : details.get(listed.candidate_id),
            ),
            pending: readiness.reason === undefined ? [] : [{
              kind: facts.onTrunk
                ? "already-on-trunk"
                : listed.held === true
                ? QUEUE_DECISION_SUBJECT["effort-held"]
                : "queued",
              reason: readiness.reason,
            }],
          });
        }
        rows.length = 0;
        rows.push(...merged);
        const work = plan.actions.find((action) =>
          action.kind === "compose" || action.kind === "validate"
        );
        const pending = plan.blockers.length > 0
          ? plan.blockers
          : work === undefined
          ? []
          : [{
            kind: "missing-evidence" as const,
            requirements:
              work.kind === "validate" && work.plan.demand.kind === "done"
                ? work.plan.demand.requirements
                : [],
          }];
        return queueAcceptanceResult(root, rows, pending, undefined, true);
      }
      let claimedPlan: QueuePlan | undefined;
      if (
        entry.invalidation === null &&
        assessment?.candidate.expected_predecessor.head === observation.trunk &&
        assessment.proof !== null && assessment.blockers.length === 0 &&
        entry.candidate_id !== null && !claims.has(entry.candidate_id)
      ) {
        if (options.signal?.aborted) {
          return queueAcceptanceResult(root, rows, [{
            kind: "cancelled",
            reason: "Acceptance was cancelled before claiming publication.",
          }], finalProof);
        }
        const claimed = await claimAssessedLanding({
          root,
          trunk,
          observation,
          policy: ctx.config.completion,
          effort: requested,
          assessments: new Map(
            [...details].map(([id, value]) => [id, value.assessment]),
          ),
          executor: actor,
          lease_ms: 60_000,
        });
        if ("kind" in claimed) {
          return queueAcceptanceResult(
            root,
            [...rows, row],
            [claimed],
            finalProof,
          );
        }
        const { claim } = claimed;
        claims.set(entry.candidate_id, claim);
        attempts.set(entry.candidate_id, claim.attempt.identity);
        observation = claimed.observation;
        claimedPlan = claimed.plan;
      }

      emitCompletionProgress({
        phase: "queue",
        state: "planning",
        candidate_id: entry.candidate_id,
        reason:
          `Checking the next effort in the queue: ${entry.source.branch}.`,
      });
      const plan = claimedPlan ??
        planner.plan(observation, ctx.config.completion, requested);
      const action = plan.actions[0];
      if (action?.kind === "compose" || action?.kind === "validate") {
        const selected = action.kind === "compose"
          ? {
            environment_id: action.environment_id,
            expected_stamp: action.expected_stamp,
          }
          : {
            environment_id: action.environment.environment_id,
            expected_stamp: action.environment.expected_stamp,
          };
        const refreshKey =
          `${entry.source.head}:${observation.trunk}:${entry.candidate_id}`;
        if (selected.expected_stamp === null || refreshed.has(refreshKey)) {
          return queueAcceptanceResult(root, [...rows, row], [{
            kind: "missing-evidence",
            requirements: action.kind === "validate"
              ? action.plan.demand.kind === "done"
                ? action.plan.demand.requirements
                : []
              : [],
          }], finalProof);
        }
        const environment = await requireEnvironment(
          root,
          selected.environment_id,
        );
        if (
          environment.stamp !== selected.expected_stamp ||
          environment.record.data.release.kind !== "released"
        ) {
          return queueAcceptanceResult(root, [...rows, row], [{
            kind: "environment-unavailable",
            reason:
              "The planned environment release changed before validation.",
          }], finalProof);
        }
        refreshed.add(refreshKey);
        ctx.log.info(
          `Refreshing ${entry.source.branch} in its released environment before acceptance.`,
        );
        emitCompletionProgress({
          phase: "environment",
          state: "refreshing",
          candidate_id: entry.candidate_id,
          reason:
            `Validating ${entry.source.branch} in its released environment.`,
        });
        const { finishResult } = await loadModule(() =>
          import("../gate/finish.ts")
        );
        const validation = await finishResult(environment.record.data.path, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          surface: options.validationSurface,
          cliModel: options.cliModel,
          execution: {
            source: entry.source,
            executor: actor,
            released: {
              environment_id: selected.environment_id,
              expected_stamp: selected.expected_stamp,
            },
          },
        });
        if (!validation.ok) {
          const reasons = validation.data?.completion?.pending_reasons ??
            [validation.message ?? "Validation is incomplete."];
          const blockers: readonly AcceptancePending[] =
            validation.data?.completion?.pending ?? (
              validation.error === "awaiting_declaration" ||
                validation.error === "checkpoint_evidence_unavailable"
                ? [{ kind: "missing-judgment", subjects: reasons }]
                : validation.data?.gate_ran &&
                    validation.data.failed_stage !== null
                ? [{ kind: "validation-failed", evidence_ids: [] }]
                : [{
                  kind: "environment-unavailable",
                  reason: reasons.join("; "),
                }]
            );
          return queueAcceptanceResult(
            root,
            [...rows, { ...row, pending: blockers.map(acceptancePending) }],
            blockers,
            finalProof,
          );
        }
        continue;
      }
      if (action?.kind !== "land") {
        const observedBlockers = [
          ...plan.blockers,
          ...assessment?.blockers ?? [],
        ];
        const blockers = observedBlockers.length ? observedBlockers : [{
          kind: "environment-unavailable" as const,
          reason:
            "Current evidence requires validation in the released environment before this effort can land.",
        }];
        rows.push({
          ...row,
          pending: blockers.map((blocker) => {
            const detail = acceptancePending(blocker);
            return detail.kind === "missing-authority"
              ? row.pending.find((item) => item.kind === detail.kind) ?? detail
              : detail;
          }),
        });
        return queueAcceptanceResult(root, rows, blockers, finalProof);
      }
      const claim = claims.get(action.record.data.candidate_id);
      if (claim === undefined) {
        throw new Error("The active actor has no claim for this transition.");
      }
      ctx.log.info(
        `Accepting ${entry.source.branch}: ${
          action.record.data.expected_trunk.slice(0, 12)
        } → ${action.record.data.target.slice(0, 12)}.`,
      );
      auditedLanding = { record: action.record, observation };
      const landed = await publishQueueLanding(
        runtime,
        action.record,
        action.expected_stamp,
        claim.fence,
      );
      if ("kind" in landed) {
        await withQueueLock(
          root,
          () => cancelQueueClaim(root, claim),
        );
        return queueAcceptanceResult(root, [...rows, {
          ...row,
          pending: [acceptancePending(landed)],
        }], [
          landed,
        ], finalProof);
      }
      // Observe each newly established transition before its source can retire.
      // The retained review supplies fingerprints even after checkout loss.
      if (
        !landingAdvanced(action.record) &&
        landingAdvanced({ ...action.record, data: landed })
      ) {
        const stored = evaluated?.review?.stored;
        observeCheckpointActivity({
          variances: landed.claim.kind === "normal"
            ? landed.claim.decisions.variances.map((variance) => ({
              id: variance.checkpoint,
              definition: variance.definition_hash,
              subject: variance.subject,
            }))
            : [],
          abandoned: stored?.status === "ok"
            ? Object.values(stored.openQuestions)
              .filter((question) => !declarationIsCurrent(question))
              .map((question) => ({ id: question.checkpoint }))
              .sort((left, right) => left.id.localeCompare(right.id))
            : [],
        });
      }
      rows.push({
        ...row,
        state: landingAdvanced({ ...action.record, data: landed })
          ? "landed"
          : "pending",
        landing_id: action.record.id,
        note: landed.note,
        authority_settlement: landed.authority_settlement,
      });
      if (landed.outcome.kind === "recovery") {
        return queueAcceptanceResult(root, rows, [{
          kind: "recovery-incomplete",
          record_id: action.record.id,
          recovery: landed.outcome.recovery,
        }], finalProof);
      }
      if (landed.outcome.kind !== "landed") {
        return queueAcceptanceResult(root, rows, [{
          kind: "environment-unavailable",
          reason: landed.outcome.kind === "not-landed"
            ? landed.outcome.reason
            : "The exact ref transition is not established. Preserve the recorded claim for recovery.",
        }], finalProof);
      }
      finalProof = await readLandingProof(runtime, {
        ...action.record,
        data: landed,
      });
      const converged = await queueAcceptanceResult(root, rows, [], finalProof);
      if (options.signal?.aborted) return converged;
      const retirement = await retireQueueLanding({
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        root,
        trunk,
        config: ctx.config,
        executor: actor,
        log: ctx.log,
      }, { ...action.record, data: landed });
      const last = rows.at(-1);
      if (last !== undefined) {
        last.retirement = retirement.kind === "retired"
          ? "retired"
          : retirement.kind === "recovery"
          ? "recovery"
          : "retained";
        if (retirement.kind === "retained") {
          last.retirement_reason = retirement.reason;
        }
        if (retirement.kind === "recovery") {
          last.retirement_reason = retirement.recovery.reason;
        }
      }
      const completed = await queueAcceptanceResult(root, rows, [], finalProof);
      if (!completed.ok) return completed;
    }
  } catch (error) {
    if (error instanceof OperationLockError) {
      return queueAcceptanceResult(root, rows, [{
        kind: "environment-unavailable",
        reason: error.message,
      }], finalProof);
    }
    throw error;
  } finally {
    if (claims.size > 0) {
      await withQueueLock(root, async () => {
        const records = observedRecords(await observeQueue(root, trunk));
        for (const claim of claims.values()) {
          const attempt = records.find((record) =>
            record.kind === "attempt" && record.id === claim.attempt.identity.id
          );
          if (
            attempt?.kind !== "attempt" ||
            attempt.data.state.kind === "finished" || records.some((record) =>
              record.kind === "landing" && record.data.attempt_id === attempt.id
            )
          ) {
            continue;
          }
          await cancelQueueClaim(root, claim);
        }
      });
    }
  }
}
