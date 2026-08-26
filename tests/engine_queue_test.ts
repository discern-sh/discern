/**
 * Black-box coverage for `discern queue`: raw exec forwarding, fleet-slot
 * serialization, config-state fallbacks, help, and process exit semantics.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { SIGNAL_EXIT_CODES } from "../src/engine/process_signals.ts";
import { parseQueueInvocation } from "../src/engine/queue.ts";
import { TEST_RUN_SLOT_ENV } from "../src/engine/test_run_slots.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./fixtures/pty_process.ts";
import {
  addWorktree,
  engineEnv,
  engineRunArgs,
  gitInit,
  runAgent,
  type RunResult,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { bestEffortFs, pathExists } from "../src/shared/fs_presence.ts";
import { logbookEventSchema } from "../src/engine/logbook/schema.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { waitUntil } from "./waiting.ts";

const DENO_TASKS_SCHEMA = z.object({
  tasks: z.record(z.string(), z.string()).optional(),
}).passthrough();

const QUEUED_TEXT = "Tests queued";
const UNAVAILABLE_TEXT = "The concurrent test-run cap is not enforced";

Deno.test("queue routing consumes required global-option values before its delimiter", () => {
  const globalFlags = new Set(["--plain", "--theme"]);
  const valueFlags = new Set(["--theme"]);
  assertEquals(
    parseQueueInvocation(
      ["--theme", "light", "--", "printf", "ok"],
      globalFlags,
      valueFlags,
    ),
    { kind: "run", command: "printf", args: ["ok"] },
  );
  assertEquals(
    parseQueueInvocation(
      ["--theme=dark", "--", "printf", "ok"],
      globalFlags,
      valueFlags,
    ),
    { kind: "run", command: "printf", args: ["ok"] },
  );
});

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

/** Count non-overlapping appearances of one diagnostic fragment. */
function occurrenceCount(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
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
  /** Stdout accumulated so far, for deterministic gate-wait readiness. */
  readonly stdoutSoFar: () => string;
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
    args: engineRunArgs(args),
    cwd: dir,
    env: await engineEnv(env),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let stdoutText = "";
  const stdoutDecoder = new TextDecoder();
  const stdout = (async (): Promise<string> => {
    for await (const chunk of child.stdout) {
      stdoutText += stdoutDecoder.decode(chunk, { stream: true });
    }
    stdoutText += stdoutDecoder.decode();
    return stdoutText;
  })();
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
    stdoutSoFar: () => stdoutText,
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

/** Await one fixture process by condition, terminating it if its bound expires. */
async function settledAgent(
  running: RunningAgent,
  describe: string,
): Promise<RunResult> {
  let outcome:
    | { readonly ok: true; readonly value: RunResult }
    | { readonly ok: false; readonly error: unknown }
    | undefined;
  void running.result.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  try {
    await waitUntil(() => outcome !== undefined, describe, {
      timeoutMs: TEST_PROCESS_TIMEOUT_MS,
      intervalMs: 50,
    });
  } catch (error) {
    running.kill("SIGTERM");
    await running.result.catch(() => undefined);
    throw error;
  }
  if (outcome?.ok === false) throw outcome.error;
  if (outcome === undefined) throw new Error(`${describe} settled without evidence`);
  return outcome.value;
}

interface QueueEvent {
  kind: "begin" | "verb";
  invocation?: string | undefined;
  target?: string | undefined;
  outcome?: string | undefined;
  duration_ms?: number | undefined;
  waited_ms?: number | undefined;
}

/** Read every logbook event whose verb is `queue`. */
async function queueEvents(root: string): Promise<QueueEvent[]> {
  return await bestEffortFs(async () => {
    const events: QueueEvent[] = [];
    const dir = join(root, ".git", GIT_ADMIN_STATE.logbook.path);
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
      const text = await Deno.readTextFile(join(dir, entry.name));
      for (const line of text.split("\n")) {
        if (line === "") continue;
        const event = decodeWith(logbookEventSchema, line);
        if (
          event.verb === "queue" &&
          (event.kind === "begin" || event.kind === "verb")
        ) {
          events.push(event);
        }
      }
    }
    return events;
  }, {
    onFailure: [],
    reason:
      "This test helper treats an absent, malformed, or unreadable logbook as no queue events.",
  });
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
      await waitUntil(
        () =>
          a.stderrSoFar().includes(QUEUED_TEXT) &&
          b.stderrSoFar().includes(QUEUED_TEXT),
        "both wrappers to report their queue wait",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS, intervalMs: 50 },
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
      const events = await queueEvents(dir);
      assertEquals(
        events.length,
        4,
        "each wrapper writes one paired lifecycle",
      );
      const begins = events.filter((event) => event.kind === "begin");
      const completions = events.filter((event) => event.kind === "verb");
      assertEquals(begins.length, 2);
      assertEquals(completions.length, 2);
      assertEquals(completions.map((event) => event.target), ["sh", "sh"]);
      assertEquals(completions.map((event) => event.outcome), ["ok", "ok"]);
      assert(
        completions.every((event) => (event.waited_ms ?? 0) > 0),
        "both externally contended wrappers record their slot wait",
      );
      assert(
        completions.every((event) =>
          (event.duration_ms ?? 0) >= (event.waited_ms ?? 0)
        ),
        "end-to-end duration includes the separate wait",
      );
      assertEquals(
        new Set(begins.map((event) => event.invocation)),
        new Set(completions.map((event) => event.invocation)),
        "every queue begin pairs with one completion",
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
        `printf "%s" "$${TEST_RUN_SLOT_ENV}" > "$1"`,
        "queue-accounted",
        observed,
      ],
      { [TEST_RUN_SLOT_ENV]: "accounted-upstream" },
    );
    let result: RunResult;
    try {
      await waitUntil(
        () => pathExists(observed),
        "the marked wrapper child to bypass the held slot",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS, intervalMs: 50 },
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
    assertEquals(
      await queueEvents(dir),
      [],
      "an accounted wrapper leaves telemetry to its ancestor",
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
      `printf "%s" "$${TEST_RUN_SLOT_ENV}" > "$1"; : > "$2"; ` +
      'while [ ! -f "$3" ]; do sleep 0.05; done',
      "queue-nested",
      observed,
      ready,
      releaseChild,
    ]);
    try {
      await waitUntil(
        () => pathExists(ready),
        "the nested wrapper child to start",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS, intervalMs: 50 },
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
      const result = await settledAgent(running, "the nested queue process to settle");
      assertEquals(result.code, 0, result.output);
      assertEquals(await Deno.readTextFile(observed), "1");
      assertEquals(occurrenceCount(result.stderr, QUEUED_TEXT), 0);
      const events = await queueEvents(dir);
      assertEquals(events.length, 2, "only the outer wrapper owns telemetry");
      assertEquals(events.map((event) => event.kind), ["begin", "verb"]);
      assertEquals(events[1]?.target, "discern");
      assertEquals(events[1]?.waited_ms, 0);
    } catch (error) {
      try {
        running.kill("SIGTERM");
      } catch {
        // Already settled.
      }
      await running.result;
      throw error;
    } finally {
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
      `printf '%s' "$${TEST_RUN_SLOT_ENV}" > "${observed}"\n`,
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
    const result = await settledAgent(running, "the capped gate queue to settle");
    assertEquals(result.code, 0, result.output);
    assertEquals(await Deno.readTextFile(observed), "1");
    const events = await queueEvents(dir);
    assertEquals(events.length, 2, "the outer wrapper owns telemetry");
    assertEquals(events.map((event) => event.kind), ["begin", "verb"]);
    assertEquals(events[1]?.target, "discern");
  });
});

Deno.test("a gate queued behind a wrapped sibling names queue on its wait line", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
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
        'test = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const sibling = await addWorktree(dir, "queue-visible-holder");
    const ready = join(dir, "queue-visible-ready");
    const release = join(dir, "queue-visible-release");
    const holder = await spawnAgent(sibling, [
      "queue",
      "--",
      "sh",
      "-c",
      ': > "$1"; while [ ! -f "$2" ]; do sleep 0.05; done',
      "queue-holder",
      ready,
      release,
    ]);
    let gate: RunningAgent | undefined;
    try {
      await waitUntil(
        () => pathExists(ready),
        "the wrapped sibling to hold the slot",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS, intervalMs: 50 },
      );
      await waitUntil(
        async () =>
          (await queueEvents(dir)).some((event) => event.kind === "begin"),
        "the queue begin event",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS, intervalMs: 50 },
      );
      gate = await spawnAgent(dir, ["test"], { [TEST_RUN_SLOT_ENV]: "" });
      await waitUntil(
        () => gate?.stdoutSoFar().includes(QUEUED_TEXT) === true,
        "the gate wait line",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS, intervalMs: 50 },
      );
      assertStringIncludes(
        gate.stdoutSoFar(),
        "In flight: queue on agent/queue-visible-holder",
      );
      await Deno.writeTextFile(release, "go");
      const [holderResult, gateResult] = await Promise.all([
        holder.result,
        gate.result,
      ]);
      assertEquals(holderResult.code, 0, holderResult.output);
      assertEquals(gateResult.code, 0, gateResult.output);
    } finally {
      await Deno.writeTextFile(release, "go").catch(() => {});
      await holder.result;
      if (gate !== undefined) await gate.result;
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
      `printf '%s' "$${TEST_RUN_SLOT_ENV}" > "${observed}"\n`,
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
    const result = await settledAgent(running, "the nested gate queue to settle");
    assertEquals(result.code, 0, result.output);
    assertEquals(await Deno.readTextFile(observed), "1");
    assertEquals(
      await queueEvents(dir),
      [],
      "the gate owns the marked inner wrapper's lifecycle",
    );
  });
});

Deno.test("the repository's habitual and targeted test commands stay queue-wrapped", async () => {
  const denoConfig = decodeWith(
    DENO_TASKS_SCHEMA,
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  );
  assertEquals(
    denoConfig.tasks?.["test:preflight"],
    "deno run --allow-net=127.0.0.1 scripts/test_preflight.ts",
  );
  assertEquals(
    denoConfig.tasks?.test,
    "discern queue -- deno run --allow-read --allow-env --allow-run --allow-net=127.0.0.1 scripts/run_tests.ts",
  );

  const testingGuide = await Deno.readTextFile(
    join(REPO_AUTHORED_PATHS.map, "80-development", "testing.md"),
  );
  assertEquals(
    /^deno test(?:\s|$)/m.exec(testingGuide),
    null,
    "testing instructions must send runnable examples through the wrapped task",
  );
  assertStringIncludes(
    testingGuide,
    "deno task test tests/upgrade_migrations_test.ts",
  );
  assertStringIncludes(testingGuide, 'deno task test --filter "convergence"');
});

Deno.test("a capped gate exports the marker after its slots fail open", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const gateObserved = join(dir, "gate-fail-open-marker");
    const nestedObserved = join(dir, "nested-fail-open-marker");
    const job = join(dir, "fail-open-test.sh");
    await Deno.writeTextFile(
      job,
      `printf '%s' "$${TEST_RUN_SLOT_ENV}" > "${gateObserved}"\n` +
        `discern queue -- sh -c 'printf "%s" "$${TEST_RUN_SLOT_ENV}" > "$1"' queue-child "${nestedObserved}"\n`,
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
    const events = await queueEvents(configured);
    assertEquals(events.length, 2);
    assertEquals(
      events[1]?.waited_ms,
      undefined,
      "an uncapped wrapper omits wait accounting",
    );
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
    assertTerminalTextIncludes(missing.stderr, "couldn't run");
    assertTerminalTextIncludes(
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
      assertTerminalTextIncludes(
        result.stderr,
        "Run: discern queue -- <command> [args...]",
      );
    }

    for (const flag of ["--json", "--markdown", "--render"]) {
      const marker = join(dir, `must-not-run-${flag.slice(2)}`);
      const result = await runAgent(dir, [
        flag,
        "queue",
        "--",
        "sh",
        "-c",
        `touch ${marker}`,
      ]);
      assertEquals(result.code, 2, result.output);
      assertTerminalTextIncludes(
        result.stderr,
        "queue has no `--json`, `--markdown`, or `--render` mode",
      );
      assertEquals(await pathExists(marker), false);
    }
  });
});

Deno.test("queue child flags cannot select discern global modes", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, "[project\n");
    for (const flag of ["--json", "--markdown", "--render"]) {
      const result = await runAgent(dir, [
        "queue",
        "--",
        "sh",
        "-c",
        "exit 0",
        flag,
      ]);
      assertEquals(result.code, 1, result.output);
      assertEquals(result.stdout, "");
      assertTerminalTextIncludes(result.stderr, "syntax error near line 1");
    }
  });
});

Deno.test("queue and await help cross-reference their distinct wait surfaces", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const queueHelp = await runAgent(dir, ["queue", "--help"]);
    assertEquals(queueHelp.code, 0, queueHelp.output);
    assertTerminalTextIncludes(queueHelp.stdout, "discern await");
    assertTerminalTextIncludes(
      queueHelp.stdout,
      "discern queue -- <command> [args...]",
    );
    assert(
      !/^\s+--json\s+-/m.test(queueHelp.stdout),
      `queue help must not advertise its unsupported JSON mode:\n${queueHelp.stdout}`,
    );

    const awaitHelp = await runAgent(dir, ["await", "--help"]);
    assertEquals(awaitHelp.code, 0, awaitHelp.output);
    assertTerminalTextIncludes(
      awaitHelp.stdout,
      "discern queue -- <command> [args...]",
    );
  });
});
