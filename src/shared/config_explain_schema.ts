/**
 * The `config explain` result data shape. It lives apart from the result
 * schema registry so the explanation module can validate and type its own
 * data without importing every verb's schema, which keeps the Markdown
 * presenter's import graph small enough for the logbook's no-network guard.
 * The registry composes this schema into the `config` union.
 */

import { z } from "@zod/zod";
import { openVocabulary } from "./result_vocabulary.ts";

const configExplainKeySchema = z.strictObject({
  name: z.string(),
  type: z.string(),
  default: z.string().optional(),
  description: z.string(),
});

const configExplainExampleSchema = z.strictObject({
  lead: z.string(),
  toml: z.string(),
});

/** `config explain` — one documented unit or key of the config, with the
 * prose registry's teaching, the schema's reference facts, the current value
 * when a project is present, and every worked example. */
export const configExplainDataSchema = z.strictObject({
  operation: z.literal("explain"),
  /** The resolved dotted path: a section, a named-table family, or a key. */
  path: z.string(),
  kind: openVocabulary("x-discern-config-explain-kinds"),
  what: z.string().optional(),
  why: z.string().optional(),
  detail: z.array(z.string()).optional(),
  /** The knobs a named-table family's entries accept. */
  params: z.array(z.string()).optional(),
  /** A section's keys, or a family's knobs, as reference rows. */
  keys: z.array(configExplainKeySchema).optional(),
  /** A key's own reference facts. */
  type: z.string().optional(),
  default: z.string().optional(),
  description: z.string().optional(),
  /** The current value in this project's config, rendered as TOML. */
  value: z.string().optional(),
  examples: z.array(configExplainExampleSchema).optional(),
  /** The manual's config reference for this unit. */
  reference: z.string(),
});
export type ConfigExplainData = z.infer<typeof configExplainDataSchema>;
