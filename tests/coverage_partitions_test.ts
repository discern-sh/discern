import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { CoverageProfilePartitions } from "../scripts/coverage_partitions.ts";
import { pruneAndShardProfiles } from "../scripts/coverage_profiles.ts";
import { withTempDir } from "./helpers.ts";
import { processAllowance, waitUntil } from "./waiting.ts";

const PREFIX = "file:///fixture/src/";
const PROFILE = JSON.stringify({
  scriptId: "1",
  url: `${PREFIX}module.ts`,
  functions: [],
});

/** Keep every queue, including a failed one, within its owning test directory. */
async function withProfiles(
  run: (queue: CoverageProfilePartitions, raw: string) => Promise<void>,
  process?: typeof pruneAndShardProfiles,
): Promise<void> {
  await withTempDir(async (root) => {
    const raw = join(root, "raw");
    await Deno.mkdir(raw);
    const queue = new CoverageProfilePartitions({
      raw,
      reports: join(root, "reports"),
      prefix: PREFIX,
      shards: 2,
      ...(process === undefined ? {} : { process }),
    });
    try {
      await run(queue, raw);
    } finally {
      await queue.stopAndWait();
    }
  });
}

Deno.test("coverage processing keeps one active owner and settles its failure before returning", async () => {
  let entered = false;
  const allowance = processAllowance();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  let exited = false;
  await withProfiles(async (queue) => {
    queue.started(2);
    queue.settled(1);
    queue.settled(2);
    const finished = queue.finish(true);
    try {
      await waitUntil(() => entered, "coverage processor to start", {
        allowance,
      });
      assertEquals(calls, 1);
      assertEquals(exited, false);
    } finally {
      release.resolve();
    }
    await assertRejects(() => finished, AggregateError, "active IO settled");
    assertEquals(exited, true);
    assertEquals(calls, 1);
  }, async () => {
    calls++;
    entered = true;
    await release.promise;
    exited = true;
    throw new Error("injected read failure");
  });
});

Deno.test("coverage cancellation drains the active processor and leaves queued work unstarted", async () => {
  let entered = false;
  const allowance = processAllowance();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  let exited = false;
  await withProfiles(async (queue) => {
    queue.started(2);
    queue.settled(1);
    queue.settled(2);
    let drained = false;
    let stopping: Promise<void> | undefined;
    try {
      await waitUntil(() => entered, "coverage processor to start", {
        allowance,
      });
      queue.stop();
      stopping = queue.stopAndWait().then(() => {
        drained = true;
      });
      await Promise.resolve();
      assertEquals(drained, false);
      assertEquals(exited, false);
      assertEquals(calls, 1);
    } finally {
      release.resolve();
    }
    await stopping;
    assertEquals(exited, true);
    assertEquals(calls, 1);
    await assertRejects(() => queue.finish(false), DOMException, "stopped");
  }, async (directory, prefix, shards) => {
    calls++;
    entered = true;
    await release.promise;
    const result = await pruneAndShardProfiles(directory, prefix, shards);
    exited = true;
    return result;
  });
});

Deno.test("invalid coverage admissions remain failures even when their immediate error is caught", async () => {
  for (const indices of [[0], [-1], [3], [1.5], [NaN], [1, 1]]) {
    await withProfiles(async (queue) => {
      queue.started(2);
      for (const index of indices.slice(0, -1)) queue.settled(index);
      assertThrows(() => queue.settled(indices.at(-1) ?? NaN));
      await assertRejects(() => queue.finish(false), AggregateError);
    });
  }
  await withProfiles(async (queue) => {
    queue.started(1);
    queue.settled(1);
    const finished = queue.finish(true);
    assertThrows(() => queue.settled(1));
    await assertRejects(() => finished, AggregateError);
  });
});

Deno.test("diagnostic coverage preserves residual inputs without promoting missing admissions to success", async () => {
  await withProfiles(async (queue, raw) => {
    for (const index of [1, 2]) {
      const dir = join(raw, `test-shard-${index}`);
      await Deno.mkdir(dir);
      await Deno.writeTextFile(join(dir, "collision.json"), PROFILE);
    }
    queue.started(2);
    queue.settled(1);
    const diagnostic = await queue.finish(false);
    assertEquals(diagnostic.input_files, 2);
    assertEquals(diagnostic.sharded, 2);
    await assertRejects(
      () => queue.finish(true),
      Error,
      "1/2 coverage partitions",
    );
  });
});

Deno.test("coverage without owned partition observations retains bulk reduction", async () => {
  await withProfiles(async (queue, raw) => {
    for (const index of [1, 2]) {
      const dir = join(raw, `test-shard-${index}`);
      await Deno.mkdir(dir);
      await Deno.writeTextFile(join(dir, "collision.json"), PROFILE);
    }
    const result = await queue.finish(true);
    assertEquals(result.input_files, 2);
    assertEquals(result.compacted, 1);
    assertEquals(result.sharded, 1);
  });
});

Deno.test("empty native partitions still require their settlement observations", async () => {
  await withProfiles(async (queue) => {
    queue.started(2);
    queue.settled(1);
    await assertRejects(
      () => queue.finish(true),
      Error,
      "1/2 coverage partitions",
    );
  });
  await withProfiles(async (queue) => {
    queue.started(2);
    queue.settled(1);
    queue.settled(2);
    const result = await queue.finish(true);
    assertEquals(result.input_files, 0);
    assertEquals(result.shardDirs, []);
  });
});

Deno.test("an opaque coverage header keeps every module in one native report pass", async () => {
  await withProfiles(async (queue, raw) => {
    const directory = join(raw, "test-shard-1");
    await Deno.mkdir(directory);
    for (const [index, name] of ["a", "b"].entries()) {
      await Deno.writeTextFile(
        join(directory, `${index}.json`),
        JSON.stringify({
          scriptId: String(index),
          url: `${PREFIX}${name}.ts`,
          functions: [],
        }),
      );
    }
    await Deno.writeTextFile(
      join(directory, "opaque.json"),
      JSON.stringify({
        url: `${PREFIX}a.ts`,
        scriptId: "2",
        functions: [],
      }),
    );
    queue.started(1);
    queue.settled(1);
    const result = await queue.finish(true);
    assertEquals(result.input_files, 3);
    assertEquals(result.opaque, 1);
    assertEquals(result.shardDirs.length, 1);
    const report = result.shardDirs[0];
    if (report === undefined) throw new Error("native report root missing");
    const children = [];
    for await (const entry of Deno.readDir(report)) children.push(entry.name);
    assertEquals(children.sort(), ["shard-0", "shard-1"]);
  });
});
