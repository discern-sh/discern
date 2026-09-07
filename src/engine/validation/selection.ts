/** Current component selection and complete machine assembly; no landing authority. */
import type { Candidate } from "../completion/candidate.ts";
import {
  CandidateProofSchema,
  type ComponentEvidence,
  EvidencePurposeSchema,
  type Requirement,
} from "../completion/evidence.ts";
import {
  type CompletionRecord,
  CompletionRecordSchema,
} from "../completion/records.ts";
import type {
  CompletionBlocker,
  MachineAssembly,
  ValidationDemand,
} from "../completion/protocol.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  requirementKey,
  type ResolvedObligation,
  type ValidationSnapshot,
} from "./catalog.ts";
import { standardHeld, standardReading } from "./metrics.ts";

export type EvidenceRecord = Extract<CompletionRecord, { kind: "evidence" }>;
type AttemptRecord = Extract<CompletionRecord, { kind: "attempt" }>;
export type EvidenceSelection =
  | {
    readonly kind: "selected";
    readonly record: EvidenceRecord;
    readonly reading: number | null;
  }
  | { readonly kind: "missing" }
  | {
    readonly kind: "blocked";
    readonly attempt_id: string;
    readonly blocker: CompletionBlocker;
  };

/** Explicit retry records a finished validation predecessor in reservation order.
 * Its sequence bounds earlier failed subjects; it never authorizes live work or landing.
 */
export function finishedValidationAttempts(
  records: readonly CompletionRecord[],
): AttemptRecord[] {
  return records.filter((record): record is AttemptRecord =>
    CompletionRecordSchema.safeParse(record).success &&
    record.kind === "attempt" && record.data.purpose === "completion" &&
    record.data.subjects.length > 0 && record.data.state.kind === "finished"
  ).sort((a, b) => b.data.identity.sequence - a.data.identity.sequence);
}

/** Canonical byte-audit coordinate, scoped to the immutable producing attempt. */
export function artifactKey(
  artifact: ComponentEvidence["artifacts"][number],
): string {
  return JSON.stringify([
    artifact.attempt_id,
    artifact.candidate_id,
    artifact.context,
    artifact.path,
    artifact.digest,
    artifact.bytes,
  ]);
}

/** Newer attempts win by reservation order, including failures in report mode. */
export function selectEvidence(
  obligation: ResolvedObligation,
  candidateId: string,
  records: readonly CompletionRecord[],
  mode: ValidationDemand["mode"],
  purpose: ComponentEvidence["purpose"],
  audited: ReadonlySet<string>,
): EvidenceSelection {
  const valid = records.filter((record) =>
    CompletionRecordSchema.safeParse(record).success
  );
  const attempts = valid.filter((record): record is AttemptRecord =>
    record.kind === "attempt" &&
    record.data.purpose === purpose &&
    record.data.subjects.includes(obligation.subject)
  );
  const latest =
    attempts.sort((a, b) =>
      b.data.identity.sequence - a.data.identity.sequence
    )[0];
  if (latest === undefined) return { kind: "missing" };
  const attempt = latest.data;
  const matching = valid.filter((record): record is EvidenceRecord =>
    record.kind === "evidence" &&
    record.data.attempt_id === latest.id &&
    record.data.sequence === attempt.identity.sequence &&
    record.data.candidate_id === attempt.identity.candidate_id &&
    record.data.mode === attempt.mode &&
    record.data.purpose === purpose &&
    JSON.stringify(record.data.applicability) ===
      JSON.stringify(obligation.applicability)
  );
  const blocked = (blocker: CompletionBlocker): EvidenceSelection => ({
    kind: "blocked",
    attempt_id: latest.id,
    blocker: blocker.kind === "validation-failed"
      ? {
        ...blocker,
        requirement: obligation.requirement,
        attempt_id: latest.id,
        reason:
          `${obligation.requirement.kind} '${obligation.requirement.id}' in context '${obligation.requirement.context}' has no passing evidence from attempt ${latest.id} (${
            attempt.state.kind === "finished"
              ? attempt.state.outcome
              : attempt.state.kind
          }). Resolve the failure, then use discern done --rerun for a deliberate retry.`,
      }
      : blocker,
  });
  if (attempt.state.kind === "claimed") {
    return blocked({
      kind: "waiting-for-operation",
      attempt_id: latest.id,
      expires_at: attempt.state.claim.expires_at,
    });
  }
  if (attempt.state.kind === "recovery") {
    return blocked({
      kind: "recovery-incomplete",
      record_id: latest.id,
      recovery: attempt.state.recovery,
    });
  }
  // A finished attempt can have an unrelated failed producer. Its valid siblings survive.
  if (attempt.state.kind !== "finished" || matching.length !== 1) {
    return blocked({
      kind: "validation-failed",
      evidence_ids: matching.map((r) => r.id),
    });
  }
  const record = matching[0];
  if (record === undefined) return { kind: "missing" };
  const evidence = record.data;
  if (evidence.outcome.kind !== "passed") {
    return blocked({ kind: "validation-failed", evidence_ids: [record.id] });
  }
  if (evidence.mode === "report" && mode === "strict") {
    return blocked({ kind: "report-only" });
  }
  const extractionInput = obligation.input.extraction?.input;
  if (
    (evidence.candidate_id !== candidateId &&
      evidence.applicability.closure.kind !== "declared") ||
    evidence.artifacts.some((artifact) =>
      !audited.has(artifactKey(artifact))
    ) ||
    (extractionInput?.kind === "artifact" &&
      !evidence.artifacts.some((artifact) =>
        artifact.path === extractionInput.path
      ))
  ) {
    return blocked({
      kind: "stale-evidence",
      evidence_ids: [record.id],
      reason: "artifact-unavailable",
    });
  }
  try {
    const reading = obligation.standard === null ? null : standardReading(
      obligation.standard,
      evidence.outcome.metrics,
      obligation.extent,
    );
    return { kind: "selected", record, reading };
  } catch {
    return blocked({ kind: "validation-failed", evidence_ids: [record.id] });
  }
}

/** Ask the canonical selector which current receipts need byte verification.
 * An empty audited set cannot confer readiness. It exposes only the newest
 * eligible receipt, leaving newer failure, ambiguity and active use blocking. */
export function artifactAuditEvidence(
  snapshot: ValidationSnapshot,
  records: readonly CompletionRecord[],
): ComponentEvidence[] {
  const wanted = new Set<string>();
  const unaudited = new Set<string>();
  for (const obligation of snapshot.obligations) {
    for (const purpose of EvidencePurposeSchema.options) {
      const selection = selectEvidence(
        obligation,
        snapshot.candidate_id,
        records,
        "report",
        purpose,
        unaudited,
      );
      if (selection.kind === "selected") wanted.add(selection.record.id);
      else if (
        selection.kind === "blocked" &&
        selection.blocker.kind === "stale-evidence"
      ) {
        for (const id of selection.blocker.evidence_ids) wanted.add(id);
      }
    }
  }
  return records.flatMap((record) =>
    record.kind === "evidence" && wanted.has(record.id) ? [record.data] : []
  );
}

/** All receipts are rebuilt for this exact immutable candidate and requirement set. */
export function assembleCandidate(
  snapshot: ValidationSnapshot,
  candidateId: string,
  candidate: Candidate,
  requirements: readonly Requirement[],
  records: readonly CompletionRecord[],
  mode: ValidationDemand["mode"],
  audited: ReadonlySet<string> = new Set(),
  clock: Clock = SYSTEM_CLOCK,
): MachineAssembly {
  const missing: CompletionBlocker = { kind: "missing-evidence", requirements };
  const keys = requirements.map(requirementKey).sort();
  if (
    records.some((record) =>
      !CompletionRecordSchema.safeParse(record).success
    ) || candidateId !== snapshot.candidate_id ||
    JSON.stringify(candidate) !== JSON.stringify(snapshot.candidate) ||
    JSON.stringify(keys) !==
      JSON.stringify(snapshot.requirements.map(requirementKey).sort())
  ) return { kind: "incomplete", blockers: [missing] };
  const blockers: CompletionBlocker[] = [];
  const receipts = [];
  for (const obligation of snapshot.obligations) {
    const selection = selectEvidence(
      obligation,
      candidateId,
      records,
      mode,
      "completion",
      audited,
    );
    if (selection.kind === "missing") {
      blockers.push({
        kind: "missing-evidence",
        requirements: [obligation.requirement],
      });
    } else if (selection.kind === "blocked") blockers.push(selection.blocker);
    else if (
      obligation.standard !== null &&
      (selection.reading === null ||
        !standardHeld(obligation.standard, selection.reading))
    ) {
      blockers.push({
        kind: "validation-failed",
        evidence_ids: [selection.record.id],
      });
    } else {
      receipts.push({
        requirement: obligation.requirement,
        evidence_id: selection.record.id,
        candidate_id: candidateId,
        policy: candidate.policy,
        reading: selection.reading,
      });
    }
  }
  if (blockers.length > 0) return { kind: "incomplete", blockers };
  // Publication must be attributed to a completion attempt for the consuming candidate.
  const assembler =
    records.filter((r): r is AttemptRecord =>
      r.kind === "attempt" && r.data.identity.candidate_id === candidateId &&
      r.data.purpose === "completion" && r.data.mode === mode &&
      r.data.subjects.length === 0
    )
      .sort((a, b) => b.data.identity.sequence - a.data.identity.sequence)[0];
  if (
    assembler === undefined || assembler.data.state.kind !== "claimed" ||
    assembler.data.state.claim.expires_at <= clock.wallNow()
  ) {
    return { kind: "incomplete", blockers: [missing] };
  }
  return {
    kind: "complete",
    proof: CandidateProofSchema.parse({
      attempt_id: assembler.id,
      candidate_id: candidateId,
      head: candidate.head,
      policy: candidate.policy,
      requirement_set: candidate.requirement_set,
      mode,
      requirements: [...requirements],
      receipts,
      assembled_at: clock.wallNow(),
    }),
  };
}
