/**
 * The serial queue walk that follows an explicitly selected landing: the
 * remaining submissions land in the queue's one canonical order, each under
 * its own recorded grant, and the walk stops at the first refusal or failure.
 * `accept.ts` owns the single-effort landing core and injects it here, so
 * this module never imports `accept.ts` at runtime.
 */

import { realPathIfExists } from "../../shared/fs_presence.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  AcceptData,
  LandingOutcomeData,
} from "../../shared/result_schemas.ts";
import { runWithAcceptanceLeaseOnly } from "../operation_lock.ts";
import { readSubmission } from "./submission.ts";
import { short } from "./accept_support.ts";
import { withAcceptanceTransactionLock } from "./acceptance_transaction.ts";
import { WorktreeGitError } from "./git.ts";
import type { LifecycleContext } from "./lifecycle.ts";
import { lifecycleContext, worktreeErrorResult } from "./lifecycle.ts";
import { type SubmissionRow, submissionRows } from "./submissions_view.ts";
import type { AcceptRequest, EffortCheckout } from "./accept.ts";

/** The accept-core callbacks the walk drives, injected to keep the module
 * boundary one-directional. */
export interface WalkDeps {
  /** Select one effort's checkout the way the verb itself does. */
  readonly effortCheckout: (
    ctx: LifecycleContext,
    target: string,
  ) => Promise<EffortCheckout | undefined>;
  /** Decide and perform one effort's landing under its own boundary. */
  readonly landEffortOnce: (
    effort: EffortCheckout,
    request: AcceptRequest,
    env: Pick<typeof Deno.env, "get">,
    operationHandle?: string,
  ) => Promise<DiscernResult<AcceptData>>;
}

/** Project one attempted landing's result onto its canonical outcome row. */
export function landingOutcomeOf(
  row: Pick<SubmissionRow, "effort" | "branch" | "head">,
  selected: boolean,
  result: DiscernResult<AcceptData>,
): LandingOutcomeData {
  const own = result.data?.landings?.[0];
  if (result.ok && own !== undefined) {
    return { ...own, selected };
  }
  const landedAnyway = result.data?.landing?.trunk_landed === true;
  const reason = result.message?.split("\n")[0] ??
    "The landing did not report a reason.";
  return {
    effort: row.effort,
    branch: row.branch,
    head: row.head,
    selected,
    status: landedAnyway ? "failed" : "refused",
    ...(landedAnyway ? {} : {}),
    reason,
  };
}

/**
 * Land the remaining submissions after an explicitly selected landing, in the
 * queue's one canonical order. Each further landing needs its own honored
 * Proof and a verified recorded grant — the conversation covered only the
 * selected landing — and the walk stops at the first refusal or failure.
 */
export async function walkQueue(
  ctx: LifecycleContext,
  effort: EffortCheckout,
  selected: DiscernResult<AcceptData>,
  request: AcceptRequest,
  env: Pick<typeof Deno.env, "get">,
  deps: WalkDeps,
  operationHandle?: string,
): Promise<DiscernResult<AcceptData>> {
  const walkContext = await lifecycleContext(effort.mainRepo, ctx.log);
  const outcomes: LandingOutcomeData[] = [
    ...(selected.data?.landings ?? []),
  ];
  const paragraphs: string[] = [];
  const attempted = new Set([
    await realPathIfExists(effort.path) ?? effort.path,
  ]);
  let stopped: string | undefined;
  while (stopped === undefined) {
    const rows = await submissionRows(effort.mainRepo, effort.trunk);
    const next = rows.find((row) => !attempted.has(row.path));
    if (next === undefined) break;
    attempted.add(next.path);
    let follower: DiscernResult<AcceptData>;
    try {
      const followerEffort = await deps.effortCheckout(walkContext, next.path);
      if (followerEffort === undefined) {
        throw new WorktreeGitError(
          `${next.branch}'s worktree could not be selected for the walk.`,
        );
      }
      if (next.readiness !== "ready") {
        throw new WorktreeGitError(
          next.reason ??
            "The queued revision is not ready. Review the task before resubmitting.",
        );
      }
      const recorded = await readSubmission(next.path);
      if (
        recorded.status !== "submitted" ||
        recorded.submission.head !== next.head
      ) {
        throw new WorktreeGitError(
          "The queued revision changed. Review the current submission and start a fresh acceptance walk.",
        );
      }
      const revision = {
        path: next.path,
        branch: next.branch,
        head: next.head,
        proof: recorded.submission.proof,
      };
      // Serialization stays with the held acceptance lease; the follower's
      // checkout boundary is acquired non-blockingly, so a busy follower
      // refuses and the walk stops there.
      follower = await runWithAcceptanceLeaseOnly(() =>
        withAcceptanceTransactionLock(
          followerEffort.path,
          () =>
            deps.landEffortOnce(
              followerEffort,
              {
                expected: revision,
                dryRun: false,
                confirmed: false,
                variance: [],
                approveStandard: [],
                met: [],
                target: next.path,
                ...(request.cliModel === undefined
                  ? {}
                  : { cliModel: request.cliModel }),
                ...(request.signal === undefined
                  ? {}
                  : { signal: request.signal }),
              },
              env,
              operationHandle,
            ),
        )
      );
    } catch (error) {
      const mapped = worktreeErrorResult("accept", error);
      if (mapped === undefined) throw error;
      follower = mapped as DiscernResult<AcceptData>;
    }
    const outcome = landingOutcomeOf(next, false, follower);
    outcomes.push(outcome);
    if (outcome.status === "landed") {
      paragraphs.push(
        `The walk then landed ${next.branch}'s submission ${short(next.head)}${
          outcome.landed_commit !== undefined &&
            outcome.landed_commit !== next.head
            ? `, composed and proven as ${short(outcome.landed_commit)}`
            : ""
        } under its recorded grant.`,
      );
      continue;
    }
    stopped = next.branch;
    paragraphs.push(
      `The walk stopped at ${next.branch}: ${
        outcome.reason ?? "its landing did not complete."
      }`,
    );
  }
  const queue = await submissionRows(effort.mainRepo, effort.trunk);
  if (queue.length > 0 && stopped === undefined) {
    paragraphs.push(
      `${queue.length} submission${queue.length === 1 ? "" : "s"} remain${
        queue.length === 1 ? "s" : ""
      } in the landing queue.`,
    );
  }
  const walkFailed = outcomes.some((outcome) => outcome.status !== "landed");
  const message = [selected.message, ...paragraphs]
    .filter((paragraph) => paragraph !== undefined && paragraph !== "")
    .join("\n");
  const data: AcceptData = {
    ...(selected.data ?? {}),
    landings: outcomes,
  };
  if (queue.length > 0) data.queue = [...queue];
  if (walkFailed) {
    return {
      ...selected,
      ok: false,
      error: "partial_acceptance",
      message,
      data,
    };
  }
  return { ...selected, message, data };
}
