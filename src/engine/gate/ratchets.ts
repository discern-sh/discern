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

import {
  type DiscernConfig,
  type Extent,
  loadConfig,
} from "../../shared/config_schema.ts";
import { RawConfig } from "../../shared/config_read.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import {
  buildRatchetPlan,
  perNote,
  pinnedLimit,
  type PlannedRatchet,
  type RatchetPlan,
  ratchetPlanToEngine,
} from "./ratchet_plan.ts";
import {
  appliedResult,
  type Diagnostic,
  type DiscernResult,
  type PlanStep,
  previewResult,
  renderPlan,
  renderStepResults,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import { emitResult } from "../../shared/emit.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import { runGit, runShell } from "../../shared/subprocess.ts";
import { join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "../../shared/env.ts";
import { TomlEditor } from "../../lib/toml_edit.ts";
import { carryReceiptForwardAcrossPin, inspectGateReceipt } from "./receipt.ts";

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

/** One ratchet check's verdict. When it failed, `reason` carries the same words the
 * logger printed — the caller mirrors them into the result envelope's diagnostics, so
 * a caller that can't hear the live logger (MCP, `--json`) still learns WHY. The
 * metric-reading failures also carry the measurement `output`: the evidence needed to
 * see why no metric emerged. */
interface RatchetVerdict {
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
  /** The failure reason, exactly as narrated; absent when the ratchet held. */
  reason?: string;
  /** The measurement command's captured output, when it is the failure's evidence. */
  output?: string;
}

/** Check one planned ratchet: the never-loosen read, the measurement, the comparison.
 * Prints its own pass/fail line and returns whether it `held` plus the measured `value`
 * (the rate or count compared to the limit) when a measurement was taken — the value
 * `ratchets --pin` would tighten the limit to. The ratchet is already schema-validated
 * (direction ∈ up|down, limit a number, run present), so its structural checks are
 * folded into the schema. */
async function ratchetCheck(
  r: PlannedRatchet,
  root: string,
  mainBranch: string,
  out: Out,
): Promise<RatchetVerdict> {
  const { name, metric, direction, limit, command, limitKey, per, scale } = r;

  // never loosened vs main
  const main = await ratchetMainValue(root, mainBranch, limitKey);
  if (main !== undefined) {
    if (direction === "up" && limit < main) {
      const reason =
        `ratchet '${name}': floor ${main} -> ${limit} vs ${mainBranch} — the floor only rises. Raise the metric, don't loosen the gate.`;
      out.error(reason);
      return { held: false, reason };
    }
    if (direction === "down" && limit > main) {
      const reason =
        `ratchet '${name}': ceiling ${main} -> ${limit} vs ${mainBranch} — the ceiling only falls. Lower the metric, don't loosen the gate.`;
      out.error(reason);
      return { held: false, reason };
    }
  }

  // measure
  if (command === "") {
    const reason =
      `ratchet '${name}' has no run command (set run = "<command>" under [ratchets.${name}]).`;
    out.error(reason);
    return { held: false, reason };
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
    const reason =
      `ratchet '${name}': could not read metric '${metric}'. Emit a line: DISCERN_METRIC ${metric} <number>.`;
    out.error(reason);
    return { held: false, reason, output };
  }
  if (!isNumber(measuredStr)) {
    const reason =
      `ratchet '${name}': metric '${metric}' value is not a number: '${measuredStr}'.`;
    out.error(reason);
    return { held: false, reason, output };
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
        const reason =
          `ratchet '${name}': could not read 'per' metric '${per.metric}'. Emit a line: DISCERN_METRIC ${per.metric} <number>.`;
        out.error(reason);
        return { held: false, reason, output };
      }
      denom = d;
    } else {
      denom = await measureExtent(root, per.measure, per.globs);
    }
    if (denom <= 0) {
      const what = per.kind === "metric"
        ? `'per' metric '${per.metric}' is ${denom}`
        : `${per.measure} over ${per.globs.join(", ")} measured 0`;
      const reason =
        `ratchet '${name}': cannot ratchet a rate — ${what} (nothing to divide by). Check the 'per' pathspec/metric.`;
      out.error(reason);
      return { held: false, reason };
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
      const reason =
        `ratchet '${name}': ${metric} ${shown} is below the floor ${limit}${breakdown}. Improve it; never lower the floor.`;
      out.error(reason);
      return { held: false, value, reason };
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
      const reason =
        `ratchet '${name}': ${metric} ${shown} exceeds the ceiling ${limit}${breakdown}. Bring it down; never raise the ceiling.${growHint}`;
      out.error(reason);
      return { held: false, value, reason };
    }
    out.ok(
      `ratchet '${name}': ${metric} ${shown} within the ceiling ${limit}${breakdown}.`,
    );
  }
  return { held: true, value };
}

/** One ratchet's measured outcome, carried alongside its {@link StepResult} so the
 * `--pin` pass can read the value the check computed without measuring a second time. */
interface RatchetOutcome {
  ratchet: PlannedRatchet;
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
}

/** The outcome of applying a ratchet plan: whether all held, the per-step results, the
 * per-ratchet measured outcomes (which the pin pass reads), and one diagnostic per
 * failure carrying its reason — the envelope's channel for WHY, so a caller that
 * can't hear the live logger (MCP, `--json`) is never left with a bare failed step. */
interface RatchetExecution {
  ok: boolean;
  results: StepResult[];
  outcomes: RatchetOutcome[];
  diagnostics: Diagnostic[];
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
  const integrityDiagnostic = (failure: StepResult): Diagnostic => ({
    tool: failure.step.label,
    severity: "error",
    message: failure.step.note ?? "Ratchet plan integrity check failed.",
    reproduce_cmd: "discern ratchets",
  });
  const mismatch = ratchetPlanIntegrityFailure(plan, steps);
  if (mismatch !== undefined) {
    out.error(mismatch.step.note ?? "Ratchet plan integrity check failed.");
    return {
      ok: false,
      results: [mismatch],
      outcomes: [],
      diagnostics: [integrityDiagnostic(mismatch)],
    };
  }
  const results: StepResult[] = [];
  const outcomes: RatchetOutcome[] = [];
  const diagnostics: Diagnostic[] = [];
  let ok = true;
  for (let i = 0; i < plan.ratchets.length; i++) {
    const r = plan.ratchets[i];
    const step = steps[i];
    if (r === undefined || step === undefined) {
      const failure = ratchetPlanIntegrityResult(plan, steps);
      out.error(failure.step.note ?? "Ratchet plan integrity check failed.");
      results.push(failure);
      diagnostics.push(integrityDiagnostic(failure));
      ok = false;
      break;
    }
    const verdict = await ratchetCheck(r, root, mainBranch, out);
    const outcome: StepOutcome = verdict.held ? "ok" : "failed";
    results.push({ step, outcome });
    outcomes.push({
      ratchet: r,
      held: verdict.held,
      ...(verdict.value !== undefined ? { value: verdict.value } : {}),
    });
    if (!verdict.held) {
      ok = false;
      // The same words the logger narrated, mirrored into the envelope — a failed
      // ratchets step always travels with its reason (never logger-only).
      diagnostics.push({
        tool: step.label,
        severity: "error",
        message: verdict.reason ?? `ratchet '${r.name}' failed.`,
        reproduce_cmd: "discern ratchets",
        ...(verdict.output !== undefined
          ? await diagnosticOutputFields(verdict.output)
          : {}),
      });
    }
  }
  return { ok, results, outcomes, diagnostics };
}

// ── `--pin`: capture a measured improvement into the limit (ADR 0106) ──────────

/** One limit the pin pass will tighten: the ratchet, the value it measured, and the
 * new limit computed from it (measured ∓ margin, in the tightening direction). */
interface PinnedRatchet {
  ratchet: PlannedRatchet;
  measured: number;
  newLimit: number;
}

/** A `ratchet` step for the pin result: always "ok" (a failing ratchet aborts the pin
 * before any pin step is built), noting what was pinned or that there was nothing to. */
function pinStep(name: string, note: string): StepResult {
  return {
    step: { kind: "ratchet", label: name, disposition: "run", note },
    outcome: "ok",
  };
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The re-pin commit message: an imperative subject and a body listing each limit's
 * old→new and the measurement behind it, so `git log` explains why the bound moved. */
function pinCommitMessage(pins: PinnedRatchet[]): string {
  const only = pins.length === 1 ? pins[0] : undefined;
  const subject = only !== undefined
    ? `Pin ratchet baseline: ${only.ratchet.name} ${only.ratchet.limit} → ${only.newLimit}`
    : "Pin ratchet baselines after measured improvement";
  const body = pins.map((p) => {
    const bound = p.ratchet.direction === "up" ? "floor" : "ceiling";
    return `- ${p.ratchet.name}: ${bound} ${p.ratchet.limit} → ${p.newLimit} (measured ${
      fmtRate(p.measured)
    })`;
  }).join("\n");
  return `${subject}\n\n` +
    "Capture a measured improvement so it cannot regress. `discern ratchets`\n" +
    "measured these metrics past their limits; `--pin` tightens each limit to\n" +
    "the measured value, leaving any configured margin of headroom:\n\n" +
    body;
}

/** Rewrite the pinned limits in discern.toml (comment-preservingly, via {@link
 * TomlEditor}) and commit that file ALONE with an audit message. The clean-tree
 * precondition guarantees the config is the only change the commit carries — which is
 * what makes the commit gate-neutral and its receipt safe to carry forward. Returns an
 * error string on failure, undefined on success. */
async function applyPinEdits(
  root: string,
  pins: PinnedRatchet[],
): Promise<string | undefined> {
  const rel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const path = join(root, rel);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    return `could not read ${rel}: ${errText(error)}`;
  }
  try {
    const editor = new TomlEditor(text);
    for (const p of pins) {
      editor.setNumber(`ratchets.${p.ratchet.name}.limit`, p.newLimit);
    }
    await Deno.writeTextFile(path, editor.toString());
  } catch (error) {
    return `could not rewrite ${rel}: ${errText(error)}`;
  }
  const add = await runGit(["add", "--", rel], { cwd: root });
  if (!add.success) {
    return `could not stage ${rel}: ${add.stderr.trim()}`;
  }
  const commit = await runGit(["commit", "-m", pinCommitMessage(pins)], {
    cwd: root,
  });
  if (!commit.success) {
    return `could not commit the re-pin: ${commit.stderr.trim()}`;
  }
  return undefined;
}

/**
 * Apply `ratchets --pin` (ADR 0106): measure every ratchet, and for each one asked for
 * — all of them, or the named subset — that improved past its limit by more than its
 * margin, tighten the limit toward the measured value, commit that change on its own,
 * and carry any gate-pass receipt forward across the (gate-neutral) commit so
 * `graduate` need not re-run the whole gate. A FAILING ratchet pins nothing — you can't
 * capture a good state from a red tree — and returns the ordinary failing result.
 * `dryRun` measures and reports what it WOULD pin, changing nothing.
 */
async function pinRatchetsResult(
  root: string,
  cfg: DiscernConfig,
  plan: RatchetPlan,
  opts: { dryRun: boolean; names: string[] },
): Promise<DiscernResult> {
  if (plan.ratchets.length === 0) {
    return {
      ...appliedResult("ratchets", []),
      hints: ["No ratchets configured, so there is nothing to pin."],
    };
  }

  // A named ratchet that doesn't exist would otherwise pin nothing, silently.
  const known = new Set(plan.ratchets.map((r) => r.name));
  const unknown = opts.names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      verb: "ratchets",
      error: "unknown_ratchet",
      message: `no ratchet named ${unknown.join(", ")}. Configured ratchets: ${
        [...known].join(", ")
      }.`,
    };
  }

  // Pinning writes and commits, so it needs a clean tree; dry-run touches nothing.
  if (!opts.dryRun) {
    const dirty = await ratchetsPinCleanTreeMessage(root);
    if (dirty !== undefined) {
      return {
        ok: false,
        verb: "ratchets",
        error: "dirty_worktree",
        message: dirty,
      };
    }
  }

  // Capture the pre-pin vouch BEFORE anything changes: only an honored receipt may be
  // carried across the commit we are about to make (ADR 0106 / 0067).
  const priorReceipt = opts.dryRun ? undefined : await inspectGateReceipt(root);

  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
  const out = makeOut(colorEnabled(), { quiet: true });
  const { ok, results, outcomes, diagnostics } = await executeRatchetPlan(
    plan,
    root,
    mainBranch,
    out,
  );

  // A red ratchet blocks the whole pin: don't capture a state the gate wouldn't hold.
  if (!ok) {
    const failing = outcomes.filter((o) => !o.held).map((o) => o.ratchet.name);
    const named = failing.length > 0 ? failing.join(", ") : "a ratchet";
    return {
      ...appliedResult("ratchets", results, diagnostics),
      hints: [
        `Not pinning: ${named} ${
          failing.length === 1 ? "is" : "are"
        } failing (diagnostics[] carries each reason). Fix them, then re-run \`discern ratchets --pin\` once green.`,
      ],
    };
  }

  const filter = opts.names.length > 0 ? new Set(opts.names) : undefined;
  const considered = filter === undefined
    ? outcomes
    : outcomes.filter((o) => filter.has(o.ratchet.name));

  const pins: PinnedRatchet[] = [];
  const steps: StepResult[] = [];
  for (const o of considered) {
    const r = o.ratchet;
    const bound = r.direction === "up" ? "floor" : "ceiling";
    const newLimit = o.value === undefined
      ? undefined
      : pinnedLimit(r.direction, o.value, r.margin, r.limit);
    if (o.value === undefined || newLimit === undefined) {
      const seen = o.value === undefined
        ? ""
        : ` (measured ${fmtRate(o.value)})`;
      steps.push(
        pinStep(r.name, `held ${bound} ${r.limit} — nothing to pin${seen}`),
      );
      continue;
    }
    pins.push({ ratchet: r, measured: o.value, newLimit });
    steps.push(
      pinStep(
        r.name,
        `${
          opts.dryRun ? "would pin" : "pinned"
        } ${bound} ${r.limit} → ${newLimit} (measured ${fmtRate(o.value)})`,
      ),
    );
  }

  if (pins.length === 0) {
    return {
      ...appliedResult("ratchets", steps),
      hints: [
        "Nothing to pin — every ratchet asked for already sits at its measured value (within its margin).",
      ],
    };
  }

  if (opts.dryRun) {
    return {
      ...appliedResult("ratchets", steps),
      dry_run: true,
      hints: [
        `Dry run — would pin ${pins.length} limit(s) in one commit; nothing was changed.`,
      ],
    };
  }

  const failure = await applyPinEdits(root, pins);
  if (failure !== undefined) {
    return {
      ok: false,
      verb: "ratchets",
      error: "pin_failed",
      message: failure,
    };
  }

  // The commit moved HEAD; carry an honored pre-pin vouch onto it so graduate skips the
  // redundant gate re-run (the commit changed only ratchet limits — gate-neutral).
  const receipt = await carryReceiptForwardAcrossPin(
    root,
    priorReceipt?.status === "honored",
  );
  const carried = receipt?.status === "recorded";
  return {
    ...appliedResult("ratchets", steps),
    hints: [
      carried
        ? "Carried the gate-pass receipt forward — `discern graduate` will skip the redundant gate re-run."
        : "No current gate-pass receipt to carry forward — run `discern finish` before graduating, or graduate re-runs the gate.",
    ],
  };
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
 *
 * With `pin`, it instead runs the pin pass (ADR 0106): measure, tighten each
 * asked-for limit that improved past its margin, commit that change alone, and carry
 * a gate-pass receipt forward across it. `pinNames` restricts the pin to those
 * ratchets (empty = all with slack). `dryRun` reports what pin would do, unchanged.
 */
export async function ratchetsResult(
  root: string,
  opts: {
    dryRun?: boolean;
    force?: boolean;
    pin?: boolean;
    pinNames?: string[];
  } = {},
): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const plan = buildRatchetPlan(cfg);
  let result: DiscernResult;
  if ((opts.pinNames?.length ?? 0) > 0 && !(opts.pin ?? false)) {
    // Names only mean something to the pin pass; a bare `ratchets <name>` would
    // otherwise silently check everything, ignoring what was asked for.
    result = {
      ok: false,
      verb: "ratchets",
      error: "invalid_args",
      message:
        "ratchet names only apply with --pin. Re-run as `discern ratchets --pin <name>…`, or drop the names to check every ratchet.",
    };
  } else if (opts.pin ?? false) {
    result = await pinRatchetsResult(root, cfg, plan, {
      dryRun: opts.dryRun ?? false,
      names: opts.pinNames ?? [],
    });
  } else if (opts.dryRun ?? false) {
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
      const { results, diagnostics } = await executeRatchetPlan(
        plan,
        root,
        mainBranch,
        out,
      );
      result = appliedResult("ratchets", results, diagnostics);
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

/** Render a ratchets {@link DiscernResult} to the human console — the `--pin` path's
 * story is the result envelope (steps + hints), not the live measurement narration the
 * plain check path streams. */
function renderRatchetsResult(result: DiscernResult): void {
  const out = makeOut(colorEnabled(), { quiet: false });
  if ((result.steps ?? []).length > 0) {
    renderStepResults(outSink(out), {
      title: "Ratchet results",
      steps: result.steps ?? [],
    });
  }
  if (!result.ok && result.message !== undefined) {
    out.error(result.message);
  }
  for (const hint of result.hints ?? []) {
    out.info(hint);
  }
}

/** Run `ratchets`. Returns a process exit code (non-zero if any ratchet failed). */
export async function runRatchets(
  root: string,
  opts: {
    json?: boolean;
    dryRun?: boolean;
    force?: boolean;
    pin?: boolean;
    pinNames?: string[];
  } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const pin = opts.pin ?? false;
  const pinNames = opts.pinNames ?? [];

  // --json (any mode), --pin, or bare ratchet names: the result envelope is the whole
  // story (ADR 0030) — compute it through the shared core, then emit (JSON) or render
  // it (human). Pinning measures and commits, so live measurement narration would only
  // bury the outcome; names without --pin route here so the shared guard fires.
  if (json || pin || pinNames.length > 0) {
    const result = await ratchetsResult(root, { dryRun, force, pin, pinNames });
    if (json) {
      emitResult(result);
    } else {
      renderRatchetsResult(result);
    }
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

  const { results } = await executeRatchetPlan(plan, root, mainBranch, out);
  const result = appliedResult("ratchets", results);
  renderStepResults(outSink(out), {
    title: "Ratchet results",
    steps: result.steps ?? [],
  });
  if (!result.ok) {
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

/** The clean-tree guard for `--pin`: pin commits the limit change on its own, so an
 * unclean tree would sweep unrelated edits into that commit. Unlike a plain check, no
 * `--force` escape — a dirty pin is never safe. Returns undefined when the tree is
 * clean. */
async function ratchetsPinCleanTreeMessage(
  root: string,
): Promise<string | undefined> {
  const status = await runGit(["status", "--porcelain"], { cwd: root });
  if (!status.success) {
    return "Pinning requires a clean worktree, but discern could not read git status. Fix the git status check and re-run `discern ratchets --pin`.";
  }
  if (status.stdout.trim() === "") {
    return undefined;
  }
  return "Pinning requires a clean worktree: it commits the limit change on its own, so any other edit would be swept into that commit. Commit or stash your changes, then re-run `discern ratchets --pin`.";
}
