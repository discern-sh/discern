/**
 * `prepare` — the fast inner loop behind `discern prepare`: the fix-stage fixers
 * (serial; order matters), then the read-only check-stage jobs (no build, no
 * tests). It runs through the gate's job runner, so a failure is captured into the
 * SAME `steps[]` + structured `diagnostics[]` `done` returns — the act→read→fix
 * loop, not a bare `ok:false` (ADR 0028).
 *
 * One core ({@link runPrepareGate}) builds the groups and runs them; {@link
 * prepareResult} runs it quiet and returns the {@link DiscernResult} the MCP server
 * (and the CLI's `--json`) render, while {@link runPrepare} narrates the same run and
 * prints a human tail. `--json` is quiet — the envelope is the entire stdout (ADR
 * 0030), with a failure's output captured into its diagnostic rather than streamed.
 *
 * On a GREEN, bootstrapped run it appends the diff-aware co-change advisory (ADR 0084)
 * at the tail — behind the same `[coupling].in_gate` flag `done` honours — so the
 * nudge meets the change while it is hot in the inner loop. Best-effort and advisory:
 * it touches only `hints`, never prepare's pass/fail, and is skipped on a failed run.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import { preparePlanGroups, serializeJobSteps } from "./plan.ts";
import { gateRunContext, runJobGroups } from "./execute.ts";
import { sweepDueTempArtifacts } from "../../shared/temp_artifacts.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { couplingGateHints } from "../coupling/coupling.ts";
import type { DiscernResult, FailedStage } from "../../shared/result.ts";
import type { Out } from "../output.ts";

/**
 * Run the prepare gate once: build the groups, run them through the shared job
 * runner (quiet under `--json`/MCP), and serialize to a {@link DiscernResult}
 * carrying `steps[]` + `diagnostics[]`. The single source the result core and the
 * human runner share, so the two can never run different work.
 */
async function runPrepareGate(
  root: string,
  json: boolean,
  signal?: AbortSignal,
): Promise<
  {
    result: DiscernResult;
    failedStage: FailedStage | null;
    out: Out;
    cfg: DiscernConfig;
  }
> {
  const cfg = await loadConfig(root);
  const groups = preparePlanGroups(cfg);
  const { runOpts, out } = gateRunContext(root, cfg, json, signal);
  // Retention for the job output artifacts the run is about to create (ADR 0117)
  // — before jobs spawn, so the sweep can never sit on a job's kill path.
  await sweepDueTempArtifacts();
  const { results, failedStage } = await runJobGroups(groups, runOpts, out);
  const { steps, diagnostics, hints: jobOutputHints } = await serializeJobSteps(
    groups,
    results,
  );
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  // The co-change advisory (ADR 0084) rides the fast inner loop too, behind the SAME
  // [coupling].in_gate preference, so the nudge meets the change while it is hot — not
  // only at finish. Mirrors finish's discipline exactly: only on a GREEN, bootstrapped
  // run, best-effort, and touching ONLY `hints`, so it can never move
  // prepare's `ok` / exit code / failed stage, nor slow a failed loop (it is skipped then).
  const couplingHints =
    failedStage === null && cfg.meta.bootstrapped && cfg.coupling.in_gate
      ? await couplingGateHints(root)
      : [];
  const hints = [
    // Pre-setup, this output is indicative — prepare is un-gated during setup (ADR 0065).
    ...(inProgress !== undefined ? [inProgress] : []),
    ...jobOutputHints,
    ...couplingHints,
  ];
  const result: DiscernResult = {
    ok: failedStage === null,
    verb: "prepare",
    steps,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    ...(hints.length > 0 ? { hints } : {}),
  };
  return { result, failedStage, out, cfg };
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
  return (await runPrepareGate(root, true, signal)).result;
}

/** Run `prepare`. Returns a process exit code. */
export async function runPrepare(
  root: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  if (opts.json ?? false) {
    const result = await prepareResult(root);
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  const { result, failedStage, out, cfg } = await runPrepareGate(root, false);
  observeResult(result); // the logbook recorder lifts step timings from it
  if (failedStage !== null) {
    renderFailureTail(out, {
      cfg,
      root,
      verb: "prepare",
      headline: failedStage === "fix" ? "A fixer failed." : "A check failed.",
      diagnostics: result.diagnostics ?? [],
    });
    return 1;
  }
  out.ok("Prepare complete — fixers applied and checks passed.");
  // The advisory tail (the co-change nudge / the setup-in-progress note) — same as finish.
  for (const hint of result.hints ?? []) {
    out.info(hint);
  }
  return 0;
}
