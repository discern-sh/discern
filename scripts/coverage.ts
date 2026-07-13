/**
 * Measure `src/` line coverage and emit it as a discern standard metric.
 *
 * This is the measurement command behind `[standards.coverage]` (see ADR 0003 and
 * `discern.toml`). Discern runs it on demand via `discern standards`,
 * scans the output for the LAST `DISCERN_METRIC coverage <number>` line, and holds
 * it at or above the configured floor.
 *
 * It runs the full suite under Deno coverage, then computes line coverage over
 * the repo's own `src/` tree — both the installer AND the TypeScript engine
 * (`src/engine/**`), all one tree, instrumented by the same number. (`runAgent`
 * subprocesses count too: Deno propagates the coverage dir to child `deno`
 * processes via the environment.) `scripts/coverage_lib.ts` holds the anchored
 * definition of which files count, and its tests pin it.
 *
 * Usage: `deno task coverage` (the `[standards.coverage]` run command). Prints the
 * human `deno coverage` table to stderr for context, then the metric line to stdout.
 */

import { fromFileUrl } from "@std/path";
import { srcLineCoverage } from "./coverage_lib.ts";

const TEST_ARGS = [
  "test",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  // Collect coverage across worker threads. V8 writes a profile per isolate into
  // the shared --coverage dir, so the aggregated number is identical to a serial
  // run (verified) while finishing in a fraction of the wall time.
  "--parallel",
];

/** Run a `deno` subcommand, returning its captured stdout (throws on failure). */
async function deno(
  args: string[],
  opts: { capture?: boolean } = {},
): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: opts.capture ? "piped" : "inherit",
    stderr: "inherit",
  });
  const result = await command.output();
  if (!result.success) {
    throw new Error(`deno ${args[0]} failed (exit ${result.code}).`);
  }
  return opts.capture ? new TextDecoder().decode(result.stdout) : "";
}

const profile = await Deno.makeTempDir({ prefix: "discern-coverage-" });
try {
  // 1. Run the whole suite under coverage instrumentation.
  await deno([...TEST_ARGS, `--coverage=${profile}`]);

  // 2. Human-readable per-file table to stderr (context for the operator).
  await deno(["coverage", profile, "--include=src/"]);

  // 3. The machine metric to stdout — the line the standard reads.
  const lcov = await deno(["coverage", profile, "--lcov"], { capture: true });
  const repoRoot = fromFileUrl(new URL("../", import.meta.url));
  const { pct, hit, found } = srcLineCoverage(lcov, repoRoot);
  console.error(`src/ line coverage: ${hit}/${found} lines`);
  console.log(`DISCERN_METRIC coverage ${pct.toFixed(1)}`);
} finally {
  await Deno.remove(profile, { recursive: true });
}
