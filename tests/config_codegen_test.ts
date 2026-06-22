import { assert, assertEquals } from "@std/assert";
import { renderConfigDocSchemaJson } from "../src/shared/config_codegen.ts";

// These prove the committed, shipped artifacts stay in lockstep with the canonical
// Zod schema (ADR 0026): a schema change that isn't regenerated (`deno task
// codegen`) fails here, in the gate's test stage — the drift guard.

Deno.test("schema/discern-config.schema.json matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../schema/discern-config.schema.json", import.meta.url),
  );
  assertEquals(
    committed,
    renderConfigDocSchemaJson(),
    "schema/discern-config.schema.json is stale — run `deno task codegen`",
  );
});

Deno.test("the generated editor schema fixes the two historical staleness bugs", () => {
  const json = renderConfigDocSchemaJson();
  const schema = JSON.parse(json) as Record<string, unknown>;
  // Bug 1: the agents enum must include gemini (KNOWN_AGENTS, not just two).
  assert(json.includes('"gemini"'), "agents enum must include gemini");
  // Bug 2: no reference to the abolished `.discern/config.toml` path anywhere.
  assert(
    !json.includes(".discern/config.toml"),
    "must not reference the abolished .discern/config.toml path",
  );
  assert(!json.includes(".discern"), "must not reference any .discern/ path");
  // The $id points at the root discern.toml schema, generated (not hand-typed).
  assert(String(schema.$id).endsWith("schema/discern-config.schema.json"));
  // The document is strict (an editor flags a typo'd key).
  assertEquals(schema.additionalProperties, false);
});

Deno.test("the generated capabilities object is closed and not all-required", () => {
  const schema = JSON.parse(renderConfigDocSchemaJson()) as {
    properties: { capabilities: Record<string, unknown> };
  };
  const caps = schema.properties.capabilities;
  // A closed set (no unknown capability) …
  assertEquals(caps.additionalProperties, false);
  // … but every entry is optional — a doc may fill just one capability.
  assertEquals(caps.required, undefined);
  assertEquals(
    Object.keys(caps.properties as Record<string, unknown>).sort(),
    ["build", "format", "lint", "test", "typecheck"],
  );
});
