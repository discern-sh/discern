import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  combineJunitReports,
  listedModuleSizes,
  runTestPartitions,
  testPartitionCount,
} from "../scripts/test_partitions.ts";
import { testCommandArgs } from "../scripts/run_tests.ts";
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
          scheduleModules,
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
          scheduleModules,
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

Deno.test("module scheduling uses native discovery, prioritizes source size, and retains complete failing enrollment", async () => {
  await withTempDir(async (dir) => {
    const root = join(dir, "native files with ' quotes");
    await Deno.mkdir(root);
    for (const count of [3, 4]) {
      for (let index = 0; index < count; index++) {
        await Deno.writeTextFile(
          join(root, `${index}_test.ts`),
          `Deno.test('module ${index}', async () => {
            await Deno.writeTextFile('order.txt', '${index},' + Deno.pid + '\\n', { append: true });
            ${index === 1 ? "throw new Error('planted module failure');" : ""}
          });\n/* ${"source-size hint ".repeat(index * 100)} */\n`,
        );
      }
      for (const checked of [true, false]) {
        await Deno.writeTextFile(join(root, "order.txt"), "");
        const result = await runTestPartitions(
          testCommandArgs(42, [
            "--reporter=junit",
            ...(checked ? [] : ["--no-check"]),
            root,
          ]),
          2,
          { cwd: root, concurrency: 1, scheduleModules: true },
        );
        assertEquals(result.code, 1);
        assertStringIncludes(
          result.report ?? "",
          `tests="${count}" failures="1" errors="0"`,
        );
        assertStringIncludes(result.report ?? "", "planted module failure");
        const rows = (await Deno.readTextFile(join(root, "order.txt"))).trim()
          .split("\n").map((row) => row.split(","));
        assertEquals(rows.length, count);
        assertEquals(new Set(rows.map((row) => row[0])).size, count);
        const listed = checked && Deno.build.os !== "windows";
        assertEquals(
          new Set(rows.map((row) => row[1])).size,
          listed ? count : 2,
        );
        if (listed) assertEquals(rows[0]?.[0], String(count - 1));
      }
    }
    const controller = new AbortController();
    controller.abort();
    await assertRejects(
      () =>
        runTestPartitions(
          testCommandArgs(42, ["--reporter=junit", root]),
          2,
          { cwd: root, scheduleModules: true, signal: controller.signal },
        ),
      DOMException,
      "aborted",
    );
  });
});

Deno.test("module listings parse through ANSI decoration and unreadable entries", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "plain_test.ts"), "1234567890");
    await Deno.writeTextFile(join(dir, "styled_test.ts"), "12345");
    // A colour-forcing environment wraps the native listing in SGR escapes;
    // parsing must survive that even when the spawn env failed to prevent it.
    const esc = String.fromCharCode(27);
    const output = [
      `Check plain_test.ts`,
      `${esc}[0m${esc}[32mCheck${esc}[0m styled_test.ts${esc}[0m`,
      `${esc}[32mCheck${esc}[0m missing_test.ts`,
      "unrelated line",
    ].join("\n");
    assertEquals(await listedModuleSizes(output, dir), [10, 5, 0]);
  });
});

Deno.test("a colour-forcing invoking environment cannot break module scheduling", async () => {
  // The exact harness shape that once broke scheduling: FORCE_COLOR=3 with
  // NO_COLOR=1 exported around the whole run. The scheduler's own process
  // inherits both, so its native listing child would arrive ANSI-wrapped
  // unless the spawn env resolves colour off (and the parser strips escapes).
  // Three modules with one worker must still yield three single-module
  // partitions - the fallback would run only two interleaved ones.
  await withTempDir(async (dir) => {
    const root = join(dir, "forced");
    await Deno.mkdir(root);
    for (let index = 0; index < 3; index++) {
      await Deno.writeTextFile(
        join(root, `${index}_test.ts`),
        `Deno.test('forced ${index}', async () => {
          await Deno.writeTextFile('order.txt', '${index},' + Deno.pid + '\\n', { append: true });
        });\n`,
      );
    }
    await Deno.writeTextFile(join(root, "order.txt"), "");
    const driver = join(dir, "driver.ts");
    await Deno.writeTextFile(
      driver,
      `import { runTestPartitions } from ${
        JSON.stringify(
          new URL("../scripts/test_partitions.ts", import.meta.url).href,
        )
      };
      import { testCommandArgs } from ${
        JSON.stringify(new URL("../scripts/run_tests.ts", import.meta.url).href)
      };
      const root = Deno.args[0] ?? "";
      const result = await runTestPartitions(
        testCommandArgs(42, ["--reporter=junit", root]),
        2,
        { cwd: root, concurrency: 1, scheduleModules: true },
      );
      Deno.exit(result.code);\n`,
    );
    const repoRoot = new URL("../", import.meta.url);
    const run = await new Deno.Command(Deno.execPath(), {
      // The driver lives outside the workspace, so the repo import map is
      // named explicitly; cwd is the repo root the config path resolves from.
      args: [
        "run",
        "--quiet",
        "--allow-all",
        "--config",
        "deno.json",
        driver,
        root,
      ],
      cwd: fromFileUrl(repoRoot),
      env: { FORCE_COLOR: "3", NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const evidence = new TextDecoder().decode(run.stdout) +
      new TextDecoder().decode(run.stderr);
    assertEquals(run.code, 0, `forced-colour run failed:\n${evidence}`);
    const rows = (await Deno.readTextFile(join(root, "order.txt"))).trim()
      .split("\n").map((row) => row.split(","));
    assertEquals(rows.length, 3);
    const listed = Deno.build.os !== "windows";
    assertEquals(
      new Set(rows.map((row) => row[1])).size,
      listed ? 3 : 2,
      `module scheduling fell back to interleaved partitions:\n${evidence}`,
    );
  });
});
