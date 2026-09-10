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
import type { DiscernResult } from "../src/shared/result.ts";
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
          environment_id: "environment",
          attempt_id: "attempt",
          executor_operation: "operation",
          at: 9,
          fact: {
            kind: "timing",
            interval_id: "attempt",
            category: "return",
            started_at: 4,
            finished_at: 9,
          },
        });
        return Promise.resolve(envelope(true, "Gate passed."));
      },
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
      category: "return",
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
        phase: "queue",
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
          () => Promise.reject(new Error("validation cancelled")),
          { signal: abort.signal },
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
          () => Promise.reject(new Error("exploded")),
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
      clock: { wallNow: () => Date.now() + 2 * OPERATION_JOURNAL_TTL_MS },
    });
    assert(expired !== undefined);
    assertEquals(
      await readOperationJournal(root, journal.handle),
      { kind: "missing" },
    );
  });
});

Deno.test("an oversized final result keeps a bounded account and says so", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const result = await withOperationJournal(
      root,
      { verb: "done", path: root },
      () =>
        Promise.resolve({
          ...envelope(false, "Gate failed."),
          data: { noise: "x".repeat(400 * 1024) },
        }),
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
  });
});
