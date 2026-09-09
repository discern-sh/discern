import { applicableCandidateProof } from "./proof_matching.ts";
/** Observe externally integrated proven work without inventing a governed landing receipt. */
import type { CompletionRecord } from "../completion/records.ts";
import type {
  CompletionBlocker,
  CompletionObservation,
} from "../completion/protocol.ts";
import { completionRecordBlocker } from "../completion/compatibility.ts";
import { commitIsAncestorOf } from "../worktree/git.ts";
import { observeCandidateValidation } from "../validation/candidate_observation.ts";
import { observedRecords } from "./repository.ts";
import { sameSource } from "./model.ts";
import { runGit } from "../../shared/subprocess.ts";

export type ExternalIntegrationRecord = Extract<
  CompletionRecord,
  { kind: "integration" }
>;
export interface ObservedExternalIntegration {
  readonly candidate: Extract<CompletionRecord, { kind: "candidate" }>;
  readonly proof: Extract<CompletionRecord, { kind: "proof" }>;
  readonly existing?: ExternalIntegrationRecord;
}

/** A fresh fork has no proven source distinct from its recorded predecessor. */
export async function observeExternalIntegration(
  root: string,
  observation: CompletionObservation,
  branch: string,
  sourceHead?: string,
): Promise<ObservedExternalIntegration | CompletionBlocker> {
  const incompatible = completionRecordBlocker(observation);
  if (incompatible !== undefined) return incompatible;
  const records = observedRecords(observation);
  const entry = records.find((record) => record.kind === "queue")?.data.entries
    .find((entry) =>
      entry.source.branch === branch &&
      (sourceHead === undefined || entry.source.head === sourceHead)
    );
  const candidate = records.find((record) =>
    record.kind === "candidate" && record.id === entry?.candidate_id
  );
  const live = await runGit(["rev-parse", "--verify", branch], { cwd: root });
  if (
    entry !== undefined && live.success &&
    live.stdout.trim() !== entry.source.head
  ) {
    return {
      kind: "stale-evidence",
      evidence_ids: [],
      reason: "source-replaced",
    };
  }
  if (
    entry === undefined || candidate?.kind !== "candidate" ||
    !sameSource(entry.source, candidate.data.source) ||
    candidate.data.expected_predecessor.head === candidate.data.source.head ||
    !await commitIsAncestorOf(
      root,
      candidate.data.expected_predecessor.head,
      candidate.data.head,
    ) ||
    !await commitIsAncestorOf(
      root,
      candidate.data.source.head,
      candidate.data.head,
    ) ||
    !await commitIsAncestorOf(root, candidate.data.head, observation.trunk)
  ) {
    return { kind: "missing-evidence", requirements: [] };
  }
  const validation = await observeCandidateValidation({
    root,
    observation,
    candidate_id: candidate.id,
    candidate: candidate.data,
    context: "local",
  });
  const audited = await validation.evaluator.observe(candidate.id);
  const plan = validation.evaluator.plan(
    audited,
    validation.demand,
    candidate.id,
  );
  const proof = applicableCandidateProof(
    records,
    candidate.id,
    candidate.data,
    validation.snapshot.requirements,
    plan,
  );
  if (proof === null) {
    return plan.blockers[0] ??
      {
        kind: "missing-evidence",
        requirements: validation.snapshot.requirements,
      };
  }
  const existing = records.find((record): record is ExternalIntegrationRecord =>
    record.kind === "integration" &&
    record.data.candidate_id === candidate.id &&
    sameSource(record.data.source, entry.source)
  );
  return { candidate, proof, ...(existing === undefined ? {} : { existing }) };
}
