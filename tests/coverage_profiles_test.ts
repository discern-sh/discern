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
import { FakeTime } from "@std/testing/time";
import { join } from "@std/path";
import {
  classifyRawProfileHead,
  isPrunableProfile,
  pruneAndShardProfiles,
  RawCoverageProfileSchema,
  reportShardCount,
} from "../scripts/coverage_profiles.ts";
import {
  lcovReportArgs,
  srcCoverageUrlPrefix,
} from "../scripts/coverage_lib.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

const REPO = "/repo/checkout";

/** Render one single-script raw profile body for a URL. */
function profile(url: string, scriptId = "42"): string {
  return `{"scriptId":"${scriptId}","url":"${url}","functions":[]}`;
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
      "bb.json": profile(`file://${REPO}/src/engine/dispatch.ts`, "43"),
      "cc.json": profile("file:///caches/deno/npm/pkg/index.js"),
      "dd.json": `{"result":[${profile("file:///caches/deno/other.js")}]}`,
      "ee.json": profile(`file://${REPO}/src/shared/config.ts`),
    };
    for (const [name, body] of Object.entries(seeded)) {
      await Deno.writeTextFile(join(dir, name), body);
    }
    await Deno.writeTextFile(join(dir, "notes.txt"), "not a profile");

    const summary = await pruneAndShardProfiles(dir, prefix, 3, 2);
    assertEquals(summary.input_files, Object.keys(seeded).length);
    assertEquals(
      summary.read_bytes,
      Object.values(seeded).reduce(
        (sum, text) => sum + new TextEncoder().encode(text).length,
        0,
      ),
    );
    assertEquals(summary.pruned, 1);
    assertEquals(summary.sharded, 4);
    assertEquals(summary.opaque, 1);
    assert(summary.shardDirs.length >= 1 && summary.shardDirs.length <= 3);

    const rootNames: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) rootNames.push(entry.name);
    }
    assertEquals(rootNames.sort(), ["notes.txt"]);

    const shardOf = new Map<string, string>();
    for (const shard of summary.shardDirs) {
      for await (const entry of Deno.readDir(shard)) {
        shardOf.set(entry.name, shard);
      }
    }
    assertEquals([...shardOf.keys()].sort(), [
      "0.json",
      "1.json",
      "3.json",
      "4.json",
    ]);
    assertEquals(
      shardOf.get("0.json"),
      shardOf.get("1.json"),
      "profiles for one module URL must share a shard so its range merge stays whole",
    );
  });
});

Deno.test("identical coverage observations compact while preserving every range count", async () => {
  await withTempDir(async (dir) => {
    const body = JSON.stringify({
      scriptId: "42",
      url: `file://${REPO}/src/decision.ts`,
      functions: [{
        functionName: "choose",
        isBlockCoverage: true,
        ranges: [
          { startOffset: 0, endOffset: 50, count: 2 },
          { startOffset: 20, endOffset: 30, count: 0 },
        ],
      }],
    });
    for (const name of ["a", "b", "c"]) {
      await Deno.writeTextFile(join(dir, `${name}.json`), body);
    }
    const summary = await pruneAndShardProfiles(
      dir,
      srcCoverageUrlPrefix(REPO),
      2,
      2,
      128 * 1024 * 1024,
      {
        monotonicNow: (() => {
          let tick = 0;
          return () => tick++;
        })(),
      },
    );
    assertEquals(summary.input_files, 3);
    assertEquals(summary.enumeration_ms, 1);
    assertEquals(summary.classification_ms, 1);
    assertEquals(summary.weighted_parse_ms, 1);
    assertEquals(summary.compaction_ms, 3);
    const profiles: string[] = [];
    for (const shard of summary.shardDirs) {
      for await (const entry of Deno.readDir(shard)) {
        profiles.push(await Deno.readTextFile(join(shard, entry.name)));
      }
    }
    assertEquals(profiles.length, 1);
    const remainingInputs: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) remainingInputs.push(entry.name);
    }
    assertEquals(
      remainingInputs,
      [],
      "discard redundant originals while processing owns their metadata",
    );

    assertEquals(decodeWith(RawCoverageProfileSchema, profiles[0] ?? "null"), {
      scriptId: "42",
      url: `file://${REPO}/src/decision.ts`,
      functions: [{
        functionName: "choose",
        isBlockCoverage: true,
        ranges: [
          { startOffset: 0, endOffset: 50, count: 6 },
          { startOffset: 20, endOffset: 30, count: 0 },
        ],
      }],
    });
  });
});

Deno.test("failed profile IO settles active siblings before returning to cleanup", async () => {
  for (const phase of ["read", "remove"]) {
    await withTempDir(async (dir) => {
      const body = profile("file:///foreign/module.ts");
      await Deno.writeTextFile(join(dir, "a.json"), body);
      await Deno.writeTextFile(join(dir, "b.json"), body);
      const entered = Promise.withResolvers<void>();
      const failed = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const read = Deno.readFile;
      const remove = Deno.remove;
      let siblingFinished = false;
      let settled = false;
      const fault = new Error(`controlled profile ${phase} failure`);
      const controlled = async <T>(
        path: string | URL,
        operation: () => Promise<T>,
      ): Promise<T> => {
        if (String(path) === join(dir, "a.json")) {
          await entered.promise;
          failed.resolve();
          throw fault;
        }
        if (String(path) === join(dir, "b.json")) {
          entered.resolve();
          await release.promise;
          const value = await operation();
          siblingFinished = true;
          return value;
        }
        return await operation();
      };
      Deno.readFile = (path, options) =>
        phase === "read"
          ? controlled(path, () => read(path, options))
          : read(path, options);
      Deno.remove = (path, options) =>
        phase === "remove"
          ? controlled(path, () => remove(path, options))
          : remove(path, options);
      const pending = pruneAndShardProfiles(
        dir,
        srcCoverageUrlPrefix(REPO),
        1,
        2,
      )
        .then(() => undefined, (error: unknown) => error);
      const observed = pending.then(() => {
        settled = true;
      });
      try {
        await failed.promise;
        using time = new FakeTime();
        await time.tickAsync(0);
        assertEquals(
          settled,
          false,
          `cleanup cannot start while a profile ${phase} still owns its input`,
        );
      } finally {
        release.resolve();
        await observed;
        Deno.readFile = read;
        Deno.remove = remove;
      }
      assert(siblingFinished);
      assert(await pending instanceof Error);
    });
  }
});

Deno.test("profile compaction preserves raw inputs when identities or counts cannot be represented", async () => {
  const common = { scriptId: "42", url: `file://${REPO}/src/future.ts` };
  const cases = [
    {
      body: JSON.stringify({ ...common, functions: "future format" }),
      budget: 1024,
    },
    { body: JSON.stringify({ result: [common] }), budget: 1024 },
    { body: profile(common.url), budget: 0 },
    {
      body: JSON.stringify({
        ...common,
        functions: [{
          functionName: "large",
          isBlockCoverage: true,
          ranges: [{
            startOffset: 0,
            endOffset: 10,
            count: Number.MAX_SAFE_INTEGER,
          }],
        }],
      }),
      budget: 1024,
    },
  ];
  for (const { body, budget } of cases) {
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(join(dir, "a.json"), body);
      await Deno.writeTextFile(join(dir, "b.json"), body);
      const summary = await pruneAndShardProfiles(
        dir,
        srcCoverageUrlPrefix(REPO),
        2,
        2,
        budget,
      );
      const observed: string[] = [];
      for (const shard of summary.shardDirs) {
        for await (const entry of Deno.readDir(shard)) {
          observed.push(await Deno.readTextFile(join(shard, entry.name)));
        }
      }
      assertEquals(observed, [body, body]);
      assertEquals(summary.compacted, 0);
    });
  }
});

Deno.test("coverage inputs from independent partitions retain colliding filenames and merge by module", async () => {
  await withTempDir(async (dir) => {
    const prefix = srcCoverageUrlPrefix(REPO);
    const bodies = [
      profile(`file://${REPO}/src/one.ts`),
      profile(`file://${REPO}/src/two.ts`),
    ];
    for (const [index, body] of bodies.entries()) {
      await Deno.mkdir(join(dir, `partition-${index}`));
      await Deno.writeTextFile(
        join(dir, `partition-${index}`, "same.json"),
        body,
      );
    }
    const summary = await pruneAndShardProfiles(dir, prefix, 2, 2);
    const observed: string[] = [];
    for (const shard of summary.shardDirs) {
      for await (const entry of Deno.readDir(shard)) {
        observed.push(await Deno.readTextFile(join(shard, entry.name)));
      }
    }
    assertEquals(summary.sharded, 2);
    assertEquals(observed.sort(), bodies.sort());
  });
});
