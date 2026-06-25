/**
 * `test` — run the project's `test` stage on its own (the gate runs it in parallel
 * with the read-only checks; this runs just the tests, on demand). It goes through
 * the gate's job runner, so a failure carries the SAME `steps[]` + structured
 * `diagnostics[]` `finish` returns (ADR 0028), not a bare `ok:false`.
 *
 * One core ({@link runTestGate}) runs the test group; {@link testResult} runs it
 * quiet and returns the {@link DiscernResult} the MCP server (and the CLI's `--json`)
 * render, while {@link runTestCapability} narrates the same run. An unconfigured
 * `test` capability is a trivial pass carrying a hint that nothing ran — like the
 * gate treats an unwired stage.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { serializeJobSteps, stageGroup } from "./plan.ts";
import { gateRunContext, runJobGroups } from "./execute.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { emitResult } from "../../shared/emit.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { Out } from "../output.ts";

/** The line shown — as a human note and as an envelope hint — when no test
 * capability is wired, so a trivial pass is never mistaken for "tests ran". */
const NO_TEST_CONFIGURED =
  'No test capability is configured (set test = "<command>" under [capabilities] in discern.toml).';

/**
 * Run the test gate once: build the test stage's group and run it through the shared
 * job runner (quiet under `--json`/MCP), serializing to a {@link DiscernResult}
 * carrying `steps[]` + `diagnostics[]`. When no test command is wired, returns the
 * trivial pass with the {@link NO_TEST_CONFIGURED} hint. The single source the
 * result core and the human runner share.
 */
async function runTestGate(
  root: string,
  json: boolean,
): Promise<
  {
    result: DiscernResult;
    failedStage: string | null;
    out: Out;
    configured: boolean;
    cfg: DiscernConfig;
  }
> {
  const cfg = await loadConfig(root);
  const group = stageGroup(cfg, "test");
  const { runOpts, out } = gateRunContext(cfg, json);
  if (group === undefined) {
    return {
      result: { ok: true, verb: "test", hints: [NO_TEST_CONFIGURED] },
      failedStage: null,
      out,
      configured: false,
      cfg,
    };
  }
  const { results, failedStage } = await runJobGroups([group], runOpts, out);
  const { steps, diagnostics } = serializeJobSteps([group], results);
  return {
    result: {
      ok: failedStage === null,
      verb: "test",
      steps,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    },
    failedStage,
    out,
    configured: true,
    cfg,
  };
}

/**
 * Compute the `test` {@link DiscernResult} without printing or exiting — the entry
 * point the MCP server renders, and the source the CLI's `--json` serializes. Runs
 * the test command quiet (output captured, not streamed) so a caller owning stdout
 * (the MCP stdio channel) stays uncontaminated; a failure rides in `diagnostics[]`.
 */
export async function testResult(root: string): Promise<DiscernResult> {
  return (await runTestGate(root, true)).result;
}

/** Run `test`. Returns a process exit code. */
export async function runTestCapability(
  root: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  if (opts.json ?? false) {
    const result = await testResult(root);
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  const { result, failedStage, out, configured, cfg } = await runTestGate(
    root,
    false,
  );
  if (!configured) {
    out.info(NO_TEST_CONFIGURED);
    return 0;
  }
  if (failedStage !== null) {
    renderFailureTail(out, {
      cfg,
      root,
      verb: "test",
      headline: "Tests failed.",
      diagnostics: result.diagnostics ?? [],
    });
    return 1;
  }
  out.ok("Tests passed.");
  return 0;
}
