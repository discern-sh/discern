/**
 * Generators that derive the shipped, committed artifacts from the canonical Zod
 * schemas (ADR 0026) — the `discern.toml` editor JSON Schema, the setup/preset
 * config-document JSON Schema, and the docs config-reference all render from one
 * source and can never drift from what the engine enforces. (The `discern.toml`
 * template stays hand-authored to preserve its curated, legible comments — ADR
 * 0005 — and is bound to the schema by drift-guard tests instead, not
 * regenerated here.)
 *
 * Run by `deno task codegen`; a sync test asserts each committed artifact equals
 * its generator output, so a schema change that isn't regenerated fails the gate.
 * These functions stay OUT of the engine's hot path — they are dev/codegen tools.
 */

import { z } from "@zod/zod";
import { configDocSchema, configSchema } from "./config_schema.ts";
import {
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  CONFIG_SCHEMA_ID,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  SETUP_CONFIG_SCHEMA_ID,
} from "./public_schemas.ts";

/** Human title for the live `discern.toml` editor JSON Schema. */
const CONFIG_SCHEMA_TITLE = "discern.toml configuration";

/** Human title for the setup/preset config-document JSON Schema. */
const SETUP_CONFIG_SCHEMA_TITLE = "discern setup config document";

/** A non-null, non-array object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Flatten JSON Schema `allOf` object fragments into the view the reference and
 * path walkers need. `[jobs]` uses an intersection so it can expose fixed known
 * names while enforcing the same key pattern on custom names. */
function objectView(schema: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(schema.allOf)) return schema;
  const view: Record<string, unknown> = { ...schema };
  delete view.allOf;
  for (const part of schema.allOf) {
    if (!isObject(part)) continue;
    const currentProps = isObject(view.properties) ? view.properties : {};
    const partProps = isObject(part.properties) ? part.properties : {};
    Object.assign(view, part, {
      properties: { ...currentProps, ...partProps },
    });
  }
  return view;
}

/** Publish a config-policy Zod schema as JSON Schema: the `input` view
 * (defaults/optionals are NOT required, matching what a human writes) with the
 * published `$id`, compatibility policy, and `title` prepended — the identity
 * fields Zod doesn't emit. Order: $schema, $id, policy, title, then the schema
 * body Zod produced (description, type, properties, additionalProperties…). */
function publishedInputSchema(
  schema: z.ZodType,
  id: string,
  title: string,
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  const { $schema, ...body } = generated;
  return {
    $schema: $schema ?? "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]:
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    title,
    ...body,
  };
}

/**
 * Build the editor JSON Schema for a real `discern.toml` from the live {@link
 * configSchema} — the same shape the engine validates at load. This is the
 * artifact the template's `#:schema` line names, so an editor validates exactly
 * the file the engine will read.
 */
export function buildConfigJsonSchema(): Record<string, unknown> {
  return publishedInputSchema(
    configSchema,
    CONFIG_SCHEMA_ID,
    CONFIG_SCHEMA_TITLE,
  );
}

/**
 * Build the JSON Schema for the config *document* from {@link configDocSchema} —
 * the declarative shape `setup --config <file>` and a preset's `preset.json`
 * consume. Generating it from the schema keeps it from drifting from the live
 * config shape: every path and enum (the `agents` list, the config path text)
 * follows from the one source.
 */
export function buildConfigDocJsonSchema(): Record<string, unknown> {
  return publishedInputSchema(
    configDocSchema,
    SETUP_CONFIG_SCHEMA_ID,
    SETUP_CONFIG_SCHEMA_TITLE,
  );
}

/** A generated JSON Schema rendered as the committed file's exact text (2-space
 * indent, trailing newline — matching `deno fmt`'s JSON style, so the file is
 * stable under the gate's fix stage). */
function renderSchemaJson(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/** The committed text of `schema/discern-config.schema.json`. */
export function renderConfigSchemaJson(): string {
  return renderSchemaJson(buildConfigJsonSchema());
}

/** The committed text of `schema/discern-setup-config.schema.json`. */
export function renderConfigDocSchemaJson(): string {
  return renderSchemaJson(buildConfigDocJsonSchema());
}

// Re-export the object guard for tests that introspect the generated shape.
export { isObject as isJsonObject };

// ── docs config-reference (generated from the LIVE config schema) ──────────────

/** The banner stamped atop the generated docs page (and the template). */
const DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from src/shared/config_schema.ts — do NOT edit by hand. Edit the schema and regenerate. -->";

/** Escape a cell value for a Markdown table (pipes would split the row). */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/** A human type label for a JSON-schema node: `string`, `boolean`, `number`,
 * `string[]`, a `\|`-joined enum, or a `\|`-joined union (command-or-list). */
function typeLabel(schema: Record<string, unknown>): string {
  schema = objectView(schema);
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((v) => `\`${String(v)}\``).join(" \\| ");
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.filter(isObject).map(typeLabel).join(" \\| ");
  }
  const t = schema.type;
  if (t === "array") {
    const items = isObject(schema.items) ? typeLabel(schema.items) : "any";
    return items.includes(" \\| ") ? `(${items})[]` : `${items}[]`;
  }
  if (t === "integer") return "number";
  return typeof t === "string" ? t : "object";
}

/** The default-value label for a key: a code-fenced literal, or `—` when none. */
function defaultLabel(schema: Record<string, unknown>): string {
  return Object.hasOwn(schema, "default")
    ? `\`${JSON.stringify(schema.default)}\``
    : "—";
}

/** True for a nested container key (a sub-table or a `<name>` record), as opposed
 * to a scalar/array/enum leaf key. */
function isContainer(schema: Record<string, unknown>): boolean {
  schema = objectView(schema);
  return schema.type === "object" &&
    (isObject(schema.properties) || isObject(schema.additionalProperties));
}

/** A `| key | type | default | description |` table for the leaf keys of an object. */
function keyTable(properties: Record<string, unknown>): string {
  const rows = Object.entries(properties)
    .filter(([, v]) => isObject(v) && !isContainer(v))
    .map(([name, v]) => {
      const s = v as Record<string, unknown>;
      const desc = typeof s.description === "string" ? cell(s.description) : "";
      return `| \`${name}\` | ${typeLabel(s)} | ${defaultLabel(s)} | ${desc} |`;
    });
  if (rows.length === 0) return "";
  return [
    "| Key | Type | Default | Description |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Render one section (and any nested sub-sections) as Markdown. `path` is the
 * dotted, bracket-free section path (e.g. `worktree.setup`); `level` the heading
 * depth. A record section's header gains a `.<name>` to signal it is repeatable. */
function renderSection(
  path: string,
  schema: Record<string, unknown>,
  level: number,
): string {
  schema = objectView(schema);
  const props = isObject(schema.properties) ? schema.properties : undefined;
  const valueShape = isObject(schema.additionalProperties)
    ? schema.additionalProperties
    : undefined;
  const isRecord = props === undefined && valueShape !== undefined;

  const header = isRecord ? `[${path}.<name>]` : `[${path}]`;
  const out: string[] = [`${"#".repeat(level)} \`${header}\``];
  if (typeof schema.description === "string") {
    out.push("", schema.description);
  }

  if (isRecord) {
    // A repeatable named table: document its value shape's leaf keys.
    const inner = isObject(valueShape.properties) ? valueShape.properties : {};
    const table = keyTable(inner);
    if (table !== "") out.push("", table);
  } else if (props !== undefined) {
    // An object section: a table of its leaf keys, then a sub-section per nested
    // container (a `[worktree.setup]` object, a `[worktree.resources.<name>]` record).
    const table = keyTable(props);
    if (table !== "") out.push("", table);
    for (const [key, child] of Object.entries(props)) {
      if (isObject(child) && isContainer(objectView(child))) {
        out.push(
          "",
          renderSection(`${path}.${key}`, objectView(child), level + 1),
        );
      }
    }
    // `[jobs]` is deliberately hybrid: fixed known-name values plus an open
    // custom-name table shape. Render that custom arm as `[jobs.<name>]`.
    if (valueShape !== undefined) {
      const custom = objectView(valueShape);
      out.push("", `${"#".repeat(level + 1)} \`[${path}.<name>]\``);
      if (typeof custom.description === "string") {
        out.push("", custom.description);
      }
      const table = keyTable(
        isObject(custom.properties) ? custom.properties : {},
      );
      if (table !== "") out.push("", table);
    }
  }
  return out.join("\n");
}

/** Search aliases for every section and key in the live config schema. Named
 * tables keep their documented `<name>` placeholder, so a query such as
 * `jobs.<name>.run` reaches the reference without a hand-maintained synonym
 * list. */
function configSearchAliases(schema: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    node = objectView(node);
    const props = isObject(node.properties) ? node.properties : undefined;
    if (props !== undefined) {
      for (const [key, child] of Object.entries(props)) {
        if (!isObject(child)) continue;
        const path = prefix === "" ? key : `${prefix}.${key}`;
        out.push(path);
        if (isContainer(objectView(child))) walk(objectView(child), path);
      }
    }
    const valueShape = isObject(node.additionalProperties)
      ? node.additionalProperties
      : undefined;
    if (valueShape !== undefined) {
      const path = `${prefix}.<name>`;
      out.push(path);
      walk(objectView(valueShape), path);
    }
  };
  walk(schema, "");
  return out;
}

/**
 * Render the docs config-reference page from the LIVE `discern.toml` schema:
 * every section, key, type, default, and description, straight from the canonical
 * `.describe(...)` annotations. Replaces a hand-maintained reference that would
 * drift from what the engine enforces.
 */
function renderConfigReferenceDocument(
  manual: boolean,
  schema: z.ZodType = configSchema,
): string {
  const root = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  const props = isObject(root.properties) ? root.properties : {};
  const aliases = [
    "configuration",
    "discern.toml",
    "config",
    ...configSearchAliases(root),
  ];
  const namedTables = recordConfigPathsFromRoot(root).map((path) =>
    path === "jobs" ? "`[jobs.<name>]` for custom jobs" : `\`[${path}.<name>]\``
  )
    .join(", ");
  const out: string[] = [
    "---",
    "title: Config reference",
    manual
      ? "description: Every public discern.toml table, key, type, default, placeholder, and named-table rule generated from the schema the binary enforces."
      : "description: Every discern.toml section, key, type, and default generated from the schema the binary enforces.",
    "order: 20",
    "publish: true",
    "aliases:",
    ...aliases.map((alias) => `  - ${alias}`),
    "---",
    "",
    DOCS_BANNER,
    "",
    "# `discern.toml` — config reference",
    "",
    manual
      ? "Look up every public `discern.toml` table, key, type, default, placeholder, and named-table rule. The tables below are generated from the same schema the installed binary validates."
      : typeof root.description === "string"
      ? root.description
      : "The file that configures a discern install.",
    "",
    manual
      ? "Prerequisite: a `discern.toml` file or a planned configuration. A **Default** is the value discern uses when a key is absent. An em dash means the key has no schema default; it does not mean an empty value. Unknown top-level tables and keys are not supported unless the table is explicitly named with `<name>`."
      : "Every section, key, type, and default below is generated from the canonical schema (`src/shared/config_schema.ts`). A **Default** is the value discern uses when the key is absent; the gate, worktree workflow, and standards all read this shape through one typed loader, so the documentation matches what the engine enforces.",
    "",
    `The named-table sections (${namedTables}) are repeatable: declare as many as you like, each with its own \`<name>\`.`,
    "",
    ...(manual
      ? [
        "The published [JSON Schema](https://discern.sh/schema/v1/discern-config.schema.json) is the external machine-readable contract. For editing and validation recovery, see [Configuration and setup troubleshooting](../40-troubleshooting/setup-and-integrations.md).",
      ]
      : [
        "Fresh setup seeds `[scopes.map]` with the map and deferred-work ledger. `[scopes.instructions]` carries the project brief, instruction sources, authored skills, and materialized skills directories. The `[acceptance]` example names only `map`, so agent-instruction changes require owner review. Upgrade leaves existing named scopes unchanged; owners of earlier installs split their scope manually to adopt this boundary.",
      ]),
  ];
  for (const [section, schema] of Object.entries(props)) {
    if (isObject(schema)) {
      out.push("", renderSection(section, schema, 2));
    }
  }
  return `${out.join("\n")}\n`;
}

/** Render the established Map projection. */
export function renderConfigReferenceDoc(
  schema: z.ZodType = configSchema,
): string {
  return renderConfigReferenceDocument(false, schema);
}

/** Render the external-reader manual projection from the same live schema. */
export function renderManualConfigReferenceDoc(
  schema: z.ZodType = configSchema,
): string {
  return renderConfigReferenceDocument(true, schema);
}

/** The live config's top-level section names, in schema order — used by the
 * template drift-guard test (every section must appear in `discern.toml.tmpl`). */
export function configSectionNames(): string[] {
  const root = z.toJSONSchema(configSchema, { io: "input" }) as Record<
    string,
    unknown
  >;
  return isObject(root.properties) ? Object.keys(root.properties) : [];
}

/**
 * The dotted paths of the schema's open `<name>` tables — the `z.record` sections
 * whose entries are user-population, not fixed keys. A node is one when it has a
 * value shape under
 * `additionalProperties` but no fixed `properties`. Derived from the live schema so
 * a new record section auto-enrolls; the template↔config parity guard uses this to
 * treat those sub-trees as the customizable "extras" zone (a project's own named
 * records are never required to match the template's).
 */
export function recordConfigPaths(): string[] {
  const root = z.toJSONSchema(configSchema, { io: "input" }) as Record<
    string,
    unknown
  >;
  return recordConfigPathsFromRoot(root);
}

/** Collect open-table paths from one already-generated schema root. */
function recordConfigPathsFromRoot(
  root: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    node = objectView(node);
    const props = isObject(node.properties) ? node.properties : {};
    for (const [key, child] of Object.entries(props)) {
      if (!isObject(child)) {
        continue;
      }
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const view = objectView(child);
      if (isObject(view.additionalProperties)) {
        out.push(path); // an open <name> table — its entries are user-defined
        continue;
      }
      walk(view, path);
    }
  };
  walk(root, "");
  return out;
}
