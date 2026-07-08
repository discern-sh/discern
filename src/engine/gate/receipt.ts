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
 *
 * `finish` is its usual author, but `ratchets --pin` also carries an honored vouch
 * forward onto the commit it makes: that commit changes only `[ratchets]` limits,
 * which the gate never reads, so the vouch stays truthful across it and `graduate`
 * need not re-run the whole gate for a re-pin (see {@link carryReceiptForwardAcrossPin}).
 */

import { join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";
import type {
  GateData,
  GateReceiptCheckData,
} from "../../shared/result_schemas.ts";

/** The receipt's filename inside the per-worktree git admin dir. */
const RECEIPT_FILE = "discern-gate-pass";
type GateReceiptRecordData = NonNullable<GateData["gate_receipt"]>;

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
 * staged, unstaged, OR untracked changes). This is the strict notion graduate
 * requires before landing, so the receipt vouches for exactly what would land. A
 * failed status reads as NOT clean, so an unreadable tree never earns a receipt or a
 * fast-path skip (fail-closed).
 */
async function isClean(cwd: string): Promise<boolean> {
  const r = await runGit(["status", "--porcelain"], { cwd });
  return r.success && r.stdout.trim() === "";
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function receiptRecord(
  status: GateReceiptRecordData["status"],
  fields: Omit<GateReceiptRecordData, "status"> = {},
): GateReceiptRecordData {
  return { status, ...fields };
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
): Promise<GateReceiptRecordData> {
  const path = await receiptPath(cwd);
  if (path === undefined) {
    return receiptRecord("unavailable", {
      reason: "could not resolve the gate-pass receipt path",
    });
  }

  if (passed) {
    if (!(await isClean(cwd))) {
      return receiptRecord("skipped_dirty", {
        path,
        reason: "the worktree is not clean",
      });
    }
    const head = await headSha(cwd);
    if (head === undefined) {
      return receiptRecord("unavailable", {
        path,
        reason: "could not read HEAD",
      });
    }
    try {
      await Deno.writeTextFile(path, `${head}\n`);
      return receiptRecord("recorded", { path });
    } catch (error) {
      return receiptRecord("record_failed", {
        path,
        reason: failureReason(error),
      });
    }
  }

  try {
    await Deno.remove(path);
    return receiptRecord("cleared", { path });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return receiptRecord("cleared", { path });
    }
    return receiptRecord("clear_failed", {
      path,
      reason: failureReason(error),
    });
  }
}

/**
 * Inspect why the current worktree's gate-pass receipt can or cannot be honored.
 * This is the verbose sibling of {@link gateReceiptHonored}: graduate includes the
 * result in its JSON/MCP envelope so a skipped vs re-run validation decision is
 * visible even when the human logger is suppressed.
 */
export async function inspectGateReceipt(
  cwd: string,
): Promise<GateReceiptCheckData> {
  const path = await receiptPath(cwd);
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "could not resolve the gate-pass receipt path",
    };
  }
  let recorded: string;
  try {
    recorded = (await Deno.readTextFile(path)).trim();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing", path };
    }
    return { status: "read_failed", path, reason: failureReason(error) };
  }
  if (recorded === "") {
    return { status: "missing", path, reason: "receipt file was empty" };
  }
  const head = await headSha(cwd);
  if (head === undefined) {
    return {
      status: "unavailable",
      path,
      recorded,
      reason: "could not read HEAD",
    };
  }
  if (head !== recorded) {
    return { status: "stale", path, recorded, head };
  }
  if (!(await isClean(cwd))) {
    return { status: "dirty", path, recorded, head };
  }
  return { status: "honored", path, recorded, head };
}

/**
 * Whether a receipt proves the worktree's CURRENT (HEAD, clean) state already passed
 * `finish` — graduate's fast path. True only when a receipt exists, names exactly the
 * current HEAD, and the tree is clean; any new commit, amend, or uncommitted edit
 * makes this false, so graduate falls back to running the gate. Never throws.
 */
export async function gateReceiptHonored(cwd: string): Promise<boolean> {
  return (await inspectGateReceipt(cwd)).status === "honored";
}

/**
 * Carry a gate-pass receipt across a `ratchets --pin` commit (ADR 0106).
 *
 * `ratchets --pin` commits ONLY `[ratchets.*]` limit changes — values the gate never
 * reads (ratchets are not part of `finish`; ADR 0003) — so the tree the pin commit
 * produces passes the gate iff the pre-pin tree did. When the pre-pin HEAD carried an
 * HONORED receipt (it named that HEAD over a clean tree), re-stamp the vouch onto the
 * new clean HEAD the commit created; otherwise the moved HEAD would strand a truthful
 * pass and force `graduate` to re-run the whole gate for a change that cannot alter its
 * outcome.
 *
 * Fail-closed and narrow: it forwards ONLY a vouch that genuinely held a moment ago
 * (`priorHonored`), which only the caller — the author of the commit, so the one party
 * that knows it touched nothing but ratchet limits — may assert. With no prior vouch it
 * does nothing (returns `undefined`), leaving the now-stale receipt for `graduate` to
 * re-validate. Best-effort like all receipt I/O: a write hiccup never fails the pin.
 */
export async function carryReceiptForwardAcrossPin(
  cwd: string,
  priorHonored: boolean,
): Promise<GateReceiptRecordData | undefined> {
  if (!priorHonored) {
    return undefined;
  }
  return await recordGateOutcome(cwd, true);
}
