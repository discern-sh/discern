/** The Landing queue section's lines, derived from status data alone: one
 * unlanded effort per line in landing order, the current worktree's own
 * effort marked, each with its readiness and the single reason it waits. */
import { queueRowStateLabel } from "../../shared/result_markdown_queue.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import type { StatusData } from "../../shared/result_schemas.ts";

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
