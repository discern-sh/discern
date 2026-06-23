/**
 * `test` — a convenience over the `test` capability (the gate runs it in parallel
 * with the read-only checks; this runs just the tests, on demand). The TS port of
 * the shell `test` recipe.
 *
 * The work runs in {@link testResult}, the result-returning core the MCP server
 * and the CLI's `--json` both render; the human runner narrates around the same
 * run. `--json` is quiet — the envelope is the entire stdout (ADR 0030); richer
 * `steps`/`diagnostics` is deferred (see TODO.md).
 */

import { loadConfig } from "../../shared/config_schema.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut } from "../output.ts";
import { emitResult } from "../../shared/emit.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { runShellInherit } from "./run-shell.ts";

/** The line shown — as a human note and as an envelope hint — when no test
 * capability is wired, so a trivial pass is never mistaken for "tests ran". */
const NO_TEST_CONFIGURED =
  'No test capability is configured (set test = "<command>" under [capabilities] in discern.toml).';

/**
 * Compute the `test` {@link DiscernResult} without printing or exiting — the entry
 * point the MCP server renders, and the source the CLI's `--json` serializes. Runs
 * the test command quiet so a caller owning stdout (the MCP stdio channel) stays
 * uncontaminated. An unconfigured `test` capability is a trivial pass (like the
 * gate treats an unwired stage), carrying a hint so the caller knows nothing ran.
 */
export async function testResult(root: string): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const testCmd = cmdsInStage(cfg, "test");
  if (testCmd === ":") {
    return { ok: true, verb: "test", hints: [NO_TEST_CONFIGURED] };
  }
  const ok = await runShellInherit(testCmd, { quiet: true });
  return { ok, verb: "test" };
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

  const cfg = await loadConfig(root);
  const out = makeOut(colorEnabled());
  const testCmd = cmdsInStage(cfg, "test");
  if (testCmd === ":") {
    out.info(NO_TEST_CONFIGURED);
    return 0;
  }

  out.heading("Running tests...");
  if (!(await runShellInherit(testCmd, { quiet: false }))) {
    out.error("Tests failed.");
    return 1;
  }
  out.ok("Tests passed.");
  return 0;
}
