/** Unrelated progress cannot hide an unfinished wait, including future wait kinds. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  emitCompletionProgress,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
import { openOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import {
  progressWaitSentence,
  readWait,
  WAIT_NOTICE_INTERVAL_MS,
  withProgressWait,
} from "../src/engine/completion/progress_wait.ts";
import { renderMcpResult } from "../src/engine/mcp/server.ts";
import { withMcpCompletionProgress } from "../src/engine/mcp/progress.ts";
import {
  PROGRESS_WAIT_STATES,
  type ProgressWait,
} from "../src/shared/result_schemas.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./temp_dir.ts";
import { buildTestRunSlotAcquirer } from "../src/engine/test_run_slots.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { callingCheckoutRunningOperation } from "../src/engine/status/running_operation.ts";
import { completionStatusPresentation } from "../src/engine/status/completion_recovery.ts";

Deno.test("independent waits survive producer completion and close only their own lifecycle", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/readme`, "fixture\n");
    await gitInit(root);
    let now = 1000;
    const clock = { wallNow: () => now, monotonicNow: () => now };
    const record = await openOperationJournal(root, {
      verb: "done",
      path: root,
    }, { clock });
    assert(record !== undefined);
    const ready = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const releaseSecond = Promise.withResolvers<void>();
    const firstEnded = Promise.withResolvers<void>();
    const messages: string[] = [];
    const running = withMcpCompletionProgress(
      { progressToken: "wait-fixture" },
      (notification) => {
        messages.push(notification.params.message);
        return Promise.resolve();
      },
      () =>
        withCompletionObserver(async (fact) => {
          await record.observe(fact);
          if (fact.kind === "progress") ready.resolve();
          if (
            fact.kind === "wait" && fact.wait.kind === "remote-index" &&
            fact.wait.state === "resumed"
          ) firstEnded.resolve();
        }, async () => {
          await Promise.all([
            withProgressWait(async (wait) => {
              wait.update({
                kind: "remote-index",
                reason: "Index is waiting for capacity.",
                next: "Index starts automatically.",
                capacity: { in_use: 2, limit: 2 },
              });
              await releaseFirst.promise;
            }, { clock }),
            withProgressWait(async (wait) => {
              wait.update({
                kind: "catalog-observation",
                reason: "Waiting for the catalog revision.",
                next: "The watch checks automatically.",
              });
              emitCompletionProgress({
                phase: "producer",
                state: "finished",
                candidate_id: null,
                reason: "an unrelated check passed.",
                work: { producer: "unrelated", state: "passed" },
              });
              await releaseSecond.promise;
            }, { clock }),
          ]);
        }),
      () => now,
    );
    try {
      await ready.promise;
      now = 253000;
      const read = await operationProgressResult(root, { now: () => now });
      assertEquals(
        read.data?.waits?.filter((wait) => wait.state === "waiting").length,
        2,
      );
      const markdown = renderMcpResult(read).content[0]?.text ?? "";
      for (
        const text of [
          "Index is waiting",
          "2 of 2",
          "4 min 12 s",
          "catalog revision",
          "unrelated passed",
        ]
      ) {
        assertStringIncludes(markdown, text);
      }
      assertStringIncludes(read.message ?? "", "waiting");
      const status = await callingCheckoutRunningOperation(root);
      assert(status !== undefined);
      const presented = completionStatusPresentation(
        { data: {}, hints: [] },
        [],
        status,
      );
      const statusMarkdown = renderMcpResult({
        ok: true,
        verb: "status",
        steps: [],
        data: { operation: status },
        message: presented.message ?? "",
      }).content[0]?.text ?? "";
      for (const text of ["Index is waiting", "2 of 2", "catalog revision"]) {
        assertStringIncludes(status.latest ?? "", text);
        assertStringIncludes(statusMarkdown, text);
      }
      releaseFirst.resolve();
      await firstEnded.promise;
      assertStringIncludes(messages.at(-1) ?? "", "catalog revision");
      assertStringIncludes(messages.at(-1) ?? "", "4 min 12 s");
      const next = await operationProgressResult(root, { now: () => now });
      assertEquals(
        next.data?.waits?.filter((wait) => wait.state === "waiting").map((
          wait,
        ) => wait.kind),
        ["catalog-observation"],
      );
      assert(messages.some((message) => message.includes("2 of 2")));
      assert(messages.some((message) => message.includes("Waiting has ended")));
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await running;
    }
  });
});

Deno.test("wait scopes ration unchanged observations and preserve every terminal outcome", async () => {
  for (
    const state of PROGRESS_WAIT_STATES.filter((value) => value !== "waiting")
  ) {
    let now = 0;
    const seen: ProgressWait[] = [];
    await withCompletionObserver((fact) => {
      if (fact.kind === "wait") seen.push(fact.wait);
    }, () =>
      withProgressWait(async (wait) => {
        const details = {
          kind: "future-resource",
          reason: "Resource is busy.",
          next: "Work resumes automatically.",
        };
        wait.update(details);
        now = 1;
        wait.update(details);
        now = WAIT_NOTICE_INTERVAL_MS;
        wait.update(details);
        wait.end(state, "The wait ended.", "Read the result.");
        wait.end(
          "resumed",
          "Duplicate ending.",
          "Must not replace the outcome.",
        );
        wait.update(details);
        await Promise.resolve();
      }, { clock: { wallNow: () => now, monotonicNow: () => now } }));
    assertEquals(seen.map((wait) => wait.state), ["waiting", "waiting", state]);
    assertEquals(seen[1]?.elapsed_ms, WAIT_NOTICE_INTERVAL_MS);
  }
  const failures: ProgressWait[] = [];
  await assertRejects(
    () =>
      withCompletionObserver((fact) => {
        if (fact.kind === "wait") failures.push(fact.wait);
      }, () =>
        withProgressWait((wait) => {
          wait.update({
            kind: "future-failure",
            reason: "Resource is busy.",
            next: "Work resumes automatically.",
          });
          return Promise.reject(new Error("observed failure"));
        })),
    Error,
    "observed failure",
  );
  assertEquals(failures.at(-1)?.state, "failed");
  const quiet: ProgressWait[] = [];
  await withCompletionObserver((fact) => {
    if (fact.kind === "wait") quiet.push(fact.wait);
  }, () => withProgressWait(() => Promise.resolve()));
  assertEquals(quiet, []);
});

Deno.test("every wait outcome has readable evidence and interrupted observations never promise resumption", () => {
  for (const state of PROGRESS_WAIT_STATES) {
    const wait: ProgressWait = {
      id: "future-wait",
      kind: "future-kind",
      state,
      reason: "Observed condition.",
      next: "Exact next action.",
      started_at: 1000,
      updated_at: 2000,
      elapsed_ms: 1000,
    };
    assertStringIncludes(progressWaitSentence(wait), "Observed condition.");
    assertStringIncludes(progressWaitSentence(wait), "Exact next action.");
    assertEquals(readWait(wait, 8000, false).elapsed_ms, 1000);
    assertEquals(
      readWait(wait, 8000, true).elapsed_ms,
      state === "waiting" ? 7000 : 1000,
    );
    if (state === "waiting") {
      assertStringIncludes(
        progressWaitSentence(wait, false),
        "Automatic resumption is not confirmed",
      );
      assert(!progressWaitSentence(wait, false).includes("Exact next action"));
    }
  }
});

Deno.test("real shared capacity is visible while held and ends on admission or cancellation", async () => {
  for (const cancel of [false, true]) {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/discern.toml`,
        "[gate]\nconcurrent_test_runs = 2\n",
      );
      await gitInit(root);
      const cfg = await loadConfig(root);
      const acquirer = buildTestRunSlotAcquirer(root, cfg);
      assert(acquirer !== undefined);
      const holds = [
        await acquirer.acquire(() => {}),
        await acquirer.acquire(() => {}),
      ];
      assert(holds.every((hold) => hold !== undefined));
      const record = await openOperationJournal(root, {
        verb: "test",
        path: root,
      });
      assert(record !== undefined);
      const abort = new AbortController();
      const pending = withCompletionObserver(
        (fact) => record.observe(fact),
        () =>
          acquirer.acquire(
            (event) => {
              if (event.kind === "queued") {
                emitCompletionProgress({
                  phase: "producer",
                  state: "finished",
                  candidate_id: null,
                  reason: "lint passed.",
                  work: { producer: "lint", state: "passed" },
                });
              }
            },
            abort.signal,
            "tests",
          ),
      );
      try {
        await waitForPendingCondition(
          pending,
          async () =>
            (await operationProgressResult(root)).data?.producers?.some((
              work,
            ) => work.producer === "lint") === true,
          "the independent check to finish while both slots are held",
        );
        const read = await operationProgressResult(root);
        assertEquals(read.data?.waits?.[0]?.capacity, { in_use: 2, limit: 2 });
        assertStringIncludes(
          renderMcpResult(read).content[0]?.text ?? "",
          "2 of 2 concurrent runs",
        );
        if (cancel) abort.abort();
        else holds[0]?.release();
        const acquired = await pending;
        assertEquals(acquired === undefined, cancel);
        acquired?.release();
        const ended = await operationProgressResult(root);
        assertEquals(
          ended.data?.waits?.[0]?.state,
          cancel ? "cancelled" : "resumed",
        );
      } finally {
        abort.abort();
        for (const hold of holds) hold?.release();
        (await pending)?.release();
      }
    });
  }
});
