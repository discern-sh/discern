/**
 * `prepare` — the fast inner loop behind `discern prepare`: the fix-stage fixers
 * (serial; order matters), then the `[generated]` regenerations, the built-in
 * complete refresh, then the read-only check-stage jobs (no other build jobs,
 * no tests). Declared jobs run through the
 * gate's job runner, so a failure is captured into the SAME `steps[]` +
 * structured `diagnostics[]` `done` returns — the act→read→fix loop, not a bare
 * `ok:false` (ADR 0028).
 *
 * One core ({@link runPrepareGate}) builds the groups and runs them; {@link
 * prepareResult} runs it quiet and returns the {@link DiscernResult} the MCP server
 * (and the CLI's `--json`) render, while {@link runPrepare} narrates the same run and
 * prints a human tail. `--json` is quiet — the envelope is the entire stdout (ADR
 * 0030), with a failure's output captured into its diagnostic rather than streamed.
 *
 * On a GREEN, bootstrapped run it appends the diff-aware coupling (ADR 0084)
 * at the tail — behind the same `[coupling].in_gate` flag `done` honours — so the
 * nudge meets the change while it is hot in the inner loop. Best-effort and advisory:
 * it touches only `hints`, never prepare's pass/fail, and is skipped on a failed run.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import {
  gateFailureRemedy,
  hintTexts,
  interactiveHintTexts,
  mergeHintTexts,
} from "../../shared/hints.ts";
import {
  checkpointInspectionHints,
  inspectCheckpointObligations,
} from "../checkpoints/inspection.ts";
import {
  buildPreparePlan,
  GENERATED_GROUP_DISPLAY,
  serializeJobSteps,
} from "./plan.ts";
import {
  gateOutputIsLive,
  type GateOutputSurface,
  gateOutputTtyWidth,
  gateRunContext,
  type GateRunPolicy,
  resolveGateRunPolicy,
  runJobGroups,
} from "./execute.ts";
import { sweepDueTempArtifacts } from "./temp_artifact_sweep.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { gateFailureGotchasTail, type GotchasFailureTail } from "./gotchas.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { couplingGateHints } from "../coupling/coupling.ts";
import type {
  Diagnostic,
  DiscernResult,
  FailedStage,
  PlanStep,
  StepResult,
} from "../../shared/result.ts";
import type { Out } from "../output.ts";
import { terminalContext } from "../../lib/terminal.ts";
import {
  createGateTtyProgress,
  renderGateTtyStatus,
  renderGateTtyTable,
} from "./gate_tty.ts";
import {
  compileInstructions,
  instructionRefreshErrors,
} from "../instructions.ts";
import { checkInstructionCurrent } from "../instruction_render.ts";
import { checkSkillsCurrent } from "../../lib/skills.ts";
import { Logger } from "../../lib/log.ts";

interface PrepareRefreshRun {
  readonly ok: boolean;
  readonly step: StepResult;
  readonly diagnostics: readonly Diagnostic[];
  readonly hints: readonly string[];
  readonly changed: readonly string[];
}

/** One skipped refresh result when an earlier mutating group failed. */
function skippedRefresh(step: PlanStep): PrepareRefreshRun {
  return {
    ok: false,
    step: { step, outcome: "skipped" },
    diagnostics: [],
    hints: [],
    changed: [],
  };
}

/**
 * Apply the shared refresh authority, then prove its instruction and skills
 * currency checks are already a fixpoint before read-only project checks run.
 */
async function runPrepareRefresh(
  root: string,
  cfg: DiscernConfig,
  planned: PlanStep,
): Promise<PrepareRefreshRun> {
  const errors = new Set<string>();
  let hints: readonly string[] = [];
  let changed: readonly string[] = [];
  try {
    const refreshed = await compileInstructions(
      root,
      new Logger({ json: true, noColor: true }),
    );
    for (const error of instructionRefreshErrors(refreshed)) errors.add(error);
    hints = refreshed.hints;
    changed = refreshed.trackedArtifactsChanged;

    for (const drift of await checkInstructionCurrent(root, cfg)) {
      errors.add(
        `${drift.path} remained ${drift.reason} after refresh; fix the authored instruction source or the reported output path`,
      );
    }
    for (
      const drift of (await checkSkillsCurrent(root, cfg)).filter((entry) =>
        entry.reason !== "foreign"
      )
    ) {
      errors.add(`${drift.dir}: ${drift.detail}`);
    }
  } catch (error) {
    errors.add(error instanceof Error ? error.message : String(error));
  }

  const failures = [...errors];
  const note = changed.length === 0
    ? `${planned.note ?? "run refresh"}; already current`
    : `${planned.note ?? "run refresh"}; changed ${changed.join(", ")}`;
  return {
    ok: failures.length === 0,
    step: {
      step: { ...planned, note },
      outcome: failures.length === 0 ? "ok" : "failed",
    },
    diagnostics: failures.map((message) => ({
      tool: "refresh",
      severity: "error",
      message:
        `Refresh did not fully materialize the generated Agent surface: ${message}. Fix the named source or output, then run discern refresh again.`,
      reproduce_cmd: "discern refresh",
    })),
    hints,
    changed,
  };
}

/**
 * Run the prepare gate once: build the groups, run them through the shared job
 * runner (quiet under `--json`/MCP), and serialize to a {@link DiscernResult}
 * carrying `steps[]` + `diagnostics[]`. The single source the result core and the
 * human runner share, so the two can never run different work.
 */
async function runPrepareGate(
  root: string,
  surface: GateOutputSurface,
  signal?: AbortSignal,
): Promise<
  {
    result: DiscernResult;
    failedStage: FailedStage | null;
    out: Out;
    cfg: DiscernConfig;
    policy: GateRunPolicy;
    gotchasTail: GotchasFailureTail | undefined;
    outputWithheld: boolean;
    presentationWritable: boolean;
    refreshChanged: readonly string[];
  }
> {
  const cfg = await loadConfig(root);
  const policy = resolveGateRunPolicy(cfg.gate.stream, surface);
  const plan = buildPreparePlan(cfg);
  const groups = [...plan.beforeRefresh, ...plan.afterRefresh];
  const { runOpts, out, runOut, flushDeferredOutput, slots } = gateRunContext(
    root,
    cfg,
    policy,
    signal,
  );
  const liveOutput = policy.output.kind === "live-frame"
    ? policy.output
    : undefined;
  const progress = liveOutput !== undefined
    ? await createGateTtyProgress(out.raw, groups, {
      width: liveOutput.ttyWidth,
      terminal: out.terminal,
    })
    : undefined;
  if (progress !== undefined) {
    runOpts.observer = progress;
    runOpts.outputObserver = progress;
  }
  const producerExecutions: Record<string, number> = {};
  runOpts.observer = {
    started: (job): void => {
      const label = job.label.replace(/#[0-9]+$/u, "");
      const selector = label.startsWith("generated:")
        ? `jobs.discern-generated-${label.slice("generated:".length)}`
        : `jobs.${label}`;
      producerExecutions[selector] = 1;
      progress?.started(job);
    },
    settled: (result): void => {
      progress?.settled(result);
    },
  };
  // Retention for the job output artifacts the run is about to create (ADR 0117)
  // — before jobs spawn, so the sweep can never sit on a job's kill path.
  await sweepDueTempArtifacts(root);
  // The fleet test-run cap can never bite here — prepare's groups are fix and
  // check, and only a test-stage or standard-measurement group draws a slot —
  // but the context threads through the one seam like every other gate verb.
  const before = await runJobGroups(
    [...plan.beforeRefresh],
    runOpts,
    runOut,
    slots,
  );
  const results = before.results;
  let failedStage = before.failedStage;
  let refresh = skippedRefresh(plan.refresh);
  if (failedStage === null) {
    refresh = await runPrepareRefresh(root, cfg, plan.refresh);
    if (!refresh.ok) failedStage = "refresh_drift";
  }
  if (failedStage === null) {
    const after = await runJobGroups(
      [...plan.afterRefresh],
      runOpts,
      runOut,
      slots,
    );
    for (const [label, result] of after.results) results.set(label, result);
    failedStage = after.failedStage;
  }
  const beforeSerialized = await serializeJobSteps(
    root,
    [...plan.beforeRefresh],
    results,
  );
  const afterSerialized = await serializeJobSteps(
    root,
    [...plan.afterRefresh],
    results,
  );
  const steps = [
    ...beforeSerialized.steps,
    refresh.step,
    ...afterSerialized.steps,
  ];
  const diagnostics = [
    ...beforeSerialized.diagnostics,
    ...refresh.diagnostics,
    ...afterSerialized.diagnostics,
  ];
  const jobOutputHints = [
    ...beforeSerialized.hints,
    ...afterSerialized.hints,
  ];
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  // The coupling (ADR 0084) rides the fast inner loop too, behind the SAME
  // [coupling].in_gate preference, so the nudge meets the change while it is hot — not
  // only at finish. Mirrors finish's discipline exactly: only on a GREEN, bootstrapped
  // run, best-effort, and touching ONLY `hints`, so it can never move
  // prepare's `ok` / exit code / failed stage, nor slow a failed loop (it is skipped then).
  const couplingHints =
    failedStage === null && cfg.meta.bootstrapped && cfg.coupling.in_gate
      ? await couplingGateHints(root)
      : [];
  // The checkpoint obligation inspection (shared with `status`,
  // `checkpoints`, and both `done` paths): serve each required question while
  // the change is still in the inner loop. Read-only and advisory — it touches
  // only `hints`, and a checkpoint-free effort adds nothing.
  const checkpointHints = checkpointInspectionHints(
    await inspectCheckpointObligations(root, cfg),
  );
  const gotchasTail = failedStage === null
    ? undefined
    : await gateFailureGotchasTail(cfg, root, {
      failedStage,
      diagnostics,
    });
  const firedHints = [
    // Pre-setup, this output is indicative — prepare is un-gated during setup (ADR 0065).
    ...(inProgress !== undefined ? [inProgress] : []),
    ...jobOutputHints,
    ...(failedStage !== null ? [gateFailureRemedy(failedStage)] : []),
    ...(gotchasTail !== undefined
      ? [gotchasTail.hint, ...gotchasTail.warnings]
      : []),
    ...checkpointHints,
    ...couplingHints,
  ];
  const result: DiscernResult = {
    ok: failedStage === null,
    verb: "prepare",
    data: { producer_executions: producerExecutions, measurement: "none" },
    steps,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    ...(() => {
      const hints = mergeHintTexts(refresh.hints, hintTexts(firedHints));
      return hints.length > 0 ? { hints } : {};
    })(),
  };
  await progress?.complete(result.steps ?? []);
  const liveWriteFailed = progress?.writeFailed() ?? false;
  const deferredOutputFlushed = liveWriteFailed ? false : flushDeferredOutput();
  return {
    result,
    failedStage,
    out,
    cfg,
    policy,
    gotchasTail,
    // The package tail disappears at completion; failures retain the durable
    // diagnostic excerpt and full-artifact route below the restored frame.
    outputWithheld: gateOutputIsLive(policy),
    presentationWritable: !liveWriteFailed && deferredOutputFlushed,
    refreshChanged: refresh.changed,
  };
}

/**
 * Compute the `prepare` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders, and the source the CLI's `--json` serializes.
 * Runs quiet (job stdio captured, not streamed) so a caller owning stdout — like the
 * MCP stdio channel — stays uncontaminated; a failure rides in `diagnostics[]`.
 * Aborting `signal` tree-kills the in-flight jobs and ends the run.
 */
export async function prepareResult(
  root: string,
  signal?: AbortSignal,
): Promise<DiscernResult> {
  return (await runPrepareGate(root, { kind: "quiet-result" }, signal)).result;
}

/** Run `prepare`. Returns a process exit code. */
export async function runPrepare(
  root: string,
  opts: { json?: boolean; plain?: boolean } = {},
): Promise<number> {
  if (opts.json ?? false) {
    const result = await prepareResult(root);
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  const terminal = terminalContext();
  const {
    result,
    failedStage,
    out,
    policy,
    gotchasTail,
    outputWithheld,
    presentationWritable,
    refreshChanged,
  } = await runPrepareGate(
    root,
    { kind: "human", plain: opts.plain ?? false, terminal },
    undefined,
  );
  observeResult(result); // the logbook recorder lifts step timings from it
  if (!presentationWritable) return failedStage === null ? 0 : 1;
  const ttyWidth = gateOutputTtyWidth(policy);
  const staticGroupedTable = ttyWidth !== undefined &&
    policy.output.kind === "static-grouped";
  if (staticGroupedTable && ttyWidth !== undefined) {
    out.group("prepare-results");
    out.raw(
      `${
        renderGateTtyTable(result.steps ?? [], {
          width: ttyWidth,
          terminal: out.terminal,
        })
      }\n`,
    );
  }
  if (failedStage !== null) {
    renderFailureTail(out, {
      verb: "prepare",
      headline: failedStage === "fix"
        ? "A fixer failed."
        : failedStage === "build"
        ? "A regeneration failed."
        : failedStage === "refresh_drift"
        ? "Artifact refresh failed."
        : "A check failed.",
      diagnostics: result.diagnostics ?? [],
      failedStage,
      gotchas: gotchasTail,
      // A failed deferred flush lets the diagnostic retain the captured output.
      outputWithheld,
    });
    return 1;
  }
  const steps = result.steps ?? [];
  const noJobs = steps.every((step) => step.step.kind !== "job");
  const regenerated = steps.some((s) =>
    s.step.group === GENERATED_GROUP_DISPLAY
  );
  const success = noJobs
    ? "No fix or check job is configured. Build and test stages did not run."
    : regenerated
    ? "Fix and check stages passed; generated artifacts were regenerated. Build jobs and tests did not run."
    : "Fix and check stages passed. Build and test stages did not run.";
  if (staticGroupedTable && ttyWidth !== undefined) {
    out.group("prepare-summary");
    out.raw(
      `${
        renderGateTtyStatus(success, "ok", {
          width: ttyWidth,
          terminal: out.terminal,
        })
      }\n`,
    );
  } else {
    out.ok(success);
  }
  if (refreshChanged.length > 0) {
    out.info(`Refresh updated tracked artifacts: ${refreshChanged.join(", ")}`);
  }
  // The advisory tail (the co-change nudge / the setup-in-progress note) — same as finish.
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    out.info(hint);
  }
  return 0;
}
