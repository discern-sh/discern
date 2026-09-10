/** The Landing queue section's lines, derived from status data alone: one
 * unlanded effort per line in landing order, the current worktree's own
 * effort marked, each with its readiness and the single reason it waits. */
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { queueRowStateLabel } from "../../shared/result_markdown_queue.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import type { StatusData } from "../../shared/result_schemas.ts";

/** The one capacity sentence: every validation slot in use while queued
 * efforts wait. Who holds the slots is named; counts stay in the data. */
export function queueCapacityHint(
  queue: StatusData["queue"],
  concurrency: number,
): FiredHint | undefined {
  const landing = (queue ?? []).filter((row) => row.readiness === "landing");
  if (
    landing.length < concurrency ||
    !(queue ?? []).some((row) => row.readiness !== "landing")
  ) {
    return undefined;
  }
  return fire(HINTS["status-queue-capacity-saturated"], {
    limit: concurrency,
    holders: landing.map((row) => displayBranch(row.branch)),
  });
}

/** Render the queue rows for the terminal dashboard; empty when nothing queues. */
export function landingQueueLines(
  data: Pick<StatusData, "queue" | "worktree">,
): string[] {
  return (data.queue ?? []).map((row) => {
    const mine = data.worktree !== null && data.worktree?.id === row.effort
      ? " (this effort)"
      : "";
    return `${row.position}. ${displayBranch(row.branch)}${mine} — ${
      queueRowStateLabel(row)
    }${row.reason === undefined ? "" : `: ${row.reason}`}`;
  });
}
