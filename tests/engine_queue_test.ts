/**
 * Black-box coverage for `discern queue`: raw exec forwarding, fleet-slot
 * serialization, config-state fallbacks, help, and process exit semantics.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { SIGNAL_EXIT_CODES } from "../src/engine/process_signals.ts";
import { TEST_RUN_SLOT_ENV } from "../src/engine/test_run_slots.ts";
import { withTempDir } from "./helpers.ts";
import {
  DENO_JSON,
  engineEnv,
  gitInit,
  MAIN_TS,
  runAgent,
  type RunResult,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

const QUEUED_TEXT = "Tests queued";
const UNAVAILABLE_TEXT = "The concurrent test-run cap is not enforced";

/** Write the minimal configured cap used by queue behavior tests. */
async function writeCapConfig(dir: string, cap: number): Promise<void> {
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[gate]",
      `concurrent_test_runs = ${cap}`,
      "",
    ].join("\n"),
  );
}

/** The shared slot directory for a repository whose `.git` is a directory. */
function slotDirOf(root: string): string {
  return join(root, ".git", GIT_ADMIN_STATE.testSlots.path);
}

/** True when a path exists, regardless of its file type. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Count non-overlapping appearances of one diagnostic fragment. */
function occurrenceCount(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

/** Poll a predicate until it holds or the named readiness condition expires. */
async function pollUntil(
  what: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Hold the repository's only slot until a serialization test releases it. */
async function holdOnlySlot(root: string): Promise<() => void> {
  const dir = slotDirOf(root);
  await Deno.mkdir(dir, { recursive: true });
  const file = await Deno.open(join(dir, "slot-1"), {
    create: true,
    read: true,
    write: true,
  });
  assertEquals(await file.tryLock(true), true, "fixture slot must acquire");
  let released = false;
  return (): void => {
    if (!released) {
      released = true;
      file.close();
    }
  };
}

interface RunningAgent {
  /** Settled process output. */
  readonly result: Promise<RunResult>;
  /** Stderr accumulated so far, for deterministic queue readiness. */
  readonly stderrSoFar: () => string;
  /** Stop a stuck fixture through the engine's owned-child signal path. */
  readonly kill: (signal: Deno.Signal) => void;
}

/** Spawn an engine process while exposing its live stderr queue notice. */
async function spawnAgent(
  dir: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<RunningAgent> {
  const child = new Deno.Command("deno", {
    args: ["run", "--no-check", "--config", DENO_JSON, "-A", MAIN_TS, ...args],
    cwd: dir,
    env: await engineEnv(env),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stdout = new Response(child.stdout).text();
  let stderrText = "";
  const decoder = new TextDecoder();
  const stderr = (async (): Promise<string> => {
    for await (const chunk of child.stderr) {
      stderrText += decoder.decode(chunk, { stream: true });
    }
    stderrText += decoder.decode();
    return stderrText;
  })();
  const result = (async (): Promise<RunResult> => {
    const [status, out, err] = await Promise.all([
      child.status,
      stdout,
      stderr,
    ]);
    return {
      code: status.code,
      stdout: out,
      stderr: err,
      output: out + err,
    };
  })();
  return {
    result,
    stderrSoFar: () => stderrText,
    kill: (signal): void => {
      try {
        child.kill(signal);
      } catch {
        // Already settled.
      }
    },
  };
}

/** Read every logbook event whose verb is `queue`. */
async function queueEvents(root: string): Promise<unknown[]> {
  const events: unknown[] = [];
  const dir = join(root, ".git", GIT_ADMIN_STATE.logbook.path);
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
      const text = await Deno.readTextFile(join(dir, entry.name));
      for (const line of text.split("\n")) {
        if (line === "") continue;
        const event = JSON.parse(line) as { verb?: string };
        if (event.verb === "queue") events.push(event);
      }
    }
  } catch {
    return [];
  }
  return events;
}

Deno.test("queue serializes two wrapped commands at cap 1 and narrates only on stderr", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeCapConfig(dir, 1);
    await gitInit(dir);
    const marker = join(dir, "queue-markers.log");
    const runner = join(dir, "queue-runner.sh");
    await Deno.writeTextFile(
      runner,
      'id="$1"\n' +
        'log="$2"\n' +
        'printf "start-%s\\n" "$id" >> "$log"\n' +
        "sleep 0.4\n" +
        'printf "end-%s\\n" "$id" >> "$log"\n',
    );

    const release = await holdOnlySlot(dir);
    try {
      const a = await spawnAgent(dir, [
        "queue",
        "--",
        "sh",
        runner,
        "a",
        marker,
      ]);
      const b = await spawnAgent(dir, [
        "queue",
        "--",
        "sh",
        runner,
        "b",
        marker,
      ]);
      await pollUntil(
        "both wrappers to report their queue wait",
        () =>
          a.stderrSoFar().includes(QUEUED_TEXT) &&
          b.stderrSoFar().includes(QUEUED_TEXT),
      );
      assertEquals(
        await pathExists(marker),
        false,
        "neither child starts while the only slot is externally held",
      );
      release();

      const [settledA, settledB] = await Promise.all([a.result, b.result]);
      assertEquals(settledA.code, 0, settledA.output);
      assertEquals(settledB.code, 0, settledB.output);
      assertEquals(settledA.stdout, "", "queue chatter must not reach stdout");
      assertEquals(settledB.stdout, "", "queue chatter must not reach stdout");
      assertEquals(occurrenceCount(settledA.stderr, QUEUED_TEXT), 1);
      assertEquals(occurrenceCount(settledB.stderr, QUEUED_TEXT), 1);

      const lines = (await Deno.readTextFile(marker)).trim().split("\n");
      assertEquals(lines.length, 4, lines.join(", "));
      const [firstStart, firstEnd, secondStart, secondEnd] = lines;
      assert(firstStart?.startsWith("start-") === true);
      assertEquals(firstEnd, firstStart?.replace("start-", "end-"));
      assert(secondStart?.startsWith("start-") === true);
      assertEquals(secondEnd, secondStart?.replace("start-", "end-"));
      assert(firstStart !== secondStart, "both wrapped runs must execute");
      assertEquals(
        await queueEvents(dir),
        [],
        "the exec wrapper writes no logbook events",
      );
    } finally {
      release();
    }
  });
});

Deno.test("queue treats any non-empty marker as accounted and normalizes it for the child", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeCapConfig(dir, 1);
    await gitInit(dir);
    const observed = join(dir, "accounted-marker");
    const release = await holdOnlySlot(dir);
    const running = await spawnAgent(
      dir,
      [
        "queue",
        "--",
        "sh",
        "-c",
        'printf "%s" "$DISCERN_TEST_SLOT" > "$1"',
        "queue-accounted",
        observed,
      ],
      { [TEST_RUN_SLOT_ENV]: "accounted-upstream" },
    );
    let result: RunResult;
    try {
      await pollUntil(
        "the marked wrapper child to bypass the held slot",
        () => pathExists(observed),
        5_000,
      );
    } finally {
      release();
      result = await running.result;
    }
    assertEquals(result.code, 0, result.output);
    assertEquals(await Deno.readTextFile(observed), "1");
    assertEquals(
      occurrenceCount(result.stderr, QUEUED_TEXT),
      0,
      "an accounted wrapper never probes the slots",
    );
  });
});

Deno.test("queue nesting takes one slot total at cap 1", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeCapConfig(dir, 1);
    await gitInit(dir);
    const observed = join(dir, "nested-marker");
    const ready = join(dir, "nested-ready");
    const releaseChild = join(dir, "nested-release");
    const running = await spawnAgent(dir, [
      "queue",
      "--",
      "discern",
      "queue",
      "--",
      "sh",
      "-c",
      'printf "%s" "$DISCERN_TEST_SLOT" > "$1"; : > "$2"; ' +
      'while [ ! -f "$3" ]; do sleep 0.05; done',
      "queue-nested",
      observed,
      ready,
      releaseChild,
    ]);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      watchdog = setTimeout(() => running.kill("SIGTERM"), 10_000);
      await pollUntil(
        "the nested wrapper child to start",
        () => pathExists(ready),
        5_000,
      );
      const probe = await Deno.open(join(slotDirOf(dir), "slot-1"), {
        read: true,
        write: true,
      });
      try {
        assertEquals(
          await probe.tryLock(true),
          false,
          "the outer wrapper must hold the repository's one slot",
        );
      } finally {
        probe.close();
      }
      await Deno.writeTextFile(releaseChild, "go");
      const result = await running.result;
      assertEquals(result.code, 0, result.output);
      assertEquals(await Deno.readTextFile(observed), "1");
      assertEquals(occurrenceCount(result.stderr, QUEUED_TEXT), 0);
    } catch (error) {
      try {
        running.kill("SIGTERM");
      } catch {
        // Already settled.
      }
      await running.result;
      throw error;
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog);
      await Deno.writeTextFile(releaseChild, "go").catch(() => {});
    }
  });
});

Deno.test("queue around a capped gate takes one slot total at cap 1", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const observed = join(dir, "reverse-nested-marker");
    const job = join(dir, "reverse-nested-test.sh");
    await Deno.writeTextFile(
      job,
      `printf '%s' "$DISCERN_TEST_SLOT" > "${observed}"\n`,
    );
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[gate]",
        "concurrent_test_runs = 1",
        "",
        "[jobs]",
        `test = "sh ${job}"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const running = await spawnAgent(
      dir,
      ["queue", "--", "discern", "test", "--json"],
      { [TEST_RUN_SLOT_ENV]: "" },
    );
    const watchdog = setTimeout(() => running.kill("SIGTERM"), 10_000);
    try {
      const result = await running.result;
      assertEquals(result.code, 0, result.output);
      assertEquals(await Deno.readTextFile(observed), "1");
    } finally {
      clearTimeout(watchdog);
    }
  });
});

Deno.test("a capped gate completes a slot-wrapped test job at cap 1", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const observed = join(dir, "gate-held-marker");
    const job = join(dir, "wrapped-test.sh");
    await Deno.writeTextFile(
      job,
      `printf '%s' "$DISCERN_TEST_SLOT" > "${observed}"\n`,
    );
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[gate]",
        "concurrent_test_runs = 1",
        "",
        "[jobs]",
        `test = "discern queue -- sh ${job}"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const running = await spawnAgent(
      dir,
      ["test", "--json"],
      { [TEST_RUN_SLOT_ENV]: "" },
    );
    const watchdog = setTimeout(() => running.kill("SIGTERM"), 10_000);
    try {
      const result = await running.result;
      assertEquals(result.code, 0, result.output);
      assertEquals(await Deno.readTextFile(observed), "1");
    } finally {
      clearTimeout(watchdog);
    }
  });
});

Deno.test("a capped gate exports the marker after its slots fail open", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const gateObserved = join(dir, "gate-fail-open-marker");
    const nestedObserved = join(dir, "nested-fail-open-marker");
    const job = join(dir, "fail-open-test.sh");
    await Deno.writeTextFile(
      job,
      `printf '%s' "$DISCERN_TEST_SLOT" > "${gateObserved}"\n` +
        `discern queue -- sh -c 'printf "%s" "$DISCERN_TEST_SLOT" > "$1"' queue-child "${nestedObserved}"\n`,
    );
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "logbook = false",
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[gate]",
        "concurrent_test_runs = 1",
        "",
        "[jobs]",
        `test = "sh ${job}"`,
        "",
      ].join("\n"),
    );
    const result = await runAgent(dir, ["test", "--json"], {
      env: { [TEST_RUN_SLOT_ENV]: "" },
    });
    assertEquals(result.code, 0, result.output);
    assertEquals(await Deno.readTextFile(gateObserved), "1");
    assertEquals(await Deno.readTextFile(nestedObserved), "1");
    assertEquals(
      occurrenceCount(result.output, UNAVAILABLE_TEXT),
      1,
      "only the gate warns; its marked child never probes independently",
    );
  });
});

Deno.test("queue is invisible when the cap is disabled or no config exists", async () => {
  await withTempDir(async (configured) => {
    await scaffoldEngine(configured);
    await writeCapConfig(configured, 0);
    await gitInit(configured);
    const cappedOff = await runAgent(configured, [
      "queue",
      "--",
      "sh",
      "-c",
      "printf cap-zero",
    ]);
    assertEquals(cappedOff.code, 0, cappedOff.output);
    assertEquals(cappedOff.stdout, "cap-zero");
    assertEquals(cappedOff.stderr, "");
    assertEquals(await pathExists(slotDirOf(configured)), false);
  });

  await withTempDir(async (unconfigured) => {
    const noConfig = await runAgent(unconfigured, [
      "queue",
      "--",
      "sh",
      "-c",
      "printf no-config",
    ]);
    assertEquals(noConfig.code, 0, noConfig.output);
    assertEquals(noConfig.stdout, "no-config");
    assertEquals(noConfig.stderr, "");
  });
});

Deno.test("queue warns once and runs when slot files are unavailable", async () => {
  await withTempDir(async (withoutGit) => {
    await scaffoldEngine(withoutGit);
    await writeCapConfig(withoutGit, 1);
    const result = await runAgent(withoutGit, [
      "queue",
      "--",
      "sh",
      "-c",
      "printf no-git",
    ]);
    assertEquals(result.code, 0, result.output);
    assertEquals(result.stdout, "no-git");
    assertEquals(occurrenceCount(result.stderr, UNAVAILABLE_TEXT), 1);
  });

  await withTempDir(async (unopenable) => {
    await scaffoldEngine(unopenable);
    await writeCapConfig(unopenable, 1);
    await gitInit(unopenable);
    const slotDir = slotDirOf(unopenable);
    await Deno.mkdir(join(slotDir, "slot-1"), { recursive: true });
    const result = await runAgent(unopenable, [
      "queue",
      "--",
      "sh",
      "-c",
      "printf unopenable",
    ]);
    assertEquals(result.code, 0, result.output);
    assertEquals(result.stdout, "unopenable");
    assertEquals(occurrenceCount(result.stderr, UNAVAILABLE_TEXT), 1);
  });
});

Deno.test("queue forwards raw arguments, inherited streams, and the ambient environment", async () => {
  await withTempDir(async (dir) => {
    const result = await runAgent(
      dir,
      [
        "queue",
        "--",
        "sh",
        "-c",
        'printf "%s\\n" "$QUEUE_SENTINEL" "$CI" "$@"; printf child-error >&2',
        "queue-argv0",
        "--json",
        "two words",
        "--",
      ],
      { env: { QUEUE_SENTINEL: "kept", CI: "caller-value" } },
    );
    assertEquals(result.code, 0, result.output);
    assertEquals(
      result.stdout,
      "kept\ncaller-value\n--json\ntwo words\n--\n",
    );
    assertEquals(result.stderr, "child-error");
  });
});

Deno.test("queue mirrors exit codes and reports an unspawnable command as 127", async () => {
  await withTempDir(async (dir) => {
    const plain = await runAgent(dir, [
      "queue",
      "--",
      "sh",
      "-c",
      "exit 23",
    ]);
    assertEquals(plain.code, 23, plain.output);

    if (Deno.build.os !== "windows") {
      const signaled = await runAgent(dir, [
        "queue",
        "--",
        "sh",
        "-c",
        "kill -TERM $$",
      ]);
      assertEquals(signaled.code, SIGNAL_EXIT_CODES.SIGTERM, signaled.output);
    }

    const missing = await runAgent(dir, [
      "queue",
      "--",
      "discern-command-that-does-not-exist-queue",
    ]);
    assertEquals(missing.code, 127, missing.output);
    assertStringIncludes(missing.stderr, "couldn't run");
    assertStringIncludes(
      missing.stderr,
      "Run: discern queue -- <command> [args...]",
    );
  });
});

Deno.test("queue usage errors require the delimiter and a non-empty command", async () => {
  await withTempDir(async (dir) => {
    for (
      const args of [
        ["queue", "sh", "-c", "exit 0"],
        ["queue", "--"],
      ]
    ) {
      const result = await runAgent(dir, args);
      assertEquals(result.code, 2, result.output);
      assertStringIncludes(
        result.stderr,
        "Run: discern queue -- <command> [args...]",
      );
    }

    const marker = join(dir, "must-not-run");
    const json = await runAgent(dir, [
      "--json",
      "queue",
      "--",
      "sh",
      "-c",
      `touch ${marker}`,
    ]);
    assertEquals(json.code, 2, json.output);
    assertStringIncludes(json.stderr, "queue has no `--json` mode");
    assertEquals(await pathExists(marker), false);
  });
});

Deno.test("queue child flags cannot select discern global modes", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, "[project\n");
    const result = await runAgent(dir, [
      "queue",
      "--",
      "sh",
      "-c",
      "exit 0",
      "--json",
    ]);
    assertEquals(result.code, 1, result.output);
    assertEquals(result.stdout, "");
    assertStringIncludes(result.stderr, "syntax error near line 1");
  });
});

Deno.test("queue and await help cross-reference their distinct wait surfaces", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const queueHelp = await runAgent(dir, ["queue", "--help"]);
    assertEquals(queueHelp.code, 0, queueHelp.output);
    assertStringIncludes(queueHelp.stdout, "discern await");
    assertStringIncludes(
      queueHelp.stdout,
      "discern queue -- <command> [args...]",
    );

    const awaitHelp = await runAgent(dir, ["await", "--help"]);
    assertEquals(awaitHelp.code, 0, awaitHelp.output);
    assertStringIncludes(
      awaitHelp.stdout,
      "discern queue -- <command> [args...]",
    );
  });
});
