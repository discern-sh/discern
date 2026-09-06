import { readCompletionRecord } from "../completion/store.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import { evaluateResultCompletion } from "../../shared/result_completion.ts";
import {
  fire,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../../shared/hints.ts";
/** An active accept actor advances one audited, separately authorized prefix at a time. */
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptData, Proof } from "../../shared/result_schemas.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import {
  integrationBranch,
  mainRepoPath,
  worktreePathForBranch,
} from "../worktree/git.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import type {
  CompletionBlocker,
  CompletionObservation,
} from "../completion/protocol.ts";
import type {
  AttemptIdentity,
  Executor,
  SourceRevision,
} from "../completion/identity.ts";
import {
  observedRecords,
  observeQueue,
  requireQueue,
  withQueueLock,
} from "./repository.ts";
import { orderedEntries, type QueueEntry, sameSource } from "./model.ts";
import { mutateQueue } from "./mutations.ts";
import { synchronizeQueueAuthorities } from "./public_authority.ts";
import {
  assessPublicCandidate,
  type CandidateDecisionRequest,
  type PublicCandidateAssessment,
} from "./public_assessment.ts";
import { type CandidateAssessment, createQueuePlanner } from "./planner.ts";
import {
  claimLandingAttempt,
  type QueueWorkClaim,
  settleQueueClaim,
} from "./claims.ts";
import {
  type LandingRecord,
  publishQueueLanding,
  type QueueLandingRuntime,
  readLandingNoteResult,
  readLandingProof,
  recoverQueueLanding,
} from "./publication.ts";
import { OperationLockError } from "../operation_lock.ts";
import { retireQueueLanding } from "./retirement.ts";
import { observeSource } from "./composition.ts";

type PrefixRow = NonNullable<AcceptData["queue"]>[number];
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import { requireEnvironment } from "../execution/registry.ts";
import {
  type CheckpointDrop,
  uniqueCheckpointDrops,
} from "../../shared/checkpoint_drops.ts";
import { inspectAcceptanceCheckpoints } from "../worktree/acceptance_checkpoints.ts";
import { checkpointServingText } from "../checkpoints/serving_text.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";

export interface PublicAcceptOptions {
  readonly cliModel: CliModelProvider;
  readonly dryRun?: boolean;
  readonly confirmed?: boolean;
  readonly variance?: string[];
  readonly approveStandard?: string[];
}

/** Preserve the exact pending dimension alongside every earlier completed transition. */
type Pending = CompletionBlocker | NonNullable<AcceptData["pending"]>[number];
/** Keep the semantic pending kind and its explanation in every public projection. */
function pending(blocker: Pending): { kind: string; reason: string } {
  return {
    kind: blocker.kind,
    reason: "reason" in blocker ? blocker.reason : JSON.stringify(blocker),
  };
}
/** The same per-predecessor evidence appears in a preview and an active stop. */
function prefixRow(
  entry: QueueEntry,
  evaluated?: PublicCandidateAssessment,
): PrefixRow {
  const assessment = evaluated?.assessment;
  return {
    effort: entry.source.effort_id,
    branch: entry.source.branch,
    source_head: entry.source.head,
    candidate_id: entry.candidate_id,
    expected_trunk: assessment?.candidate.expected_predecessor.head ?? null,
    target: assessment?.candidate.head ?? null,
    state: assessment?.proof !== undefined && assessment.proof !== null &&
        assessment.blockers.length === 0
      ? "ready"
      : "pending",
    authority_id: entry.authority_id,
    retirement: "retained",
    preview_actions: evaluated?.preview_actions ?? [],
    approval_requests: [...evaluated?.approval_requests ?? []],
    ...((evaluated?.review?.checkpoints === undefined ||
        evaluated.review.checkpoints === null)
      ? {}
      : { checkpoint_review: evaluated.review.checkpoints }),
    pending: assessment?.blockers.map(pending) ?? [],
  };
}

/** A grant refusal must not hide the owner's separately pending variance decision. */
function pendingReviewText(rows: readonly PrefixRow[]): string {
  return rows.filter((row) => row.state !== "landed").flatMap((row) =>
    (row.checkpoint_review?.declared_unmet ?? []).map((question) => {
      const evidence = checkpointServingText({
        matched: question.matched ?? [],
        related: (question.related ?? []).map((path) => ({
          ...path,
          forPath: path.for_path,
        })),
        ...(question.question_file === undefined
          ? {}
          : { questionFile: question.question_file }),
        ...(question.teach === undefined ? {} : { teach: question.teach }),
        ...(question.reference === undefined
          ? {}
          : { reference: question.reference }),
      });
      return [
        `Variance required for ${markdownCodeSpan(row.branch)}: ${
          markdownCodeSpan(question.id)
        }`,
        `Changed: ${evidence.matched}`,
        ...evidence.related,
        `Question: ${question.question}`,
        ...(evidence.questionSource === undefined
          ? []
          : [evidence.questionSource]),
        ...evidence.notes,
        `Declared unmet: ${question.why}`,
      ].join("\n");
    })
  ).join("\n\n");
}

/** Project prefix outcomes without losing independently pending decisions. */
async function result(
  root: string,
  rows: PrefixRow[],
  blockers: readonly Pending[],
  proof?: Proof,
  dryRun = false,
  checkpointDrops: readonly CheckpointDrop[] = [],
): Promise<DiscernResult<AcceptData>> {
  const noteHints: string[] = [];
  for (const row of rows) {
    if (row.landing_id === undefined) continue;
    try {
      const landing = await readCompletionRecord(root, {
        kind: "landing",
        id: row.landing_id,
      });
      if (landing.kind !== "recorded" || landing.record.kind !== "landing") {
        continue;
      }
      const note = await readLandingNoteResult(root, landing.record.data);
      if (note === undefined) continue;
      if (note.proof_note !== undefined) row.proof_note = note.proof_note;
      const reason = note.reason ?? note.proof_note?.write.reason;
      if (reason !== undefined) row.note_reason = reason;
      noteHints.push(...note.hints);
    } catch (error) {
      row.note_reason = `Retained note diagnostics are unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`;
      noteHints.push(...hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Preserve the common landing record and restore its note-diagnostic artifact; landing itself does not need to repeat.",
        }),
      ]));
    }
  }
  for (const blocker of blockers) {
    emitCompletionProgress({
      phase: "pending",
      state: blocker.kind,
      candidate_id: rows.at(-1)?.candidate_id ?? null,
      reason: pending(blocker).reason,
    });
  }
  const landed = rows.filter((row) => row.state === "landed").length;
  const authority = blockers.some((blocker) =>
    blocker.kind === "missing-authority"
  );
  const fields = {
    verb: "accept",
    ...(dryRun ? { dry_run: true as const } : {}),
    message:
      (dryRun
        ? "Read-only queue preview; each prefix has its own evidence and authority."
        : `${landed} prefix${landed === 1 ? "" : "es"} landed.${
          blockers.length
            ? " Acceptance is pending: " + blockers.map((blocker) =>
              pending(blocker).reason
            ).join("; ")
            : ""
        }`) +
      (pendingReviewText(rows) === "" ? "" : `\n\n${pendingReviewText(rows)}`),
    data: {
      root,
      queue: rows,
      checkpoint_drops: uniqueCheckpointDrops([
        ...checkpointDrops,
        ...rows.flatMap((row) => row.checkpoint_review?.drops ?? []),
      ]),
      ...(rows.length === 1 && rows[0]?.proof_note !== undefined
        ? { proof_note: rows[0].proof_note }
        : {}),
      pending: blockers.map(pending),
      ...(proof === undefined
        ? {}
        : { proof: proof.markdown, proof_line: proof.line }),
    },
    hints: mergeHintTexts(
      noteHints,
      blockers.length === 0 ? [] : hintTexts([
        authority
          ? fire(HINTS["accept-awaiting-confirmation"])
          : fire(HINTS["completion-pending"], {
            action:
              "Resolve the named pending condition, then run discern accept again. Earlier landed prefixes and spent authority remain in common recovery records.",
          }),
      ]),
    ),
  };
  const evaluated = evaluateResultCompletion<AcceptData>(
    dryRun || blockers.length === 0 ? { ok: true, ...fields } : {
      ok: false,
      ...fields,
      error: landed > 0
        ? "partial_acceptance"
        : authority
        ? "awaiting_consent"
        : "incomplete",
    },
  );
  return evaluated.ok || hasRegisteredActionableHint(evaluated.hints)
    ? evaluated
    : {
      ...evaluated,
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Resolve the named pending condition, then run discern accept again; preserve every recorded landing.",
        }),
      ]),
    };
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
  const rows: PrefixRow[] = [];
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
      return result(root, rows, [{
        kind: "environment-unavailable",
        reason:
          `Completion ${unreadable.selector.kind}/${unreadable.selector.id} is ${unreadable.reading.kind}; preserve it for recovery.`,
      }]);
    }
    const queue = observedRecords(observation).find((record) =>
      record.kind === "queue"
    );
    if (queue === undefined) {
      return result(
        root,
        rows,
        [{ kind: "missing-evidence", requirements: [] }],
        undefined,
        options.dryRun,
        (await inspectAcceptanceCheckpoints(ctx.cwd, ctx.config)).drops,
      );
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
          recorded.data.note === "published")
      ) continue;
      if (options.dryRun) continue;
      const attempt = observedRecords(observation).find((record) =>
        record.kind === "attempt" && record.id === recorded.data.attempt_id
      );
      if (
        attempt?.kind === "attempt" && attempt.data.state.kind === "claimed" &&
        attempt.data.state.claim.expires_at > observation.observed_at
      ) {
        return result(root, rows, [{
          kind: "waiting-for-operation",
          attempt_id: attempt.id,
          expires_at: attempt.data.state.claim.expires_at,
        }]);
      }
      ctx.log.info(
        `Recovering the recorded landing for ${recorded.data.source.branch}.`,
      );
      const recovered = await recoverQueueLanding(runtime, recorded.id);
      if ("kind" in recovered) return result(root, rows, [recovered]);
      if (recovered.outcome.kind === "recovery") {
        return result(root, rows, [{
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
          )
        ) continue;
        const retirement = await retireQueueLanding({
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
        finalProof = await readLandingProof(runtime, landing);
      }
    }
    if (requested === undefined) {
      return result(root, rows, [], finalProof, options.dryRun);
    }
    while (true) {
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
            return result(root, rows, [{
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
            finalProof = await readLandingProof(runtime, landing);
          }
        }
        return result(root, rows, [], finalProof, options.dryRun);
      }
      if (target === undefined) {
        return result(
          root,
          rows,
          [{ kind: "missing-evidence", requirements: [] }],
          finalProof,
          options.dryRun,
        );
      }
      const entry = ordered[0];
      if (entry === undefined) {
        return result(
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
      const row = prefixRow(entry, evaluated);
      if (options.dryRun) {
        rows.push(row);
        for (const peer of ordered.slice(1, ordered.indexOf(target) + 1)) {
          rows.push(
            prefixRow(
              peer,
              peer.candidate_id === null
                ? undefined
                : details.get(peer.candidate_id),
            ),
          );
        }
        return result(root, rows, [], undefined, true);
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
          return result(root, [...rows, row], [claim], finalProof);
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
          return result(root, [...rows, row], [{
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
          return result(root, [...rows, row], [{
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
        const { finishResult } = await import("../gate/finish.ts");
        const validation = await finishResult(environment.record.data.path, {
          surface: { kind: "quiet" },
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
          const blockers: readonly Pending[] =
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
          return result(
            root,
            [...rows, { ...row, pending: blockers.map(pending) }],
            blockers,
            finalProof,
          );
        }
        continue;
      }
      if (action?.kind !== "land") {
        const blockers = plan.blockers.length ? plan.blockers : [{
          kind: "environment-unavailable" as const,
          reason:
            "Current evidence requires validation in the released environment before this prefix can advance.",
        }];
        rows.push({ ...row, pending: blockers.map(pending) });
        return result(root, rows, blockers, finalProof);
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
        return result(root, [...rows, { ...row, pending: [pending(landed)] }], [
          landed,
        ], finalProof);
      }
      rows.push({
        ...row,
        state: landed.outcome.kind === "landed" ? "landed" : "pending",
        landing_id: action.record.id,
        note: landed.note,
        authority_settlement: landed.authority_settlement,
      });
      if (landed.outcome.kind === "recovery") {
        return result(root, rows, [{
          kind: "recovery-incomplete",
          record_id: action.record.id,
          recovery: landed.outcome.recovery,
        }], finalProof);
      }
      if (landed.outcome.kind !== "landed") {
        return result(root, rows, [{
          kind: "stale-evidence",
          evidence_ids: [],
          reason: "claim-lost",
        }], finalProof);
      }
      finalProof = await readLandingProof(runtime, {
        ...action.record,
        data: landed,
      });
      const retirement = await retireQueueLanding({
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
    }
  } catch (error) {
    if (error instanceof OperationLockError) {
      return result(root, rows, [{
        kind: "environment-unavailable",
        reason: error.message,
      }], finalProof);
    }
    throw error;
  }
}
