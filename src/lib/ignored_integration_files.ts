/**
 * Integration files a project's own ignore rules exclude.
 *
 * discern writes each selected provider's Shared integration files (MCP
 * config, hooks, app and rules files) and expects Git to track them, so a bare
 * clone, a cloud agent's only view, carries discern's wiring. A project whose
 * ignore rules exclude a provider folder breaks that expectation without a
 * word: `git add` refuses the file, and refresh keeps regenerating a copy only
 * this checkout has. discern's `.gitignore` block re-includes what the
 * project's root rules exclude; this probe asks Git what still applies, for
 * setup's commit and for `doctor`. `src/shared/ignored_integration.ts` holds the
 * answer's shape.
 */

import { join } from "@std/path";
import { runGit } from "../shared/subprocess.ts";
import { readTextIfExists } from "../shared/fs_presence.ts";
import { splitNulRecords } from "../shared/git_paths.ts";
import { trackedSharedProviderPaths } from "./artifact_ownership.ts";
import { ignoreRuleMatches } from "./git.ts";
import type { IgnoredIntegrationFile } from "../shared/ignored_integration.ts";

/**
 * Every integration file of these agents that an ignore rule matches, with
 * whether Git tracks it, in registry order. `undefined` when Git cannot answer.
 */
export async function ignoredIntegrationFiles(
  root: string,
  agents: readonly string[],
): Promise<IgnoredIntegrationFile[] | undefined> {
  const paths = trackedSharedProviderPaths(agents);
  const rules = await ignoreRuleMatches(root, paths);
  if (rules === undefined) return undefined;
  const matched = paths.flatMap((path) => {
    const match = rules.get(path);
    return match === undefined ? [] : [match];
  });
  if (matched.length === 0) return [];
  const listed = await runGit(
    [
      "--literal-pathspecs",
      "ls-files",
      "-z",
      "--",
      ...matched.map((match) => match.path),
    ],
    { cwd: root },
  );
  if (!listed.success) return undefined;
  const tracked = new Set(splitNulRecords(listed.stdout));
  return matched.map((match) => ({
    ...match,
    tracked: tracked.has(match.path),
  }));
}

/**
 * Integration files of these agents that already exist, untracked, holding
 * content discern did not write — before setup writes its own entries. Such a
 * file may carry personal settings or credentials, so setup leaves it out of
 * its commit for the coding agent to resolve. `undefined` when Git cannot answer.
 */
export async function existingIntegrationFiles(
  root: string,
  agents: readonly string[],
): Promise<string[] | undefined> {
  const present: string[] = [];
  for (const path of trackedSharedProviderPaths(agents)) {
    const text = await readTextIfExists(join(root, path));
    if (text !== undefined && holdsContent(path, text)) present.push(path);
  }
  if (present.length === 0) return [];
  const listed = await runGit(
    ["--literal-pathspecs", "ls-files", "-z", "--", ...present],
    { cwd: root },
  );
  if (!listed.success) return undefined;
  const tracked = new Set(splitNulRecords(listed.stdout));
  return present.filter((path) => !tracked.has(path));
}

/** Whether a file says anything: JSON other than an empty object, or any
 * line that is neither blank nor a comment. Malformed JSON counts, since it
 * cannot prove the file empty. */
function holdsContent(path: string, text: string): boolean {
  if (path.endsWith(".json")) {
    const compact = text.replace(/\s/gu, "");
    return compact !== "" && compact !== "{}";
  }
  return text.split(/\r?\n/u).some((line) =>
    line.trim() !== "" && !line.trim().startsWith("#")
  );
}
