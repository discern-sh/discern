/** The Landing queue section's lines, derived from status data alone: one
 * unlanded effort per line in landing order, the current worktree's own
 * effort marked, each with its readiness and the single reason it waits. */
import { displayBranch } from "../../shared/result_markdown_values.ts";
import type { StatusData } from "../../shared/result_schemas.ts";

/** One human-readable state label per queue row. */
export function queueRowStateLabel(
  row: { readonly readiness: string; readonly held: boolean },
): string {
  return row.readiness === "ready"
    ? "ready to land"
    : row.readiness === "landing"
    ? "landing now"
    : row.held
    ? "on hold"
    : "waiting";
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
