/** An MCP await call is a journalled operation a lost observer can read back. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import {
  renderMcpResult,
  runTool,
  TOOLS,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import { AWAIT_CONDITIONS } from "../src/shared/result_schemas.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { withMcpCompletionProgress } from "../src/engine/mcp/progress.ts";
import {
  type OperationJournalRecord,
  readOperationJournal,
} from "../src/engine/completion/operation_journal.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";

Deno.test("an MCP await call journals under its own verb and reads back after it returns", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const tool = TOOLS.find((candidate) => candidate.name === "discern_await");
    assert(tool !== undefined);
    // A bounded wait that checks once: the transport most likely to lose its
    // observer records the same operation every other verb does.
    const result = await runTool(
      tool,
      new WorkingRoot(dir),
      { trunk_moved: true, timeout: 0 },
      new AbortController().signal,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
    );
    assertEquals(result.isError, false, JSON.stringify(result));
    const read = await operationProgressResult(dir);
    assert(read.ok, JSON.stringify(read));
    assertEquals(read.data?.operation.verb, "await");
    assertEquals(read.data?.outcome, "completed");
    assertEquals(read.data?.executor, "gone");
    // The retained envelope is the wait's own result, so nothing re-runs to
    // learn what the lost call would have returned.
    const stored = read.data?.result as { verb?: string; ok?: boolean };
    assertEquals(stored.verb, "await");
    assertEquals(stored.ok, true);
    assertStringIncludes(read.message ?? "", "condition is still unmet");
    assert(!(read.message ?? "").includes("succeeded"));
  });
});

Deno.test("every await condition exposes its active watch and retains cancellation for recovery", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root);
    await gitInit(root);
    for (const condition of AWAIT_CONDITIONS) {
      const tool = TOOLS.find((candidate) =>
        candidate.name === "discern_await"
      );
      assert(tool !== undefined);
      const abort = new AbortController();
      const messages: string[] = [];
      const operation = withMcpCompletionProgress({
        progressToken: "active-watch",
      }, (notification) => {
        messages.push(notification.params.message);
        return Promise.resolve();
      }, () =>
        runTool(tool, new WorkingRoot(root), {
          ...(condition === "trunk-moved"
            ? { trunk_moved: true }
            : { [condition]: "main" }),
          timeout: 60,
        }, abort.signal));
      let resume: string | undefined;
      let activeRecord: OperationJournalRecord | undefined;
      try {
        await waitForPendingCondition(
          operation,
          async () => {
            const data = (await operationProgressResult(root)).data;
            return data?.executor === "running" &&
              data.waits?.some((wait) =>
                  wait.state === "waiting" &&
                  wait.condition?.condition === condition
                ) === true;
          },
          `the active ${condition} watch to be recorded`,
        );
        const read = await operationProgressResult(root);
        const wait = read.data?.waits?.find((wait) => wait.state === "waiting");
        assertEquals(wait?.condition?.condition, condition);
        assertEquals(wait?.condition?.trunk, "main");
        assert(wait?.condition?.resume?.startsWith("C1-"));
        resume = wait?.condition?.resume;
        const recording = await readOperationJournal(root);
        assert(recording.kind === "found");
        activeRecord = recording.record;
        const markdown = renderMcpResult(read).content[0]?.text ?? "";
        assertStringIncludes(markdown, "main");
        assertStringIncludes(markdown, "checks automatically");
        assertStringIncludes(markdown, "Waiting so far");
        assert(messages.some((message) => message.includes("Waiting so far")));
      } finally {
        abort.abort();
        await operation;
      }
      const stopped = await operationProgressResult(root);
      assertEquals(stopped.data?.outcome, "cancelled");
      const retained = stopped.data?.result as {
        data?: { resume?: string };
        message?: string;
        hints?: string[];
      };
      assertEquals(retained.data?.resume, resume);
      assertStringIncludes(
        retained.message ?? "",
        "will not resume automatically",
      );
      assertEquals(retained.hints?.length ?? 0, 0);
      assertEquals(
        stopped.data?.waits?.some((wait) => wait.state === "waiting"),
        false,
      );
      // Reuse the real active snapshot and saved continuation to model a lost
      // executor. The completed writer has stopped before this fixture changes.
      assert(activeRecord !== undefined && stopped.data !== undefined);
      await Deno.writeTextFile(
        stopped.data.record_path,
        JSON.stringify({
          ...activeRecord,
          operation: { ...activeRecord.operation, pid: 4_000_001 },
        }),
      );
      const interrupted = await operationProgressResult(root, {
        now: () => activeRecord.operation.started_at + 600_000,
      });
      assertEquals(interrupted.data?.executor, "gone");
      assertStringIncludes(
        interrupted.message ?? "",
        `discern await --resume ${resume}`,
      );
      assertStringIncludes(
        renderMcpResult(interrupted).content[0]?.text ?? "",
        "Automatic resumption is not confirmed",
      );
      assertEquals(
        interrupted.data?.waits?.[0]?.elapsed_ms,
        Object.values(activeRecord.waits ?? {})[0]?.elapsed_ms,
      );
    }
    const human = await runAgent(root, [
      "await",
      "--trunk-moved",
      "--timeout",
      "0",
    ]);
    assertTerminalTextIncludes(human.stdout, "Waiting so far");
    assertTerminalTextIncludes(
      human.stdout,
      "The observation window ended; the condition is still unmet.",
    );
    assert(
      human.stdout.indexOf("Waiting so far") <
        human.stdout.indexOf("The observation window ended"),
    );
  });
});
