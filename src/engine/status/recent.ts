/** Bounded local Park and completion evidence for the main status view. */

import type {
  StatusData,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import { recordedTaskMetadataData } from "../../shared/task_metadata.ts";
import {
  type BranchLogbookActivity,
  type DurationPrior,
  readRecentLogbookStream,
} from "../logbook/read.ts";
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

/** Later of 2 ISO timestamps, preserving the available value when only one parses. */
export function latestActivity(
  gitAt: string | undefined,
  logbookAt: string | undefined,
): string | undefined {
  if (gitAt === undefined) {
    return logbookAt;
  }
  if (logbookAt === undefined) {
    return gitAt;
  }
  const gitMs = Date.parse(gitAt);
  const logbookMs = Date.parse(logbookAt);
  if (Number.isNaN(logbookMs)) {
    return gitAt;
  }
  if (Number.isNaN(gitMs)) {
    return logbookAt;
  }
  return logbookMs > gitMs ? logbookAt : gitAt;
}

/** Join one fleet row to the bounded logbook read for its branch. */
export function applyLogbookActivity(
  entry: StatusFleetEntry,
  activity: BranchLogbookActivity | undefined,
  durationPriors: ReadonlyMap<string, DurationPrior> | undefined,
  nowMs: number,
): StatusFleetEntry {
  if (activity === undefined) {
    return entry;
  }
  entry.last_activity = latestActivity(
    entry.last_activity,
    activity.lastEventAt,
  );
  if (activity.lastAction !== undefined) {
    entry.last_action = {
      verb: activity.lastAction.verb,
      outcome: activity.lastAction.outcome,
      at: activity.lastAction.at,
      ...(activity.lastAction.failedStage !== undefined
        ? { failed_stage: activity.lastAction.failedStage }
        : {}),
    };
  }
  if (activity.running !== undefined) {
    const startedMs = Date.parse(activity.running.started);
    const typical = durationPriors?.get(activity.running.verb)?.medianMs;
    entry.running = {
      verb: activity.running.verb,
      started: activity.running.started,
      elapsed_ms: Number.isNaN(startedMs) ? 0 : Math.max(0, nowMs - startedMs),
      ...(typical !== undefined ? { typical_duration_ms: typical } : {}),
    };
  }
  return entry;
}
