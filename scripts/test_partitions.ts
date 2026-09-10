/** Native test partitions remain one awaited suite and one complete report. */
import { fromFileUrl, isAbsolute, join } from "@std/path";
import { colorResolvedEnv, stripAnsi } from "../src/shared/color_env.ts";
import { lstatIfExists, readTextIfExists } from "../src/shared/fs_presence.ts";
import type { EnvReader } from "../src/shared/env.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import {
  type OwnedChildOptions,
  runOwnedChild,
} from "../src/engine/owned_child.ts";
import {
  INTERRUPT_SIGNALS,
  reraiseInterrupt,
} from "../src/engine/process_signals.ts";
import { withToolTempDir } from "./temp_dir.ts";

/** Partition only complete runs whose forwarded options preserve native selection. */
export function testPartitionCount(
  os: typeof Deno.build.os,
  cores: number,
  forwarded: readonly string[],
  env: EnvReader = Deno.env,
): number {
  if (os !== "darwin" || env.get("DENO_JOBS") !== undefined) return 1;
  const compatible = forwarded.every((arg) =>
    /^--(?:shuffle=\d+|reporter=(?:junit|pretty|dot)|coverage=.+|coverage-raw-data-only)$/
      .test(arg)
  );
  const coverage = forwarded.some((arg) => arg.startsWith("--coverage="));
  if (
    !compatible ||
    (coverage && !forwarded.includes("--coverage-raw-data-only")) ||
    !Number.isSafeInteger(cores) || cores < 1
  ) return 1;
  const count = cores * 8;
  return cores > 1 && Number.isSafeInteger(count) ? count : 1;
}

/** Read a required native JUnit count without accepting an incomplete report. */
function junitCount(attributes: string, name: string): number {
  const matches = [
    ...attributes.matchAll(new RegExp(`\\b${name}="(\\d+)"`, "g")),
  ];
  const value = Number(matches[0]?.[1]);
  if (matches.length !== 1 || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Native JUnit report needs one valid ${name} count.`);
  }
  return value;
}

/** Preserve native case XML and combine counts under the suite's elapsed wall time. */
export function combineJunitReports(
  reports: readonly string[],
  seconds: number,
  expectedPartitions: number = reports.length,
  interrupted: boolean = false,
): string {
  if (
    reports.length === 0 || !Number.isFinite(seconds) || seconds < 0 ||
    !Number.isSafeInteger(expectedPartitions) ||
    expectedPartitions < reports.length
  ) {
    throw new TypeError(
      "A complete suite needs reports and a valid elapsed time.",
    );
  }
  const counts = { tests: 0, failures: 0, errors: 0 };
  const bodies: string[] = [];
  for (const report of reports) {
    const root =
      /^\s*(?:<\?xml[^?]*\?>\s*)?<testsuites\b([^>]*)>([\s\S]*)<\/testsuites>\s*$/
        .exec(report);
    if (root?.[1] === undefined || root[2] === undefined) {
      throw new TypeError(
        "A native test partition did not produce a complete JUnit report.",
      );
    }
    for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
      counts[name] += junitCount(root[1], name);
      if (!Number.isSafeInteger(counts[name])) {
        throw new TypeError(
          `Combined JUnit ${name} count is not an exact integer.`,
        );
      }
    }
    bodies.push(root[2]);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="deno test" tests="${counts.tests}" failures="${counts.failures}" errors="${counts.errors}" time="${
      seconds.toFixed(3)
    }" discern-selection="${
      !interrupted && reports.length === expectedPartitions
        ? "complete"
        : "incomplete"
    }" discern-reported-partitions="${reports.length}" discern-expected-partitions="${expectedPartitions}">\n` +
    bodies.join("\n") + "\n</testsuites>\n";
}

/** Give every native partition distinct output locations and its full selection share. */
function partitionArguments(
  args: readonly string[],
  index: number,
  count: number,
  reportPath: string,
): string[] {
  return [
    ...args.map((arg) =>
      arg === "--reporter=junit"
        ? "--reporter=dot"
        : arg.startsWith("--coverage=")
        ? `--coverage=${
          join(arg.slice("--coverage=".length), `test-shard-${index}`)
        }`
        : arg
    ),
    `--shard=${index}/${count}`,
    ...(args.includes("--reporter=junit")
      ? [`--junit-path=${reportPath}`]
      : []),
  ];
}

interface PreparedTestGraph {
  readonly code: number;
  readonly moduleSizes: readonly number[];
}

/** Native listing hints affect scheduling only; every native shard still runs.
 * Escapes are stripped before matching: parsing must not depend on the spawn
 * environment having resolved colour off. */
export async function listedModuleSizes(
  output: string,
  cwd: string = ".",
): Promise<number[]> {
  const sizes: number[] = [];
  for (const match of stripAnsi(output).matchAll(/^Check (.+)$/gm)) {
    const entry = match[1];
    if (entry === undefined) continue;
    const path = entry.startsWith("file:")
      ? fromFileUrl(entry)
      : isAbsolute(entry)
      ? entry
      : join(cwd, entry);
    sizes.push((await lstatIfExists(path))?.size ?? 0);
  }
  return sizes;
}

/** Check complete native discovery before running its partitions. */
async function prepareTestGraph(
  args: readonly string[],
  options: OwnedChildOptions,
  directory: string,
  scheduleModules: boolean,
): Promise<PreparedTestGraph> {
  if (args.includes("--no-check")) return { code: 0, moduleSizes: [] };
  const started = SYSTEM_CLOCK.monotonicNow();
  const checkArgs = [
    ...args.filter((arg) =>
      !/^--(?:coverage(?:=|$)|coverage-raw-data-only$|reporter=|junit-path=)/
        .test(arg)
    ),
    "--no-run",
  ];
  const captureListing = scheduleModules && Deno.build.os !== "windows";
  const listingPath = join(directory, "native-graph.log");
  // exec preserves the supervised process and group while redirecting only the
  // preparation log. Positional parameters preserve every literal argument.
  const child = await runOwnedChild(
    captureListing ? "/bin/sh" : Deno.execPath(),
    {
      ...options,
      ...(captureListing
        ? { env: { ...options.env, ...colorResolvedEnv() } }
        : {}),
      args: captureListing
        ? ["-c", 'exec "$@" 2>"$0"', listingPath, Deno.execPath(), ...checkArgs]
        : checkArgs,
    },
  );
  let moduleSizes: number[] = [];
  if (captureListing) {
    const output = await readTextIfExists(listingPath) ?? "";
    if (output.length > 0) console.error(output.trimEnd());
    if (child.status.success) {
      moduleSizes = await listedModuleSizes(output, options.cwd);
    }
  }
  console.error(
    `Test graph preparation: ${
      ((SYSTEM_CLOCK.monotonicNow() - started) / 1000).toFixed(1)
    }s.`,
  );
  return { code: child.status.success ? 0 : 1, moduleSizes };
}

/** Refill bounded native process slots and settle every active child on failure. */
async function runPartitionChildren(
  args: readonly string[],
  reports: readonly string[],
  concurrency: number,
  options: OwnedChildOptions,
  moduleSizes: readonly number[],
): Promise<{ code: number; completed: number }> {
  const runtimeArgs = args.includes("--no-check") ? args : [
    ...args.filter((arg) => !/^--(?:no-)?check(?:=|$)/.test(arg)),
    "--no-check",
  ];
  // Interleave the source universe so costly alphabetical regions start early.
  const workers = Math.min(concurrency, reports.length);
  const span = Math.ceil(reports.length / workers);
  const order: number[] = [];
  for (let round = 0; round < span; round++) {
    for (let worker = 0; worker < workers; worker++) {
      const index = worker * span + round;
      if (index < reports.length) order.push(index);
    }
  }
  if (moduleSizes.length === reports.length) {
    order.sort((left, right) =>
      (moduleSizes[right] ?? 0) - (moduleSizes[left] ?? 0)
    );
  }
  let cursor = 0;
  let code = 0;
  let completed = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (!options.signal?.aborted) {
      const index = order[cursor++];
      if (index === undefined) return;
      const report = reports[index];
      try {
        if (report === undefined) {
          throw new Error(`Missing native report destination ${index}`);
        }
        const child = await runOwnedChild(Deno.execPath(), {
          ...options,
          args: partitionArguments(
            runtimeArgs,
            index + 1,
            reports.length,
            report,
          ),
        });
        completed++;
        if (!child.status.success) code = 1;
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (options.signal?.aborted) return { code: 1, completed };
  if (failures.length > 0) {
    console.error(
      new AggregateError(
        failures,
        "Test partitions failed after every child settled.",
      ),
    );
    code = 1;
  }
  return { code, completed };
}

export interface PartitionedTestResult {
  readonly code: number;
  readonly report?: string;
  readonly selection?: "complete" | "incomplete";
}

/** Settle every admitted child; a stopped suite cannot publish a complete report. */
export async function runTestPartitions(
  args: readonly string[],
  count: number,
  options: {
    readonly cwd?: string;
    readonly signal?: AbortSignal;
    readonly concurrency?: number;
    readonly scheduleModules?: boolean;
  } = {},
): Promise<PartitionedTestResult> {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TypeError("Test partition count must be a positive integer.");
  }
  const concurrency = options.concurrency ?? count;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Test process concurrency must be a positive integer.");
  }
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
  let result: PartitionedTestResult;
  try {
    result = await withToolTempDir("test-reports", async (directory) => {
      const childOptions: OwnedChildOptions = {
        env: { DENO_JOBS: "1" },
        signal,
        resumeAfterInterrupt: true,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      };
      const graph = await prepareTestGraph(
        args,
        childOptions,
        directory,
        options.scheduleModules ?? false,
      );
      if (graph.code !== 0 || signal.aborted) return { code: 1 };
      const partitionCount = graph.moduleSizes.length || count;
      const reports = Array.from(
        { length: partitionCount },
        (_, index) => join(directory, `${index + 1}.xml`),
      );
      if (options.scheduleModules) {
        console.error(
          `Test allocation: ${partitionCount} native partitions, ${
            Math.min(concurrency, partitionCount)
          } processes, one worker each.`,
        );
      }
      const started = SYSTEM_CLOCK.monotonicNow();
      const { code, completed } = await runPartitionChildren(
        args,
        reports,
        concurrency,
        childOptions,
        graph.moduleSizes,
      );
      const seconds = (SYSTEM_CLOCK.monotonicNow() - started) / 1000;
      if (!args.includes("--reporter=junit")) {
        return {
          code: signal.aborted || completed !== partitionCount ? 1 : code,
        };
      }
      const texts: string[] = [];
      const unavailable: unknown[] = [];
      for (const path of reports) {
        try {
          const text = await Deno.readTextFile(path);
          combineJunitReports([text], 0);
          texts.push(text);
        } catch (error) {
          if (unavailable.length < 3) unavailable.push(error);
        }
      }
      const complete = !signal.aborted && completed === partitionCount &&
        texts.length === partitionCount;
      if (!complete) {
        console.error(
          `Test selection incomplete: ${texts.length}/${partitionCount} partition reports available. All admitted children settled. Report counts cover only those reports; missing tests have no verdict.`,
        );
        for (const error of unavailable) console.error(error);
      }
      const report = texts.length === 0
        ? undefined
        : combineJunitReports(texts, seconds, partitionCount, signal.aborted);
      // Preserve settled diagnostics before restoring killed-by-signal status.
      if (interruptedBy !== null && report !== undefined) console.log(report);
      return {
        code: complete ? code : 1,
        selection: complete ? "complete" : "incomplete",
        ...(report === undefined ? {} : { report }),
      };
    });
  } finally {
    for (const [interrupt, handler] of handlers) {
      Deno.removeSignalListener(interrupt, handler);
    }
  }
  if (interruptedBy !== null) reraiseInterrupt(interruptedBy);
  return result;
}
