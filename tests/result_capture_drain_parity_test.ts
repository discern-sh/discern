/**
 * The observed-state drain parity guard. `src/shared/result_capture.ts` holds
 * process-local one-slot mailboxes (the envelope, supplemental hints, tips,
 * and the verb target). Both surface chokepoints — the CLI
 * interceptor and the MCP completion boundary — must drain EVERY mailbox at
 * invocation completion: the CLI to keep embedded-call state out of its own
 * event, the long-lived MCP server so state can never leak from one tool call
 * into the next.
 *
 * The guard derives the mailbox set from the module's own exports (every
 * `take*` function), so a new mailbox auto-enrols: add one and this test
 * fails until both chokepoints drain it — deliberately, when the new state is
 * surface-specific, with a defensive drain on the other surface.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import * as resultCapture from "../src/shared/result_capture.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

/** The surface chokepoints that must drain every mailbox. */
const DRAIN_SITES = [
  "src/engine/logbook/cli.ts",
  "src/engine/mcp/server.ts",
] as const;

Deno.test("every result_capture mailbox is drained by both surface chokepoints", async () => {
  const drains = Object.keys(resultCapture).filter(
    (name) =>
      name.startsWith("take") &&
      typeof (resultCapture as Record<string, unknown>)[name] === "function",
  );
  assert(drains.length > 0, "expected take* drains in result_capture.ts");

  for (const site of DRAIN_SITES) {
    const source = await Deno.readTextFile(join(ROOT, site));
    for (const drain of drains) {
      assert(
        source.includes(`${drain}(`),
        `${site} never drains ${drain}() — a mailbox left full there either ` +
          `mislabels that surface's own events or leaks into the next tool ` +
          `call on the long-lived MCP server. Drain it at the completion ` +
          `chokepoint (defensively, if the state is surface-specific).`,
      );
    }
  }
});
