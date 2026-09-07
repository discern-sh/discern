/** An active accept actor advances one audited, separately authorized prefix at a time. */
import { loadModule } from "../../shared/module_loading.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import { landingAdvanced } from "../completion/records.ts";
import type { FinishResultSurface } from "../gate/finish.ts";
import { inspectLandingAuthority } from "../worktree/landing_authority.ts";
import {
  type LandingConverger,
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
import type { CompletionObservation } from "../completion/protocol.ts";
import { requireEnvironment } from "../execution/registry.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { OperationLockError } from "../operation_lock.ts";
import { inspectAcceptanceCheckpoints } from "../worktree/acceptance_checkpoints.ts";
import {
  integrationBranch,
  mainRepoPath,
  worktreePathForBranch,
} from "../worktree/git.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import {
  claimLandingAttempt,
  type QueueWorkClaim,
  settleQueueClaim,
} from "./claims.ts";
import { observeSource } from "./composition.ts";
import { orderedEntries, sameSource } from "./model.ts";
import { mutateQueue } from "./mutations.ts";
import { type CandidateAssessment, createQueuePlanner } from "./planner.ts";
import {
  assessPublicCandidate,
  type CandidateDecisionRequest,
  type PublicCandidateAssessment,
} from "./public_assessment.ts";
import { synchronizeQueueAuthorities } from "./public_authority.ts";
import {
  type AcceptancePending,
  acceptancePending,
  type AcceptancePrefix,
  acceptancePrefix,
  queueAcceptanceResult,
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
import { retireQueueLanding } from "./retirement.ts";

export interface PublicAcceptOptions {
  readonly validationSurface: FinishResultSurface;
  readonly signal?: AbortSignal;
  readonly cliModel: CliModelProvider;
  readonly converge: LandingConverger;
  readonly dryRun?: boolean;
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
  const sourceEntry = observedRecords(await observeQueue(root, trunk)).find(
    (record) => record.kind === "queue",
  )?.data.entries.find((entry) => entry.source.effort_id === identity.id);
  let source: SourceRevision | undefined;
  if (sourceEntry !== undefined) {
    const pin = await pinValidatedTree(ctx.cwd);
    if (pin.clean && pin.head === sourceEntry.source.head) {
      source = await observeSource(
        ctx.cwd,
        identity.id,
        sourceEntry.source.branch,
      );
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
  const details = new Map<string, PublicCandidateAssessment>();
  const assess = async (
    observation: CompletionObservation,
  ): Promise<ReadonlyMap<string, CandidateAssessment>> => {
    const assessments = new Map<string, CandidateAssessment>();
    for (const candidate of observedRecords(observation)) {
      if (candidate.kind !== "candidate") continue;
      const queue = observedRecords(observation).find((record) =>
        record.kind === "queue"
      );
      if (
        !queue?.data.entries.some((entry) =>
          entry.candidate_id === candidate.id && entry.state !== "landed" &&
          entry.state !== "withdrawn"
        )
      ) continue;
      const evaluated = await assessPublicCandidate({
        root,
        trunk,
        observation,
        candidate,
        context: "local",
        request,
      });
      details.set(candidate.id, evaluated);
      assessments.set(candidate.id, evaluated.assessment);
    }
    return assessments;
  };
  const planner = createQueuePlanner({
    root,
    trunk,
    executor: actor,
    transition_attempts: attempts,
    assess,
  });
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
    audit: async (record) => {
      const observation = await planner.observe();
      const planned = planner.plan(
        observation,
        ctx.config.completion,
        record.data.source.effort_id,
      );
      const current = planned.actions[0];
      if (
        current?.kind !== "land" || current.record.id !== record.id ||
        JSON.stringify(current.record.data) !== JSON.stringify(record.data)
      ) {
        return planned.blockers[0] ??
          { kind: "stale-evidence", evidence_ids: [], reason: "claim-lost" };
      }
      return observation;
    },
  };
  try {
    let observation = await observeQueue(root, trunk);
    const unreadable = observation.records.find((item) =>
      item.reading.kind !== "recorded" && item.reading.kind !== "missing"
    );
    if (unreadable !== undefined) {
      return queueAcceptanceResult(root, rows, [{
        kind: "environment-unavailable",
        reason:
          `Completion ${unreadable.selector.kind}/${unreadable.selector.id} is ${unreadable.reading.kind}; preserve it for recovery.`,
      }]);
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
    const requested = identity.id === "main"
      ? orderedEntries(queue.data).at(-1)?.source.effort_id
      : identity.id;

    // Recovery relies on the durable transition, never on another grant or a fresh validation.
    for (const recorded of observedRecords(observation)) {
      if (
        recorded.kind !== "landing" ||
        (recorded.data.outcome.kind === "not-landed") ||
        (recorded.data.outcome.kind === "landed" &&
          recorded.data.authority_settlement === "consumed" &&
          recorded.data.note === "published" &&
          (await readLandingConvergenceResult(root, recorded.data))?.ok)
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
        );
      }
      observation = await planner.observe();
      const current = await requireQueue(root);
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
        return queueAcceptanceResult(root, rows, [], undefined, true);
      }
      if (
        entry.invalidation === null &&
        assessment?.candidate.expected_predecessor.head === observation.trunk &&
        assessment.proof !== null && assessment.blockers.length === 0 &&
        entry.candidate_id !== null && !claims.has(entry.candidate_id)
      ) {
        const claim = await claimLandingAttempt({
          root,
          candidate_id: entry.candidate_id,
          executor: actor,
          lease_ms: 60_000,
        });
        if ("kind" in claim) {
          return queueAcceptanceResult(
            root,
            [...rows, row],
            [claim],
            finalProof,
          );
        }
        claims.set(entry.candidate_id, claim);
        attempts.set(entry.candidate_id, claim.attempt.identity);
        observation = await planner.observe();
      }
      emitCompletionProgress({
        phase: "queue",
        state: "planning",
        candidate_id: entry.candidate_id,
        reason:
          `Assessing the next separately authorized prefix: ${entry.source.branch}.`,
      });
      const plan = planner.plan(observation, ctx.config.completion, requested);
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
            "Current evidence requires validation in the released environment before this prefix can advance.",
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
      const landed = await publishQueueLanding(
        runtime,
        action.record,
        action.expected_stamp,
        claim.fence,
      );
      if ("kind" in landed) {
        await withQueueLock(
          root,
          () => settleQueueClaim(root, claim, "cancelled"),
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
          await settleQueueClaim(root, claim, "cancelled");
        }
      });
    }
  }
}
