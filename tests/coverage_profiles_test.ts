/**
 * Raw-profile pruning must never discard coverage the report filter would keep.
 *
 * The guard targets the defect class where a pre-report filter drifts from
 * the report include pattern and pruning silently deletes observations, so
 * coverage undercounts. Both surfaces derive from one shared src URL prefix,
 * classification is conservative — an unrecognized head shards anyway — and
 * the parity case here holds the pruner and the report pattern to the same
 * verdict for the same URLs.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  classifyRawProfileHead,
  isPrunableProfile,
  pruneAndShardProfiles,
  reportShardCount,
} from "../scripts/coverage_profiles.ts";
import {
  lcovReportArgs,
  srcCoverageUrlPrefix,
} from "../scripts/coverage_lib.ts";
import { withTempDir } from "./helpers.ts";

const REPO = "/repo/checkout";

/** Render one single-script raw profile body for a URL. */
function profile(url: string): string {
  return `{"scriptId":"42","url":"${url}","functions":[]}`;
}

Deno.test("profile heads classify single-script records and nothing else", () => {
  assertEquals(
    classifyRawProfileHead(profile("file:///repo/src/a.ts")),
    { kind: "single-script", url: "file:///repo/src/a.ts" },
  );
  assertEquals(
    classifyRawProfileHead(
      ' {\n"scriptId" : "7" , "url" : "file:///repo/src/b.ts"',
    ),
    { kind: "single-script", url: "file:///repo/src/b.ts" },
  );
  for (
    const head of [
      `{"result":[${profile("file:///repo/src/a.ts")}]}`,
      '{"url":"file:///repo/src/a.ts"}',
      '{"scriptId":"42","url":"file:///repo/sr',
      "not json at all",
      "",
    ]
  ) {
    assertEquals(classifyRawProfileHead(head), { kind: "opaque" });
  }
});

Deno.test("the pruner and the report include pattern reach one verdict per URL", () => {
  const prefix = srcCoverageUrlPrefix(REPO);
  const include = lcovReportArgs("profile-dir", REPO)
    .find((arg) => arg.startsWith("--include="));
  const pattern = new RegExp(include?.slice("--include=".length) ?? "(?!)");
  for (
    const url of [
      `file://${REPO}/src/engine/dispatch.ts`,
      `file://${REPO}/src/main.ts`,
      `file://${REPO}/site/build.ts`,
      `file://${REPO}/src-not/module.ts`,
      "file:///Users/anyone/Library/Caches/deno/npm/pkg/index.js",
      "https://jsr.io/@scope/pkg/1.0.0/mod.ts",
    ]
  ) {
    assertEquals(
      isPrunableProfile({ kind: "single-script", url }, prefix),
      !pattern.test(url),
      url,
    );
  }
  assertEquals(isPrunableProfile({ kind: "opaque" }, prefix), false);
});

Deno.test("report shard count leaves scheduler headroom and never reaches zero", () => {
  assertEquals(reportShardCount(16), 14);
  assertEquals(reportShardCount(4), 2);
  assertEquals(reportShardCount(3), 1);
  assertEquals(reportShardCount(1), 1);
  assertEquals(reportShardCount(0), 1);
  assertEquals(reportShardCount(Number.NaN), 1);
});

Deno.test("pruning excludes only identified foreign profiles and shards the rest", async () => {
  await withTempDir(async (dir) => {
    const prefix = srcCoverageUrlPrefix(REPO);
    const seeded: Record<string, string> = {
      "aa.json": profile(`file://${REPO}/src/engine/dispatch.ts`),
      "bb.json": profile(`file://${REPO}/src/shared/config.ts`),
      "cc.json": profile("file:///caches/deno/npm/pkg/index.js"),
      "dd.json": `{"result":[${profile("file:///caches/deno/other.js")}]}`,
    };
    for (const [name, body] of Object.entries(seeded)) {
      await Deno.writeTextFile(join(dir, name), body);
    }
    await Deno.writeTextFile(join(dir, "notes.txt"), "not a profile");

    const summary = await pruneAndShardProfiles(dir, prefix, 2, 2);
    assertEquals(summary.pruned, 1);
    assertEquals(summary.sharded, 3);
    assertEquals(summary.opaque, 1);
    assert(summary.shardDirs.length >= 1 && summary.shardDirs.length <= 2);

    const rootNames: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) rootNames.push(entry.name);
    }
    assertEquals(rootNames.sort(), ["cc.json", "notes.txt"]);

    const shardedNames: string[] = [];
    for (const shard of summary.shardDirs) {
      for await (const entry of Deno.readDir(shard)) {
        shardedNames.push(entry.name);
      }
    }
    assertEquals(shardedNames.sort(), ["aa.json", "bb.json", "dd.json"]);
  });
});
