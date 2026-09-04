/**
 * Recovery when a trusted project root vanishes. A long-lived MCP server holds
 * its working root between calls, and the worktree that root names can be
 * removed out from under it — a sibling session lands the effort, or the
 * directory is dropped by hand. Every verb entry point must turn that state
 * into a refusal that names the vanished path and the next action; the raw
 * filesystem error escaping as an internal crash is the defect class guarded
 * here. The MCP guard is driven off the TOOLS registry so a new tool enrols
 * automatically, and the config chokepoints (`loadConfig`, `RawConfig.load`)
 * are held to a typed error every surface's crash boundary recognizes.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  runTool,
  TOOLS,
  verbOf,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import { ConfigMissingError, loadConfig } from "../src/shared/config_schema.ts";
import { RawConfig } from "../src/shared/config_read.ts";
import { configFailureResult } from "../src/shared/config_failure.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";

const sameVersion = (): Promise<string | undefined> =>
  Promise.resolve(DISCERN_VERSION);

/** The discern_status tool — the representative registry member. */
function statusTool(): (typeof TOOLS)[number] {
  const status = TOOLS.find((tool) => tool.name === "discern_status");
  assert(status !== undefined, "discern_status must exist");
  return status;
}

/** A scaffolded home checkout, a WorkingRoot re-aimed at a worktree path that
 * no longer exists, and that vanished path — the state every guard case
 * starts from. */
async function withVanishedHeldRoot(
  fn: (state: {
    home: string;
    gone: string;
    working: WorkingRoot;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir(async (dir) => {
    const home = join(dir, "main");
    await Deno.mkdir(home);
    await scaffoldEngine(home, { bootstrapped: true });
    await gitInit(home);
    const gone = join(dir, "efforts", "landed-worktree");
    const working = new WorkingRoot(home);
    working.set(gone);
    await fn({ home, gone, working });
  });
}

Deno.test("a vanished held root refuses with recovery and re-aims at the spawn root", async () => {
  await withVanishedHeldRoot(async ({ home, gone, working }) => {
    const status = statusTool();
    const refusal = await runTool(status, working, {}, undefined, sameVersion);
    assertEquals(refusal.isError, true);
    assertEquals(refusal.structuredContent.error, "not_initialized");
    const message = refusal.structuredContent.message as string;
    assertStringIncludes(message, gone);
    assertStringIncludes(message, home);
    assertStringIncludes(message, "`path`");

    // The server's state is repaired, not just reported: the next plain call
    // runs against the checkout the server started in.
    assertEquals(working.get(), home);
    const recovered = await runTool(
      status,
      working,
      {},
      undefined,
      sameVersion,
    );
    assertEquals(recovered.isError, false, JSON.stringify(recovered));
  });
});

Deno.test("every MCP tool refuses a vanished held root before its verb runs", async () => {
  await withVanishedHeldRoot(async ({ home, gone }) => {
    for (const tool of TOOLS) {
      const working = new WorkingRoot(home);
      working.set(gone);
      const result = await runTool(tool, working, {}, undefined, sameVersion);
      assert(
        result.structuredContent.error !== "internal_error",
        `${tool.name} crashed on a vanished held root:\n${
          JSON.stringify(result.structuredContent)
        }`,
      );
      if (tool.rootIndependent === true) {
        // A root-independent answer never depended on the vanished root; it is
        // served from the recovered home instead of being refused.
        assertEquals(result.isError, false, JSON.stringify(result));
      } else {
        assertEquals(result.isError, true, `${tool.name} must refuse`);
        assertEquals(result.structuredContent.error, "not_initialized");
        assertStringIncludes(result.structuredContent.message as string, gone);
      }
      assertEquals(working.get(), home, `${tool.name} must repair the root`);
    }
  });
});

Deno.test("a future tool inherits the vanished-root refusal without enrolment", async () => {
  // Fresh-name sibling: a tool the guard has never heard of must be refused
  // before its verb runs — the protection reads the registry-shared dispatch
  // path, not a name list.
  await withVanishedHeldRoot(async ({ home, working }) => {
    const probe = {
      name: "discern_zzz_probe",
      description: "synthetic future tool for the vanished-root guard",
      inputSchema: {},
      outputSchema: statusTool().outputSchema,
      run: (): Promise<DiscernResult> => {
        throw new Error(
          "the vanished-root guard must refuse before any verb runs",
        );
      },
    };
    const result = await runTool(probe, working, {}, undefined, sameVersion);
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent.error, "not_initialized");
    assertEquals(result.structuredContent.verb, verbOf(probe.name));
    assertEquals(working.get(), home);
  });
});

Deno.test("a vanished spawn root refuses with the path recovery and moves nothing", async () => {
  await withTempDir(async (dir) => {
    const gone = join(dir, "removed-checkout");
    const working = new WorkingRoot(gone);
    const result = await runTool(
      statusTool(),
      working,
      {},
      undefined,
      sameVersion,
    );
    assertEquals(result.isError, true);
    assertEquals(result.structuredContent.error, "not_initialized");
    const message = result.structuredContent.message as string;
    assertStringIncludes(message, gone);
    assertStringIncludes(message, "`path`");
    assertEquals(working.get(), gone, "nowhere valid to re-aim");
  });
});

Deno.test("the config chokepoints turn a missing file into the typed refusal", async () => {
  await withTempDir(async (dir) => {
    const gone = join(dir, "removed-checkout");
    for (
      const load of [
        (): Promise<unknown> => loadConfig(gone),
        (): Promise<unknown> => RawConfig.load(gone),
      ]
    ) {
      let thrown: unknown;
      try {
        await load();
      } catch (err) {
        thrown = err;
      }
      assert(
        thrown instanceof ConfigMissingError,
        `expected ConfigMissingError, got ${String(thrown)}`,
      );
      assertStringIncludes(thrown.message, gone);

      // The shared boundary both surfaces' crash handlers consult must map it
      // to a refusal, so it can never be classified as a crash again.
      const mapped = configFailureResult("patterns", thrown);
      assert(mapped !== undefined, "the boundary must recognize the error");
      assertEquals(mapped.ok, false);
      assertEquals(mapped.error, "not_initialized");
      assertStringIncludes(mapped.message ?? "", gone);
    }
  });
});
