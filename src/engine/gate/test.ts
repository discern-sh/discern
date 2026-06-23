/**
 * `test` — a convenience over the `test` capability (the gate runs it in parallel
 * with the read-only checks; this runs just the tests, on demand). The TS port of
 * the shell `test` recipe.
 *
 * `--json` emits a {@link DiscernResult} envelope on stdout and routes human +
 * command output to stderr (richer `steps`/`diagnostics` is deferred — see TODO.md).
 */

import { loadConfig } from "../../shared/config_schema.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut } from "../output.ts";
import { emitResult } from "../../shared/emit.ts";
import { runShellInherit } from "./run-shell.ts";

/** Run `test`. Returns a process exit code. */
export async function runTestCapability(
  root: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const cfg = await loadConfig(root);
  // --json: quiet — the result envelope is the entire output (ADR 0030).
  const out = makeOut(colorEnabled(), { quiet: json });
  const testCmd = cmdsInStage(cfg, "test");

  const done = (ok: boolean): number => {
    if (json) {
      emitResult({ ok, verb: "test" });
    }
    return ok ? 0 : 1;
  };

  if (testCmd === ":") {
    out.info(
      'No test capability is configured (set test = "<command>" under [capabilities] in discern.toml).',
    );
    return done(true);
  }

  out.heading("Running tests...");
  if (!(await runShellInherit(testCmd, { quiet: json }))) {
    out.error("Tests failed.");
    return done(false);
  }
  out.ok("Tests passed.");
  return done(true);
}
