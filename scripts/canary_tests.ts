/**
 * Run the canary test subset — the hot, cheap members the registry derives —
 * with the suite's own permission set and native Deno parallelism.
 *
 * The full suite's runtime preflight is deliberately absent: it guards the
 * site-smoke runtime, no canary member needs it, and the canary must stay a
 * seconds-scale read on the tree.
 */

import { listTestModules } from "./test_modules.ts";
export { listTestModules } from "./test_modules.ts";
import { canaryTestFiles } from "./canary_registry.ts";
import {
  effectiveTestSeed,
  testCommandArgs,
  testIdentitySeed,
  testSeedAnnouncement,
  testWorkerEnvironment,
} from "./run_tests.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";

/** Build the canary invocation while preserving every caller argument. */
export function canaryCommandArgs(
  identitySeed: number,
  files: readonly string[],
  forwarded: readonly string[],
): string[] {
  return testCommandArgs(identitySeed, [...forwarded, ...files]);
}

if (import.meta.main) {
  const files = canaryTestFiles(await listTestModules());
  const identitySeed = await testIdentitySeed();
  console.error(
    testSeedAnnouncement(effectiveTestSeed(identitySeed, Deno.args)),
  );
  const child = await runOwnedChild(Deno.execPath(), {
    args: canaryCommandArgs(identitySeed, files, Deno.args),
    env: testWorkerEnvironment(Deno.build.os),
  });
  Deno.exit(child.status.code);
}
