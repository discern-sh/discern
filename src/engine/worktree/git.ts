/**
 * The git mechanics of the worktree lifecycle: assert a path is (or isn't) a
 * worktree, assert main is merged, ensure a worktree branch, safely remove a
 * worktree, prune stale git worktrees, sweep orphans, inherit main's env, and
 * resolve the main repo path.
 *
 * These are internal functions (no CLI parsing): they take explicit inputs and a
 * `Logger` for human output, and signal fatal conditions by throwing
 * `WorktreeGitError` rather than calling
 * `Deno.exit`. The lifecycle layer drives them; the dispatcher decides the
 * process exit code.
 *
 * The integration branch is read from `DISCERN_TRUNK` (env) /
 * `[repository].trunk`
 * (default `main`); `git` from `GIT_BIN` (default `git`). Path identity throughout
 * uses real (canonical) paths so a symlinked checkout compares correctly.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import type { Logger } from "../../lib/log.ts";
import { adrNumberOf } from "../../lib/adr_numbers.ts";
import type { EnvReader } from "../../shared/env.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
} from "../../shared/discern_commit.ts";
import {
  parsePorcelainZ,
  type PorcelainEntry,
  splitNulRecords,
} from "../../shared/git_paths.ts";
import {
  formatEnvValue,
  readEnvFilesAt,
  readEnvValueAcross,
  readEnvValueFromFiles,
  stripQuotes,
  writeEnvVar,
} from "./env_file.ts";
import {
  SIDE_RESTRICTED_OPS,
  type SideRestrictedOpName,
  type WorktreeSide,
} from "./side_restrictions.ts";

/** A fatal worktree-git condition. */
export class WorktreeGitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeGitError";
  }
}

/**
 * Write one configured worktree env value, translating a filesystem or path
 * refusal into the error contract every worktree verb already serializes.
 */
export async function writeWorktreeEnvVar(
  worktreeRoot: string,
  key: string,
  value: string,
  files: readonly string[],
  opts: { create?: boolean } = {},
): Promise<boolean> {
  try {
    return await writeEnvVar(worktreeRoot, key, value, files, opts);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorktreeGitError(
      `Discern couldn't update the configured worktree env file: ${reason}`,
    );
  }
}

/**
 * The integration branch: `DISCERN_TRUNK` env wins (the dispatcher exports it from
 * `[repository].trunk`); otherwise `fallback` (a config-derived value the
 * lifecycle layer passes when calling outside a dispatched env); otherwise
 * `main`.
 */
export function integrationBranch(
  fallback?: string,
  envReader: EnvReader = Deno.env,
): string {
  const env = envReader.get("DISCERN_TRUNK");
  if (env !== undefined && env !== "") {
    return env;
  }
  if (fallback !== undefined && fallback !== "") {
    return fallback;
  }
  return "main";
}

/** One-line warning when the configured integration branch cannot be checked. */
export function missingIntegrationBranchWarning(branch: string): string {
  return fire(HINTS["missing-trunk-branch"], { branch }).text;
}

/**
 * Thin binding to the shared git runner, preserving this module's positional
 * `(args, cwd?)` call shape used throughout the worktree git mechanics. An omitted
 * `cwd` means "run in the process directory" — resolved to {@link Deno.cwd} here so
 * the choice is explicit at the runGit boundary, which requires the execution root
 * rather than inheriting it. The spawn itself — GIT_BIN, decoding, the no-git
 * fallback — lives once in {@link runGit}.
 */
function git(args: string[], cwd?: string): Promise<GitResult> {
  return runGit(args, { cwd: cwd ?? Deno.cwd() });
}

/** Whether the configured git binary is runnable at all. */
export async function gitAvailable(): Promise<boolean> {
  return (await gitVersion()) !== undefined;
}

/**
 * The configured git binary's version line (`git --version` → e.g. `git version
 * 2.43.0`), or undefined when git is missing or unrunnable. The single git-binary
 * probe behind both {@link gitAvailable} and `doctor`'s git check, so "is git
 * here?" and "which git?" are answered the same way.
 */
export async function gitVersion(): Promise<string | undefined> {
  const r = await git(["--version"]);
  if (!r.success) {
    return undefined;
  }
  const line = r.stdout.trim();
  return line === "" ? undefined : line;
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

/** Where a path sits relative to the main-checkout / linked-worktree boundary. */
type BoundarySide =
  /** Outside any git repository. */
  | "no-repo"
  /** In a repository whose shared git directory cannot be identified. */
  | "unresolvable"
  | WorktreeSide;

/** Classify `cwd` against the boundary — the ONE definition every side probe
 * and side assertion reads, so the two can never disagree on where a path is. */
async function classifyBoundarySide(cwd: string): Promise<BoundarySide> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(cwd);
  if (absoluteGitDir === undefined) {
    return "no-repo";
  }
  if (commonGitDir === undefined) {
    return "unresolvable";
  }
  return absoluteGitDir === commonGitDir ? "main-checkout" : "worktree";
}

/** Whether `cwd` is inside a *linked* worktree (not the main checkout, not
 * outside a repo). The silent probe for callers that skip rather than refuse. */
export async function inLinkedWorktree(cwd: string): Promise<boolean> {
  return (await classifyBoundarySide(cwd)) === "worktree";
}

/**
 * Refuse unless `cwd` is on the side {@link SIDE_RESTRICTED_OPS} declares for
 * `op`. Returns silently on the right side; throws `WorktreeGitError`
 * otherwise. Taking a registry key — never a free label — is the enrolment
 * forcing function: an operation cannot acquire a side restriction without
 * declaring itself in the registry, where the derived wrong-side refusal test
 * picks it up.
 */
export async function assertOpSide(
  op: SideRestrictedOpName,
  cwd: string = Deno.cwd(),
): Promise<void> {
  const { side, label } = SIDE_RESTRICTED_OPS[op];
  const where = await classifyBoundarySide(cwd);
  if (where === "no-repo") {
    throw new WorktreeGitError(
      `${label} needs a Git repository, but this directory is outside one. Move ` +
        `into the project checkout, or run \`git init\` here first, then re-run.`,
    );
  }
  if (where === "unresolvable") {
    throw new WorktreeGitError(
      `${label} could not identify this repository's shared Git directory. Run ` +
        `\`git worktree repair\`, then re-run.`,
    );
  }
  if (side === "worktree" && where === "main-checkout") {
    throw new WorktreeGitError(
      `${label} runs only inside a worktree — a separate checkout and branch for ` +
        `one effort — not the main checkout. Run \`discern start\` from the main ` +
        `checkout, move into the path it prints, then re-run.`,
    );
  }
  if (side === "main-checkout" && where === "worktree") {
    throw new WorktreeGitError(
      `${label} runs only from the main checkout, not a worktree. Move to the ` +
        `first path shown by \`git worktree list\`, then re-run.`,
    );
  }
}

/** The outcome of the main-merged check. */
export type MainMergedResult =
  /** Not applicable here (main checkout or no repo): a no-op pass. */
  | { kind: "skipped" }
  /** The configured integration branch does not exist locally. */
  | { kind: "missing"; branch: string }
  /** The branch already contains the latest main. */
  | { kind: "merged" }
  /** main has advanced: the branch is behind by `behind` commit(s) on `branch`. */
  | { kind: "behind"; behind: string; branch: string };

/**
 * Assert the current worktree's branch already contains the latest main. A
 * check, not a merge. No-op (`skipped`) outside a linked worktree. Mirrors
 * `assert-main-merged` — note it never throws: the caller turns `behind` into a
 * fatal message at the lifecycle layer and surfaces `missing` as a warning or
 * destructive-verb refusal.
 */
export async function assertMainMerged(
  cwd: string = Deno.cwd(),
  mainBranchFallback?: string,
): Promise<MainMergedResult> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(cwd);
  // Outside a repo, or in the main checkout → clean no-op (this sits at the end
  // of `discern done`, which also runs in the main checkout).
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
    return { kind: "missing", branch: mainBranch };
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

/** Result of atomically moving a checked-out branch from one exact commit to
 * another, then converging its index and worktree without overwriting local
 * tracked edits. */
export type CheckedOutFastForwardResult =
  | { readonly kind: "updated" }
  | { readonly kind: "not-fast-forward"; readonly detail: string }
  | { readonly kind: "moved"; readonly detail: string }
  | { readonly kind: "dirty"; readonly detail: string }
  | {
    readonly kind: "checkout-failed";
    readonly detail: string;
    readonly rolledBack: boolean;
  };

export type CheckedOutFastForwardRecovery =
  | { readonly kind: "converged"; readonly changed: boolean }
  | { readonly kind: "preserved"; readonly detail: string };

export interface CheckedOutFastForwardOptions {
  /** Tags the CAS and any Discern rollback in the branch reflog for recovery. */
  readonly transactionId?: string;
  /** Worktree whose per-worktree marker ref joins the trunk ref transaction. */
  readonly transactionCwd?: string;
}

export type AcceptanceTransactionMarkerRead =
  | { readonly kind: "present"; readonly target: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unavailable"; readonly detail: string };

const ACCEPTANCE_TRANSACTION_MARKER_PREFIX =
  "refs/worktree/discern/acceptance-transactions";

/** Derive the per-worktree proof ref coupled to one acceptance transaction. */
export function acceptanceTransactionMarkerRef(
  transactionId: string,
): string {
  return `${ACCEPTANCE_TRANSACTION_MARKER_PREFIX}/${transactionId}`;
}

/** Read the per-worktree ref proving an acceptance CAS committed. */
export async function readAcceptanceTransactionMarker(
  cwd: string,
  transactionId: string,
): Promise<AcceptanceTransactionMarkerRead> {
  const marker = acceptanceTransactionMarkerRef(transactionId);
  const exists = await git(["show-ref", "--verify", "--quiet", marker], cwd);
  if (exists.code === 1) {
    return { kind: "missing" };
  }
  if (!exists.success) {
    return {
      kind: "unavailable",
      detail: exists.stderr.trim() || `Git could not inspect ${marker}`,
    };
  }
  const read = await git(["rev-parse", "--verify", `${marker}^{commit}`], cwd);
  return read.success ? { kind: "present", target: read.stdout.trim() } : {
    kind: "unavailable",
    detail: read.stderr.trim() || `Git could not read ${marker}`,
  };
}

/** Detect equal or nested paths that a tracked checkout update could replace. */
function checkoutPathsCollide(left: string, right: string): boolean {
  return left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`);
}

/**
 * Find ignored, untracked checkout entries a transition would overwrite.
 *
 * Git protects ordinary untracked paths during a two-tree update but treats
 * ignored paths as disposable. They are machine-local data all the same. Read
 * both lists as NUL records and include ancestor/descendant collisions so a
 * tracked file cannot replace an ignored directory (or vice versa).
 */
async function ignoredCheckoutCollisions(
  cwd: string,
  expected: string,
  target: string,
): Promise<string[] | undefined> {
  const [writes, ignored] = await Promise.all([
    git(
      [
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=ACMRTUXB",
        "-z",
        expected,
        target,
        "--",
      ],
      cwd,
    ),
    git(
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
      ],
      cwd,
    ),
  ]);
  if (!writes.success || !ignored.success) {
    return undefined;
  }
  const targetWrites = splitNulRecords(writes.stdout);
  return splitNulRecords(ignored.stdout).filter((localPath) =>
    targetWrites.some((targetPath) =>
      checkoutPathsCollide(localPath, targetPath)
    )
  );
}

/** Bound ignored-data collision evidence to three quoted paths and an overflow count. */
function ignoredCollisionDetail(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).map((path) => JSON.stringify(path)).join(
    ", ",
  );
  const more = paths.length > 3 ? ` and ${paths.length - 3} more` : "";
  return `the landing would overwrite ignored checkout data at ${shown}${more}`;
}

/** Tag a fast-forward or rollback with its transaction when recovery evidence exists. */
function acceptanceReflogMessage(
  transactionId: string | undefined,
  action: "fast-forward" | "rollback",
  branch: string,
): string {
  return transactionId === undefined
    ? `discern accept: ${action} ${branch}`
    : `discern accept transaction ${transactionId}: ${action} ${branch}`;
}

/** Submit ref commands through Git's prepared all-or-nothing stdin transaction. */
function updateRefTransaction(
  cwd: string,
  message: string,
  commands: readonly string[],
): Promise<GitResult> {
  return runGit(
    ["update-ref", "-m", message, "--stdin"],
    {
      cwd,
      stdin: ["start", ...commands, "prepare", "commit", ""].join("\n"),
    },
  );
}

/** Compare-and-swap the branch back and atomically clear its transaction marker. */
function rollbackCheckedOutBranchRef(
  cwd: string,
  branch: string,
  expected: string,
  target: string,
  options: CheckedOutFastForwardOptions,
): Promise<GitResult> {
  const ref = `refs/heads/${branch}`;
  const message = acceptanceReflogMessage(
    options.transactionId,
    "rollback",
    branch,
  );
  if (options.transactionId === undefined) {
    return git(["update-ref", "-m", message, ref, expected, target], cwd);
  }
  return updateRefTransaction(
    options.transactionCwd ?? cwd,
    message,
    [
      `update ${ref} ${expected} ${target}`,
      `delete ${
        acceptanceTransactionMarkerRef(options.transactionId)
      } ${target}`,
    ],
  );
}

/** Distinguish an exact index-to-commit match from a mismatch or Git failure. */
async function indexMatchesTree(
  cwd: string,
  commit: string,
): Promise<boolean | undefined> {
  const diff = await git(["diff", "--cached", "--quiet", commit, "--"], cwd);
  return diff.code === 0 ? true : diff.code === 1 ? false : undefined;
}

/** Distinguish an exact checkout-to-index match from a mismatch or Git failure. */
async function worktreeMatchesIndex(
  cwd: string,
): Promise<boolean | undefined> {
  const diff = await git(["diff", "--quiet", "--"], cwd);
  return diff.code === 0 ? true : diff.code === 1 ? false : undefined;
}

/**
 * Finish a recorded ref transition without treating its old checkout as user
 * dirt. Only the two journaled trees are recognized: an exact target checkout
 * is already converged; an exact expected index/worktree may receive the
 * original two-tree update. Every other state is preserved byte-for-byte.
 */
export async function recoverCheckedOutFastForward(
  cwd: string,
  branch: string,
  expected: string,
  target: string,
): Promise<CheckedOutFastForwardRecovery> {
  const checkedOut = await git(["branch", "--show-current"], cwd);
  if (!checkedOut.success || checkedOut.stdout.trim() !== branch) {
    const current = checkedOut.success && checkedOut.stdout.trim() !== ""
      ? checkedOut.stdout.trim()
      : "(detached or unavailable)";
    return {
      kind: "preserved",
      detail:
        `the main checkout is on ${current}, not the recorded trunk ${branch}`,
    };
  }

  const worktreeExact = await worktreeMatchesIndex(cwd);
  const [atTarget, atExpected] = await Promise.all([
    indexMatchesTree(cwd, target),
    indexMatchesTree(cwd, expected),
  ]);
  if (
    worktreeExact === undefined || atTarget === undefined ||
    atExpected === undefined
  ) {
    return {
      kind: "preserved",
      detail: "Git could not compare the checkout with the recorded trees",
    };
  }
  if (worktreeExact && atTarget) {
    return { kind: "converged", changed: false };
  }
  if (!worktreeExact || !atExpected) {
    return {
      kind: "preserved",
      detail:
        "the index or tracked checkout no longer matches the recorded pre-landing tree",
    };
  }

  const ignored = await ignoredCheckoutCollisions(cwd, expected, target);
  if (ignored === undefined) {
    return {
      kind: "preserved",
      detail: "Git could not verify ignored checkout paths",
    };
  }
  if (ignored.length > 0) {
    return { kind: "preserved", detail: ignoredCollisionDetail(ignored) };
  }
  const checkout = await git(
    ["read-tree", "-u", "-m", expected, target],
    cwd,
  );
  return checkout.success ? { kind: "converged", changed: true } : {
    kind: "preserved",
    detail: checkout.stderr.trim() ||
      "the checked-out trunk could not be converged",
  };
}

/**
 * Compare-and-swap `refs/heads/<branch>` from `expected` to `target`, then
 * update the branch's checked-out index/worktree through a two-tree read.
 *
 * `git merge --ff-only` rejects divergent movement but accepts a concurrent
 * advance that remains an ancestor of `target`. That is too weak for landing
 * authority: the exact trunk commit whose policy authorized the landing is
 * evidence, so any movement must invalidate it. `update-ref <new> <old>` is the
 * atomic boundary; its expected-old argument makes even an ancestor advance
 * refuse. The two-tree update runs only after the ref moves and refuses local
 * tracked edits rather than clobbering them. A convergence failure attempts an
 * exact compare-and-swap rollback.
 */
export async function fastForwardCheckedOutBranch(
  cwd: string,
  branch: string,
  expected: string,
  target: string,
  options: CheckedOutFastForwardOptions = {},
): Promise<CheckedOutFastForwardResult> {
  const ancestor = await git(
    ["merge-base", "--is-ancestor", expected, target],
    cwd,
  );
  if (!ancestor.success) {
    return {
      kind: "not-fast-forward",
      detail: `${expected} is not an ancestor of ${target}`,
    };
  }

  const ignoredBefore = await ignoredCheckoutCollisions(
    cwd,
    expected,
    target,
  );
  if (ignoredBefore === undefined) {
    return {
      kind: "dirty",
      detail: "Git could not verify ignored checkout paths",
    };
  }
  if (ignoredBefore.length > 0) {
    return {
      kind: "dirty",
      detail: ignoredCollisionDetail(ignoredBefore),
    };
  }

  const dirty = await hasUncommittedTrackedChanges(cwd);
  if (dirty !== false) {
    return {
      kind: "dirty",
      detail: dirty === true
        ? "the checkout gained uncommitted tracked changes"
        : "Git could not verify that the checkout is clean",
    };
  }

  const ref = `refs/heads/${branch}`;
  const updateMessage = acceptanceReflogMessage(
    options.transactionId,
    "fast-forward",
    branch,
  );
  const update = options.transactionId === undefined
    ? await git(
      [
        "update-ref",
        "-m",
        updateMessage,
        ref,
        target,
        expected,
      ],
      cwd,
    )
    : await updateRefTransaction(
      options.transactionCwd ?? cwd,
      updateMessage,
      [
        `update ${ref} ${target} ${expected}`,
        `create ${
          acceptanceTransactionMarkerRef(options.transactionId)
        } ${target}`,
      ],
    );
  if (!update.success) {
    return {
      kind: "moved",
      detail: update.stderr.trim() || `could not compare-and-swap ${ref}`,
    };
  }

  // Close the validation-to-ref window before the two-tree update. If ignored
  // data appeared while the CAS ran, restore the exact old ref without touching
  // checkout files.
  const ignoredAfter = await ignoredCheckoutCollisions(cwd, expected, target);
  if (ignoredAfter === undefined || ignoredAfter.length > 0) {
    const rollback = await rollbackCheckedOutBranchRef(
      cwd,
      branch,
      expected,
      target,
      options,
    );
    return {
      kind: "checkout-failed",
      detail: ignoredAfter === undefined
        ? "Git could not re-verify ignored checkout paths after the ref moved"
        : ignoredCollisionDetail(ignoredAfter),
      rolledBack: rollback.success,
    };
  }

  const checkout = await git(
    ["read-tree", "-u", "-m", expected, target],
    cwd,
  );
  if (checkout.success) {
    return { kind: "updated" };
  }

  const rollback = await rollbackCheckedOutBranchRef(
    cwd,
    branch,
    expected,
    target,
    options,
  );
  if (rollback.success) {
    // `read-tree` checks the whole update before writing, but run the inverse
    // convergence defensively in case a Git implementation touched the index.
    await git(["read-tree", "-u", "-m", target, expected], cwd);
  }
  return {
    kind: "checkout-failed",
    detail: checkout.stderr.trim() ||
      "the checked-out trunk could not be converged",
    rolledBack: rollback.success,
  };
}

/**
 * The read-only merged-state of an ARBITRARY source ref against HEAD — the
 * `update --from` counterpart of {@link assertMainMerged} (which is
 * trunk-specific: local-branch existence, the missing-branch warning). The
 * caller has already resolved `ref` through {@link resolveCommitRef}, so this
 * only reads: whether HEAD already contains it, and how many commits it is
 * behind. Fails open to `{already: true, behind: 0}` on a git hiccup — the
 * mutating merge performs its own checks.
 */
export async function refMergedState(
  cwd: string,
  ref: string,
): Promise<{ already: boolean; behind: number }> {
  const already =
    (await git(["merge-base", "--is-ancestor", ref, "HEAD"], cwd)).success;
  if (already) {
    return { already: true, behind: 0 };
  }
  const behindRun = await git(["rev-list", "--count", `HEAD..${ref}`], cwd);
  return {
    already: false,
    behind: behindRun.success ? Number(behindRun.stdout.trim()) || 0 : 0,
  };
}

/** The outcome of updating the integration branch into the current worktree. */
export type UpdateOutcome =
  /** Not applicable here (main checkout, no repo, or no local main): nothing to do. */
  | { kind: "skipped" }
  /** The branch already contains the latest main — no merge, no refresh. */
  | { kind: "already" }
  /** The worktree has uncommitted tracked changes: update merges into a clean tree only. */
  | { kind: "dirty" }
  /**
   * Main was merged in: `behind` commit(s) brought in, `fastForward` when no merge
   * commit. The four SHA anchors bound the integration so the summary layer (and an
   * agent) can diff/log exactly what landed: `base` (the fork point), `before` (the
   * branch tip pre-merge — the agent's own work), `main` (the tip merged in), and
   * `after` (the merged HEAD). Any anchor is `""` when its read failed — the summary
   * degrades, never the merge.
   */
  | {
    kind: "updated";
    behind: number;
    fastForward: boolean;
    base: string;
    before: string;
    main: string;
    after: string;
    /** Generated conflict paths resolved mechanically before the merge completed. */
    autoResolved: string[];
  }
  /** The merge conflicts in `files`; the merge is aborted, leaving a clean tree —
   * unless `aborted` is false, when the abort itself failed and the tree still
   * holds the half-merge (the caller must say so, never claim a clean tree). */
  | {
    kind: "conflict";
    files: string[];
    /** Conflicted paths the caller declared safe to replace and regenerate. */
    resolvable: string[];
    aborted: boolean;
    /** Why a fully generated conflict could not complete its mechanical merge. */
    resolutionFailure?: string;
  }
  /** The merge failed before it began — git refused outright (unrelated
   * histories, an untracked file in the way), leaving the tree untouched.
   * `reason` is git's own stderr, evidence for the caller's message. */
  | { kind: "merge_failed"; reason: string };

/** The three pre-merge SHA anchors of an integration (the fourth, `after`, is only
 * known post-merge): `base` (the fork point), `before` (the branch tip), `main`
 * (the tip being merged). Any field is `""` when its git read failed. */
export interface IntegrationAnchors {
  base: string;
  before: string;
  main: string;
}

/** Caller-owned policy for the otherwise pure Git update mechanics. */
export interface UpdateMainOptions {
  from?: string;
  /** True only for paths whose committed bytes are wholly generator-owned. */
  autoResolvable?: (path: string) => boolean;
}

/**
 * Resolve the pre-merge anchors of updating `mainBranch` into HEAD — read-only,
 * so the apply ({@link updateMain}, before it merges) and a `--dry-run` preview
 * compute them identically. `main` is the integration branch's current tip,
 * `before` is HEAD (the branch's own work), `base` their merge-base. A failed read
 * yields `""` for that field; the summary layer degrades rather than the merge.
 */
export async function resolveIntegrationAnchors(
  cwd: string,
  mainBranch: string,
): Promise<IntegrationAnchors> {
  const before = (await git(["rev-parse", "HEAD"], cwd)).stdout.trim();
  // `^{commit}` peels an annotated-tag source to the commit it tags, so the
  // anchor is always the tip merged — never a tag object no diff range accepts
  // verbatim. A branch or lightweight tag resolves identically with or without.
  const main = (await git(["rev-parse", `${mainBranch}^{commit}`], cwd)).stdout
    .trim();
  const baseRun = await git(["merge-base", "HEAD", mainBranch], cwd);
  const base = baseRun.success ? baseRun.stdout.trim() : "";
  return { base, before, main };
}

/**
 * Merge an integration source into the current worktree's branch — the mutating
 * counterpart to {@link assertMainMerged}'s read-only check. The source is the
 * integration branch by default, or ANY ref via `opts.from` (the landing model's
 * pull axis — `update --from`; the caller resolves the ref first, so an
 * unknown name never reaches the merge). Refuses (`dirty`) when the tree has
 * uncommitted tracked changes; no-ops (`already`) when the branch already
 * contains the source; and outside a linked worktree — or, on the default pull,
 * with no local main — it is a `skipped` no-op. On a clean run it `git merge`s
 * the source, reporting `fastForward` when HEAD was a strict ancestor (no merge
 * commit) and how many commits it was `behind`. A conflicting merge collects the
 * conflicted paths and aborts (`git merge --abort`), restoring the pre-merge tree
 * so the caller can refuse without leaving a half-merge behind. Pure git
 * mechanics — re-materializing the agent files after a successful merge is the
 * lifecycle layer's job, not this.
 */
export async function updateMain(
  cwd: string = Deno.cwd(),
  mainBranchFallback?: string,
  opts: UpdateMainOptions = {},
): Promise<UpdateOutcome> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(cwd);
  // Outside a repo, or in the main checkout → nothing to update into.
  if (
    absoluteGitDir === undefined || commonGitDir === undefined ||
    absoluteGitDir === commonGitDir
  ) {
    return { kind: "skipped" };
  }
  let source: string;
  if (opts.from !== undefined && opts.from !== "") {
    source = opts.from;
  } else {
    source = integrationBranch(mainBranchFallback);
    const hasMain = await git(
      ["show-ref", "--verify", "--quiet", `refs/heads/${source}`],
      cwd,
    );
    if (!hasMain.success) {
      return { kind: "skipped" }; // no local main branch to update
    }
  }
  // Already contains the source? Then there is nothing to merge.
  if (
    (await git(["merge-base", "--is-ancestor", source, "HEAD"], cwd))
      .success
  ) {
    return { kind: "already" };
  }
  // Merge into a tracked-clean tree only — tracked edits are the caller's to resolve
  // first. Untracked local/session scratch files do not participate in a merge and
  // should not block updating.
  if (await hasUncommittedTrackedChanges(cwd)) {
    return { kind: "dirty" };
  }
  // How far behind, for the report; and whether HEAD is a strict ancestor of the
  // source (a pure fast-forward, no merge commit) — both read before the merge
  // moves HEAD.
  const behindRun = await git(
    ["rev-list", "--count", `HEAD..${source}`],
    cwd,
  );
  const behind = behindRun.success ? Number(behindRun.stdout.trim()) || 0 : 0;
  const fastForward =
    (await git(["merge-base", "--is-ancestor", "HEAD", source], cwd))
      .success;
  // The integration's SHA anchors, read BEFORE the merge moves HEAD: `before` (the
  // branch tip / the agent's own work), `main` (the tip being merged), `base` (their
  // fork point). `after` is read post-merge below. They let the summary layer report
  // exactly what landed — and an agent diff the full set in one call when capped.
  const anchors = await resolveIntegrationAnchors(cwd, source);
  // `--no-edit` accepts git's default merge-commit message without opening an
  // editor, so a divergent merge stays non-interactive.
  const merge = await git(["merge", "--no-edit", source], cwd);
  if (merge.success) {
    const after = (await git(["rev-parse", "HEAD"], cwd)).stdout.trim();
    return {
      kind: "updated",
      behind,
      fastForward,
      ...anchors,
      after,
      autoResolved: [],
    };
  }
  // The merge stopped. A REAL conflict leaves evidence — unmerged paths, or a
  // MERGE_HEAD parked mid-merge; anything else is git refusing outright before
  // touching the tree (unrelated histories, an untracked file in the way), and
  // calling THAT a conflict would bury git's actual reason. Evidence, never
  // stderr prose: git's messages are locale-dependent.
  const conflicted = await git(
    ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=U"],
    cwd,
  );
  const files = conflicted.success ? splitNulRecords(conflicted.stdout) : [];
  const midMerge =
    (await git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], cwd))
      .success;
  if (files.length === 0 && !midMerge) {
    return { kind: "merge_failed", reason: merge.stderr.trim() };
  }
  const resolvable = opts.autoResolvable === undefined
    ? []
    : files.filter(opts.autoResolvable);
  if (files.length > 0 && resolvable.length === files.length) {
    const resolution = await resolveGeneratedConflicts(cwd, files);
    if (resolution.success) {
      const after = (await git(["rev-parse", "HEAD"], cwd)).stdout.trim();
      return {
        kind: "updated",
        behind,
        fastForward,
        ...anchors,
        after,
        autoResolved: files,
      };
    }
    const abort = await git(["merge", "--abort"], cwd);
    return {
      kind: "conflict",
      files,
      resolvable,
      aborted: abort.success,
      resolutionFailure: resolution.reason,
    };
  }
  // Step aside so the worktree is left exactly as it was before the merge — and
  // VERIFY the abort: reporting a clean tree while MERGE_HEAD persists would
  // strand the caller inside a half-merge it was told doesn't exist.
  const abort = await git(["merge", "--abort"], cwd);
  return { kind: "conflict", files, resolvable, aborted: abort.success };
}

/** A path as a literal Git pathspec, so punctuation can never become pathspec magic. */
function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

/** Whether an unmerged path has a stage-3 (incoming/theirs) blob. */
async function unmergedPathHasTheirs(
  cwd: string,
  path: string,
): Promise<boolean | undefined> {
  const listed = await git(
    ["ls-files", "--unmerged", "-z", "--", literalPathspec(path)],
    cwd,
  );
  if (!listed.success) {
    return undefined;
  }
  return splitNulRecords(listed.stdout).some((record) => {
    const tab = record.indexOf("\t");
    const fields = (tab === -1 ? record : record.slice(0, tab)).split(" ");
    return fields[2] === "3";
  });
}

/**
 * Resolve a generated-only conflict to the incoming side, stage every path, and
 * finish Git's existing merge message without opening an editor. A missing
 * stage-3 blob means the incoming side deleted the path, so choosing theirs
 * removes it. Regeneration is the later authority on the final bytes.
 */
async function resolveGeneratedConflicts(
  cwd: string,
  paths: readonly string[],
): Promise<{ success: true } | { success: false; reason: string }> {
  for (const path of paths) {
    const checkedOut = await git(
      ["checkout", "--theirs", "--", literalPathspec(path)],
      cwd,
    );
    if (checkedOut.success) {
      continue;
    }
    const hasTheirs = await unmergedPathHasTheirs(cwd, path);
    if (hasTheirs !== false) {
      return {
        success: false,
        reason: checkedOut.stderr.trim() ||
          `Git could not take the incoming side of ${path}`,
      };
    }
    const removed = await git(
      ["rm", "-f", "--ignore-unmatch", "--", literalPathspec(path)],
      cwd,
    );
    if (!removed.success) {
      return {
        success: false,
        reason: removed.stderr.trim() ||
          `Git could not take the incoming deletion of ${path}`,
      };
    }
  }
  const staged = await git(
    ["add", "-A", "--", ...paths.map(literalPathspec)],
    cwd,
  );
  if (!staged.success) {
    return {
      success: false,
      reason: staged.stderr.trim() ||
        "Git could not stage the generated conflict resolution",
    };
  }
  const remaining = await git(
    ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=U"],
    cwd,
  );
  if (!remaining.success || splitNulRecords(remaining.stdout).length > 0) {
    return {
      success: false,
      reason: "Git still reports unmerged paths after taking the incoming side",
    };
  }
  const continued = await git(
    ["-c", "core.editor=true", "merge", "--continue"],
    cwd,
  );
  return continued.success ? { success: true } : {
    success: false,
    reason: continued.stderr.trim() || "Git could not complete the merge",
  };
}

/** Commit the exact regenerated paths after an update has merged its source. */
export async function commitUpdateRegeneration(
  cwd: string,
  paths: readonly string[],
): Promise<GitResult> {
  const staged = await git(
    ["add", "-A", "--", ...paths.map(literalPathspec)],
    cwd,
  );
  if (!staged.success) {
    return staged;
  }
  const [branch, head, tree] = await Promise.all([
    git(["branch", "--show-current"], cwd),
    git(["rev-parse", "--verify", "HEAD"], cwd),
    git(["write-tree"], cwd),
  ]);
  if (!branch.success || !head.success || !tree.success) {
    return !branch.success ? branch : !head.success ? head : tree;
  }
  return await commitDiscernChanges({
    site: DISCERN_AUTHORED_COMMIT_SITES.updateRegeneration,
    cwd,
    subject: "Regenerate artifacts after update",
    body:
      "Re-derive declared artifacts from the merged sources so their committed bytes match the integrated tree.",
    pathspecs: paths,
    source: "staged-index",
    stagedProof: {
      branch: branch.stdout.trim(),
      head: head.stdout.trim(),
      tree: tree.stdout.trim(),
    },
  });
}

/** One commit an integration brought in (short sha + subject line). */
export interface IntegrationCommit {
  sha: string;
  subject: string;
}

/**
 * One file an integration changed beneath the branch. `added`/`removed` are `null`
 * for a binary file (git prints `-`). `status` is git's single-letter code
 * (`A`/`M`/`D`/`T`); renames are decomposed to a delete + add (via `--no-renames`)
 * so every entry is one matchable path, regardless of the user's `diff.renames`.
 */
export interface IntegrationFile {
  path: string;
  status: string;
  added: number | null;
  removed: number | null;
}

/**
 * An integration's content summary: the commits and files it brought in (each
 * capped, with the pre-cap `*Total` and a `*Truncated` flag), plus the FULL,
 * uncapped path sets the summary layer needs — `theirsPaths` (what changed beneath
 * the branch) and `ownPaths` (the branch's own changes since the fork). Pure git
 * mechanics: the overlap intersection and the scope classification (which need the
 * project config) are the lifecycle layer's to compute from these.
 */
export interface IntegrationDelta {
  commits: IntegrationCommit[];
  commitsTotal: number;
  commitsTruncated: boolean;
  files: IntegrationFile[];
  filesTotal: number;
  filesTruncated: boolean;
  theirsPaths: string[];
  ownPaths: string[];
}

/**
 * Read a diff range's changed files — status (`A`/`M`/`D`, renames decomposed via
 * `--no-renames`) merged with line counts — capped to `cap`, returned with the
 * pre-cap total, whole-range `insertions`/`deletions` sums (binary files count 0),
 * and the full ordered path set. The status list is authoritative for order and
 * membership; numstat only supplies the `+`/`-` counts. Fails open to an empty
 * result. Exported because the gate's receipt reads its diffstat vs the trunk
 * through this same machinery — one definition of "what changed in a range".
 */
export async function diffFiles(
  cwd: string,
  range: string,
  cap: number,
): Promise<
  {
    files: IntegrationFile[];
    filesTotal: number;
    insertions: number;
    deletions: number;
    theirsPaths: string[];
  }
> {
  // line counts, keyed by path: "<added>\t<removed>\t<path>", "-" for a binary.
  const counts = new Map<
    string,
    { added: number | null; removed: number | null }
  >();
  const numstat = await git(
    ["diff", "--numstat", "-z", "--no-renames", range],
    cwd,
  );
  if (numstat.success) {
    for (const line of splitNulRecords(numstat.stdout)) {
      const [a, r, ...rest] = line.split("\t");
      const path = rest.join("\t");
      if (path === "") {
        continue;
      }
      counts.set(path, {
        added: a === "-" ? null : Number(a) || 0,
        removed: r === "-" ? null : Number(r) || 0,
      });
    }
  }
  let insertions = 0;
  let deletions = 0;
  for (const c of counts.values()) {
    insertions += c.added ?? 0;
    deletions += c.removed ?? 0;
  }
  // status letters: with -z, alternating "<X>" and "<path>" NUL fields — the
  // ordered, authoritative path list (`--no-renames` guarantees the pairing:
  // no rename record ever carries a second path field).
  const files: IntegrationFile[] = [];
  const theirsPaths: string[] = [];
  const nameStatus = await git(
    ["diff", "--name-status", "-z", "--no-renames", range],
    cwd,
  );
  if (nameStatus.success) {
    const fields = nameStatus.stdout.split("\0");
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const status = fields[i] ?? "";
      const path = fields[i + 1] ?? "";
      if (status === "" || path === "") {
        continue;
      }
      theirsPaths.push(path);
      if (files.length < cap) {
        const c = counts.get(path) ?? { added: null, removed: null };
        files.push({ path, status, added: c.added, removed: c.removed });
      }
    }
  }
  return {
    files,
    filesTotal: theirsPaths.length,
    insertions,
    deletions,
    theirsPaths,
  };
}

/** `git diff --name-only -z --no-renames <a> <b>` → the changed paths, `[]` on
 * error. The one name-only diff both the integration delta and the overlap reads
 * share. */
async function diffNames(
  cwd: string,
  a: string,
  b: string,
): Promise<string[]> {
  const r = await git(["diff", "--name-only", "-z", "--no-renames", a, b], cwd);
  return r.success ? splitNulRecords(r.stdout) : [];
}

/**
 * The overlap of two changed-path sets — the paths in BOTH, in `incoming` order,
 * deduped and capped to `cap`, with the pre-cap `total`. The single definition of
 * the "hot zone" intersection, shared by update's summary and status's behind
 * report so the two can never compute it differently.
 */
export function overlapPaths(
  own: string[],
  incoming: string[],
  cap: number,
): { overlap: string[]; total: number } {
  const ownSet = new Set(own);
  const seen = new Set<string>();
  const all: string[] = [];
  for (const p of incoming) {
    if (ownSet.has(p) && !seen.has(p)) {
      seen.add(p);
      all.push(p);
    }
  }
  return { overlap: all.slice(0, cap), total: all.length };
}

/**
 * The files the current branch changed that the integration branch ALSO changed
 * since their fork — the "hot zone" status surfaces when the branch is behind, so an
 * agent sees which of its own work `mainBranch` is about to touch BEFORE it
 * updates. Read-only and predictive (never merges): own = `base..HEAD`, incoming
 * = `base..main`, intersected by {@link overlapPaths}. Matches what `update
 * --dry-run` reports. Fails open to empty (a git hiccup, or no fork point).
 */
export async function incomingOverlap(
  cwd: string,
  mainBranch: string,
  cap: number,
): Promise<{ overlap: string[]; total: number }> {
  const { base, before, main } = await resolveIntegrationAnchors(
    cwd,
    mainBranch,
  );
  if (base === "" || before === "" || main === "") {
    return { overlap: [], total: 0 };
  }
  const own = await diffNames(cwd, base, before);
  const incoming = await diffNames(cwd, base, main);
  return overlapPaths(own, incoming, cap);
}

/** One cross-worktree collision: two branches whose fork diffs touch the same
 * paths. `overlap` is capped; `total` is the true pre-cap count. */
export interface FleetCollision {
  branches: [string, string];
  overlap: string[];
  total: number;
}

/**
 * Cross-worktree changed-file collisions — the fact only a fleet-wide view can
 * hold: two efforts touching the same paths are a semantic collision in the
 * making even when both would merge cleanly, and whoever lands second must
 * update with extra care. Each branch's changed set is its fork diff vs the
 * trunk (`merge-base(main, branch)..branch`, the same "own" side
 * {@link incomingOverlap} reads), and pairs intersect via {@link overlapPaths}.
 * Branches are repo-wide, so one checkout answers for the whole fleet.
 * Read-only; every git read fails open to an empty result.
 */
export async function fleetCollisions(
  cwd: string,
  branches: string[],
  mainBranch: string,
  cap: number,
): Promise<FleetCollision[]> {
  const changed: [string, string[]][] = [];
  for (const branch of [...new Set(branches)]) {
    const baseRun = await git(["merge-base", mainBranch, branch], cwd);
    if (!baseRun.success) {
      continue;
    }
    const base = baseRun.stdout.trim();
    if (base === "") {
      continue;
    }
    const paths = await diffNames(cwd, base, branch);
    if (paths.length > 0) {
      changed.push([branch, paths]);
    }
  }
  const out: FleetCollision[] = [];
  for (const [i, [a, aPaths]] of changed.entries()) {
    for (const [b, bPaths] of changed.slice(i + 1)) {
      const { overlap, total } = overlapPaths(aPaths, bPaths, cap);
      if (total > 0) {
        out.push({ branches: [a, b], overlap, total });
      }
    }
  }
  return out;
}

/** One in-flight ADR number collision: a record number claimed by files ADDED
 * on two or more unlanded branches. `paths` lists every claiming record in
 * branch order. */
export interface AdrNumberCollision {
  number: string;
  branches: string[];
  paths: string[];
}

/**
 * ADR record numbers claimed by more than one in-flight branch — the collision
 * {@link fleetCollisions} can never see: two efforts that each picked the next
 * free number added DIFFERENT files, so no path intersects, both merge
 * cleanly, and the duplicate surfaces only when the second one lands and the
 * gate's uniqueness check refuses it. This scan is the early warning, while a
 * renumber is still cheap (nothing cites the number yet). Each branch's claim
 * set is the record files its fork diff ADDS under `adrDir` (repo-relative,
 * POSIX), read with a pathspec so the cost stays one scoped diff per branch.
 * Read-only; every git read fails open to an empty result.
 */
export async function adrNumberCollisions(
  cwd: string,
  branches: string[],
  mainBranch: string,
  adrDir: string,
): Promise<AdrNumberCollision[]> {
  const claims = new Map<string, Map<string, string[]>>();
  for (const branch of [...new Set(branches)]) {
    const baseRun = await git(["merge-base", mainBranch, branch], cwd);
    if (!baseRun.success) {
      continue;
    }
    const base = baseRun.stdout.trim();
    if (base === "") {
      continue;
    }
    const r = await git([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--diff-filter=A",
      base,
      branch,
      "--",
      adrDir,
    ], cwd);
    if (!r.success) {
      continue;
    }
    for (const path of splitNulRecords(r.stdout)) {
      const number = adrNumberOf(path);
      if (number === undefined) {
        continue;
      }
      const byBranch = claims.get(number) ?? new Map<string, string[]>();
      const paths = byBranch.get(branch) ?? [];
      paths.push(path);
      byBranch.set(branch, paths);
      claims.set(number, byBranch);
    }
  }
  const out: AdrNumberCollision[] = [];
  const numbers = [...claims.keys()].sort((a, b) => a.localeCompare(b));
  for (const number of numbers) {
    const byBranch = claims.get(number) ?? new Map<string, string[]>();
    if (byBranch.size < 2) {
      continue;
    }
    const claimants = [...byBranch.keys()].sort();
    out.push({
      number,
      branches: claimants,
      paths: claimants.flatMap((b) => (byBranch.get(b) ?? []).sort()),
    });
  }
  return out;
}

/**
 * Compute an integration's content summary from its {@link IntegrationAnchors} (plus
 * `after` on an apply). Commits are those main authored since the fork (`before..main`
 * — our own merge node is unreachable from main, so the count matches `behind`). The
 * file delta is the real post-merge tree change on an apply (`before..after`,
 * reflecting any conflict resolution) or the predicted incoming change on a
 * `--dry-run` (`before...main`, the three-dot diff from the fork point) — selected by
 * `opts.predicted`. Every git read fails open to an empty result and never throws:
 * on an apply the merge has already landed, so a summary hiccup must not raise.
 */
export async function integrationDelta(
  cwd: string,
  anchors: { base: string; before: string; main: string; after?: string },
  opts: { predicted: boolean; commitCap: number; fileCap: number },
): Promise<IntegrationDelta> {
  const { base, before, main, after } = anchors;
  const fileRange = opts.predicted
    ? `${before}...${main}`
    : `${before}..${after}`;

  // commits main authored since the fork: "%h<TAB>%s" → short sha + subject.
  const commits: IntegrationCommit[] = [];
  let commitsTotal = 0;
  const logRun = await git(
    ["log", "--pretty=format:%h%x09%s", `${before}..${main}`],
    cwd,
  );
  if (logRun.success) {
    const lines = logRun.stdout.split("\n").filter((l) => l !== "");
    commitsTotal = lines.length;
    for (const line of lines.slice(0, opts.commitCap)) {
      const tab = line.indexOf("\t");
      commits.push({
        sha: tab >= 0 ? line.slice(0, tab) : line,
        subject: tab >= 0 ? line.slice(tab + 1) : "",
      });
    }
  }

  const { files, filesTotal, theirsPaths } = await diffFiles(
    cwd,
    fileRange,
    opts.fileCap,
  );

  // the branch's own changed paths since the fork (for the overlap intersection).
  const ownPaths = base !== "" && before !== ""
    ? await diffNames(cwd, base, before)
    : [];

  return {
    commits,
    commitsTotal,
    commitsTruncated: commitsTotal > commits.length,
    files,
    filesTotal,
    filesTruncated: filesTotal > files.length,
    theirsPaths,
    ownPaths,
  };
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
      "This worktree is not on a named branch, and Git could not resolve its current " +
        "commit. Run `git status` to repair or restore the checkout, then re-run.",
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
      `Discern generated the invalid branch name '${candidate}'. Set ` +
        `[repository].branch_prefix to a Git-safe prefix, then re-run.`,
    );
  }

  const switched = await git(["switch", "-c", candidate], cwd);
  if (!switched.success) {
    throw new WorktreeGitError(
      `This worktree is detached, and Git could not create branch '${candidate}'. ` +
        `Fix the Git error below, then run \`git switch -c ${candidate}\` and re-run ` +
        `the discern command.\nGit said: ${switched.stderr.trim()}`,
    );
  }
  return candidate;
}

/**
 * Create a linked worktree at `dir` on a fresh branch `branch`, added from the
 * main checkout at `mainRepo`. `startPoint` names the ref the new branch forks
 * from; omitted, git uses the main checkout's HEAD (the caller decides — `start`
 * passes the trunk so a parked main checkout never poisons a new worktree, the
 * viability probe deliberately passes nothing, ADR 0090). Idempotent: if `dir` is
 * already a worktree (its `.git` exists) it is a no-op, so a hook that re-fires
 * never errors. Throws `WorktreeGitError` on a git failure. The caller chooses
 * the directory and the branch name — this helper bakes in NO location or naming
 * convention (the git layer stays agent-agnostic; the Claude-Code-specific
 * `.claude/worktrees` convention lives in the hook adapter that calls this).
 */
export async function addWorktree(
  mainRepo: string,
  dir: string,
  branch: string,
  startPoint?: string,
): Promise<void> {
  if (await pathExists(join(dir, ".git"))) {
    return;
  }
  const args = ["worktree", "add", dir, "-b", branch];
  if (startPoint !== undefined && startPoint !== "") {
    args.push(startPoint);
  }
  const run = await git(args, mainRepo);
  if (!run.success) {
    throw new WorktreeGitError(
      `Git could not create the worktree at '${dir}' on branch '${branch}'. Fix the ` +
        `Git error below, then re-run the command.\nGit said: ${run.stderr.trim()}`,
    );
  }
}

/** Whether the repo at `cwd` has any commit at all — on ANY ref, not just HEAD:
 * a main checkout parked on an orphan branch still has history to branch from,
 * and telling it "this repository has no commits yet" is a lie. False only on a
 * truly commit-less repo (a fresh `git init`), where nothing can branch. */
export async function hasAnyCommit(cwd: string): Promise<boolean> {
  const run = await git(["rev-list", "--all", "--max-count=1"], cwd);
  return run.success && run.stdout.trim() !== "";
}

/** Whether `branch` exists as a local branch in the repo at `cwd`. */
export async function localBranchExists(
  cwd: string,
  branch: string,
): Promise<boolean> {
  return (await git(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    cwd,
  )).success;
}

/** The repository's top-level working directory (`git rev-parse --show-toplevel`),
 * canonicalized, or undefined outside a git repository. The counterpart `doctor`
 * and `start` compare the project root against, to catch a `discern.toml` living
 * in a subdirectory of its repo. */
export async function repoToplevel(cwd: string): Promise<string | undefined> {
  const run = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!run.success) {
    return undefined;
  }
  const raw = run.stdout.trim();
  return raw === "" ? undefined : await realPathOr(raw);
}

/**
 * The full ref names a short name matches, in git's own disambiguation order
 * (gitrevisions(7)). `for-each-ref` patterns match whole path components, so a
 * branch `v1/sub` also answers the pattern `refs/heads/v1` — the exact-match
 * filter keeps only refs the short name itself denotes.
 */
async function matchingRefs(cwd: string, name: string): Promise<string[]> {
  const patterns = [
    `refs/${name}`,
    `refs/tags/${name}`,
    `refs/heads/${name}`,
    `refs/remotes/${name}`,
    `refs/remotes/${name}/HEAD`,
  ];
  const run = await git(
    ["for-each-ref", "--format=%(refname)", ...patterns],
    cwd,
  );
  if (!run.success) {
    return [];
  }
  const refs = new Set(
    run.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
  );
  return patterns.filter((p) => refs.has(p));
}

/**
 * Resolve `ref` to a commit in the repo at `cwd`, refusing an unknown or
 * ambiguous name in plain language. The ONE resolver behind every ref a user
 * hands the worktree lifecycle (`start --from`, `update --from`), so the two
 * verbs can never accept different vocabularies. Returns the resolved commit
 * SHA (an annotated tag is peeled to the commit it tags); the caller usually
 * keeps using the NAME (better reflogs), this is the existence/ambiguity check.
 *
 * Ambiguity is detected by enumerating the matching refs, never by reading
 * git's stderr: `rev-parse` resolves an ambiguous short name by precedence with
 * only a warning — which `--verify --quiet` suppresses entirely, and which is
 * locale-dependent prose even when present.
 */
export async function resolveCommitRef(
  cwd: string,
  ref: string,
): Promise<string> {
  if (ref.trim() === "") {
    throw new WorktreeGitError(
      "A ref name is required. Pass a branch, tag, or commit, then re-run.",
    );
  }
  const candidates = await matchingRefs(cwd, ref);
  if (candidates.length > 1) {
    throw new WorktreeGitError(
      `The ref '${ref}' is ambiguous — it names ${
        candidates.join(" and ")
      }. Pass the full name (e.g. ${candidates[0]}), then re-run.`,
    );
  }
  // Exactly one ref matches → resolve that full name (no precedence in play);
  // none → let rev-parse try the input as a revision (a SHA, `HEAD~2`, …).
  const target = candidates.length === 1 && candidates[0] !== undefined
    ? candidates[0]
    : ref;
  const run = await git(["rev-parse", "--verify", `${target}^{commit}`], cwd);
  if (!run.success) {
    const evidence = run.stderr.trim();
    throw new WorktreeGitError(
      `Unknown ref '${ref}' — it doesn't name a branch, tag, or commit in this repository. ` +
        `List local branches with \`git branch\`, choose one, then re-run.` +
        (evidence === "" ? "" : `\n(git: ${evidence})`),
    );
  }
  return run.stdout.trim();
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

/**
 * Resolve the shared common git dir (`git rev-parse --git-common-dir`) as a
 * canonical absolute path, from any worktree or the main checkout. LOAD-BEARING
 * for the resource ledger: git prints an ABSOLUTE path from a linked worktree but
 * a RELATIVE `.git` from the main checkout, so the writer (a worktree) and the GC
 * (the main checkout) MUST normalise through this one helper or they would target
 * different `<common>/discern/` directories and the ledger would be invisible to
 * GC. Returns undefined outside a git repository.
 */
export async function resolveCommonGitDir(
  cwd?: string,
): Promise<string | undefined> {
  const run = await git(["rev-parse", "--git-common-dir"], cwd);
  if (!run.success) {
    return undefined;
  }
  let raw = run.stdout.trim();
  if (raw === "") {
    return undefined;
  }
  if (!isAbsolute(raw)) {
    raw = resolve(cwd ?? Deno.cwd(), raw);
  }
  return await realPathOr(raw);
}

/** Resolve the shared common git dir as seen from `mainRepo`. */
async function commonGitDirFrom(
  mainRepo: string,
): Promise<string | undefined> {
  return await resolveCommonGitDir(mainRepo);
}

/**
 * This linked worktree's git key — the basename of its admin directory
 * (`<common>/worktrees/<key>`), git's own stable, unique-per-live-worktree
 * identity. The ledger keys on this (not the resolved worktree id, which the
 * `DISCERN_WORKTREE_ID` override can move; not the path, which symlinks and reuse
 * make ambiguous). Returns undefined outside a repo or in the main checkout
 * (where the absolute and common git dirs are the same).
 */
export async function worktreeGitKey(
  cwd?: string,
): Promise<string | undefined> {
  const { absoluteGitDir, commonGitDir } = await resolveGitDirs(
    cwd ?? Deno.cwd(),
  );
  if (
    absoluteGitDir === undefined || commonGitDir === undefined ||
    absoluteGitDir === commonGitDir
  ) {
    return undefined;
  }
  return basename(absoluteGitDir);
}

/**
 * Detect SILENT DIVERGENCE: the worktree at `cwd` stays pristine (clean, no
 * commits ahead of the integration branch) while the main checkout accumulates
 * uncommitted changes — the signature of an agent that could not re-root and is
 * editing the trunk while discern's tools run here. Returns the explicit warning
 * (one wording, shared by `status` and `done`), or undefined when the shape
 * doesn't match. Read-only; fails open to undefined.
 */
export async function detectSilentDivergence(
  cwd: string,
  mainBranchFallback?: string,
): Promise<FiredHint | undefined> {
  if (await worktreeGitKey(cwd) === undefined) {
    return undefined; // not a linked worktree — nothing to diverge from
  }
  const here = await gitSnapshot(cwd, mainBranchFallback);
  if (here === undefined || !here.clean || here.ahead > 0) {
    return undefined; // the worktree has real work — no divergence signature
  }
  const mainRepo = await mainRepoPath(cwd);
  if (mainRepo === undefined) {
    return undefined;
  }
  const main = await gitSnapshot(mainRepo, mainBranchFallback);
  if (main === undefined || main.changedFiles === 0) {
    return undefined;
  }
  return fire(HINTS["silent-worktree-divergence"], {
    cwd,
    mainRepo,
    changedFiles: main.changedFiles,
  });
}

/** The per-worktree setup sentinel path (`git rev-parse --git-path discern/worktree-ready`)
 * for the checkout at `cwd`, or undefined when it can't be resolved. */
export async function readySentinelPath(
  cwd: string,
): Promise<string | undefined> {
  return await gitAdminStatePath(cwd, "worktreeReady");
}

/** Whether the worktree at `cwd` completed its setup — the ready sentinel is the
 * proof. The one read of "is this worktree configured?" for the setup /
 * session-start paths (via the lifecycle). Deliberately NOT status's
 * broken-worktree signal: that flags on missing project CONFIG (a crashed
 * start's signature), because a sentinel-less-but-configured worktree self-heals
 * on its next session, and pre-sentinel worktrees would all false-flag. */
export async function worktreeSetupComplete(cwd: string): Promise<boolean> {
  const marker = await readySentinelPath(cwd);
  if (marker === undefined) {
    return false;
  }
  try {
    return (await Deno.stat(marker)).isFile;
  } catch {
    return false;
  }
}

/**
 * All local `<prefix>*` branches — the in-flight universe: worktree-backed and
 * unlanded alike, repo-wide from any checkout. Empty for an empty prefix or
 * outside a repo.
 */
export async function prefixBranches(
  cwd: string,
  prefix: string,
): Promise<string[]> {
  if (prefix === "") {
    return [];
  }
  const refs = await git(
    ["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`],
    cwd,
  );
  return refs.success ? refs.stdout.split("\n").filter((b) => b !== "") : [];
}

/**
 * Local `<prefix>*` branches holding UNLANDED work with no worktree — commits not
 * on the trunk, and not checked out in any registered worktree. The abandoned-work
 * signal `status` surfaces from the main checkout: a landed branch is deleted,
 * a live one has its worktree, and a fully-merged dangling one is prune's food —
 * what remains is work that would otherwise be invisible. Empty when the trunk is
 * missing (nothing to compare against) or outside a repo.
 */
export async function unlandedPrefixBranches(
  cwd: string,
  prefix: string,
  trunk: string,
): Promise<string[]> {
  if (
    !(await git(
      ["show-ref", "--verify", "--quiet", `refs/heads/${trunk}`],
      cwd,
    ))
      .success
  ) {
    return [];
  }
  const branches = await prefixBranches(cwd, prefix);
  if (branches.length === 0) {
    return [];
  }
  const checkedOut = new Set<string>();
  const list = await git(["worktree", "list", "--porcelain"], cwd);
  if (list.success) {
    for (const rec of parseWorktreeList(list.stdout)) {
      if (rec.branch !== "") {
        checkedOut.add(shortBranchName(rec.branch));
      }
    }
  }
  const out: string[] = [];
  for (const branch of branches) {
    if (checkedOut.has(branch)) {
      continue;
    }
    const merged = await git(
      ["merge-base", "--is-ancestor", branch, trunk],
      cwd,
    );
    if (!merged.success) {
      out.push(branch);
    }
  }
  return out;
}

/**
 * The set of LIVE linked-worktree keys — the basenames of `<common>/worktrees/<key>`
 * admin directories whose back-pointer (`gitdir`) still names an existing checkout.
 * This is git's own registry of live worktrees and the authoritative orphan-GC
 * key: it is immune to path canonicalisation and to the `DISCERN_WORKTREE_ID`
 * override that can make a resolved worktree id differ from its admin-dir name. A
 * dir whose checkout is gone (hard kill / `rm -rf`) is dropped, so a ledger entry
 * keyed by a missing key is provably an orphan. Empty when there is no worktrees
 * admin dir.
 */
export async function liveWorktreeGitKeys(
  commonGitDir: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const worktreesDir = join(commonGitDir, "worktrees");
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(worktreesDir)) {
      entries.push(e);
    }
  } catch {
    return keys; // no worktrees admin dir → no live linked worktrees
  }
  for (const entry of entries) {
    if (entry.isDirectory && await gitKeyIsLive(commonGitDir, entry.name)) {
      keys.add(entry.name);
    }
  }
  return keys;
}

/**
 * Whether one git key is live RIGHT NOW — its `<common>/worktrees/<key>/gitdir`
 * back-pointer names a checkout that still exists. The single-key form of
 * {@link liveWorktreeGitKeys}, for a fresh re-check immediately before a
 * destructive GC action (closing the race where a concurrent worktree-create
 * recycles a freed key after the liveness snapshot was taken).
 */
export async function gitKeyIsLive(
  commonGitDir: string,
  gitKey: string,
): Promise<boolean> {
  // `gitdir` holds the absolute path of the checkout's `.git` gitlink file. If
  // that file is gone the worktree was removed out-of-band — a dead key.
  // NOTE: `pathExists` returns false on a transient stat error too, so this can
  // vote "dead" for a live worktree — the fail-open-toward-destroy direction. It is
  // safe only as DEFENSE IN DEPTH: an entry reaches this re-check only after the
  // snapshot already classified it reclaimable (not live by path AND handle), and
  // the handle is independently re-checked against disk before the destroy. Do not
  // make this the sole guard.
  const target = (await firstLine(
    join(commonGitDir, "worktrees", gitKey, "gitdir"),
  ))?.trim();
  return target !== undefined && target !== "" && await pathExists(target);
}

/**
 * The canonical paths of every currently-registered, non-prunable worktree of
 * this repo — a secondary, fail-safe guard for resource GC (never reclaim a
 * resource whose worktree path is still registered, even if the key bookkeeping
 * looks orphaned). Factored from {@link sweepOrphanWorktrees}'s inline scan.
 */
export async function liveWorktreePaths(cwd?: string): Promise<Set<string>> {
  const run = await git(["worktree", "list", "--porcelain"], cwd);
  const paths = new Set<string>();
  for (const rec of parseWorktreeList(run.stdout)) {
    if (rec.prunable || rec.path === "") {
      continue;
    }
    if (await isDir(rec.path)) {
      paths.add(await realPathOr(rec.path));
    }
  }
  return paths;
}

/**
 * The `git worktree list --porcelain` record for the registered worktree at
 * `target` (canonical-path match), or undefined when `target` is not a
 * registered worktree of the repo at `cwd`. The one lookup behind every "is it
 * registered / is it locked" question a removal path asks, so no caller can
 * read the registration a different way and miss an attribute.
 */
export async function registeredWorktreeRecord(
  target: string,
  cwd?: string,
): Promise<WorktreeRecord | undefined> {
  const listRun = await git(["worktree", "list", "--porcelain"], cwd);
  if (!listRun.success) {
    return undefined;
  }
  const canonical = await canonicalizeMaybeMissing(target);
  for (const rec of parseWorktreeList(listRun.stdout)) {
    if (
      rec.path === canonical ||
      (await canonicalizeMaybeMissing(rec.path)) === canonical
    ) {
      return rec;
    }
  }
  return undefined;
}

/** The refusal for any attempt to remove a `git worktree lock`ed worktree — the
 * lock's documented purpose is protecting checkouts (and their ignored files)
 * on removable/network media, so discern honors it unconditionally: the only
 * way through is git's own `git worktree unlock`. */
function lockedWorktreeRefusal(path: string): WorktreeGitError {
  return new WorktreeGitError(
    `The worktree at '${path}' is locked with \`git worktree lock\`, so discern ` +
      `left it untouched. Unlock it first ` +
      `(git worktree unlock ${path}), then re-run.`,
  );
}

/**
 * Remove a git worktree robustly, leaving no orphaned directory. Retries the
 * transient `ENOTEMPTY` race on `git worktree remove --force`, then falls back to
 * `rm -rf` + `git worktree prune` — the fallback exists for that race and for
 * gitlinked orphans/damaged checkouts git itself cannot remove, NEVER to
 * overpower a deliberate refusal: a `git worktree lock`ed worktree is refused
 * outright (checked before removing AND re-checked before the fallback, so a
 * lock can't be bulldozed into a phantom registration `git worktree prune`
 * skips forever). Refuses anything that is neither a registered worktree of
 * this repo nor a gitlinked orphan of it (and the main checkout). Mirrors
 * `remove-worktree-safely`. Idempotent: an already-gone, unregistered path is
 * a no-op.
 */
export async function removeWorktreeSafely(
  target: string,
  cwd: string = Deno.cwd(),
  opts: { pruneMetadata?: boolean } = {},
): Promise<void> {
  const mainFirst = await firstWorktreePath(cwd);
  if (mainFirst === undefined || mainFirst === "") {
    throw new WorktreeGitError(
      "Worktree removal needs a Git repository, but this directory is outside one. " +
        "Move into the project's main checkout, then re-run.",
    );
  }
  const mainRepo = await realPathOr(mainFirst);
  const commonGitDir = await commonGitDirFrom(mainRepo);
  const canonical = await canonicalizeMaybeMissing(target);

  if (canonical === mainRepo) {
    throw new WorktreeGitError(
      `'${canonical}' is the main checkout, which worktree removal never deletes. ` +
        `Pass a worktree path instead; use \`git worktree list\` to find one.`,
    );
  }

  // Registered as a current worktree of this repo?
  const record = await registeredWorktreeRecord(canonical, cwd);
  const registered = record !== undefined;

  // A locked worktree is git's deliberate refusal, not an obstacle to route
  // around: honor it before touching anything.
  if (record?.locked === true) {
    throw lockedWorktreeRefusal(canonical);
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
      `'${canonical}' is not a worktree of this repository, so discern left it ` +
        `untouched. Pass a path from \`git worktree list\`, then re-run.`,
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
    break; // any other error → the fallback (after the lock re-check below)
  }

  if (!removed) {
    // Re-check the lock: a lock applied since the first look is exactly the
    // failure git just refused on, and the fallback must not defeat it.
    if ((await registeredWorktreeRecord(canonical, cwd))?.locked === true) {
      throw lockedWorktreeRefusal(canonical);
    }
    if (await pathExists(canonical)) {
      await Deno.remove(canonical, { recursive: true });
    }
    if (opts.pruneMetadata ?? true) {
      await git(["worktree", "prune"], cwd);
    }
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
export interface WorktreeRecord {
  path: string;
  /** The checked-out commit SHA, when `git worktree list --porcelain` reports it. */
  head: string;
  /** The full `branch` ref (e.g. `refs/heads/foo`), or "" when detached. */
  branch: string;
  locked: boolean;
  prunable: boolean;
}

/** Parse `git worktree list --porcelain` into records. */
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
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
        head: "",
        branch: "",
        locked: false,
        prunable: false,
      };
    } else if (cur) {
      if (line.startsWith("HEAD ")) {
        cur.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
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

/**
 * A cheap, read-only snapshot of one checkout: its current branch, whether the
 * working tree is clean, how many paths changed, and how far HEAD sits ahead of /
 * behind the integration branch. The shared shape behind both `status`'s local git
 * block and each fleet row, so the per-worktree numbers are computed one way.
 */
export interface GitSnapshot {
  /** The current branch, or "" when detached. */
  branch: string;
  /** No tracked changes and no untracked non-ignored files in the working tree. */
  clean: boolean;
  /** Count of `git status --porcelain --untracked-files=normal` entries. */
  changedFiles: number;
  /** Commits on HEAD not yet in the integration branch. */
  ahead: number;
  /** Commits on the integration branch not yet in HEAD. */
  behind: number;
  /** Unix-seconds timestamp of the most recent activity: the latest of the last
   * HEAD movement (the reflog — a commit, checkout/reset, OR the worktree's own
   * creation, so a freshly-spawned worktree reads as recent rather than as old as
   * its branch point) and the newest mtime among uncommitted files. Undefined when
   * neither can be determined (e.g. an empty repo with no commits or reflog). */
  lastActivity?: number;
}

/**
 * Commits HEAD is ahead of / behind the integration branch, from one
 * `git rev-list --left-right --count <integration>...HEAD` (left = behind, right =
 * ahead). `{0, 0}` when the integration ref does not resolve (no local main, or a
 * detached/empty repo) — never throws.
 */
async function aheadBehind(
  cwd: string,
  integration: string,
): Promise<{ ahead: number; behind: number }> {
  const run = await git(
    ["rev-list", "--left-right", "--count", `${integration}...HEAD`],
    cwd,
  );
  if (!run.success) {
    return { ahead: 0, behind: 0 };
  }
  const [left, right] = run.stdout.trim().split(/\s+/);
  return { behind: Number(left) || 0, ahead: Number(right) || 0 };
}

/**
 * The read-only {@link GitSnapshot} for the checkout at `cwd`, compared to the
 * integration branch (`DISCERN_TRUNK` / `mainBranchFallback` / `main`). The
 * `clean`
 * predicate is the user-facing / removal-safety one: no tracked changes and no
 * untracked non-ignored files. Pure reads — `rev-parse`, `branch`,
 * `status --porcelain --untracked-files=normal`, `rev-list` — so it never mutates
 * the working tree. Returns undefined when `cwd` is not inside a git repository
 * or Git cannot read its status. An unreadable status is unknown, so callers
 * must not receive a snapshot that claims the checkout is clean.
 */
export async function gitSnapshot(
  cwd: string,
  mainBranchFallback?: string,
): Promise<GitSnapshot | undefined> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.success || inside.stdout.trim() !== "true") {
    return undefined;
  }
  const branchRun = await git(["branch", "--show-current"], cwd);
  const branch = branchRun.success ? branchRun.stdout.trim() : "";
  const dirtyEntries = await statusEntries(cwd, "normal");
  if (dirtyEntries === undefined) {
    return undefined;
  }
  const { ahead, behind } = await aheadBehind(
    cwd,
    integrationBranch(mainBranchFallback),
  );
  const lastActivity = await lastActivityAt(cwd, dirtyEntries);
  return {
    branch,
    clean: dirtyEntries.length === 0,
    changedFiles: dirtyEntries.length,
    ahead,
    behind,
    ...(lastActivity !== undefined ? { lastActivity } : {}),
  };
}

/**
 * Whether the checkout has uncommitted tracked changes. This is deliberately NOT
 * the user-facing `status` cleanliness predicate: it exists for operational
 * preconditions where untracked scratch cannot be swept into the action, such as
 * merging into a worktree or moving the main checkout.
 */
export async function hasUncommittedTrackedChanges(
  cwd: string,
): Promise<boolean | undefined> {
  const entries = await statusEntries(cwd, "no");
  return entries === undefined ? undefined : entries.length > 0;
}

/** Parsed porcelain status entries for one checkout, or undefined on git failure. */
async function statusEntries(
  cwd: string,
  untrackedFiles: "normal" | "no",
): Promise<PorcelainEntry[] | undefined> {
  const statusRun = await git(
    ["status", "--porcelain", "-z", `--untracked-files=${untrackedFiles}`],
    cwd,
  );
  if (!statusRun.success) {
    return undefined;
  }
  return parsePorcelainZ(statusRun.stdout);
}

/**
 * The most recent activity timestamp (unix seconds) for the checkout at `cwd`: the
 * latest of the last HEAD movement (the reflog — which captures commits, checkouts,
 * AND the worktree's own creation) and the newest mtime among the uncommitted files
 * (`dirtyEntries` from `git status --porcelain -z`). Pure reads.
 * Undefined when nothing can be determined. Including the reflog's creation entry
 * is deliberate: it keeps a freshly-spawned worktree from reading as old as the
 * branch point it forked from.
 */
async function lastActivityAt(
  cwd: string,
  dirtyEntries: PorcelainEntry[],
): Promise<number | undefined> {
  // Last HEAD movement: the reflog's newest entry time. Reflog is appended only on
  // HEAD *movement* (commit/checkout/reset/creation), never on reads, so this is
  // stable across repeated read-only `status` runs. Fall back to the HEAD commit
  // time when the reflog is unavailable (disabled, or an oddly-configured repo).
  let best = await lastHeadMoveTime(cwd) ?? await headCommitTime(cwd);
  for (const entry of dirtyEntries) {
    const mtime = await fileMtime(join(cwd, entry.path));
    if (mtime !== undefined && (best === undefined || mtime > best)) {
      best = mtime;
    }
  }
  return best;
}

/** A file's mtime in unix seconds, or undefined when it can't be stat'd (a deletion). */
async function fileMtime(path: string): Promise<number | undefined> {
  try {
    const m = (await Deno.stat(path)).mtime;
    return m === null ? undefined : Math.floor(m.getTime() / 1000);
  } catch {
    return undefined;
  }
}

/** The unix-seconds time of the newest HEAD reflog entry (the last HEAD movement),
 * or undefined when the reflog is empty/unavailable. `--date=unix` renders the
 * selector as `HEAD@{<unix>}`, which we parse — stable across git's locales. */
async function lastHeadMoveTime(cwd: string): Promise<number | undefined> {
  const run = await git(["reflog", "--date=unix", "-1"], cwd);
  if (!run.success) {
    return undefined;
  }
  const m = run.stdout.match(/@\{(\d+)\}/);
  return m === null ? undefined : Number(m[1]);
}

/** The committer time (unix seconds) of HEAD, or undefined in a repo with no commits. */
async function headCommitTime(cwd: string): Promise<number | undefined> {
  const run = await git(["log", "-1", "--format=%ct"], cwd);
  if (!run.success) {
    return undefined;
  }
  const t = run.stdout.trim();
  return t === "" ? undefined : Number(t) || undefined;
}

/** One registered worktree of this repo, with its cheap read-only snapshot. */
export interface FleetWorktree {
  /** Canonical worktree path. */
  path: string;
  /** Git lists the main checkout first — its row is flagged so nothing is hidden. */
  isMain: boolean;
  /** The current branch, or "" when detached. */
  branch: string;
  /** `git worktree lock` is set on this registration — git refuses to remove it. */
  locked: boolean;
  /** Git reports the registration prunable (its checkout is gone or damaged). */
  prunable: boolean;
  /**
   * The checkout's read-only {@link GitSnapshot}, or undefined when git could not
   * run inside it (a missing directory, a corrupted gitlink, a dubious-ownership
   * or permission refusal). Undefined means the state is UNKNOWN — never clean:
   * every consumer must fail safe, treating the worktree as if it may hold
   * uncommitted and unlanded work, not substitute optimistic defaults.
   */
  snapshot: GitSnapshot | undefined;
}

/**
 * Every registered worktree of this repo, each with a cheap {@link GitSnapshot}
 * (branch, cleanliness, files changed, ahead/behind the integration branch) — the
 * supervisor's fleet survey for `status` from the main checkout. Reuses
 * {@link parseWorktreeList} (the single porcelain parser) and {@link gitSnapshot}
 * (the single per-checkout read), so a fleet row and the local block can never
 * disagree on how a worktree's state is measured. The main checkout is always row 0
 * (git lists it first). Empty when `cwd` is not inside a git repository.
 */
export async function listWorktreeFleet(
  cwd: string,
  mainBranchFallback?: string,
): Promise<FleetWorktree[]> {
  const listRun = await git(["worktree", "list", "--porcelain"], cwd);
  if (!listRun.success) {
    return [];
  }
  const out: FleetWorktree[] = [];
  const records = parseWorktreeList(listRun.stdout);
  for (const [i, rec] of records.entries()) {
    const snap = await gitSnapshot(rec.path, mainBranchFallback);
    const short = rec.branch.startsWith("refs/heads/")
      ? rec.branch.slice("refs/heads/".length)
      : rec.branch;
    out.push({
      path: await realPathOr(rec.path),
      isMain: i === 0,
      // The porcelain branch stays the fallback: an unreadable checkout's branch
      // ref is still knowable from the registration.
      branch: snap?.branch !== undefined && snap.branch !== ""
        ? snap.branch
        : short,
      locked: rec.locked,
      prunable: rec.prunable,
      snapshot: snap,
    });
  }
  return out;
}

/** Options for the read-only git-worktree prune scan. */
export interface PruneScanOptions {
  /** Allow clean detached worktrees whose HEAD is already merged to be removed. */
  includeDetached?: boolean;
  /** Integration-branch fallback when `DISCERN_TRUNK` is unset (`[repository].trunk`). */
  mainBranch?: string;
}

/** One planned linked-worktree removal from the git-worktree scan. */
export interface WorktreeRemovalCandidate {
  path: string;
  /** The checked-out local branch to delete after removal, or "" for detached. */
  branch: string;
}

/** One stale git worktree admin entry the scan found. */
export interface StaleWorktreeMetadata {
  /** The checkout path git reports as prunable. */
  path: string;
  /** The exact `<common>/worktrees/<key>` admin dir to prune. */
  adminDir: string;
  /** The `gitdir` back-pointer recorded when the scan ran. */
  gitDir: string;
}

/** One rendered line from the git-worktree prune scan. */
export interface PruneScanLine {
  action: "KEEP" | "REMOVE" | "PRUNE" | "DELETE";
  label: string;
  reason: string;
}

/** The read-only scan that `worktree prune` later applies exactly. */
export interface GitWorktreePruneScan {
  repoRoot: string;
  mainBranch: string;
  worktreesToRemove: WorktreeRemovalCandidate[];
  branchesToDelete: string[];
  staleMetadata: StaleWorktreeMetadata[];
  worktreeLines: PruneScanLine[];
  branchLines: PruneScanLine[];
}

/** The outcome of a prune run. */
export interface PruneResult {
  /** Worktrees removed. */
  removed: string[];
  /** Branches deleted. */
  branchesDeleted: string[];
  /** Stale worktree metadata entries pruned. */
  staleMetadata: string[];
  /** Whether any removal or branch deletion failed. */
  failed: boolean;
}

/** The outcome of applying the planned stale-metadata cleanup. */
export interface StaleMetadataPruneResult {
  pruned: string[];
  failed: boolean;
}

/** Whether `branch`'s tip is an ancestor of `mainBranch` — i.e. fully merged.
 * Read from the main repo, so it answers even when the branch's worktree
 * checkout is itself unreadable. */
export async function branchIsMerged(
  repoRoot: string,
  branch: string,
  mainBranch: string,
): Promise<boolean> {
  return (await git([
    "merge-base",
    "--is-ancestor",
    `refs/heads/${branch}`,
    `refs/heads/${mainBranch}`,
  ], repoRoot)).success;
}

/** Whether `commit` is reachable from `mainBranch` — the sha-level sibling of
 * {@link branchIsMerged}, for callers that pinned a tip before the branch could
 * be deleted (acceptance removes the branch as it lands). */
export async function commitIsMerged(
  repoRoot: string,
  commit: string,
  mainBranch: string,
): Promise<boolean> {
  return await commitIsAncestorOf(
    repoRoot,
    commit,
    `refs/heads/${mainBranch}`,
  );
}

/** Whether one commit is an ancestor of an arbitrary descendant ref. */
export async function commitIsAncestorOf(
  repoRoot: string,
  commit: string,
  descendant: string,
): Promise<boolean> {
  return commit !== "" &&
    descendant !== "" &&
    (await git([
      "merge-base",
      "--is-ancestor",
      commit,
      descendant,
    ], repoRoot)).success;
}

/**
 * The registered worktree path checked out on `branch`, or undefined when no
 * checkout holds it. One porcelain read through {@link parseWorktreeList} (the
 * single parser), with none of the per-checkout snapshots a full
 * {@link listWorktreeFleet} pays for — the shape a repeated poll can afford.
 */
export async function worktreePathForBranch(
  cwd: string,
  branch: string,
): Promise<string | undefined> {
  const listRun = await git(["worktree", "list", "--porcelain"], cwd);
  if (!listRun.success) {
    return undefined;
  }
  const match = parseWorktreeList(listRun.stdout).find(
    (rec) => rec.branch === `refs/heads/${branch}`,
  );
  return match === undefined ? undefined : await realPathOr(match.path);
}

/** Strip the local-head namespace while preserving detached and nonlocal refs. */
function shortBranchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/**
 * Why a linked worktree must be KEPT rather than removed — empty means it is
 * removable (clean, with its branch or detached HEAD fully merged). The single
 * eligibility predicate for worktree removal: the prune scan classifies with
 * it, and {@link removalCandidateChanged} re-runs it per candidate at apply
 * time, so the two can never drift apart.
 */
async function worktreeKeepReasons(
  repoRoot: string,
  rec: WorktreeRecord,
  mainBranch: string,
  includeDetached: boolean,
): Promise<string[]> {
  const shortBranch = shortBranchName(rec.branch);
  const keepReasons: string[] = [];
  if (rec.locked) {
    keepReasons.push("locked");
  }
  if (shortBranch !== "") {
    if (!(await branchIsMerged(repoRoot, shortBranch, mainBranch))) {
      keepReasons.push(`branch ${shortBranch} has unmerged commits`);
    }
  } else if (!includeDetached) {
    keepReasons.push("detached HEAD");
  } else if (!(await commitIsMerged(repoRoot, rec.head, mainBranch))) {
    keepReasons.push("detached HEAD has unmerged commits");
  }

  const statusRun = await git(
    [
      "-C",
      rec.path,
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=normal",
    ],
  );
  if (!statusRun.success) {
    keepReasons.push("status failed; skipped");
  } else if (statusRun.stdout.trim() !== "") {
    const count = parsePorcelainZ(statusRun.stdout).length;
    keepReasons.push(`dirty ${count} status entries`);
  }
  return keepReasons;
}

/** Recover a checkout path from either a main .git directory or linked gitdir. */
function checkoutPathFromGitDir(gitDir: string): string {
  return basename(gitDir) === ".git" ? dirname(gitDir) : gitDir;
}

/** Correlate a prunable worktree record with its exact administrative back-pointer. */
async function staleMetadataForRecord(
  commonGitDir: string,
  rec: WorktreeRecord,
): Promise<StaleWorktreeMetadata> {
  const canonicalRecord = await canonicalizeMaybeMissing(rec.path);
  const worktreesDir = join(commonGitDir, "worktrees");
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(worktreesDir)) {
      entries.push(entry);
    }
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }
    const adminDir = join(worktreesDir, entry.name);
    const raw = (await firstLine(join(adminDir, "gitdir")))?.trim();
    if (raw === undefined || raw === "") {
      continue;
    }
    const gitDir = isAbsolute(raw) ? raw : resolve(adminDir, raw);
    const checkoutPath = checkoutPathFromGitDir(gitDir);
    if ((await canonicalizeMaybeMissing(checkoutPath)) === canonicalRecord) {
      return { path: rec.path, adminDir, gitDir };
    }
  }
  throw new WorktreeGitError(
    `Worktree pruning could not resolve stale Git metadata for '${rec.path}'. Run ` +
      `\`git worktree repair\`, then re-run \`discern worktree prune\`.`,
  );
}

/**
 * Scan stale git worktrees and fully-merged branches while keeping work worth
 * reviewing. Read-only: it returns the exact candidate set the apply path will
 * consume.
 */
export async function scanGitWorktreesForPrune(
  opts: PruneScanOptions,
): Promise<GitWorktreePruneScan> {
  const includeDetached = opts.includeDetached ?? false;
  const mainBranch = integrationBranch(opts.mainBranch);

  const rootRun = await git(["rev-parse", "--show-toplevel"]);
  const repoRoot = rootRun.success ? rootRun.stdout.trim() : "";
  if (repoRoot === "") {
    throw new WorktreeGitError(
      "Worktree pruning needs a Git repository, but this directory is outside one. " +
        "Move into the project's main checkout, then re-run.",
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
      `The trunk branch '${mainBranch}' is not available locally, so worktree ` +
        `pruning cannot prove which work is landed. Create that local branch, or set ` +
        `[repository].trunk correctly, then re-run.`,
    );
  }

  const listRun = await git(["worktree", "list", "--porcelain"], repoRoot);
  const records = parseWorktreeList(listRun.stdout);
  const mainWorktreePath = records[0]?.path ?? "";
  const commonGitDir = await commonGitDirFrom(repoRoot);
  if (commonGitDir === undefined) {
    throw new WorktreeGitError(
      "Worktree pruning could not identify the repository's shared Git directory. " +
        "Run `git worktree repair`, then re-run `discern worktree prune`.",
    );
  }

  const worktreesToRemove: WorktreeRemovalCandidate[] = [];
  const branchesToDelete: string[] = [];
  const staleMetadata: StaleWorktreeMetadata[] = [];
  const worktreeLines: PruneScanLine[] = [];
  const branchLines: PruneScanLine[] = [];
  const scheduledBranches = new Set<string>();

  for (const rec of records) {
    const shortBranch = shortBranchName(rec.branch);

    if (rec.prunable) {
      staleMetadata.push(await staleMetadataForRecord(commonGitDir, rec));
      worktreeLines.push({
        action: "PRUNE",
        label: rec.path,
        reason: "stale metadata",
      });
      continue;
    }
    if (rec.path === mainWorktreePath) {
      worktreeLines.push({
        action: "KEEP",
        label: rec.path,
        reason: "main worktree",
      });
      continue;
    }
    if (rec.path === repoRoot) {
      worktreeLines.push({
        action: "KEEP",
        label: rec.path,
        reason: "running from here",
      });
      continue;
    }

    const keepReasons = await worktreeKeepReasons(
      repoRoot,
      rec,
      mainBranch,
      includeDetached,
    );
    if (keepReasons.length > 0) {
      worktreeLines.push({
        action: "KEEP",
        label: rec.path,
        reason: keepReasons.join(", "),
      });
      continue;
    }

    worktreesToRemove.push({ path: rec.path, branch: shortBranch });
    if (shortBranch !== "") {
      scheduledBranches.add(shortBranch);
      worktreeLines.push({
        action: "REMOVE",
        label: rec.path,
        reason: `clean branch ${shortBranch}, fully merged`,
      });
    } else {
      worktreeLines.push({
        action: "REMOVE",
        label: rec.path,
        reason: "clean detached",
      });
    }
  }

  // Branches checked out in a kept worktree must never be deleted.
  const keptWorktreeBranches = new Set<string>();
  for (const rec of records) {
    const shortBranch = shortBranchName(rec.branch);
    if (shortBranch === "" || scheduledBranches.has(shortBranch)) {
      continue;
    }
    keptWorktreeBranches.add(shortBranch);
  }

  const refsRun = await git(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    repoRoot,
  );
  for (const branchName of refsRun.stdout.split("\n")) {
    if (branchName === "") {
      continue;
    }
    if (branchName === mainBranch) {
      branchLines.push({
        action: "KEEP",
        label: branchName,
        reason: "protected",
      });
      continue;
    }
    if (keptWorktreeBranches.has(branchName)) {
      branchLines.push({
        action: "KEEP",
        label: branchName,
        reason: "checked out in a kept worktree",
      });
      continue;
    }
    if (scheduledBranches.has(branchName)) {
      continue;
    }
    if (await branchIsMerged(repoRoot, branchName, mainBranch)) {
      branchesToDelete.push(branchName);
      scheduledBranches.add(branchName);
      branchLines.push({
        action: "DELETE",
        label: branchName,
        reason: `fully merged into ${mainBranch}`,
      });
    } else {
      branchLines.push({
        action: "KEEP",
        label: branchName,
        reason: "has unmerged commits",
      });
    }
  }

  return {
    repoRoot,
    mainBranch,
    worktreesToRemove,
    branchesToDelete,
    staleMetadata,
    worktreeLines,
    branchLines,
  };
}

/** Render the read-only git-worktree prune scan without re-scanning. */
export function renderGitWorktreePruneScan(
  scan: GitWorktreePruneScan,
  log: Logger,
): void {
  log.line(`Scanning worktrees in ${scan.repoRoot}`);
  for (const line of scan.worktreeLines) {
    log.line(`${line.action.padEnd(6)} ${line.label} (${line.reason})`);
  }
  log.group("branches");
  log.line(`Scanning branches in ${scan.repoRoot}`);
  for (const line of scan.branchLines) {
    log.line(`${line.action.padEnd(6)} ${line.label} (${line.reason})`);
  }
}

/**
 * Re-validate one planned worktree removal against LIVE state. The plan may
 * have waited at a confirmation prompt while an agent re-entered the worktree,
 * so apply re-runs the scan's own eligibility predicate
 * ({@link worktreeKeepReasons}) just before removing — the same apply-time
 * discipline as `deleteBranchSafe`'s merged-ness re-check and
 * {@link staleMetadataStillMatches}. Returns `undefined` when the removal is
 * still safe, otherwise why the candidate must now be kept.
 */
async function removalCandidateChanged(
  scan: GitWorktreePruneScan,
  candidate: WorktreeRemovalCandidate,
): Promise<string | undefined> {
  const listRun = await git(["worktree", "list", "--porcelain"], scan.repoRoot);
  if (!listRun.success) {
    return "could not list worktrees";
  }
  const canonical = await canonicalizeMaybeMissing(candidate.path);
  let rec: WorktreeRecord | undefined;
  for (const r of parseWorktreeList(listRun.stdout)) {
    if ((await canonicalizeMaybeMissing(r.path)) === canonical) {
      rec = r;
      break;
    }
  }
  if (rec === undefined) {
    return "no longer a registered worktree";
  }
  if (rec.prunable) {
    return "now stale metadata";
  }
  const currentBranch = shortBranchName(rec.branch);
  if (currentBranch !== candidate.branch) {
    return `now on ${
      currentBranch === "" ? "a detached HEAD" : `branch ${currentBranch}`
    }, planned as ${
      candidate.branch === "" ? "detached" : `branch ${candidate.branch}`
    }`;
  }
  // A planned detached candidate implies the scan ran with includeDetached.
  const keep = await worktreeKeepReasons(
    scan.repoRoot,
    rec,
    scan.mainBranch,
    true,
  );
  return keep.length > 0 ? keep.join(", ") : undefined;
}

/**
 * Apply a git-worktree prune scan. This consumes the scan built earlier rather
 * than discovering a fresh candidate set, but re-validates every destructive
 * candidate against live state first: a worktree that gained work while the
 * plan waited for confirmation is skipped, never force-removed.
 */
export async function pruneGitWorktrees(
  scan: GitWorktreePruneScan,
  log: Logger,
): Promise<PruneResult> {
  renderGitWorktreePruneScan(scan, log);

  const deleteBranchSafe = async (branch: string): Promise<boolean> => {
    if (!(await branchIsMerged(scan.repoRoot, branch, scan.mainBranch))) {
      log.error(
        `Refusing to delete ${branch}: not fully merged into ${scan.mainBranch}`,
      );
      return false;
    }
    return (await git(["branch", "-D", branch], scan.repoRoot)).success;
  };

  const removed: string[] = [];
  const branchesDeleted: string[] = [];
  let failed = false;

  if (
    scan.worktreesToRemove.length === 0 && scan.branchesToDelete.length === 0
  ) {
    log.line("Nothing to remove.");
  } else {
    for (const candidate of scan.worktreesToRemove) {
      const changed = await removalCandidateChanged(scan, candidate);
      if (changed !== undefined) {
        log.warn(
          `Skipped ${candidate.path}: candidate changed since the plan was built (${changed}).`,
        );
        continue;
      }
      log.line(`Removing ${candidate.path}...`);
      try {
        await removeWorktreeSafely(candidate.path, scan.repoRoot, {
          pruneMetadata: false,
        });
        removed.push(candidate.path);
        if (candidate.branch !== "") {
          if (await deleteBranchSafe(candidate.branch)) {
            branchesDeleted.push(candidate.branch);
          } else {
            failed = true;
          }
        }
      } catch {
        failed = true;
      }
    }
    for (const branchName of scan.branchesToDelete) {
      if (await deleteBranchSafe(branchName)) {
        branchesDeleted.push(branchName);
      } else {
        failed = true;
      }
    }
  }

  return { removed, branchesDeleted, staleMetadata: [], failed };
}

/** Revalidate that a scanned admin entry still points to an absent checkout before deletion. */
async function staleMetadataStillMatches(
  entry: StaleWorktreeMetadata,
): Promise<boolean> {
  const raw = (await firstLine(join(entry.adminDir, "gitdir")))?.trim();
  if (raw === undefined || raw === "") {
    return false;
  }
  const currentGitDir = isAbsolute(raw) ? raw : resolve(entry.adminDir, raw);
  if (currentGitDir !== entry.gitDir) {
    return false;
  }
  return !(await pathExists(entry.gitDir)) &&
    !(await pathExists(checkoutPathFromGitDir(entry.gitDir)));
}

/** Prune the exact stale git worktree metadata entries from a prior scan. */
export async function pruneStaleWorktreeMetadata(
  scan: GitWorktreePruneScan,
  log: Logger,
): Promise<StaleMetadataPruneResult> {
  const pruned: string[] = [];
  let failed = false;
  for (const entry of scan.staleMetadata) {
    if (!(await pathExists(entry.adminDir))) {
      continue;
    }
    if (!(await staleMetadataStillMatches(entry))) {
      log.warn(
        `Skipped stale worktree metadata for ${entry.path}: candidate changed since the plan was built.`,
      );
      continue;
    }
    log.line(`Pruning stale metadata for ${entry.path}...`);
    try {
      await Deno.remove(entry.adminDir, { recursive: true });
      pruned.push(entry.path);
    } catch {
      failed = true;
    }
  }
  return { pruned, failed };
}

/** Options for the read-only orphan-worktree sweep scan. */
export interface SweepScanOptions {
  /** Extra directories to scan (besides every registered worktree's parent). */
  extraDirs?: string[];
  /** Integration-branch fallback when `DISCERN_TRUNK` is unset (`[repository].trunk`). */
  mainBranch?: string;
}

/** One planned orphan-worktree directory removal. */
export interface OrphanWorktreeRemoval {
  path: string;
  reason: string;
}

/** The read-only orphan-worktree sweep scan. */
export interface OrphanWorktreeSweepScan {
  mainRepo: string;
  /** The integration branch the scan judged merged-ness against — carried so
   * the apply path can re-run the same eligibility check per candidate. */
  mainBranch: string;
  removable: OrphanWorktreeRemoval[];
  kept: { path: string; reason: string }[];
}

/** The outcome of an orphan sweep. */
export interface SweepResult {
  /** Orphan directories removed (or that would be, in a dry run). */
  removed: string[];
  /** Orphan directories kept because they may contain local work. */
  kept: { path: string; reason: string }[];
  /** Whether any removal failed. */
  failed: boolean;
}

/** Keep an orphan checkout unless its HEAD is merged and its working tree is clean. */
async function inspectOrphanWorktree(
  repoRoot: string,
  dir: string,
  mainBranch: string,
): Promise<
  { remove: true; reason: string } | { remove: false; reason: string }
> {
  const keepReasons: string[] = [];
  const branchRun = await git(
    ["-C", dir, "branch", "--show-current"],
    repoRoot,
  );
  const branch = branchRun.success ? branchRun.stdout.trim() : "";
  if (branch !== "") {
    if (!(await branchIsMerged(repoRoot, branch, mainBranch))) {
      keepReasons.push(`branch ${branch} has unmerged commits`);
    }
  } else {
    const headRun = await git(["-C", dir, "rev-parse", "HEAD"], repoRoot);
    const head = headRun.success ? headRun.stdout.trim() : "";
    if (!(await commitIsMerged(repoRoot, head, mainBranch))) {
      keepReasons.push("detached HEAD has unmerged commits");
    }
  }

  const statusRun = await git(
    ["-C", dir, "status", "--porcelain", "-z", "--untracked-files=normal"],
    repoRoot,
  );
  if (!statusRun.success) {
    keepReasons.push("status failed; skipped");
  } else if (statusRun.stdout.trim() !== "") {
    const count = parsePorcelainZ(statusRun.stdout).length;
    keepReasons.push(`dirty ${count} status entries`);
  }

  if (keepReasons.length > 0) {
    return { remove: false, reason: keepReasons.join(", ") };
  }
  return {
    remove: true,
    reason: branch !== ""
      ? `clean branch ${branch}, fully merged`
      : "clean detached, fully merged",
  };
}

/**
 * Reclaim orphaned worktree directories — directories git no longer tracks but
 * which still carry a `.git` gitlink into this repo's worktrees admin area.
 * discern-allow-retrospective: runtime — these are orphans git has dropped.
 * Scans the parent of every registered
 * worktree (git-derived, so it makes no assumption about WHERE worktrees live)
 * plus any `extraDirs`. Removal goes through {@link removeWorktreeSafely}, which
 * re-checks the boundary. Throws `WorktreeGitError` when not in a git repo.
 */
export async function scanOrphanWorktreesForSweep(
  opts: SweepScanOptions,
): Promise<OrphanWorktreeSweepScan> {
  const mainBranch = integrationBranch(opts.mainBranch);
  const mainFirst = await firstWorktreePath();
  if (mainFirst === undefined || mainFirst === "") {
    throw new WorktreeGitError(
      "Orphan worktree cleanup needs a Git repository, but this directory is outside " +
        "one. Move into the project's main checkout, then re-run.",
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

  // Scan dirs: every registered worktree's parent, plus any extra dirs — deduped.
  // The engine deliberately hardcodes NO worktree-location convention (e.g. an
  // agent's `.claude/worktrees`): it is agent-agnostic, so it discovers locations
  // from git's own registry. A caller that knows a convention passes it via
  // `extraDirs`.
  const scanSet = new Set<string>();
  const addScan = async (dir: string): Promise<void> => {
    if (!(await isDir(dir))) {
      return;
    }
    scanSet.add(await realPathOr(dir));
  };
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

  const removable: OrphanWorktreeRemoval[] = [];
  const kept: { path: string; reason: string }[] = [];
  for (const dir of orphans) {
    const decision = await inspectOrphanWorktree(mainRepo, dir, mainBranch);
    if (decision.remove) {
      removable.push({ path: dir, reason: decision.reason });
    } else {
      kept.push({ path: dir, reason: decision.reason });
    }
  }
  return { mainRepo, mainBranch, removable, kept };
}

/** Render the read-only orphan-worktree sweep scan without re-scanning. */
export function renderOrphanWorktreeSweepScan(
  scan: OrphanWorktreeSweepScan,
  log: Logger,
): void {
  if (scan.removable.length === 0 && scan.kept.length === 0) {
    log.line("No orphaned worktree directories found.");
    return;
  }
  log.line(
    "Orphaned worktree directories (gitlinked to this repo, not tracked by git):",
  );
  for (const item of scan.removable) {
    log.line(`REMOVE ${item.path} (${item.reason})`);
  }
  for (const item of scan.kept) {
    log.line(`KEEP   ${item.path} (${item.reason})`);
  }
}

/**
 * Re-validate one planned orphan-directory removal against LIVE state: still
 * unregistered (an orphan that was re-adopted is a live worktree again) and
 * still clean + fully merged per {@link inspectOrphanWorktree}, the scan's own
 * eligibility predicate. Returns `undefined` when the removal is still safe,
 * otherwise why the directory must now be kept.
 */
async function orphanCandidateChanged(
  scan: OrphanWorktreeSweepScan,
  dir: string,
): Promise<string | undefined> {
  const listRun = await git(["worktree", "list", "--porcelain"], scan.mainRepo);
  if (!listRun.success) {
    return "could not list worktrees";
  }
  const canonical = await canonicalizeMaybeMissing(dir);
  for (const rec of parseWorktreeList(listRun.stdout)) {
    if ((await canonicalizeMaybeMissing(rec.path)) === canonical) {
      return "registered as a live worktree again";
    }
  }
  const decision = await inspectOrphanWorktree(
    scan.mainRepo,
    dir,
    scan.mainBranch,
  );
  return decision.remove ? undefined : decision.reason;
}

/**
 * Apply an orphan-worktree sweep scan. Consumes the planned candidate set, but
 * re-validates each directory against live state first: an orphan that gained
 * work (or was re-registered) while the plan waited for confirmation is
 * skipped, never removed.
 */
export async function sweepOrphanWorktrees(
  scan: OrphanWorktreeSweepScan,
  log: Logger,
): Promise<SweepResult> {
  renderOrphanWorktreeSweepScan(scan, log);

  const removed: string[] = [];
  let failed = false;
  for (const item of scan.removable) {
    if (!(await pathExists(item.path))) {
      continue; // already gone — nothing left to remove
    }
    const changed = await orphanCandidateChanged(scan, item.path);
    if (changed !== undefined) {
      log.warn(
        `Skipped orphan ${item.path}: candidate changed since the plan was built (${changed}).`,
      );
      continue;
    }
    log.line(`Removing orphan ${item.path}...`);
    try {
      await removeWorktreeSafely(item.path, scan.mainRepo, {
        pruneMetadata: false,
      });
      removed.push(item.path);
    } catch {
      failed = true;
    }
  }
  return { removed, kept: scan.kept, failed };
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
  /** The worktree root (the env files being patched live here). */
  worktreeRoot: string;
  /** The variable names to inherit (the `[worktree].inherit_env` array). */
  vars: string[];
  /** The env files to read from main and write in the worktree, in precedence
   * order (`[worktree].env_files`). */
  files: readonly string[];
  /** The logger for per-var narration. */
  log: Logger;
}

/**
 * Copy selected env vars from the main checkout's env files into the current
 * worktree's, so the worktree's app can boot with the same secrets. Reads every
 * `[worktree].env_files` entry on the main side (the last file defining a value
 * wins — the dotenv override convention) and writes through the shared
 * {@link writeEnvVar} upsert, CREATING the worktree's first env file when none
 * exists — a fresh worktree never has one, and a declared value must actually
 * arrive. Per-var safe-copy policy: skip when main is blank; replace when the
 * worktree value is empty or equals `.env.example`'s default; otherwise leave a
 * customised value alone. Idempotent. An empty `vars` list, or a main checkout
 * with no readable env file, is a warned no-op. A missing main checkout or a
 * refused env write throws `WorktreeGitError`.
 */
export async function inheritMainEnvVars(
  opts: InheritEnvOptions,
): Promise<void> {
  const { log, files } = opts;
  if (opts.vars.length === 0) {
    return;
  }

  const mainRepo = await mainRepoPath();
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "Discern could not find the main checkout while copying environment values. " +
        "Run `git worktree repair`, then re-run `discern worktree setup`.",
    );
  }
  const mainEnvFiles = await readEnvFilesAt(mainRepo, files);
  if (mainEnvFiles.length === 0) {
    log.warn(
      `inherit-main-env-vars: main checkout has no env file (${
        files.join(", ")
      }) — skipping.`,
    );
    return;
  }
  const exampleText = await readFileMaybe(join(mainRepo, ".env.example")) ?? "";

  for (const varName of opts.vars) {
    if (varName === "") {
      continue;
    }
    const mainRaw = readEnvValueFromFiles(mainEnvFiles, varName);
    const mainValue = stripQuotes(mainRaw ?? "");
    if (mainValue === "") {
      log.warn(
        `inherit-main-env-vars: ${varName} is missing or blank in main's env files — skipping.`,
      );
      continue;
    }
    const worktreeValue = stripQuotes(
      await readEnvValueAcross(opts.worktreeRoot, files, varName) ?? "",
    );
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

    await writeWorktreeEnvVar(
      opts.worktreeRoot,
      varName,
      formatEnvValue(mainValue),
      files,
      { create: true },
    );
    log.ok(`Inherited ${varName} from main.`);
  }
}
