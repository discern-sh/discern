/**
 * `tidy` — the fast inner loop: the fix-stage jobs, then the read-only
 * check-stage jobs (no build, no tests). The TS port of the shell `tidy` recipe.
 * The fixers run first (serially, via the joined fix command) since order
 * matters, then the checks.
 */

import { Config } from "../../shared/config_read.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut } from "../output.ts";
import { runShellInherit } from "./run-shell.ts";

/** Run `tidy`. Returns a process exit code. */
export async function runTidy(root: string): Promise<number> {
  const cfg = await Config.load(root);
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

  out.ok("Tidy complete — fixers applied and checks passed.");
  return 0;
}
