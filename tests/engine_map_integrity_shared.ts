/**
 * Shared fixtures for the map-integrity gate suites, split across sibling
 * files so `deno test --parallel` (per-FILE distribution) can spread their
 * serial `done` runs; a non-test module, because importing one _test.ts from
 * another would re-register its tests under the importer's runner.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { defaultMapPath, runAgent } from "./engine_helpers.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

export type GateJson = CliResultForCommand<"done">;
export type GateJsonDiagnostic = NonNullable<GateJson["diagnostics"]>[number];

/** Decode a done envelope for shared map-integrity failure assertions. */
export function parseJson(stdout: string): GateJson {
  return decodeCliResult(stdout, "done");
}

/** Select the diagnostic emitted by one map-integrity subtool from a gate envelope. */
export function diagFor(
  obj: GateJson,
  tool: string,
): GateJsonDiagnostic | undefined {
  return (obj.diagnostics ?? []).find((diagnostic) => diagnostic.tool === tool);
}

/** Write one map page (creating the configured default map dir), returning
 * its absolute path. The engine scaffold seeds no map — a docs-less project is
 * legitimately green — so each case lays exactly the corpus it needs. */
export async function writeMapPage(
  dir: string,
  rel: string,
  content: string,
): Promise<string> {
  const path = defaultMapPath(dir, rel);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
  return path;
}

/** Run `done --json`, assert the map-integrity preflight blocked, and return
 * the diagnostic's captured output for content asserts. */
export async function expectMapIntegrityFailure(dir: string): Promise<string> {
  const r = await runAgent(dir, ["done", "--json"]);
  assertEquals(r.code, 1, r.output);
  const obj = parseJson(r.stdout);
  assertEquals(obj.ok, false);
  assertResultDataKey(obj, "failed_stage");
  assertEquals(obj.data.failed_stage, "map_integrity");
  const diag = diagFor(obj, "map-integrity");
  assert(
    diag !== undefined,
    `expected a map-integrity diagnostic: ${r.stdout}`,
  );
  assertStringIncludes(diag.message, "integrity");
  assert(diag.output !== undefined, "diagnostic must carry captured output");
  return diag.output;
}
