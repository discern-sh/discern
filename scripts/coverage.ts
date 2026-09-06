/**
 * Instrument the canonical repository suite once and derive all coverage metrics.
 *
 * With no arguments, measure and print metrics for the current public standards.
 * `produce <path>` writes LCOV for the validation engine's attempt-owned artifact
 * capture; `extract` reads captured LCOV on stdin and prints all three readings.
 * Both modes share the Git-derived module universe, parser, and held thresholds.
 * Raw profiles are sharded by module URL before reporting; scratch cleanup is
 * awaited before success so the producer leaves no detached cleanup process.
 */
import { dirname, fromFileUrl } from "@std/path";
import { ArtifactPathSchema } from "../src/engine/completion/evidence.ts";
import { resolveContainedProjectWritePath } from "../src/shared/project_path.ts";
import type { EnvReader } from "../src/shared/env.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import {
  evaluateModuleCoverage,
  lcovReportArgs,
  renderTable,
  srcCoverageUrlPrefix,
  srcLineCoverage,
} from "./coverage_lib.ts";
import {
  pruneAndShardProfiles,
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
  opts: { capture?: boolean; cwd?: string } = {},
): Promise<string> {
  const result = await denoCommand(args, {
    stdout: opts.capture ? "piped" : "inherit",
    stderr: "inherit",
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  }).output();
  if (!result.success) {
    throw new Error(`deno ${args[0]} failed (exit ${result.code}).`);
  }
  return opts.capture ? new TextDecoder().decode(result.stdout) : "";
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
  const settled = await Promise.allSettled(
    summary.shardDirs.map((dir) =>
      deno(lcovReportArgs(dir, repoRoot), { capture: true, cwd: repoRoot })
    ),
  );
  const reports: string[] = [];
  const failures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") reports.push(result.value);
    else failures.push(result.reason);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "coverage reporting failed after every shard settled",
    );
  }
  return reports;
}

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Run the canonical suite exactly once, collecting only raw V8 profiles. */
async function instrumentSuite(
  profile: string,
  reporter: readonly string[] = [],
  repoRoot: string = REPO_ROOT,
): Promise<void> {
  await deno([
    "task",
    "test",
    `--coverage=${profile}`,
    "--coverage-raw-data-only",
    ...reporter,
  ], { cwd: repoRoot });
}

/**
 * Produce one LCOV artifact from one instrumented suite. All report shards and
 * scratch cleanup finish before this producer can publish successful output.
 * The injected suite capability lets integration fixtures use a small real suite.
 */
export async function produceCoverage(
  repoRoot: string = REPO_ROOT,
  runSuite: (profile: string) => Promise<void> = (profile) =>
    instrumentSuite(profile, [], repoRoot),
): Promise<string> {
  const started = SYSTEM_CLOCK.monotonicNow();
  let suiteFinished = started;
  let reportsFinished = started;
  const lcov = await withToolTempDir("coverage-profile", async (profile) => {
    await runSuite(profile);
    suiteFinished = SYSTEM_CLOCK.monotonicNow();
    const reports = await shardedLcovReports(profile, repoRoot);
    reportsFinished = SYSTEM_CLOCK.monotonicNow();
    return reports.join("\n");
  });
  const finished = SYSTEM_CLOCK.monotonicNow();
  console.error(
    `coverage producer: 1 instrumented suite; ` +
      `suite ${((suiteFinished - started) / 1000).toFixed(1)}s; ` +
      `reports ${((reportsFinished - suiteFinished) / 1000).toFixed(1)}s; ` +
      `cleanup ${((finished - reportsFinished) / 1000).toFixed(1)}s`,
  );
  return lcov;
}

/** Extract every coverage reading using the existing LCOV parser and Git census. */
export async function coverageReadings(
  lcov: string,
  repoRoot: string = REPO_ROOT,
): Promise<string> {
  const modules = await sourceModuleUniverse(repoRoot);
  const cov = srcLineCoverage([lcov], repoRoot, modules);
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
  return [
    `DISCERN_METRIC coverage ${cov.pct.toFixed(1)}`,
    `DISCERN_METRIC module_coverage_failures ${moduleEvaluation.failureCount}`,
    `DISCERN_METRIC module_coverage_exceptions ${MODULE_COVERAGE_EXCEPTIONS.length}`,
  ].join("\n");
}

/** Write the producer output for the engine to capture into its attempt identity. */
export async function writeCoverageArtifact(
  repoRoot: string,
  path: string,
  lcov: string,
): Promise<void> {
  const destination = await resolveContainedProjectWritePath(
    repoRoot,
    ArtifactPathSchema.parse(path),
    "coverage artifact",
  );
  await Deno.mkdir(dirname(destination), { recursive: true });
  await Deno.writeTextFile(destination, lcov);
}

/** Resolve the repository gate reporter at the executable process boundary. */
export function coverageReporter(env: EnvReader = Deno.env): string {
  return env.get(DISCERN_ENVIRONMENT_VARIABLES.gateTestReporter) || "junit";
}

/** Run the shared metrics producer or an explicit artifact production/extraction. */
async function main(): Promise<void> {
  if (Deno.args.length === 0) {
    console.log(
      await coverageReadings(
        await produceCoverage(
          REPO_ROOT,
          (profile) =>
            instrumentSuite(profile, [`--reporter=${coverageReporter()}`]),
        ),
      ),
    );
  } else if (Deno.args.length === 1 && Deno.args[0] === "extract") {
    const lcov = await new Response(Deno.stdin.readable).text();
    console.log(await coverageReadings(lcov));
  } else if (
    (Deno.args.length === 2 || Deno.args.length === 3) &&
    Deno.args[0] === "produce" && Deno.args[1] !== undefined &&
    (Deno.args[2] === undefined || /^--reporter=.+$/.test(Deno.args[2]))
  ) {
    const path = ArtifactPathSchema.parse(Deno.args[1]);
    const lcov = await produceCoverage(
      REPO_ROOT,
      (profile) => instrumentSuite(profile, Deno.args.slice(2)),
    );
    await writeCoverageArtifact(REPO_ROOT, path, lcov);
    console.error(`coverage artifact: ${path}`);
  } else {
    throw new Error(
      "Usage: coverage.ts [produce <project-relative.lcov> [--reporter=<format>] | extract]",
    );
  }
}

if (import.meta.main) await main();
