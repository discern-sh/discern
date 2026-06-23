/**
 * `prepare` — the fast inner loop behind `discern prepare`: the fix-stage jobs,
 * then the read-only check-stage jobs (no build, no tests). The fixers run first
 * (serially, via the joined fix command) since order matters, then the checks.
 *
 * The work runs in ONE place ({@link runPrepareStages}); the human runner narrates
 * through an `Out`, while {@link prepareResult} runs it quiet and returns the
 * {@link DiscernResult} envelope the MCP server (and the CLI's `--json`) render.
 * `--json` is quiet — the envelope is the entire stdout (ADR 0030). Richer per-job
 * `steps`/`diagnostics` (as `finish` carries) would need prepare to run via the job
 * runner rather than the joined-command shell — deferred (see TODO.md).
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { cmdsInStage } from "./stages.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import { emitResult } from "../../shared/emit.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { runShellInherit } from "./run-shell.ts";

/**
 * Run the two prepare stages — the fixers (serially; order matters), then the
 * read-only checks — narrating through `out` when one is given. Returns whether
 * both passed and which stage failed. The single source the human runner and the
 * result-returning core share, so the two can never run different work.
 */
async function runPrepareStages(
  cfg: DiscernConfig,
  opts: { out?: Out; quiet: boolean },
): Promise<{ ok: boolean; failed?: "fix" | "check" }> {
  opts.out?.heading("Fixing code...");
  if (
    !(await runShellInherit(cmdsInStage(cfg, "fix"), { quiet: opts.quiet }))
  ) {
    return { ok: false, failed: "fix" };
  }
  opts.out?.heading("Checking...");
  if (
    !(await runShellInherit(cmdsInStage(cfg, "check"), { quiet: opts.quiet }))
  ) {
    return { ok: false, failed: "check" };
  }
  return { ok: true };
}

/**
 * Compute the `prepare` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders, and the source the CLI's `--json` serializes.
 * Runs quiet (the fixers + checks with their stdio discarded) so a caller owning
 * stdout — like the MCP stdio channel — stays uncontaminated.
 */
export async function prepareResult(root: string): Promise<DiscernResult> {
  const cfg = await loadConfig(root);
  const { ok } = await runPrepareStages(cfg, { quiet: true });
  return { ok, verb: "prepare" };
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

  const cfg = await loadConfig(root);
  const out = makeOut(colorEnabled());
  const { ok, failed } = await runPrepareStages(cfg, { out, quiet: false });
  if (!ok) {
    out.error(failed === "fix" ? "A fixer failed." : "A check failed.");
    return 1;
  }
  out.ok("Prepare complete — fixers applied and checks passed.");
  return 0;
}
