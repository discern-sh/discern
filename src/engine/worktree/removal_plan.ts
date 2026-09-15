/** Shared read-only diagnosis for branch-removing Drop and branch-keeping Park. */

import { ignoredRemovalFingerprint } from "./ignored.ts";
import { basename, join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { isKnownGitCount } from "../../shared/git_count.ts";
import type { LifecycleContext } from "./lifecycle.ts";
import { loadIdentitySettings } from "./identity.ts";
import {
  assertOpSide,
  branchIsMerged,
  commitIsMerged,
  integrationBranch,
  listWorktreeFleet,
  localBranchExists,
  registeredWorktreeId,
  resolveCommonGitDir,
  WorktreeGitError,
  worktreeGitKey,
} from "./git.ts";
import { entriesForWorktree } from "./resources.ts";
import { classifyAutomaticBranchOwnership } from "./ownership.ts";
import type { DropPlan } from "./plan.ts";
import { resolveWorktreeTarget } from "./target_resolution.ts";

/** Bind destructive review to changed content, including untracked files and symlinks. */
async function removalState(path: string): Promise<string> {
  const [status, diff] = await Promise.all([
    runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: path,
    }),
    runGit(["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD"], {
      cwd: path,
    }),
  ]);
  if (!status.success || !diff.success) {
    throw new WorktreeGitError(
      "The checkout contents could not be read. Restore access before reviewing removal.",
    );
  }
  const files: string[] = [];
  for (const entry of parsePorcelainZ(status.stdout)) {
    if (entry.status !== "??") continue;
    try {
      const file = join(path, entry.path);
      const stat = await Deno.lstat(file);
      const contents = stat.isSymlink
        ? await Deno.readLink(file)
        : JSON.stringify(Array.from(await Deno.readFile(file)));
      files.push(`${entry.path}\0${await sha256Hex(contents)}`);
    } catch (error) {
      throw new WorktreeGitError(
        `Could not read ${entry.path} for removal review: ${
          error instanceof Error ? error.message : String(error)
        }. Restore access and review again.`,
        { cause: error },
      );
    }
  }
  const ignored = await ignoredRemovalFingerprint(path);
  if (ignored === undefined) {
    throw new WorktreeGitError(
      "Ignored files could not be read for removal review. Restore access and review again.",
    );
  }
  return await sha256Hex(
    JSON.stringify([status.stdout, diff.stdout, files, ignored]),
  );
}

/**
 * Resolve a worktree and retain every uncertainty as a blocker. The caller
 * chooses whether the eventual operation deletes or keeps the branch.
 */
export async function buildRemovalPlan(
  ctx: LifecycleContext,
  target: string,
  operation: "drop" | "park" = "drop",
): Promise<DropPlan> {
  await assertOpSide(
    operation === "drop" ? "worktree-drop" : "worktree-park",
    ctx.cwd,
  );
  const command = `discern worktree ${operation}`;
  if (target.trim() === "") {
    throw new WorktreeGitError(
      `${command} needs a target. Pass a worktree id or path, then re-run.`,
    );
  }
  const trunk = integrationBranch(ctx.config.repository.trunk);
  const fleet = (await listWorktreeFleet(ctx.cwd, trunk)).filter((row) =>
    !row.isMain
  );
  if (fleet.length === 0) {
    throw new WorktreeGitError(
      `There are no worktrees to ${operation}. Run \`discern status\` to review the current ` +
        "worktrees; if none is listed, there is nothing to remove.",
    );
  }

  const resolved = await resolveWorktreeTarget(ctx.root, target, {
    cwd: ctx.cwd,
    mode: "registered",
    includeMain: false,
    command,
  });
  const match = fleet.find((row) => row.path === resolved.path);
  if (match === undefined) {
    throw new WorktreeGitError(
      `${command} could not read the selected worktree's Git state. Run \`discern status\`, repair the listed checkout, then re-run.`,
    );
  }
  const settings = await loadIdentitySettings(ctx.root).catch(() => {
    // discern-best-effort: lifecycle-drop-identity-settings-fallback
    return undefined;
  });
  if (match.locked) {
    throw new WorktreeGitError(
      `Worktree '${basename(match.path)}' is locked (git worktree lock), so ` +
        `discern will not remove it — not even with --force. Unlock it first ` +
        `(git worktree unlock ${match.path}), then re-run.`,
    );
  }

  const blockers: string[] = [];
  const trunkExists = await localBranchExists(ctx.root, trunk);
  if (match.snapshot === undefined) {
    if (!trunkExists) {
      blockers.push(
        `cannot verify the work is merged (no local '${trunk}' branch)`,
      );
    } else if (
      match.branch !== "" && match.branch !== trunk &&
      !(await branchIsMerged(ctx.root, match.branch, trunk))
    ) {
      blockers.push(`branch '${match.branch}' has commits not on ${trunk}`);
    }
    blockers.push(
      "the worktree's git state could not be read (its checkout is missing " +
        "or damaged), so uncommitted work cannot be ruled out",
    );
  } else {
    if (match.snapshot.changedFiles > 0) {
      blockers.push(
        `${match.snapshot.changedFiles} uncommitted change${
          match.snapshot.changedFiles === 1 ? "" : "s"
        }`,
      );
    }
    if (trunkExists) {
      if (!isKnownGitCount(match.snapshot.ahead)) {
        blockers.push(`cannot read how many commits are not on ${trunk}`);
      } else if (match.snapshot.ahead > 0) {
        blockers.push(
          `${match.snapshot.ahead} commit${
            match.snapshot.ahead === 1 ? "" : "s"
          } not on ${trunk}`,
        );
      }
    } else {
      blockers.push(
        `cannot verify the work is merged (no local '${trunk}' branch)`,
      );
    }
  }

  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(match.path);
  const entries = commonGitDir !== undefined && gitKey !== undefined
    ? await entriesForWorktree(commonGitDir, gitKey)
    : [];
  const resolvedId = settings === undefined
    ? undefined
    : await registeredWorktreeId(match.path, ctx.root, settings);
  const branchOwnership = settings === undefined || resolvedId === undefined
    ? { owned: false as const, reason: "worktree identity is unavailable" }
    : classifyAutomaticBranchOwnership({
      kind: "worktree",
      branch: match.branch,
      id: resolvedId,
      settings,
      source: "registered",
    });
  const deletableLineOfWork = match.branch !== "" && match.branch !== trunk;
  const detachedHeadNeedsRecovery = match.branch === "" &&
    (!trunkExists || !(await commitIsMerged(ctx.root, match.head, trunk)));
  const deleteBranch = deletableLineOfWork && branchOwnership.owned;

  const state = match.snapshot === undefined
    ? undefined
    : await removalState(match.path);
  return {
    ...(state === undefined ? {} : { state }),
    targetPath: match.path,
    id: resolvedId ?? basename(match.path),
    branch: match.branch,
    head: match.head,
    ...(match.snapshot === undefined ? {} : { clean: match.snapshot.clean }),
    deleteBranch,
    preserveHead: deleteBranch || detachedHeadNeedsRecovery,
    ...(match.branch !== "" && !(deletableLineOfWork && branchOwnership.owned)
      ? {
        branchKeepReason: match.branch === trunk
          ? "the trunk is never deleted"
          : `${match.branch} is outside discern ownership (${branchOwnership.reason}) — kept`,
      }
      : {}),
    blockers,
    entries,
  };
}
