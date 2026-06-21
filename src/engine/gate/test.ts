/**
 * `test` — a convenience over the `test` capability (the gate runs it in parallel
 * with the read-only checks; this runs just the tests, on demand). The TS port of
 * the shell `test` recipe.
 */

import { Config } from "../../shared/config_read.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut } from "../output.ts";
import { runShellInherit } from "./run-shell.ts";

/** Run `test`. Returns a process exit code. */
export async function runTestCapability(root: string): Promise<number> {
  const cfg = await Config.load(root);
  const out = makeOut(colorEnabled());
  const testCmd = cmdsInStage(cfg, "test");

  if (testCmd === ":") {
    out.info(
      'No test capability is configured (set test = "<command>" under [capabilities] in discern.toml).',
    );
    return 0;
  }

  out.heading("Running tests...");
  if (!(await runShellInherit(testCmd))) {
    out.error("Tests failed.");
    return 1;
  }
  out.ok("Tests passed.");
  return 0;
}
