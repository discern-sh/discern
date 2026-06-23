/**
 * `prepare` — the fast inner loop behind `discern prepare`: the fix-stage jobs,
 * then the read-only check-stage jobs (no build, no tests). The fixers run first
 * (serially, via the joined fix command) since order matters, then the checks.
 *
 * `--json` emits a {@link DiscernResult} envelope on stdout and routes all human +
 * command output to stderr. The envelope is the uniform `{ok, verb}` shell; richer
 * per-job `steps`/`diagnostics` (as `finish` carries) would need prepare to run via
 * the job runner rather than the joined-command shell — deferred (see TODO.md).
 */

import { loadConfig } from "../../shared/config_schema.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut } from "../output.ts";
import { emitResult } from "../../shared/emit.ts";
import { runShellInherit } from "./run-shell.ts";

/** Run `prepare`. Returns a process exit code. */
export async function runPrepare(
  root: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const cfg = await loadConfig(root);
  // --json: human narration → stderr, leaving stdout for the single JSON object.
  const out = makeOut(colorEnabled(), json ? "stderr" : "stdout");

  const done = (ok: boolean): number => {
    if (json) {
      emitResult({ ok, verb: "prepare" });
    }
    return ok ? 0 : 1;
  };

  out.heading("Fixing code...");
  if (!(await runShellInherit(cmdsInStage(cfg, "fix"), { toStderr: json }))) {
    out.error("A fixer failed.");
    return done(false);
  }

  out.heading("Checking...");
  if (!(await runShellInherit(cmdsInStage(cfg, "check"), { toStderr: json }))) {
    out.error("A check failed.");
    return done(false);
  }

  out.ok("Prepare complete — fixers applied and checks passed.");
  return done(true);
}
