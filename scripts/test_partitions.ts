/** Native test partitions remain one awaited suite and one complete report. */
import { join } from "@std/path";
import { cksumString } from "../src/shared/crc.ts";
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
import { priorityFile, type TestPriority } from "./test_priority.ts";

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
  selection: readonly string[],
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
    ...selection,
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
  const checkArgs = [
    ...args.filter((arg) =>
      !/^--(?:coverage(?:=|$)|coverage-raw-data-only$|reporter=|junit-path=)/
        .test(arg)
    ),
    "--no-run",
  ];
  const child = await runOwnedChild(Deno.execPath(), {
    ...options,
    args: checkArgs,
  });
  console.error(
    `Test graph preparation: ${
      ((SYSTEM_CLOCK.monotonicNow() - started) / 1000).toFixed(1)
    }s.`,
  );
  return child.status.success ? 0 : 1;
}

/** Stable seeded admission with priority hints that never remove a native shard. */
export function partitionOrder(
  count: number,
  concurrency: number,
  seed?: number,
  preferred: readonly number[] = [],
): number[] {
  const workers = Math.min(concurrency, count);
  const span = Math.ceil(count / workers);
  const order: number[] = [];
  for (let round = 0; round < span; round++) {
    for (let worker = 0; worker < workers; worker++) {
      const index = worker * span + round;
      if (index < count) order.push(index);
    }
  }
  if (seed !== undefined) {
    // Hash before sorting so comparison does no repeated encoding or CRC work.
    const weights = order.map((index) => cksumString(`${seed}:${index}`));
    const byIndex = new Map(
      order.map((index, at) => [index, weights[at] ?? 0]),
    );
    order.sort((a, b) => (byIndex.get(a) ?? 0) - (byIndex.get(b) ?? 0));
  }
  const priority = new Set(preferred);
  return order.sort((a, b) =>
    Number(priority.has(b)) - Number(priority.has(a))
  );
}

/** Split priority files from the remaining native selection without extra processes. */
export function partitionSelections(
  count: number,
  seed: number | undefined,
  priority?: TestPriority,
): {
  readonly selections: readonly (readonly string[])[];
  readonly preferred: readonly number[];
} {
  const ordinary = {
    selections: Array.from(
      { length: count },
      (_, index) => [`--shard=${index + 1}/${count}`],
    ),
    preferred: [],
  };
  if (
    priority === undefined || count < 2 ||
    !Number.isSafeInteger(priority.moduleCount) || priority.moduleCount < 1 ||
    priority.excluded.some((path) => path.includes(","))
  ) return ordinary;
  const sorted = [...new Set(priority.files)].filter(priorityFile).sort();
  if (sorted.length === 0 || sorted.length >= priority.moduleCount) {
    return ordinary;
  }
  const files = partitionOrder(sorted.length, 1, seed).flatMap((index) =>
    sorted[index] ?? []
  );
  const groups = Math.min(
    files.length,
    count - 1,
    Math.max(1, Math.ceil(count * files.length / priority.moduleCount)),
  );
  const selections = Array.from(
    { length: groups },
    () => ["--permit-no-files"],
  );
  files.forEach((file, index) => selections[index % groups]?.push(file));
  const remaining = count - groups;
  for (let index = 0; index < remaining; index++) {
    selections.push([
      `--shard=${index + 1}/${remaining}`,
      "--permit-no-files",
      // Native --ignore replaces test.exclude; carry its complete configured list.
      `--ignore=${[...priority.excluded, ...files].join(",")}`,
    ]);
  }
  return {
    selections,
    preferred: Array.from({ length: groups }, (_, index) => index),
  };
}

/** Refill bounded native process slots and settle every active child on failure. */
async function runPartitionChildren(
  args: readonly string[],
  reports: readonly string[],
  concurrency: number,
  options: OwnedChildOptions,
  order: readonly number[],
  selections: readonly (readonly string[])[],
): Promise<{ code: number; completed: number }> {
  const runtimeArgs = args.includes("--no-check") ? args : [
    ...args.filter((arg) => !/^--(?:no-)?check(?:=|$)/.test(arg)),
    "--no-check",
  ];
  const workers = Math.min(concurrency, reports.length);
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
            selections[index] ?? [],
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

/** Explicit native selectors and alternate configs retain their original partition selection. */
export function prioritySafeArguments(args: readonly string[]): boolean {
  return args[0] === "test" &&
    args.slice(1).every((arg) =>
      /^--(?:allow-(?:read|write|env|run|sys)|parallel|shuffle=\d+|reporter=(?:junit|pretty|dot)|coverage=.+|coverage-raw-data-only|no-check|no-lock)$/
        .test(arg)
    );
}

/** Settle every admitted child; a stopped suite cannot publish a complete report. */
export async function runTestPartitions(
  args: readonly string[],
  count: number,
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    readonly concurrency?: number;
    readonly seed?: number;
    readonly priority?: (
      signal: AbortSignal,
    ) => Promise<TestPriority | undefined>;
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
        env: { ...options.env, DENO_JOBS: "1" },
        signal,
        resumeAfterInterrupt: true,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      };
      const prepared = await prepareTestGraph(args, childOptions);
      if (prepared !== 0 || signal.aborted) return { code: 1 };
      const priority = prioritySafeArguments(args)
        ? await options.priority?.(signal)
        : undefined;
      if (signal.aborted) return { code: 1 };
      const allocation = partitionSelections(count, options.seed, priority);
      const partitionCount = count;
      const reports = Array.from(
        { length: partitionCount },
        (_, index) => join(directory, `${index + 1}.xml`),
      );
      if (options.seed !== undefined) {
        console.error(
          `Test allocation: ${partitionCount} native partitions, ${
            Math.min(concurrency, partitionCount)
          } processes, one worker each.`,
        );
        if (allocation.preferred.length > 0) {
          console.error(
            `Test admission: ${allocation.preferred.length} priority partitions first; remaining native selection stays required.`,
          );
        }
      }
      const started = SYSTEM_CLOCK.monotonicNow();
      const { code, completed } = await runPartitionChildren(
        args,
        reports,
        concurrency,
        childOptions,
        partitionOrder(
          count,
          concurrency,
          options.seed,
          allocation.preferred,
        ),
        allocation.selections,
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
