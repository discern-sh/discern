/** Operation journals survive their observers and never outlive their bounds. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  emitCompletionEvent,
  emitCompletionFailure,
  emitCompletionProgress,
} from "../src/engine/completion/events.ts";
import {
  normalizeOperationHandle,
  openOperationJournal,
  OPERATION_JOURNAL_TTL_MS,
  readOperationJournal,
  withOperationJournal,
} from "../src/engine/completion/operation_journal.ts";
import { z } from "@zod/zod";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";

/** A minimal committed repository so the common admin directory resolves. */
async function repository(root: string): Promise<void> {
  await Deno.writeTextFile(join(root, "readme"), "journal fixture\n");
  await gitInit(root);
}

/** One tiny result envelope for retention tests. */
function envelope(ok: boolean, message: string): DiscernResult {
  return ok
    ? { ok: true, verb: "done", steps: [], message }
    : { ok: false, verb: "done", error: "gate_failed", steps: [], message };
}

Deno.test("a journalled operation retains facts, timings, and its final result", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const result = await withOperationJournal(
      root,
      { verb: "done", path: root, branch: "agent/sample" },
      (handle) => {
        assert(handle !== undefined);
        assertEquals(normalizeOperationHandle(handle), handle);
        emitCompletionProgress({
          phase: "producer",
          state: "running",
          candidate_id: "candidate",
          reason: "Running test: 3 of 8 partitions done, 1 failure so far.",
          work: {
            producer: "test",
            units: { kind: "partitions", completed: 3, total: 8 },
            results: { failed: 1 },
          },
        });
        emitCompletionProgress({
          phase: "producer",
          state: "finished",
          candidate_id: "candidate",
          reason: "test failed.",
          work: { producer: "test", output_path: "/tmp/discern-job-sample" },
        });
        emitCompletionFailure({
          producer: "test",
          name: "alpha holds",
          message: "expected 2, got 3",
          file: "tests/red_test.ts",
          line: 7,
          reproduce_cmd:
            "deno task test tests/red_test.ts --filter 'alpha holds'",
          partial: false,
        });
        // The environment return is its own named boundary, never inferred.
        emitCompletionEvent({
          id: "return",
          effort_id: "effort",
          source_head: "head",
          candidate_id: "candidate",
          attempt_id: "attempt",
          executor_operation: "operation",
          at: 9,
          fact: {
            kind: "timing",
            interval_id: "attempt",
            category: "validation",
            started_at: 4,
            finished_at: 9,
          },
        });
        return Promise.resolve(envelope(true, "Gate passed."));
      },
      { result: (value) => value },
    );
    assertEquals(result.ok, true);
    const reading = await readOperationJournal(root);
    assert(reading.kind === "found");
    assertEquals(reading.record.operation.verb, "done");
    assertEquals(reading.record.operation.branch, "agent/sample");
    assertEquals(reading.record.outcome, "completed");
    assert(reading.record.operation.finished_at !== undefined);
    assertEquals(reading.executor, "gone");
    // The producer account merged across facts instead of replacing itself.
    assertEquals(reading.record.producers?.test, {
      producer: "test",
      units: { kind: "partitions", completed: 3, total: 8 },
      results: { failed: 1 },
      output_path: "/tmp/discern-job-sample",
    });
    assertEquals(reading.record.failures?.length, 1);
    assertEquals(reading.record.failures?.[0]?.name, "alpha holds");
    assertEquals(reading.record.timings, [{
      category: "validation",
      interval_id: "attempt",
      started_at: 4,
      finished_at: 9,
    }]);
    const stored = reading.record.result as { message?: string };
    assertEquals(stored.message, "Gate passed.");
    const byHandle = await readOperationJournal(root, reading.handle);
    assert(byHandle.kind === "found");
    assertEquals(byHandle.record, reading.record);
  });
});

Deno.test("a journal outlives its executor and reports the process gone", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const journal = await openOperationJournal(root, {
      verb: "accept",
      path: root,
    }, { pid: 4_000_000 });
    assert(journal !== undefined);
    await journal.observe({
      kind: "progress",
      progress: {
        phase: "operation",
        state: "waiting",
        candidate_id: null,
        reason:
          "Waiting for test-run capacity; independent checks can continue.",
      },
    });
    const reading = await readOperationJournal(root, journal.handle);
    assert(reading.kind === "found");
    assertEquals(reading.record.outcome, undefined);
    assertEquals(reading.executor, "gone");
    assertEquals(
      reading.record.progress?.reason,
      "Waiting for test-run capacity; independent checks can continue.",
    );
    const live = await openOperationJournal(root, {
      verb: "await",
      path: root,
    });
    assert(live !== undefined);
    const running = await readOperationJournal(root, live.handle);
    assert(running.kind === "found");
    assertEquals(running.executor, "running");
  });
});

Deno.test("executor cancellation closes the journal; a failed run stays failed", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const abort = new AbortController();
    abort.abort();
    await assertRejects(
      () =>
        withOperationJournal(
          root,
          { verb: "done", path: root },
          (): Promise<DiscernResult> =>
            Promise.reject(new Error("validation cancelled")),
          { signal: abort.signal, result: (value) => value },
        ),
      Error,
      "validation cancelled",
    );
    const cancelled = await readOperationJournal(root);
    assert(cancelled.kind === "found");
    assertEquals(cancelled.record.outcome, "cancelled");
    await assertRejects(
      () =>
        withOperationJournal(
          root,
          { verb: "done", path: root },
          (): Promise<DiscernResult> => Promise.reject(new Error("exploded")),
          { result: (value) => value },
        ),
      Error,
      "exploded",
    );
    const failed = await readOperationJournal(root);
    assert(failed.kind === "found");
    assertEquals(failed.record.outcome, "failed");
  });
});

Deno.test("handles validate, refuse damage, and expired records leave the store", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    assertEquals(await readOperationJournal(root), { kind: "none-recorded" });
    assertEquals(
      await readOperationJournal(root, "R1-NOT-REAL"),
      { kind: "invalid-handle" },
    );
    const journal = await openOperationJournal(root, {
      verb: "done",
      path: root,
    });
    assert(journal !== undefined);
    const damaged = journal.handle.endsWith("A")
      ? `${journal.handle.slice(0, -1)}B`
      : `${journal.handle.slice(0, -1)}A`;
    assertEquals(
      await readOperationJournal(root, damaged),
      { kind: "invalid-handle" },
    );
    // Expiry: a later create prunes a record older than the retention window.
    const expired = await openOperationJournal(root, {
      verb: "done",
      path: root,
    }, {
      clock: {
        wallNow: () => SYSTEM_CLOCK.wallNow() + 2 * OPERATION_JOURNAL_TTL_MS,
      },
    });
    assert(expired !== undefined);
    assertEquals(
      await readOperationJournal(root, journal.handle),
      { kind: "missing" },
    );
  });
});

Deno.test("a process the reader may not signal still counts as present", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    // Process 1 exists on every POSIX host and an ordinary user cannot
    // signal it: the probe's permission failure must read as present, and
    // only "no such process" as gone.
    const privileged = await openOperationJournal(root, {
      verb: "done",
      path: root,
    }, { pid: 1 });
    assert(privileged !== undefined);
    const reading = await readOperationJournal(root, privileged.handle);
    assert(reading.kind === "found");
    assertEquals(reading.executor, "running");
  });
});

Deno.test("a full store evicts finished waits first, then finished operations, and keeps a running one", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const at = (wall: number): { clock: { wallNow: () => number } } => ({
      clock: { wallNow: () => wall },
    });
    const capacity = { maxEntries: 4 };
    const open = (
      verb: string,
      wall: number,
      pid?: number,
    ): ReturnType<typeof openOperationJournal> =>
      openOperationJournal(root, { verb, path: root }, {
        ...at(wall),
        ...capacity,
        ...(pid === undefined ? {} : { pid }),
      });
    // The oldest record is an unfinished gate whose executor is gone; the
    // newest is a gate still running in this process.
    const deadGate = await open("done", 500, 4_000_001);
    const finishedGate = await open("done", 1_000);
    const finishedWait = await open("await", 2_000);
    const runningGate = await open("done", 3_000);
    assert(
      deadGate !== undefined && finishedGate !== undefined &&
        finishedWait !== undefined && runningGate !== undefined,
    );
    await finishedGate.finish("completed", envelope(true, "passed"));
    await finishedWait.finish("completed", envelope(true, "met"));
    const handles = {
      finishedGate: finishedGate.handle,
      finishedWait: finishedWait.handle,
      runningGate: runningGate.handle,
      deadGate: deadGate.handle,
    };
    const kinds = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const [name, handle] of Object.entries(handles)) {
        out[name] = (await readOperationJournal(root, handle)).kind;
      }
      return out;
    };
    // Capacity is 4: each further create evicts exactly one record, and the
    // finished wait leaves before older, more valuable records.
    assert(await open("done", 4_000) !== undefined);
    assertEquals(await kinds(), {
      finishedGate: "found",
      finishedWait: "missing",
      runningGate: "found",
      deadGate: "found",
    });
    assert(await open("done", 5_000) !== undefined);
    assertEquals(await kinds(), {
      finishedGate: "missing",
      finishedWait: "missing",
      runningGate: "found",
      deadGate: "found",
    });
    assert(await open("done", 6_000) !== undefined);
    assertEquals(await kinds(), {
      finishedGate: "missing",
      finishedWait: "missing",
      runningGate: "found",
      deadGate: "missing",
    });
  });
});

Deno.test("named timing boundaries stay separate facts under an injected clock", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    let wall = 10_000;
    const clock = { wallNow: (): number => wall };
    const journal = await openOperationJournal(root, {
      verb: "done",
      path: root,
    }, { clock });
    assert(journal !== undefined);
    // The producer reports its own elapsed time; nothing derives it from the
    // command's wall span or a budget.
    await journal.observe({
      kind: "progress",
      progress: {
        phase: "producer",
        state: "running",
        candidate_id: null,
        reason: "Running test: 1 of 2 partitions done.",
        work: {
          producer: "test",
          units: { kind: "partitions", completed: 1, total: 2 },
          elapsed_ms: 500,
        },
      },
    });
    // The environment return interval is its own recorded boundary.
    await journal.observe({
      kind: "event",
      event: {
        id: "return",
        effort_id: "effort",
        source_head: "head",
        candidate_id: null,
        attempt_id: "attempt",
        executor_operation: "operation",
        at: 11_450,
        fact: {
          kind: "timing",
          interval_id: "attempt",
          category: "validation",
          started_at: 11_400,
          finished_at: 11_450,
        },
      },
    });
    wall = 12_000;
    // The retained result keeps a producer budget verbatim — the seconds AND
    // the config key that set them — never inferred from observed elapsed time.
    await journal.finish("failed", {
      ok: false,
      verb: "done",
      error: "gate_failed",
      steps: [],
      diagnostics: [{
        tool: "test",
        severity: "error",
        message:
          "test FAILED (timed out after 2s; the [gate].timeout budget owns this deadline)",
        reproduce_cmd: "deno task test",
      }],
    });
    const reading = await readOperationJournal(root, journal.handle);
    assert(reading.kind === "found");
    // Command duration: the journal's own started/finished stamps.
    assertEquals(reading.record.operation.started_at, 10_000);
    assertEquals(reading.record.operation.finished_at, 12_000);
    // Producer elapsed: the producer's own report, unchanged.
    assertEquals(reading.record.producers?.test?.elapsed_ms, 500);
    // Environment return: the recorded interval, unchanged.
    assertEquals(reading.record.timings, [{
      category: "validation",
      interval_id: "attempt",
      started_at: 11_400,
      finished_at: 11_450,
    }]);
    // The budget diagnostic survives verbatim with its provenance key.
    const diagnostics = (reading.record.result as {
      diagnostics?: readonly { message: string }[];
    }).diagnostics;
    assertEquals(
      diagnostics?.[0]?.message.includes("[gate].timeout"),
      true,
    );
  });
});

Deno.test("an oversized final result keeps a bounded account and retains the complete envelope", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const oversized = {
      ...envelope(false, "Gate failed."),
      data: { noise: "x".repeat(400 * 1024) },
    };
    const result = await withOperationJournal(
      root,
      { verb: "done", path: root },
      () => Promise.resolve(oversized),
      { result: (value) => value },
    );
    assertEquals(result.ok, false);
    const reading = await readOperationJournal(root);
    assert(reading.kind === "found");
    assertEquals(reading.record.result_truncated, true);
    assertEquals(reading.record.outcome, "failed");
    const stored = reading.record.result as Record<string, unknown>;
    assertEquals(stored.ok, false);
    assertEquals(stored.verb, "done");
    assertEquals("data" in stored, false);
    // The complete envelope stays retrievable beside the record.
    assert(reading.record.result_path !== undefined);
    const complete = decodeWith(
      z.object({
        ok: z.literal(false),
        verb: z.literal("done"),
        data: z.object({ noise: z.string() }),
      }).passthrough(),
      await Deno.readTextFile(reading.record.result_path),
    );
    assertEquals<unknown>(complete, oversized);
    // The sibling shares its record's lifetime: expiring the record through a
    // later create removes both.
    const expired = await openOperationJournal(root, {
      verb: "done",
      path: root,
    }, {
      clock: {
        wallNow: () => SYSTEM_CLOCK.wallNow() + 2 * OPERATION_JOURNAL_TTL_MS,
      },
    });
    assert(expired !== undefined);
    assertEquals(
      await readOperationJournal(root, reading.handle),
      { kind: "missing" },
    );
    await assertRejects(
      () => Deno.stat(reading.record.result_path ?? ""),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("a cancelled run that returns an ordinary envelope records cancelled, not failed", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const abort = new AbortController();
    abort.abort();
    const cancelled = await withOperationJournal(
      root,
      { verb: "done", path: root },
      () => Promise.resolve(envelope(false, "Cancelled mid-producer.")),
      { signal: abort.signal, result: (value) => value },
    );
    assertEquals(cancelled.ok, false);
    const reading = await readOperationJournal(root);
    assert(reading.kind === "found");
    assertEquals(reading.record.outcome, "cancelled");
    // A run that finished green stays completed even under a late abort.
    const completed = await withOperationJournal(
      root,
      { verb: "done", path: root },
      () => Promise.resolve(envelope(true, "Gate passed.")),
      { signal: abort.signal, result: (value) => value },
    );
    assertEquals(completed.ok, true);
    const green = await readOperationJournal(root);
    assert(green.kind === "found");
    assertEquals(green.record.outcome, "completed");
  });
});

Deno.test("reading a stopped executor probes liveness without resuming it", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    // A process that stays alive without an elapsed wait, so the probe has
    // something to leave stopped.
    const child = new Deno.Command("tail", {
      args: ["-f", "/dev/null"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    try {
      Deno.kill(child.pid, "SIGSTOP");
      const journal = await openOperationJournal(root, {
        verb: "done",
        path: root,
      }, { pid: child.pid });
      assert(journal !== undefined);
      const reading = await readOperationJournal(root, journal.handle);
      assert(reading.kind === "found");
      // A stopped process is alive — and reading must leave it stopped.
      assertEquals(reading.executor, "running");
      const stat = await new Deno.Command("ps", {
        args: ["-o", "stat=", "-p", String(child.pid)],
      }).output();
      const state = new TextDecoder().decode(stat.stdout).trim();
      assert(state.includes("T"), `expected stopped state, saw '${state}'`);
    } finally {
      Deno.kill(child.pid, "SIGKILL");
      Deno.kill(child.pid, "SIGCONT");
      await child.status;
    }
  });
});

Deno.test("the default read selects the most recently started operation, not the latest write", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const older = await openOperationJournal(root, {
      verb: "done",
      path: root,
      branch: "agent/older",
    }, { clock: { wallNow: () => 1_000 } });
    assert(older !== undefined);
    const newer = await openOperationJournal(root, {
      verb: "test",
      path: root,
      branch: "agent/newer",
    }, { clock: { wallNow: () => 2_000 } });
    assert(newer !== undefined);
    // The older operation keeps reporting after the newer one started; its
    // fresher file cannot displace the newer operation.
    await older.observe({
      kind: "progress",
      progress: {
        phase: "producer",
        state: "running",
        candidate_id: null,
        reason: "Running test: 1 of 2 partitions done.",
        work: {
          producer: "test",
          units: { kind: "partitions", completed: 1, total: 2 },
        },
      },
    });
    const reading = await readOperationJournal(root);
    assert(reading.kind === "found");
    assertEquals(reading.handle, newer.handle);
    assertEquals(reading.record.operation.branch, "agent/newer");
  });
});

Deno.test("the default read stays inside the calling checkout and only names another checkout's operation", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (elsewhere) => {
      await repository(root);
      // The fleet shares one store: a sibling checkout's newer operation is
      // recorded beside this checkout's older one.
      const mine = await openOperationJournal(root, {
        verb: "done",
        path: root,
        branch: "agent/mine",
      }, { clock: { wallNow: () => 1_000 } });
      assert(mine !== undefined);
      const sibling = await openOperationJournal(root, {
        verb: "done",
        path: elsewhere,
        branch: "agent/sibling",
      }, { clock: { wallNow: () => 2_000 } });
      assert(sibling !== undefined);
      const reading = await readOperationJournal(root);
      assert(reading.kind === "found");
      assertEquals(reading.handle, mine.handle);
      // The checkout matches however its path is spelled.
      const canonical = await readOperationJournal(
        await Deno.realPath(root),
      );
      assert(canonical.kind === "found");
      assertEquals(canonical.handle, mine.handle);
      // A checkout with no operation of its own is told which handle exists
      // rather than handed the sibling's record.
      await Deno.remove(
        join(
          await Deno.realPath(root),
          ".git",
          "discern",
          "operations",
          `${mine.handle}.json`,
        ),
      );
      const named = await readOperationJournal(root);
      assert(named.kind === "elsewhere", JSON.stringify(named));
      assertEquals(named.newest.handle, sibling.handle);
      assertEquals(named.newest.branch, "agent/sibling");
    });
  });
});
