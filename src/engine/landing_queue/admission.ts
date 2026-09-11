import { emitCompletionEvent } from "../completion/events.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Full machine assembly and queue admission publish under one short, current subject check. */
import type { Candidate } from "../completion/candidate.ts";
import type { Requirement } from "../completion/evidence.ts";
import type {
  CompletionBlocker,
  ProducerEvaluator,
} from "../completion/protocol.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { withQueueLock } from "./repository.ts";
import { checkQueueClaim, type QueueWorkClaim } from "./claims.ts";
import { approveBatch, expectedPredecessor } from "./model.ts";
import { gitValue } from "./composition.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  requireQueue,
} from "./repository.ts";

/** Assemble exact complete evidence and admit only the still-selected candidate. */
export async function publishAdmission(input: {
  readonly root: string;
  readonly trunk: string;
  readonly claim: QueueWorkClaim;
  readonly candidate: Candidate;
  readonly evaluator: ProducerEvaluator;
  readonly requirements: readonly Requirement[];
  readonly clock?: Clock;
  readonly mode?: "strict" | "report";
  readonly review?: import("../execution/types.ts").EnvironmentArtifact;
}): Promise<
  | { readonly kind: "admitted"; readonly proof_id: string }
  | CompletionBlocker
  | { readonly kind: "replan" }
> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  return await withQueueLock(input.root, async () => {
    if (
      !await checkQueueClaim(input.root, input.claim, input.candidate, clock)
    ) return { kind: "replan" };
    const observation = await observeQueue(input.root, input.trunk, clock);
    const current = await requireQueue(input.root);
    if (observation.trunk !== current.record.data.trunk) {
      return { kind: "replan" };
    }
    const records = observedRecords(observation);
    const candidates = new Map(
      records.filter((record) => record.kind === "candidate").map((
        record,
      ) => [record.id, record.data]),
    );
    const id = input.claim.attempt.identity.candidate_id;
    const candidate = candidates.get(id);
    if (
      candidate === undefined ||
      JSON.stringify(candidate) !== JSON.stringify(input.candidate)
    ) return { kind: "replan" };
    if (
      await gitValue(input.root, [
        "rev-parse",
        "--verify",
        candidate.source.branch,
      ]) !== candidate.source.head
    ) {
      return {
        kind: "stale-evidence",
        evidence_ids: [],
        reason: "source-replaced",
      };
    }
    const predecessor = expectedPredecessor(
      current.record.data,
      input.claim.effort,
      candidates,
    );
    const entry = current.record.data.entries.find((entry) =>
      entry.source.effort_id === input.claim.effort
    );
    // Ordinary author validation of a provisional (unapproved) effort is
    // built against the trunk — as its own source tip, or composed on the
    // trunk when the source fell behind — so admission accepts the trunk as
    // that entry's predecessor exactly as selection did. Eligible entries
    // still answer for their ordered predecessor.
    const authorTip = entry?.eligible_order === null &&
      candidate.expected_predecessor.head === current.record.data.trunk;
    if (
      !authorTip &&
      ("kind" in predecessor ||
        predecessor.head !== candidate.expected_predecessor.head)
    ) return { kind: "replan" };
    const assembly = input.evaluator.assemble(
      id,
      candidate,
      input.requirements,
      records,
      input.mode ?? "strict",
    );
    if (assembly.kind === "incomplete") {
      return assembly.blockers[0] ??
        { kind: "missing-evidence", requirements: input.requirements };
    }
    if (assembly.proof.attempt_id !== input.claim.fence.attempt_id) {
      return { kind: "replan" };
    }
    const proofId = input.claim.fence.attempt_id;
    const proof = await writeCompletionRecord(
      input.root,
      {
        version: ON_DISK_FORMATS.completionRecord.version,
        kind: "proof",
        id: proofId,
        revision: 1,
        data: {
          ...assembly.proof,
          ...(input.review === undefined ? {} : { review: input.review }),
        },
      },
      null,
      input.claim.fence,
      clock,
    );
    if (proof.kind !== "written") return { kind: "replan" };
    // A source that already sits at the trunk head — the trunk checkout
    // checking itself, or a retained checkout re-validating after its landing
    // — has nothing to land. Its Proof and evidence are recorded like any
    // other; its entry settles as a finished cycle instead of taking a
    // provisional place the owner would only be told to withdraw.
    const atTrunkHead = candidate.head === candidate.source.head &&
      candidate.source.head === current.record.data.trunk;
    let next = {
      ...current.record.data,
      entries: current.record.data.entries.map((entry) =>
        entry.source.effort_id !== input.claim.effort ? entry : {
          ...entry,
          state: atTrunkHead
            ? "landed" as const
            : entry.eligible_order === null
            ? "provisional" as const
            : "eligible" as const,
          invalidation: null,
        }
      ),
    };
    if (
      !atTrunkHead &&
      entry?.authority_id !== null && entry?.authority_id !== undefined &&
      entry.eligible_order === null && (input.mode ?? "strict") === "strict"
    ) {
      const promoted = approveBatch(
        next,
        proofId,
        new Map([[input.claim.effort, entry.authority_id]]),
        new Set([input.claim.effort]),
      );
      if (promoted.kind !== "changed") return promoted;
      next = promoted.queue;
    }
    const admitted = await replaceQueue(input.root, current, next, clock);
    if (admitted.kind !== "written") return { kind: "replan" };
    const attempt = await readCompletionRecord(input.root, {
      kind: "attempt",
      id: proofId,
    });
    if (attempt.kind !== "recorded" || attempt.record.kind !== "attempt") {
      return { kind: "replan" };
    }
    const settled = await writeCompletionRecord(
      input.root,
      {
        ...attempt.record,
        revision: attempt.record.revision + 1,
        data: {
          ...attempt.record.data,
          state: {
            kind: "finished",
            outcome: "passed",
            finished_at: clock.wallNow(),
          },
        },
      },
      attempt.stamp,
      input.claim.fence,
      clock,
    );
    if (settled.kind !== "written") return { kind: "replan" };
    emitCompletionEvent({
      id: `${proofId}:admitted`,
      at: clock.wallNow(),
      effort_id: candidate.source.effort_id,
      source_head: candidate.source.head,
      candidate_id: id,
      environment_id: null,
      attempt_id: proofId,
      executor_operation: input.claim.attempt.identity.executor.operation_id,
      fact: {
        kind: "admitted",
        proof_id: proofId,
        mode: assembly.proof.mode,
        eligible_prediction: assembly.proof.mode === "strict" &&
          next.entries.some((entry) =>
            entry.source.effort_id === input.claim.effort &&
            entry.eligible_order !== null
          ) &&
          candidate.expected_predecessor.candidate_id !== null,
        expected_predecessor_candidate_id:
          candidate.expected_predecessor.candidate_id,
      },
    });
    return { kind: "admitted", proof_id: proofId };
  });
}
