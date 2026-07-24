/**
 * The **receipt marker** — a tiny per-worktree file recording the commit `done`
 * last validated GREEN over a CLEAN tree, so `accept` can prove the exact tree it
 * is about to land already passed the gate WITHOUT re-running it (ADR 0067).
 *
 * It lives where the worktree-ready sentinel does: a single file in the per-worktree
 * git admin dir, resolved via `git rev-parse --git-path discern/gate-receipt`
 * (`.git/worktrees/<name>/discern/gate-receipt`). It is therefore worktree-local
 * (never shared across branches), never tracked or committed (it sits inside
 * `.git`), and self-cleaning (it vanishes with the worktree). Its first line is the
 * validated HEAD sha — PINNED before the gate run began and re-verified unmoved at
 * stamp time ({@link ValidatedTreePin}), so it can only ever name a commit whose
 * tree the gate actually read; the rest is the rendered **receipt** — the line and
 * the page markdown finish emitted for that tree — the review-moment summary
 * `status` and `accept` surface without re-running the gate.
 *
 * The receipt is honored ONLY while it still names the current HEAD AND the tree is
 * clean — so any new commit (the merge `update` creates), amend, or uncommitted
 * edit silently invalidates it and `accept` falls back to running the gate. It is a
 * fast-path cache for "this tree already passed", never a substitute for the gate: a
 * failing run clears it, and accept re-runs `done` whenever it is absent or stale.
 *
 * `done` is its usual author, but `standards --pin` also carries an honored vouch
 * forward onto the commit it makes: that commit changes only `[standards]` limits,
 * and each changed limit is tighter while still held by the just-taken or same-HEAD
 * reused measurement. The pin therefore still passes both standards halves in the
 * gate, so the vouch stays truthful and `accept` need not re-run the whole gate for
 * a re-pin (see {@link carryReceiptForwardAcrossPin}).
 *
 * The standard **measurement receipt** is its sibling on the same model: a green
 * `standards` check over a clean tree records every standard's measured value against
 * the validated HEAD, so a `standards --pin` on that same clean HEAD can reuse the
 * values instead of re-running every (slow) measurement. Same admin-dir home, same
 * identity rule (exact HEAD + clean tree, so any commit or edit silently invalidates
 * it), same fail-closed posture (a red check clears it; a pin that cannot honor it
 * simply measures fresh). Only the measurements are cacheable — the never-loosen
 * comparison reads main, which can advance while HEAD stands still, so the pin
 * re-checks that half live.
 */

import { dirname, join } from "@std/path";
import {
  GIT_ADMIN_STATE,
  gitAdminStatePath,
  VALIDATION_ADMIN_STATE_KEYS,
  type ValidationAdminStateKey,
} from "../../shared/git_admin_state.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  type PlannedWriteTarget,
  preflightPlannedWrites,
  type WritePreflightFailure,
} from "../../shared/write_preflight.ts";
import type {
  GateData,
  GateReceiptCheckData,
} from "../../shared/result_schemas.ts";

type AdminStatePaths = Readonly<
  Record<ValidationAdminStateKey, string | undefined>
>;
type GateReceiptRecordData = NonNullable<GateData["gate_receipt"]>;

/** Brand for a successful, real write probe. Receipt writers require this token,
 * making "probe before persist" a compile-time rule at every call site. */
declare const ADMIN_STATE_WRITE_AUTHORITY: unique symbol;
export interface AdminStateWriteAuthority {
  readonly root: string;
  readonly paths: AdminStatePaths;
  readonly [ADMIN_STATE_WRITE_AUTHORITY]: true;
}

export type AdminStateWritePreflight =
  | { ok: true; authority: AdminStateWriteAuthority }
  | WritePreflightFailure;

/** This worktree's gate receipt path. */
function receiptPath(cwd: string): Promise<string | undefined> {
  return gitAdminStatePath(cwd, "gateReceipt");
}

/** Prove the real create/write/rename/remove authority every validation-state
 * writer may need later. Existing marker files are also opened for write, without
 * changing them, so a read-only old receipt fails now rather than at stamp time. */
export async function preflightAdminStateWrites(
  cwd: string,
): Promise<AdminStateWritePreflight> {
  const paths = {} as Record<ValidationAdminStateKey, string | undefined>;
  // A pre-Git/setup checkout has no admin-state target to persist. Preserve the
  // gate's established no-Git behavior with a non-applicable authority token;
  // once Git says this IS a worktree, failure to resolve or write its paths is a
  // genuine denial and must fail before slow work.
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd });
  if (!inside.success || inside.stdout.trim() !== "true") {
    for (const key of VALIDATION_ADMIN_STATE_KEYS) {
      paths[key] = undefined;
    }
    return {
      ok: true,
      authority: { root: cwd, paths } as AdminStateWriteAuthority,
    };
  }
  const targets: PlannedWriteTarget[] = [];
  for (const key of VALIDATION_ADMIN_STATE_KEYS) {
    const path = await gitAdminStatePath(cwd, key);
    if (path === undefined) {
      return {
        ok: false,
        path: cwd,
        description: "its Git-admin validation state",
        reason: `Git could not resolve ${GIT_ADMIN_STATE[key].path}`,
      };
    }
    paths[key] = path;
    try {
      await Deno.mkdir(dirname(path), { recursive: true });
    } catch (error) {
      return {
        ok: false,
        path: dirname(path),
        description: "its Git-admin validation state",
        reason: failureReason(error),
      };
    }
    targets.push({
      kind: "directory-entry",
      path: dirname(path),
      description: "its Git-admin validation state",
    });
    try {
      const info = await Deno.stat(path);
      if (info.isFile) {
        targets.push({
          kind: "existing-file",
          path,
          description: "its Git-admin validation state",
        });
      } else {
        return {
          ok: false,
          path,
          description: "its Git-admin validation state",
          reason: "the planned marker path exists but is not a regular file",
        };
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        return {
          ok: false,
          path,
          description: "its Git-admin validation state",
          reason: failureReason(error),
        };
      }
    }
  }
  const probed = await preflightPlannedWrites(targets);
  if (!probed.ok) {
    return probed;
  }
  return {
    ok: true,
    authority: {
      root: cwd,
      paths,
    } as AdminStateWriteAuthority,
  };
}

function authorityPath(
  cwd: string,
  authority: AdminStateWriteAuthority,
  file: ValidationAdminStateKey,
): string | undefined {
  return authority.root === cwd ? authority.paths[file] : undefined;
}

/** Current HEAD sha at `cwd`, or `undefined` when it cannot be read. */
async function headSha(cwd: string): Promise<string | undefined> {
  const r = await runGit(["rev-parse", "HEAD"], { cwd });
  const sha = r.stdout.trim();
  return r.success && sha !== "" ? sha : undefined;
}

/**
 * Every path `git status --porcelain` reports at `cwd` — staged, unstaged, AND
 * untracked, both sides of a rename — sorted for stable output. This is the strict
 * dirt accept refuses to land, so a receipt refusal can NAME what blocks it instead
 * of sending the agent on a diagnosis loop. `undefined` when git can't answer.
 */
async function worktreeStatusPaths(
  cwd: string,
): Promise<string[] | undefined> {
  const r = await runGit(["status", "--porcelain", "-z"], { cwd });
  if (!r.success) {
    return undefined;
  }
  const paths = new Set<string>();
  for (const entry of parsePorcelainZ(r.stdout)) {
    if (entry.origPath !== undefined) {
      paths.add(entry.origPath);
    }
    paths.add(entry.path);
  }
  return [...paths].sort();
}

/**
 * Whether the worktree at `cwd` is FULLY clean — `git status --porcelain` empty (no
 * staged, unstaged, OR untracked changes). This is the strict notion accept
 * requires before landing, so the receipt vouches for exactly what would land. A
 * failed status reads as NOT clean, so an unreadable tree never earns a receipt or a
 * fast-path skip (fail-closed). Exported so the receipt renderer applies the SAME
 * clean rule before building a receipt for the committed tree.
 */
export async function isWorktreeFullyClean(cwd: string): Promise<boolean> {
  return (await worktreeStatusPaths(cwd))?.length === 0;
}

/** How many dirty paths a receipt-refusal reason names before eliding the rest. */
const DIRTY_PATHS_SHOWN = 6;

/** Render a dirty-path list for a refusal reason: the first few paths, the rest
 * counted — empty when there is nothing to name (an unreadable status). */
function describeDirtyPaths(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const shown = paths.slice(0, DIRTY_PATHS_SHOWN).join(", ");
  const more = paths.length > DIRTY_PATHS_SHOWN
    ? `, and ${paths.length - DIRTY_PATHS_SHOWN} more`
    : "";
  return ` — uncommitted: ${shown}${more}`;
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
  /** The paths dirty at capture time (empty when clean or unreadable) — so a
   * refusal to stamp can NAME what blocked it. */
  readonly dirtyPaths: readonly string[];
  readonly [VALIDATED_TREE_PIN]: true;
}

/** Sample the tree at `cwd` NOW — call this before the validation work runs. */
export async function pinValidatedTree(cwd: string): Promise<ValidatedTreePin> {
  const dirty = await worktreeStatusPaths(cwd);
  const dirtyPaths: readonly string[] = dirty ?? [];
  return {
    head: await headSha(cwd),
    clean: dirty !== undefined && dirty.length === 0,
    dirtyPaths,
  } as ValidatedTreePin;
}

function receiptRecord(
  status: GateReceiptRecordData["status"],
  fields: Omit<GateReceiptRecordData, "status"> = {},
): GateReceiptRecordData {
  return { status, ...fields };
}

/**
 * Record the outcome of a `done` run into the receipt marker. `pin` is the tree
 * identity captured BEFORE the run began ({@link pinValidatedTree}); a stamp names
 * the PINNED sha, and only after re-verifying the tree still matches it — the
 * receipt must vouch only for the exact tree the gate actually read:
 *
 * - GREEN over a CLEAN tree that matches the pin → stamp the validated HEAD (the
 *   vouch accept honors), plus `receiptMarkdown` and `receiptLine` when the run
 *   rendered a receipt, so `status` and `accept` can surface the review summary
 *   without re-running the gate.
 * - GREEN but HEAD moved since the pin (a commit landed mid-run) → stamp nothing:
 *   the run validated the pinned tree, not the commit now at HEAD. Any prior vouch
 *   is left untouched (still truthful at its own sha).
 * - FAILED gate → clear any receipt (fail-closed: a tree the gate just rejected must
 *   not stay vouched; clearing also closes the rare flake/environment-drift case where
 *   a clean HEAD's gate result turns failing with the tree unchanged).
 * - GREEN but DIRTY (at pin time or now) → leave the file untouched: it cannot vouch
 *   for clean HEAD, but a prior clean vouch (at its own sha) is still truthful, and
 *   accept's HEAD-match + clean check keeps it honest.
 *
 * The caller must first acquire `authority` with
 * {@link preflightAdminStateWrites}, before its slow work begins. The writer stays
 * best-effort against a later TOCTOU/filesystem hiccup, which is returned visibly
 * rather than retroactively changing the already-computed quality verdict.
 */
export async function recordGateOutcome(
  cwd: string,
  authority: AdminStateWriteAuthority,
  passed: boolean,
  pin: ValidatedTreePin,
  receiptMarkdown?: string,
  receiptLine?: string,
): Promise<GateReceiptRecordData> {
  const path = authorityPath(cwd, authority, "gateReceipt");
  if (path === undefined) {
    return receiptRecord("unavailable", {
      reason: "could not resolve the gate receipt path",
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
        reason: `the worktree was not clean when the run began${
          describeDirtyPaths(pin.dirtyPaths)
        }`,
      });
    }
    const dirtyNow = await worktreeStatusPaths(cwd);
    if (dirtyNow === undefined || dirtyNow.length > 0) {
      return receiptRecord("skipped_dirty", {
        path,
        reason: `the worktree is not clean${
          describeDirtyPaths(dirtyNow ?? [])
        }`,
      });
    }
    try {
      // Marker format: the sha, then (when the run rendered a receipt) an
      // optional `line: ` component and the page markdown. A marker written
      // without the line component (an older binary's) still parses.
      const line = receiptLine === undefined || receiptLine === ""
        ? ""
        : `line: ${receiptLine}\n`;
      const body = receiptMarkdown === undefined || receiptMarkdown === ""
        ? `${pin.head}\n`
        : `${pin.head}\n${line}\n${receiptMarkdown.trim()}\n`;
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
 * Inspect why the current worktree's gate receipt can or cannot be honored.
 * This is the verbose sibling of {@link gateReceiptHonored}: accept includes the
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
      reason: "could not resolve the gate receipt path",
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
  // First line: the validated HEAD sha. Then, when present: a `line: ` component
  // (the receipt line) and the receipt page markdown finish stored alongside it.
  // Markers from older binaries (sha only, or sha + markdown with no line
  // component) still parse — the absent pieces are simply empty.
  const newline = content.indexOf("\n");
  const recorded = (newline < 0 ? content : content.slice(0, newline)).trim();
  let rest = newline < 0 ? "" : content.slice(newline + 1);
  let line = "";
  if (rest.startsWith("line: ")) {
    const eol = rest.indexOf("\n");
    line = (eol < 0 ? rest.slice("line: ".length) : rest.slice(
      "line: ".length,
      eol,
    )).trim();
    rest = eol < 0 ? "" : rest.slice(eol + 1);
  }
  const markdown = rest.trim();
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
    ...(line === "" ? {} : { receipt_line: line }),
  };
}

/**
 * Whether a receipt proves the worktree's CURRENT (HEAD, clean) state already passed
 * `done` — accept's fast path. True only when a receipt exists, names exactly the
 * current HEAD, and the tree is clean; any new commit, amend, or uncommitted edit
 * makes this false, so accept falls back to running the gate. Never throws.
 */
export async function gateReceiptHonored(cwd: string): Promise<boolean> {
  return (await inspectGateReceipt(cwd)).status === "honored";
}

/**
 * Carry a gate receipt across a `standards --pin` commit (ADR 0106).
 *
 * `standards --pin` commits ONLY `[standards.*]` limit changes. Its `pinnedLimit`
 * arithmetic only tightens a limit to one the just-taken or same-HEAD reused
 * measurement satisfies. That tightened limit also passes the
 * never-loosen comparison against the trunk, so the pin commit still passes both
 * standards halves now enforced by `done` (ADR 0133). When the pre-pin HEAD carried
 * an HONORED receipt (it named that HEAD over a clean tree), re-stamp the vouch onto
 * the new clean HEAD the commit created; otherwise the moved HEAD would strand a
 * truthful pass and force `accept` to re-run the whole gate for a change that cannot
 * alter its outcome.
 *
 * Fail-closed and narrow: it forwards ONLY a vouch that genuinely held a moment ago
 * (`priorHonored`), which only the caller — the author of the commit, so the one party
 * that knows it touched nothing but standard limits — may assert. With no prior vouch it
 * does nothing (returns `undefined`), leaving the now-stale receipt for `accept` to
 * re-validate. The pin is captured here, at the stamp moment: the vouched "work" is the
 * pin commit itself, which the caller just made synchronously, so the tree sampled now
 * IS the tree the vouch is about. The pin preflights `authority` before measuring;
 * the writer remains best-effort against a later point-in-time hiccup.
 */
export async function carryReceiptForwardAcrossPin(
  cwd: string,
  authority: AdminStateWriteAuthority,
  priorHonored: boolean,
): Promise<GateReceiptRecordData | undefined> {
  if (!priorHonored) {
    return undefined;
  }
  return await recordGateOutcome(
    cwd,
    authority,
    true,
    await pinValidatedTree(cwd),
  );
}

// ── the standard measurement receipt ─────────────────────────────────────────────

/** The measurement receipt's verdict: `honored` carries the per-standard values a pin
 * may reuse; every other status means "measure fresh" (a cache miss, never an error). */
export type StandardMeasurementsCheck =
  | { status: "honored"; values: Record<string, number> }
  | { status: "missing" | "stale" | "dirty" | "malformed" | "unavailable" };

/**
 * Record a green check's per-standard measured values against the HEAD pinned
 * BEFORE the measurements ran — written by a green `standards` check AND by a
 * green gate run over a clean committed tree, for a subsequent `--pin` on that
 * same clean HEAD to reuse and for the gate's input-keyed replay to baseline
 * against. Mirrors {@link recordGateOutcome}'s conditions: only a CLEAN tree
 * with a readable HEAD that still matches the pin earns a receipt (a dirty check —
 * `--force` — records nothing, since the values describe a tree no pin will ever
 * see; a mid-measurement commit records nothing, since the values describe the
 * pinned tree, not the commit now at HEAD). A PARTIAL record (the gate with a
 * deferred standard) MERGES into an existing same-HEAD receipt rather than
 * clobbering a fuller one, so check → done → pin still measures once.
 * `durations` (whole seconds per standard) ride along so a defer/replay decision
 * can be made from data. The caller preflights `authority` before measuring; a
 * later I/O hiccup remains best-effort. Returns whether a receipt was written.
 */
export async function recordStandardMeasurements(
  cwd: string,
  authority: AdminStateWriteAuthority,
  values: Record<string, number>,
  pin: ValidatedTreePin,
  durations: Record<string, number> = {},
): Promise<boolean> {
  const path = authorityPath(cwd, authority, "standardMeasurements");
  if (path === undefined || pin.head === undefined || !pin.clean) {
    return false;
  }
  if (
    (await headSha(cwd)) !== pin.head || !(await isWorktreeFullyClean(cwd))
  ) {
    return false;
  }
  try {
    const existing = parseMeasurements(
      await Deno.readTextFile(path).catch(() => ""),
    );
    const merged = existing !== undefined && existing.head === pin.head
      ? {
        values: { ...existing.values, ...values },
        durations: { ...existing.durations, ...durations },
      }
      : { values, durations };
    await Deno.writeTextFile(
      path,
      `${JSON.stringify({ head: pin.head, ...merged })}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the measurement receipt — a RED check's values must not stay reusable
 * (fail-closed, the same posture as a failed finish clearing the gate receipt).
 * The caller preflights `authority`; a later hiccup remains best-effort, and a
 * missing file is already the desired state.
 */
export async function clearStandardMeasurements(
  cwd: string,
  authority: AdminStateWriteAuthority,
): Promise<void> {
  const path = authorityPath(cwd, authority, "standardMeasurements");
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
 * gate receipt, so any commit, amend, or uncommitted edit silently invalidates
 * it. Anything unreadable or mis-shaped reads as `malformed` (measure fresh), never an
 * error. Never throws.
 */
export async function inspectStandardMeasurements(
  cwd: string,
): Promise<StandardMeasurementsCheck> {
  const path = await gitAdminStatePath(cwd, "standardMeasurements");
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

/** A parsed measurement receipt: the commit its values describe, the values,
 * and each measurement's recorded duration (whole seconds; may be empty — a
 * pre-durations receipt still parses). */
export interface StandardMeasurements {
  head: string;
  values: Record<string, number>;
  durations: Record<string, number>;
}

/** A map of finite numbers, or undefined when `raw` is anything else. */
function finiteNumberMap(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    out[name] = value;
  }
  return out;
}

/** Parse the receipt file's JSON defensively: a `head` sha string plus a `values`
 * map of finite numbers (and optional `durations`), or `undefined` for anything
 * else — the file sits on disk between runs, so its content is evidence to
 * validate, not a trusted structure. */
function parseMeasurements(
  raw: string,
): StandardMeasurements | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { head, values, durations } = data as {
    head?: unknown;
    values?: unknown;
    durations?: unknown;
  };
  if (typeof head !== "string" || head === "") {
    return undefined;
  }
  const parsedValues = finiteNumberMap(values);
  if (parsedValues === undefined) {
    return undefined;
  }
  const parsedDurations = durations === undefined
    ? {}
    : finiteNumberMap(durations);
  if (parsedDurations === undefined) {
    return undefined;
  }
  return { head, values: parsedValues, durations: parsedDurations };
}

/**
 * The recorded measurement baselines reachable from this worktree, nearest
 * first: its OWN measurement receipt, then the main checkout's (via the shared
 * git common dir) — the trunk's last recorded measurement, which gives a fresh
 * worktree a baseline before it has measured anything itself. Unlike
 * {@link inspectStandardMeasurements} (the pin's strict same-HEAD honor rule),
 * these are candidates for the gate's input-keyed replay: the CALLER must
 * verify each `head` is an ancestor of the current HEAD and that the standard's
 * declared inputs are untouched since. Best-effort: unreadable or malformed
 * files are simply absent.
 */
export async function measurementBaselines(
  cwd: string,
): Promise<StandardMeasurements[]> {
  const own = await gitAdminStatePath(cwd, "standardMeasurements");
  const common = await runGit(["rev-parse", "--git-common-dir"], { cwd });
  const commonDir = common.success ? common.stdout.trim() : "";
  const trunk = commonDir === "" ? undefined : join(
    commonDir.startsWith("/") ? commonDir : join(cwd, commonDir),
    GIT_ADMIN_STATE.standardMeasurements.path,
  );
  const paths = [own, trunk].filter((p): p is string => p !== undefined);
  const out: StandardMeasurements[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      continue; // the main checkout: its own admin file IS the common-dir file
    }
    seen.add(path);
    const raw = await Deno.readTextFile(path).catch(() => undefined);
    if (raw === undefined) {
      continue;
    }
    const parsed = parseMeasurements(raw);
    if (parsed !== undefined) {
      out.push(parsed);
    }
  }
  return out;
}
