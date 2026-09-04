/** Pure worktree-placement convention shared by provider and path consumers. */

import { basename, dirname, join } from "@std/path";
import type { DiscernConfig } from "../shared/config_schema.ts";
import { DEFAULT_WORKTREE_ROOT_SUFFIX } from "../shared/git_conventions.ts";

/**
 * The directory under which per-worktree `<name>` checkouts are created — the
 * one resolver every spawn path and orphan sweep shares. An empty configured
 * root selects a visible sibling `<repo>.worktrees` directory; a relative root
 * resolves against the repository; an absolute root remains unchanged.
 */
export function resolveWorktreeRoot(
  repoRoot: string,
  config: DiscernConfig,
): string {
  const configured = config.worktree.root;
  if (configured === "") {
    return join(
      dirname(repoRoot),
      `${basename(repoRoot)}${DEFAULT_WORKTREE_ROOT_SUFFIX}`,
    );
  }
  return configured.startsWith("/") ? configured : join(repoRoot, configured);
}
