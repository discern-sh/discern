/** Structural guard for one-shot lifecycle trunk resolution. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const RAW_TRUNK = ["ctx", "config", "repository", "trunk"].join("\\.");
const RAW_TRUNK_PATTERN = new RegExp(RAW_TRUNK, "gu");
const RESOLVED_TRUNK_PATTERN = new RegExp(
  `integrationBranch\\(\\s*${RAW_TRUNK}\\s*\\)`,
  "gu",
);

/** Find lifecycle config reads that bypass the sole env-aware resolver. */
function unresolvedTrunkReads(path: string, source: string): string[] {
  const withoutResolvedReads = source.replaceAll(RESOLVED_TRUNK_PATTERN, "");
  return [...withoutResolvedReads.matchAll(RAW_TRUNK_PATTERN)].map((match) => {
    const before = withoutResolvedReads.slice(0, match.index);
    const line = before.split("\n").length;
    return `${path}:${line}`;
  });
}

Deno.test("lifecycle code carries resolved trunk names instead of rereading raw config", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard:
        "tests/lifecycle_trunk_resolution_guard_test.ts#resolved-lifecycle-trunk",
      universe: "authored-ts",
    })
  ) {
    offenders.push(...unresolvedTrunkReads(
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ));
  }
  assertEquals(
    offenders,
    [],
    "pass raw lifecycle trunk config only to integrationBranch(), then carry its resolved name through every boundary",
  );
});
