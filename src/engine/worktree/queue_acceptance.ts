/** Planned queue admission shares the acceptance subject and exact decision boundary. */
import { uniqueCheckpointDrops } from "../../shared/checkpoint_drops.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import {
  appliedResult,
  type DiscernResult,
  type EnginePlan,
  previewResult,
} from "../../shared/result.ts";
import type {
  AcceptData,
  QueueSubmissionData,
  SubmissionRevision,
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
} from "./accept_decisions.ts";
import type { AcceptRequest } from "./accept.ts";
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
import { submissionPlanToEngine } from "./plan.ts";

/** The shared read-only submission plan, resolved from complete current Proof. */
async function submissionPlan(ctx: LifecycleContext, target?: string): Promise<{
  effort: EffortCheckout;
  subject: LandingSubject;
  revision: SubmissionRevision;
  data: QueueSubmissionData;
  plan: EnginePlan;
}> {
  await assertProjectRootIsRepoToplevel(ctx, "accept");
  const effort = await effortCheckout(ctx, target);
  if (effort === undefined) {
    throw new WorktreeGitError(
      "Run discern accept --queue-only from the proven effort's worktree, or select it with --target.",
    );
  }
  const subject = await resolveSubject(effort);
  if (subject === undefined || !subject.atHead) {
    throw new WorktreeGitError(
      `${effort.branch} has no current complete Proof. Commit the work and run discern done, then discern accept --queue-only.`,
    );
  }
  const clean = await runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ], { cwd: effort.path });
  if (!clean.success || clean.stdout !== "") {
    throw new WorktreeGitError(
      "Submission requires a readable, clean worktree. Commit the intended work and run discern done, then discern accept --queue-only.",
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
  const revision: SubmissionRevision = {
    path: effort.path,
    branch: effort.branch,
    head: subject.head,
    proof: {
      candidate_id: subject.complete.candidate_id,
      proof_id: subject.complete.proof_id,
    },
  };
  const data: QueueSubmissionData = {
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
    revision,
    data,
    plan: submissionPlanToEngine({
      path: effort.path,
      branch: effort.branch,
      head: subject.head,
      authority: landingAuthorityDetail(authority, false),
      ...(data.replaces === undefined ? {} : { replaces: data.replaces }),
      unchanged,
    }),
  };
}

/** Plan and record a proven revision without acquiring the landing turn or starting checks. */
export async function queueAcceptanceResult(
  ctx: LifecycleContext,
  request: AcceptRequest,
): Promise<DiscernResult<AcceptData>> {
  if (
    request.confirmed || request.variance.length > 0 ||
    request.approveStandard.length > 0 || request.met.length > 0 ||
    request.unmet !== undefined || request.composition !== undefined
  ) {
    return {
      ok: false,
      verb: "accept",
      error: "invalid_arguments",
      message:
        "Queue-only admission cannot grant permission, approve exceptions, or answer integration questions. Use ordinary accept for those exact decisions; queueing reuses recorded authority.",
    };
  }
  try {
    const initial = await submissionPlan(ctx, request.target);
    if (
      request.expected !== undefined &&
      !sameSubmissionRevision(request.expected, initial.revision)
    ) {
      throw new WorktreeGitError(
        "The reviewed revision changed. Open a fresh submission plan; no revision was queued.",
      );
    }
    if (request.dryRun) {
      return {
        ...previewResult("accept", initial.plan),
        data: { revision: initial.revision, submission: initial.data },
      };
    }
    return await withCompletionCheckout(initial.effort.path, async (signal) => {
      // The publication is short and has no project command or capacity wait.
      return await withCompletionPublication(initial.effort.path, async () => {
        const current = await submissionPlan(
          await lifecycleContext(initial.effort.path, ctx.log),
        );
        if (!sameSubmissionRevision(initial.revision, current.revision)) {
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
            "accept",
            current.plan.steps.map((step) => ({
              step,
              outcome: "ok" as const,
            })),
          ),
          data: {
            revision: current.revision,
            submission: {
              ...current.data,
              state: "queued" as const,
              submission_id: record.id,
              submitted_at: record.submitted_at,
            },
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
    const mapped = worktreeErrorResult("accept", error);
    if (mapped === undefined) throw error;
    return mapped as DiscernResult<AcceptData>;
  }
}
