/**
 * `test` — run the project's `test` stage on its own (the gate runs it in parallel
 * with the read-only checks; this runs just the tests, on demand). It goes through
 * the gate's job runner, so a failure carries the SAME `steps[]` + structured
 * `diagnostics[]` `done` returns (ADR 0028), not a bare `ok:false`.
 *
 * One core ({@link runTestGate}) runs the test group; {@link testResult} runs it
 * quiet and returns the {@link DiscernResult} the MCP server (and the CLI's `--json`)
 * render, while {@link runTestJob} narrates the same run. An unconfigured
 * `test` job is a trivial pass carrying a hint that nothing ran — like the
 * gate treats an unwired stage.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import {
  fire,
  gateFailureRemedy,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import { serializeJobSteps, stageGroup } from "./plan.ts";
import { gateRunContext, runJobGroups } from "./execute.ts";
import { sweepDueTempArtifacts } from "./temp_artifact_sweep.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { gateFailureGotchasTail, type GotchasFailureTail } from "./gotchas.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import type { DiscernResult, FailedStage } from "../../shared/result.ts";
import type { Out } from "../output.ts";
import { renderSlotWait } from "./slot_wait_render.ts";
import {
  attachValidationEvidence,
  completeValidationEvidence,
  VALIDATION_RUNS,
  type ValidationStart,
} from "../logbook/validation.ts";
import { captureValidationStart } from "../logbook/validation_state.ts";

/**
 * Run the test gate once: build the test stage's group and run it through the shared
 * job runner (quiet under `--json`/MCP), serializing to a {@link DiscernResult}
 * carrying `steps[]` + `diagnostics[]`. When no test command is wired, returns the
 * trivial pass with the registered no-test-job hint. The single source the
 * result core and the human runner share.
 */
async function runTestGate(
  root: string,
  json: boolean,
  signal?: AbortSignal,
): Promise<
  {
    result: DiscernResult;
    failedStage: FailedStage | null;
    out: Out;
    configured: boolean;
    cfg: DiscernConfig;
    gotchasTail: GotchasFailureTail | undefined;
  }
> {
  const cfg = await loadConfig(root);
  const group = stageGroup(cfg, "test");
  const { runOpts, out, slots } = gateRunContext(root, cfg, json, signal);
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): test is
  // un-gated during setup, so a pass here must not read as "done".
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  if (group === undefined) {
    const hints = [
      ...(inProgress !== undefined ? [inProgress] : []),
      fire(HINTS["test-job-not-configured"]),
    ];
    const result: DiscernResult = {
      ok: true,
      verb: "test",
      hints: hintTexts(hints),
    };
    if (cfg.project.logbook) {
      const validation = await captureValidationStart(
        root,
        cfg,
        VALIDATION_RUNS.test,
        [],
      );
      attachValidationEvidence(
        result,
        completeValidationEvidence(validation, undefined),
      );
    }
    return {
      result,
      failedStage: null,
      out,
      configured: false,
      cfg,
      gotchasTail: undefined,
    };
  }
  // Retention for the job output artifacts the run is about to create (ADR 0117)
  // — before jobs spawn, so the sweep can never sit on a job's kill path.
  await sweepDueTempArtifacts(root);
  let validation: ValidationStart | undefined;
  if (cfg.project.logbook) {
    // The snapshot is the last project-state read before the standalone test
    // group starts. Capture failures are evidence, never command failures.
    validation = await captureValidationStart(
      root,
      cfg,
      VALIDATION_RUNS.test,
      [group],
    );
  }
  const { results, failedStage } = await runJobGroups(
    [group],
    runOpts,
    out,
    slots,
  );
  const { steps, diagnostics, hints } = await serializeJobSteps(
    [group],
    results,
  );
  const gotchasTail = failedStage === null
    ? undefined
    : await gateFailureGotchasTail(cfg, root, {
      failedStage,
      diagnostics,
    });
  const gotchasHints = gotchasTail !== undefined
    ? [gotchasTail.hint, ...gotchasTail.warnings]
    : [];
  // The fleet test-run cap's wait notices (the same lines the human run
  // narrated live), so a --json/MCP caller sees why the run took longer.
  const slotWaits = slots?.waits ?? [];
  const result: DiscernResult = {
    ok: failedStage === null,
    verb: "test",
    steps,
    ...(slots?.waitedMs !== undefined ? { waitedMs: slots.waitedMs } : {}),
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    ...(
      inProgress !== undefined || hints.length > 0 || slotWaits.length > 0 ||
        failedStage !== null || gotchasHints.length > 0
        ? {
          hints: hintTexts([
            ...(inProgress !== undefined ? [inProgress] : []),
            ...slotWaits,
            ...hints,
            ...(failedStage !== null ? [gateFailureRemedy(failedStage)] : []),
            ...gotchasHints,
          ]),
        }
        : {}
    ),
  };
  if (validation !== undefined) {
    attachValidationEvidence(
      result,
      completeValidationEvidence(validation, steps),
    );
  }
  return {
    result,
    failedStage,
    out,
    configured: true,
    cfg,
    gotchasTail,
  };
}

/**
 * Compute the `test` {@link DiscernResult} without printing or exiting — the entry
 * point the MCP server renders, and the source the CLI's `--json` serializes. Runs
 * the test command quiet (output captured, not streamed) so a caller owning stdout
 * (the MCP stdio channel) stays uncontaminated; a failure rides in `diagnostics[]`.
 * Aborting `signal` tree-kills the in-flight test jobs and ends the run.
 */
export async function testResult(
  root: string,
  signal?: AbortSignal,
): Promise<DiscernResult> {
  return (await runTestGate(root, true, signal)).result;
}

/** Run `test`. Returns a process exit code. */
export async function runTestJob(
  root: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  if (opts.json ?? false) {
    const result = await testResult(root);
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  const { result, failedStage, out, configured, gotchasTail } =
    await runTestGate(
      root,
      false,
    );
  observeResult(result); // the logbook recorder lifts step timings from it
  if (!configured) {
    out.info(fire(HINTS["test-job-not-configured"]).text);
    return 0;
  }
  if (failedStage !== null) {
    renderFailureTail(out, {
      verb: "test",
      headline: "Tests failed.",
      diagnostics: result.diagnostics ?? [],
      gotchas: gotchasTail,
      // `test` never quiets its human run — the runner narrated the output.
      outputWithheld: false,
    });
    renderSlotWait(out, result.waitedMs);
    return 1;
  }
  out.ok("Tests passed.");
  renderSlotWait(out, result.waitedMs);
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    out.info(hint);
  }
  return 0;
}
