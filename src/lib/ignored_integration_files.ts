/**
 * Integration files a project's own ignore rules exclude.
 *
 * discern writes each selected provider's Shared integration files (MCP
 * config, hooks, app and rules files) and expects Git to track them, so a bare
 * clone, a cloud agent's only view, carries discern's wiring. A project whose
 * ignore rules exclude a provider folder breaks that expectation without a
 * word: `git add` refuses the file, and refresh keeps regenerating a copy only
 * this checkout has. Setup's preflight and `begin`, and `doctor`, ask the same
 * question here so they can never disagree about which files are affected;
 * `src/shared/ignored_integration.ts` holds the answer's shape.
 */

import { runGit } from "../shared/subprocess.ts";
import { splitNulRecords } from "../shared/git_paths.ts";
import { trackedSharedProviderPaths } from "./artifact_ownership.ts";
import { ignoreRuleMatches } from "./git.ts";
import type { IgnoredIntegrationFile } from "../shared/ignored_integration.ts";

/**
 * Every tracked Shared integration file of these agents that an ignore rule
 * matches, in registry order. `undefined` when Git cannot answer.
 */
export async function ignoredIntegrationFiles(
  root: string,
  agents: readonly string[],
): Promise<IgnoredIntegrationFile[] | undefined> {
  const paths = trackedSharedProviderPaths(agents);
  const rules = await ignoreRuleMatches(root, paths);
  if (rules === undefined) return undefined;
  const matched = paths.filter((path) => rules.has(path));
  if (matched.length === 0) return [];
  const listed = await runGit(
    ["--literal-pathspecs", "ls-files", "-z", "--", ...matched],
    { cwd: root },
  );
  if (!listed.success) return undefined;
  const tracked = new Set(splitNulRecords(listed.stdout));
  return matched.map((path) => ({
    path,
    rule: rules.get(path) ?? "",
    tracked: tracked.has(path),
  }));
}
