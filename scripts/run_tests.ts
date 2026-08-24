/** Run the repository suite with fleet-aware Deno worker allocation. */

import { parse as parseToml } from "@std/toml";
import {
  preflightTestRuntime,
  testPreflightFailureMessage,
} from "./test_preflight.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";

/** Read the configured whole-suite admission cap from discern.toml. */
export function configuredConcurrentTestRuns(source: string): number {
  const parsed = parseToml(source);
  const gate = parsed.gate;
  if (typeof gate !== "object" || gate === null || Array.isArray(gate)) {
    throw new TypeError("discern.toml has no [gate] table");
  }
  const value = (gate as Record<string, unknown>).concurrent_test_runs;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      "[gate].concurrent_test_runs must be a nonnegative integer",
    );
  }
  return value;
}

/** Split logical processors across every suite the fleet configuration can admit. */
export function testWorkerCount(
  logicalProcessors: number,
  concurrentRuns: number,
): number {
  if (!Number.isSafeInteger(logicalProcessors) || logicalProcessors < 1) {
    throw new TypeError("logical processor count must be a positive integer");
  }
  if (!Number.isSafeInteger(concurrentRuns) || concurrentRuns < 0) {
    throw new TypeError(
      "concurrent test-run cap must be a nonnegative integer",
    );
  }
  const shares = concurrentRuns === 0 ? 1 : concurrentRuns;
  return Math.max(1, Math.floor(logicalProcessors / shares));
}

/** Preserve an explicit DENO_JOBS override; otherwise derive the fleet share. */
export function testWorkerEnvironment(
  logicalProcessors: number,
  concurrentRuns: number,
  existing: string | undefined,
): Readonly<Record<string, string>> {
  return existing === undefined || existing === ""
    ? {
      DENO_JOBS: String(
        testWorkerCount(logicalProcessors, concurrentRuns),
      ),
    }
    : {};
}

if (import.meta.main) {
  const preflight = preflightTestRuntime();
  if (!preflight.ok) {
    console.error(testPreflightFailureMessage(preflight));
    Deno.exit(1);
  }

  const config = await Deno.readTextFile(
    new URL("../discern.toml", import.meta.url),
  );
  const cap = configuredConcurrentTestRuns(config);
  const child = await runOwnedChild(Deno.execPath(), {
    args: [
      "test",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-sys",
      "--parallel",
      ...Deno.args,
    ],
    env: testWorkerEnvironment(
      navigator.hardwareConcurrency,
      cap,
      Deno.env.get("DENO_JOBS"),
    ),
  });
  Deno.exit(child.status.code);
}
