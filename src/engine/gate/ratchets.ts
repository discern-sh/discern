/**
 * `ratchets` — hold every metric ratchet (ADR 0003). Each `[ratchets.<name>]`
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

import { loadConfig } from "../../shared/config_schema.ts";
import { RawConfig } from "../../shared/config_read.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import {
  buildRatchetPlan,
  type PlannedRatchet,
  type RatchetPlan,
  ratchetPlanToEngine,
} from "./ratchet_plan.ts";
import {
  appliedResult,
  type DiscernResult,
  previewResult,
  renderPlan,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";
import { emitResult } from "../../shared/emit.ts";
import { runGit } from "../../shared/subprocess.ts";

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

/** Run one ratchet's measurement command, returning its combined output. The
 * run's exit code is deliberately NOT consulted; only the emitted
 * DISCERN_METRIC line decides pass/fail. */
async function measure(command: string): Promise<string> {
  const out = await new Deno.Command("sh", {
    args: ["-c", command],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return dec.decode(out.stdout) + dec.decode(out.stderr);
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
  const { name, metric, direction, limit, command, limitKey } = r;

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
  out.heading(`Measuring ${metric} (${direction}, limit ${limit})...`);
  const output = await measure(command);
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

  // compare measured vs limit (epsilon tolerance)
  if (direction === "up") {
    if (measured + 1e-9 < limit) {
      out.error(
        `ratchet '${name}': ${metric} ${measuredStr} is below the floor ${limit}. Improve it; never lower the floor.`,
      );
      return false;
    }
    out.ok(
      `ratchet '${name}': ${metric} ${measuredStr} meets the floor ${limit}.`,
    );
  } else {
    if (measured - 1e-9 > limit) {
      out.error(
        `ratchet '${name}': ${metric} ${measuredStr} exceeds the ceiling ${limit}. Bring it down; never raise the ceiling.`,
      );
      return false;
    }
    out.ok(
      `ratchet '${name}': ${metric} ${measuredStr} within the ceiling ${limit}.`,
    );
  }
  return true;
}

/** The outcome of applying a ratchet plan: whether all held + the per-step results. */
interface RatchetExecution {
  ok: boolean;
  results: StepResult[];
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
  const results: StepResult[] = [];
  let ok = true;
  for (let i = 0; i < plan.ratchets.length; i++) {
    const r = plan.ratchets[i];
    const step = steps[i];
    if (r === undefined || step === undefined) {
      continue; // unreachable: steps mirror ratchets 1:1
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
 * (no git, no measurement); an empty config is a clean pass; otherwise it applies
 * the plan QUIET — the measurement output flows through a silent Out so a caller
 * owning stdout (the MCP stdio channel) stays uncontaminated.
 */
export async function ratchetsResult(
  root: string,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const plan = buildRatchetPlan(cfg);
  if (opts.dryRun ?? false) {
    return previewResult("ratchets", ratchetPlanToEngine(plan));
  }
  if (plan.ratchets.length === 0) {
    return appliedResult("ratchets", []);
  }
  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
  const out = makeOut(colorEnabled(), { quiet: true });
  const { results } = await executeRatchetPlan(plan, root, mainBranch, out);
  return appliedResult("ratchets", results);
}

/** Run `ratchets`. Returns a process exit code (non-zero if any ratchet failed). */
export async function runRatchets(
  root: string,
  opts: { json?: boolean; dryRun?: boolean } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const dryRun = opts.dryRun ?? false;

  // --json/MCP: the result envelope is the entire output (ADR 0030) — compute it
  // through the shared core and emit it.
  if (json) {
    const result = await ratchetsResult(root, { dryRun });
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

  const { ok } = await executeRatchetPlan(plan, root, mainBranch, out);
  if (!ok) {
    out.error("One or more ratchets failed.");
    return 1;
  }
  out.ok(`All ${plan.ratchets.length} ratchet(s) held.`);
  return 0;
}
