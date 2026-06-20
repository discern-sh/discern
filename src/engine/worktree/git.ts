/**
 * The git mechanics of the worktree lifecycle — the TS port of the pure git/
 * filesystem helpers under `engine/` (assert-in-worktree, assert-not-in-worktree,
 * assert-main-merged, ensure-worktree-branch, remove-worktree-safely,
 * prune-git-worktrees, sweep-orphan-worktrees, inherit-main-env-vars, plus
 * `main_repo_path` from lib/worktree.sh).
 *
 * These are internal functions (no CLI parsing): they take explicit inputs and a
 * `Logger` for human output, and signal fatal conditions by throwing
 * `WorktreeGitError` (the analogue of the shell `die`) rather than calling
 * `Deno.exit`. The lifecycle layer drives them; the dispatcher decides the
 * process exit code.
 *
 * The integration branch is read from `MAIN_BRANCH` (env) / `[project].main_branch`
 * (default `main`); `git` from `GIT_BIN` (default `git`). Path identity throughout
 * uses real (canonical) paths so a symlinked checkout compares correctly.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import type { Logger } from "../../lib/log.ts";

/** A fatal worktree-git condition (the analogue of the shell `die`). */
export class WorktreeGitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeGitError";
  }
}

/** The configured git binary (`GIT_BIN`, default `git`). */
function gitBin(): string {
  return Deno.env.get("GIT_BIN") ?? "git";
}

/**
 * The integration branch: `MAIN_BRANCH` env wins (the dispatcher exports it from
 * `[project].main_branch`); otherwise `fallback` (a config-derived value the
 * lifecycle layer passes when calling outside a dispatched env); otherwise
 * `main`.
 */
export function integrationBranch(fallback?: string): string {
  const env = Deno.env.get("MAIN_BRANCH");
  if (env !== undefined && env !== "") {
    return env;
  }
  if (fallback !== undefined && fallback !== "") {
    return fallback;
  }
  return "main";
}

/** The result of running git: success flag, captured stdout, and stderr. */
interface GitRun {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run a git command, capturing stdout+stderr. `cwd` runs git there (used instead
 * of `-C` where the shell `cd`'d). A missing/unrunnable git resolves to a failed
 * run with an explanatory stderr rather than throwing.
 */
async function git(args: string[], cwd?: string): Promise<GitRun> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command(gitBin(), {
      args,
      ...(cwd !== undefined ? { cwd } : {}),
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch {
    return { success: false, stdout: "", stderr: "git is not on PATH" };
  }
  const dec = new TextDecoder();
  return {
    success: output.success,
    stdout: dec.decode(output.stdout),
    stderr: dec.decode(output.stderr),
  };
}

/** Whether the configured git binary is runnable at all. */
export async function gitAvailable(): Promise<boolean> {
  try {
    const output = await new Deno.Command(gitBin(), {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return output.success;
  } catch {
    return false;
  }
}

/** Canonicalize a path; return it unchanged when it cannot be resolved. */
async function realPathOr(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return path;
  }
}

/** Whether `path` is an existing directory. */
async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/** Read the first line of a file, or undefined when it cannot be read. */
async function firstLine(path: string): Promise<string | undefined> {
  try {
    const text = await Deno.readTextFile(path);
    return text.split("\n")[0] ?? "";
  } catch {
    return undefined;
  }
}

/** The first `worktree ` path printed by `git worktree list --porcelain`. */
async function firstWorktreePath(cwd?: string): Promise<string | undefined> {
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
  if (!(await isDir(first))) {
    return undefined;
  }
  return await realPathOr(first);
}

/** Resolved git directories for the cwd: the per-worktree dir and the shared one. */
interface GitDirs {
  /** `git rev-parse --absolute-git-dir` (this worktree's admin dir). */
  absoluteGitDir: string | undefined;
  /** `git rev-parse --git-common-dir`, resolved to an absolute canonical path. */
  commonGitDir: string | undefined;
}

/** Resolve the absolute + common git dirs for `cwd` (default: the process cwd). */
async function resolveGitDirs(cwd: string = Deno.cwd()): Promise<GitDirs> {
  const absRun = await git(["rev-parse", "--absolute-git-dir"], cwd);
  const commonRun = await git(["rev-parse", "--git-common-dir"], cwd);
  const absoluteGitDir = absRun.success ? absRun.stdout.trim() : undefined;
  let commonGitDir: string | undefined;
  if (commonRun.success) {
    let raw = commonRun.stdout.trim();
    if (raw !== "") {
      if (!isAbsolute(raw)) {
        raw = resolve(cwd, raw);
      }
      commonGitDir = await realPathOr(raw);
    }
  }
  return { absoluteGitDir, commonGitDir };
}

/**
 * Refuse unless the cwd is inside a *linked* worktree (not the main checkout).
 * Returns silently on success; throws `WorktreeGitError` otherwise. Mirrors
 * `assert-in-worktree`. `label` prefixes the refusal message.
 */
export async function assertInWorktree(
  label = "this script",
  cwd: string = Deno.cwd(),
): Promise<void> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(cwd);
  if (absoluteGitDir === undefined) {
    throw new WorktreeGitError(
      `${label}: refused — current directory is not inside a git repository.`,
    );
  }
  if (commonGitDir === undefined) {
    throw new WorktreeGitError(
      `${label}: refused — could not resolve the shared git directory.`,
    );
  }
  if (absoluteGitDir === commonGitDir) {
    throw new WorktreeGitError(
      `${label}: refused — must be run from inside a linked git worktree, not the main checkout.`,
    );
  }
}

/**
 * Refuse when the cwd is inside a *linked* worktree (main-checkout-only guard).
 * Returns silently from the main checkout; throws otherwise. Mirrors
 * `assert-not-in-worktree`.
 */
export async function assertNotInWorktree(
  label = "this script",
  cwd: string = Deno.cwd(),
): Promise<void> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(cwd);
  if (absoluteGitDir === undefined) {
    throw new WorktreeGitError(
      `${label}: refused - current directory is not inside a git repository.`,
    );
  }
  if (commonGitDir === undefined) {
    throw new WorktreeGitError(
      `${label}: refused - could not resolve the shared git directory.`,
    );
  }
  if (absoluteGitDir !== commonGitDir) {
    throw new WorktreeGitError(
      `${label}: refused - must be run from the main checkout, not a linked git worktree.`,
    );
  }
}

/** The outcome of the main-merged check. */
export type MainMergedResult =
  /** Not applicable here (main checkout, no repo, or no local main): a no-op pass. */
  | { kind: "skipped" }
  /** The branch already contains the latest main. */
  | { kind: "merged" }
  /** main has advanced: the branch is behind by `behind` commit(s) on `branch`. */
  | { kind: "behind"; behind: string; branch: string };

/**
 * Assert the current worktree's branch already contains the latest main. A
 * check, not a merge. No-op (`skipped`) outside a linked worktree or with no
 * local main branch. Mirrors `assert-main-merged` — note it never throws: the
 * caller turns `behind` into a fatal message at the lifecycle layer.
 */
export async function assertMainMerged(
  cwd: string = Deno.cwd(),
  mainBranchFallback?: string,
): Promise<MainMergedResult> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(cwd);
  // Outside a repo, or in the main checkout → clean no-op (this sits at the end
  // of `agent finish`, which also runs in the main checkout).
  if (absoluteGitDir === undefined || commonGitDir === undefined) {
    return { kind: "skipped" };
  }
  if (absoluteGitDir === commonGitDir) {
    return { kind: "skipped" };
  }
  const mainBranch = integrationBranch(mainBranchFallback);
  const hasMain = await git(
    ["show-ref", "--verify", "--quiet", `refs/heads/${mainBranch}`],
    cwd,
  );
  if (!hasMain.success) {
    return { kind: "skipped" }; // no local main branch to compare against
  }
  const ancestor = await git(
    ["merge-base", "--is-ancestor", mainBranch, "HEAD"],
    cwd,
  );
  if (ancestor.success) {
    return { kind: "merged" };
  }
  const behindRun = await git(
    ["rev-list", "--count", `HEAD..${mainBranch}`],
    cwd,
  );
  const behind = behindRun.success ? behindRun.stdout.trim() : "?";
  const branchRun = await git(["branch", "--show-current"], cwd);
  const branch = branchRun.success && branchRun.stdout.trim() !== ""
    ? branchRun.stdout.trim()
    : "HEAD";
  return { kind: "behind", behind: behind === "" ? "?" : behind, branch };
}

/**
 * Ensure the current linked worktree is on a named branch (agents may start
 * detached). Creates a deterministic branch from the supplied base name (the
 * identity `branch` value), disambiguating with the short HEAD sha and a counter
 * if needed. Returns the current or created branch name. Mirrors
 * `ensure-worktree-branch` (the caller asserts the worktree precondition first).
 */
export async function ensureWorktreeBranch(
  baseBranch: string,
  cwd: string = Deno.cwd(),
): Promise<string> {
  const current = await git(["branch", "--show-current"], cwd);
  if (current.success && current.stdout.trim() !== "") {
    return current.stdout.trim();
  }

  const headRun = await git(["rev-parse", "--short=8", "HEAD"], cwd);
  if (!headRun.success) {
    throw new WorktreeGitError(
      "ensure-worktree-branch: could not resolve HEAD to create a branch.",
    );
  }
  const headSha = headRun.stdout.trim();

  const exists = async (name: string): Promise<boolean> =>
    (await git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], cwd))
      .success;

  let candidate = baseBranch;
  if (await exists(candidate)) {
    candidate = `${baseBranch}-${headSha}`;
  }
  let counter = 2;
  while (await exists(candidate)) {
    candidate = `${baseBranch}-${headSha}-${counter}`;
    counter += 1;
  }

  const valid = await git(["check-ref-format", "--branch", candidate], cwd);
  if (!valid.success) {
    throw new WorktreeGitError(
      `ensure-worktree-branch: generated invalid branch name: ${candidate}`,
    );
  }

  const switched = await git(["switch", "-c", candidate], cwd);
  if (!switched.success) {
    throw new WorktreeGitError(
      `ensure-worktree-branch: failed to create branch ${candidate}: ${switched.stderr.trim()}`,
    );
  }
  return candidate;
}

/** Canonicalize a target that may already be gone (parent + basename fallback). */
async function canonicalizeMaybeMissing(target: string): Promise<string> {
  if (await isDir(target)) {
    return await realPathOr(target);
  }
  const parent = dirname(target);
  if (await isDir(parent)) {
    return join(await realPathOr(parent), basename(target));
  }
  return target;
}

/**
 * Whether `dir` carries a `.git` gitlink pointing into `<common>/worktrees/` —
 * i.e. it is a (possibly deregistered) worktree of this repo. Mirrors the
 * gitlink check shared by remove-worktree-safely and sweep-orphan-worktrees.
 */
async function gitlinksInto(
  dir: string,
  commonGitDir: string | undefined,
): Promise<boolean> {
  if (commonGitDir === undefined) {
    return false;
  }
  const line = await firstLine(join(dir, ".git"));
  if (line === undefined || !line.startsWith("gitdir: ")) {
    return false;
  }
  let link = line.slice("gitdir: ".length);
  if (!isAbsolute(link)) {
    link = join(dir, link);
  }
  return link.startsWith(`${commonGitDir}/worktrees/`);
}

/** Resolve the shared common git dir as seen from `mainRepo`. */
async function commonGitDirFrom(
  mainRepo: string,
): Promise<string | undefined> {
  const run = await git(["rev-parse", "--git-common-dir"], mainRepo);
  if (!run.success) {
    return undefined;
  }
  let raw = run.stdout.trim();
  if (raw === "") {
    return undefined;
  }
  if (!isAbsolute(raw)) {
    raw = join(mainRepo, raw);
  }
  return await realPathOr(raw);
}

/**
 * Remove a git worktree robustly, leaving no orphaned directory. Retries the
 * transient `ENOTEMPTY` race on `git worktree remove --force`, then falls back to
 * `rm -rf` + `git worktree prune`. Refuses anything that is neither a registered
 * worktree of this repo nor a gitlinked orphan of it (and the main checkout).
 * Mirrors `remove-worktree-safely`. Idempotent: an already-gone, unregistered
 * path is a no-op.
 */
export async function removeWorktreeSafely(
  target: string,
  cwd: string = Deno.cwd(),
): Promise<void> {
  const mainFirst = await firstWorktreePath(cwd);
  if (mainFirst === undefined || mainFirst === "") {
    throw new WorktreeGitError(
      "remove-worktree-safely: not inside a git repository.",
    );
  }
  const mainRepo = await realPathOr(mainFirst);
  const commonGitDir = await commonGitDirFrom(mainRepo);
  const canonical = await canonicalizeMaybeMissing(target);

  if (canonical === mainRepo) {
    throw new WorktreeGitError(
      `remove-worktree-safely: refused — '${canonical}' is the main checkout.`,
    );
  }

  // Registered as a current worktree of this repo?
  let registered = false;
  const listRun = await git(["worktree", "list", "--porcelain"], cwd);
  if (listRun.success) {
    for (const line of listRun.stdout.split("\n")) {
      if (line === `worktree ${canonical}`) {
        registered = true;
        break;
      }
    }
  }

  const gitlinked = await gitlinksInto(canonical, commonGitDir);

  // Already gone and not registered → nothing to do (idempotent).
  const exists = await pathExists(canonical);
  if (!exists && !registered) {
    return;
  }

  // Safety gate: only a worktree (registered or gitlinked orphan) of this repo,
  // computed before removal so the rm -rf fallback stays authorised mid-race.
  if (!registered && !gitlinked) {
    throw new WorktreeGitError(
      `remove-worktree-safely: refused — '${canonical}' is not a git worktree of this repository.`,
    );
  }

  // `git worktree remove --force`, retrying only the transient ENOTEMPTY race.
  let removed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await git(["worktree", "remove", "--force", canonical], cwd);
    if (run.success) {
      removed = true;
      break;
    }
    const err = run.stderr;
    if (err.includes("Directory not empty") || err.includes("ENOTEMPTY")) {
      await delay(500);
      continue;
    }
    break; // any other error → straight to the fallback
  }

  if (!removed) {
    if (await pathExists(canonical)) {
      await Deno.remove(canonical, { recursive: true });
    }
    await git(["worktree", "prune"], cwd);
  }
}

/** Whether a path exists (file or directory). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Sleep for `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** One worktree record parsed from `git worktree list --porcelain`. */
interface WorktreeRecord {
  path: string;
  /** The full `branch` ref (e.g. `refs/heads/foo`), or "" when detached. */
  branch: string;
  locked: boolean;
  prunable: boolean;
}

/** Parse `git worktree list --porcelain` into records. */
function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let cur: WorktreeRecord | undefined;
  const flush = (): void => {
    if (cur && cur.path !== "") {
      records.push(cur);
    }
    cur = undefined;
  };
  for (const line of porcelain.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      cur = {
        path: line.slice("worktree ".length),
        branch: "",
        locked: false,
        prunable: false,
      };
    } else if (cur) {
      if (line.startsWith("branch ")) {
        cur.branch = line.slice("branch ".length);
      } else if (line.startsWith("locked")) {
        cur.locked = true;
      } else if (line.startsWith("prunable")) {
        cur.prunable = true;
      }
    }
  }
  flush();
  return records;
}

/** Options for {@link pruneGitWorktrees}. */
export interface PruneOptions {
  /** Print what would happen without removing anything. */
  dryRun?: boolean;
  /** Allow clean detached worktrees to be removed. */
  includeDetached?: boolean;
  /** Integration-branch fallback when `MAIN_BRANCH` is unset (`[project].main_branch`). */
  mainBranch?: string;
  /** The logger for the scan/removal narration. */
  log: Logger;
}

/** The outcome of a prune run. */
export interface PruneResult {
  /** Worktrees removed (or that would be, in a dry run). */
  removed: string[];
  /** Branches deleted (or that would be). */
  branchesDeleted: string[];
  /** Whether any removal or branch deletion failed. */
  failed: boolean;
}

/**
 * Remove stale git worktrees and fully-merged branches while keeping work worth
 * reviewing. The TS port of `prune-git-worktrees`. Unlike the shell, the
 * interactive confirmation is the caller's job (the lifecycle layer prompts and
 * passes results through); this runs the scan + removals and narrates via `log`.
 * Throws `WorktreeGitError` for the setup failures the shell `exit 1`'d on.
 */
export async function pruneGitWorktrees(
  opts: PruneOptions,
): Promise<PruneResult> {
  const { log } = opts;
  const dryRun = opts.dryRun ?? false;
  const includeDetached = opts.includeDetached ?? false;
  const mainBranch = integrationBranch(opts.mainBranch);

  const rootRun = await git(["rev-parse", "--show-toplevel"]);
  const repoRoot = rootRun.success ? rootRun.stdout.trim() : "";
  if (repoRoot === "") {
    throw new WorktreeGitError(
      "This command must be run from inside a Git repository.",
    );
  }
  if (
    !(await git(
      ["show-ref", "--verify", "--quiet", `refs/heads/${mainBranch}`],
      repoRoot,
    ))
      .success
  ) {
    throw new WorktreeGitError(
      `Expected local '${mainBranch}' branch to exist; aborting.`,
    );
  }

  const branchIsMerged = async (branch: string): Promise<boolean> =>
    (await git([
      "merge-base",
      "--is-ancestor",
      `refs/heads/${branch}`,
      `refs/heads/${mainBranch}`,
    ], repoRoot)).success;

  const listRun = await git(["worktree", "list", "--porcelain"], repoRoot);
  const records = parseWorktreeList(listRun.stdout);
  const mainWorktreePath = records[0]?.path ?? "";

  const removeCandidates: string[] = [];
  const removeCandidateBranches: string[] = [];
  const scheduledBranches = new Set<string>();
  let staleMetadata = 0;

  log.line(`Scanning worktrees in ${repoRoot}`);
  log.line();

  for (const rec of records) {
    const shortBranch = rec.branch.startsWith("refs/heads/")
      ? rec.branch.slice("refs/heads/".length)
      : rec.branch;

    if (rec.prunable) {
      staleMetadata += 1;
      log.line(`PRUNE  ${rec.path} (stale metadata)`);
      continue;
    }
    if (rec.path === mainWorktreePath) {
      log.line(`KEEP   ${rec.path} (main worktree)`);
      continue;
    }
    if (rec.path === repoRoot) {
      log.line(`KEEP   ${rec.path} (running from here)`);
      continue;
    }

    const keepReasons: string[] = [];
    if (rec.locked) {
      keepReasons.push("locked");
    }
    if (shortBranch !== "") {
      if (!(await branchIsMerged(shortBranch))) {
        keepReasons.push(`branch ${shortBranch} has unmerged commits`);
      }
    } else if (!includeDetached) {
      keepReasons.push("detached HEAD");
    }

    const statusRun = await git(
      ["-C", rec.path, "status", "--porcelain", "--untracked-files=normal"],
    );
    if (!statusRun.success) {
      keepReasons.push("status failed; skipped");
    } else if (statusRun.stdout.trim() !== "") {
      const count = statusRun.stdout.split("\n").filter((l) => l !== "").length;
      keepReasons.push(`dirty ${count} status entries`);
    }

    if (keepReasons.length > 0) {
      log.line(`KEEP   ${rec.path} (${keepReasons.join(", ")})`);
      continue;
    }

    removeCandidates.push(rec.path);
    removeCandidateBranches.push(shortBranch);
    if (shortBranch !== "") {
      scheduledBranches.add(shortBranch);
      log.line(
        `REMOVE ${rec.path} (clean branch ${shortBranch}, fully merged)`,
      );
    } else {
      log.line(`REMOVE ${rec.path} (clean detached)`);
    }
  }

  // Branches checked out in a kept worktree must never be deleted.
  const keptWorktreeBranches = new Set<string>();
  for (const rec of records) {
    const shortBranch = rec.branch.startsWith("refs/heads/")
      ? rec.branch.slice("refs/heads/".length)
      : rec.branch;
    if (shortBranch === "" || scheduledBranches.has(shortBranch)) {
      continue;
    }
    keptWorktreeBranches.add(shortBranch);
  }

  log.line();
  log.line(`Scanning branches in ${repoRoot}`);
  log.line();

  const deleteBranches: string[] = [];
  const refsRun = await git(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    repoRoot,
  );
  for (const branchName of refsRun.stdout.split("\n")) {
    if (branchName === "") {
      continue;
    }
    if (branchName === mainBranch) {
      log.line(`KEEP   ${branchName} (protected)`);
      continue;
    }
    if (keptWorktreeBranches.has(branchName)) {
      log.line(`KEEP   ${branchName} (checked out in a kept worktree)`);
      continue;
    }
    if (scheduledBranches.has(branchName)) {
      continue;
    }
    if (await branchIsMerged(branchName)) {
      deleteBranches.push(branchName);
      scheduledBranches.add(branchName);
      log.line(`DELETE ${branchName} (fully merged into ${mainBranch})`);
    } else {
      log.line(`KEEP   ${branchName} (has unmerged commits)`);
    }
  }
  log.line();

  const worktreeBranchCount =
    removeCandidateBranches.filter((b) => b !== "").length;
  const totalBranches = worktreeBranchCount + deleteBranches.length;

  if (dryRun) {
    log.line("Dry run complete.");
    log.line(
      `Would remove ${removeCandidates.length} worktree(s) and delete ${totalBranches} branch(es).`,
    );
    if (staleMetadata > 0) {
      log.line(
        `Would also prune ${staleMetadata} stale metadata ${
          staleMetadata === 1 ? "entry" : "entries"
        }.`,
      );
    }
    return { removed: [], branchesDeleted: [], failed: false };
  }

  const deleteBranchSafe = async (branch: string): Promise<boolean> => {
    if (!(await branchIsMerged(branch))) {
      log.error(
        `Refusing to delete ${branch}: not fully merged into ${mainBranch}`,
      );
      return false;
    }
    return (await git(["branch", "-D", branch], repoRoot)).success;
  };

  const removed: string[] = [];
  const branchesDeleted: string[] = [];
  let failed = false;

  if (removeCandidates.length === 0 && deleteBranches.length === 0) {
    log.line("Nothing to remove.");
  } else {
    for (let i = 0; i < removeCandidates.length; i++) {
      const worktreePath = removeCandidates[i]!;
      const branchToDelete = removeCandidateBranches[i]!;
      log.line(`Removing ${worktreePath}...`);
      try {
        await removeWorktreeSafely(worktreePath, repoRoot);
        removed.push(worktreePath);
        if (branchToDelete !== "") {
          if (await deleteBranchSafe(branchToDelete)) {
            branchesDeleted.push(branchToDelete);
          } else {
            failed = true;
          }
        }
      } catch {
        failed = true;
      }
    }
    for (const branchName of deleteBranches) {
      if (await deleteBranchSafe(branchName)) {
        branchesDeleted.push(branchName);
      } else {
        failed = true;
      }
    }
  }

  await git(["worktree", "prune"], repoRoot);
  return { removed, branchesDeleted, failed };
}

/** Options for {@link sweepOrphanWorktrees}. */
export interface SweepOptions {
  /** Extra directories to scan (besides the registered parents + .claude/worktrees). */
  extraDirs?: string[];
  /** The logger for the scan/removal narration. */
  log: Logger;
}

/** The outcome of an orphan sweep. */
export interface SweepResult {
  /** Orphan directories found and removed. */
  removed: string[];
  /** Whether any removal failed. */
  failed: boolean;
}

/**
 * Reclaim orphaned worktree directories — directories git no longer tracks but
 * which still carry a `.git` gitlink into this repo's worktrees admin area. The
 * TS port of `sweep-orphan-worktrees`. Scans the parent of every registered
 * worktree, the `<main>/.claude/worktrees` convention, and any `extraDirs`.
 * Removal goes through {@link removeWorktreeSafely}, which re-checks the
 * boundary. Throws `WorktreeGitError` when not in a git repo.
 */
export async function sweepOrphanWorktrees(
  opts: SweepOptions,
): Promise<SweepResult> {
  const { log } = opts;
  const mainFirst = await firstWorktreePath();
  if (mainFirst === undefined || mainFirst === "") {
    throw new WorktreeGitError(
      "sweep-orphan-worktrees: not inside a git repository.",
    );
  }
  const mainRepo = await realPathOr(mainFirst);
  const commonGitDir = await commonGitDirFrom(mainRepo);

  const listRun = await git(["worktree", "list", "--porcelain"]);
  const registeredPaths = new Set<string>();
  const registeredRaw: string[] = [];
  for (const line of listRun.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      registeredRaw.push(line.slice("worktree ".length));
    }
  }
  for (const p of registeredRaw) {
    registeredPaths.add(await realPathOr(p));
  }

  // Scan dirs: the .claude/worktrees default, every registered worktree's
  // parent, and any extra dirs — deduped.
  const scanSet = new Set<string>();
  const addScan = async (dir: string): Promise<void> => {
    if (!(await isDir(dir))) {
      return;
    }
    scanSet.add(await realPathOr(dir));
  };
  await addScan(join(mainRepo, ".claude", "worktrees"));
  for (const p of registeredRaw) {
    if (!(await isDir(p))) {
      continue;
    }
    const cpath = await realPathOr(p);
    if (cpath === mainRepo) {
      continue;
    }
    await addScan(dirname(cpath));
  }
  for (const dir of opts.extraDirs ?? []) {
    await addScan(dir);
  }

  const orphans: string[] = [];
  const seen = new Set<string>();
  for (const scan of scanSet) {
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const e of Deno.readDir(scan)) {
        entries.push(e);
      }
    } catch {
      continue;
    }
    for (const entry of entries) {
      const sub = join(scan, entry.name);
      if (!(await isDir(sub))) {
        continue;
      }
      const canonical = await realPathOr(sub);
      if (registeredPaths.has(canonical) || seen.has(canonical)) {
        continue;
      }
      if (await gitlinksInto(canonical, commonGitDir)) {
        orphans.push(canonical);
        seen.add(canonical);
      }
    }
  }

  if (orphans.length === 0) {
    log.line("No orphaned worktree directories found.");
    return { removed: [], failed: false };
  }

  log.line(
    "Orphaned worktree directories (gitlinked to this repo, not tracked by git):",
  );
  for (const dir of orphans) {
    log.line(`  ${dir}`);
  }

  const removed: string[] = [];
  let failed = false;
  for (const dir of orphans) {
    log.line(`Removing orphan ${dir}...`);
    try {
      await removeWorktreeSafely(dir, mainRepo);
      removed.push(dir);
    } catch {
      failed = true;
    }
  }
  return { removed, failed };
}

/** Read the raw value (everything after the first `=`) for `key` in a `.env`-style file. */
function readEnvValue(text: string, key: string): string {
  for (const line of text.split("\n")) {
    if (line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1);
    }
  }
  return "";
}

/** Strip one layer of matching surrounding quotes. */
function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Quote a value for `.env` only when it contains whitespace, `#`, or a quote. */
function formatEnvValue(value: string): string {
  if (/[\s#"']/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Read a file's text, or undefined when it cannot be read. */
async function readFileMaybe(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

/** Options for {@link inheritMainEnvVars}. */
export interface InheritEnvOptions {
  /** The worktree root (the `.env` being patched lives here). */
  worktreeRoot: string;
  /** The variable names to inherit (the `[worktree].inherit_env` array). */
  vars: string[];
  /** The logger for per-var narration. */
  log: Logger;
}

/**
 * Copy selected env vars from the main checkout's `.env` into the current
 * worktree's `.env`, so the worktree's app can boot with the same secrets. The
 * TS port of `inherit-main-env-vars`. Per-var safe-copy policy: skip when main is
 * blank; replace when the worktree value is empty or equals `.env.example`'s
 * default; otherwise leave a customised value alone. Idempotent. An empty `vars`
 * list, or no worktree `.env`, is a clean no-op. Throws `WorktreeGitError` only
 * when the main checkout cannot be resolved.
 */
export async function inheritMainEnvVars(
  opts: InheritEnvOptions,
): Promise<void> {
  const { log } = opts;
  if (opts.vars.length === 0) {
    return;
  }
  const wtEnvPath = join(opts.worktreeRoot, ".env");
  const wtText = await readFileMaybe(wtEnvPath);
  if (wtText === undefined) {
    log.info("inherit-main-env-vars: no .env in this worktree — skipping.");
    return;
  }

  const mainRepo = await mainRepoPath();
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "inherit-main-env-vars: could not resolve the main checkout.",
    );
  }
  const mainEnvText = await readFileMaybe(join(mainRepo, ".env"));
  if (mainEnvText === undefined) {
    log.warn(
      `inherit-main-env-vars: main checkout has no .env at ${
        join(mainRepo, ".env")
      } — skipping.`,
    );
    return;
  }
  const exampleText = await readFileMaybe(join(mainRepo, ".env.example")) ?? "";

  // Mutate the worktree .env text in memory, writing once at the end.
  let lines = wtText.split("\n");
  let appendedHeader = wtText.includes("\n# Inherited from main") ||
    wtText.startsWith("# Inherited from main");
  let dirty = false;

  for (const varName of opts.vars) {
    if (varName === "") {
      continue;
    }
    const mainValue = stripQuotes(readEnvValue(mainEnvText, varName));
    if (mainValue === "") {
      log.warn(
        `inherit-main-env-vars: ${varName} is missing or blank in main's .env — skipping.`,
      );
      continue;
    }
    const worktreeValue = stripQuotes(readEnvValue(lines.join("\n"), varName));
    const exampleValue = stripQuotes(readEnvValue(exampleText, varName));

    if (worktreeValue === mainValue) {
      continue; // already inherited
    }
    if (worktreeValue !== "" && worktreeValue !== exampleValue) {
      log.info(
        `inherit-main-env-vars: ${varName} has a worktree-specific value — leaving it alone.`,
      );
      continue;
    }

    const targetLine = `${varName}=${formatEnvValue(mainValue)}`;
    let replaced = false;
    lines = lines.map((line) => {
      if (!replaced && line.startsWith(`${varName}=`)) {
        replaced = true;
        return targetLine;
      }
      return line;
    });
    if (!replaced) {
      if (!appendedHeader) {
        lines.push("", "# Inherited from main");
        appendedHeader = true;
      }
      lines.push(targetLine);
    }
    dirty = true;
    log.ok(`Inherited ${varName} from main.`);
  }

  if (dirty) {
    await Deno.writeTextFile(wtEnvPath, lines.join("\n"));
  }
}
