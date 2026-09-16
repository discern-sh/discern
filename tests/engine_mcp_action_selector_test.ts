/** The MCP `action` input selects an operation; it is never a flag beside it. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ACTION_SELECTED_OPERATIONS,
  runTool,
  TOOLS,
  verbOf,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";
import { readMcpVerbEvents } from "./engine_mcp_accept_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** The declared values of one tool's `action` selector input. */
function actionValues(tool: (typeof TOOLS)[number]): readonly string[] {
  const input = (tool.inputSchema as Record<string, unknown>).action;
  const options = (input as { options?: readonly string[] } | undefined)
    ?.options;
  return options ?? [];
}

Deno.test("an action that selects the operation is never recorded as a flag", async () => {
  // Driven off ACTION_SELECTED_OPERATIONS, so a tool that gains an action
  // selector auto-enrols. Its `action` chose the operation already; recording
  // it again as a flag would double-count it against the flag it is not.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const expected = new Map<string, string>();
    for (const [name, selected] of ACTION_SELECTED_OPERATIONS) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      assert(tool !== undefined, `${name} is not registered`);
      const values = actionValues(tool);
      assert(values.length > 0, `${name} declares no action selector`);
      for (const action of values) {
        expected.set(action, selected.get(action) ?? verbOf(name));
        // No further arguments: a selected action that refuses its own
        // arguments still records the operation its selector named.
        await runTool(
          tool,
          new WorkingRoot(dir),
          { action, dry_run: true },
          undefined,
          () => Promise.resolve(undefined),
          undefined,
          "unknown-client",
          TEST_CLI_MODEL,
        );
      }
    }
    const events = await readMcpVerbEvents(dir);
    assertEquals(events.length, expected.size);
    for (const event of events) {
      assertEquals(
        event.flags?.includes("action") ?? false,
        false,
        `${event.verb} recorded its action selector as a flag`,
      );
    }
    assertEquals(
      [...new Set(events.map((event) => event.verb))].sort(),
      [...new Set(expected.values())].sort(),
    );
  });
});

Deno.test("a selected action refuses a requested conflict, never an inert default", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const standards = TOOLS.find((tool) => tool.name === "discern_standards");
    assert(standards !== undefined);
    const propose = async (
      args: Record<string, unknown>,
    ): Promise<{ error?: string; message?: string }> =>
      (await runTool(
        standards,
        new WorkingRoot(dir),
        { action: "propose", dry_run: true, ...args },
        undefined,
        () => Promise.resolve(undefined),
        undefined,
        "unknown-client",
        TEST_CLI_MODEL,
      )).structuredContent as { error?: string; message?: string };

    // A client that sends its defaults has requested nothing. Refusing those
    // costs a schema retry for arguments that would change no behaviour.
    for (
      const inert of [
        { force: false },
        { pin: false },
        { names: [] },
        { force: false, pin: false, names: [] },
      ]
    ) {
      const result = await propose(inert);
      assert(
        !(result.message ?? "").includes("does not accept"),
        `${JSON.stringify(inert)} was refused as a conflict: ${result.message}`,
      );
    }
    for (
      const requested of [{ force: true }, { pin: true }, { names: ["a"] }]
    ) {
      const result = await propose(requested);
      assertEquals(
        result.error,
        "invalid_arguments",
        JSON.stringify(requested),
      );
      assertStringIncludes(result.message ?? "", "does not accept");
    }
  });
});
