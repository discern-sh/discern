/**
 * The landing queue as a derived view over the fleet's submission records.
 *
 * A row is one effort whose agent submitted an exact revision with `accept`
 * and whose submission has not landed: pre-authorized rows first, by grant
 * time, then rows awaiting the owner, by submission time. A row whose Proof
 * predates trunk movement, whose branch has moved on, or whose revision a
 * newer strict gate run judged red says so and names the route. Nothing here
 * mutates a record; `status`, the desk, and `accept --dry-run` all read this
 * one derivation so they agree.
 */

import { runGit } from "../../shared/subprocess.ts";
import { readCompleteProof } from "../gate/completion_proof.ts";
import {
  gateProofHasCompleteEvidence,
  inspectGateProof,
} from "../gate/proof.ts";
import { candidatePredecessor } from "../completion/candidate.ts";
import { strictVerdictCurrency } from "../completion/verdict.ts";
import {
  commitIsAncestorOf,
  commitIsMerged,
  integrationBranch,
  listRegisteredWorktrees,
} from "./git.ts";
import {
  effortGrantCovering,
  inspectLandingAuthority,
} from "./landing_authority.ts";
import {
  integrationOwnerLiveness,
  listIntegrationLandingRecords,
} from "./integration_record.ts";
import { readSubmission, type Submission } from "./submission.ts";
import { short } from "./accept_support.ts";

export type SubmissionAuthority = "pre-authorized" | "awaiting-owner";

/** One landing-queue row, in the words every surface shows. */
export interface SubmissionRow {
  readonly effort: string;
  readonly branch: string;
  readonly path: string;
  readonly head: string;
  readonly submitted_at: string;
  readonly authority: SubmissionAuthority;
  readonly authority_source?: "effort-grant" | "standing-grant";
  readonly granted_at?: string;
  readonly readiness: "ready" | "waiting";
  /** Why the submission waits and its next action. Absent when ready. */
  readonly reason?: string;
  /** The trunk moved after its Proof, so acceptance composes and checks it in
   * an integration worktree before landing. */
  readonly integration?: boolean;
  /** The running landing checking this submission, readable with
   * `discern progress <handle>`. */
  readonly operation_handle?: string;
  /** 1-based place in the displayed order. */
  readonly position: number;
}

/** The facts one row's readiness sentence derives from. */
export interface SubmissionFacts {
  /** The trunk tip the submission's Proof was proven against still holds. */
  readonly trunkCurrent: boolean;
  /** The branch tip is the submitted revision. */
  readonly branchCurrent: boolean;
  /** The current clean branch tip has complete, valid Proof. */
  readonly provenBranchHead?: string;
  /** The submission's complete Proof reads from the store. */
  readonly proofReadable: boolean;
  /** The store's newest strict verdict over the submitted revision. */
  readonly verdict: "current" | "superseded" | "unavailable";
  /** A live landing is checking this submission's combined code now. */
  readonly checking?: { readonly handle?: string };
  /** A retained composition awaits a checkpoint decision for this
   * submission: the served questions' ids and which decision continues. */
  readonly judgment?: {
    readonly decision: "declaration" | "variance";
    readonly awaiting: readonly string[];
  };
}

/** Derive one row's readiness, single waiting reason, and optional
 * integration detail (pure). A trunk that moved after the Proof is not a
 * waiting reason: acceptance composes and checks the combined code in an
 * integration worktree, so the row stays ready and says so. */
export function submissionReadiness(
  facts: SubmissionFacts,
): Pick<SubmissionRow, "readiness" | "reason" | "integration"> {
  if (facts.checking !== undefined) {
    return {
      readiness: "waiting",
      reason: facts.checking.handle === undefined
        ? "A running landing is checking its combined code now."
        : `A running landing is checking its combined code now; read it with discern progress ${facts.checking.handle}.`,
      ...(facts.trunkCurrent ? {} : { integration: true }),
    };
  }
  if (facts.judgment !== undefined) {
    const ids = facts.judgment.awaiting.join(", ");
    return {
      readiness: "waiting",
      reason: facts.judgment.decision === "declaration"
        ? `Its retained composition fired checkpoint question${
          facts.judgment.awaiting.length === 1 ? "" : "s"
        } (${ids}); judge the combined result and continue with discern accept --met <id> (or --unmet <id> --why "<rationale>") from its worktree.`
        : `Its retained composition carries declared-unmet checkpoint${
          facts.judgment.awaiting.length === 1 ? "" : "s"
        } (${ids}); the owner's decision continues it: discern accept --confirmed --variance <id> from its worktree.`,
      integration: true,
    };
  }
  if (!facts.branchCurrent && facts.provenBranchHead !== undefined) {
    return {
      readiness: "waiting",
      reason:
        `This submission names a different commit; the branch has valid Proof at ${
          short(facts.provenBranchHead)
        }. Run discern accept from its worktree to submit the proven revision.`,
      ...(facts.trunkCurrent ? {} : { integration: true }),
    };
  }
  if (!facts.proofReadable) {
    return {
      readiness: "waiting",
      reason:
        "Its Proof cannot be read; run discern done from its worktree, then discern accept.",
    };
  }
  if (!facts.branchCurrent) {
    return {
      readiness: "waiting",
      reason:
        "Its branch has moved on since it was submitted; run discern done, then discern accept from its worktree for the new work.",
      ...(facts.trunkCurrent ? {} : { integration: true }),
    };
  }
  if (facts.verdict === "superseded") {
    return {
      readiness: "waiting",
      reason:
        "A newer strict gate run judged its submitted revision red; resolve the failure and run discern done --rerun from its worktree, then discern accept.",
    };
  }
  if (facts.verdict === "unavailable") {
    return {
      readiness: "waiting",
      reason:
        "The strict verdict over its submitted revision could not be read; run discern done from its worktree, then discern accept.",
    };
  }
  return {
    readiness: "ready",
    ...(facts.trunkCurrent ? {} : { integration: true }),
  };
}

/** Order pre-authorized rows first by grant time, then the rest by submission time. */
export function orderSubmissionRows<
  T extends Pick<
    SubmissionRow,
    "authority" | "granted_at" | "submitted_at" | "effort"
  >,
>(rows: readonly T[]): T[] {
  const time = (value: string | undefined): number => {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };
  return [...rows].sort((a, b) => {
    if (a.authority !== b.authority) {
      return a.authority === "pre-authorized" ? -1 : 1;
    }
    const left = a.authority === "pre-authorized"
      ? time(a.granted_at ?? a.submitted_at)
      : time(a.submitted_at);
    const right = b.authority === "pre-authorized"
      ? time(b.granted_at ?? b.submitted_at)
      : time(b.submitted_at);
    return left - right || a.effort.localeCompare(b.effort);
  });
}

/** Resolve one submission's row facts against the repository. Read-only. */
async function submissionRow(
  root: string,
  trunk: string,
  trunkTip: string,
  path: string,
  submission: Submission,
  checking?: { readonly handle?: string },
  judgment?: SubmissionFacts["judgment"],
): Promise<Omit<SubmissionRow, "position"> | undefined> {
  if (await commitIsMerged(root, submission.head, trunk)) return undefined;
  let trunkCurrent = false;
  let proofReadable = false;
  try {
    const complete = await readCompleteProof(root, submission.proof);
    proofReadable = complete.candidate.head === submission.head;
    // Ancestry, the landing's own rule: a submission that already contains
    // the trunk tip lands directly, so its row carries no composition mark.
    trunkCurrent = proofReadable &&
      (candidatePredecessor(complete.candidate) === trunkTip ||
        await commitIsAncestorOf(root, trunkTip, submission.head));
  } catch {
    // discern-best-effort: submission-row-proof-unreadable
    proofReadable = false;
  }
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${submission.branch}^{commit}`],
    { cwd: root },
  );
  const branchCurrent = tip.success && tip.stdout.trim() === submission.head;
  const branchProof = branchCurrent ? undefined : await inspectGateProof(path);
  const provenBranchHead = branchProof !== undefined &&
      gateProofHasCompleteEvidence(branchProof) &&
      branchProof.proof_data.completion !== undefined &&
      branchProof.proof_data.branch === submission.branch &&
      tip.success && branchProof.head === tip.stdout.trim()
    ? branchProof.head
    : undefined;
  const verdict = proofReadable
    ? (await strictVerdictCurrency(root, submission.head)).kind
    : "current" as const;
  const covering = await effortGrantCovering(path, submission.branch);
  let authority: SubmissionAuthority = "awaiting-owner";
  let source: SubmissionRow["authority_source"];
  let grantedAt: string | undefined;
  if (covering !== undefined) {
    authority = "pre-authorized";
    source = "effort-grant";
    grantedAt = covering.granted_at;
  } else if (branchCurrent) {
    const standing = await inspectLandingAuthority(path, trunk);
    if (
      standing.kind === "authorized" &&
      standing.consent.source === "standing-grant"
    ) {
      authority = "pre-authorized";
      source = "standing-grant";
    }
  }
  return {
    effort: submission.effort_id,
    branch: submission.branch,
    path,
    head: submission.head,
    submitted_at: submission.submitted_at,
    authority,
    ...(source === undefined ? {} : { authority_source: source }),
    ...(grantedAt === undefined ? {} : { granted_at: grantedAt }),
    ...(checking?.handle === undefined
      ? {}
      : { operation_handle: checking.handle }),
    ...submissionReadiness({
      trunkCurrent,
      branchCurrent,
      ...(provenBranchHead === undefined ? {} : { provenBranchHead }),
      proofReadable,
      verdict,
      ...(checking === undefined ? {} : { checking }),
      ...(judgment === undefined ? {} : { judgment }),
    }),
  };
}

/** Every unlanded submission across the registered worktrees, in landing order. */
export async function submissionRows(
  root: string,
  trunkName: string,
): Promise<SubmissionRow[]> {
  const trunk = integrationBranch(trunkName);
  const tipRun = await runGit(
    ["rev-parse", "--verify", `refs/heads/${trunk}^{commit}`],
    { cwd: root },
  );
  if (!tipRun.success) return [];
  const trunkTip = tipRun.stdout.trim();
  // The submissions being checked right now, from the recorded integration
  // landings whose owning process still runs — the one authority the queue,
  // status, and the landing walk share. A retained awaiting-judgment
  // composition (no live owner by design) names the decision that continues
  // its landing instead.
  const checking = new Map<string, { readonly handle?: string }>();
  const judgments = new Map<string, SubmissionFacts["judgment"]>();
  for (const entry of await listIntegrationLandingRecords(root)) {
    if (entry.reading.status !== "recorded") continue;
    const record = entry.reading.record;
    if (await integrationOwnerLiveness(root, record) === "running") {
      checking.set(record.landing.submission_id, {
        ...(record.operation.operation_handle === undefined
          ? {}
          : { handle: record.operation.operation_handle }),
      });
      continue;
    }
    if (
      record.phase === "awaiting-judgment" && record.continuation !== undefined
    ) {
      judgments.set(record.landing.submission_id, {
        decision: record.continuation.decision,
        awaiting: record.continuation.awaiting,
      });
    }
  }
  const rows: Omit<SubmissionRow, "position">[] = [];
  for (const registration of await listRegisteredWorktrees(root)) {
    if (registration.isMain) continue;
    const read = await readSubmission(registration.path);
    if (read.status !== "submitted") continue;
    const row = await submissionRow(
      root,
      trunk,
      trunkTip,
      registration.path,
      read.submission,
      checking.get(read.submission.id),
      judgments.get(read.submission.id),
    );
    if (row !== undefined) rows.push(row);
  }
  return orderSubmissionRows(rows).map((row, index) => ({
    ...row,
    position: index + 1,
  }));
}
