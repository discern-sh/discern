import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildConventionsManifest } from "../scripts/contract_manifests.ts";
import { buildCli } from "../src/main.ts";
import { CRASH_EXIT_CODE } from "../src/engine/crash.ts";
import { AWAIT_TIMEOUT_EXIT_CODE } from "../src/engine/await/defaults.ts";
import { SIGNAL_EXIT_CODES } from "../src/engine/process_signals.ts";
import {
  EXIT_AWAIT_TIMEOUT,
  EXIT_INTERNAL_ERROR,
  EXIT_SIGHUP,
  EXIT_SIGINT,
  EXIT_SIGTERM,
  EXIT_STATUS_REGISTRY,
  EXIT_STATUS_TABLE_BEGIN,
  EXIT_STATUS_TABLE_END,
  renderExitStatusTable,
  replaceExitStatusTable,
} from "../src/shared/exit_codes.ts";
import { renderManualCliReferenceDoc } from "../src/shared/cli_reference_codegen.ts";

Deno.test("exit-status registry is closed, unique, and owns runtime special statuses", () => {
  assertEquals(
    EXIT_STATUS_REGISTRY.filter((entry) => entry.kind === "exact").map((
      entry,
    ) => entry.code),
    [0, 1, 2, 70, 124, 127, 129, 130, 143],
  );
  assertEquals(
    new Set(EXIT_STATUS_REGISTRY.map((entry) => entry.id)).size,
    EXIT_STATUS_REGISTRY.length,
  );
  assertEquals(CRASH_EXIT_CODE, EXIT_INTERNAL_ERROR);
  assertEquals(AWAIT_TIMEOUT_EXIT_CODE, EXIT_AWAIT_TIMEOUT);
  assertEquals(SIGNAL_EXIT_CODES.SIGHUP, EXIT_SIGHUP);
  assertEquals(SIGNAL_EXIT_CODES.SIGINT, EXIT_SIGINT);
  assertEquals(SIGNAL_EXIT_CODES.SIGTERM, EXIT_SIGTERM);
});

Deno.test("both exit-status manual projections derive from the registry", async () => {
  const table = renderExitStatusTable();
  assertStringIncludes(renderManualCliReferenceDoc(buildCli(false)), table);

  const path = "project/manual/30-reference/mcp-and-results.md";
  const manual = await Deno.readTextFile(path);
  const regenerated = replaceExitStatusTable(manual);
  const start = regenerated.indexOf(EXIT_STATUS_TABLE_BEGIN);
  const end = regenerated.indexOf(EXIT_STATUS_TABLE_END);
  assertStringIncludes(regenerated.slice(start, end), table);
});

Deno.test("the conventions manifest derives every exit status from the registry", () => {
  assertEquals(
    buildConventionsManifest().exit_statuses,
    Object.fromEntries(
      EXIT_STATUS_REGISTRY.map((entry) => [
        entry.id,
        entry.kind === "exact" ? entry.code : entry.kind,
      ]),
    ),
  );
});
