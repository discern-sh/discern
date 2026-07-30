/**
 * Engine tests for the fleet test-run cap (`[gate].concurrent_test_runs`): at
 * most N test-stage runs in flight across every checkout of the repository,
 * held as OS advisory file locks on content-free slot files under the git
 * common dir.
 *
 * The design's spine is tested at two levels. Unit: the lock primitive itself
 * — exclusivity across separate opens (the same-process MCP case) and the
 * kernel releasing a killed holder's lock (crash-safety without a daemon).
 * Engine: enrolment and scheduling, driven black-box through `src/main.ts`.
 *
 * The concurrency tests are built to be deterministic rather than timing-based:
 * the test itself holds the only slot while both engine runs start, so overlap
 * is guaranteed by construction; enrolment failures surface as job markers
 * appearing while the slot is still held; and after release the semaphore
 * itself forces the strict start/end ordering the asserts require. The queued
 * notice is proven at the unit level, where the held slot stays held until the
 * hint is observed — an engine run's first probe after release can land on an
 * already-free slot on a loaded machine, so no envelope-level assert may
 * demand the notice without reintroducing a race.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import {
  buildTestRunSlots,
  groupNeedsTestSlot,
} from "../src/engine/gate/test_slots.ts";
import type { JobGroup } from "../src/engine/gate/plan.ts";
import { makeOut } from "../src/engine/output.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

const QUEUED_TEXT = "Tests queued";

interface SlotEnvelope {
  ok: boolean;
  hints?: string[];
  data?: { failed_stage?: string | null };
}

function parseEnvelope(stdout: string, context: string): SlotEnvelope {
  try {
    return JSON.parse(stdout) as SlotEnvelope;
  } catch {
    throw new Error(`unparseable ${context} envelope: ${stdout}`);
  }
}

/** Whether a run narrated the queued notice — asserted ABSENT where a probe
 * must never wait; presence is only ever asserted at the unit level. */
function hasQueuedHint(envelope: SlotEnvelope): boolean {
  return (envelope.hints ?? []).some((h) => h.includes(QUEUED_TEXT));
}

/** Poll a predicate to true within a bound; a miss names what never happened. */
async function pollUntil(
  what: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The shared marker log the fake jobs append to (absent → no lines yet). */
async function logLines(path: string): Promise<string[]> {
  try {
    return (await Deno.readTextFile(path)).split("\n").filter((l) => l !== "");
  } catch {
    return [];
  }
}

/** Count the logbook's begin events for one verb (0 when nothing recorded). */
async function beginEvents(mainDir: string, verb: string): Promise<number> {
  const dir = join(mainDir, ".git", GIT_ADMIN_STATE.logbook.path);
  let count = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      const text = await Deno.readTextFile(join(dir, entry.name));
      for (const line of text.split("\n")) {
        try {
          const event = JSON.parse(line) as { kind?: string; verb?: string };
          if (event.kind === "begin" && event.verb === verb) {
            count++;
          }
        } catch {
          // A torn line is the reader's tolerance contract, not a test failure.
        }
      }
    }
  } catch {
    return 0;
  }
  return count;
}

const slotDirOf = (mainDir: string): string =>
  join(mainDir, ".git", GIT_ADMIN_STATE.testSlots.path);

/** Hold one slot from the test process; the returned release closes the file. */
async function holdSlot(mainDir: string, index = 1): Promise<() => void> {
  const dir = slotDirOf(mainDir);
  await Deno.mkdir(dir, { recursive: true });
  const file = await Deno.open(join(dir, `slot-${index}`), {
    create: true,
    read: true,
    write: true,
  });
  const acquired = await file.tryLock(true);
  if (!acquired) {
    file.close();
    throw new Error(`slot-${index} unexpectedly held by someone else`);
  }
  let released = false;
  return (): void => {
    if (!released) {
      released = true;
      file.close();
    }
  };
}

/** A serial marker job: `start-<checkout>` … sleep … `end-<checkout>`. */
async function writeMarkerJob(
  auxDir: string,
  logPath: string,
  sleepS: string,
  metricLine?: string,
): Promise<string> {
  const path = join(auxDir, metricLine === undefined ? "job.sh" : "std.sh");
  await Deno.writeTextFile(
    path,
    `name=$(basename "$PWD")\n` +
      `echo "start-$name" >> "${logPath}"\n` +
      `sleep ${sleepS}\n` +
      `echo "end-$name" >> "${logPath}"\n` +
      (metricLine === undefined ? "" : `echo "${metricLine}"\n`),
  );
  return path;
}

/** Strict serialization: exactly start,end,start,end with matched names. */
function assertSerialized(lines: string[]): void {
  assertEquals(lines.length, 4, `expected 4 marker lines: ${lines.join(", ")}`);
  const [a1, a2, b1, b2] = lines;
  assert(a1?.startsWith("start-") === true, `first line: ${a1}`);
  assertEquals(a2, a1?.replace("start-", "end-"), "first run ends before next");
  assert(b1?.startsWith("start-") === true, `third line: ${b1}`);
  assertEquals(b2, b1?.replace("start-", "end-"), "second run ends last");
  assert(a1 !== b1, "the two runs are distinct checkouts");
}

// ── the lock primitive ──────────────────────────────────────────────────────

Deno.test("test slots: the lock excludes a second open of the same file, same process included", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "slot-1");
    const first = await Deno.open(path, {
      create: true,
      read: true,
      write: true,
    });
    const second = await Deno.open(path, { read: true, write: true });
    try {
      assertEquals(await first.tryLock(true), true, "free slot acquires");
      // A second open file description must NOT share the lock — this is what
      // caps two gates running inside one long-lived MCP server process.
      assertEquals(await second.tryLock(true), false, "held slot refuses");
    } finally {
      first.close();
    }
    // Closing the holder releases the lock for the next open description.
    assertEquals(await second.tryLock(true), true, "released slot acquires");
    second.close();
  });
});

Deno.test("test slots: a killed holder's slot is immediately acquirable (the OS releases the lock)", async () => {
  await withTempDir(async (dir) => {
    const slotPath = join(dir, "slot-1");
    const readyPath = join(dir, "ready");
    const holderPath = join(dir, "holder.ts");
    await Deno.writeTextFile(
      holderPath,
      `const [path, ready] = Deno.args;\n` +
        `const f = await Deno.open(path, { read: true, write: true, create: true });\n` +
        `const ok = await f.tryLock(true);\n` +
        `await Deno.writeTextFile(ready, ok ? "locked" : "failed");\n` +
        // A pending timer keeps the process (and so the lock) alive until the
        // test kills it — a bare unresolved promise would let the event loop
        // drain and the exiting process would release the lock early.
        `setInterval(() => {}, 1_000_000);\n`,
    );
    const holder = new Deno.Command("deno", {
      args: [
        "run",
        `--allow-read=${dir}`,
        `--allow-write=${dir}`,
        holderPath,
        slotPath,
        readyPath,
      ],
      stdout: "null",
      stderr: "null",
    }).spawn();
    const status = holder.status;
    try {
      await pollUntil("the holder to take the lock", async () => {
        try {
          return (await Deno.readTextFile(readyPath)) === "locked";
        } catch {
          return false;
        }
      });
      const probe = await Deno.open(slotPath, { read: true, write: true });
      try {
        assertEquals(
          await probe.tryLock(true),
          false,
          "the live holder's lock excludes",
        );
        // SIGKILL — no handler runs, no unlock is called. Only the OS can
        // release the lock, which is the crash-safety the design rests on.
        holder.kill("SIGKILL");
        await status;
        await pollUntil(
          "the killed holder's slot to free",
          () => probe.tryLock(true),
          5_000,
        );
      } finally {
        probe.close();
      }
    } finally {
      try {
        holder.kill("SIGKILL");
      } catch {
        // Already dead — the happy path.
      }
      await status;
    }
  });
});

Deno.test("test slots: groupNeedsTestSlot derives from the jobs, not the verb", () => {
  const group = (jobs: JobGroup["jobs"]): JobGroup => ({
    stage: "test",
    mode: "parallel",
    heading: "",
    display: "",
    jobs,
  });
  const job = (
    over: Partial<JobGroup["jobs"][number]>,
  ): JobGroup["jobs"][number] => ({
    label: "j",
    command: "true",
    kind: "known",
    reportStage: "test",
    willRun: true,
    ...over,
  });
  assertEquals(groupNeedsTestSlot(group([job({})])), true, "a firing test job");
  assertEquals(
    groupNeedsTestSlot(group([job({ kind: "standard", reportStage: "test" })])),
    true,
    "a firing standard measurement",
  );
  assertEquals(
    groupNeedsTestSlot(group([job({ reportStage: "check" })])),
    false,
    "a check job never draws a slot",
  );
  assertEquals(
    groupNeedsTestSlot(group([job({ kind: "standard", willRun: false })])),
    false,
    "a replay-only standards group runs nothing",
  );
});

Deno.test("test slots: a queued acquire fires the wait notice, then resolves when the slot frees", async () => {
  await withTempDir(async (dir) => {
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
      ].join("\n"),
    );
    await gitInit(dir);
    // Deterministic by construction: the only slot stays held until the wait
    // notice is OBSERVED, so the first probe cannot land on a free slot.
    const release = await holdSlot(dir);
    try {
      const slots = buildTestRunSlots(dir, await loadConfig(dir));
      assert(slots !== undefined, "cap=1 must build a slot surface");
      assertEquals(slots.cap, 1);
      const pending = slots.acquire(makeOut(false, { quiet: true }));
      await pollUntil(
        "the queued notice",
        () => slots.waits.some((h) => h.text.includes(QUEUED_TEXT)),
      );
      release();
      const hold = await pending;
      assert(hold !== undefined, "acquire resolves once the slot frees");
      hold.release();
    } finally {
      release();
    }
  });
});

// ── enrolment and scheduling, black-box through the engine ──────────────────

Deno.test("gate slots: cap=1 serializes two concurrent test runs and begins before the wait", async () => {
  await withTempDir(async (dir) => {
    const aux = await Deno.makeTempDir({ prefix: "discern-slots-aux-" });
    try {
      const logPath = join(aux, "markers.log");
      const jobPath = await writeMarkerJob(aux, logPath, "1.5");
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
          `test = "sh ${jobPath}"`,
          "",
        ].join("\n"),
      );
      await gitInit(dir);
      const worktree = await addWorktree(dir, "slots-b");

      // Hold the only slot BEFORE either engine starts: overlap is then a
      // construction fact, not a race the test hopes to win.
      const release = await holdSlot(dir);
      try {
        const runA = runAgent(dir, ["test", "--json"]);
        const runB = runAgent(worktree, ["test", "--json"]);
        // Deliverable-shaped ordering proof: both runs' begin events reach the
        // logbook while the slot is still held and no test job has started —
        // a queued gate reads as running on fleet rows, never dormant.
        await pollUntil(
          "both begin events",
          async () => (await beginEvents(dir, "test")) >= 2,
        );
        assertEquals(
          await logLines(logPath),
          [],
          "no test job may start while the slot is held",
        );
        release();
        const [a, b] = await Promise.all([runA, runB]);
        const envelopeA = parseEnvelope(a.stdout, "run A");
        const envelopeB = parseEnvelope(b.stdout, "run B");
        assertEquals(a.code, 0, a.output);
        assertEquals(b.code, 0, b.output);
        assertEquals(envelopeA.ok, true);
        assertEquals(envelopeB.ok, true);
        assertSerialized(await logLines(logPath));
        // No queued-notice assert here: after release, a run's first probe can
        // land on a free slot on a loaded machine. The notice's determinism is
        // the unit test's job, where the hold outlives the observation.
      } finally {
        release();
      }
    } finally {
      await Deno.remove(aux, { recursive: true });
    }
  });
});

Deno.test("gate slots: cap=2 lets two test runs overlap", async () => {
  await withTempDir(async (dir) => {
    const aux = await Deno.makeTempDir({ prefix: "discern-slots-aux-" });
    try {
      const logPath = join(aux, "markers.log");
      // A handshake job: each run announces itself, then succeeds only once it
      // has seen BOTH announcements — provable overlap, no fixed sleeps. Under
      // a wrongly serializing cap the first run never sees the second and the
      // bounded wait fails the job.
      const jobPath = join(aux, "handshake.sh");
      await Deno.writeTextFile(
        jobPath,
        `echo "start-$(basename "$PWD")" >> "${logPath}"\n` +
          `i=0\n` +
          `while [ "$(grep -c start- "${logPath}")" -lt 2 ]; do\n` +
          `  i=$((i+1))\n` +
          `  if [ "$i" -gt 200 ]; then exit 1; fi\n` +
          `  sleep 0.1\n` +
          `done\n`,
      );
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
          "concurrent_test_runs = 2",
          "",
          "[jobs]",
          `test = "sh ${jobPath}"`,
          "",
        ].join("\n"),
      );
      await gitInit(dir);
      const worktree = await addWorktree(dir, "slots-overlap");
      const [a, b] = await Promise.all([
        runAgent(dir, ["test", "--json"]),
        runAgent(worktree, ["test", "--json"]),
      ]);
      assertEquals(
        a.code,
        0,
        `run A failed — did cap=2 serialize?\n${a.output}`,
      );
      assertEquals(
        b.code,
        0,
        `run B failed — did cap=2 serialize?\n${b.output}`,
      );
    } finally {
      await Deno.remove(aux, { recursive: true });
    }
  });
});

Deno.test("gate slots: a check failure fails fast without ever waiting for a slot", async () => {
  await withTempDir(async (dir) => {
    const aux = await Deno.makeTempDir({ prefix: "discern-slots-aux-" });
    try {
      const logPath = join(aux, "markers.log");
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
          'lint = "exit 1"',
          `test = "sh -c 'echo ran >> ${logPath}'"`,
          "",
        ].join("\n"),
      );
      await gitInit(dir);
      // The only slot stays held for the WHOLE run: if the check stage (or the
      // run as a whole) queued before failing, `done` would hang here instead
      // of returning red.
      const release = await holdSlot(dir);
      try {
        const r = await runAgent(dir, ["done", "--json"]);
        const envelope = parseEnvelope(r.stdout, "done");
        assertEquals(r.code, 1, r.output);
        assertEquals(envelope.ok, false);
        // Under a cap the plan splits check from test, so the red stage is the
        // check stage itself — the fail-fast happened before any slot wait.
        assertEquals(envelope.data?.failed_stage, "check");
        assertEquals(
          await logLines(logPath),
          [],
          "the test job never ran behind the failed check",
        );
        assertEquals(hasQueuedHint(envelope), false, "no wait was narrated");
      } finally {
        release();
      }
    } finally {
      await Deno.remove(aux, { recursive: true });
    }
  });
});

Deno.test("gate slots: prepare never draws a slot", async () => {
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
        'lint = "echo checked"',
        'test = "echo tested"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const release = await holdSlot(dir);
    try {
      // prepare runs fix + check only; with the only slot held it must still
      // complete green, proving it never queues for the cap.
      const r = await runAgent(dir, ["prepare", "--json"]);
      const envelope = parseEnvelope(r.stdout, "prepare");
      assertEquals(r.code, 0, r.output);
      assertEquals(envelope.ok, true);
      assertEquals(hasQueuedHint(envelope), false);
    } finally {
      release();
    }
  });
});

Deno.test("gate slots: standards' measurement pass enrols like a test run", async () => {
  await withTempDir(async (dir) => {
    const aux = await Deno.makeTempDir({ prefix: "discern-slots-aux-" });
    try {
      const logPath = join(aux, "markers.log");
      const stdPath = await writeMarkerJob(
        aux,
        logPath,
        "1",
        "DISCERN_METRIC marker 1",
      );
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
          "[standards.marker]",
          'direction = "up"',
          "limit = 1",
          `run = "sh ${stdPath}"`,
          "",
        ].join("\n"),
      );
      await gitInit(dir);
      const worktree = await addWorktree(dir, "slots-std");
      const release = await holdSlot(dir);
      try {
        const runA = runAgent(dir, ["standards", "--json"]);
        const runB = runAgent(worktree, ["standards", "--json"]);
        await pollUntil(
          "both standards begin events",
          async () => (await beginEvents(dir, "standards")) >= 2,
        );
        assertEquals(
          await logLines(logPath),
          [],
          "no measurement may run while the slot is held",
        );
        release();
        const [a, b] = await Promise.all([runA, runB]);
        const envelopeA = parseEnvelope(a.stdout, "standards A");
        const envelopeB = parseEnvelope(b.stdout, "standards B");
        assertEquals(a.code, 0, a.output);
        assertEquals(b.code, 0, b.output);
        assertEquals(envelopeA.ok, true);
        assertEquals(envelopeB.ok, true);
        assertSerialized(await logLines(logPath));
        // No queued-notice assert here: after release, a run's first probe can
        // land on a free slot on a loaded machine. The notice's determinism is
        // the unit test's job, where the hold outlives the observation.
      } finally {
        release();
      }
    } finally {
      await Deno.remove(aux, { recursive: true });
    }
  });
});

Deno.test("gate slots: the default (0, uncapped) leaves no slot files behind", async () => {
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
        "[jobs]",
        'test = "echo tested"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["test", "--json"]);
    assertEquals(r.code, 0, r.output);
    let exists = true;
    try {
      await Deno.stat(slotDirOf(dir));
    } catch {
      exists = false;
    }
    assertEquals(exists, false, "an uncapped run creates no slot machinery");
  });
});
