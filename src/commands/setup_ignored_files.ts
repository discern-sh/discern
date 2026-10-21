/**
 * `setup begin`'s handling of integration files the project's own ignore
 * rules exclude. `verify` serves the owner's decision; `begin` applies it to
 * the machinery commit, which would otherwise fail on the first such file:
 *  - `track-anyway` stages those files with `--force`, once. Git then tracks
 *    them, and the rule keeps ignoring everything else it matches;
 *  - `keep-local` leaves them out of the commit and records them in
 *    `[project].local_integration_files`, so `doctor` knows the choice was made;
 *  - changing the rule happens before setup, so `begin` simply finds nothing.
 * Without a choice, `begin` refuses before writing anything.
 */

import { ignoredIntegrationFiles } from "../lib/ignored_integration_files.ts";
import type { Logger } from "../lib/log.ts";
import { discernCommand, flag } from "../shared/command_reference.ts";
import { fire, HINTS, hintTexts } from "../shared/hints.ts";
import {
  describeIgnoredFiles,
  IGNORED_INTEGRATION_FLAG,
  type IgnoredIntegrationChoice,
  type IgnoredIntegrationFile,
  untrackedIgnoredFiles,
} from "../shared/ignored_integration.ts";
import { runGit } from "../shared/subprocess.ts";

/** How the machinery commit treats the ignored integration files. */
export interface IgnoredFilesPlan {
  /** The untracked files the owner's choice covers. */
  readonly decided: readonly IgnoredIntegrationFile[];
  readonly choice: IgnoredIntegrationChoice | undefined;
  /** Paths staged with `--force`: already tracked beneath an ignored folder
   * (plain `git add` stages them but still exits 1), or tracked anyway. */
  readonly force: ReadonlySet<string>;
  /** Paths left out of the commit and recorded as kept local. */
  readonly keepLocal: readonly string[];
}

/** No ignore rule matches any integration file. */
export const NO_IGNORED_FILES: IgnoredFilesPlan = {
  decided: [],
  choice: undefined,
  force: new Set(),
  keepLocal: [],
};

/**
 * Probe the selected agents' integration files and resolve the owner's
 * choice. `awaiting` lists the untracked matches when no choice was given.
 */
export async function planIgnoredFiles(
  root: string,
  agents: readonly string[],
  choice: IgnoredIntegrationChoice | undefined,
): Promise<
  { plan: IgnoredFilesPlan } | { awaiting: IgnoredIntegrationFile[] }
> {
  const matched = await ignoredIntegrationFiles(root, agents);
  if (matched === undefined || matched.length === 0) {
    return { plan: NO_IGNORED_FILES };
  }
  const decided = untrackedIgnoredFiles(matched);
  if (decided.length > 0 && choice === undefined) {
    return { awaiting: decided };
  }
  const trackedPaths = matched.filter((file) => file.tracked).map((file) =>
    file.path
  );
  const decidedPaths = decided.map((file) => file.path);
  return {
    plan: {
      decided,
      choice: decided.length === 0 ? undefined : choice,
      force: new Set([
        ...trackedPaths,
        ...(choice === "track-anyway" ? decidedPaths : []),
      ]),
      keepLocal: choice === "keep-local" ? decidedPaths : [],
    },
  };
}

/**
 * Stage `paths`, forcing exactly the plan's paths past the project's ignore
 * rules and leaving its kept-local paths out. Returns the paths staged, or
 * Git's failure.
 */
export async function stageMachineryPaths(
  root: string,
  paths: readonly string[],
  plan: IgnoredFilesPlan,
): Promise<{ staged: string[] } | { stderr: string }> {
  const keepLocal = new Set(plan.keepLocal);
  const staged = paths.filter((path) => !keepLocal.has(path));
  const forced = staged.filter((path) => plan.force.has(path));
  const plain = staged.filter((path) => !plan.force.has(path));
  for (
    const [args, group] of [
      [["add", "--"], plain],
      [["add", "--force", "--"], forced],
    ] as const
  ) {
    if (group.length === 0) continue;
    const add = await runGit([...args, ...group], { cwd: root });
    if (!add.success) return { stderr: add.stderr };
  }
  return { staged };
}

/**
 * Refuse `begin` before any write: the project's ignore rules exclude
 * untracked integration files and the owner has not chosen how to treat
 * them. Re-serves the question with both retries.
 */
export function emitAwaitingIgnoredFilesChoice(
  log: Logger,
  json: boolean,
  files: readonly IgnoredIntegrationFile[],
  retry: (choice: IgnoredIntegrationChoice) => string,
): number {
  const described = describeIgnoredFiles(files);
  const message =
    `The project's ignore rules exclude integration files setup would commit: ${described}. ` +
    "Setup needs the owner's choice before it writes anything: commit them anyway, keep them on this machine, or change the rule.";
  const next = retry("track-anyway");
  if (json) {
    log.result({
      ok: false,
      verb: "setup begin",
      error: "awaiting_decision",
      message,
      data: { next_action: next, command: next },
      hints: hintTexts([
        fire(HINTS["setup-awaiting-ignored-files-choice"], {
          files: described,
          track: discernCommand(
            "setup begin",
            flag(IGNORED_INTEGRATION_FLAG, "track-anyway"),
          ),
          keepLocal: discernCommand(
            "setup begin",
            flag(IGNORED_INTEGRATION_FLAG, "keep-local"),
          ),
        }),
      ]),
    });
  } else {
    log.error(message);
    log.detail(`Commit them anyway: ${next}`);
    log.detail(`Keep them on this machine: ${retry("keep-local")}`);
    log.detail(
      "Change the rule: commit that change, then run `discern setup verify` again.",
    );
  }
  return 1;
}
