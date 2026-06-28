/**
 * The gate-pass **receipt** — a tiny per-worktree marker recording the commit
 * `finish` last validated GREEN over a CLEAN tree, so `graduate` can prove the exact
 * tree it is about to land already passed the gate WITHOUT re-running it (ADR 0067).
 *
 * It lives where the worktree-ready sentinel does: a single file in the per-worktree
 * git admin dir, resolved via `git rev-parse --git-path discern-gate-pass`
 * (`.git/worktrees/<name>/discern-gate-pass`). It is therefore worktree-local (never
 * shared across branches), never tracked or committed (it sits inside `.git`), and
 * self-cleaning (it vanishes with the worktree). Its sole content is the validated
 * HEAD sha.
 *
 * The receipt is honored ONLY while it still names the current HEAD AND the tree is
 * clean — so any new commit (the merge `integrate` creates), amend, or uncommitted
 * edit silently invalidates it and `graduate` falls back to running the gate. It is a
 * fast-path cache for "this tree already passed", never a substitute for the gate: a
 * failing run clears it, and graduate re-runs `finish` whenever it is absent or stale.
 */

import { join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";

/** The receipt's filename inside the per-worktree git admin dir. */
const RECEIPT_FILE = "discern-gate-pass";

/**
 * Resolve this worktree's receipt path (`git rev-parse --git-path discern-gate-pass`),
 * normalizing a worktree-relative result to absolute against `cwd`. `undefined`
 * outside a git repo (so every caller treats "no git" as "no receipt").
 */
async function receiptPath(cwd: string): Promise<string | undefined> {
  const r = await runGit(["rev-parse", "--git-path", RECEIPT_FILE], { cwd });
  if (!r.success) {
    return undefined;
  }
  const raw = r.stdout.trim();
  if (raw === "") {
    return undefined;
  }
  // `--git-path` may print a path relative to the worktree's cwd.
  return raw.startsWith("/") ? raw : join(cwd, raw);
}

/** Current HEAD sha at `cwd`, or `undefined` when it cannot be read. */
async function headSha(cwd: string): Promise<string | undefined> {
  const r = await runGit(["rev-parse", "HEAD"], { cwd });
  const sha = r.stdout.trim();
  return r.success && sha !== "" ? sha : undefined;
}

/**
 * Whether the worktree at `cwd` is FULLY clean — `git status --porcelain` empty (no
 * staged, unstaged, OR untracked changes). This is the strict notion graduate lands
 * against (its `git add -A` WIP-commit sweeps untracked files too), so the receipt
 * vouches for exactly what would land. A failed status reads as NOT clean, so an
 * unreadable tree never earns a receipt or a fast-path skip (fail-closed).
 */
async function isClean(cwd: string): Promise<boolean> {
  const r = await runGit(["status", "--porcelain"], { cwd });
  return r.success && r.stdout.trim() === "";
}

/**
 * Record the outcome of a `finish` run into the receipt:
 *
 * - GREEN over a CLEAN tree → stamp the validated HEAD (the vouch graduate honors).
 * - FAILED gate → clear any receipt (fail-closed: a tree the gate just rejected must
 *   not stay vouched; clearing also closes the rare flake/environment-drift case where
 *   a clean HEAD's gate result turns failing with the tree unchanged).
 * - GREEN but DIRTY → leave the file untouched: it cannot vouch for clean HEAD, but a
 *   prior clean vouch (at its own sha) is still truthful, and graduate's HEAD-match +
 *   clean check keeps it honest.
 *
 * Best-effort throughout: the receipt is an optimization, so a write/delete hiccup
 * must never fail the finish that produced it.
 */
export async function recordGateOutcome(
  cwd: string,
  passed: boolean,
): Promise<void> {
  const path = await receiptPath(cwd);
  if (path === undefined) {
    return;
  }
  try {
    if (passed && await isClean(cwd)) {
      const head = await headSha(cwd);
      if (head !== undefined) {
        await Deno.writeTextFile(path, `${head}\n`);
      }
    } else if (!passed) {
      await Deno.remove(path);
    }
  } catch {
    // best-effort — the receipt is an optimization; never fail finish over it
    // (a missing receipt to clear is the common, expected case here)
  }
}

/**
 * Whether a receipt proves the worktree's CURRENT (HEAD, clean) state already passed
 * `finish` — graduate's fast path. True only when a receipt exists, names exactly the
 * current HEAD, and the tree is clean; any new commit, amend, or uncommitted edit
 * makes this false, so graduate falls back to running the gate. Never throws.
 */
export async function gateReceiptHonored(cwd: string): Promise<boolean> {
  const path = await receiptPath(cwd);
  if (path === undefined) {
    return false;
  }
  let recorded: string;
  try {
    recorded = (await Deno.readTextFile(path)).trim();
  } catch {
    return false; // no receipt recorded
  }
  if (recorded === "") {
    return false;
  }
  const head = await headSha(cwd);
  if (head === undefined || head !== recorded) {
    return false;
  }
  return await isClean(cwd);
}
