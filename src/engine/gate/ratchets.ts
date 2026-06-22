/**
 * `ratchets` — hold every metric ratchet. The TS port of the shell `ratchets`
 * recipe + `lib/ratchets.sh` (ADR 0003). Each `[ratchets.<name>]` enforces two
 * halves: NEVER LOOSENED vs main (the limit compared to main's value — a floor
 * may only rise, a ceiling only fall) and MEASURED vs limit (run the command,
 * read the `DISCERN_METRIC <name> <number>` line — last wins). Slow, so on demand,
 * never part of finish. Every ratchet runs even if one fails.
 */

import {
  loadConfig,
  type RatchetConfig,
  toCommand,
} from "../../shared/config_schema.ts";
import { RawConfig } from "../../shared/config_read.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";

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

/** Check one ratchet. Prints its own pass/fail line; returns held/failed. The
 * spec is already schema-validated (direction ∈ up|down, limit a number, run
 * present), so the structural checks the shell did are gone — folded into the
 * schema. */
async function ratchetCheck(
  spec: RatchetConfig,
  name: string,
  root: string,
  mainBranch: string,
  out: Out,
): Promise<boolean> {
  const direction = spec.direction;
  const metric = spec.metric ?? name;
  const command = toCommand(spec.run);
  const limit = spec.limit;
  const limitKey = `ratchets.${name}.limit`;

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

/** Run `ratchets`. Returns a process exit code (non-zero if any ratchet failed). */
export async function runRatchets(root: string): Promise<number> {
  const cfg = await loadConfig(root);
  const out = makeOut(colorEnabled());
  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;

  const ratchets = Object.entries(cfg.ratchets);
  if (ratchets.length === 0) {
    out.info(
      "No ratchets configured. Add a [ratchets.<name>] table (e.g. [ratchets.coverage]).",
    );
    return 0;
  }

  let failed = false;
  for (const [name, spec] of ratchets) {
    if (!(await ratchetCheck(spec, name, root, mainBranch, out))) {
      failed = true;
    }
  }

  if (failed) {
    out.error("One or more ratchets failed.");
    return 1;
  }
  out.ok(`All ${ratchets.length} ratchet(s) held.`);
  return 0;
}
