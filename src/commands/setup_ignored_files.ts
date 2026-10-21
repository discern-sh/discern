/**
 * How `setup begin`'s machinery commit stages integration files.
 *
 * discern's `.gitignore` block re-includes the integration files the project's
 * own rules exclude (ADR 0428), so most need no special handling. Two cases
 * remain:
 *  - a rule the block cannot override still matches, such as this machine's
 *    global excludes or a nested `.gitignore`. Those files are staged with
 *    `--force`: the project's rules allow them, and once tracked no ignore rule
 *    applies;
 *  - the file already existed, untracked, holding content discern did not
 *    write. It may carry personal settings or credentials, so setup leaves it
 *    out of the commit and tells the coding agent, which decides with the owner
 *    only when the file does not settle it.
 */

import {
  existingIntegrationFiles,
  ignoredIntegrationFiles,
} from "../lib/ignored_integration_files.ts";
import { runGit } from "../shared/subprocess.ts";

/** How the machinery commit treats integration files. */
export interface IntegrationStaging {
  /** Paths staged with `--force` because an ignore rule still matches. */
  readonly force: ReadonlySet<string>;
  /** Pre-existing files with other content, left for the coding agent. */
  readonly leaveOut: readonly string[];
}

/** Nothing to force or leave out. */
export const PLAIN_STAGING: IntegrationStaging = {
  force: new Set(),
  leaveOut: [],
};

/** The integration files that already hold someone else's content, found
 * before setup writes its own entries into them. Empty when Git cannot answer. */
export async function integrationFilesToLeaveOut(
  root: string,
  agents: readonly string[],
): Promise<string[]> {
  return await existingIntegrationFiles(root, agents) ?? [];
}

/** Resolve the staging plan after the scaffold has written discern's block. */
export async function integrationStaging(
  root: string,
  agents: readonly string[],
  leaveOut: readonly string[],
): Promise<IntegrationStaging> {
  const ignored = await ignoredIntegrationFiles(root, agents) ?? [];
  return {
    force: new Set(ignored.map((file) => file.path)),
    leaveOut,
  };
}

/**
 * Stage `paths`, forcing exactly the plan's still-ignored integration files
 * and leaving its pre-existing ones out. Returns the paths staged, or Git's
 * failure.
 */
export async function stageMachineryPaths(
  root: string,
  paths: readonly string[],
  staging: IntegrationStaging,
): Promise<{ staged: string[] } | { stderr: string }> {
  const leaveOut = new Set(staging.leaveOut);
  const staged = paths.filter((path) => !leaveOut.has(path));
  const forced = staged.filter((path) => staging.force.has(path));
  const plain = staged.filter((path) => !staging.force.has(path));
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
