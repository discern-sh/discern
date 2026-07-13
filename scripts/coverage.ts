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
 * Speed shape: those subprocesses leave one V8 profile per module per spawn —
 * hundreds of thousands of small JSONs — and every report invocation over the
 * profile dir re-reads them all, single-threaded, at a cost comparable to the
 * suite itself. So the test run collects raw profiles only (suppressing the
 * reports `deno test --coverage` generates at the end of a run), and exactly
 * ONE report pass follows: the lcov below, which the table and the metric both
 * derive from.
 *
 * Usage: `deno task coverage` (the `[standards.coverage]` run command). Prints a
 * per-file table to stderr for context, then the metric line to stdout.
 */

import { fromFileUrl } from "@std/path";
import { renderTable, srcLineCoverage } from "./coverage_lib.ts";

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
  // Raw profiles only: the end-of-run reports (table, lcov, HTML) each cost a
  // full pass over the profile dir, and the one lcov pass below is the only
  // report anything reads.
  "--coverage-raw-data-only",
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
  // 1. Run the whole suite under coverage instrumentation (raw profiles only).
  await deno([...TEST_ARGS, `--coverage=${profile}`]);

  // 2. The single report pass. `--include` is a cheap size pre-filter over
  //    script URLs; the authoritative anchored selection happens in
  //    srcLineCoverage.
  const lcov = await deno(
    ["coverage", profile, "--lcov", "--include=src/"],
    { capture: true },
  );

  // 3. Per-file table to stderr (context for the operator), then the machine
  //    metric to stdout — the line the standard reads.
  const repoRoot = fromFileUrl(new URL("../", import.meta.url));
  const cov = srcLineCoverage(lcov, repoRoot);
  console.error(renderTable(cov));
  console.error(`src/ line coverage: ${cov.hit}/${cov.found} lines`);
  console.log(`DISCERN_METRIC coverage ${cov.pct.toFixed(1)}`);
} finally {
  await Deno.remove(profile, { recursive: true });
}
