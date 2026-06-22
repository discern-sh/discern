/**
 * Generators that derive the shipped, committed artifacts from the canonical Zod
 * schema (ADR 0026) — so the editor JSON Schema, the `discern.toml` template
 * prose, and the docs config-reference all render from one source and can never
 * drift from what the engine enforces.
 *
 * Run by `deno task codegen`; a sync test asserts each committed artifact equals
 * its generator output, so a schema change that isn't regenerated fails the gate.
 * These functions stay OUT of the engine's hot path — they are dev/codegen tools.
 */

import { z } from "@zod/zod";
import { configDocSchema } from "./config_schema.ts";

/** Published `$id` for the editor JSON Schema (matches the repo's raw URL). */
const SCHEMA_ID =
  "https://raw.githubusercontent.com/jackwh/discern/main/schema/discern-config.schema.json";

/** Human title for the editor JSON Schema. */
const SCHEMA_TITLE = "discern config document";

/** A non-null, non-array object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Build the editor JSON Schema for the config *document* from {@link
 * configDocSchema}. Uses the `input` view (defaults/optionals are NOT required,
 * matching what a human writes) and prepends the published `$id` + `title` that
 * Zod doesn't emit. Because it is generated, the historical staleness bugs — the
 * `.discern/config.toml` path text and the gemini-less `agents` enum — cannot
 * recur: both now follow from the schema.
 */
export function buildConfigDocJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(configDocSchema, { io: "input" }) as Record<
    string,
    unknown
  >;
  // Order: $schema, $id, title, then the schema body Zod produced (description,
  // type, properties, additionalProperties…).
  const { $schema, ...body } = generated;
  return {
    $schema: $schema ?? "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_ID,
    title: SCHEMA_TITLE,
    ...body,
  };
}

/** The editor JSON Schema rendered as the committed file's exact text (2-space
 * indent, trailing newline — matching `deno fmt`'s JSON style, so the file is
 * stable under the gate's fix stage). */
export function renderConfigDocSchemaJson(): string {
  return `${JSON.stringify(buildConfigDocJsonSchema(), null, 2)}\n`;
}

// Re-export the object guard for tests that introspect the generated shape.
export { isObject as isJsonObject };
