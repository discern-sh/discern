/** Run the repository suite with runtime preflight and native Deno parallelism. */

import {
  preflightTestRuntime,
  testPreflightFailureMessage,
} from "./test_preflight.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { fromFileUrl, join } from "@std/path";
import type { EnvReader } from "../src/shared/env.ts";
import { withoutDeskSessionEnv } from "../src/engine/desk/session.ts";
import { resolveIdentity } from "../src/engine/worktree/identity.ts";
import {
  type CoveragePartitionObserver,
  runTestPartitions,
  testPartitionCount,
} from "./test_partitions.ts";
import { discoverTestPriority } from "./test_priority.ts";
import {
  loadTestDurationHints,
  TEST_DURATION_HINTS_PATH,
} from "./test_durations.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Parse one caller-supplied explicit shuffle seed, refusing bare randomness. */
export function explicitShuffleSeed(
  forwarded: readonly string[],
): number | undefined {
  const flags = forwarded.filter((arg) =>
    arg === "--shuffle" || arg.startsWith("--shuffle=")
  );
  if (flags.length === 0) return undefined;
  if (flags.length > 1) {
    throw new TypeError("Pass at most one explicit --shuffle=<seed> value.");
  }
  const flag = flags[0];
  if (flag === undefined || flag === "--shuffle") {
    throw new TypeError(
      "Bare --shuffle cannot be replayed; pass --shuffle=<seed>.",
    );
  }
  const raw = flag.slice("--shuffle=".length);
  const seed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(seed)) {
    throw new TypeError(
      `Invalid shuffle seed '${raw}'; use a non-negative integer.`,
    );
  }
  return seed;
}

/** The caller's explicit seed when present, otherwise checkout identity. */
export function effectiveTestSeed(
  identitySeed: number,
  forwarded: readonly string[],
): number {
  return explicitShuffleSeed(forwarded) ?? identitySeed;
}

/** One stable line every suite runner prints before Deno starts. */
export function testSeedAnnouncement(seed: number): string {
  return `Test shuffle seed: ${seed}`;
}

/** Resolve the current checkout's structured-state test seed. */
export async function testIdentitySeed(
  root: string = REPO_ROOT,
): Promise<number> {
  return (await resolveIdentity(root, root)).seed;
}

/** Build the internally parallel, explicitly shuffled Deno command. */
export function testCommandArgs(
  identitySeed: number,
  forwarded: readonly string[],
): string[] {
  const seed = effectiveTestSeed(identitySeed, forwarded);
  return [
    "test",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "--allow-sys",
    "--parallel",
    `--shuffle=${seed}`,
    ...forwarded.filter((arg) =>
      arg !== "--shuffle" && !arg.startsWith("--shuffle=")
    ),
  ];
}

/**
 * The environment every test worker inherits. The desk marker is blanked so a
 * suite launched from a desk-owned shell spawns the same children as one
 * launched anywhere else; the workers, and every process they spawn, inherit
 * the blank. macOS fork contention is bounded while preserving an explicit
 * caller allocation.
 */
export function testWorkerEnvironment(
  os: typeof Deno.build.os,
  env: EnvReader = Deno.env,
): Record<string, string> {
  const requested = env.get("DENO_JOBS");
  const jobs = requested !== undefined
    ? { DENO_JOBS: requested }
    : os === "darwin"
    ? { DENO_JOBS: "3" }
    : {};
  return { ...withoutDeskSessionEnv(), ...jobs };
}

/** Shared suite entry; task wrappers retain ownership of the test-queue permit. */
export async function runTests(
  forwarded: readonly string[],
  options: {
    readonly root?: string;
    readonly signal?: AbortSignal;
    readonly resumeAfterInterrupt?: boolean;
    readonly coveragePartitions?: CoveragePartitionObserver;
  } = {},
): Promise<number> {
  const preflight = preflightTestRuntime();
  if (!preflight.ok) {
    console.error(testPreflightFailureMessage(preflight));
    return 1;
  }
  const root = options.root ?? REPO_ROOT;
  const identitySeed = await testIdentitySeed(root);
  const seed = effectiveTestSeed(identitySeed, forwarded);
  console.error(testSeedAnnouncement(seed));
  const count = testPartitionCount(
    Deno.build.os,
    navigator.hardwareConcurrency,
    forwarded,
  );
  const args = testCommandArgs(identitySeed, forwarded);
  const childOptions = {
    ...(options.root === undefined ? {} : { cwd: options.root }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.resumeAfterInterrupt === undefined
      ? {}
      : { resumeAfterInterrupt: options.resumeAfterInterrupt }),
  };
  if (count > 1) {
    const concurrency = Math.min(count, navigator.hardwareConcurrency);
    const durations = await loadTestDurationHints(
      join(root, TEST_DURATION_HINTS_PATH),
    );
    const result = await runTestPartitions(args, count, {
      ...childOptions,
      concurrency,
      seed,
      priority: (signal) => discoverTestPriority(root, signal),
      ...(durations === undefined ? {} : { durations }),
      ...(options.coveragePartitions === undefined
        ? {}
        : { coveragePartitions: options.coveragePartitions }),
    });
    if (result.report !== undefined) console.log(result.report);
    return result.code;
  }
  const child = await runOwnedChild(Deno.execPath(), {
    ...childOptions,
    args,
    env: testWorkerEnvironment(Deno.build.os),
  });
  return child.status.code;
}

if (import.meta.main) Deno.exit(await runTests(Deno.args));
