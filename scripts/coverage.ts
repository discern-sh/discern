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
 * hundreds of thousands of small JSONs, most of them dependency and fixture
 * modules the report filter would reject only after parsing them — and a
 * report pass over a profile dir is single-threaded. So the test run collects
 * raw profiles only (suppressing the reports `deno test --coverage` generates
 * at the end of a run), `scripts/coverage_profiles.ts` prunes the profiles no
 * report can use and spreads the rest across shard directories by module
 * URL, one concurrent report pass each — per-module merging then happens
 * whole within one pass, so the joined numbers equal the single merged
 * pass at a fraction of the wall clock. The module census runs alongside
 * the report passes, and the measured path retires the profile dir with
 * one rename to a detached remover rather than paying a million unlinks
 * on its own clock.
 *
 * Usage: `deno task coverage` (the `[standards.coverage]` run command). Prints a
 * per-file table to stderr for context, then the metric line to stdout.
 */

import { fromFileUrl } from "@std/path";
import {
  evaluateModuleCoverage,
  lcovReportArgs,
  renderTable,
  srcCoverageUrlPrefix,
  srcLineCoverage,
} from "./coverage_lib.ts";
import {
  pruneAndShardProfiles,
  reapProfileDir,
  reportShardCount,
} from "./coverage_profiles.ts";
import {
  MODULE_COVERAGE_EXCEPTIONS,
  MODULE_LINE_COVERAGE_FLOOR,
} from "./module_coverage_exceptions.ts";
import { sourceModuleUniverse } from "./source_module_universe.ts";
import { withToolTempDir } from "./temp_dir.ts";

/** Build one `deno` subcommand invocation — the sole construction site. */
function denoCommand(args: string[], io: Deno.CommandOptions): Deno.Command {
  return new Deno.Command(Deno.execPath(), { ...io, args });
}

/** Run a `deno` subcommand, returning its captured stdout (throws on failure). */
async function deno(
  args: string[],
  opts: { capture?: boolean } = {},
): Promise<string> {
  const result = await denoCommand(args, {
    stdout: opts.capture ? "piped" : "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new Error(`deno ${args[0]} failed (exit ${result.code}).`);
  }
  return opts.capture ? new TextDecoder().decode(result.stdout) : "";
}

/**
 * Spawn a `deno` subcommand unobserved, unreferenced, and leading its own
 * process group — for work that must outlive this measurement without holding
 * its clock. Group leadership matters: the job runner tears down a finished
 * job's process group, and only a detached child survives that sweep.
 */
function denoDetached(args: string[]): void {
  denoCommand(args, {
    stdin: "null",
    stdout: "null",
    stderr: "null",
    detached: true,
  })
    .spawn()
    .unref();
}

/**
 * Prune and shard the raw profiles, then run one report pass per populated
 * shard concurrently, returning their LCOV texts for the per-line union.
 */
async function shardedLcovReports(
  profile: string,
  repoRoot: string,
): Promise<string[]> {
  const summary = await pruneAndShardProfiles(
    profile,
    srcCoverageUrlPrefix(repoRoot),
    reportShardCount(navigator.hardwareConcurrency),
  );
  console.error(
    `coverage profiles: ${summary.sharded} sharded across ` +
      `${summary.shardDirs.length} report passes; ${summary.pruned} non-src ` +
      `pruned; ${summary.opaque} unrecognized kept for the report filter`,
  );
  return await Promise.all(
    summary.shardDirs.map((dir) =>
      deno(lcovReportArgs(dir, repoRoot), { capture: true })
    ),
  );
}

await withToolTempDir("coverage-profile", async (profile) => {
  const repoRoot = fromFileUrl(new URL("../", import.meta.url));
  // 1. Run the project's own `test` task under coverage instrumentation — the
  //    task is the single definition of how the suite runs (site build, allow
  //    flags, --parallel), and the extra args forward to its final command,
  //    the `deno test` invocation. V8 writes a profile per isolate into the
  //    shared dir, so the parallel run aggregates to the same number as a
  //    serial one. Raw profiles only: the end-of-run reports (table, lcov,
  //    HTML) each cost a full pass over the profile dir, and the shard passes
  //    below are the only reports anything reads.
  await deno([
    "task",
    "test",
    `--coverage=${profile}`,
    "--coverage-raw-data-only",
  ]);

  // 2. The report passes and the module census share no inputs, so they run
  //    concurrently and meet at the join. Each shard pass anchors the URL
  //    filter to this checkout's src/ tree so fixture and site paths never
  //    enter a report; the join remains authoritative for membership inside
  //    that boundary. Product modules use non-test basenames so Deno's
  //    test-source exclusion stays semantically aligned with the
  //    source-module convention.
  const [modules, lcovs] = await Promise.all([
    sourceModuleUniverse(repoRoot),
    shardedLcovReports(profile, repoRoot),
  ]);

  // 3. Per-file table to stderr (context for the operator), then the machine
  //    metric to stdout — the line the standard reads.
  const cov = srcLineCoverage(lcovs, repoRoot, modules);
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

  // 4. Retire the profile dir before the metric lines: deleting a
  //    million-file directory inline costs minutes — enough to push a
  //    finished measurement past its timeout — so one rename hands it to a
  //    detached remover, and a reap fault still fails the run loudly. The
  //    owning temp capability tolerates the then-absent directory.
  await reapProfileDir(profile, denoDetached);

  console.log(`DISCERN_METRIC coverage ${cov.pct.toFixed(1)}`);
  console.log(
    `DISCERN_METRIC module_coverage_failures ${moduleEvaluation.failureCount}`,
  );
  console.log(
    `DISCERN_METRIC module_coverage_exceptions ${MODULE_COVERAGE_EXCEPTIONS.length}`,
  );
});
