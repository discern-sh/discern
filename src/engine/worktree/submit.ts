/** Planned queue admission shares the acceptance subject and exact decision boundary. */
import { uniqueCheckpointDrops } from "../../shared/checkpoint_drops.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import {
  appliedResult,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  verbatimStepLabel,
} from "../../shared/result.ts";
import type {
  SubmissionRevision,
  SubmitData,
} from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  withCompletionCheckout,
  withCompletionPublication,
} from "../operation_lock.ts";
import {
  enforceAcceptanceCheckpoints,
  enforceStandardLimitApprovals,
  refuseUnreadableDeclarationEvidence,
} from "./accept.ts";
import {
  type EffortCheckout,
  effortCheckout,
  type LandingSubject,
  recordProvenSubmission,
  resolveSubject,
  sameSubmissionRevision,
} from "./accept_subject.ts";
import { landingAuthorityDetail, short } from "./accept_support.ts";
import { inspectAcceptanceCheckpoints } from "./acceptance_checkpoints.ts";
import { WorktreeGitError } from "./git.ts";
import {
  inspectLandingAuthority,
  landingAuthorityProjection,
} from "./landing_authority.ts";
import {
  assertProjectRootIsRepoToplevel,
  type LifecycleContext,
  lifecycleContext,
  worktreeErrorResult,
} from "./lifecycle.ts";
import { readSubmission } from "./submission.ts";

/** A queue-only request never conveys landing or exception authority. */
export interface SubmitRequest {
  readonly dryRun?: boolean;
  /** Apply the reviewed plan only while its complete revision remains current. */
  readonly expected?: SubmissionRevision;
  readonly signal?: AbortSignal;
}

/** The shared read-only submission plan, resolved from complete current Proof. */
async function submissionPlan(ctx: LifecycleContext): Promise<{
  effort: EffortCheckout;
  subject: LandingSubject;
  data: SubmitData;
  plan: EnginePlan;
}> {
  await assertProjectRootIsRepoToplevel(ctx, "submit");
  const effort = await effortCheckout(ctx, undefined);
  if (effort === undefined) {
    throw new WorktreeGitError(
      "Run discern submit from the proven effort's worktree. Select a task in the desk to join the landing queue.",
    );
  }
  const subject = await resolveSubject(effort);
  if (subject === undefined || !subject.atHead) {
    throw new WorktreeGitError(
      `${effort.branch} has no current complete Proof. Commit the work and run discern done, then discern submit.`,
    );
  }
  const clean = await runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ], { cwd: effort.path });
  if (!clean.success || clean.stdout !== "") {
    throw new WorktreeGitError(
      "Submission requires a readable, clean worktree. Commit the intended work and run discern done, then discern submit.",
    );
  }
  const recorded = await readSubmission(effort.path);
  if (recorded.status !== "submitted" && recorded.status !== "missing") {
    throw new WorktreeGitError(
      `The submission could not be read: ${recorded.reason}. Restore the record before submitting.`,
    );
  }
  // Queue admission must not turn an ordinary grant into an exception decision.
  const checkpoints = await inspectAcceptanceCheckpoints(
    effort.path,
    effort.ctx.config,
  );
  refuseUnreadableDeclarationEvidence(
    uniqueCheckpointDrops([...subject.drops, ...checkpoints.drops]),
  );
  enforceAcceptanceCheckpoints(checkpoints, {
    confirmed: false,
    varianceIds: [],
  });
  await enforceStandardLimitApprovals(effort, subject, {
    confirmed: false,
    names: [],
  });
  const authority = await inspectLandingAuthority(effort.path, effort.trunk, {
    includeScopeEvidence: true,
  });
  const data: SubmitData = {
    path: effort.path,
    branch: effort.branch,
    head: subject.head,
    proof: {
      candidate_id: subject.complete.candidate_id,
      proof_id: subject.complete.proof_id,
    },
    state: "planned",
    authority: landingAuthorityProjection(authority) ??
      { kind: authority.kind },
    ...(subject.submission !== undefined &&
        subject.submission.head !== subject.head
      ? { replaces: subject.submission.head }
      : {}),
  };
  const unchanged = subject.submission?.head === subject.head &&
    subject.submission.proof.candidate_id === subject.complete.candidate_id &&
    subject.submission.proof.proof_id === subject.complete.proof_id;
  return {
    effort,
    subject,
    data,
    plan: {
      title: "Join the landing queue",
      details: [
        `Task: ${effort.path}`,
        `Branch: ${effort.branch}`,
        `Revision: ${subject.head}`,
        `Authority: ${landingAuthorityDetail(authority, false)}`,
        ...(data.replaces === undefined
          ? []
          : [`Replaces queued revision: ${data.replaces}`]),
        "Records this proven revision. Checks, the trunk, the checkout, and grants remain unchanged.",
        "An active or later acceptance walk may land it. Queueing schedules no background run.",
        `Start a landing walk with discern accept --target ${effort.branch}.`,
      ],
      steps: [{
        kind: "task-metadata",
        label: verbatimStepLabel("record submission"),
        disposition: unchanged ? "skip" : "run",
        note: unchanged
          ? "Keep the existing submission and queue order"
          : `Queue ${subject.head}`,
      }],
    },
  };
}

/** Plan and record a proven revision without acquiring the landing turn or starting checks. */
export async function submitResult(
  ctx: LifecycleContext,
  request: SubmitRequest = {},
): Promise<DiscernResult<SubmitData>> {
  try {
    const initial = await submissionPlan(ctx);
    if (
      request.expected !== undefined &&
      !sameSubmissionRevision(request.expected, initial.data)
    ) {
      throw new WorktreeGitError(
        "The reviewed revision changed. Open a fresh submission plan; no revision was queued.",
      );
    }
    if (request.dryRun) {
      return { ...previewResult("submit", initial.plan), data: initial.data };
    }
    return await withCompletionCheckout(initial.effort.path, async (signal) => {
      // The publication is short and has no project command or capacity wait.
      return await withCompletionPublication(initial.effort.path, async () => {
        const current = await submissionPlan(
          await lifecycleContext(initial.effort.path, ctx.log),
        );
        if (!sameSubmissionRevision(initial.data, current.data)) {
          throw new WorktreeGitError(
            "The reviewed revision changed. Open a fresh submission plan; no revision was queued.",
          );
        }
        signal.throwIfAborted();
        const record = await recordProvenSubmission(
          current.effort,
          current.subject,
        );
        const authority = current.data.authority.kind === "authorized"
          ? "Authorized"
          : "Awaiting authority";
        return {
          ...appliedResult(
            "submit",
            current.plan.steps.map((step) => ({
              step,
              outcome: "ok" as const,
            })),
          ),
          data: {
            ...current.data,
            state: "queued" as const,
            submission_id: record.id,
            submitted_at: record.submitted_at,
          },
          message: `Queued ${current.effort.branch} at ${
            short(record.head)
          } · ${authority}.`,
          hints: hintTexts([
            fire(HINTS["submit-start-walk"], { branch: current.effort.branch }),
          ]),
        };
      });
    }, request.signal);
  } catch (error) {
    const mapped = worktreeErrorResult("submit", error);
    if (mapped === undefined) throw error;
    // The acceptance decision cores retain their full diagnosis, but their
    // action-specific data does not belong to the submission envelope.
    return {
      ok: false,
      verb: "submit",
      error: mapped.error ?? "precondition_failed",
      ...(mapped.message === undefined ? {} : { message: mapped.message }),
      ...(mapped.hints === undefined ? {} : { hints: mapped.hints }),
      ...(mapped.diagnostics === undefined
        ? {}
        : { diagnostics: mapped.diagnostics }),
    };
  }
}
