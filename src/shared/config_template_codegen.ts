/**
 * Render the shipped `discern.toml` template from the config schema and the
 * config prose registry (ADR 0363). The template is a committed codegen
 * output: `deno task codegen` writes it, the codegen sync test holds it equal
 * to this renderer, and nobody edits it by hand. Setup substitutes its
 * `{{tokens}}` and upgrade reconciles its banners, as before; only the
 * authoring moved.
 *
 * Layout, per documented unit of the schema:
 *
 *     # ─────…
 *     # [section]                (or [family.<name>] for a named-table family)
 *     #
 *     # What:    one sentence from the prose registry
 *     # Why:     one or two sentences, wrapped under the label
 *     #
 *     # Params:  the knobs an entry accepts (named-table families only)
 *     # Help:    `discern config explain section`
 *     # ─────…
 *
 * A fixed section then lists its header and every rendered key beneath the
 * key's schema description. A named-table family lists its seeded entries and
 * one commented-out example. Every line is held to {@link TEMPLATE_WIDTH}
 * columns after the depth indent, and the finished text is a fixpoint of
 * `indentToml`, so `discern tidy` changes nothing.
 */

import { z } from "@zod/zod";
import { configSchema, RECORD_ENTRY_SCHEMAS } from "./config_schema.ts";
import {
  type ConfigExample,
  type ConfigUnitProse,
  configUnitProse,
} from "./config_prose.ts";
import { isJsonObject, objectView } from "./config_codegen.ts";
import { isKnownJob, KNOWN_JOBS } from "./capabilities.ts";
import {
  BUILT_IN_CHECKPOINT_SUMMARIES,
  BUILT_IN_CHECKPOINTS,
  DEFAULT_CHECKPOINT_MODE,
} from "./checkpoints.ts";
import { AGENT_NAMES } from "./agent_catalogue.ts";
import { CONFIG_SCHEMA_ID } from "./public_schemas.ts";
import { PROVIDERS } from "../lib/providers.ts";
import { SCHEMA_VERSION } from "../lib/version.ts";
import { indentToml } from "../lib/toml_indent.ts";
import { renderTomlLiteral } from "./toml_literal.ts";

/** The template's line width, measured after the depth indent. */
export const TEMPLATE_WIDTH = 79;

/** One depth step of the config's indentation convention. */
const INDENT = 2;

/** The label column of a banner field: `# What:    `. */
const LABEL_WIDTH = 9;

/**
 * Values the scaffold writes in place of a schema default: the tokens the
 * scaffolder fills at setup, and the seeds a fresh install carries live.
 * Keyed by dotted config path.
 */
export const SCAFFOLD_VALUES: Readonly<Record<string, string>> = {
  "project.name": '"{{project_name}}"',
  "project.slug": '"{{project_slug}}"',
  "project.gotchas_doc": '"{{gotchas_doc}}"',
  "project.agents": "[{{agents_array}}]",
  "repository.branch_prefix": '"{{branch_prefix}}"',
  "map.dir": '"{{map_dir}}"',
  "jobs.format": '"discern tidy"',
  "meta.schema_version": String(SCHEMA_VERSION),
};

type JsonObject = Record<string, unknown>;

/** Greedy word wrap to at most `width` characters per line. */
export function wrapWords(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Prose as `# ` comment lines, wrapped to the width left after `indent`. */
function commentLines(text: string, indent: number): string[] {
  return wrapWords(text, TEMPLATE_WIDTH - indent - 2).map((line) =>
    `# ${line}`
  );
}

/** Pre-formatted comment lines, each checked against the width. */
function verbatimLines(lines: readonly string[], indent: number): string[] {
  return lines.map((line) => {
    const rendered = line === "" ? "#" : `# ${line}`;
    if (rendered.length > TEMPLATE_WIDTH - indent) {
      throw new Error(
        `a config prose line is wider than ${
          TEMPLATE_WIDTH - indent
        } columns at indent ${indent}: ${rendered}`,
      );
    }
    return rendered;
  });
}

/** A labelled banner field: the label in its column, the text wrapped under
 * the text column. */
function labelled(label: string, text: string, indent: number): string[] {
  const head = `${label}:`.padEnd(LABEL_WIDTH);
  const width = TEMPLATE_WIDTH - indent - 2 - LABEL_WIDTH;
  return wrapWords(text, width).map((line, index) =>
    index === 0 ? `# ${head}${line}` : `# ${" ".repeat(LABEL_WIDTH)}${line}`
  );
}

/** A `# ───` rule reaching the width after `indent`. */
function rule(indent: number): string {
  return `# ${"─".repeat(TEMPLATE_WIDTH - indent - 2)}`;
}

/** The banner opening a documented unit. `fields` names the knobs a
 * named-table entry accepts, under the given label. */
function banner(
  path: string,
  identity: string,
  prose: ConfigUnitProse,
  indent: number,
  fields?: { label: string; names: readonly string[] },
): string[] {
  const out = [
    rule(indent),
    `# [${identity}]`,
    "#",
    ...labelled("What", prose.what, indent),
    ...labelled("Why", prose.why, indent),
  ];
  if (prose.detail !== undefined) {
    out.push("#", ...verbatimLines(prose.detail, indent));
  }
  out.push("#");
  if (fields !== undefined) {
    out.push(...labelled(fields.label, fields.names.join(", "), indent));
  }
  out.push(
    ...labelled("Help", `\`discern config explain ${path}\``, indent),
    rule(indent),
  );
  return out;
}

/** The agent-to-file table the `[project].agents` key documents, packed into
 * lines from the provider registry. */
function agentTargetLines(indent: number): string[] {
  const pairs = AGENT_NAMES.map((agent) =>
    `"${agent}" -> ${PROVIDERS[agent].instructionFile.path}`
  );
  const width = TEMPLATE_WIDTH - indent - 2;
  const lines: string[] = [];
  let current = "";
  for (const pair of pairs) {
    const candidate = current === "" ? `  ${pair}` : `${current}   ${pair}`;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = `  ${pair}`;
    }
  }
  if (current !== "") lines.push(current);
  return ["Agent files:", ...lines];
}

/** One key of a fixed section: its description, any registry detail, and
 * the assignment — live when a value exists, commented out otherwise. */
function keyLines(
  unit: string,
  key: string,
  node: JsonObject,
  prose: ConfigUnitProse,
  indent: number,
  options: { padTo?: number } = {},
): string[] {
  const keyProse = prose.keys?.[key];
  if (keyProse?.render === "omit") return [];
  const path = `${unit}.${key}`;
  if (typeof node.description !== "string") {
    throw new Error(`${path} has no schema description; add .describe() to it`);
  }
  const description = unit === "jobs" && isKnownJob(key)
    ? `Stage: ${KNOWN_JOBS[key]}. ${node.description}`
    : node.description;
  const out = commentLines(description, indent);
  if (keyProse?.detail !== undefined) {
    out.push(...verbatimLines(keyProse.detail, indent));
  }
  if (path === "project.agents") {
    out.push(...verbatimLines(agentTargetLines(indent), indent));
  }
  const scaffold = SCAFFOLD_VALUES[path];
  const value = scaffold ??
    (Object.hasOwn(node, "default")
      ? renderTomlLiteral(node.default)
      : undefined);
  const hint = keyProse?.hint === undefined ? "" : ` # e.g. ${keyProse.hint}`;
  const name = options.padTo === undefined ? key : key.padEnd(options.padTo);
  if (value !== undefined) {
    out.push(`${key} = ${value}${hint}`);
  } else if (keyProse?.example !== undefined) {
    out.push(`# ${name} = ${keyProse.example}`);
  } else {
    throw new Error(
      `${path} has no schema default, scaffold value, or registry example, so the scaffold has nothing to render; add one`,
    );
  }
  return out;
}

/** A worked example, commented out beneath its lead sentence. The lead and
 * the table header sit at the family's indent; the entries one step deeper,
 * where the depth indent will place them. */
function exampleLines(example: ConfigExample, indent: number): string[] {
  const [header = "", ...entries] = example.toml.split("\n");
  return [
    ...verbatimLines([`${example.lead}.`, header], indent),
    ...verbatimLines(entries, indent + INDENT),
  ];
}

/** The prose for a unit, or a clear failure naming the registry. */
function proseFor(path: string): ConfigUnitProse {
  const prose = configUnitProse(path);
  if (prose === undefined) {
    throw new Error(
      `no config prose is registered for [${path}]; add it to CONFIG_PROSE`,
    );
  }
  return prose;
}

/** Whether a schema node is a named-table family with no fixed keys. */
function isRecordFamily(node: JsonObject): boolean {
  return isJsonObject(node.additionalProperties) &&
    !isJsonObject(node.properties);
}

/** Whether a schema node is a table with fixed keys or named entries. */
function isTable(node: JsonObject): boolean {
  return node.type === "object" &&
    (isJsonObject(node.properties) || isJsonObject(node.additionalProperties));
}

/** The knob names a named-table family's entries accept, in schema order. */
function familyFields(family: string): readonly string[] {
  const schema =
    RECORD_ENTRY_SCHEMAS[family as keyof typeof RECORD_ENTRY_SCHEMAS];
  if (schema === undefined) {
    throw new Error(
      `[${family}.<name>] has no entry schema in RECORD_ENTRY_SCHEMAS`,
    );
  }
  return Object.keys(schema.shape);
}

/** The indent a unit's banner sits at: one step per visible parent unit. */
function unitIndent(path: string): number {
  const depth = path.split(".").length - 1;
  return depth * INDENT;
}

/** The shipped built-in checkpoints, seeded live and grouped by mode. */
function builtInCheckpointLines(indent: number): string[] {
  const byMode = (mode: string): string[] =>
    Object.keys(BUILT_IN_CHECKPOINTS).filter((id) =>
      (BUILT_IN_CHECKPOINTS[id]?.mode ?? DEFAULT_CHECKPOINT_MODE) === mode
    );
  const group = (ids: string[]): string[] => {
    const width = Math.max(...ids.map((id) => `[checkpoints.${id}]`.length));
    return ids.map((id) => {
      const summary = BUILT_IN_CHECKPOINT_SUMMARIES[id];
      if (summary === undefined) {
        throw new Error(`built-in checkpoint "${id}" has no summary line`);
      }
      const line = `${`[checkpoints.${id}]`.padEnd(width)} # ${summary}`;
      if (line.length > TEMPLATE_WIDTH - indent) {
        throw new Error(
          `the summary for built-in checkpoint "${id}" makes its line wider than ${
            TEMPLATE_WIDTH - indent
          } columns; shorten it`,
        );
      }
      return line;
    });
  };
  return [
    ...commentLines(
      "Shipped stop checkpoints guard the knowledge surfaces: `discern done` pauses until the agent declares each fired question met, or unmet with a rationale.",
      indent,
    ),
    ...group(byMode("stop")),
    ...commentLines(
      "gotchas-playbook stays quiet until [project].gotchas_doc names a doc.",
      indent,
    ),
    "",
    ...commentLines(
      "Shipped advisory checkpoints read the shape of the change and never block; each question arrives with the Gate's advisories when its pattern appears.",
      indent,
    ),
    ...group(byMode("advise")),
  ];
}

/** A named-table family: banner, seeded entries, and one commented example. */
function recordUnitLines(path: string, indent: number): string[] {
  const prose = proseFor(path);
  const out = banner(path, `${path}.<name>`, prose, indent, {
    label: "Params",
    names: familyFields(path),
  });
  const seeds = prose.seeds ?? [];
  for (const seed of seeds) {
    out.push(
      "",
      ...commentLines(seed.comment, indent),
      ...seed.toml.split("\n"),
    );
  }
  if (path === "checkpoints") {
    out.push("", ...builtInCheckpointLines(indent));
  }
  const example = prose.examples?.[0];
  if (example !== undefined) {
    out.push("", ...exampleLines(example, indent));
  }
  return out;
}

/** `[jobs]`: fixed known names plus the custom-table form. */
function jobsUnitLines(node: JsonObject): string[] {
  const prose = proseFor("jobs");
  const props = isJsonObject(node.properties) ? node.properties : {};
  const out = banner("jobs", "jobs", prose, 0, {
    label: "Custom",
    names: familyFields("jobs"),
  });
  out.push("", "[jobs]");
  const padTo = Math.max(...Object.keys(KNOWN_JOBS).map((name) => name.length));
  let first = true;
  for (const name of Object.keys(KNOWN_JOBS)) {
    const child = props[name];
    if (!isJsonObject(child)) {
      throw new Error(`[jobs].${name} is a known job with no schema entry`);
    }
    if (!first) out.push("");
    first = false;
    out.push(...keyLines("jobs", name, child, prose, INDENT, { padTo }));
  }
  const example = prose.examples?.[0];
  if (example !== undefined) {
    out.push("", ...exampleLines(example, INDENT));
  }
  return out;
}

/** A fixed section: banner, header, its keys, then its nested units. */
function fixedUnitLines(
  path: string,
  node: JsonObject,
  indent: number,
): string[] {
  const prose = proseFor(path);
  const props = isJsonObject(node.properties) ? node.properties : {};
  const out = banner(path, path, prose, indent);
  out.push("", `[${path}]`);
  const nested: Array<[string, JsonObject]> = [];
  let first = true;
  for (const [key, child] of Object.entries(props)) {
    if (!isJsonObject(child)) continue;
    const view = objectView(child);
    if (isTable(view)) {
      nested.push([`${path}.${key}`, view]);
      continue;
    }
    const lines = keyLines(path, key, view, prose, indent + INDENT);
    if (lines.length === 0) continue;
    if (!first) out.push("");
    first = false;
    out.push(...lines);
  }
  for (const [nestedPath, view] of nested) {
    out.push("", ...unitLines(nestedPath, view));
  }
  return out;
}

/** Any documented unit, dispatched on its schema shape. */
function unitLines(path: string, node: JsonObject): string[] {
  if (path === "jobs") return jobsUnitLines(node);
  if (isRecordFamily(node)) {
    return recordUnitLines(path, unitIndent(path));
  }
  return fixedUnitLines(path, node, unitIndent(path));
}

/** The file preamble: the editor schema directive at byte zero, the
 * provenance marker, and how to get help. */
function preambleLines(): string[] {
  return [
    `#:schema ${CONFIG_SCHEMA_ID}`,
    "# {{artifact_provenance_marker}}",
    "#",
    '# discern.toml configures discern for "{{project_name}}".',
    "#",
    ...commentLines(
      "Every section opens with what it governs, why it matters, and the command that explains it in full: `discern config explain <section>` prints the complete reference for a section or a key, with its current value and an example.",
      0,
    ),
    "#",
    "#   discern setup      guided first configuration (ask your coding agent)",
    "#   discern doctor     verify this installation           MCP: discern_doctor",
    "#   discern status     what is true now, and what is next  MCP: discern_status",
    "#   discern docs       the manual                          MCP: discern_docs",
    "#   discern upgrade    bring this file up to date after a new discern version",
    "#",
    '# Generated by discern {{kit_version}} for "{{project_name}}".',
  ];
}

/**
 * Render the complete template text. Sections follow schema order; the
 * result is depth-indented and ends with one newline.
 */
export function renderConfigTemplate(): string {
  const root = z.toJSONSchema(configSchema, { io: "input" }) as JsonObject;
  const props = isJsonObject(root.properties) ? root.properties : {};
  const lines = preambleLines();
  for (const [section, child] of Object.entries(props)) {
    if (!isJsonObject(child)) continue;
    lines.push("", "", ...unitLines(section, objectView(child)));
  }
  const text = indentToml(`${lines.join("\n")}\n`, INDENT);
  for (const line of text.split("\n")) {
    if (line.length > TEMPLATE_WIDTH) {
      throw new Error(
        `the rendered config template has a line wider than ${TEMPLATE_WIDTH} columns: ${line}`,
      );
    }
  }
  return text;
}
