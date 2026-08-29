/** Read and decode the Git evidence used by the Desk review flow. */

import { commandEvidence } from "../../shared/command_evidence.ts";
import { splitNulRecords } from "../../shared/git_paths.ts";
import type { DeskReviewFailure } from "./view.ts";
import type { DeskRuntime } from "./desk.ts";

interface ReviewGitRead {
  readonly output: string;
  readonly failure?: DeskReviewFailure;
}

/** Read one review fact without turning a Git failure into an empty section. */
export async function reviewGitRead(
  runtime: DeskRuntime,
  cwd: string,
  args: string[],
  title: string,
): Promise<ReviewGitRead> {
  const command = commandEvidence(["git", ...args]);
  const result = await runtime.git(args, cwd);
  if (result.success) return { output: result.stdout.trimEnd() };
  return {
    output: "",
    failure: {
      title,
      command,
      detail: result.stderr.trimEnd() || "Git returned a non-zero status.",
      nextAction:
        `Run ${command} in ${cwd}, resolve the reported Git failure, then review the task again.`,
      safeToRetry: true,
    },
  };
}

/** Known line magnitudes for one text file; binary counts stay unavailable. */
export interface NumstatMagnitude {
  readonly added?: number;
  readonly removed?: number;
}

/** Parse Git's tab-delimited numstat without inventing binary-file counts. */
export function parseNumstat(output: string): Map<string, NumstatMagnitude> {
  const magnitudes = new Map<string, NumstatMagnitude>();
  for (const record of splitNulRecords(output)) {
    const first = record.indexOf("\t");
    const second = first === -1 ? -1 : record.indexOf("\t", first + 1);
    if (first === -1 || second === -1) continue;
    const addedRaw = record.slice(0, first);
    const removedRaw = record.slice(first + 1, second);
    const path = record.slice(second + 1);
    if (path === "") continue;
    const added = /^\d+$/.test(addedRaw) ? Number(addedRaw) : undefined;
    const removed = /^\d+$/.test(removedRaw) ? Number(removedRaw) : undefined;
    magnitudes.set(path, {
      ...(added === undefined || !Number.isSafeInteger(added) ? {} : { added }),
      ...(removed === undefined || !Number.isSafeInteger(removed)
        ? {}
        : { removed }),
    });
  }
  return magnitudes;
}
