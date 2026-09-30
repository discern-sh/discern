/**
 * Locate a repository's main checkout through Git alone.
 *
 * The module depends on the shared Git runner and filesystem probes only, never
 * on presentation code. Repository tooling that links a local design-system
 * checkout loads it under the committed dependency graph, so the lookup must
 * stay loadable while the product modules that render terminal output are
 * migrating to a newer package API.
 */

import { directoryExists } from "./fs_presence.ts";
import { type GitResult, runGit } from "./subprocess.ts";

/**
 * Thin binding to the shared git runner in the positional `(args, cwd?)` call
 * shape this lookup and the worktree git mechanics share. An omitted
 * `cwd` means "run in the process directory" — resolved to {@link Deno.cwd} here so
 * the choice is explicit at the runGit boundary, which requires the execution root
 * rather than inheriting it. The spawn itself — GIT_BIN, decoding, the no-git
 * fallback — lives once in {@link runGit}.
 */
export function git(
  args: string[],
  cwd: string = Deno.cwd(),
): Promise<GitResult> {
  return runGit(args, {
    cwd,
    quiesceDescendants: true,
  });
}

/** Canonicalize a path, retaining an absent path for missing-target workflows. */
export async function realPathOr(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return path;
    throw error;
  }
}

/** The first `worktree ` path printed by `git worktree list --porcelain`. */
export async function firstWorktreePath(
  cwd?: string,
): Promise<string | undefined> {
  const run = await git(["worktree", "list", "--porcelain"], cwd);
  if (!run.success) {
    return undefined;
  }
  for (const line of run.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      return line.slice("worktree ".length);
    }
  }
  return undefined;
}

/**
 * Resolve the MAIN repository path — the first `worktree` entry of `git worktree
 * list --porcelain`, canonicalized. Returns undefined when not in a git repo or
 * the path does not exist. Mirrors `main_repo_path`.
 */
export async function mainRepoPath(cwd?: string): Promise<string | undefined> {
  const first = await firstWorktreePath(cwd);
  if (first === undefined || first === "") {
    return undefined;
  }
  if (!(await directoryExists(first))) {
    return undefined;
  }
  return await realPathOr(first);
}
