/** Read-only Git state shared by status, Desk, and lifecycle preconditions. */

import { join } from "@std/path";
import {
  parsePorcelainZ,
  type PorcelainEntry,
} from "../../shared/git_paths.ts";
import {
  type GitCount,
  gitCountFrom,
  isKnownGitCount,
  parseGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import { statIfExists } from "../../shared/fs_presence.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { integrationBranch } from "./trunk.ts";

/** A cheap, read-only snapshot of one checkout. */
export interface GitSnapshot {
  /** The current branch, or "" when detached. */
  branch: string;
  /** No tracked changes and no untracked non-ignored files. */
  clean: boolean;
  /** Count of changed paths reported by porcelain status. */
  changedFiles: number;
  /** Commits on HEAD not yet in the integration branch. */
  ahead: GitCount;
  /** Commits on the integration branch not yet in HEAD. */
  behind: GitCount;
  /** Unix-seconds timestamp of the most recent checkout activity. */
  lastActivity?: number;
}

/** A checkout snapshot or the exact Git read that prevented one. */
export type GitSnapshotInspection =
  | { readonly kind: "available"; readonly snapshot: GitSnapshot }
  | {
    readonly kind: "unavailable";
    readonly command: string;
    readonly reason: string;
  };

/** Thin binding to the shared Git runner for one explicit checkout. */
function git(args: string[], cwd: string): Promise<GitResult> {
  return runGit(args, { cwd, quiesceDescendants: true });
}

/** Commits HEAD is ahead of and behind the integration branch. */
async function aheadBehind(
  cwd: string,
  integration: string,
): Promise<{ ahead: GitCount; behind: GitCount }> {
  const run = await git(
    ["rev-list", "--left-right", "--count", `${integration}...HEAD`],
    cwd,
  );
  if (!run.success) {
    return { ahead: UNKNOWN_GIT_COUNT, behind: UNKNOWN_GIT_COUNT };
  }
  const fields = run.stdout.trim().split(/\s+/);
  if (fields.length !== 2) {
    return { ahead: UNKNOWN_GIT_COUNT, behind: UNKNOWN_GIT_COUNT };
  }
  return {
    behind: parseGitCount(fields[0] ?? ""),
    ahead: parseGitCount(fields[1] ?? ""),
  };
}

/**
 * Read one checkout without mutating it. An unreadable status remains
 * unavailable, so callers can never substitute an optimistic clean state.
 */
export async function inspectGitSnapshot(
  cwd: string,
  mainBranchFallback?: string,
): Promise<GitSnapshotInspection> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.success || inside.stdout.trim() !== "true") {
    return {
      kind: "unavailable",
      command: "git rev-parse --is-inside-work-tree",
      reason: inside.stderr.trim() ||
        "Git did not report this path as a working tree.",
    };
  }
  const [branchRun, statusRun, { ahead, behind }, headMove] = await Promise.all(
    [
      git(["branch", "--show-current"], cwd),
      git(["status", "--porcelain", "-z", "--untracked-files=normal"], cwd),
      aheadBehind(cwd, integrationBranch(mainBranchFallback)),
      lastHeadMoveTime(cwd),
    ],
  );
  if (!statusRun.success) {
    return {
      kind: "unavailable",
      command: "git status --porcelain -z --untracked-files=normal",
      reason: statusRun.stderr.trim() || "Git could not read checkout status.",
    };
  }
  const dirtyEntries = parsePorcelainZ(statusRun.stdout);
  const branch = branchRun.success ? branchRun.stdout.trim() : "";
  const lastActivity = await lastActivityAt(cwd, dirtyEntries, headMove);
  return {
    kind: "available",
    snapshot: {
      branch,
      clean: dirtyEntries.length === 0,
      changedFiles: dirtyEntries.length,
      ahead,
      behind,
      ...(lastActivity !== undefined ? { lastActivity } : {}),
    },
  };
}

/** Compatibility projection for callers that only need available or unknown. */
export async function gitSnapshot(
  cwd: string,
  mainBranchFallback?: string,
): Promise<GitSnapshot | undefined> {
  const inspected = await inspectGitSnapshot(cwd, mainBranchFallback);
  return inspected.kind === "available" ? inspected.snapshot : undefined;
}

/** Most recent HEAD movement or dirty-file modification. */
async function lastActivityAt(
  cwd: string,
  dirtyEntries: PorcelainEntry[],
  headMove: number | undefined,
): Promise<number | undefined> {
  const anchor = headMove ?? await headCommitTime(cwd);
  const mtimes = await Promise.all(
    dirtyEntries.map((entry) => fileMtime(join(cwd, entry.path))),
  );
  let best = anchor;
  for (const mtime of mtimes) {
    if (mtime !== undefined && (best === undefined || mtime > best)) {
      best = mtime;
    }
  }
  return best;
}

/** A file's modification time in unix seconds, when it is observable. */
async function fileMtime(path: string): Promise<number | undefined> {
  const info = await statIfExists(path);
  const mtime = info?.mtime;
  return mtime === undefined || mtime === null
    ? undefined
    : Math.floor(mtime.getTime() / 1000);
}

/** Unix time of the newest HEAD reflog entry. */
async function lastHeadMoveTime(cwd: string): Promise<number | undefined> {
  const run = await git(["reflog", "--date=unix", "-1"], cwd);
  if (!run.success) {
    return undefined;
  }
  const match = run.stdout.match(/@\{(\d+)\}/);
  if (match === null) {
    return undefined;
  }
  const count = parseGitCount(match[1] ?? "");
  return isKnownGitCount(count) ? count : undefined;
}

/** Unix committer time of HEAD when the repository has a commit. */
async function headCommitTime(cwd: string): Promise<number | undefined> {
  const run = await git(["log", "-1", "--format=%ct"], cwd);
  if (!run.success) {
    return undefined;
  }
  const count = gitCountFrom(run);
  return isKnownGitCount(count) ? count : undefined;
}
