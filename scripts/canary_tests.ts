/**
 * Run the canary test subset — the hot, cheap members the registry derives —
 * with the suite's own permission set and native Deno parallelism.
 *
 * The full suite's runtime preflight is deliberately absent: it guards the
 * site-smoke runtime, no canary member needs it, and the canary must stay a
 * seconds-scale read on the tree.
 */

import { canaryTestFiles } from "./canary_registry.ts";
import { testCommandArgs } from "./run_tests.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";

/** Repo-relative paths of every test module directly under `dir`. */
export async function listTestModules(
  dir: string = "tests",
): Promise<string[]> {
  const modules: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith("_test.ts")) {
      modules.push(`${dir}/${entry.name}`);
    }
  }
  return modules;
}

if (import.meta.main) {
  const files = canaryTestFiles(await listTestModules());
  const child = await runOwnedChild(Deno.execPath(), {
    args: testCommandArgs(files),
  });
  Deno.exit(child.status.code);
}
