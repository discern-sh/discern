/** An MCP await call is a journalled operation a lost observer can read back. */
import { assert, assertEquals } from "@std/assert";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";

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
  });
});
