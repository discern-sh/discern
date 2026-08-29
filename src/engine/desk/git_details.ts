/** Git divergence facts for one healthy Desk task. */

import {
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import type { DeskDetail } from "./model.ts";

type CountedNoun = (
  count: number,
  singular: string,
  pluralForm?: string,
) => string;

/** Render observed Git counts, omitting degraded rows whose facts are unknown. */
export function gitDetails(
  entry: StatusFleetEntry,
  trunk: string,
  countedNoun: CountedNoun,
): DeskDetail[] {
  if (
    entry.broken === true || entry.git_unavailable === true ||
    entry.setup?.state === "incomplete" ||
    entry.setup?.state === "unavailable"
  ) return [];
  const details: DeskDetail[] = [];
  if (entry.clean === false) {
    details.push({
      kind: "git",
      text: entry.changed_files === undefined
        ? "Uncommitted file count unavailable"
        : countedNoun(entry.changed_files, "uncommitted file"),
    });
  }
  if (entry.ahead === UNKNOWN_GIT_COUNT) {
    details.push({
      kind: "git",
      text: `Ahead count versus ${trunk} unavailable`,
    });
  } else if (entry.ahead !== undefined && isPositiveGitCount(entry.ahead)) {
    details.push({
      kind: "git",
      text: `${countedNoun(entry.ahead, "commit")} ahead of ${trunk}`,
    });
  }
  if (entry.behind === UNKNOWN_GIT_COUNT) {
    details.push({
      kind: "git",
      text: `Behind count versus ${trunk} unavailable`,
    });
  } else if (
    entry.behind !== undefined && isPositiveGitCount(entry.behind)
  ) {
    details.push({
      kind: "git",
      text: `${countedNoun(entry.behind, "commit")} behind ${trunk}`,
    });
  }
  return details;
}
