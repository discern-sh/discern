/**
 * Instrument the canonical repository suite once and derive all coverage metrics.
 *
 * With no arguments, measure and print metrics for the current public standards.
 * `produce <path>` writes LCOV for the validation engine's attempt-owned artifact
 * capture; `extract` reads captured LCOV on stdin and prints all three readings.
 * Both modes share the Git-derived module universe, parser, and held thresholds.
 * Failed suites still report diagnostic coverage, then fail without publishing
 * an artifact or successful metrics. Raw profiles are sharded by module URL
 * before reporting; scratch cleanup is
 * awaited before success so the producer leaves no detached cleanup process.
 */
import { dirname, fromFileUrl, join } from "@std/path";
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
  type ProfileShardingSummary,
  type pruneAndShardProfiles,
  reportShardCount,
} from "./coverage_profiles.ts";
import {
  MODULE_COVERAGE_EXCEPTIONS,
  MODULE_LINE_COVERAGE_FLOOR,
} from "./module_coverage_exceptions.ts";
import { sourceModuleUniverse } from "./source_module_universe.ts";
import { withToolTempDir } from "./temp_dir.ts";
import { CoverageProfilePartitions } from "./coverage_partitions.ts";
import { runTests } from "./run_tests.ts";
import type { CoveragePartitionObserver } from "./test_partitions.ts";
import { superviseSpawn } from "../src/engine/owned_child.ts";
import {
  INTERRUPT_SIGNALS,
  reraiseInterrupt,
} from "../src/engine/process_signals.ts";

/** Build one `deno` subcommand invocation — the sole construction site. */
function denoCommand(args: string[], io: Deno.CommandOptions): Deno.Command {
  return new Deno.Command(Deno.execPath(), { ...io, args });
}

/** Await one native coverage reporter through the shared child lifetime. */
async function nativeLcov(
  directory: string,
  root: string,
  signal: AbortSignal,
): Promise<string> {
  const run = await superviseSpawn(
    () =>
      denoCommand(lcovReportArgs(directory, root), {
        cwd: root,
        stdin: "null",
        stdout: "piped",
        stderr: "inherit",
      }).spawn(),
    (child) => child.output(),
    { isolatedGroup: false, resumeAfterInterrupt: true, signal },
  );
  if (!run.value.success) {
    throw new Error(`deno coverage failed (exit ${run.value.code}).`);
  }
  return new TextDecoder().decode(run.value.stdout);
}

/**
 * Report completed profile shards concurrently, settling every native reader
 * before returning LCOV or a reporting failure.
 */
async function shardedLcovReports(
  summary: ProfileShardingSummary,
  repoRoot: string,
  signal: AbortSignal,
): Promise<string[]> {
  console.error(
    `coverage profiles: ${summary.sharded} sharded across ` +
      `${summary.shardDirs.length} report passes; ${summary.pruned} non-src ` +
      `pruned; ${summary.compacted} repeated observations compacted; ` +
      `${summary.opaque} unrecognized kept for the report filter`,
  );
  console.error(
    `coverage profile cost: ${
      JSON.stringify({
        input_files: summary.input_files,
        read_bytes: summary.read_bytes,
        enumeration_ms: summary.enumeration_ms,
        classification_ms: summary.classification_ms,
        compaction_ms: summary.compaction_ms,
        weighted_parse_ms: summary.weighted_parse_ms,
      })
    }`,
  );
  const reportStarted = SYSTEM_CLOCK.monotonicNow();
  const settled = await Promise.allSettled(
    summary.shardDirs.map((dir) => nativeLcov(dir, repoRoot, signal)),
  );
  console.error(`coverage report cost: ${
    JSON.stringify({
      processes: summary.shardDirs.length,
      elapsed_ms: SYSTEM_CLOCK.monotonicNow() - reportStarted,
    })
  }`);
  const reports: string[] = [];
  const failures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") reports.push(result.value);
    else failures.push(result.reason);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `coverage reporting failed after every shard settled: ${summary.input_files} raw profiles, ${summary.read_bytes} bytes read, ${summary.sharded} retained, ${summary.pruned} outside src, ${summary.opaque} unrecognized. Inspect the native error; an unrecognized header alone does not establish its cause.`,
    );
  }
  return reports;
}

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Coverage provides ownership controls while the canonical runner owns selection. */
export interface CoverageSuiteControls {
  readonly signal: AbortSignal;
  readonly coveragePartitions: CoveragePartitionObserver;
}

/** Run the canonical suite exactly once, collecting raw V8 profiles. */
async function instrumentSuite(
  profile: string,
  controls: CoverageSuiteControls,
  reporter: readonly string[] = [],
  repoRoot: string = REPO_ROOT,
): Promise<void> {
  const code = await runTests([
    `--coverage=${profile}`,
    "--coverage-raw-data-only",
    ...reporter,
  ], {
    root: repoRoot,
    signal: controls.signal,
    resumeAfterInterrupt: true,
    coveragePartitions: controls.coveragePartitions,
  });
  if (code !== 0) {
    throw new Error(`The instrumented test suite failed (exit ${code}).`);
  }
}

/**
 * Produce one LCOV artifact from one instrumented suite. All report shards and
 * scratch cleanup finish before this producer can publish successful output.
 * The injected suite capability lets integration fixtures use a small real suite.
 */
export async function produceCoverage(
  repoRoot: string = REPO_ROOT,
  runSuite: (
    profile: string,
    controls: CoverageSuiteControls,
  ) => Promise<void> = (profile, controls) =>
    instrumentSuite(profile, controls, [], repoRoot),
  options: {
    readonly signal?: AbortSignal;
    readonly processProfiles?: typeof pruneAndShardProfiles;
  } = {},
): Promise<string> {
  const started = SYSTEM_CLOCK.monotonicNow();
  let suiteFinished = started;
  let reportsFinished = started;
  let suiteAttempted = false;
  const controller = new AbortController();
  const signal = options.signal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, options.signal]);
  let interruptedBy: Deno.Signal | null = null;
  const handlers = new Map<Deno.Signal, () => void>();
  for (const interrupt of INTERRUPT_SIGNALS) {
    const handler = (): void => {
      interruptedBy ??= interrupt;
      controller.abort();
    };
    handlers.set(interrupt, handler);
    Deno.addSignalListener(interrupt, handler);
  }
  let outcome: { value: string } | { error: unknown };
  try {
    const value = await withToolTempDir(
      "coverage-profile",
      async (directory) => {
        const profile = join(directory, "raw");
        await Deno.mkdir(profile);
        const profiles = new CoverageProfilePartitions({
          raw: profile,
          reports: join(directory, "reports"),
          prefix: srcCoverageUrlPrefix(repoRoot),
          shards: reportShardCount(navigator.hardwareConcurrency),
          ...(options.processProfiles === undefined
            ? {}
            : { process: options.processProfiles }),
        });
        const stop = (): void => profiles.stop();
        signal.addEventListener("abort", stop, { once: true });
        try {
          suiteAttempted = true;
          let suiteFailure: { error: unknown } | undefined;
          try {
            signal.throwIfAborted();
            await runSuite(profile, { signal, coveragePartitions: profiles });
          } catch (error) {
            suiteFailure = { error };
          }
          suiteFinished = SYSTEM_CLOCK.monotonicNow();
          let lcov: string;
          try {
            signal.throwIfAborted();
            const summary = await profiles.finish(suiteFailure === undefined);
            signal.throwIfAborted();
            const reports = await shardedLcovReports(summary, repoRoot, signal);
            signal.throwIfAborted();
            lcov = reports.join("\n");
            if (suiteFailure === undefined && lcov.trim() === "") {
              throw new Error(
                "The instrumented suite produced no reportable coverage. The profile inventory and native report diagnostics above distinguish missing inputs from filtered or unrecognized data; no successful coverage artifact is published.",
              );
            }
            if (suiteFailure !== undefined && reports.length > 0) {
              console.error(
                "Coverage from the failed suite is diagnostic only; no evidence is published.",
              );
              await coverageReadings(lcov, repoRoot);
            }
          } catch (reportFailure) {
            signal.throwIfAborted();
            if (suiteFailure !== undefined) {
              throw new AggregateError(
                [suiteFailure.error, reportFailure],
                "the instrumented suite and its coverage reporting both failed",
                { cause: reportFailure },
              );
            }
            throw reportFailure;
          } finally {
            reportsFinished = SYSTEM_CLOCK.monotonicNow();
          }
          if (suiteFailure !== undefined) throw suiteFailure.error;
          return lcov;
        } finally {
          await profiles.stopAndWait();
          signal.removeEventListener("abort", stop);
        }
      },
    );
    outcome = { value };
  } catch (error) {
    outcome = { error };
  } finally {
    for (const [interrupt, handler] of handlers) {
      Deno.removeSignalListener(interrupt, handler);
    }
    const finished = SYSTEM_CLOCK.monotonicNow();
    if (suiteAttempted) {
      console.error(`coverage producer cost: ${
        JSON.stringify({
          instrumented_suites: 1,
          suite_ms: suiteFinished - started,
          reports_ms: reportsFinished - suiteFinished,
          cleanup_ms: finished - reportsFinished,
        })
      }`);
      console.error(
        `coverage producer: 1 instrumented suite; ` +
          `suite ${((suiteFinished - started) / 1000).toFixed(1)}s; ` +
          `reports ${
            ((reportsFinished - suiteFinished) / 1000).toFixed(1)
          }s; ` +
          `cleanup ${((finished - reportsFinished) / 1000).toFixed(1)}s`,
      );
    }
  }
  if (interruptedBy !== null) reraiseInterrupt(interruptedBy);
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

/** Extract every coverage reading using the existing LCOV parser and Git census. */
export async function coverageReadings(
  lcov: string,
  repoRoot: string = REPO_ROOT,
): Promise<string> {
  const discoveryStarted = SYSTEM_CLOCK.monotonicNow();
  const modules = await sourceModuleUniverse(repoRoot);
  const discovered = SYSTEM_CLOCK.monotonicNow();
  const cov = srcLineCoverage([lcov], repoRoot, modules);
  const moduleEvaluation = evaluateModuleCoverage(
    cov,
    MODULE_LINE_COVERAGE_FLOOR,
    MODULE_COVERAGE_EXCEPTIONS,
  );
  console.error(`coverage extraction cost: ${
    JSON.stringify({
      module_discovery_ms: discovered - discoveryStarted,
      parse_and_evaluate_ms: SYSTEM_CLOCK.monotonicNow() - discovered,
      lcov_characters: lcov.length,
      modules: modules.length,
    })
  }`);
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
          (profile, controls) =>
            instrumentSuite(profile, controls, [
              `--reporter=${coverageReporter()}`,
            ]),
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
      (profile, controls) =>
        instrumentSuite(profile, controls, Deno.args.slice(2)),
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
