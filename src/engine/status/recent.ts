/** Bounded local Park and completion evidence for the main status view. */

import type { StatusData } from "../../shared/result_schemas.ts";
import { recordedTaskMetadataData } from "../../shared/task_metadata.ts";
import { readRecentLogbookStream } from "../logbook/read.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { listParkedTaskMetadata } from "../worktree/parked_task_metadata.ts";

const RECENT_COMPLETED_TASK_LIMIT = 8;

/** Project a bounded local landing tail without creating another task archive. */
export async function recentCompletedTasks(
  root: string,
  logbookEnabled: boolean,
  landed: StatusData["landed_proof"],
): Promise<NonNullable<StatusData["recent_completed_tasks"]>> {
  const completed: NonNullable<StatusData["recent_completed_tasks"]> = [];
  if (logbookEnabled) {
    const commonGitDir = await resolveCommonGitDir(root);
    if (commonGitDir !== undefined) {
      const stream = await readRecentLogbookStream(commonGitDir, 200);
      for (const event of [...stream.events].reverse()) {
        if (
          event.kind !== "verb" || event.verb !== "accept" ||
          event.outcome !== "ok" || event.dry_run === true ||
          typeof event.branch !== "string"
        ) continue;
        if (completed.length >= RECENT_COMPLETED_TASK_LIMIT) break;
        const head = typeof event.head === "string" ? event.head : undefined;
        completed.push({
          branch: event.branch,
          completed_at: event.at,
          ...(head === undefined ? {} : { head }),
          ...(landed !== undefined && head !== undefined &&
              landed.commit.startsWith(head)
            ? { proof_line: landed.proof.line }
            : {}),
        });
      }
    }
  }
  if (
    landed?.commit_at !== undefined &&
    !completed.some((entry) =>
      entry.head !== undefined && landed.commit.startsWith(entry.head)
    )
  ) {
    completed.unshift({
      branch: landed.proof.branch,
      head: landed.proof.head,
      completed_at: landed.commit_at,
      proof_line: landed.proof.line,
    });
  }
  return completed.slice(0, RECENT_COMPLETED_TASK_LIMIT);
}

/** Join Park wording to the authoritative worktree-less branch population. */
export async function parkedTaskEvidence(
  root: string,
  dangling: readonly string[],
): Promise<Pick<StatusData, "parked_tasks" | "parked_tasks_unavailable">> {
  try {
    const parked = await listParkedTaskMetadata(root);
    const matching = parked.filter((record) => dangling.includes(record.branch))
      .map((record) => ({
        id: record.id,
        branch: record.branch,
        head: record.head,
        parked_at: record.parked_at,
        task: recordedTaskMetadataData(
          { id: record.id, branch: record.branch },
          record.task,
        ),
      }));
    return matching.length === 0 ? {} : { parked_tasks: matching };
  } catch (error) {
    return {
      parked_tasks_unavailable: {
        reason: error instanceof Error ? error.message : String(error),
        next_command: "discern doctor",
      },
    };
  }
}
