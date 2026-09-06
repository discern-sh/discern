import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  combineJunitReports,
  runTestPartitions,
  testPartitionCount,
} from "../scripts/test_partitions.ts";
import { testCommandArgs } from "../scripts/run_tests.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import { waitForPendingCondition } from "./waiting.ts";

Deno.test("complete macOS runs partition native discovery while explicit selection and allocation stay native", () => {
  const empty = { get: () => undefined };
  for (const os of ["darwin", "linux", "windows"] as const) {
    assertEquals(
      testPartitionCount(os, 18, [], empty),
      os === "darwin" ? 18 : 1,
    );
  }
  assertEquals(
    testPartitionCount("darwin", 6, [
      "--shuffle=42",
      "--reporter=junit",
      "--coverage=/tmp/profile",
      "--coverage-raw-data-only",
    ], empty),
    6,
  );
  for (
    const forwarded of [
      ["tests/future_test.ts"],
      ["--filter", "case"],
      ["--watch"],
      ["--shard=1/2"],
      ["--junit-path=output.xml"],
      ["--coverage=profile"],
      ["--future-option"],
    ]
  ) assertEquals(testPartitionCount("darwin", 18, forwarded, empty), 1);
  for (const allocation of ["1", "3", "18", "", "invalid"]) {
    assertEquals(
      testPartitionCount("darwin", 18, [], { get: () => allocation }),
      1,
    );
  }
  for (const cores of [0, -1, 1.5, NaN, Infinity]) {
    assertEquals(testPartitionCount("darwin", cores, [], empty), 1);
  }
});

Deno.test("combined JUnit preserves native diagnostics and rejects missing or invalid counts", () => {
  const body =
    '<testsuite name="one"><testcase name="a &amp; b"><failure message="bad &lt;value&gt;">detail</failure></testcase></testsuite>';
  const report =
    `<testsuites tests="1" failures="1" errors="0">${body}</testsuites>`;
  const empty = '<testsuites tests="0" failures="0" errors="0"></testsuites>';
  const combined = combineJunitReports([report, empty], 1.25);
  assertStringIncludes(
    combined,
    'tests="1" failures="1" errors="0" time="1.250"',
  );
  assertStringIncludes(combined, body);
  for (
    const invalid of [
      "",
      '<testsuites tests="1"></testsuites>',
      report.replace('tests="1"', 'tests="1" tests="2"'),
      report.replace('tests="1"', 'tests="9007199254740992"'),
    ]
  ) {
    assertThrows(() => combineJunitReports([report, invalid], 1), TypeError);
  }
  assertThrows(() => combineJunitReports([], 1), TypeError);
  assertThrows(() => combineJunitReports([report], -1), TypeError);
});

Deno.test("native partitions enroll new files exactly once and retain failed case diagnostics", async () => {
  await withTempDir(async (dir) => {
    for (let index = 0; index < 3; index++) {
      await Deno.writeTextFile(
        join(dir, `${index}_test.ts`),
        `Deno.test('case ${index}', () => { ${
          index === 1 ? "throw new Error('planted failure');" : ""
        } });\n`,
      );
    }
    for (const count of [3, 4]) {
      if (count === 4) {
        await Deno.writeTextFile(
          join(dir, "future_test.ts"),
          "Deno.test('future case', () => {});\n",
        );
      }
      const result = await runTestPartitions(
        testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
        2,
        { cwd: dir },
      );
      assertEquals(result.code, 1);
      assertStringIncludes(
        result.report ?? "",
        `tests="${count}" failures="1" errors="0"`,
      );
      assertStringIncludes(result.report ?? "", "planted failure");
      assertEquals((result.report?.match(/<testcase\b/g) ?? []).length, count);
    }
  });
});

Deno.test("partition cancellation reaps every active child before its owner continues", async () => {
  await withTempDir(async (dir) => {
    for (let index = 0; index < 2; index++) {
      await Deno.writeTextFile(
        join(dir, `${index}_test.ts`),
        `Deno.test('active ${index}', async () => { const watcher = Deno.watchFs('.'); await Deno.writeTextFile('${index}.ready', String(Deno.pid)); for await (const event of watcher) { if (!event.kind) throw new Error('invalid event'); } });\n`,
      );
    }
    const controller = new AbortController();
    const pending = runTestPartitions(
      testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
      2,
      { cwd: dir, signal: controller.signal },
    );
    try {
      await waitForPendingCondition(
        pending,
        async () =>
          await lstatIfExists(join(dir, "0.ready")) !== undefined &&
          await lstatIfExists(join(dir, "1.ready")) !== undefined,
        "both native test partitions to start",
      );
    } finally {
      controller.abort();
      assertEquals((await pending).code, 1);
    }
    for (let index = 0; index < 2; index++) {
      const pid = Number(await Deno.readTextFile(join(dir, `${index}.ready`)));
      assertThrows(() => Deno.kill(pid, "SIGTERM"), Deno.errors.NotFound);
    }
  });
});

Deno.test("owned child request cancellation refuses a pre-aborted spawn", async () => {
  const controller = new AbortController();
  controller.abort();
  await assertRejects(
    () =>
      runOwnedChild("a-command-that-must-never-spawn", {
        signal: controller.signal,
      }),
    DOMException,
    "aborted",
  );
  assert(controller.signal.aborted);
});

Deno.test("a crashed partition cannot return before its sibling or publish partial JUnit", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "0_test.ts"),
      "Deno.test('crash', () => Deno.kill(Deno.pid, 'SIGKILL'));\n",
    );
    await Deno.writeTextFile(
      join(dir, "1_test.ts"),
      `Deno.test('finish', async () => {
      const watcher = Deno.watchFs('.');
      await Deno.writeTextFile('ready', 'yes');
      for await (const _event of watcher) {
        try { await Deno.stat('release'); break; }
        catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
      }
      watcher.close();
      await Deno.writeTextFile('finished', 'yes');
    });\n`,
    );
    const controller = new AbortController();
    const outcome = runTestPartitions(
      testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
      2,
      { cwd: dir, signal: controller.signal },
    ).then(
      (value) => ({ kind: "returned" as const, value }),
      (error: unknown) => ({ kind: "failed" as const, error }),
    );
    try {
      await waitForPendingCondition(
        outcome,
        async () => await lstatIfExists(join(dir, "ready")) !== undefined,
        "surviving partition to start",
      );
      await Deno.writeTextFile(join(dir, "release"), "yes");
      const result = await outcome;
      assertEquals(result.kind, "failed");
      assert(result.kind === "failed" && result.error instanceof Error);
      assertEquals(await Deno.readTextFile(join(dir, "finished")), "yes");
    } finally {
      controller.abort();
      await outcome;
    }
  });
});
