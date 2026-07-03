/**
 * `ratchets` — check every metric ratchet (ADR 0003). Each `[ratchets.<name>]`
 * enforces two
 * halves: NEVER LOOSENED vs main (the limit compared to main's value — a floor
 * may only rise, a ceiling only fall) and MEASURED vs limit (run the command,
 * read the `DISCERN_METRIC <name> <number>` line — last wins). Slow, so on demand,
 * never part of finish. Every ratchet runs even if one fails.
 *
 * Built on the plan/apply seam (ADR 0027): a pure {@link RatchetPlan} (which
 * ratchets, with what direction/limit/metric/command — `ratchet_plan.ts`) is
 * computed first, then the thin executor here applies it. `--dry-run` renders the
 * plan and touches nothing (no git, no measurement); `--json` SERIALIZES the
 * (plan, results) through the shared renderer.
 */

import { type Extent, loadConfig } from "../../shared/config_schema.ts";
import { RawConfig } from "../../shared/config_read.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import {
  buildRatchetPlan,
  perNote,
  type PlannedRatchet,
  type RatchetPlan,
  ratchetPlanToEngine,
} from "./ratchet_plan.ts";
import {
  appliedResult,
  type DiscernResult,
  type PlanStep,
  previewResult,
  renderPlan,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";
import { emitResult } from "../../shared/emit.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import { runGit, runShell } from "../../shared/subprocess.ts";

/** True when `s` is a non-negative decimal number. */
function isNumber(s: string): boolean {
  if (s === "" || s === ".") {
    return false;
  }
  if (!/^[0-9.]+$/.test(s)) {
    return false;
  }
  return (s.match(/\./g) ?? []).length <= 1;
}

/**
 * The value of the last `DISCERN_METRIC <metric> <value>` marker in `output`. The
 * marker may sit anywhere on a line — a command can prefix it with its own text —
 * and the LAST occurrence wins, so a later emission overrides an earlier one.
 * Matched with an anchored pattern (the marker must be a whole token, the value the
 * token after the name) rather than positional word-splitting. Returns undefined
 * when absent.
 */
export function extractMetric(
  output: string,
  metric: string,
): string | undefined {
  const marker = /(?:^|\s)DISCERN_METRIC\s+(\S+)\s+(\S+)/g;
  let value: string | undefined;
  for (const m of output.matchAll(marker)) {
    if (m[1] === metric) {
      value = m[2];
    }
  }
  return value;
}

/** Read a scalar key from main's config (the never-loosen baseline). Reads the
 * new root `discern.toml`, falling back to the legacy `.discern/config.toml` so a
 * branch whose main has not yet been migrated still ratchets correctly. */
async function ratchetMainValue(
  root: string,
  mainBranch: string,
  key: string,
): Promise<number | undefined> {
  for (const rel of ["discern.toml", ".discern/config.toml"]) {
    const out = await runGit(["show", `${mainBranch}:${rel}`], { cwd: root });
    if (!out.success) {
      continue;
    }
    // Read main's (possibly older, possibly un-migrated) config RAW — it must
    // not trip the current schema; only one number is needed out of it.
    const cfg = new RawConfig(out.stdout);
    return cfg.getNumber(key);
  }
  return undefined;
}

/** Run one ratchet's measurement command at the resolved project root, returning
 * its combined output. The run's exit code is deliberately NOT consulted; only
 * the emitted DISCERN_METRIC line decides pass/fail. */
async function measure(command: string, root: string): Promise<string> {
  const r = await runShell(command, { cwd: root });
  const dec = new TextDecoder();
  return dec.decode(r.stdout) + dec.decode(r.stderr);
}

/** The last emitted `DISCERN_METRIC <name>` value as a number, or undefined when
 * absent or non-numeric — reads a `per` denominator the run emits. */
function readEmittedNumber(output: string, name: string): number | undefined {
  const s = extractMetric(output, name);
  return s !== undefined && isNumber(s) ? Number(s) : undefined;
}

/**
 * Measure a built-in extent — a universal, stack-neutral text size over the
 * project's TRACKED files (`git ls-files`, so .gitignore is honored and the count
 * is deterministic). This is the denominator behind `per = { <measure> = <glob> }`,
 * letting the `run` emit only the numerator. Returns 0 when the pathspec matches
 * nothing (the caller reports that as a config error, not a divide-by-zero).
 */
async function measureExtent(
  root: string,
  measure: Extent,
  globs: string[],
): Promise<number> {
  const res = await runGit(["ls-files", "-z", "--", ...globs], { cwd: root });
  if (!res.success) {
    return 0;
  }
  const files = res.stdout.split("\0").filter((p) => p !== "");
  if (measure === "files") {
    return files.length;
  }
  let total = 0;
  for (const rel of files) {
    const path = `${root}/${rel}`;
    if (measure === "bytes") {
      const st = await Deno.stat(path).catch(() => undefined);
      if (st) total += st.size;
      continue;
    }
    const text = await Deno.readTextFile(path).catch(() => undefined);
    if (text === undefined) {
      continue;
    }
    total += measure === "lines"
      ? (text.match(/\n/g) ?? []).length
      : text.split(/\s+/).filter((t) => t !== "").length;
  }
  return total;
}

/** Format a ratcheted value compactly: integers bare, otherwise up to two decimals
 * with trailing zeros trimmed (18.699… → "18.7", 18 → "18"). */
function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** Check one planned ratchet. Prints its own pass/fail line; returns held/failed.
 * The ratchet is already schema-validated (direction ∈ up|down, limit a number,
 * run present), so its structural checks are folded into the schema. */
async function ratchetCheck(
  r: PlannedRatchet,
  root: string,
  mainBranch: string,
  out: Out,
): Promise<boolean> {
  const { name, metric, direction, limit, command, limitKey, per, scale } = r;

  // never loosened vs main
  const main = await ratchetMainValue(root, mainBranch, limitKey);
  if (main !== undefined) {
    if (direction === "up" && limit < main) {
      out.error(
        `ratchet '${name}': floor ${main} -> ${limit} vs ${mainBranch} — the floor only rises. Raise the metric, don't loosen the gate.`,
      );
      return false;
    }
    if (direction === "down" && limit > main) {
      out.error(
        `ratchet '${name}': ceiling ${main} -> ${limit} vs ${mainBranch} — the ceiling only falls. Lower the metric, don't loosen the gate.`,
      );
      return false;
    }
  }

  // measure
  if (command === "") {
    out.error(
      `ratchet '${name}' has no run command (set run = "<command>" under [ratchets.${name}]).`,
    );
    return false;
  }
  out.heading(
    `Measuring ${metric} (${direction}, limit ${limit}${
      perNote(per, scale)
    })...`,
  );
  const output = await measure(command, root);
  out.raw(output.endsWith("\n") || output === "" ? output : `${output}\n`);

  const measuredStr = extractMetric(output, metric);
  if (measuredStr === undefined) {
    out.error(
      `ratchet '${name}': could not read metric '${metric}'. Emit a line: DISCERN_METRIC ${metric} <number>.`,
    );
    return false;
  }
  if (!isNumber(measuredStr)) {
    out.error(
      `ratchet '${name}': metric '${metric}' value is not a number: '${measuredStr}'.`,
    );
    return false;
  }
  const measured = Number(measuredStr);

  // Normalize to a rate when `per` is set: value = metric / denominator * scale, so
  // a growing tree never breaches the limit on its own. `breakdown` shows the raw
  // numbers behind the rate; for a plain count it is empty and `value` is `measured`.
  let value = measured;
  let breakdown = "";
  if (per !== undefined) {
    let denom: number;
    if (per.kind === "metric") {
      const d = readEmittedNumber(output, per.metric);
      if (d === undefined) {
        out.error(
          `ratchet '${name}': could not read 'per' metric '${per.metric}'. Emit a line: DISCERN_METRIC ${per.metric} <number>.`,
        );
        return false;
      }
      denom = d;
    } else {
      denom = await measureExtent(root, per.measure, per.globs);
    }
    if (denom <= 0) {
      const what = per.kind === "metric"
        ? `'per' metric '${per.metric}' is ${denom}`
        : `${per.measure} over ${per.globs.join(", ")} measured 0`;
      out.error(
        `ratchet '${name}': cannot ratchet a rate — ${what} (nothing to divide by). Check the 'per' pathspec/metric.`,
      );
      return false;
    }
    value = (measured / denom) * scale;
    breakdown = ` (${measuredStr} per ${denom}${
      per.kind === "extent" ? ` ${per.measure}` : ""
    }${scale === 1 ? "" : ` ×${scale}`})`;
  }
  const shown = per !== undefined ? fmtRate(value) : measuredStr;

  // compare the value (rate or count) vs limit (epsilon tolerance)
  if (direction === "up") {
    if (value + 1e-9 < limit) {
      out.error(
        `ratchet '${name}': ${metric} ${shown} is below the floor ${limit}${breakdown}. Improve it; never lower the floor.`,
      );
      return false;
    }
    out.ok(
      `ratchet '${name}': ${metric} ${shown} meets the floor ${limit}${breakdown}.`,
    );
  } else {
    if (value - 1e-9 > limit) {
      // A raw-count ceiling that a growing tree can breach on its own is the classic
      // trap — point at the fix the moment it bites.
      const growHint = per === undefined
        ? " If this counts items over a tree you grow, it rises with size — ratchet a rate instead (add `per`)."
        : "";
      out.error(
        `ratchet '${name}': ${metric} ${shown} exceeds the ceiling ${limit}${breakdown}. Bring it down; never raise the ceiling.${growHint}`,
      );
      return false;
    }
    out.ok(
      `ratchet '${name}': ${metric} ${shown} within the ceiling ${limit}${breakdown}.`,
    );
  }
  return true;
}

/** The outcome of applying a ratchet plan: whether all held + the per-step results. */
interface RatchetExecution {
  ok: boolean;
  results: StepResult[];
}

function ratchetPlanIntegrityResult(
  plan: RatchetPlan,
  steps: readonly PlanStep[],
): StepResult {
  return {
    step: {
      kind: "ratchet",
      label: "plan-integrity",
      disposition: "gate",
      note:
        `internal error: planned ${plan.ratchets.length} ratchet(s) but projected ${steps.length} step(s).`,
    },
    outcome: "failed",
  };
}

export function ratchetPlanIntegrityFailure(
  plan: RatchetPlan,
  steps: readonly PlanStep[],
): StepResult | undefined {
  return steps.length === plan.ratchets.length
    ? undefined
    : ratchetPlanIntegrityResult(plan, steps);
}

/**
 * Apply a ratchet plan — the thin executor. Loops the planned ratchets, checking
 * each (the never-loosen read + the measurement + the comparison), and collects a
 * {@link StepResult} per ratchet (held → "ok", failed → "failed"). Every ratchet
 * runs even if one fails — no short-circuit (ADR 0003). Owns every effect; the plan
 * and its projection are pure.
 */
async function executeRatchetPlan(
  plan: RatchetPlan,
  root: string,
  mainBranch: string,
  out: Out,
): Promise<RatchetExecution> {
  const steps = ratchetPlanToEngine(plan).steps;
  const mismatch = ratchetPlanIntegrityFailure(plan, steps);
  if (mismatch !== undefined) {
    out.error(mismatch.step.note ?? "Ratchet plan integrity check failed.");
    return { ok: false, results: [mismatch] };
  }
  const results: StepResult[] = [];
  let ok = true;
  for (let i = 0; i < plan.ratchets.length; i++) {
    const r = plan.ratchets[i];
    const step = steps[i];
    if (r === undefined || step === undefined) {
      const failure = ratchetPlanIntegrityResult(plan, steps);
      out.error(failure.step.note ?? "Ratchet plan integrity check failed.");
      results.push(failure);
      ok = false;
      break;
    }
    const held = await ratchetCheck(r, root, mainBranch, out);
    const outcome: StepOutcome = held ? "ok" : "failed";
    results.push({ step, outcome });
    if (!held) {
      ok = false;
    }
  }
  return { ok, results };
}

/**
 * Compute the `ratchets` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders, and the source the CLI's `--json` serializes.
 * Slow and ON DEMAND: it runs every ratchet's measurement command (and a git read
 * of main's baseline), so it is NOT part of `finish`. `dryRun` returns the plan
 * (no git, no measurement); an empty config is a clean pass. Non-dry-run checks
 * require a clean tree unless forced for ratchet authoring. Otherwise it applies
 * the plan QUIET — the measurement output flows through a silent Out so a caller
 * owning stdout (the MCP stdio channel) stays uncontaminated.
 */
export async function ratchetsResult(
  root: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const plan = buildRatchetPlan(cfg);
  let result: DiscernResult;
  if (opts.dryRun ?? false) {
    result = previewResult("ratchets", ratchetPlanToEngine(plan));
  } else if (plan.ratchets.length === 0) {
    result = appliedResult("ratchets", []);
  } else {
    const dirtyMessage = (opts.force ?? false)
      ? undefined
      : await ratchetsCleanTreeMessage(root);
    if (dirtyMessage !== undefined) {
      result = {
        ok: false,
        verb: "ratchets",
        error: "dirty_worktree",
        message: dirtyMessage,
      };
    } else {
      const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
      const out = makeOut(colorEnabled(), { quiet: true });
      const { results } = await executeRatchetPlan(plan, root, mainBranch, out);
      result = appliedResult("ratchets", results);
    }
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): ratchets is
  // un-gated during setup, so its output must not read as a finished project.
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  if (inProgress !== undefined) {
    result.hints = [inProgress, ...(result.hints ?? [])];
  }
  return result;
}

/** Run `ratchets`. Returns a process exit code (non-zero if any ratchet failed). */
export async function runRatchets(
  root: string,
  opts: { json?: boolean; dryRun?: boolean; force?: boolean } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;

  // --json/MCP: the result envelope is the entire output (ADR 0030) — compute it
  // through the shared core and emit it.
  if (json) {
    const result = await ratchetsResult(root, { dryRun, force });
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  // Human path: narrate live (each ratchet's measurement output flows through `out`).
  const cfg = await loadConfig(root);
  const out = makeOut(colorEnabled(), { quiet: false });
  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
  const plan = buildRatchetPlan(cfg);

  // --dry-run: show the plan, touch nothing — no git, no measurement.
  if (dryRun) {
    renderPlan(outSink(out), ratchetPlanToEngine(plan));
    return 0;
  }

  if (plan.ratchets.length === 0) {
    out.info(
      "No ratchets configured. Add a [ratchets.<name>] table (e.g. [ratchets.coverage]).",
    );
    return 0;
  }

  if (!force) {
    const dirtyMessage = await ratchetsCleanTreeMessage(root);
    if (dirtyMessage !== undefined) {
      out.error(dirtyMessage);
      return 1;
    }
  }

  const { ok } = await executeRatchetPlan(plan, root, mainBranch, out);
  if (!ok) {
    out.error("One or more ratchets failed.");
    return 1;
  }
  out.ok(`All ${plan.ratchets.length} ratchet(s) held.`);
  return 0;
}

async function ratchetsCleanTreeMessage(
  root: string,
): Promise<string | undefined> {
  const status = await runGit(["status", "--porcelain"], { cwd: root });
  if (!status.success) {
    return "Ratchets require a clean worktree, but discern could not read git status. Fix the git status check and re-run `discern ratchets`; use `--force` only while authoring or debugging ratchets.";
  }
  if (status.stdout.trim() === "") {
    return undefined;
  }
  return "Ratchets require a clean worktree because they are slow final checks. Commit or stash changes, then re-run `discern ratchets`; use `--force` only while authoring or debugging ratchets.";
}
