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
import { candidatePredecessor } from "../completion/candidate.ts";
import { strictVerdictCurrency } from "../completion/verdict.ts";
import {
  commitIsMerged,
  integrationBranch,
  listRegisteredWorktrees,
} from "./git.ts";
import {
  effortGrantCovering,
  inspectLandingAuthority,
} from "./landing_authority.ts";
import { readSubmission, type Submission } from "./submission.ts";

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
  /** One full sentence: why the submission waits. Absent when ready. */
  readonly reason?: string;
  /** 1-based place in the displayed order. */
  readonly position: number;
}

/** The facts one row's readiness sentence derives from. */
export interface SubmissionFacts {
  /** The trunk tip the submission's Proof was proven against still holds. */
  readonly trunkCurrent: boolean;
  /** The branch tip is the submitted revision. */
  readonly branchCurrent: boolean;
  /** The submission's complete Proof reads from the store. */
  readonly proofReadable: boolean;
  /** The store's newest strict verdict over the submitted revision. */
  readonly verdict: "current" | "superseded" | "unavailable";
}

/** Derive one row's readiness and single waiting reason (pure). */
export function submissionReadiness(
  facts: SubmissionFacts,
): Pick<SubmissionRow, "readiness" | "reason"> {
  if (!facts.proofReadable) {
    return {
      readiness: "waiting",
      reason:
        "Its Proof cannot be read; run discern done from its worktree, then discern accept.",
    };
  }
  if (!facts.trunkCurrent) {
    return {
      readiness: "waiting",
      reason:
        "The trunk moved after its Proof; run discern update, discern done, then discern accept from its worktree.",
    };
  }
  if (!facts.branchCurrent) {
    return {
      readiness: "waiting",
      reason:
        "Its branch has moved on since it was submitted; run discern done, then discern accept from its worktree for the new work.",
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
  return { readiness: "ready" };
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
): Promise<Omit<SubmissionRow, "position"> | undefined> {
  if (await commitIsMerged(root, submission.head, trunk)) return undefined;
  let trunkCurrent = false;
  let proofReadable = false;
  try {
    const complete = await readCompleteProof(root, submission.proof);
    proofReadable = complete.candidate.head === submission.head;
    trunkCurrent = proofReadable &&
      candidatePredecessor(complete.candidate) === trunkTip;
  } catch {
    // discern-best-effort: submission-row-proof-unreadable
    proofReadable = false;
  }
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${submission.branch}^{commit}`],
    { cwd: root },
  );
  const branchCurrent = tip.success && tip.stdout.trim() === submission.head;
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
    ...submissionReadiness({
      trunkCurrent,
      branchCurrent,
      proofReadable,
      verdict,
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
    );
    if (row !== undefined) rows.push(row);
  }
  return orderSubmissionRows(rows).map((row, index) => ({
    ...row,
    position: index + 1,
  }));
}
