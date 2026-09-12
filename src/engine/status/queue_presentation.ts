/** The Landing queue section's lines, derived from status data alone: one
 * submission per line in landing order, the current worktree's own effort
 * marked, each with its authority, readiness, and the single reason it waits. */
import { submissionRowLine } from "../../shared/result_markdown_queue.ts";
import type { StatusData } from "../../shared/result_schemas.ts";

/** Render the queue rows for the terminal dashboard; empty when nothing queues. */
export function landingQueueLines(
  data: Pick<StatusData, "queue" | "worktree">,
): string[] {
  const currentEffort = data.worktree === null ? undefined : data.worktree?.id;
  return (data.queue ?? []).map((row) =>
    submissionRowLine(row, currentEffort, { code: false })
  );
}
