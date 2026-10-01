/**
 * The facts a fleet row's state is derived from, and their human wording.
 *
 * Pure readers over one `StatusFleetEntry` plus the queue and integration
 * facts that speak for it. `row_states.ts` picks a row's state from these
 * facts; `row_sentences.ts` explains it. Every surface that names a row's
 * checks, authority, or queue place uses the wording here, so the status
 * dashboard, `discern enter`, and the Desk cannot describe one fact twice.
 */

import type {
  GateProofCheckData,
  GateProofCheckStatus,
  Proof,
  StatusFleetEntry,
  SubmissionRowData,
} from "../../shared/result_schemas.ts";
import { isPositiveGitCount } from "../../shared/git_count.ts";
import { isReadyToLand } from "../worktree/readiness.ts";
import { standardLimitApprovalToken } from "../../shared/standard_approval_token.ts";

/** Fleet activity older than this is stale when unlanded work remains. */
export const STALE_WORKTREE_DAYS = 7;

/** The closed status kinds, in the precedence status classifies them by.
 * Renderer and Desk tests key their matrices to this tuple, so a new kind
 * cannot bypass the state, width, and text guards. */
export const FLEET_ROW_STATUS_KINDS = [
  "broken",
  "setup-incomplete",
  "unreadable",
  "failed",
  "blocked",
  "behind",
  "ready",
  "running",
  "stale",
  "in-progress",
  "proof-unreadable",
  "proof-unavailable",
  "proof-stale",
  "needs-gate",
  "idle",
] as const;

/** One status kind ({@link FLEET_ROW_STATUS_KINDS}). */
export type FleetRowStatusKind = (typeof FLEET_ROW_STATUS_KINDS)[number];

/** A landing's integration copy, speaking for the row of the task it lands. */
export type FleetRowIntegration = NonNullable<StatusFleetEntry["integration"]>;

/** The decision a retained integration copy waits on. */
export type FleetRowJudgment = NonNullable<FleetRowIntegration["judgment"]>;

/** Everything a live task row's state and sentences are derived from. */
export interface FleetTaskRowFacts {
  readonly entry: StatusFleetEntry;
  readonly kind: FleetRowStatusKind;
  readonly trunk: string;
  readonly nowMs: number;
  /** The task's landing-queue row, when it has one. */
  readonly queueRow?: SubmissionRowData | undefined;
  /** The integration copy landing this task, or the row's own record. */
  readonly integration?: FleetRowIntegration | undefined;
}

/** Everything a branch row (parked or recently landed) is derived from. */
export interface FleetBranchRowFacts {
  readonly branch: string;
  /** The configured trunk the branch lands on. */
  readonly trunk: string;
  /** When the branch was parked or landed. */
  readonly at?: string;
  readonly nowMs: number;
}

/** Whole days since an ISO timestamp, or undefined when absent/unparseable. */
export function idleDaysOf(
  iso: string | undefined,
  nowMs: number,
): number | undefined {
  if (iso === undefined) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

/**
 * A compact age: `now`, `20m`, `2h`, `11d`, `3w`, `2mo`, `1y`, or nothing
 * without a readable time. Days run to two weeks, so an 11-day idle span reads
 * as 11 days everywhere.
 */
export function compactAge(
  iso: string | undefined,
  nowMs: number,
): string | undefined {
  if (iso === undefined) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  const mins = Math.floor(Math.max(0, nowMs - then) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** A compact relative age: `just now`, `20m ago`, `11d ago`, `3w ago`. */
export function relativeAge(
  iso: string | undefined,
  nowMs: number,
): string {
  const age = compactAge(iso, nowMs);
  return age === undefined ? "—" : age === "now" ? "just now" : `${age} ago`;
}

/** The complete Proof inspection, with compatibility fallbacks for rows an
 * older producer wrote before `gate_proof` existed. */
export function fleetRowProof(entry: StatusFleetEntry): GateProofCheckData {
  if (entry.gate_proof !== undefined) return entry.gate_proof;
  if (entry.proof_honored === true) {
    return {
      status: "honored",
      ...(entry.proof === undefined ? {} : { proof: entry.proof }),
      ...(entry.proof_line === undefined
        ? {}
        : { proof_line: entry.proof_line }),
    };
  }
  if (entry.clean === false) return { status: "dirty" };
  return {
    status: "unavailable",
    reason: "Proof state was not inspected",
  };
}

/** The landable facts: honored Proof on a clean branch with commits ahead. */
export function hasLandableFacts(entry: StatusFleetEntry): boolean {
  return isReadyToLand(entry, fleetRowProof(entry).status === "honored");
}

/** Whether a Proof carries decisions only the owner can make. */
export function hasExceptionFacts(proofData: Proof | undefined): boolean {
  return (proofData?.checkpoints?.declared_unmet.length ?? 0) > 0 ||
    (proofData?.standard_proposals?.length ?? 0) > 0;
}

/** A known, positive Git count, or undefined. */
export function positiveCount(
  count: StatusFleetEntry["ahead"],
): number | undefined {
  return count !== undefined && isPositiveGitCount(count) ? count : undefined;
}

/** The landing-authority fact in human words, or undefined when unknowable. */
export function authorityHuman(entry: StatusFleetEntry): string | undefined {
  if (entry.broken === true || entry.git_unavailable === true) return undefined;
  const authority = entry.landing_authority;
  if (authority?.kind === "authorized") {
    if (authority.source === "effort-grant") return "Pre-authorized by you";
    if (authority.source === "standing-grant") {
      const scopes = authority.scopes ?? [];
      return scopes.length === 0
        ? "Covered by your standing approval"
        : `Covered by your standing approval (${scopes.join(", ")})`;
    }
    return "Approved by you";
  }
  const uncovered = authority?.uncovered?.length ?? 0;
  const partial = (authority?.standing_scopes?.length ?? 0) > 0 &&
    uncovered > 0;
  return partial
    ? `Needs your approval · ${uncovered} ${
      uncovered === 1 ? "path isn't" : "paths aren't"
    } covered`
    : "Needs your approval";
}

/** The landing-queue fact in human words. */
export function queueHuman(queueRow: SubmissionRowData | undefined): string {
  if (queueRow === undefined) return "Not queued";
  const position = `#${queueRow.position}`;
  if (queueRow.readiness === "waiting") {
    return `${position} · waiting: ${queueRow.reason ?? "not ready yet"}`;
  }
  return queueRow.authority === "pre-authorized"
    ? `${position} · lands with any landing`
    : `${position} · needs your approval`;
}

/** When the Proof's validating attempt finished, from its completion evidence. */
export function proofFinishedAt(
  proof: GateProofCheckData | undefined,
): string | undefined {
  const completion = proof?.proof_data?.completion;
  if (completion === undefined) return undefined;
  const attempt = completion.attempts.find((candidate) =>
    candidate.identity.id === completion.validation.attempt_id
  );
  return attempt?.state.kind === "finished"
    ? new Date(attempt.state.finished_at).toISOString()
    : undefined;
}

const PROOF_HUMAN: Readonly<Record<GateProofCheckStatus, string>> = {
  honored: "Passed",
  report_only: "Reported only: not a landing Proof",
  missing: "None yet",
  stale: "Outdated: for an older commit",
  dirty: "Not run on these changes",
  unavailable: "Unavailable",
  read_failed: "Unreadable",
};

/** The recorded checks in human words: "Passed 20m ago", "None yet". */
export function proofHuman(
  proof: GateProofCheckData | undefined,
  nowMs: number,
): string {
  if (proof === undefined) return PROOF_HUMAN.missing;
  const base = PROOF_HUMAN[proof.status] ?? proof.status;
  if (proof.status === "honored") {
    const finished = proofFinishedAt(proof);
    return finished === undefined
      ? base
      : `${base} ${relativeAge(finished, nowMs)}`;
  }
  return (proof.status === "unavailable" || proof.status === "read_failed") &&
      proof.reason !== undefined
    ? `${base}: ${proof.reason}`
    : base;
}

/** The owner's variance a retained composition waits on, if any. */
function varianceJudgment(
  judgment: FleetRowJudgment | undefined,
): FleetRowJudgment | undefined {
  return judgment?.decision === "variance" ? judgment : undefined;
}

/**
 * Whether the exact exception hand-off can be derived: the Proof names its
 * owner decisions, or a retained composition names the variances it waits
 * on. Otherwise only `discern accept` itself can serve the decision.
 */
export function hasExceptionHandOff(
  proofData: Proof | undefined,
  judgment: FleetRowJudgment | undefined,
): boolean {
  return hasExceptionFacts(proofData) ||
    varianceJudgment(judgment) !== undefined;
}

/**
 * The exception hand-off with each standard approval token supplied: one
 * `--variance` per declared-unmet checkpoint, then one `--approve-standard`
 * per standard proposal. A retained composition's variances replace the
 * Proof's, because they bind to the combined code, and its receipt follows.
 * Sentences that cannot wait for a digest pass a placeholder per proposal;
 * {@link exceptionArgv} passes the real tokens.
 */
export function exceptionArgvWith(
  branch: string,
  proofData: Proof | undefined,
  tokens: readonly string[],
  judgment?: FleetRowJudgment,
): readonly string[] {
  const retained = varianceJudgment(judgment);
  const variances = retained?.awaiting ??
    (proofData?.checkpoints?.declared_unmet ?? []).map((unmet) => unmet.id);
  return [
    "discern",
    "accept",
    "--target",
    branch,
    "--confirmed",
    ...variances.flatMap((id) => ["--variance", id]),
    ...tokens.flatMap((token) => ["--approve-standard", token]),
    ...(retained === undefined
      ? []
      : ["--composition-receipt", retained.composition]),
  ];
}

/**
 * The exact command that records the owner's exception and lands the task,
 * with the approval token acceptance serves for each standard proposal.
 */
export async function exceptionArgv(
  branch: string,
  proofData: Proof | undefined,
  judgment?: FleetRowJudgment,
): Promise<readonly string[]> {
  const tokens = await Promise.all(
    (proofData?.standard_proposals ?? []).map(standardLimitApprovalToken),
  );
  return exceptionArgvWith(branch, proofData, tokens, judgment);
}
