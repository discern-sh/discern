/**
 * `standards` — check every metric standard (ADR 0003). Each `[standards.<name>]`
 * enforces two
 * halves: NEVER LOOSENED vs main (the limit compared to main's value — a floor
 * may only rise, a ceiling only fall) and MEASURED vs limit (run the command,
 * read the `DISCERN_METRIC <name> <number>` line — last wins). Slow, so on demand,
 * never part of finish. Every standard runs even if one fails.
 *
 * Built on the plan/apply seam (ADR 0027): a pure {@link StandardPlan} (which
 * standards, with what direction/limit/metric/command — `standard_plan.ts`) is
 * computed first, then the thin executor here applies it. `--dry-run` renders the
 * plan and touches nothing (no git, no measurement); `--json` SERIALIZES the
 * (plan, results) through the shared renderer.
 *
 * The check → pin flow measures ONCE: a green check over a clean tree records a
 * measurement receipt (`receipt.ts`) naming every measured value against the exact
 * HEAD, and a `--pin` on that same clean HEAD replays those values instead of
 * re-running the measurements — re-checking only the never-loosen half live, since
 * main's baseline can advance while HEAD stands still.
 */

import {
  type DiscernConfig,
  type Extent,
  loadConfig,
} from "../../shared/config_schema.ts";
import { RawConfig } from "../../shared/config_read.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import {
  buildStandardPlan,
  perNote,
  pinnedLimit,
  type PlannedStandard,
  type StandardPlan,
  standardPlanToEngine,
} from "./standard_plan.ts";
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
import {
  carryReceiptForwardAcrossPin,
  clearStandardMeasurements,
  inspectGateReceipt,
  inspectStandardMeasurements,
  pinValidatedTree,
  recordStandardMeasurements,
  type ValidatedTreePin,
} from "./receipt.ts";

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
 * branch whose main has not yet been migrated still checks standards correctly. The
 * `rev:./path` spelling is load-bearing: git resolves a bare `rev:path` against
 * the repository TOPLEVEL, but the config lives at the PROJECT root (the cwd) —
 * for a project rooted in a subdirectory of its repo, the bare form finds
 * nothing and the never-loosen half would silently disable. */
async function standardMainValue(
  root: string,
  mainBranch: string,
  key: string,
): Promise<number | undefined> {
  for (const rel of ["discern.toml", ".discern/config.toml"]) {
    const out = await runGit(["show", `${mainBranch}:./${rel}`], {
      cwd: root,
    });
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

/** Run one standard's measurement command at the resolved project root, returning
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

/** Format a normalized value compactly: integers bare, otherwise up to two decimals
 * with trailing zeros trimmed (18.699… → "18.7", 18 → "18"). */
function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** One standard check's verdict. When it failed, `reason` carries the same words the
 * logger printed — the caller mirrors them into the result envelope's diagnostics, so
 * a caller that can't hear the live logger (MCP, `--json`) still learns WHY. The
 * metric-reading failures also carry the measurement `output`: the evidence needed to
 * see why no metric emerged. */
interface StandardVerdict {
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
  /** The failure reason, exactly as narrated; absent when the standard held. */
  reason?: string;
  /** The measurement command's captured output, when it is the failure's evidence. */
  output?: string;
  /** The command that reproduces the failure — the standard's own `run` when the
   * measurement is what failed or fell short; absent for the structural failures
   * (a loosened limit, a missing command), where re-running measures nothing. */
  reproduce_cmd?: string;
}

/** Check one planned standard: the never-loosen read, the measurement, the comparison.
 * Prints its own pass/fail line and returns whether it `held` plus the measured `value`
 * (the rate or count compared to the limit) when a measurement was taken — the value
 * `standards --pin` would tighten the limit to. The standard is already schema-validated
 * (direction ∈ up|down, limit a number, run present), so its structural checks are
 * folded into the schema. */
/** The never-loosen half of one standard's check: the branch's limit compared to
 * main's baseline (a floor may only rise, a ceiling only fall). Returns the failure
 * reason, or undefined when the limit is not loosened. Split out of
 * {@link standardCheck} because this half is NOT cacheable — main can advance while
 * HEAD stands still — so the measurement-receipt replay re-runs exactly this, live. */
async function loosenedVsMainReason(
  r: PlannedStandard,
  root: string,
  mainBranch: string,
): Promise<string | undefined> {
  const main = await standardMainValue(root, mainBranch, r.limitKey);
  if (main === undefined) {
    return undefined;
  }
  if (r.direction === "up" && r.limit < main) {
    return `standard '${r.name}': floor ${main} -> ${r.limit} vs ${mainBranch} — the floor only rises. Raise the metric, don't loosen the gate.`;
  }
  if (r.direction === "down" && r.limit > main) {
    return `standard '${r.name}': ceiling ${main} -> ${r.limit} vs ${mainBranch} — the ceiling only falls. Lower the metric, don't loosen the gate.`;
  }
  return undefined;
}

async function standardCheck(
  r: PlannedStandard,
  root: string,
  mainBranch: string,
  out: Out,
): Promise<StandardVerdict> {
  const { name, metric, direction, limit, command, per, scale } = r;

  // never loosened vs main
  const loosened = await loosenedVsMainReason(r, root, mainBranch);
  if (loosened !== undefined) {
    out.error(loosened);
    return { held: false, reason: loosened };
  }

  // measure
  if (command === "") {
    const reason =
      `standard '${name}' has no run command (set run = "<command>" under [standards.${name}]).`;
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
      `standard '${name}': could not read metric '${metric}'. Emit a line: DISCERN_METRIC ${metric} <number>.`;
    out.error(reason);
    return { held: false, reason, output, reproduce_cmd: command };
  }
  if (!isNumber(measuredStr)) {
    const reason =
      `standard '${name}': metric '${metric}' value is not a number: '${measuredStr}'.`;
    out.error(reason);
    return { held: false, reason, output, reproduce_cmd: command };
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
          `standard '${name}': could not read 'per' metric '${per.metric}'. Emit a line: DISCERN_METRIC ${per.metric} <number>.`;
        out.error(reason);
        return { held: false, reason, output, reproduce_cmd: command };
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
        `standard '${name}': cannot calculate a rate — ${what} (nothing to divide by). Check the 'per' pathspec/metric.`;
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
        `standard '${name}': ${metric} ${shown} is below the floor ${limit}${breakdown}. Improve it; never lower the floor.`;
      out.error(reason);
      return { held: false, value, reason, reproduce_cmd: command };
    }
    out.ok(
      `standard '${name}': ${metric} ${shown} meets the floor ${limit}${breakdown}.`,
    );
  } else {
    if (value - 1e-9 > limit) {
      // A raw-count ceiling that a growing tree can breach on its own is the classic
      // trap — point at the fix the moment it bites.
      const growHint = per === undefined
        ? " If this counts items over a tree you grow, it rises with size — hold a rate instead (add `per`)."
        : "";
      const reason =
        `standard '${name}': ${metric} ${shown} exceeds the ceiling ${limit}${breakdown}. Bring it down; never raise the ceiling.${growHint}`;
      out.error(reason);
      return { held: false, value, reason, reproduce_cmd: command };
    }
    out.ok(
      `standard '${name}': ${metric} ${shown} within the ceiling ${limit}${breakdown}.`,
    );
  }
  return { held: true, value };
}

/** One standard's measured outcome, carried alongside its {@link StepResult} so the
 * `--pin` pass can read the value the check computed without measuring a second time. */
interface StandardOutcome {
  standard: PlannedStandard;
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
}

/** The outcome of applying a standard plan: whether all held, the per-step results, the
 * per-standard measured outcomes (which the pin pass reads), and one diagnostic per
 * failure carrying its reason — the envelope's channel for WHY, so a caller that
 * can't hear the live logger (MCP, `--json`) is never left with a bare failed step. */
interface StandardExecution {
  ok: boolean;
  results: StepResult[];
  outcomes: StandardOutcome[];
  diagnostics: Diagnostic[];
}

function standardPlanIntegrityResult(
  plan: StandardPlan,
  steps: readonly PlanStep[],
): StepResult {
  return {
    step: {
      kind: "standard",
      label: "plan-integrity",
      disposition: "gate",
      note:
        `internal error: planned ${plan.standards.length} standard(s) but projected ${steps.length} step(s).`,
    },
    outcome: "failed",
  };
}

export function standardPlanIntegrityFailure(
  plan: StandardPlan,
  steps: readonly PlanStep[],
): StepResult | undefined {
  return steps.length === plan.standards.length
    ? undefined
    : standardPlanIntegrityResult(plan, steps);
}

/**
 * Apply a standard plan — the thin executor. Loops the planned standards, checking
 * each (the never-loosen read + the measurement + the comparison), and collects a
 * {@link StepResult} per standard (held → "ok", failed → "failed"). Every standard
 * runs even if one fails — no short-circuit (ADR 0003). Owns every effect; the plan
 * and its projection are pure.
 */
async function executeStandardPlan(
  plan: StandardPlan,
  root: string,
  mainBranch: string,
  out: Out,
): Promise<StandardExecution> {
  const steps = standardPlanToEngine(plan).steps;
  const integrityDiagnostic = (failure: StepResult): Diagnostic => ({
    tool: failure.step.label,
    severity: "error",
    message: failure.step.note ?? "Standard plan integrity check failed.",
    reproduce_cmd: "discern standards",
  });
  const mismatch = standardPlanIntegrityFailure(plan, steps);
  if (mismatch !== undefined) {
    out.error(mismatch.step.note ?? "Standard plan integrity check failed.");
    return {
      ok: false,
      results: [mismatch],
      outcomes: [],
      diagnostics: [integrityDiagnostic(mismatch)],
    };
  }
  const results: StepResult[] = [];
  const outcomes: StandardOutcome[] = [];
  const diagnostics: Diagnostic[] = [];
  let ok = true;
  for (let i = 0; i < plan.standards.length; i++) {
    const r = plan.standards[i];
    const step = steps[i];
    if (r === undefined || step === undefined) {
      const failure = standardPlanIntegrityResult(plan, steps);
      out.error(failure.step.note ?? "Standard plan integrity check failed.");
      results.push(failure);
      diagnostics.push(integrityDiagnostic(failure));
      ok = false;
      break;
    }
    const verdict = await standardCheck(r, root, mainBranch, out);
    const outcome: StepOutcome = verdict.held ? "ok" : "failed";
    // The applied step's note carries the measured value (the plan's note cannot —
    // nothing has run yet), so an envelope-only caller sees the number on every
    // measured step, held or not, without re-running a slow measurement.
    const note = verdict.value !== undefined
      ? `${step.note !== undefined ? `${step.note}, ` : ""}measured ${
        fmtRate(verdict.value)
      }`
      : step.note;
    results.push({
      step: { ...step, ...(note !== undefined ? { note } : {}) },
      outcome,
    });
    outcomes.push({
      standard: r,
      held: verdict.held,
      ...(verdict.value !== undefined ? { value: verdict.value } : {}),
    });
    if (!verdict.held) {
      ok = false;
      // The same words the logger narrated, mirrored into the envelope — a failed
      // standards step always travels with its reason (never logger-only). The
      // reproduce is the standard's own run command when the measurement is the
      // failure; the structural failures fall back to the verb itself.
      diagnostics.push({
        tool: step.label,
        severity: "error",
        message: verdict.reason ?? `standard '${r.name}' failed.`,
        reproduce_cmd: verdict.reproduce_cmd ?? "discern standards",
        ...(verdict.output !== undefined
          ? await diagnosticOutputFields(verdict.output)
          : {}),
      });
    }
  }
  return { ok, results, outcomes, diagnostics };
}

/** Route a plain check's outcome into the measurement receipt: green over a clean
 * tree records every measured value against the HEAD pinned before the measurements
 * ran (for a `--pin` on that same clean HEAD to reuse), red clears any receipt
 * (fail-closed). Returns whether a reusable receipt now exists. Best-effort — the
 * receipt is an optimization, never part of the check's own verdict. */
async function recordCheckMeasurements(
  root: string,
  execution: StandardExecution,
  pin: ValidatedTreePin,
): Promise<boolean> {
  if (!execution.ok) {
    await clearStandardMeasurements(root);
    return false;
  }
  const values: Record<string, number> = {};
  for (const o of execution.outcomes) {
    if (o.value === undefined) {
      return false;
    }
    values[o.standard.name] = o.value;
  }
  return await recordStandardMeasurements(root, values, pin);
}

// ── `--pin`: capture a measured improvement into the limit (ADR 0106) ──────────

/** The measured values a pin may reuse instead of re-measuring: the measurement
 * receipt must be honored (recorded by a green check against this exact HEAD, tree
 * still clean) and name every planned standard. Anything short of that returns
 * undefined — a cache miss the caller answers by measuring fresh, never an error. */
async function reusableMeasurements(
  root: string,
  plan: StandardPlan,
): Promise<Record<string, number> | undefined> {
  const receipt = await inspectStandardMeasurements(root);
  if (receipt.status !== "honored") {
    return undefined;
  }
  const complete = plan.standards.every((r) =>
    receipt.values[r.name] !== undefined
  );
  return complete ? receipt.values : undefined;
}

/**
 * Rebuild a {@link StandardExecution} from the measurement receipt's values instead
 * of running the measurements. Only the never-loosen half is re-checked live — it
 * reads main's baseline, which can advance while HEAD stands still — while the
 * measured-vs-limit half needs no re-run at all: the same clean HEAD fixes both the
 * values and the limits, and only an all-green check records a receipt.
 */
async function replayExecutionFromReceipt(
  plan: StandardPlan,
  values: Record<string, number>,
  root: string,
  mainBranch: string,
): Promise<StandardExecution> {
  const results: StepResult[] = [];
  const outcomes: StandardOutcome[] = [];
  const diagnostics: Diagnostic[] = [];
  let ok = true;
  for (const r of plan.standards) {
    const value = values[r.name];
    if (value === undefined) {
      // Unreachable — the caller replays only a receipt naming every planned
      // standard — but fail closed as a plain failure rather than pinning blind.
      ok = false;
      const reason =
        `standard '${r.name}': the measurement receipt carries no value for it. Re-run \`discern standards\` to measure.`;
      results.push({
        step: { kind: "standard", label: r.name, disposition: "run" },
        outcome: "failed",
      });
      outcomes.push({ standard: r, held: false });
      diagnostics.push({
        tool: r.name,
        severity: "error",
        message: reason,
        reproduce_cmd: "discern standards",
      });
      continue;
    }
    const loosened = await loosenedVsMainReason(r, root, mainBranch);
    const held = loosened === undefined;
    results.push({
      step: {
        kind: "standard",
        label: r.name,
        disposition: "run",
        note: `${r.direction}, limit ${r.limit}${
          perNote(r.per, r.scale)
        }, measured ${fmtRate(value)} (reused from the green check)`,
      },
      outcome: held ? "ok" : "failed",
    });
    outcomes.push({ standard: r, held, value });
    if (loosened !== undefined) {
      ok = false;
      diagnostics.push({
        tool: r.name,
        severity: "error",
        message: loosened,
        reproduce_cmd: "discern standards",
      });
    }
  }
  return { ok, results, outcomes, diagnostics };
}

/** One limit the pin pass will tighten: the standard, the value it measured, and the
 * new limit computed from it (measured ∓ margin, in the tightening direction). */
interface PinnedStandard {
  standard: PlannedStandard;
  measured: number;
  newLimit: number;
}

/** A `standard` step for the pin result: always "ok" (a failing standard aborts the pin
 * before any pin step is built), noting what was pinned or that there was nothing to. */
function pinStep(name: string, note: string): StepResult {
  return {
    step: { kind: "standard", label: name, disposition: "run", note },
    outcome: "ok",
  };
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The re-pin commit message: an imperative subject and a body listing each limit's
 * old→new and the measurement behind it, so `git log` explains why the bound moved. */
function pinCommitMessage(pins: PinnedStandard[]): string {
  const only = pins.length === 1 ? pins[0] : undefined;
  const subject = only !== undefined
    ? `Pin standard baseline: ${only.standard.name} ${only.standard.limit} → ${only.newLimit}`
    : "Pin standard baselines after measured improvement";
  const body = pins.map((p) => {
    const bound = p.standard.direction === "up" ? "floor" : "ceiling";
    return `- ${p.standard.name}: ${bound} ${p.standard.limit} → ${p.newLimit} (measured ${
      fmtRate(p.measured)
    })`;
  }).join("\n");
  return `${subject}\n\n` +
    "Capture a measured improvement so it cannot regress. `discern standards`\n" +
    "measured these metrics past their limits; `--pin` tightens each limit to\n" +
    "the measured value, leaving any configured margin of headroom:\n\n" +
    body;
}

/** Restore `rel`'s working-tree and index copy to HEAD, undoing a half-applied pin.
 * The clean-tree precondition guaranteed `rel` matched HEAD before the pin began, so
 * `git checkout HEAD -- <rel>` returns both the file and its staged copy to exactly
 * that state — leaving no trace of the failed attempt for the clean-tree guard to
 * trip over on the retry. Best-effort: reported in the failure message if it fails. */
async function restorePinEdits(root: string, rel: string): Promise<boolean> {
  const restore = await runGit(["checkout", "HEAD", "--", rel], { cwd: root });
  return restore.success;
}

/** Rewrite the pinned limits in discern.toml (comment-preservingly, via {@link
 * TomlEditor}) and commit that file ALONE with an audit message. The clean-tree
 * precondition guarantees the config is the only change the commit carries — which is
 * what makes the commit gate-neutral and its receipt safe to carry forward.
 *
 * The write → stage → commit sequence is a multi-step mutation, so ANY step that
 * fails after the file is rewritten rolls the config back to HEAD before returning —
 * otherwise a failed commit would leave discern.toml modified and staged, and the
 * natural retry (`discern standards --pin` again) is then refused by the clean-tree
 * guard, stranding the user. Returns an error string on failure (noting if the
 * rollback itself could not run), undefined on success. */
async function applyPinEdits(
  root: string,
  pins: PinnedStandard[],
): Promise<string | undefined> {
  const rel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const path = join(root, rel);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    // Nothing has changed yet — no rollback needed.
    return `could not read ${rel}: ${errText(error)}`;
  }

  /** Undo a partial pin, folding any rollback failure into the reported reason. */
  const failWithRollback = async (reason: string): Promise<string> => {
    if (await restorePinEdits(root, rel)) {
      return reason;
    }
    return `${reason} (and discern could not restore ${rel} to HEAD — run \`git checkout HEAD -- ${rel}\` before retrying)`;
  };

  try {
    const editor = new TomlEditor(text);
    for (const p of pins) {
      editor.setNumber(`standards.${p.standard.name}.limit`, p.newLimit);
    }
    await Deno.writeTextFile(path, editor.toString());
  } catch (error) {
    return await failWithRollback(
      `could not rewrite ${rel}: ${errText(error)}`,
    );
  }
  const add = await runGit(["add", "--", rel], { cwd: root });
  if (!add.success) {
    return await failWithRollback(
      `could not stage ${rel}: ${add.stderr.trim()}`,
    );
  }
  const commit = await runGit(["commit", "-m", pinCommitMessage(pins)], {
    cwd: root,
  });
  if (!commit.success) {
    return await failWithRollback(
      `could not commit the re-pin: ${commit.stderr.trim()}`,
    );
  }
  return undefined;
}

/**
 * Apply `standards --pin` (ADR 0106): measure every standard, and for each one asked for
 * — all of them, or the named subset — that improved past its limit by more than its
 * margin, tighten the limit toward the measured value, commit that change on its own,
 * and carry any gate receipt forward across the (gate-neutral) commit so
 * `accept` need not re-run the whole gate. When a green check already measured this
 * exact clean HEAD, its measurement receipt stands in for the measurements — the
 * check → pin flow measures once — with only the never-loosen half re-checked live
 * (main can advance while HEAD stands still). A FAILING standard pins nothing — you can't
 * capture a good state from a red tree — and returns the ordinary failing result.
 * `dryRun` renders the pin plan and measures NOTHING (the universal dry-run contract,
 * ADR 0027) — it cannot say what a pin would change, because slack is only knowable by
 * measuring; the plain check's green result already hints any pinnable slack.
 */
async function pinStandardsResult(
  root: string,
  cfg: DiscernConfig,
  plan: StandardPlan,
  opts: { dryRun: boolean; names: string[] },
): Promise<DiscernResult> {
  if (plan.standards.length === 0) {
    return {
      ...appliedResult("standards", []),
      hints: ["No standards configured, so there is nothing to pin."],
    };
  }

  // A named standard that doesn't exist would otherwise pin nothing, silently.
  const known = new Set(plan.standards.map((r) => r.name));
  const unknown = opts.names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      verb: "standards",
      error: "unknown_standard",
      message: `no standard named ${
        unknown.join(", ")
      }. Configured standards: ${[...known].join(", ")}.`,
    };
  }

  // Which standards a pin considers: all of them, or the named subset.
  const filter = opts.names.length > 0 ? new Set(opts.names) : undefined;

  if (opts.dryRun) {
    // A dry-run renders the pin plan and runs NOTHING — the same contract as every
    // other discern dry-run (ADR 0027). It cannot report what a pin WOULD change:
    // slack is only knowable by measuring, and the measurements are the slow thing
    // a dry-run promises not to run. The plain check already measured — a green
    // result's hints name any pinnable slack — so check → pin needs no preview
    // measurement in between.
    const steps: PlanStep[] = plan.standards
      .filter((r) => filter === undefined || filter.has(r.name))
      .map((r) => ({
        kind: "standard",
        label: r.name,
        disposition: "run",
        note: `would measure ${r.metric}, then tighten the ${
          r.direction === "up" ? "floor" : "ceiling"
        } past ${r.limit} by any slack beyond margin ${r.margin}`,
      }));
    return {
      ...previewResult("standards", {
        title: "Pin plan",
        details: [],
        steps,
      }),
      hints: [
        "A pin dry-run measures nothing. `discern standards` (the plain check) " +
        "measures once and names any pinnable slack in its hints; " +
        "`discern standards --pin` on the same clean commit then reuses those " +
        "measurements to capture it.",
      ],
    };
  }

  // Pinning writes and commits, so it needs a clean tree.
  const dirty = await standardsPinCleanTreeMessage(root);
  if (dirty !== undefined) {
    return {
      ok: false,
      verb: "standards",
      error: "dirty_worktree",
      message: dirty,
    };
  }

  // Capture the pre-pin vouch BEFORE anything changes: only an honored receipt may be
  // carried across the commit we are about to make (ADR 0106 / 0067).
  const priorReceipt = await inspectGateReceipt(root);

  const mainBranch = Deno.env.get("DISCERN_MAIN_BRANCH") ||
    cfg.project.main_branch;
  // A green check on this exact clean HEAD already paid for every measurement and
  // recorded a measurement receipt; replay its values rather than measuring again.
  const reused = await reusableMeasurements(root, plan);
  const out = makeOut(colorEnabled(), { quiet: true });
  const { ok, results, outcomes, diagnostics } = reused !== undefined
    ? await replayExecutionFromReceipt(plan, reused, root, mainBranch)
    : await executeStandardPlan(plan, root, mainBranch, out);
  const reuseHint = reused !== undefined
    ? "Reused the green check's measurements for this commit — nothing was re-measured."
    : undefined;

  // A red standard blocks the whole pin: don't capture a state the gate wouldn't hold.
  if (!ok) {
    const failing = outcomes.filter((o) => !o.held).map((o) => o.standard.name);
    const named = failing.length > 0 ? failing.join(", ") : "a standard";
    return {
      ...appliedResult("standards", results, diagnostics),
      hints: [
        `Not pinning: ${named} ${
          failing.length === 1 ? "is" : "are"
        } failing (diagnostics[] carries each reason). Fix them, then re-run \`discern standards --pin\` once green.`,
      ],
    };
  }

  const considered = filter === undefined
    ? outcomes
    : outcomes.filter((o) => filter.has(o.standard.name));

  const pins: PinnedStandard[] = [];
  const steps: StepResult[] = [];
  for (const o of considered) {
    const r = o.standard;
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
    pins.push({ standard: r, measured: o.value, newLimit });
    steps.push(
      pinStep(
        r.name,
        `pinned ${bound} ${r.limit} → ${newLimit} (measured ${
          fmtRate(o.value)
        })`,
      ),
    );
  }

  if (pins.length === 0) {
    return {
      ...appliedResult("standards", steps),
      hints: [
        ...(reuseHint !== undefined ? [reuseHint] : []),
        "Nothing to pin — every standard asked for already sits at its measured value (within its margin).",
      ],
    };
  }

  const failure = await applyPinEdits(root, pins);
  if (failure !== undefined) {
    return {
      ok: false,
      verb: "standards",
      error: "pin_failed",
      message: failure,
    };
  }

  // The commit moved HEAD; carry an honored pre-pin vouch onto it so accept skips the
  // redundant gate re-run (the commit changed only standard limits — gate-neutral).
  const receipt = await carryReceiptForwardAcrossPin(
    root,
    priorReceipt?.status === "honored",
  );
  const carried = receipt?.status === "recorded";
  return {
    ...appliedResult("standards", steps),
    hints: [
      ...(reuseHint !== undefined ? [reuseHint] : []),
      carried
        ? "Carried the gate receipt forward — `discern accept` will skip the redundant gate re-run."
        : "No current gate receipt to carry forward — run `discern done` before accepting, or accept re-runs the gate.",
    ],
  };
}

/**
 * Compute the `standards` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders, and the source the CLI's `--json` serializes.
 * Slow and ON DEMAND: it runs every standard's measurement command (and a git read
 * of main's baseline), so it is NOT part of `done`. `dryRun` returns the plan
 * (no git, no measurement); an empty config is a clean pass. Non-dry-run checks
 * require a clean tree unless forced for standard authoring. Otherwise it applies
 * the plan QUIET — the measurement output flows through a silent Out so a caller
 * owning stdout (the MCP stdio channel) stays uncontaminated.
 *
 * With `pin`, it instead runs the pin pass (ADR 0106): measure, tighten each
 * asked-for limit that improved past its margin, commit that change alone, and carry
 * a gate receipt forward across it. `pinNames` restricts the pin to those
 * standards (empty = all with slack). `dryRun` previews without measuring in BOTH
 * modes; a green check's hints name any pinnable slack, so check → pin is the whole
 * flow.
 */
export async function standardsResult(
  root: string,
  opts: {
    dryRun?: boolean;
    force?: boolean;
    pin?: boolean;
    pinNames?: string[];
  } = {},
): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const plan = buildStandardPlan(cfg);
  let result: DiscernResult;
  if ((opts.pinNames?.length ?? 0) > 0 && !(opts.pin ?? false)) {
    // Names only mean something to the pin pass; a bare `standards <name>` would
    // otherwise silently check everything, ignoring what was asked for.
    result = {
      ok: false,
      verb: "standards",
      error: "invalid_args",
      message:
        "standard names only apply with --pin. Re-run as `discern standards --pin <name>…`, or drop the names to check every standard.",
    };
  } else if (opts.pin ?? false) {
    result = await pinStandardsResult(root, cfg, plan, {
      dryRun: opts.dryRun ?? false,
      names: opts.pinNames ?? [],
    });
  } else if (opts.dryRun ?? false) {
    result = previewResult("standards", standardPlanToEngine(plan));
  } else if (plan.standards.length === 0) {
    result = appliedResult("standards", []);
  } else {
    const dirtyMessage = (opts.force ?? false)
      ? undefined
      : await standardsCleanTreeMessage(root);
    if (dirtyMessage !== undefined) {
      result = {
        ok: false,
        verb: "standards",
        error: "dirty_worktree",
        message: dirtyMessage,
      };
    } else {
      const mainBranch = Deno.env.get("DISCERN_MAIN_BRANCH") ||
        cfg.project.main_branch;
      const out = makeOut(colorEnabled(), { quiet: true });
      // Pin the tree BEFORE the (slow) measurements run: the receipt may only vouch
      // for the exact tree they read, so a mid-measurement commit voids the stamp.
      const treePin = await pinValidatedTree(root);
      const execution = await executeStandardPlan(plan, root, mainBranch, out);
      const { results, outcomes, diagnostics } = execution;
      result = appliedResult("standards", results, diagnostics);
      // Green over a clean tree: record the measurement receipt a `--pin` on this
      // same clean HEAD reuses; red: clear any receipt (fail-closed).
      const receipted = await recordCheckMeasurements(root, execution, treePin);
      // A green check just paid for every measurement, so answer the natural next
      // question for free: which limits have pinnable slack. Decided by the SAME
      // pinnedLimit the pin pass applies, so this hint and a real pin can never
      // disagree — and a caller needs no (measuring) pin preview to find out.
      if (result.ok) {
        const slack = outcomes.flatMap((o) => {
          if (!o.held || o.value === undefined) {
            return [];
          }
          const r = o.standard;
          const newLimit = pinnedLimit(r.direction, o.value, r.margin, r.limit);
          if (newLimit === undefined) {
            return [];
          }
          const bound = r.direction === "up" ? "floor" : "ceiling";
          return [
            `${r.name} (${bound} ${r.limit}, measured ${
              fmtRate(o.value)
            } — would pin to ${newLimit})`,
          ];
        });
        if (slack.length > 0) {
          result.hints = [
            ...(result.hints ?? []),
            `Pinnable slack: ${
              slack.join("; ")
            }. Capture it with \`discern standards --pin\` — ${
              receipted
                ? "on this commit it reuses this check's measurements (measure once, pin once)"
                : "this check already measured, no pin dry-run needed"
            }.`,
          ];
        }
      }
    }
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): standards is
  // un-gated during setup, so its output must not read as a finished project.
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  if (inProgress !== undefined) {
    result.hints = [inProgress, ...(result.hints ?? [])];
  }
  return result;
}

/** Render a standards {@link DiscernResult} to the human console — the `--pin` path's
 * story is the result envelope (steps + hints), not the live measurement narration the
 * plain check path streams. */
function renderStandardsResult(result: DiscernResult): void {
  const out = makeOut(colorEnabled(), { quiet: false });
  if (result.plan !== undefined) {
    renderPlan(outSink(out), result.plan);
  }
  if ((result.steps ?? []).length > 0) {
    renderStepResults(outSink(out), {
      title: "Standard results",
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

/** Run `standards`. Returns a process exit code (non-zero if any standard failed). */
export async function runStandards(
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

  // --json (any mode), --pin, or bare standard names: the result envelope is the whole
  // story (ADR 0030) — compute it through the shared core, then emit (JSON) or render
  // it (human). Pinning measures and commits, so live measurement narration would only
  // bury the outcome; names without --pin route here so the shared guard fires.
  if (json || pin || pinNames.length > 0) {
    const result = await standardsResult(root, {
      dryRun,
      force,
      pin,
      pinNames,
    });
    if (json) {
      emitResult(result);
    } else {
      renderStandardsResult(result);
    }
    return result.ok ? 0 : 1;
  }

  // Human path: narrate live (each standard's measurement output flows through `out`).
  const cfg = await loadConfig(root);
  const out = makeOut(colorEnabled(), { quiet: false });
  const mainBranch = Deno.env.get("DISCERN_MAIN_BRANCH") ||
    cfg.project.main_branch;
  const plan = buildStandardPlan(cfg);

  // --dry-run: show the plan, touch nothing — no git, no measurement.
  if (dryRun) {
    renderPlan(outSink(out), standardPlanToEngine(plan));
    return 0;
  }

  if (plan.standards.length === 0) {
    out.info(
      "No standards configured. Add a [standards.<name>] table (e.g. [standards.coverage]).",
    );
    return 0;
  }

  if (!force) {
    const dirtyMessage = await standardsCleanTreeMessage(root);
    if (dirtyMessage !== undefined) {
      out.error(dirtyMessage);
      return 1;
    }
  }

  const treePin = await pinValidatedTree(root);
  const execution = await executeStandardPlan(plan, root, mainBranch, out);
  await recordCheckMeasurements(root, execution, treePin);
  const { results } = execution;
  const result = appliedResult("standards", results);
  renderStepResults(outSink(out), {
    title: "Standard results",
    steps: result.steps ?? [],
  });
  if (!result.ok) {
    out.error("One or more standards failed.");
    return 1;
  }
  out.ok(`All ${plan.standards.length} standard(s) held.`);
  return 0;
}

async function standardsCleanTreeMessage(
  root: string,
): Promise<string | undefined> {
  const status = await runGit(["status", "--porcelain", "-z"], { cwd: root });
  if (!status.success) {
    return "Standards require a clean worktree, but discern could not read git status. Fix the git status check and re-run `discern standards`; use `--force` only while authoring or debugging standards.";
  }
  if (status.stdout.trim() === "") {
    return undefined;
  }
  return "Standards require a clean worktree because they are slow final checks. Commit or stash changes, then re-run `discern standards`; use `--force` only while authoring or debugging standards.";
}

/** The clean-tree guard for `--pin`: pin commits the limit change on its own, so an
 * unclean tree would sweep unrelated edits into that commit. Unlike a plain check, no
 * `--force` escape — a dirty pin is never safe. Returns undefined when the tree is
 * clean. */
async function standardsPinCleanTreeMessage(
  root: string,
): Promise<string | undefined> {
  const status = await runGit(["status", "--porcelain", "-z"], { cwd: root });
  if (!status.success) {
    return "Pinning requires a clean worktree, but discern could not read git status. Fix the git status check and re-run `discern standards --pin`.";
  }
  if (status.stdout.trim() === "") {
    return undefined;
  }
  return "Pinning requires a clean worktree: it commits the limit change on its own, so any other edit would be swept into that commit. Commit or stash your changes, then re-run `discern standards --pin`.";
}
