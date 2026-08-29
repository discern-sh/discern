/** Shared read-only diagnosis for branch-removing Drop and branch-keeping Park. */

import { basename, isAbsolute, resolve } from "@std/path";
import { realPathIfExists } from "../../shared/fs_presence.ts";
import { isKnownGitCount } from "../../shared/git_count.ts";
import type { LifecycleContext } from "./lifecycle.ts";
import { loadIdentitySettings, resolveWorktreeId } from "./identity.ts";
import {
  assertOpSide,
  branchIsMerged,
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

  const wanted = target.trim().replace(/\/+$/, "");
  const resolvedWanted = resolve(wanted);
  const wantedAbs = isAbsolute(wanted) || wanted.includes("/")
    ? await realPathIfExists(resolvedWanted) ?? resolvedWanted
    : undefined;
  const settings = await loadIdentitySettings(ctx.root).catch(() => {
    // discern-best-effort: lifecycle-drop-identity-settings-fallback
    return undefined;
  });
  const matches: Array<(typeof fleet)[number]> = [];
  for (const row of fleet) {
    if (wantedAbs !== undefined) {
      if (row.path === wantedAbs) {
        matches.push(row);
      }
      continue;
    }
    if (basename(row.path) === wanted) {
      matches.push(row);
      continue;
    }
    if (settings !== undefined) {
      const id = await resolveWorktreeId(settings, row.path).catch(() => {
        // discern-best-effort: lifecycle-drop-row-identity-fallback
        return undefined;
      });
      if (id === wanted) {
        matches.push(row);
      }
    }
  }
  if (matches.length > 1) {
    const candidates = matches.map((row) => `- ${row.path}`).sort().join("\n");
    throw new WorktreeGitError(
      `\`${command}\` can't resolve '${target}': it matches more ` +
        `than one registered worktree:\n${candidates}\n` +
        "Pass one of these paths as the target, then re-run.",
    );
  }
  const match = matches[0];
  if (match === undefined) {
    const known = fleet.map((row) => basename(row.path)).join(", ");
    throw new WorktreeGitError(
      `No worktree matches '${target}'. Known worktrees: ${known}. ` +
        `Pass one of those worktree ids (the directory name) or its path, then re-run.`,
    );
  }
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

  return {
    targetPath: match.path,
    id: resolvedId ?? basename(match.path),
    branch: match.branch,
    head: match.head,
    ...(match.snapshot === undefined ? {} : { clean: match.snapshot.clean }),
    deleteBranch: deletableLineOfWork && branchOwnership.owned,
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
