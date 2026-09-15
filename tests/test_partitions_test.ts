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
  costAwareAdmission,
  partitionOrder,
  partitionSelections,
  prioritySafeArguments,
  runTestPartitions,
  testPartitionCount,
} from "../scripts/test_partitions.ts";
import { testCommandArgs } from "../scripts/run_tests.ts";
import { selectionSeconds } from "../scripts/test_durations.ts";
import { durationHints } from "./test_duration_fixture.ts";
import { junitToDiagnostics } from "../src/engine/gate/diagnostics.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { readPidsIfReady } from "./process_id.ts";

/** Seed native file discovery with an optional practical failing case. */
async function seedNativeTests(
  dir: string,
  count: number,
  failing?: number,
): Promise<void> {
  for (let index = 0; index < count; index++) {
    await Deno.writeTextFile(
      join(dir, `${index}_test.ts`),
      `Deno.test('case ${index}', () => { ${
        index === failing ? "throw new Error('planted failure');" : ""
      } });\n`,
    );
  }
}

/** Hold each real child behind its own release marker and expose its PID. */
async function seedWaitingTests(dir: string, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await Deno.writeTextFile(
      join(dir, `${index}_test.ts`),
      `Deno.test('queued ${index}', async () => {
      const watcher = Deno.watchFs('.');
      await Deno.writeTextFile('${index}.ready', String(Deno.pid));
      for await (const event of watcher) {
        if (!event.kind) throw new Error('invalid event');
        try { await Deno.stat('${index}.release'); break; }
        catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
      }
      watcher.close();
      await Deno.writeTextFile('${index}.finished', 'yes');
    });\n`,
    );
  }
}

Deno.test("complete macOS runs partition native discovery while explicit selection and allocation stay native", () => {
  const empty = { get: () => undefined };
  for (const os of ["darwin", "linux", "windows"] as const) {
    assertEquals(
      testPartitionCount(os, 18, [], empty),
      os === "darwin" ? 144 : 1,
    );
  }
  assertEquals(
    testPartitionCount("darwin", 6, [
      "--shuffle=42",
      "--reporter=junit",
      "--coverage=/tmp/profile",
      "--coverage-raw-data-only",
    ], empty),
    48,
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
  assertThrows(() => combineJunitReports([report], 1, 0), TypeError);
  assertStringIncludes(
    combineJunitReports([report], 1, 1, true),
    'discern-selection="incomplete"',
  );
});

Deno.test("native partitions enroll new files exactly once and retain failed case diagnostics", async () => {
  await withTempDir(async (dir) => {
    await seedNativeTests(dir, 3, 1);
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

Deno.test("queued partition cancellation reaps active children without starting waiting work", async () => {
  await withTempDir(async (dir) => {
    await seedWaitingTests(dir, 4);
    const controller = new AbortController();
    const pending = runTestPartitions(
      testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
      4,
      { cwd: dir, signal: controller.signal, concurrency: 2 },
    );
    let pids: number[] | undefined;
    try {
      await waitForPendingCondition(
        pending,
        async () => {
          pids = await readPidsIfReady([
            join(dir, "0.ready"),
            join(dir, "2.ready"),
          ]);
          return pids !== undefined;
        },
        "both native test partitions to start",
      );
    } finally {
      controller.abort();
      assertEquals((await pending).code, 1);
    }
    assert(pids !== undefined);
    for (const pid of pids) {
      assertThrows(() => Deno.kill(pid, "SIGTERM"), Deno.errors.NotFound);
    }
    for (const index of [1, 3]) {
      assertEquals(await lstatIfExists(join(dir, `${index}.ready`)), undefined);
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

Deno.test("a crashed partition settles its sibling and preserves explicitly incomplete diagnostics", async () => {
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
      throw new Error('surviving failure');
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
      assertEquals(result.kind, "returned");
      assert(result.kind === "returned");
      assertEquals(result.value.code, 1);
      assertEquals(result.value.selection, "incomplete");
      const report = result.value.report ?? "";
      assertStringIncludes(report, 'discern-selection="incomplete"');
      assertStringIncludes(report, 'discern-reported-partitions="1"');
      assertStringIncludes(report, 'discern-expected-partitions="2"');
      assertStringIncludes(report, 'tests="1" failures="1"');
      const diagnostics = junitToDiagnostics(
        report,
        "test",
        "repeat this fixture",
      );
      assertEquals(diagnostics?.length, 1);
      assertStringIncludes(
        diagnostics?.[0]?.message ?? "",
        "surviving failure",
      );
      assertEquals(await Deno.readTextFile(join(dir, "finished")), "yes");
    } finally {
      controller.abort();
      await outcome;
    }
  });
});

Deno.test("partition preparation checks complete discovery once before starting runtime children", async () => {
  await withTempDir(async (dir) => {
    for (let index = 0; index < 2; index++) {
      await Deno.writeTextFile(
        join(dir, `${index}_test.ts`),
        `Deno.test('typed ${index}', () => {});\n`,
      );
    }
    const Command = Deno.Command;
    const commands: string[][] = [];
    Deno.Command = class extends Command {
      /** Observe the actual native test commands without replacing their work. */
      constructor(command: string | URL, options?: Deno.CommandOptions) {
        super(command, options);
        if (command === Deno.execPath() && options?.args?.[0] === "test") {
          commands.push([...options.args]);
        }
      }
    };
    try {
      for (const total of [2, 3]) {
        if (total === 3) {
          await Deno.writeTextFile(
            join(dir, "future_test.ts"),
            "Deno.test('future typed case', () => {});\n",
          );
        }
        commands.length = 0;
        const result = await runTestPartitions(
          testCommandArgs(42, ["--reporter=junit", dir]),
          3,
          { cwd: dir },
        );
        assertEquals(result.code, 0);
        assertEquals(
          commands.length,
          4,
          "one complete graph check followed by three runtime partitions",
        );
        assert(commands[0]?.includes("--no-run"));
        for (const args of commands.slice(1)) {
          assert(args.includes("--no-check"));
          assert(!args.includes("--no-run"));
        }
        assertEquals(
          (result.report?.match(/<testcase\b/g) ?? []).length,
          total,
        );
      }
    } finally {
      Deno.Command = Command;
    }
  });
});

Deno.test("a type error fails shared preparation before any runtime partition starts", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "invalid_test.ts"),
      "const value: number = 'invalid type'; Deno.test('would run', () => Deno.writeTextFileSync('executed', String(value)));\n",
    );
    const Command = Deno.Command;
    const commands: string[][] = [];
    Deno.Command = class extends Command {
      /** Count native children through real compiler failure. */
      constructor(command: string | URL, options?: Deno.CommandOptions) {
        super(command, options);
        if (
          options?.args?.includes("--no-run") ||
          (command === Deno.execPath() && options?.args?.[0] === "test")
        ) {
          commands.push([...options.args]);
        }
      }
    };
    try {
      for (const scheduleModules of [false, true]) {
        commands.length = 0;
        const result = await runTestPartitions(testCommandArgs(42, [dir]), 2, {
          cwd: dir,
          ...(scheduleModules ? { seed: 42 } : {}),
        });
        assertEquals(result.code, 1);
        assertEquals(commands.length, 1);
        assert(commands[0]?.includes("--no-run"));
        assertEquals(await lstatIfExists(join(dir, "executed")), undefined);
      }
    } finally {
      Deno.Command = Command;
    }
  });
});

Deno.test("cancelling shared preparation reaps its child before any partition starts", async () => {
  for (const scheduleModules of [false, true]) {
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(
        join(dir, "ready_test.ts"),
        "Deno.test('ready', () => {});\n",
      );
      const controller = new AbortController();
      const Command = Deno.Command;
      let pid: number | undefined;
      let commands = 0;
      Deno.Command = class extends Command {
        private readonly checking: boolean;
        /** Recognize the preparation child at its actual launch boundary. */
        constructor(command: string | URL, options?: Deno.CommandOptions) {
          super(command, options);
          this.checking = options?.args?.includes("--no-run") === true;
          if (
            this.checking ||
            (command === Deno.execPath() && options?.args?.[0] === "test")
          ) {
            commands += 1;
          }
        }
        /** Cancel as soon as the real preparation process exists. */
        override spawn(): Deno.ChildProcess {
          const child = super.spawn();
          if (this.checking) {
            pid = child.pid;
            controller.abort();
          }
          return child;
        }
      };
      try {
        const result = await runTestPartitions(testCommandArgs(42, [dir]), 2, {
          cwd: dir,
          signal: controller.signal,
          ...(scheduleModules ? { seed: 42 } : {}),
        });
        assertEquals(result.code, 1);
        assertEquals(commands, 1);
        const childPid = pid;
        assert(childPid !== undefined);
        assertThrows(
          () => Deno.kill(childPid, "SIGTERM"),
          Deno.errors.NotFound,
        );
      } finally {
        Deno.Command = Command;
      }
    });
  }
});

Deno.test("queued partitions refill a free slot while another child remains active", async () => {
  await withTempDir(async (dir) => {
    await seedWaitingTests(dir, 4);
    const controller = new AbortController();
    const pending = runTestPartitions(
      testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
      4,
      { cwd: dir, signal: controller.signal, concurrency: 2 },
    );
    try {
      for (const index of [0, 2]) {
        await waitForPendingCondition(
          pending,
          async () =>
            await lstatIfExists(join(dir, `${index}.ready`)) !== undefined,
          `initial partition ${index} to start`,
        );
      }
      for (const index of [1, 3]) {
        assertEquals(
          await lstatIfExists(join(dir, `${index}.ready`)),
          undefined,
        );
      }
      for (const [released, next] of [[0, 1], [1, 3]] as const) {
        await Deno.writeTextFile(join(dir, `${released}.release`), "yes");
        await waitForPendingCondition(
          pending,
          async () =>
            await lstatIfExists(join(dir, `${next}.ready`)) !== undefined,
          `queued partition ${next} to start`,
        );
        assertEquals(
          await lstatIfExists(join(dir, "2.finished")),
          undefined,
          "the other slot remains occupied",
        );
      }
      for (const index of [2, 3]) {
        await Deno.writeTextFile(join(dir, `${index}.release`), "yes");
      }
      const result = await pending;
      assertEquals(result.code, 0);
      assertStringIncludes(
        result.report ?? "",
        'tests="4" failures="0" errors="0"',
      );
    } finally {
      controller.abort();
      await pending;
    }
  });
});

Deno.test("queued native partitions preserve uneven and oversized process allocations", async () => {
  await withTempDir(async (dir) => {
    await seedNativeTests(dir, 5);
    for (const [count, concurrency] of [[5, 3], [3, 8]] as const) {
      const result = await runTestPartitions(
        testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
        count,
        { cwd: dir, concurrency },
      );
      assertEquals(result.code, 0);
      assertEquals((result.report?.match(/<testcase\b/g) ?? []).length, 5);
    }
  });
  for (const concurrency of [0, -1, 1.5, NaN]) {
    await assertRejects(
      () => runTestPartitions(["test"], 2, { concurrency }),
      TypeError,
      "concurrency",
    );
  }
});

Deno.test("seeded admission preserves every shard and deterministic priority ties", () => {
  const baseline = partitionOrder(16, 3, 42);
  assertEquals(baseline, partitionOrder(16, 3, 42));
  assertEquals(
    [...baseline].sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, i) => i),
  );
  assert(baseline.join() !== partitionOrder(16, 3, 99).join());
  const preferred = [7, 2, 7, -1, 100];
  const prioritised = partitionOrder(16, 3, 42, preferred);
  assertEquals(
    prioritised.slice(0, 2),
    baseline.filter((n) => n === 7 || n === 2),
  );
  assertEquals(
    prioritised.slice(2),
    baseline.filter((n) => n !== 7 && n !== 2),
  );
  assertEquals(preferred, [7, 2, 7, -1, 100]);
});

Deno.test("priority allocation preserves its process budget and falls back without a separable literal selection", () => {
  assert(
    prioritySafeArguments(
      testCommandArgs(42, ["--reporter=junit", "--no-lock"]),
    ),
  );
  for (
    const flag of [
      "tests/selected_test.ts",
      "--no-config",
      "--config=other.json",
      "--filter=case",
      "--ignore=old.ts",
      "--shard=1/2",
      "--changed",
      "--future",
    ]
  ) {
    assertEquals(
      prioritySafeArguments(testCommandArgs(42, [flag])),
      false,
      flag,
    );
  }
  const ordinary = partitionSelections(4, 42);
  const priority = {
    files: ["tests/b_test.ts", "tests/e_test.ts", "tests/b_test.ts"],
    excluded: ["tests/fixtures/"],
    moduleCount: 6,
  };
  const allocated = partitionSelections(4, 42, priority);
  assertEquals(allocated.selections.length, 4);
  assertEquals(allocated.preferred, [0, 1]);
  assertEquals(allocated, partitionSelections(4, 42, priority));
  const selected = allocated.selections.slice(0, 2).flat().filter((arg) =>
    !arg.startsWith("--")
  );
  assertEquals([...selected].sort(), ["tests/b_test.ts", "tests/e_test.ts"]);
  for (const selection of allocated.selections.slice(2)) {
    const ignored = selection.find((arg) => arg.startsWith("--ignore=")) ?? "";
    for (const file of ["tests/fixtures/", ...selected]) {
      assertStringIncludes(ignored, file);
    }
  }
  for (
    const candidate of [
      { ...priority, files: [] },
      { ...priority, moduleCount: 2 },
      { ...priority, moduleCount: 0 },
      { ...priority, moduleCount: NaN },
      { ...priority, excluded: ["name,comma/"] },
      { ...priority, files: ["tests/[literal]_test.ts"] },
    ]
  ) assertEquals(partitionSelections(4, 42, candidate), ordinary);
  assertEquals(
    partitionSelections(1, 42, priority),
    partitionSelections(1, 42),
  );
});

Deno.test("cold and warm preparation keep the seeded allocation and complete native membership", async () => {
  await withTempDir(async (dir) => {
    const root = join(dir, "native files with ' quotes");
    await Deno.mkdir(root);
    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({ test: { exclude: ["excluded_test.ts"] } }),
    );
    await Deno.writeTextFile(
      join(root, "excluded_test.ts"),
      "Deno.test('excluded', () => { throw new Error('excluded test ran'); });\n",
    );
    let firstOrder: string[] | undefined;
    let ordinaryMembers: string[] | undefined;
    for (
      const [total, prioritised] of [[3, false], [3, true], [3, true], [
        4,
        true,
      ]] as const
    ) {
      for (let index = 0; index < total; index++) {
        await Deno.writeTextFile(
          join(root, `${index}_test.ts`),
          `Deno.test('module ${index}', async () => {
              await Deno.writeTextFile('order.txt', '${index},' + Deno.pid + '\\n', { append: true });
              ${index === 1 ? "throw new Error('planted module failure');" : ""}
            });\n`,
        );
      }
      await Deno.writeTextFile(join(root, "order.txt"), "");
      const result = await runTestPartitions(
        testCommandArgs(42, [
          "--no-lock",
          "--reporter=junit",
        ]),
        2,
        {
          cwd: root,
          concurrency: 1,
          seed: 42,
          env: { DENO_DIR: join(dir, "cache") },
          ...(prioritised
            ? {
              priority: () =>
                Promise.resolve({
                  files: ["2_test.ts"],
                  excluded: ["excluded_test.ts"],
                  moduleCount: total,
                }),
            }
            : {}),
        },
      );
      assertEquals(result.code, 1);
      assertEquals(result.selection, "complete");
      assertStringIncludes(
        result.report ?? "",
        `tests="${total}" failures="1" errors="0"`,
      );
      const rows = (await Deno.readTextFile(join(root, "order.txt"))).trim()
        .split("\n").map((row) => row.split(","));
      assertEquals(rows.length, total);
      assertEquals(new Set(rows.map((row) => row[0])).size, total);
      assertEquals(new Set(rows.map((row) => row[1])).size, 2);
      const order = rows.map((row) => row[0] ?? "");
      const members = [...order].sort();
      if (!prioritised) ordinaryMembers = members;
      if (prioritised) {
        assertEquals(
          order[0],
          "2",
          "the changed module executes in the first partition",
        );
        if (total === 3) {
          assertEquals(members, ordinaryMembers);
          if (firstOrder !== undefined) assertEquals(order, firstOrder);
          firstOrder ??= order;
        }
      }
    }
  });
});

Deno.test("failed and green suites execute every queued partition and every native test", async () => {
  await withTempDir(async (dir) => {
    for (const fails of [true, false]) {
      await seedNativeTests(dir, 4, fails ? 0 : undefined);
      for (let index = 0; index < 4; index++) {
        const path = join(dir, `${index}_test.ts`);
        await Deno.writeTextFile(
          path,
          `await Deno.writeTextFile('${index}.ran', 'yes');\n` +
            await Deno.readTextFile(path) +
            `Deno.test('second case ${index}', () => { ${
              fails && index === 3
                ? "throw new Error('later independent failure');"
                : ""
            } });\n`,
        );
      }
      const result = await runTestPartitions(
        testCommandArgs(42, ["--no-check", "--reporter=junit", dir]),
        4,
        { cwd: dir, concurrency: 1 },
      );
      assertEquals(result.code, fails ? 1 : 0);
      assertEquals(result.selection, "complete");
      assertStringIncludes(
        result.report ?? "",
        `tests="8" failures="${fails ? 2 : 0}"`,
      );
      if (fails) {
        assertStringIncludes(result.report ?? "", "planted failure");
        assertStringIncludes(result.report ?? "", "later independent failure");
      }
      for (let index = 0; index < 4; index++) {
        assertEquals(
          await lstatIfExists(join(dir, `${index}.ran`)) !== undefined,
          true,
        );
      }
    }
  });
});

/** The literal files one selection names. */
function selectionFiles(selection: readonly string[] | undefined): string[] {
  return (selection ?? []).filter((arg) => !arg.startsWith("-"));
}

/** Greedy list scheduling: each admitted partition takes the soonest free slot. */
function makespan(
  order: readonly number[],
  seconds: (index: number) => number,
  workers: number,
): number {
  const ends = Array.from({ length: workers }, () => 0);
  for (const index of order) {
    const soonest = ends.indexOf(Math.min(...ends));
    ends[soonest] = (ends[soonest] ?? 0) + seconds(index);
  }
  return Math.max(...ends);
}

Deno.test("cost-aware admission ranks fixed priority selections and leaves ordinary shards in seeded order", () => {
  const priority = {
    files: ["a", "b", "c", "d", "e", "f"].map((name) =>
      `tests/${name}_test.ts`
    ),
    excluded: [],
    moduleCount: 20,
  };
  const allocation = partitionSelections(16, 42, priority);
  const preferred = new Set(allocation.preferred);
  assertEquals(preferred.size, 5);
  const base = partitionOrder(16, 3, 42, allocation.preferred);
  const ordinary = base.filter((index) => !preferred.has(index));
  const seededLast = base.filter((index) => preferred.has(index)).at(-1);
  assert(seededLast !== undefined);
  // Charge the group seeded admission runs last the most, so ranking must move it first.
  const skewed = durationHints(Object.fromEntries(priority.files.map((
    file,
  ) => [
    file,
    selectionFiles(allocation.selections[seededLast]).includes(file) ? 100 : 1,
  ])));
  const ranked = costAwareAdmission(
    base,
    allocation.selections,
    allocation.preferred,
    skewed,
  );
  assertEquals(
    [...ranked].sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, index) => index),
    "every partition is admitted exactly once",
  );
  assertEquals(
    [...ranked.slice(0, 5)].sort((a, b) => a - b),
    [...preferred].sort((a, b) => a - b),
    "priority partitions precede every ordinary shard",
  );
  assertEquals(ranked.slice(5), ordinary, "ordinary shards keep seeded order");
  assertEquals(ranked[0], seededLast);
  const costs = ranked.slice(0, 5).map((index) =>
    selectionSeconds(allocation.selections[index] ?? [], skewed)
  );
  assertEquals(costs, [...costs].sort((a, b) => b - a));
  assertEquals(
    ranked,
    costAwareAdmission(
      base,
      allocation.selections,
      allocation.preferred,
      skewed,
    ),
  );
  assertEquals(
    allocation,
    partitionSelections(16, 42, priority),
    "membership is fixed before ranking",
  );
  assertEquals(
    costAwareAdmission(
      base,
      allocation.selections,
      allocation.preferred,
      undefined,
    ),
    base,
    "no hints keeps the existing admission",
  );
  const groupOf = (file: string): number => {
    const group = allocation.preferred.find((index) =>
      selectionFiles(allocation.selections[index]).includes(file)
    );
    assert(group !== undefined);
    return group;
  };
  // Every group costs exactly one second, so only the seeded order can decide.
  const even = durationHints(Object.fromEntries(priority.files.map((
    file,
  ) => [
    file,
    1 / selectionFiles(allocation.selections[groupOf(file)]).length,
  ])));
  assertEquals(
    costAwareAdmission(base, allocation.selections, allocation.preferred, even),
    base,
    "ties keep seeded order",
  );
  const other = partitionOrder(16, 3, 99, allocation.preferred);
  assertEquals(
    costAwareAdmission(
      other,
      allocation.selections,
      allocation.preferred,
      even,
    ),
    other,
  );
  // An unrecorded file is charged the most expensive recorded file, never zero.
  const unrecorded = priority.files[0];
  assert(unrecorded !== undefined);
  const recorded = priority.files.find((file) =>
    groupOf(file) !== groupOf(unrecorded)
  );
  assert(recorded !== undefined);
  const partial = durationHints(Object.fromEntries(
    priority.files.filter((file) => file !== unrecorded).map((
      file,
    ) => [file, file === recorded ? 50 : 1]),
  ));
  const withUnknown = costAwareAdmission(
    base,
    allocation.selections,
    allocation.preferred,
    partial,
  );
  assertEquals(
    new Set(withUnknown.slice(0, 2)),
    new Set([groupOf(unrecorded), groupOf(recorded)]),
  );
});

Deno.test("a skewed fixed workload finishes sooner under cost-aware admission than under seeded admission", () => {
  const priority = {
    files: ["a", "b", "c", "d", "e"].map((name) => `tests/${name}_test.ts`),
    excluded: [],
    moduleCount: 8,
  };
  const allocation = partitionSelections(8, 42, priority);
  const preferred = new Set(allocation.preferred);
  assertEquals(preferred.size, 5);
  const base = partitionOrder(8, 2, 42, allocation.preferred);
  const heavy = base.filter((index) => preferred.has(index)).at(-1);
  assert(heavy !== undefined);
  const hints = durationHints(Object.fromEntries(priority.files.map((
    file,
  ) => [
    file,
    selectionFiles(allocation.selections[heavy]).includes(file) ? 10 : 1,
  ])));
  const seconds = (index: number): number =>
    preferred.has(index)
      ? selectionSeconds(allocation.selections[index] ?? [], hints)
      : 1;
  const seeded = makespan(base, seconds, 2);
  const ranked = makespan(
    costAwareAdmission(
      base,
      allocation.selections,
      allocation.preferred,
      hints,
    ),
    seconds,
    2,
  );
  assertEquals(
    seeded,
    12,
    "seeded admission leaves the heavy group as the tail",
  );
  assertEquals(ranked, 10, "cost-aware admission overlaps the heavy group");
  assert(ranked < seeded);
});

Deno.test("recorded durations order launched priority partitions without changing their selections", async () => {
  await withTempDir(async (root) => {
    for (let index = 0; index < 4; index++) {
      await Deno.writeTextFile(
        join(root, `${index}_test.ts`),
        `Deno.test('module ${index}', () => {});\n`,
      );
    }
    const priority = () =>
      Promise.resolve({
        files: ["0_test.ts", "1_test.ts"],
        excluded: [],
        moduleCount: 4,
      });
    const launches: string[][] = [];
    const Command = Deno.Command;
    Deno.Command = class extends Command {
      /** Record each native test partition at its actual launch boundary. */
      constructor(command: string | URL, options?: Deno.CommandOptions) {
        super(command, options);
        if (command === Deno.execPath() && options?.args?.[0] === "test") {
          launches.push(
            options.args.filter((arg) => !arg.startsWith("--junit-path=")),
          );
        }
      }
    };
    const orders: string[][][] = [];
    try {
      for (
        const seconds of [
          undefined,
          { "0_test.ts": 100, "1_test.ts": 1 },
          { "0_test.ts": 1, "1_test.ts": 100 },
        ]
      ) {
        launches.length = 0;
        const result = await runTestPartitions(
          testCommandArgs(42, ["--no-check", "--reporter=junit"]),
          4,
          {
            cwd: root,
            concurrency: 1,
            seed: 42,
            priority,
            ...(seconds === undefined
              ? {}
              : { durations: durationHints(seconds) }),
          },
        );
        assertEquals(result.code, 0);
        assertEquals(result.selection, "complete");
        assertStringIncludes(result.report ?? "", 'tests="4" failures="0"');
        orders.push(launches.map((args) => [...args]));
      }
    } finally {
      Deno.Command = Command;
    }
    const [seeded, zeroFirst, oneFirst] = orders;
    assert(
      seeded !== undefined && zeroFirst !== undefined && oneFirst !== undefined,
    );
    assertEquals(seeded.length, 4);
    const key = (args: readonly string[]): string => JSON.stringify(args);
    const isShard = (args: readonly string[]): boolean =>
      args.some((arg) => arg.startsWith("--shard="));
    for (const launched of [zeroFirst, oneFirst]) {
      assertEquals(
        launched.map(key).sort(),
        seeded.map(key).sort(),
        "hints change no selection and no argument",
      );
      assertEquals(
        launched.filter(isShard),
        seeded.filter(isShard),
        "ordinary shards keep their seeded order",
      );
      assertEquals(launched.slice(0, 2).some(isShard), false);
    }
    assert(zeroFirst[0]?.includes("0_test.ts"));
    assert(zeroFirst[1]?.includes("1_test.ts"));
    assert(oneFirst[0]?.includes("1_test.ts"));
    assert(oneFirst[1]?.includes("0_test.ts"));
  });
});

Deno.test("coverage settlement observations require raw profiles and an owned writer group", async () => {
  await withTempDir(async (dir) => {
    await seedNativeTests(dir, 2);
    for (
      const [index, variant] of [
        { terminal: false, raw: true },
        { terminal: true, raw: true },
        { terminal: false, raw: false },
      ].entries()
    ) {
      const started: number[] = [];
      const settled: number[] = [];
      const originalTerminal = Deno.stdin.isTerminal;
      let terminalChecks = 0;
      Deno.stdin.isTerminal = (): boolean => {
        terminalChecks++;
        return variant.terminal;
      };
      try {
        const suite = await runTestPartitions(
          testCommandArgs(42, [
            "--no-config",
            "--no-lock",
            "--no-check",
            "--reporter=junit",
            `--coverage=${join(dir, `profiles-${index}`)}`,
            ...(variant.raw ? ["--coverage-raw-data-only"] : []),
            dir,
          ]),
          2,
          {
            cwd: dir,
            coveragePartitions: {
              started(count): void {
                started.push(count);
              },
              settled(partition): void {
                settled.push(partition);
              },
            },
          },
        );
        assertEquals(suite.code, 0);
        assertEquals((suite.report?.match(/<testcase\b/g) ?? []).length, 2);
        const owned = !variant.terminal && Deno.build.os !== "windows" &&
          variant.raw;
        assertEquals(started, owned ? [2] : []);
        assertEquals(settled.sort(), owned ? [1, 2] : []);
        assert(terminalChecks > 0);
      } finally {
        Deno.stdin.isTerminal = originalTerminal;
      }
    }
  });
});
