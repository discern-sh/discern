/** Native test partitions remain one awaited suite and one complete report. */
import { join } from "@std/path";
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
): string {
  if (reports.length === 0 || !Number.isFinite(seconds) || seconds < 0) {
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
    }">\n` +
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

/** Check complete native discovery before running its partitions. */
async function prepareTestGraph(
  args: readonly string[],
  options: OwnedChildOptions,
): Promise<number> {
  if (args.includes("--no-check")) return 0;
  const started = SYSTEM_CLOCK.monotonicNow();
  const child = await runOwnedChild(Deno.execPath(), {
    ...options,
    args: [
      ...args.filter((arg) =>
        !/^--(?:coverage(?:=|$)|coverage-raw-data-only$|reporter=|junit-path=)/
          .test(arg)
      ),
      "--no-run",
    ],
  });
  console.error(
    `Test graph preparation: ${
      ((SYSTEM_CLOCK.monotonicNow() - started) / 1000).toFixed(1)
    }s.`,
  );
  return child.status.success ? 0 : 1;
}

/** Refill bounded native process slots and settle every active child on failure. */
async function runPartitionChildren(
  args: readonly string[],
  reports: readonly string[],
  concurrency: number,
  options: OwnedChildOptions,
): Promise<number> {
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
  let cursor = 0;
  let code = 0;
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
        if (!child.status.success) code = 1;
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (options.signal?.aborted) return 1;
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Test partitions failed after every child settled.",
    );
  }
  return code;
}

export interface PartitionedTestResult {
  readonly code: number;
  readonly report?: string;
}

/** Run every native partition, settling all children before reporting or cleanup. */
export async function runTestPartitions(
  args: readonly string[],
  count: number,
  options: {
    readonly cwd?: string;
    readonly signal?: AbortSignal;
    readonly concurrency?: number;
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
      const reports = Array.from(
        { length: count },
        (_, index) => join(directory, `${index + 1}.xml`),
      );
      const childOptions: OwnedChildOptions = {
        env: { DENO_JOBS: "1" },
        signal,
        resumeAfterInterrupt: true,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      };
      if (await prepareTestGraph(args, childOptions) !== 0 || signal.aborted) {
        return { code: 1 };
      }
      const started = SYSTEM_CLOCK.monotonicNow();
      const code = await runPartitionChildren(
        args,
        reports,
        concurrency,
        childOptions,
      );
      const seconds = (SYSTEM_CLOCK.monotonicNow() - started) / 1000;
      if (signal.aborted) return { code: 1 };
      if (!args.includes("--reporter=junit")) {
        return { code };
      }
      const texts: string[] = [];
      for (const path of reports) {
        texts.push(await Deno.readTextFile(path));
      }
      return { code, report: combineJunitReports(texts, seconds) };
    });
  } finally {
    for (const [interrupt, handler] of handlers) {
      Deno.removeSignalListener(interrupt, handler);
    }
  }
  if (interruptedBy !== null) reraiseInterrupt(interruptedBy);
  return result;
}
