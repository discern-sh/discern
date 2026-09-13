/** Reconnect reads present the same operation an observer lost, and only read. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  emitCompletionFailure,
  emitCompletionProgress,
} from "../src/engine/completion/events.ts";
import {
  openOperationJournal,
  withOperationJournal,
} from "../src/engine/completion/operation_journal.ts";
import {
  operationProgressResult,
  runProgress,
} from "../src/engine/completion/progress_result.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";

/** A minimal committed repository so the common admin directory resolves. */
async function repository(root: string): Promise<void> {
  await Deno.writeTextFile(join(root, "readme"), "progress fixture\n");
  await gitInit(root);
}

Deno.test("a finished operation reconnects to its retained result and failures", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const envelope: DiscernResult = {
      ok: true,
      verb: "done",
      steps: [],
      message: "Gate passed for `agent/sample`.",
    };
    await withOperationJournal(
      root,
      { verb: "done", path: root, branch: "agent/sample" },
      () => {
        emitCompletionProgress({
          phase: "producer",
          state: "running",
          candidate_id: "candidate",
          reason: "Running test: 8 of 8 partitions done, 1 failure so far.",
          work: {
            producer: "test",
            units: { kind: "partitions", completed: 8, total: 8 },
            results: { passed: 100, failed: 1, skipped: 0 },
          },
        });
        emitCompletionFailure({
          producer: "test",
          name: "alpha holds",
          message: "expected 2, got 3",
          file: "tests/red_test.ts",
          line: 7,
          reproduce_cmd:
            "deno task test tests/red_test.ts --filter 'alpha holds' --shuffle=7",
          partial: false,
        });
        return Promise.resolve(envelope);
      },
      { result: (value) => value },
    );
    const read = await operationProgressResult(root);
    assert(read.ok, JSON.stringify(read));
    assertStringIncludes(read.message ?? "", "`done` on agent/sample finished");
    assertStringIncludes(read.message ?? "", "Gate passed for `agent/sample`.");
    assertEquals(read.data?.outcome, "completed");
    assertEquals(read.data?.executor, "gone");
    assertEquals(
      read.data?.failures?.[0]?.reproduce_cmd?.includes("--filter"),
      true,
    );
    assertEquals(read.data?.producers?.[0]?.units?.completed, 8);
    assertEquals(
      (read.data?.result as { message?: string }).message,
      envelope.message,
    );
    const byHandle = await operationProgressResult(root, {
      handle: read.data?.handle ?? "",
      now: () => read.data?.observed_at ?? 0,
    });
    assert(byHandle.ok);
    assertEquals(byHandle.data, read.data);
  });
});

Deno.test("an interrupted operation reports its executor gone, not a verdict", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const journal = await openOperationJournal(root, {
      verb: "done",
      path: root,
      branch: "agent/killed",
    }, { pid: 4_000_001 });
    assert(journal !== undefined);
    await journal.observe({
      kind: "progress",
      progress: {
        phase: "producer",
        state: "running",
        candidate_id: null,
        reason: "Running test: 3 of 8 partitions done, no failures so far.",
        work: {
          producer: "test",
          units: { kind: "partitions", completed: 3, total: 8 },
          results: { failed: 0 },
        },
      },
    });
    const read = await operationProgressResult(root, {
      handle: journal.handle,
    });
    assert(read.ok);
    assertEquals(read.data?.outcome, undefined);
    assertEquals(read.data?.executor, "gone");
    assertStringIncludes(
      read.message ?? "",
      "stopped without finishing and its recording process is gone",
    );
    assertStringIncludes(read.message ?? "", "Run the command again");
  });
});

Deno.test("a store that exists but cannot be used is reported as such, not as a missing repository", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    // A regular file where the store directory belongs breaks the store on
    // any host, as a permission problem would; the refusal must name that
    // condition instead of claiming there is no repository here.
    const store = join(await Deno.realPath(root), ".git", "discern");
    await Deno.mkdir(store, { recursive: true });
    await Deno.writeTextFile(join(store, "operations"), "not a directory\n");
    const read = await operationProgressResult(root);
    assert(!read.ok);
    assertEquals(read.error, "read_error");
    assertStringIncludes(read.message ?? "", "could not be used");
    assertStringIncludes(
      read.message ?? "",
      "The operation itself is unaffected",
    );
  });
});

Deno.test("reconnect refusals name the exact condition without touching anything", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const none = await operationProgressResult(root);
    assertEquals(none.ok, false);
    assert(!none.ok);
    assertEquals(none.error, "not_found");
    const invalid = await operationProgressResult(root, {
      handle: "R1-XXXX-XXXX-99",
    });
    assert(!invalid.ok);
    assertEquals(invalid.error, "invalid_arguments");
    const journal = await openOperationJournal(root, {
      verb: "test",
      path: root,
    });
    assert(journal !== undefined);
    let other = journal.handle;
    while (other === journal.handle) {
      const next = await openOperationJournal(root, {
        verb: "test",
        path: root,
      });
      assert(next !== undefined);
      other = next.handle;
      break;
    }
    const running = await operationProgressResult(root, {
      handle: journal.handle,
    });
    assert(running.ok);
    assertEquals(running.data?.executor, "running");
    assertStringIncludes(
      running.message ?? "",
      "no current check or active wait",
    );
    assertStringIncludes(
      running.message ?? "",
      "does not establish advancing work",
    );
    // Another checkout of the same repository has no operation of its own:
    // the refusal names the handle to ask for instead of substituting it.
    await withTempDir(async (sibling) => {
      const elsewhere = await openOperationJournal(root, {
        verb: "done",
        path: sibling,
        branch: "agent/sibling",
      });
      assert(elsewhere !== undefined);
      await Deno.remove(
        join(
          await Deno.realPath(root),
          ".git",
          "discern",
          "operations",
          `${journal.handle}.json`,
        ),
      );
      await Deno.remove(
        join(
          await Deno.realPath(root),
          ".git",
          "discern",
          "operations",
          `${other}.json`,
        ),
      );
      const named = await operationProgressResult(root);
      assert(!named.ok);
      assertEquals(named.error, "not_found");
      assertStringIncludes(
        named.message ?? "",
        `\`done\` on agent/sibling, progress handle ${elsewhere.handle}`,
      );
    });
  });
});

Deno.test("a finished operation's retained diagnostics read back as bounded sentences", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const diagnostics = ["lint", "typecheck", "test", "prose", "canary"].map(
      (tool, index) => ({
        tool,
        severity: "error" as const,
        message: `${tool} failed\n  at step ${index}`,
        reproduce_cmd: `deno task ${tool}`,
      }),
    );
    const envelope: DiscernResult = {
      ok: false,
      verb: "done",
      error: "gate_failed",
      steps: [],
      message: "Gate failed.",
      diagnostics,
    };
    await withOperationJournal(
      root,
      { verb: "done", path: root, branch: "agent/diagnosed" },
      () => Promise.resolve(envelope),
      { result: (value) => value },
    );
    const read = await operationProgressResult(root);
    assert(read.ok, JSON.stringify(read));
    assertStringIncludes(read.message ?? "", "finished with a failing result");
    // Three diagnostics read back as one-line sentences, in order, and the
    // rest are counted rather than dropped.
    assertEquals(read.data?.account.slice(-4), [
      "lint: lint failed at step 0.",
      "typecheck: typecheck failed at step 1.",
      "test: test failed at step 2.",
      "2 more diagnostics are in the retained result.",
    ]);
  });
});

Deno.test("an oversized retained result reads back with the path of its complete envelope", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    const oversized: DiscernResult = {
      ok: true,
      verb: "done",
      steps: [],
      message: "Gate passed.",
      data: { noise: "x".repeat(400 * 1024) },
    };
    await withOperationJournal(
      root,
      { verb: "done", path: root, branch: "agent/large" },
      () => Promise.resolve(oversized),
      { result: (value) => value },
    );
    const read = await operationProgressResult(root);
    assert(read.ok, JSON.stringify(read));
    assertEquals(read.data?.result_truncated, true);
    assert(read.data?.result_path !== undefined);
    assertStringIncludes(
      read.message ?? "",
      `the complete envelope is retained at ${read.data.result_path}`,
    );
  });
});

Deno.test("reading outside any repository is refused as such", async () => {
  await withTempDir(async (root) => {
    const read = await operationProgressResult(root);
    assert(!read.ok);
    assertEquals(read.error, "no_repository");
    assertStringIncludes(read.message ?? "", "No repository is reachable");
  });
});

Deno.test("the human progress entrypoint prints the reading's sentences and a refusal's hint", async () => {
  await withTempDir(async (root) => {
    await repository(root);
    await withOperationJournal(
      root,
      { verb: "done", path: root, branch: "agent/human" },
      () => {
        emitCompletionProgress({
          phase: "producer",
          state: "running",
          candidate_id: null,
          reason: "Running test: 4 of 4 suites done, no failures so far.",
          work: {
            producer: "test",
            units: { kind: "suites", completed: 4, total: 4 },
            results: { failed: 0 },
          },
        });
        return Promise.resolve(
          { ok: true, verb: "done", steps: [] } satisfies DiscernResult,
        );
      },
      { result: (value) => value },
    );
    const lines: string[] = [];
    const sink = (text: string): void => {
      lines.push(text);
    };
    assertEquals(
      await runProgress(root, { json: false, stdout: sink, stderr: sink }),
      0,
    );
    const printed = lines.join("");
    assertStringIncludes(
      printed,
      "`done` on agent/human finished and succeeded",
    );
    assertStringIncludes(
      printed,
      "Recorded progress for test: 4 of 4 suites done, no failures.",
    );
    lines.length = 0;
    assertEquals(
      await runProgress(root, {
        json: false,
        handle: "R1-XXXX-XXXX-99",
        stdout: sink,
        stderr: sink,
      }),
      1,
    );
    const refused = lines.join("");
    assertStringIncludes(refused, "its checksum does not hold");
    assertStringIncludes(refused, "Pass the handle the operation announced");
  });
});
