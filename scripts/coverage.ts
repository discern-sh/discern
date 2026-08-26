/**
 * Measure aggregate and per-module `src/` line coverage in one instrumented run.
 *
 * This is the measurement command behind `[standards.coverage]` (see ADR 0003 and
 * `discern.toml`). Discern runs it on demand via `discern standards`,
 * scans the output for the LAST metric line for each Standard. Aggregate
 * coverage, module-floor failures, and registered legacy debt all consume this
 * same process.
 *
 * It runs the full suite — through the project's `test` task, so everything
 * that task provides (the site build, the permission flags, `--parallel`)
 * comes from that one definition — then computes line coverage over
 * the repo's own `src/` tree — both the installer AND the TypeScript engine
 * (`src/engine/**`), all one tree, instrumented by the same number. (`runAgent`
 * subprocesses count too: Deno propagates the coverage dir to child `deno`
 * processes via the environment.) Git and the structural-scope contract elect
 * which modules ought to have run; `scripts/coverage_lib.ts` joins LCOV onto
 * that universe, so an absent executable module measures zero.
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
import {
  evaluateModuleCoverage,
  lcovReportArgs,
  renderTable,
  srcLineCoverage,
} from "./coverage_lib.ts";
import {
  MODULE_COVERAGE_EXCEPTIONS,
  MODULE_LINE_COVERAGE_FLOOR,
} from "./module_coverage_exceptions.ts";
import { sourceModuleUniverse } from "./source_module_universe.ts";
import { withToolTempDir } from "./temp_dir.ts";

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

await withToolTempDir("coverage-profile", async (profile) => {
  const repoRoot = fromFileUrl(new URL("../", import.meta.url));
  // 1. Run the project's own `test` task under coverage instrumentation — the
  //    task is the single definition of how the suite runs (site build, allow
  //    flags, --parallel), and the extra args forward to its final command,
  //    the `deno test` invocation. V8 writes a profile per isolate into the
  //    shared dir, so the parallel run aggregates to the same number as a
  //    serial one. Raw profiles only: the end-of-run reports (table, lcov,
  //    HTML) each cost a full pass over the profile dir, and the one lcov
  //    pass below is the only report anything reads.
  await deno([
    "task",
    "test",
    `--coverage=${profile}`,
    "--coverage-raw-data-only",
  ]);

  // 2. The single report pass. Anchor the URL filter to this checkout's src/
  //    tree so fixture and site paths never enter the report; the join remains
  //    authoritative for membership inside that boundary. Product modules use
  //    non-test basenames so Deno's test-source exclusion stays semantically
  //    aligned with the source-module convention.
  const lcov = await deno(
    lcovReportArgs(profile, repoRoot),
    { capture: true },
  );

  // 3. Per-file table to stderr (context for the operator), then the machine
  //    metric to stdout — the line the standard reads.
  const modules = await sourceModuleUniverse(repoRoot);
  const cov = srcLineCoverage(lcov, repoRoot, modules);
  const moduleEvaluation = evaluateModuleCoverage(
    cov,
    MODULE_LINE_COVERAGE_FLOOR,
    MODULE_COVERAGE_EXCEPTIONS,
  );
  console.error(renderTable(cov));
  console.error(`src/ line coverage: ${cov.hit}/${cov.found} lines`);
  console.error(
    `Module line floor: ${MODULE_LINE_COVERAGE_FLOOR.toFixed(1)}%; ` +
      `${moduleEvaluation.failureCount} failures; ` +
      `${MODULE_COVERAGE_EXCEPTIONS.length} registered legacy exceptions`,
  );
  for (const failure of moduleEvaluation.failures) {
    console.error(`MODULE COVERAGE: ${failure}`);
  }
  console.log(`DISCERN_METRIC coverage ${cov.pct.toFixed(1)}`);
  console.log(
    `DISCERN_METRIC module_coverage_failures ${moduleEvaluation.failureCount}`,
  );
  console.log(
    `DISCERN_METRIC module_coverage_exceptions ${MODULE_COVERAGE_EXCEPTIONS.length}`,
  );
});
