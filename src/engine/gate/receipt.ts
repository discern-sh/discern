/**
 * The **receipt marker** — a tiny per-worktree file recording the commit `finish`
 * last validated GREEN over a CLEAN tree, so `graduate` can prove the exact tree it
 * is about to land already passed the gate WITHOUT re-running it (ADR 0067).
 *
 * It lives where the worktree-ready sentinel does: a single file in the per-worktree
 * git admin dir, resolved via `git rev-parse --git-path discern-gate-receipt`
 * (`.git/worktrees/<name>/discern-gate-receipt`). It is therefore worktree-local
 * (never shared across branches), never tracked or committed (it sits inside
 * `.git`), and self-cleaning (it vanishes with the worktree). Its first line is the
 * validated HEAD sha — PINNED before the gate run began and re-verified unmoved at
 * stamp time ({@link ValidatedTreePin}), so it can only ever name a commit whose
 * tree the gate actually read; the rest is the rendered **receipt** markdown that
 * finish emitted for that tree — the review-moment summary `status` and `graduate`
 * surface without re-running the gate.
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
 *
 * The ratchet **measurement receipt** is its sibling on the same model: a green
 * `ratchets` check over a clean tree records every ratchet's measured value against
 * the validated HEAD, so a `ratchets --pin` on that same clean HEAD can reuse the
 * values instead of re-running every (slow) measurement. Same admin-dir home, same
 * identity rule (exact HEAD + clean tree, so any commit or edit silently invalidates
 * it), same fail-closed posture (a red check clears it; a pin that cannot honor it
 * simply measures fresh). Only the measurements are cacheable — the never-loosen
 * comparison reads main, which can advance while HEAD stands still, so the pin
 * re-checks that half live.
 */

import { join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";
import type {
  GateData,
  GateReceiptCheckData,
} from "../../shared/result_schemas.ts";

/** The receipt marker's filename inside the per-worktree git admin dir. */
const RECEIPT_FILE = "discern-gate-receipt";
/** The measurement receipt's filename, in the same admin dir. */
const MEASUREMENTS_FILE = "discern-ratchet-measurements";
type GateReceiptRecordData = NonNullable<GateData["gate_receipt"]>;

/**
 * Resolve a per-worktree admin file's path (`git rev-parse --git-path <file>`),
 * normalizing a worktree-relative result to absolute against `cwd`. `undefined`
 * outside a git repo (so every caller treats "no git" as "no receipt").
 */
async function adminFilePath(
  cwd: string,
  file: string,
): Promise<string | undefined> {
  const r = await runGit(["rev-parse", "--git-path", file], { cwd });
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

/** This worktree's gate-pass receipt path. */
function receiptPath(cwd: string): Promise<string | undefined> {
  return adminFilePath(cwd, RECEIPT_FILE);
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
 * fast-path skip (fail-closed). Exported so the receipt renderer applies the SAME
 * clean rule before building a receipt for the committed tree.
 */
export async function isWorktreeFullyClean(cwd: string): Promise<boolean> {
  const r = await runGit(["status", "--porcelain", "-z"], { cwd });
  return r.success && r.stdout.trim() === "";
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Brand for {@link ValidatedTreePin} — declared, never emitted, not exported, so
 * only this module can mint a pin. */
declare const VALIDATED_TREE_PIN: unique symbol;

/**
 * The tree identity a validation run is about to read, captured BEFORE the run
 * begins: the HEAD sha and full cleanliness at that moment. Every receipt stamp
 * requires one and re-verifies it at stamp time — so a vouch can only ever name
 * a commit whose tree the validated work actually read (a commit made mid-run
 * moves HEAD past the pin, and the stamp is refused instead of vouching blind).
 *
 * Deliberately only constructible via {@link pinValidatedTree} (the brand makes
 * the type nominal): a caller cannot hand-roll a pin from a sha it happens to
 * hold — it must sample the tree, and must do so before the work it wants
 * vouched, which is the whole invariant.
 */
export interface ValidatedTreePin {
  /** HEAD at capture time, or `undefined` when it could not be read. */
  readonly head: string | undefined;
  /** Whether the tree was FULLY clean at capture time. */
  readonly clean: boolean;
  readonly [VALIDATED_TREE_PIN]: true;
}

/** Sample the tree at `cwd` NOW — call this before the validation work runs. */
export async function pinValidatedTree(cwd: string): Promise<ValidatedTreePin> {
  return {
    head: await headSha(cwd),
    clean: await isWorktreeFullyClean(cwd),
  } as ValidatedTreePin;
}

function receiptRecord(
  status: GateReceiptRecordData["status"],
  fields: Omit<GateReceiptRecordData, "status"> = {},
): GateReceiptRecordData {
  return { status, ...fields };
}

/**
 * Record the outcome of a `finish` run into the receipt marker. `pin` is the tree
 * identity captured BEFORE the run began ({@link pinValidatedTree}); a stamp names
 * the PINNED sha, and only after re-verifying the tree still matches it — the
 * receipt must vouch only for the exact tree the gate actually read:
 *
 * - GREEN over a CLEAN tree that matches the pin → stamp the validated HEAD (the
 *   vouch graduate honors), plus `receiptMarkdown` when the run rendered a receipt,
 *   so `status` and `graduate` can surface the review summary without re-running
 *   the gate.
 * - GREEN but HEAD moved since the pin (a commit landed mid-run) → stamp nothing:
 *   the run validated the pinned tree, not the commit now at HEAD. Any prior vouch
 *   is left untouched (still truthful at its own sha).
 * - FAILED gate → clear any receipt (fail-closed: a tree the gate just rejected must
 *   not stay vouched; clearing also closes the rare flake/environment-drift case where
 *   a clean HEAD's gate result turns failing with the tree unchanged).
 * - GREEN but DIRTY (at pin time or now) → leave the file untouched: it cannot vouch
 *   for clean HEAD, but a prior clean vouch (at its own sha) is still truthful, and
 *   graduate's HEAD-match + clean check keeps it honest.
 *
 * Best-effort throughout: the receipt is an optimization, so a write/delete hiccup
 * must never fail the finish that produced it.
 */
export async function recordGateOutcome(
  cwd: string,
  passed: boolean,
  pin: ValidatedTreePin,
  receiptMarkdown?: string,
): Promise<GateReceiptRecordData> {
  const path = await receiptPath(cwd);
  if (path === undefined) {
    return receiptRecord("unavailable", {
      reason: "could not resolve the gate-pass receipt path",
    });
  }

  if (passed) {
    if (pin.head === undefined) {
      return receiptRecord("unavailable", {
        path,
        reason: "could not read HEAD when the run began",
      });
    }
    const headNow = await headSha(cwd);
    if (headNow === undefined) {
      return receiptRecord("unavailable", {
        path,
        reason: "could not read HEAD",
      });
    }
    if (headNow !== pin.head) {
      return receiptRecord("skipped_head_moved", {
        path,
        reason:
          `HEAD moved while the run was underway (validated ${pin.head}, now ${headNow})`,
      });
    }
    if (!pin.clean) {
      return receiptRecord("skipped_dirty", {
        path,
        reason: "the worktree was not clean when the run began",
      });
    }
    if (!(await isWorktreeFullyClean(cwd))) {
      return receiptRecord("skipped_dirty", {
        path,
        reason: "the worktree is not clean",
      });
    }
    try {
      const body = receiptMarkdown === undefined || receiptMarkdown === ""
        ? `${pin.head}\n`
        : `${pin.head}\n\n${receiptMarkdown.trim()}\n`;
      await Deno.writeTextFile(path, body);
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
 * visible even when the human logger is suppressed. An HONORED record also carries
 * the stored receipt markdown (when the recording finish rendered one) — the
 * summary an agent relays at the review moment without re-running the gate.
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
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing", path };
    }
    return { status: "read_failed", path, reason: failureReason(error) };
  }
  // First line: the validated HEAD sha. The rest (when present): the receipt
  // markdown finish stored alongside it. A pre-markdown marker (sha only) still
  // parses — its markdown is simply empty.
  const newline = content.indexOf("\n");
  const recorded = (newline < 0 ? content : content.slice(0, newline)).trim();
  const markdown = newline < 0 ? "" : content.slice(newline).trim();
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
  if (!(await isWorktreeFullyClean(cwd))) {
    return { status: "dirty", path, recorded, head };
  }
  return {
    status: "honored",
    path,
    recorded,
    head,
    ...(markdown === "" ? {} : { receipt: markdown }),
  };
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
 * re-validate. The pin is captured here, at the stamp moment: the vouched "work" is the
 * pin commit itself, which the caller just made synchronously, so the tree sampled now
 * IS the tree the vouch is about. Best-effort like all receipt I/O: a write hiccup
 * never fails the pin.
 */
export async function carryReceiptForwardAcrossPin(
  cwd: string,
  priorHonored: boolean,
): Promise<GateReceiptRecordData | undefined> {
  if (!priorHonored) {
    return undefined;
  }
  return await recordGateOutcome(cwd, true, await pinValidatedTree(cwd));
}

// ── the ratchet measurement receipt ─────────────────────────────────────────────

/** The measurement receipt's verdict: `honored` carries the per-ratchet values a pin
 * may reuse; every other status means "measure fresh" (a cache miss, never an error). */
export type RatchetMeasurementsCheck =
  | { status: "honored"; values: Record<string, number> }
  | { status: "missing" | "stale" | "dirty" | "malformed" | "unavailable" };

/**
 * Record a green `ratchets` check's per-ratchet measured values against the HEAD
 * pinned BEFORE the measurements ran, for a subsequent `--pin` on that same clean
 * HEAD to reuse. Mirrors {@link recordGateOutcome}'s conditions: only a CLEAN tree
 * with a readable HEAD that still matches the pin earns a receipt (a dirty check —
 * `--force` — records nothing, since the values describe a tree no pin will ever
 * see; a mid-measurement commit records nothing, since the values describe the
 * pinned tree, not the commit now at HEAD). Best-effort: an I/O hiccup never fails
 * the check that produced the measurements. Returns whether a receipt was written.
 */
export async function recordRatchetMeasurements(
  cwd: string,
  values: Record<string, number>,
  pin: ValidatedTreePin,
): Promise<boolean> {
  const path = await adminFilePath(cwd, MEASUREMENTS_FILE);
  if (path === undefined || pin.head === undefined || !pin.clean) {
    return false;
  }
  if (
    (await headSha(cwd)) !== pin.head || !(await isWorktreeFullyClean(cwd))
  ) {
    return false;
  }
  try {
    await Deno.writeTextFile(
      path,
      `${JSON.stringify({ head: pin.head, values })}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the measurement receipt — a RED check's values must not stay reusable
 * (fail-closed, the same posture as a failed finish clearing the gate-pass receipt).
 * Best-effort; a missing file is already the desired state.
 */
export async function clearRatchetMeasurements(cwd: string): Promise<void> {
  const path = await adminFilePath(cwd, MEASUREMENTS_FILE);
  if (path === undefined) {
    return;
  }
  try {
    await Deno.remove(path);
  } catch {
    // NotFound or any other hiccup: the receipt is an optimization, never load-bearing.
  }
}

/**
 * Inspect whether the measurement receipt can be honored: it must parse, name exactly
 * the current HEAD, and the tree must be clean — the same identity rule as the
 * gate-pass receipt, so any commit, amend, or uncommitted edit silently invalidates
 * it. Anything unreadable or mis-shaped reads as `malformed` (measure fresh), never an
 * error. Never throws.
 */
export async function inspectRatchetMeasurements(
  cwd: string,
): Promise<RatchetMeasurementsCheck> {
  const path = await adminFilePath(cwd, MEASUREMENTS_FILE);
  if (path === undefined) {
    return { status: "unavailable" };
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    return error instanceof Deno.errors.NotFound
      ? { status: "missing" }
      : { status: "unavailable" };
  }
  const parsed = parseMeasurements(raw);
  if (parsed === undefined) {
    return { status: "malformed" };
  }
  const head = await headSha(cwd);
  if (head === undefined) {
    return { status: "unavailable" };
  }
  if (head !== parsed.head) {
    return { status: "stale" };
  }
  if (!(await isWorktreeFullyClean(cwd))) {
    return { status: "dirty" };
  }
  return { status: "honored", values: parsed.values };
}

/** Parse the receipt file's JSON defensively: a `head` sha string plus a `values`
 * map of finite numbers, or `undefined` for anything else — the file sits on disk
 * between runs, so its content is evidence to validate, not a trusted structure. */
function parseMeasurements(
  raw: string,
): { head: string; values: Record<string, number> } | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { head, values } = data as { head?: unknown; values?: unknown };
  if (typeof head !== "string" || head === "") {
    return undefined;
  }
  if (typeof values !== "object" || values === null) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    out[name] = value;
  }
  return { head, values: out };
}
