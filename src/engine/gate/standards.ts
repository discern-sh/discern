/**
 * `standards` — check every metric standard (ADR 0003). Each `[standards.<name>]`
 * enforces two
 * halves: NEVER LOOSENED vs main (the limit compared to main's value — a floor
 * may only rise, a ceiling only fall) and MEASURED vs limit (run the command,
 * read the `DISCERN_METRIC <name> <number>` line — last wins). This is the
 * ON-DEMAND pass — the gate enforces both halves itself on every `done` run
 * (`standards_gate.ts`, ADR 0133); this verb ALWAYS measures (never replays),
 * covering deferred standards, explicit re-measurement, CI, and pinning.
 * Every structurally valid standard runs even if another fails.
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
 * re-running the measurements — re-checking only the never-loosen half from the
 * invocation's trunk snapshot, since that baseline can advance while HEAD stands
 * still.
 */

import {
  type DiscernConfig,
  type Extent,
  loadConfig,
} from "../../shared/config_schema.ts";
import { colorEnabled, makeOut, outSink } from "../output.ts";
import {
  buildStandardPlan,
  perNote,
  pinnedLimit,
  type PlannedStandard,
  standardJobLabel,
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
  type StepResult,
} from "../../shared/result.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
} from "../../shared/discern_commit.ts";
import { isAbsolute, join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "../../shared/env.ts";
import { TomlEditor } from "../../lib/toml_edit.ts";
import type {
  GateStandard,
  StandardsData,
} from "../../shared/result_schemas.ts";
import type { JobResult } from "../jobs/types.ts";
import type { RunOptions } from "../jobs/runner.ts";
import { type JobEvaluators, runGroup } from "./execute.ts";
import { buildTestRunSlots, type TestRunSlots } from "./test_slots.ts";
import { type JobGroup, type PlannedJob, serializeJobSteps } from "./plan.ts";
import {
  type TrunkLimitsVerification,
  verifyTrunkLimits,
} from "./standard_limits.ts";
import {
  type AdminStateWriteAuthority,
  carryReceiptForwardAcrossPin,
  clearStandardMeasurements,
  inspectGateReceipt,
  inspectStandardMeasurements,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordStandardMeasurements,
  type ValidatedTreePin,
} from "./receipt.ts";
import {
  preflightPlannedWrites,
  writePreflightDiagnostic,
  type WritePreflightFailure,
  writePreflightFailureMessage,
} from "../../shared/write_preflight.ts";
import { assertMainMerged } from "../worktree/git.ts";
import { writeDiscernToml } from "../../lib/tidy_format.ts";

export { readTrunkConfig, type TrunkConfigRead } from "./standard_limits.ts";

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
export function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** One standard check's verdict. On failure, `reason` carries the words the
 * result envelope and human renderer expose. Metric-reading failures also carry
 * the captured measurement `output`: the evidence for why no metric emerged. */
export interface StandardVerdict {
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
  /** The one-line pass summary, exactly as narrated; absent when it failed. */
  summary?: string;
  /** The failure reason, exactly as narrated; absent when the standard held. */
  reason?: string;
  /** The measurement command's captured output, when it is the failure's evidence. */
  output?: string;
  /** The command that reproduces the failure — the standard's own `run` when the
   * measurement is what failed or fell short; absent for the structural failures
   * (a loosened limit, a missing command), where re-running measures nothing. */
  reproduce_cmd?: string;
}

/**
 * Compare an already-known `value` to a standard's limit — the pure final third
 * of a standard's verdict, shared by a fresh measurement, the pin's receipt
 * replay, and the gate's input-keyed replay, so "past the limit" is decided by
 * ONE comparison (epsilon tolerance included) everywhere. `shown`/`breakdown`
 * carry the human rendering when the caller normalized a rate.
 */
export function compareValueToLimit(
  r: Pick<PlannedStandard, "name" | "metric" | "direction" | "limit" | "per">,
  value: number,
  shown: string,
  breakdown: string,
): StandardVerdict {
  const { name, metric, direction, limit, per } = r;
  if (direction === "up") {
    if (value + 1e-9 < limit) {
      return {
        held: false,
        value,
        reason:
          `standard '${name}': ${metric} ${shown} is below the floor ${limit}${breakdown}. ` +
          `Raise it within the scope of your task; never lower the floor. ` +
          `If the work itself shrank what this measures, stop and report the breach — ` +
          `moving a limit is an owner decision taken on the trunk, and propping the ` +
          `number up with unrelated changes is worse than the breach.`,
      };
    }
    return {
      held: true,
      value,
      summary:
        `standard '${name}': ${metric} ${shown} meets the floor ${limit}${breakdown}.`,
    };
  }
  if (value - 1e-9 > limit) {
    // A raw-count ceiling that a growing tree can breach on its own is the classic
    // trap — point at the fix the moment it bites.
    const growHint = per === undefined
      ? " If this counts items over a tree you grow, it rises with size — hold a rate instead (add `per`)."
      : "";
    return {
      held: false,
      value,
      reason:
        `standard '${name}': ${metric} ${shown} exceeds the ceiling ${limit}${breakdown}. ` +
        `Bring it down within the scope of your task; never raise the ceiling. ` +
        `If the work itself grew what this measures, stop and report the breach — ` +
        `moving a limit is an owner decision taken on the trunk, and offsetting the ` +
        `number with unrelated changes is worse than the breach.${growHint}`,
    };
  }
  return {
    held: true,
    value,
    summary:
      `standard '${name}': ${metric} ${shown} within the ceiling ${limit}${breakdown}.`,
  };
}

/**
 * Judge one standard from its measurement command's captured `output` — the
 * metric read, the optional `per` normalization, and the limit comparison,
 * with no narration and no subprocess beyond a `per` extent count. The ONE
 * evaluation behind the standalone verb's check and the gate's measurement
 * jobs, so a metric means the same thing wherever it was measured.
 */
export async function evaluateMeasuredOutput(
  r: PlannedStandard,
  output: string,
  root: string,
): Promise<StandardVerdict> {
  const { name, metric, per, scale, command } = r;
  const measuredStr = extractMetric(output, metric);
  if (measuredStr === undefined) {
    return {
      held: false,
      reason:
        `standard '${name}': could not read metric '${metric}'. Emit a line: DISCERN_METRIC ${metric} <number>.`,
      output,
      reproduce_cmd: command,
    };
  }
  if (!isNumber(measuredStr)) {
    return {
      held: false,
      reason:
        `standard '${name}': metric '${metric}' value is not a number: '${measuredStr}'.`,
      output,
      reproduce_cmd: command,
    };
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
        return {
          held: false,
          reason:
            `standard '${name}': could not read 'per' metric '${per.metric}'. Emit a line: DISCERN_METRIC ${per.metric} <number>.`,
          output,
          reproduce_cmd: command,
        };
      }
      denom = d;
    } else {
      denom = await measureExtent(root, per.measure, per.globs);
    }
    if (denom <= 0) {
      const what = per.kind === "metric"
        ? `'per' metric '${per.metric}' is ${denom}`
        : `${per.measure} over ${per.globs.join(", ")} measured 0`;
      return {
        held: false,
        reason:
          `standard '${name}': cannot calculate a rate — ${what} (nothing to divide by). Check the 'per' pathspec/metric.`,
      };
    }
    value = (measured / denom) * scale;
    breakdown = ` (${measuredStr} per ${denom}${
      per.kind === "extent" ? ` ${per.measure}` : ""
    }${scale === 1 ? "" : ` ×${scale}`})`;
  }
  const shown = per !== undefined ? fmtRate(value) : measuredStr;
  const verdict = compareValueToLimit(r, value, shown, breakdown);
  return verdict.held ? verdict : { ...verdict, reproduce_cmd: command };
}

/** What one standard's shared job should do. The gate may replay or defer;
 * standalone standards always supplies `measure`. */
export type StandardAction =
  | { kind: "measure" }
  | { kind: "replay"; value: number; from: string }
  | { kind: "defer" };

/** One planned standard paired with its resolved action. */
export interface ResolvedStandard {
  standard: PlannedStandard;
  action: StandardAction;
}

/** A holding value's standing against the current limit. */
function heldVerdict(
  standard: PlannedStandard,
  value: number,
): "improved" | "held" {
  const better = standard.direction === "up"
    ? value - 1e-9 > standard.limit
    : value + 1e-9 < standard.limit;
  return better ? "improved" : "held";
}

/** Project one resolved standard into the scheduler's planned-job shape. */
export function plannedStandardJob(
  standard: PlannedStandard,
  action: StandardAction,
  label: string = standardJobLabel(standard.name),
): PlannedJob {
  if (action.kind === "defer") {
    return {
      label,
      command: standard.command,
      kind: "standard",
      reportStage: "test",
      willRun: false,
      note:
        'measurement deferred (measure = "on-demand") — run `discern standards`',
    };
  }
  if (action.kind === "replay") {
    return {
      label,
      command: standard.command,
      kind: "standard",
      reportStage: "test",
      willRun: false,
      note: `${standard.direction}, limit ${standard.limit}, measured ${
        fmtRate(action.value)
      } — replayed from ${action.from.slice(0, 7)} (inputs unchanged)`,
    };
  }
  return {
    label,
    command: standard.command,
    kind: "standard",
    reportStage: "test",
    willRun: true,
    ...(standard.timeoutS !== undefined ? { timeoutS: standard.timeoutS } : {}),
  };
}

/** The shared job projection consumed by the gate's mixed check/test group and
 * by the standalone verb's standards-only parallel group. */
export interface StandardJobs {
  jobs: PlannedJob[];
  evaluators: JobEvaluators;
  synthesized: Map<string, JobResult>;
  outcomes: Map<string, GateStandard>;
  /** Full metric verdicts retained for standalone envelope rendering. */
  verdicts: Map<string, StandardVerdict>;
}

/**
 * Build the one set of measurement jobs and evaluators used by both execution
 * surfaces. The gate keeps its `standard:` scheduler namespace; standalone
 * passes a plain-name labeler so its established result labels stay unchanged.
 */
export function buildStandardJobs(
  root: string,
  resolved: ResolvedStandard[],
  opts: { jobLabel?: (name: string) => string } = {},
): StandardJobs {
  const jobs: PlannedJob[] = [];
  const evaluators: JobEvaluators = new Map();
  const synthesized = new Map<string, JobResult>();
  const outcomes = new Map<string, GateStandard>();
  const verdicts = new Map<string, StandardVerdict>();
  const labelFor = opts.jobLabel ?? standardJobLabel;

  for (const { standard, action } of resolved) {
    const label = labelFor(standard.name);
    const base = {
      name: standard.name,
      direction: standard.direction,
      limit: standard.limit,
    };
    jobs.push(plannedStandardJob(standard, action, label));
    if (action.kind === "defer") {
      outcomes.set(standard.name, { ...base, measurement: "deferred" });
      continue;
    }
    if (action.kind === "replay") {
      const verdict = compareValueToLimit(
        standard,
        action.value,
        fmtRate(action.value),
        "",
      );
      verdicts.set(standard.name, verdict);
      const shortSha = action.from.slice(0, 7);
      synthesized.set(label, {
        label,
        status: verdict.held ? "ok" : "failed",
        code: verdict.held ? 0 : 1,
        durationS: 0,
        outputLines: 0,
        errorLikeLines: 0,
        ...(verdict.held ? {} : {
          failureMessage: `${
            verdict.reason ?? `standard '${standard.name}' failed.`
          } (value replayed from ${shortSha} — inputs unchanged; the limit tightened past it on this branch)`,
        }),
      });
      outcomes.set(standard.name, {
        ...base,
        measurement: "replayed",
        value: action.value,
        replayed_from: action.from,
        ...(verdict.held
          ? { verdict: heldVerdict(standard, action.value) }
          : { verdict: "regressed" as const }),
      });
      continue;
    }

    outcomes.set(standard.name, { ...base, measurement: "skipped" });
    evaluators.set(label, async (result: JobResult): Promise<JobResult> => {
      const verdict: StandardVerdict = standard.command === ""
        ? {
          held: false,
          reason:
            `standard '${standard.name}' has no run command (set run = "<command>" under [standards.${standard.name}]).`,
        }
        : await evaluateMeasuredOutput(standard, result.output ?? "", root);
      verdicts.set(standard.name, verdict);
      outcomes.set(standard.name, {
        ...base,
        measurement: "measured",
        duration_s: result.durationS,
        ...(verdict.value !== undefined ? { value: verdict.value } : {}),
        ...(verdict.held && verdict.value !== undefined
          ? { verdict: heldVerdict(standard, verdict.value) }
          : {}),
        ...(!verdict.held && verdict.value !== undefined
          ? { verdict: "regressed" as const }
          : {}),
      });
      if (verdict.held) {
        const { output: _output, ...rest } = result;
        return { ...rest, status: "ok", code: 0 };
      }
      return {
        ...result,
        status: "failed",
        code: result.code === 0 ? 1 : result.code,
        failureMessage: verdict.reason ??
          `standard '${standard.name}' failed.`,
      };
    });
  }
  return { jobs, evaluators, synthesized, outcomes, verdicts };
}

/** One standard's measured outcome, carried alongside its {@link StepResult} so the
 * `--pin` pass can read the value the check computed without measuring a second time. */
interface StandardOutcome {
  standard: PlannedStandard;
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
  /** Whole-second scheduler duration for a fresh measurement. */
  durationS?: number;
}

/** The outcome of applying a standard plan: whether all held, the per-step
 * results, the per-standard measured outcomes the pin pass reads, the
 * envelope-facing readings (`GateData.standards`' shape, so both surfaces
 * report standards identically), and one diagnostic per failure carrying its
 * reason. */
interface StandardExecution {
  ok: boolean;
  results: StepResult[];
  outcomes: StandardOutcome[];
  readings: GateStandard[];
  diagnostics: Diagnostic[];
}

/** Represent a plan-to-step cardinality mismatch as a failed internal step. */
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

/** Refuse execution when projected standard steps differ from the plan. */
export function standardPlanIntegrityFailure(
  plan: StandardPlan,
  steps: readonly PlanStep[],
): StepResult | undefined {
  return steps.length === plan.standards.length
    ? undefined
    : standardPlanIntegrityResult(plan, steps);
}

/** Convert Tier-1 diagnostics from the gate's scheduler namespace to the plain
 * labels and reproduce command the standalone result has always exposed. */
function standaloneVerificationDiagnostics(
  verification: TrunkLimitsVerification,
): Diagnostic[] {
  const prefix = standardJobLabel("");
  return verification.diagnostics.map((diagnostic) =>
    diagnostic.tool.startsWith(prefix)
      ? {
        ...diagnostic,
        tool: diagnostic.tool.slice(prefix.length),
        reproduce_cmd: "discern standards",
      }
      : diagnostic
  );
}

/** Synthetic standalone steps for deleted standards and global trunk-parse
 * failures, neither of which has a branch measurement job to serialize. */
function standaloneVerificationSteps(
  plan: StandardPlan,
  verification: TrunkLimitsVerification,
): StepResult[] {
  const configured = new Set(plan.standards.map((standard) => standard.name));
  const diagnostics = standaloneVerificationDiagnostics(verification);
  const steps: StepResult[] = [];
  const globalFailure = diagnostics.find((diagnostic) =>
    diagnostic.tool === "standards"
  );
  if (globalFailure !== undefined) {
    steps.push({
      step: {
        kind: "standards-limits-check",
        label: "trunk-limits",
        disposition: "gate",
        note: globalFailure.message,
      },
      outcome: "failed",
    });
  }
  for (const name of verification.blockedStandards) {
    if (configured.has(name)) {
      continue;
    }
    steps.push({
      step: {
        kind: "standard",
        label: name,
        disposition: "gate",
        note: "deleted on this branch; restore its trunk limit",
      },
      outcome: "failed",
    });
  }
  return steps;
}

/** Build one applied note without losing the established `measured <value>`
 * token. Holding summaries ride after it so human output can render from the
 * same envelope without live parallel narration. */
function standaloneMeasurementNote(
  planned: PlanStep,
  outcome: GateStandard | undefined,
  verdict: StandardVerdict | undefined,
): string | undefined {
  const parts: string[] = [];
  if (planned.note !== undefined) {
    parts.push(planned.note);
  }
  if (outcome?.value !== undefined) {
    parts.push(`measured ${fmtRate(outcome.value)}`);
  }
  if (verdict?.held === true && verdict.summary !== undefined) {
    parts.push(verdict.summary);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Apply a standard plan through the same parallel job pipeline as the gate.
 * Tier 1 is the caller's one upfront snapshot. Structurally blocked standards
 * skip their own command; every other command runs with fail-fast disabled,
 * per-job timeout overrides, tree-kill cancellation, and captured durations.
 * `opts.slots` is the fleet test-run cap: the measurement group draws one slot
 * through the shared {@link runGroup} seam, like the gate's own test group.
 */
async function executeStandardPlan(
  plan: StandardPlan,
  root: string,
  verification: TrunkLimitsVerification,
  opts: {
    timeoutS: number;
    slots: TestRunSlots | undefined;
    signal?: AbortSignal;
  },
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
    return {
      ok: false,
      results: [mismatch],
      outcomes: [],
      readings: [],
      diagnostics: [integrityDiagnostic(mismatch)],
    };
  }
  const runnable = plan.standards.filter((standard) =>
    !verification.blockedStandards.has(standard.name)
  );
  const jobs = buildStandardJobs(
    root,
    runnable.map((standard) => ({
      standard,
      action: { kind: "measure" as const },
    })),
    { jobLabel: (name) => name },
  );
  const plannedByName = new Map(steps.map((step) => [step.label, step]));
  for (const job of jobs.jobs) {
    const note = plannedByName.get(job.label)?.note;
    if (note !== undefined) {
      job.note = note;
    }
  }
  const group: JobGroup = {
    stage: "standards",
    mode: "parallel",
    heading: "Measuring standards...",
    display: "",
    jobs: jobs.jobs,
  };
  const jobResults = new Map<string, JobResult>();
  const runOpts: RunOptions = {
    cwd: root,
    stream: false,
    failFast: false,
    timeoutS: opts.timeoutS,
    color: colorEnabled(),
    quiet: true,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  const runnerOk = await runGroup(
    group,
    jobResults,
    runOpts,
    makeOut(runOpts.color, { quiet: true }),
    opts.slots,
    jobs.evaluators,
  );
  const serialized = await serializeJobSteps([group], jobResults);
  const executedByName = new Map(
    serialized.steps.map((result) => [result.step.label, result]),
  );

  const results: StepResult[] = [];
  const outcomes: StandardOutcome[] = [];
  let integrityFailed = false;
  for (let i = 0; i < plan.standards.length; i++) {
    const standard = plan.standards[i];
    const step = steps[i];
    if (standard === undefined || step === undefined) {
      const failure = standardPlanIntegrityResult(plan, steps);
      results.push(failure);
      integrityFailed = true;
      break;
    }
    if (verification.blockedStandards.has(standard.name)) {
      results.push({ step, outcome: "failed" });
      outcomes.push({ standard, held: false });
      continue;
    }
    const executed = executedByName.get(standard.name);
    if (executed === undefined) {
      const failure = standardPlanIntegrityResult(
        plan,
        serialized.steps.map((result) => result.step),
      );
      results.push(failure);
      integrityFailed = true;
      break;
    }
    const { group: _group, ...plainStep } = executed.step;
    const outcome = jobs.outcomes.get(standard.name);
    const verdict = jobs.verdicts.get(standard.name);
    const note = standaloneMeasurementNote(step, outcome, verdict);
    results.push({
      ...executed,
      step: {
        ...plainStep,
        ...(note !== undefined ? { note } : {}),
      },
    });
    const durationS = jobResults.get(standard.name)?.durationS;
    outcomes.push({
      standard,
      held: executed.outcome === "ok",
      ...(outcome?.value !== undefined ? { value: outcome.value } : {}),
      ...(durationS !== undefined ? { durationS } : {}),
    });
  }
  results.push(...standaloneVerificationSteps(plan, verification));
  const diagnostics = [
    ...standaloneVerificationDiagnostics(verification),
    ...serialized.diagnostics,
    ...(integrityFailed
      ? [integrityDiagnostic(standardPlanIntegrityResult(plan, steps))]
      : []),
  ];
  // The envelope-facing readings, in plan order: the evaluators filled
  // `jobs.outcomes` as measurements settled; a standard the runnable set never
  // held (blocked by the never-loosen verification) reads as skipped.
  const readings: GateStandard[] = plan.standards.map((standard) =>
    jobs.outcomes.get(standard.name) ?? {
      name: standard.name,
      direction: standard.direction,
      limit: standard.limit,
      measurement: "skipped" as const,
    }
  );
  return {
    ok: !verification.blocking && runnerOk && !integrityFailed,
    results,
    outcomes,
    readings,
    diagnostics,
  };
}

/** Convert an execution to the verb envelope. The explicit `ok` assignment is
 * what keeps an externally-cancelled all-skipped run red. The readings ride
 * `data.standards` — the same shape the gate reports — so downstream consumers
 * (the logbook recorder included) read one vocabulary from both surfaces. */
function standardExecutionResult(execution: StandardExecution): DiscernResult {
  const { results, diagnostics } = execution;
  const result = appliedResult("standards", results);
  result.ok = execution.ok;
  if (diagnostics.length > 0) {
    result.diagnostics = diagnostics;
  }
  if (execution.readings.length === 0) {
    return result;
  }
  return {
    ...result,
    data: { standards: execution.readings } satisfies StandardsData,
  };
}

/** Route a plain check's outcome into the measurement receipt: green over a clean
 * tree records every measured value against the HEAD pinned before the measurements
 * ran (for a `--pin` on that same clean HEAD to reuse), red clears any receipt
 * (fail-closed). The caller already preflighted `authority`; the writer remains
 * best-effort only against a later point-in-time failure. Returns whether a
 * reusable receipt now exists. */
async function recordCheckMeasurements(
  root: string,
  authority: AdminStateWriteAuthority,
  execution: StandardExecution,
  pin: ValidatedTreePin,
): Promise<boolean> {
  if (!execution.ok) {
    await clearStandardMeasurements(root, authority);
    return false;
  }
  const values: Record<string, number> = {};
  const durations: Record<string, number> = {};
  for (const o of execution.outcomes) {
    if (o.value === undefined) {
      return false;
    }
    values[o.standard.name] = o.value;
    if (o.durationS !== undefined) {
      durations[o.standard.name] = o.durationS;
    }
  }
  return await recordStandardMeasurements(
    root,
    authority,
    values,
    pin,
    durations,
  );
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
 * Rebuild a {@link StandardExecution} from the measurement receipt's values.
 * The caller's one Tier-1 snapshot supplies the live never-loosen verdict; the
 * measured-vs-limit half needs no rerun because the same clean HEAD fixes both
 * the values and limits, and only an all-green check records a receipt.
 */
function replayExecutionFromReceipt(
  plan: StandardPlan,
  values: Record<string, number>,
  verification: TrunkLimitsVerification,
): StandardExecution {
  const results: StepResult[] = [];
  const outcomes: StandardOutcome[] = [];
  const readings: GateStandard[] = [];
  const diagnostics = standaloneVerificationDiagnostics(verification);
  let ok = !verification.blocking;
  for (const standard of plan.standards) {
    const value = values[standard.name];
    if (value === undefined) {
      // Unreachable — the caller replays only a receipt naming every planned
      // standard — but fail closed as a plain failure rather than pinning blind.
      ok = false;
      const reason =
        `standard '${standard.name}': the measurement receipt carries no value for it. Re-run \`discern standards\` to measure.`;
      results.push({
        step: { kind: "standard", label: standard.name, disposition: "run" },
        outcome: "failed",
      });
      outcomes.push({ standard, held: false });
      readings.push({
        name: standard.name,
        direction: standard.direction,
        limit: standard.limit,
        measurement: "skipped",
      });
      diagnostics.push({
        tool: standard.name,
        severity: "error",
        message: reason,
        reproduce_cmd: "discern standards",
      });
      continue;
    }
    const held = !verification.blockedStandards.has(standard.name);
    results.push({
      step: {
        kind: "standard",
        label: standard.name,
        disposition: "run",
        note: `${standard.direction}, limit ${standard.limit}${
          perNote(standard.per, standard.scale)
        }, measured ${fmtRate(value)} (reused from the green check)`,
      },
      outcome: held ? "ok" : "failed",
    });
    outcomes.push({ standard, held, value });
    readings.push({
      name: standard.name,
      direction: standard.direction,
      limit: standard.limit,
      measurement: "replayed",
      value,
      ...(held ? { verdict: heldVerdict(standard, value) } : {}),
    });
    if (!held) {
      ok = false;
    }
  }
  results.push(...standaloneVerificationSteps(plan, verification));
  return { ok, results, outcomes, readings, diagnostics };
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

/** Preserve an Error message and stringify non-Error standards failures. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Re-verify the exact clean tree captured before a pin read or measured values.
 * A mismatch is reported before {@link applyPinEdits} can write anything. */
async function pinTreeChangeMessage(
  root: string,
  pin: ValidatedTreePin,
): Promise<string | undefined> {
  const recovery =
    "Settle the worktree at the commit you want to measure, then re-run `discern standards --pin`.";
  if (pin.head === undefined) {
    return "Couldn't pin the measured limits because discern could not read HEAD before the pin began. " +
      recovery;
  }
  if (!pin.clean) {
    const paths = pin.dirtyPaths.length > 0
      ? ` Uncommitted paths: ${pin.dirtyPaths.join(", ")}.`
      : "";
    return `Couldn't pin the measured limits because the worktree changed before the pin began.${paths} ${recovery}`;
  }

  const current = await pinValidatedTree(root);
  if (current.head === undefined) {
    return "Couldn't pin the measured limits because discern could not read HEAD after measuring. " +
      recovery;
  }
  if (current.head !== pin.head) {
    return `Couldn't pin the measured limits because HEAD moved while the pin was running (started at ${pin.head}, now ${current.head}). ${recovery}`;
  }
  if (!current.clean) {
    const paths = current.dirtyPaths.length > 0
      ? ` Uncommitted paths: ${current.dirtyPaths.join(", ")}.`
      : " Git status could not confirm that the worktree was clean.";
    return `Couldn't pin the measured limits because the worktree changed while the pin was running.${paths} ${recovery}`;
  }
  return undefined;
}

/** A successful preflight for every built-in mutation `standards --pin` may
 * perform after measuring: validation-state markers, discern.toml, and Git's
 * common metadata for the commit. The brand forces the mutator to consume it. */
declare const PIN_WRITE_AUTHORITY: unique symbol;
interface PinWriteAuthority {
  readonly root: string;
  readonly configRel: string;
  readonly configPath: string;
  readonly admin: AdminStateWriteAuthority;
  readonly [PIN_WRITE_AUTHORITY]: true;
}

type PinWritePreflight =
  | { ok: true; authority: PinWriteAuthority }
  | WritePreflightFailure;

/** Resolve Git-reported relative paths against the repository root. */
function absoluteFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/** Probe the complete predictable write surface before a pin pays for any metric.
 * Git itself uses create+rename lockfiles, represented by the common-dir probe. */
async function preflightPinWrites(root: string): Promise<PinWritePreflight> {
  const admin = await preflightAdminStateWrites(root);
  if (!admin.ok) {
    return admin;
  }
  const configRel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const configPath = join(root, configRel);
  const common = await runGit(["rev-parse", "--git-common-dir"], { cwd: root });
  const commonRaw = common.stdout.trim();
  if (!common.success || commonRaw === "") {
    return {
      ok: false,
      path: root,
      description: "the Git metadata needed to commit pinned limits",
      reason: common.stderr.trim() ||
        "Git could not resolve its common directory",
    };
  }
  const commonDir = absoluteFromRoot(root, commonRaw);
  const probed = await preflightPlannedWrites([
    {
      kind: "existing-file",
      path: configPath,
      description: configRel,
    },
    {
      kind: "directory-entry",
      path: commonDir,
      description: "the Git metadata needed to commit pinned limits",
    },
  ]);
  if (!probed.ok) {
    return probed;
  }
  return {
    ok: true,
    authority: {
      root,
      configRel,
      configPath,
      admin: admin.authority,
    } as PinWriteAuthority,
  };
}

/** Return the shared write-preflight refusal with a reproducible diagnostic. */
function standardsWriteAccessFailure(
  failure: WritePreflightFailure,
  reproduceCmd: string,
): DiscernResult {
  return {
    ok: false,
    verb: "standards",
    error: "write_access",
    message: writePreflightFailureMessage(failure),
    diagnostics: [writePreflightDiagnostic(failure, reproduceCmd)],
  };
}

/** The re-pin commit message: an imperative subject and a body listing each limit's
 * old→new and the measurement behind it, so `git log` explains why the bound moved. */
function pinCommitMessage(
  pins: PinnedStandard[],
): { subject: string; body: string } {
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
  return {
    subject,
    body:
      "Capture a measured improvement so it cannot regress. `discern standards`\n" +
      "measured these metrics past their limits; `--pin` tightens each limit to\n" +
      "the measured value, leaving any configured margin of headroom:\n\n" +
      body,
  };
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
  authority: PinWriteAuthority,
): Promise<string | undefined> {
  if (authority.root !== root) {
    return "the pin write-authority token belongs to a different worktree";
  }
  const rel = authority.configRel;
  const path = authority.configPath;
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
    await writeDiscernToml(path, editor.toString());
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
  const commit = await commitDiscernChanges({
    site: DISCERN_AUTHORED_COMMIT_SITES.standardsPin,
    cwd: root,
    ...pinCommitMessage(pins),
    pathspecs: [rel],
  });
  if (!commit.success) {
    return await failWithRollback(
      `could not commit the re-pin: ${commit.stderr.trim()}`,
    );
  }
  return undefined;
}

interface StandardsResultBuild {
  result: DiscernResult;
  firedHints: FiredHint[];
}

/** Pair a standards result with the fired hints its surface must observe. */
function standardsBuild(
  result: DiscernResult,
  firedHints: FiredHint[] = [],
): StandardsResultBuild {
  return { result, firedHints };
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
  opts: {
    dryRun: boolean;
    names: string[];
    verification?: TrunkLimitsVerification;
    signal?: AbortSignal;
  },
): Promise<StandardsResultBuild> {
  if (
    plan.standards.length === 0 &&
    !(opts.verification?.blocking ?? false)
  ) {
    return standardsBuild(appliedResult("standards", []), [
      fire(HINTS["standards-pin-empty"]),
    ]);
  }

  // A named standard that doesn't exist would otherwise pin nothing, silently.
  const known = new Set(plan.standards.map((r) => r.name));
  const unknown = opts.names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    return standardsBuild({
      ok: false,
      verb: "standards",
      error: "unknown_standard",
      message: `no standard named ${
        unknown.join(", ")
      }. Configured standards: ${[...known].join(", ")}.`,
    });
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
    return standardsBuild(
      previewResult("standards", {
        title: "Pin plan",
        details: [],
        steps,
      }),
      [
        fire(HINTS["standards-pin-dry-run"]),
      ],
    );
  }

  // Pinning writes and commits, so it needs a clean tree.
  const dirty = await standardsPinCleanTreeMessage(root);
  if (dirty !== undefined) {
    return standardsBuild({
      ok: false,
      verb: "standards",
      error: "dirty_worktree",
      message: dirty,
    });
  }

  const writePreflight = await preflightPinWrites(root);
  if (!writePreflight.ok) {
    return standardsBuild(
      standardsWriteAccessFailure(
        writePreflight,
        "discern standards --pin",
      ),
    );
  }
  const writeAuthority = writePreflight.authority;

  // Pin the tree before any measurement receipt is read or measurement runs. The
  // mutation below re-validates this exact HEAD and full cleanliness immediately
  // before writing, so limits can only describe the tree that supplied the values.
  const treePin = await pinValidatedTree(root);

  // Capture the pre-pin vouch BEFORE anything changes: only an honored receipt may be
  // carried across the commit we are about to make (ADR 0106 / 0067).
  const priorReceipt = await inspectGateReceipt(root);

  const verification = opts.verification;
  if (verification === undefined) {
    throw new Error(
      "internal error: a real standards pin has no trunk-limits verification",
    );
  }
  // A green check on this exact clean HEAD already paid for every measurement and
  // recorded a measurement receipt; replay its values rather than measuring again.
  const reused = await reusableMeasurements(root, plan);
  const slots = buildTestRunSlots(root, cfg);
  const execution = reused !== undefined
    ? replayExecutionFromReceipt(plan, reused, verification)
    : await executeStandardPlan(plan, root, verification, {
      timeoutS: cfg.gate.timeout,
      slots,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  const slotWaits = slots?.waits ?? [];
  const { ok, outcomes } = execution;
  const reuseHint = reused !== undefined
    ? fire(HINTS["standards-pin-reused-measurements"])
    : undefined;

  // A red standard blocks the whole pin: don't capture a state the gate wouldn't hold.
  if (!ok) {
    const failing = outcomes.filter((o) => !o.held).map((o) => o.standard.name);
    return standardsBuild(standardExecutionResult(execution), [
      ...slotWaits,
      fire(HINTS["standards-pin-blocked"], { failingNames: failing }),
    ]);
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
    return standardsBuild({
      ...appliedResult("standards", steps),
      ...(execution.readings.length > 0
        ? { data: { standards: execution.readings } satisfies StandardsData }
        : {}),
    }, [
      ...slotWaits,
      ...(reuseHint !== undefined ? [reuseHint] : []),
      fire(HINTS["standards-pin-no-slack"]),
    ]);
  }

  const treeChanged = await pinTreeChangeMessage(root, treePin);
  if (treeChanged !== undefined) {
    return standardsBuild({
      ok: false,
      verb: "standards",
      error: "pin_failed",
      message: treeChanged,
    });
  }
  const failure = await applyPinEdits(root, pins, writeAuthority);
  if (failure !== undefined) {
    return standardsBuild({
      ok: false,
      verb: "standards",
      error: "pin_failed",
      message: failure,
    });
  }

  // The commit moved HEAD; carry an honored pre-pin vouch onto it so accept skips the
  // redundant gate re-run (the commit changed only standard limits — gate-neutral).
  const receipt = await carryReceiptForwardAcrossPin(
    root,
    writeAuthority.admin,
    priorReceipt?.status === "honored",
  );
  const carried = receipt?.status === "recorded";
  return standardsBuild({
    ...appliedResult("standards", steps),
    data: {
      ...(execution.readings.length > 0
        ? { standards: execution.readings }
        : {}),
      pinned: pins.map((p) => ({
        name: p.standard.name,
        from: p.standard.limit,
        to: p.newLimit,
        measured: p.measured,
      })),
    } satisfies StandardsData,
  }, [
    ...slotWaits,
    ...(reuseHint !== undefined ? [reuseHint] : []),
    carried
      ? fire(HINTS["standards-pin-carried-receipt"])
      : fire(HINTS["standards-pin-no-receipt"]),
  ]);
}

/** Fire an advisory only when the trunk limits could not be verified. */
function unverifiedTrunkHint(
  verification: TrunkLimitsVerification,
): FiredHint | undefined {
  return verification.summary.status === "unverified"
    ? fire(HINTS["standards-limits-unverified"], {
      reason: verification.summary.reason,
    })
    : undefined;
}

/**
 * Compute the `standards` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders, and the source the CLI's `--json` serializes.
 * The on-demand pass reads the trunk baseline once, then runs every unblocked
 * measurement fresh in one parallel, fail-fast-off group. Each job carries its
 * timeout and the caller's cancellation signal into the shared runner. `dryRun`
 * returns the plan with no git or measurement; an empty config is a clean pass.
 * Non-dry checks require a clean tree unless forced for standard authoring. The
 * executor stays quiet so the result envelope remains the only rendering source.
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
    signal?: AbortSignal;
  } = {},
): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const plan = buildStandardPlan(cfg);
  let result: DiscernResult;
  const firedHints: FiredHint[] = [];
  let verification: TrunkLimitsVerification | undefined;
  const unpinnedNames = (opts.pinNames?.length ?? 0) > 0 &&
    !(opts.pin ?? false);
  if (!unpinnedNames && !(opts.dryRun ?? false)) {
    const mainBranch = Deno.env.get("DISCERN_TRUNK") ||
      cfg.repository.trunk;
    verification = await verifyTrunkLimits(
      root,
      mainBranch,
      plan.standards,
    );
  }
  if (unpinnedNames) {
    // Names only mean something to the pin pass; a bare `standards <name>` would
    // otherwise silently check everything, ignoring what was asked for.
    result = {
      ok: false,
      verb: "standards",
      error: "invalid_arguments",
      message:
        "standard names only apply with --pin. Re-run as `discern standards --pin <name>…`, or drop the names to check every standard.",
    };
  } else if (opts.pin ?? false) {
    let behindHint: FiredHint | undefined;
    if (!(opts.dryRun ?? false)) {
      const mainBranch = Deno.env.get("DISCERN_TRUNK") ||
        cfg.repository.trunk;
      const merged = await assertMainMerged(root, mainBranch);
      if (merged.kind === "behind") {
        behindHint = fire(HINTS["standards-pin-behind"], {
          behind: merged.behind,
          trunk: mainBranch,
        });
      }
    }
    const built = await pinStandardsResult(root, cfg, plan, {
      dryRun: opts.dryRun ?? false,
      names: opts.pinNames ?? [],
      ...(verification !== undefined ? { verification } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    result = built.result;
    firedHints.push(...built.firedHints);
    if (behindHint !== undefined) {
      firedHints.push(behindHint);
    }
  } else if (opts.dryRun ?? false) {
    result = previewResult("standards", standardPlanToEngine(plan));
  } else {
    if (verification === undefined) {
      throw new Error(
        "internal error: a real standards run has no trunk-limits verification",
      );
    }
    if (plan.standards.length === 0 && !verification.blocking) {
      result = appliedResult("standards", []);
      firedHints.push(fire(HINTS["standards-none-configured"]));
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
        const writePreflight = await preflightAdminStateWrites(root);
        if (!writePreflight.ok) {
          result = standardsWriteAccessFailure(
            writePreflight,
            "discern standards",
          );
        } else {
          // Pin the tree before the measurements: the receipt may only vouch for
          // the exact tree the parallel jobs read.
          const treePin = await pinValidatedTree(root);
          const slots = buildTestRunSlots(root, cfg);
          const execution = await executeStandardPlan(
            plan,
            root,
            verification,
            {
              timeoutS: cfg.gate.timeout,
              slots,
              ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
            },
          );
          firedHints.push(...(slots?.waits ?? []));
          const { outcomes } = execution;
          result = standardExecutionResult(execution);
          const receipted = await recordCheckMeasurements(
            root,
            writePreflight.authority,
            execution,
            treePin,
          );
          if (result.ok) {
            const slack = outcomes.flatMap((o) => {
              if (!o.held || o.value === undefined) {
                return [];
              }
              const standard = o.standard;
              const newLimit = pinnedLimit(
                standard.direction,
                o.value,
                standard.margin,
                standard.limit,
              );
              if (newLimit === undefined) {
                return [];
              }
              const bound: "floor" | "ceiling" = standard.direction === "up"
                ? "floor"
                : "ceiling";
              return [
                {
                  name: standard.name,
                  bound,
                  limit: standard.limit,
                  measured: fmtRate(o.value),
                  newLimit,
                },
              ];
            });
            if (slack.length > 0) {
              firedHints.push(
                fire(HINTS["standards-pinnable-slack"], {
                  standards: slack,
                  receipted,
                }),
              );
            }
          }
        }
      }
    }
  }
  if (verification !== undefined) {
    const warning = unverifiedTrunkHint(verification);
    if (warning !== undefined) {
      firedHints.push(warning);
    }
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): standards is
  // un-gated during setup, so its output must not read as a finished project.
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  if (inProgress !== undefined) {
    firedHints.unshift(inProgress);
  }
  if (firedHints.length > 0) {
    result.hints = hintTexts(firedHints);
  }
  return result;
}

/** Render every human standards surface from the same quiet execution envelope. */
function renderStandardsResult(
  result: DiscernResult,
  opts: { pin: boolean },
): void {
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
    out.group("failure");
    out.error(result.message);
  }
  if ((result.diagnostics ?? []).length > 0) out.group("diagnostics");
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.output !== undefined && diagnostic.output !== "") {
      out.raw(
        diagnostic.output.endsWith("\n")
          ? diagnostic.output
          : `${diagnostic.output}\n`,
      );
    }
    out.error(diagnostic.message);
  }
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    if (hint.startsWith("Standards limits are UNVERIFIED")) {
      out.warn(hint);
    } else {
      out.info(hint);
    }
  }
  if (
    result.dry_run !== true && !opts.pin && result.message === undefined &&
    result.ok
  ) {
    const count = (result.steps ?? []).filter((step) =>
      step.step.kind === "standard"
    ).length;
    if (count > 0) {
      out.group("verdict");
      out.ok(`All ${count} standard(s) held.`);
    }
  } else if (!result.ok && result.message === undefined) {
    out.group("verdict");
    out.error("One or more standards failed.");
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
    signal?: AbortSignal;
  } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const pin = opts.pin ?? false;
  const pinNames = opts.pinNames ?? [];

  const result = await standardsResult(root, {
    dryRun,
    force,
    pin,
    pinNames,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  observeResult(result); // the logbook recorder lifts step timings from it
  if (json) {
    emitResult(result);
  } else {
    renderStandardsResult(result, { pin });
  }
  return result.ok ? 0 : 1;
}

/** Explain why standalone measurements need committed state and how to recover. */
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
  return "Standards require a clean worktree: this pass records its measurements against the exact commit (for pin reuse and gate replay), so they must describe committed state. Commit or stash changes, then re-run `discern standards`; use `--force` only while authoring or debugging standards. (The gate itself measures a dirty tree as-is — `discern done` needs no clean tree to check standards.)";
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
