/**
 * `ratchets` — hold every metric ratchet. The TS port of the shell `ratchets`
 * recipe + `lib/ratchets.sh` (ADR 0003). Each `[ratchets.<name>]` enforces two
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
  planToJson,
  renderPlan,
  resultsToJson,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";

/** True when `s` is a non-negative decimal number (matches the shell predicate). */
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
 * The last `DISCERN_METRIC <metric> <value>` token-triple in `output`, scanned
 * per line (matching the shell awk). Returns undefined when absent.
 */
function extractMetric(output: string, metric: string): string | undefined {
  let value: string | undefined;
  for (const line of output.split("\n")) {
    const t = line.split(/\s+/).filter((x) => x !== "");
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i] === "DISCERN_METRIC" && t[i + 1] === metric) {
        value = t[i + 2];
      }
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
    try {
      const out = await new Deno.Command("git", {
        args: ["-C", root, "show", `${mainBranch}:${rel}`],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (!out.success) {
        continue;
      }
      // Read main's (possibly older, possibly un-migrated) config RAW — it must
      // not trip the current schema; only one number is needed out of it.
      const cfg = new RawConfig(new TextDecoder().decode(out.stdout));
      return cfg.getNumber(key);
    } catch {
      // try the next candidate path
    }
  }
  return undefined;
}

/** Run one ratchet's measurement command, returning its combined output. The
 * run's exit code is deliberately NOT consulted (the shell masks it via `| tee`);
 * only the emitted DISCERN_METRIC line decides pass/fail. */
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
 * run present), so the structural checks the shell did are gone — folded into the
 * schema. */
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

  // compare measured vs limit (epsilon tolerance, matching the shell awk)
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

/** Run `ratchets`. Returns a process exit code (non-zero if any ratchet failed). */
export async function runRatchets(
  root: string,
  opts: { json?: boolean; dryRun?: boolean } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const dryRun = opts.dryRun ?? false;
  const cfg = await loadConfig(root);
  // Non-json: human output → stdout (matching the shell). --json: human → stderr,
  // leaving stdout for the single JSON object.
  const out = makeOut(colorEnabled(), json ? "stderr" : "stdout");
  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;

  const plan = buildRatchetPlan(cfg);

  // --dry-run: show the plan, touch nothing — no git, no measurement.
  if (dryRun) {
    const engine = ratchetPlanToEngine(plan);
    if (json) {
      console.log(JSON.stringify({ dry_run: true, plan: planToJson(engine) }));
      return 0;
    }
    renderPlan(outSink(out), engine);
    return 0;
  }

  if (plan.ratchets.length === 0) {
    if (json) {
      console.log(JSON.stringify(resultsToJson([])));
      return 0;
    }
    out.info(
      "No ratchets configured. Add a [ratchets.<name>] table (e.g. [ratchets.coverage]).",
    );
    return 0;
  }

  const { ok, results } = await executeRatchetPlan(plan, root, mainBranch, out);

  if (json) {
    console.log(JSON.stringify(resultsToJson(results)));
    return ok ? 0 : 1;
  }

  if (!ok) {
    out.error("One or more ratchets failed.");
    return 1;
  }
  out.ok(`All ${plan.ratchets.length} ratchet(s) held.`);
  return 0;
}
