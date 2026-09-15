/** Resolve and record the exact proven subject shared by submission and landing. */
import {
  type CheckpointDrop,
  uniqueCheckpointDrops,
} from "../../shared/checkpoint_drops.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import type { CompleteProofEvidence } from "../../shared/completion_proof.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import type { Proof, SubmissionRevision } from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import { strictVerdictCurrency } from "../completion/verdict.ts";
import { readCompleteProof } from "../gate/completion_proof.ts";
import { inspectGateProof } from "../gate/proof.ts";
import { readProofPresentation } from "../gate/proof_presentation.ts";
import { refusal, short } from "./accept_support.ts";
import {
  commitIsAncestorOf,
  inLinkedWorktree,
  integrationBranch,
  mainRepoPath,
  repoToplevel,
  WorktreeGitError,
} from "./git.ts";
import {
  deriveIdentity,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
} from "./identity.ts";
import { type LifecycleContext, lifecycleContext } from "./lifecycle.ts";
import { readSubmission, type Submission } from "./submission.ts";
import { recordSubmission } from "./submission_writer.ts";
import { resolveWorktreeTarget } from "./target_resolution.ts";

/** The checkout whose revision this call submits or lands. */
export interface EffortCheckout {
  readonly ctx: LifecycleContext;
  readonly path: string;
  readonly branch: string;
  readonly id: string;
  readonly settings: IdentitySettings;
  readonly mainRepo: string;
  readonly trunk: string;
  /** The owner selected the effort with `--target` instead of running inside it. */
  readonly explicit: boolean;
}

/** Resolve the effort checkout this call operates on. Read-only. */
export async function effortCheckout(
  ctx: LifecycleContext,
  target: string | undefined,
): Promise<EffortCheckout | undefined> {
  let path: string;
  let explicit = false;
  if (target !== undefined) {
    const resolved = await resolveWorktreeTarget(ctx.root, target, {
      cwd: ctx.cwd,
      mode: "registered",
      includeMain: false,
      command: "discern accept --target",
    });
    if (resolved.path === undefined) {
      throw new WorktreeGitError(
        `'${target}' names no registered worktree. Pass a listed worktree's id, path, or branch, then re-run discern accept --target.`,
      );
    }
    path = resolved.path;
    explicit = true;
  } else {
    if (!(await inLinkedWorktree(ctx.cwd))) return undefined;
    const toplevel = await repoToplevel(ctx.cwd);
    if (toplevel === undefined) {
      throw new WorktreeGitError(
        "discern accept needs a Git worktree, but this directory is outside a Git repository. Move into the worktree that holds the finished branch, then re-run.",
      );
    }
    path = toplevel;
  }
  const effortCtx = explicit
    ? await lifecycleContext(path, ctx.log, path)
    : { ...ctx, cwd: path };
  const mainRepo = await mainRepoPath(path);
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "discern could not find the main checkout from Git's worktree records. Run `git worktree repair`, then re-run `discern accept`.",
    );
  }
  if (mainRepo === path) {
    throw new WorktreeGitError(
      "Git identifies this path as the main checkout, so there is no effort branch to land. Move into the finished worktree shown by `discern status`, then re-run `discern accept`.",
    );
  }
  const settings = await loadIdentitySettings(effortCtx.root);
  const id = await resolveWorktreeId(settings, path);
  const branchRun = await runGit(["branch", "--show-current"], { cwd: path });
  const branch = branchRun.success ? branchRun.stdout.trim() : "";
  if (branch === "") {
    const conventional = deriveIdentity(id, settings).branch;
    throw new WorktreeGitError(
      `The worktree at ${path} is detached from a named branch, so there is no branch to land. Run \`git switch ${conventional}\` there, then re-run \`discern accept\`.`,
    );
  }
  return {
    ctx: effortCtx,
    path,
    branch,
    id,
    settings,
    mainRepo,
    trunk: integrationBranch(effortCtx.config.repository.trunk),
    explicit,
  };
}

// ── the landing subject ──────────────────────────────────────────────────────

/** The exact revision this call lands and the Proof that vouches for it. */
export interface LandingSubject {
  readonly head: string;
  readonly complete: CompleteProofEvidence;
  readonly proof: Proof;
  readonly proofMarkdown: string | undefined;
  readonly proofLine: string | undefined;
  readonly drops: CheckpointDrop[];
  /** The subject is the checkout's HEAD; otherwise an earlier submission. */
  readonly atHead: boolean;
  readonly submission: Submission | undefined;
}

/** The refusal `accept` serves for a report-only Proof. */
function refuseReportOnlyProof(drops: readonly CheckpointDrop[]): never {
  refusal(
    "report_only_proof",
    "This Proof records checkpoint review as reported and not enforced. Run ordinary `discern done` before acceptance. Nothing has been landed.",
    {
      hints: hintTexts([fire(HINTS["accept-requires-strict-proof"])]),
      ...(drops.length === 0 ? {} : { data: { checkpoint_drops: [...drops] } }),
    },
  );
}

/**
 * Resolve what this call may land: the checkout's HEAD when its Proof is
 * honored and complete; otherwise, for an owner's explicit `--target`, the
 * effort's recorded submission read back from common storage.
 */
export async function resolveSubject(
  effort: EffortCheckout,
  /** The submission this call entered with, read before any wait. A waiting
   * request keeps its identity: it lands exactly the revision it queued
   * with, even when the author's branch moved on during the wait — the
   * re-read decides settlement and current authority, never a new subject. */
  entered?: Submission,
): Promise<LandingSubject | undefined> {
  const inspected = await inspectGateProof(effort.path);
  const inspectedDrops = uniqueCheckpointDrops([
    ...(inspected.proof_data?.checkpoint_drops ?? []),
    ...(inspected.checkpoint_drops ?? []),
  ]);
  if (inspected.status === "report_only") refuseReportOnlyProof(inspectedDrops);
  const submissionRead = await readSubmission(effort.path);
  const submission = submissionRead.status === "submitted"
    ? submissionRead.submission
    : undefined;
  // An honored Proof whose only defect is a checkpoint drop still names the
  // proven revision: the decision layers serve the drop-specific refusal
  // (unreadable declaration evidence, an indeterminate stop) instead of the
  // generic nothing-proven route. Unverifiable strand evidence stays excluded:
  // no decision layer can compensate for it.
  const proofData = inspected.status === "honored"
    ? inspected.proof_data
    : undefined;
  if (
    inspected.status === "honored" &&
    proofData !== undefined && proofData.completion !== undefined &&
    inspected.proof_line !== undefined && inspected.head !== undefined &&
    inspectedDrops.some((drop) =>
        drop.reason === "strand_check_unavailable"
      ) !== true
  ) {
    return {
      head: inspected.head,
      complete: proofData.completion,
      proof: proofData,
      proofMarkdown: inspected.proof,
      proofLine: inspected.proof_line,
      drops: inspectedDrops,
      atHead: true,
      submission,
    };
  }
  if (
    submission === undefined ||
    (!effort.explicit && submission.id !== entered?.id)
  ) {
    return undefined;
  }
  let complete: CompleteProofEvidence;
  let proof: Proof;
  try {
    complete = await readCompleteProof(effort.path, submission.proof);
    proof = await readProofPresentation(effort.path, submission.proof);
  } catch (error) {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but its Proof cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }. Run discern done from ${effort.path}, then discern accept.`,
      { cause: error },
    );
  }
  if (complete.candidate.head !== submission.head) {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but its Proof names another commit. Run discern done from ${effort.path}, then discern accept.`,
    );
  }
  if (proof.mode === "report") {
    refuseReportOnlyProof(proof.checkpoint_drops ?? []);
  }
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${effort.branch}^{commit}`],
    { cwd: effort.path },
  );
  const tipSha = tip.success ? tip.stdout.trim() : "";
  if (
    tipSha === "" ||
    !(await commitIsAncestorOf(effort.mainRepo, submission.head, tipSha))
  ) {
    throw new WorktreeGitError(
      `${effort.branch} no longer contains its submitted revision ${
        short(submission.head)
      }. Run discern done from ${effort.path}, then discern accept for the current work.`,
    );
  }
  // The submission's Proof is durable, but it is landable only while it is
  // still the revision's NEWEST strict verdict: a later strict run that
  // judged the same revision red supersedes it for landing, and an
  // unreadable verdict inventory fails closed rather than landing blind.
  const verdict = await strictVerdictCurrency(effort.path, submission.head);
  if (verdict.kind === "superseded") {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but a newer strict gate run judged that revision red, so its earlier Proof is not landable. Resolve the failure and run discern done --rerun from ${effort.path}, then discern accept.`,
    );
  }
  if (verdict.kind === "unavailable") {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but the strict verdict over that revision could not be read: ${verdict.reason}. Restore the completion records, run discern done from ${effort.path}, then discern accept.`,
    );
  }
  return {
    head: submission.head,
    complete,
    proof,
    proofMarkdown: proof.markdown,
    proofLine: proof.line,
    drops: uniqueCheckpointDrops(proof.checkpoint_drops ?? []),
    atHead: tipSha === submission.head && inspected.status === "honored",
    submission,
  };
}

/** Record what this effort asks to land; a same-revision resubmission keeps its time. */
export async function recordProvenSubmission(
  effort: EffortCheckout,
  subject: LandingSubject,
): Promise<Submission> {
  const existing = subject.submission;
  const sameHead = existing?.head === subject.head;
  if (
    sameHead && existing.proof.candidate_id === subject.complete.candidate_id &&
    existing.proof.proof_id === subject.complete.proof_id
  ) return existing;
  return await recordSubmission(effort.path, {
    id: sameHead ? existing.id : SYSTEM_SECURE_ENTROPY.uuid(),
    effort_id: effort.id,
    branch: effort.branch,
    head: subject.head,
    tree: subject.complete.candidate.tree,
    proof: {
      candidate_id: subject.complete.candidate_id,
      proof_id: subject.complete.proof_id,
    },
    submitted_at: sameHead
      ? existing.submitted_at
      : wallTimeIso(SYSTEM_CLOCK.wallNow()),
  });
}

/** Bind the selected checkout to its complete Proof. */
export function subjectRevision(
  effort: EffortCheckout,
  subject: LandingSubject,
): SubmissionRevision {
  return {
    path: effort.path,
    branch: effort.branch,
    head: subject.head,
    proof: {
      candidate_id: subject.complete.candidate_id,
      proof_id: subject.complete.proof_id,
    },
  };
}

/** Compare every fact that identifies the revision reviewed before consent. */
export function sameSubmissionRevision(
  left: SubmissionRevision,
  right: SubmissionRevision,
): boolean {
  return left.path === right.path && left.branch === right.branch &&
    left.head === right.head &&
    left.proof.candidate_id === right.proof.candidate_id &&
    left.proof.proof_id === right.proof.proof_id;
}
