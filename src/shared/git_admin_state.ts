/**
 * Subprocess-bound façade for Discern-owned Git administration state.
 *
 * The registry and path computation live in the dependency-free
 * `git_admin_paths.ts` leaf. Ordinary callers retain the historical
 * `gitAdminStatePath(cwd, key)` API here; low-level subprocess consumers inject
 * the runner directly into the leaf and never circle back through this façade.
 */

import { join } from "@std/path";
import {
  GIT_ADMIN_STATE_NAMESPACE,
  type GitAdminPathRunner,
  type GitAdminStateKey,
  gitReportedAdminPath,
  resolveGitAdminStatePath,
} from "./git_admin_paths.ts";
import { runGit } from "./subprocess.ts";

export {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  GIT_ADMIN_STATE_NAMESPACE,
  type GitAdminPathResult,
  type GitAdminPathRunner,
  type GitAdminStateKey,
  VALIDATION_ADMIN_STATE_KEYS,
  type ValidationAdminStateKey,
  WORKTREE_ADMIN_STATE_KEYS,
  type WorktreeAdminStateKey,
} from "./git_admin_paths.ts";

/** Ordinary unbounded admin-path resolution for non-capture callers. */
const defaultGitAdminPathRunner: GitAdminPathRunner = async (cwd, args) =>
  await runGit(args, { cwd });

/** Resolve one registered admin-state entry for the repository at `cwd`. */
export async function gitAdminStatePath(
  cwd: string,
  key: GitAdminStateKey,
  runner: GitAdminPathRunner = defaultGitAdminPathRunner,
): Promise<string | undefined> {
  return await resolveGitAdminStatePath(cwd, key, runner);
}

/**
 * The distinct Discern namespace directories in the worktree and common Git
 * administration areas. Uninstall removes both whole directories.
 */
export async function gitAdminNamespaceDirs(cwd: string): Promise<string[]> {
  const probes: string[][] = [
    ["rev-parse", "--absolute-git-dir"],
    ["rev-parse", "--git-common-dir"],
  ];
  const dirs: string[] = [];
  for (const probe of probes) {
    const resolved = await gitReportedAdminPath(
      cwd,
      probe,
      defaultGitAdminPathRunner,
    );
    if (resolved === undefined) continue;
    const dir = join(resolved, GIT_ADMIN_STATE_NAMESPACE);
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}
