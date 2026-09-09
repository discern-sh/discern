/** Run the repository suite with runtime preflight and native Deno parallelism. */

import {
  preflightTestRuntime,
  testPreflightFailureMessage,
} from "./test_preflight.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { fromFileUrl } from "@std/path";
import type { EnvReader } from "../src/shared/env.ts";
import { resolveIdentity } from "../src/engine/worktree/identity.ts";
import { runTestPartitions, testPartitionCount } from "./test_partitions.ts";

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

/** Bound macOS fork contention while preserving an explicit caller allocation. */
export function testWorkerEnvironment(
  os: typeof Deno.build.os,
  env: EnvReader = Deno.env,
): Record<string, string> {
  const requested = env.get("DENO_JOBS");
  if (requested !== undefined) return { DENO_JOBS: requested };
  return os === "darwin" ? { DENO_JOBS: "3" } : {};
}

if (import.meta.main) {
  const preflight = preflightTestRuntime();
  if (!preflight.ok) {
    console.error(testPreflightFailureMessage(preflight));
    Deno.exit(1);
  }

  const identitySeed = await testIdentitySeed();
  console.error(
    testSeedAnnouncement(effectiveTestSeed(identitySeed, Deno.args)),
  );
  const count = testPartitionCount(
    Deno.build.os,
    navigator.hardwareConcurrency,
    Deno.args,
  );
  const args = testCommandArgs(identitySeed, Deno.args);
  if (count > 1) {
    const concurrency = Math.min(count, navigator.hardwareConcurrency);
    const result = await runTestPartitions(args, count, {
      concurrency,
      scheduleModules: true,
      failFast: true,
    });
    if (result.report !== undefined) console.log(result.report);
    Deno.exit(result.code);
  }
  const child = await runOwnedChild(Deno.execPath(), {
    args,
    env: testWorkerEnvironment(Deno.build.os),
  });
  Deno.exit(child.status.code);
}
