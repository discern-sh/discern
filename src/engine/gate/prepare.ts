/**
 * `prepare` — the fast inner loop behind `discern prepare`: the fix-stage jobs,
 * then the read-only check-stage jobs (no build, no tests). The fixers run first
 * (serially, via the joined fix command) since order matters, then the checks.
 */

import { loadConfig } from "../../shared/config_schema.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut } from "../output.ts";
import { runShellInherit } from "./run-shell.ts";

/** Run `prepare`. Returns a process exit code. */
export async function runPrepare(root: string): Promise<number> {
  const cfg = await loadConfig(root);
  const out = makeOut(colorEnabled());

  out.heading("Fixing code...");
  if (!(await runShellInherit(cmdsInStage(cfg, "fix")))) {
    out.error("A fixer failed.");
    return 1;
  }

  out.heading("Checking...");
  if (!(await runShellInherit(cmdsInStage(cfg, "check")))) {
    out.error("A check failed.");
    return 1;
  }

  out.ok("Prepare complete — fixers applied and checks passed.");
  return 0;
}
