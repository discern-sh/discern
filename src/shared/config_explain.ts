/**
 * `discern config explain <path>` — the depth the scaffolded config keeps
 * short, one command away (ADR 0363). For a section, a named-table family,
 * or one key, it joins the prose registry's teaching (what, why, detail,
 * examples) with the schema's reference facts (keys, types, defaults) and,
 * inside a project, the current value. The same explanation renders as JSON,
 * as Markdown, and as the terminal text.
 *
 * Path forms accepted, with or without brackets:
 *   scopes                    a section or named-table family
 *   scopes.<name>             the same family
 *   gate.timeout              one key of a section
 *   scopes.<name>.paths       one knob of a family's entries
 *   scopes.map                one named entry: the family, with that entry's value
 *   scopes.map.paths          one knob, with that entry's value for it
 */

import { z } from "@zod/zod";
import { configSchema } from "./config_schema.ts";
import {
  configProseUnits,
  defaultLabel,
  isJsonObject,
  objectView,
  typeLabel,
} from "./config_codegen.ts";
import { type ConfigExample, configUnitProse } from "./config_prose.ts";
import {
  type ConfigExplainData,
  configExplainDataSchema,
} from "./config_explain_schema.ts";
import { renderTomlLiteral } from "./toml_literal.ts";

/** The manual page every explanation points at. */
export const CONFIG_REFERENCE_URL =
  "https://discern.sh/docs/reference/config-reference";

type JsonObject = Record<string, unknown>;

let rootSchema: JsonObject | undefined;

/** The live config as JSON Schema, computed once per process. */
function root(): JsonObject {
  rootSchema ??= z.toJSONSchema(configSchema, { io: "input" }) as JsonObject;
  return rootSchema;
}

/** The schema node at a dotted unit path, descending into a family's entry
 * shape for a `<name>` segment. */
function nodeAt(segments: readonly string[]): JsonObject | undefined {
  let node = objectView(root());
  for (const segment of segments) {
    if (segment === "<name>") {
      if (!isJsonObject(node.additionalProperties)) return undefined;
      node = objectView(node.additionalProperties);
      continue;
    }
    const props = isJsonObject(node.properties) ? node.properties : {};
    const child = props[segment];
    if (!isJsonObject(child)) return undefined;
    node = objectView(child);
  }
  return node;
}

/** Whether a schema node is a named-table family with no fixed keys. */
function isFamily(node: JsonObject): boolean {
  return isJsonObject(node.additionalProperties) &&
    !isJsonObject(node.properties);
}

/** The reference rows for the leaf keys of a schema object. */
function keyRows(node: JsonObject): NonNullable<ConfigExplainData["keys"]> {
  const props = isJsonObject(node.properties) ? node.properties : {};
  const rows: NonNullable<ConfigExplainData["keys"]> = [];
  for (const [name, child] of Object.entries(props)) {
    if (!isJsonObject(child)) continue;
    const view = objectView(child);
    if (
      view.type === "object" &&
      (isJsonObject(view.properties) || isJsonObject(view.additionalProperties))
    ) {
      continue;
    }
    const fallback = defaultLabel(view);
    rows.push({
      name,
      type: typeLabel(view),
      ...(fallback === "—" ? {} : { default: fallback.replaceAll("`", "") }),
      description: typeof view.description === "string" ? view.description : "",
    });
  }
  return rows;
}

/** The manual anchor for a unit heading such as `[scopes.<name>]`. */
function anchorFor(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Render a parsed TOML value back as TOML: scalars and arrays inline, a
 * table as one `key = value` line per entry. */
export function renderConfigValue(value: unknown): string {
  if (isJsonObject(value)) {
    return Object.entries(value)
      .map(([key, entry]) =>
        isJsonObject(entry)
          ? `[${key}]\n${renderConfigValue(entry)}`
          : `${key} = ${renderTomlLiteral(entry)}`
      )
      .join("\n");
  }
  return renderTomlLiteral(value);
}

/** The raw config value at a dotted path, if present. */
function valueAt(
  current: JsonObject | undefined,
  segments: readonly string[],
): unknown {
  let node: unknown = current;
  for (const segment of segments) {
    if (!isJsonObject(node)) return undefined;
    node = node[segment];
  }
  return node;
}

/** Normalise `[scopes.<name>]`, `scopes.<id>`, and plain dotted input to
 * segments, with a family's placeholder segment spelled `<name>`. */
function segmentsOf(input: string): string[] {
  const trimmed = input.trim().replace(/^\[+/, "").replace(/\]+$/, "");
  return trimmed.split(".").filter((s) => s !== "").map((segment) =>
    /^<[a-z_-]+>$/.test(segment) ? "<name>" : segment
  );
}

/** The explanation for a unit path (a section or a family). */
function explainUnit(
  path: string,
  node: JsonObject,
  value: unknown,
): ConfigExplainData {
  const family = isFamily(node);
  const prose = configUnitProse(path);
  const header = family ? `[${path}.<name>]` : `[${path}]`;
  const entry = family && isJsonObject(node.additionalProperties)
    ? objectView(node.additionalProperties)
    : node;
  const rows = keyRows(entry);
  return {
    operation: "explain",
    path,
    kind: family ? "family" : "section",
    ...(prose === undefined ? {} : { what: prose.what, why: prose.why }),
    ...(prose?.detail === undefined ? {} : { detail: [...prose.detail] }),
    ...(family ? { params: rows.map((row) => row.name) } : {}),
    ...(rows.length === 0 ? {} : { keys: rows }),
    ...(value === undefined ? {} : { value: renderConfigValue(value) }),
    ...(prose?.examples === undefined || prose.examples.length === 0
      ? {}
      : { examples: prose.examples.map(exampleOf) }),
    reference: `${CONFIG_REFERENCE_URL}#${anchorFor(header)}`,
  };
}

/** A registry example as the result's plain data shape. */
function exampleOf(example: ConfigExample): { lead: string; toml: string } {
  return { lead: example.lead, toml: example.toml };
}

/** The explanation for one key or knob. */
function explainKey(
  unitPath: string,
  key: string,
  node: JsonObject,
  value: unknown,
): ConfigExplainData {
  const prose = configUnitProse(unitPath);
  const unitNode = nodeAt(unitPath.split("."));
  const family = unitNode !== undefined && isFamily(unitNode);
  const header = family ? `[${unitPath}.<name>]` : `[${unitPath}]`;
  const fallback = defaultLabel(node);
  const detail = prose?.keys?.[key]?.detail;
  return {
    operation: "explain",
    path: family ? `${unitPath}.<name>.${key}` : `${unitPath}.${key}`,
    kind: "key",
    ...(prose === undefined ? {} : { what: prose.what }),
    ...(detail === undefined ? {} : { detail: [...detail] }),
    type: typeLabel(node),
    ...(fallback === "—" ? {} : { default: fallback.replaceAll("`", "") }),
    description: typeof node.description === "string" ? node.description : "",
    ...(value === undefined ? {} : { value: renderConfigValue(value) }),
    reference: `${CONFIG_REFERENCE_URL}#${anchorFor(header)}`,
  };
}

/**
 * Explain a config path. `current` is the project's parsed `discern.toml`
 * when there is one, so an explanation can carry the live value. Returns
 * undefined for a path the schema does not know.
 */
export function explainConfigPath(
  input: string,
  current?: JsonObject,
): ConfigExplainData | undefined {
  const raw = segmentsOf(input);
  if (raw.length === 0) return undefined;
  const units = new Set(configProseUnits());

  // The longest unit prefix, then the rest: a `<name>` placeholder or a named
  // entry, then optionally one knob.
  let unitLength = 0;
  for (let i = raw.length; i >= 1; i--) {
    if (units.has(raw.slice(0, i).join("."))) {
      unitLength = i;
      break;
    }
  }
  if (unitLength === 0) return undefined;
  const unitPath = raw.slice(0, unitLength).join(".");
  const unitNode = nodeAt(raw.slice(0, unitLength));
  if (unitNode === undefined) return undefined;
  const rest = raw.slice(unitLength);
  const family = isFamily(unitNode);

  if (rest.length === 0) {
    return explainUnit(unitPath, unitNode, valueAt(current, raw));
  }
  if (!family) {
    const [key, ...extra] = rest;
    if (key === undefined || extra.length > 0) return undefined;
    const keyNode = nodeAt([...raw.slice(0, unitLength), key]);
    if (keyNode === undefined) return undefined;
    return explainKey(unitPath, key, keyNode, valueAt(current, raw));
  }
  const [entry, knob, ...extra] = rest;
  if (entry === undefined || extra.length > 0) return undefined;
  const entryValue = entry === "<name>"
    ? undefined
    : valueAt(current, [...raw.slice(0, unitLength), entry]);
  if (knob === undefined) {
    return explainUnit(unitPath, unitNode, entryValue);
  }
  const knobNode = nodeAt([...raw.slice(0, unitLength), "<name>", knob]);
  if (knobNode === undefined) return undefined;
  return explainKey(
    unitPath,
    knob,
    knobNode,
    isJsonObject(entryValue) ? entryValue[knob] : undefined,
  );
}

/** A Markdown-result presentation, as the result presenters produce it. */
interface ExplanationPresentation {
  state: string;
  evidence?: readonly string[] | undefined;
  supportingMarkdown?: readonly string[] | undefined;
}

/**
 * Wrap the `config` result presenter so an `explain` result presents as its
 * own document. The branch lives here, beside the renderer, so the shared
 * presenter module gains no complexity for it. `describeState` is the
 * presenter module's default state line for a result and a success headline.
 */
export function withConfigExplanation(
  inner: (
    result: Readonly<Record<string, unknown>>,
  ) => ExplanationPresentation,
  describeState: (
    result: Readonly<Record<string, unknown>>,
    success?: string,
  ) => string,
): (result: Readonly<Record<string, unknown>>) => ExplanationPresentation {
  return (result) => {
    const parsed = configExplainDataSchema.safeParse(result.data);
    if (!parsed.success) {
      return inner(result);
    }
    const explanation = parsed.data;
    const evidence = [
      ...(explanation.what === undefined ? [] : [explanation.what]),
      ...(explanation.value === undefined
        ? []
        : ["The current value is included below."]),
    ];
    return {
      state: describeState(result, `Explained \`${explanation.path}\`.`),
      evidence,
      supportingMarkdown: [renderConfigExplanation(explanation)],
    };
  };
}

/** The explanation as Markdown: the terminal text and the `--markdown`
 * supporting document alike. */
export function renderConfigExplanation(data: ConfigExplainData): string {
  const out: string[] = [];
  const header = data.kind === "family"
    ? `[${data.path}.<name>]`
    : data.kind === "section"
    ? `[${data.path}]`
    : data.path;
  out.push(`# ${header}`, "");
  if (data.kind === "key") {
    out.push(data.description ?? "");
    if (data.detail !== undefined) {
      out.push("", "```text", ...data.detail, "```");
    }
    out.push("", `Type: ${data.type ?? "unknown"}.`);
    if (data.default !== undefined) out.push(`Default: ${data.default}.`);
    if (data.what !== undefined) {
      out.push("", `Its section: ${data.what}`);
    }
  } else {
    if (data.what !== undefined) out.push(`What: ${data.what}`);
    if (data.why !== undefined) out.push(`Why: ${data.why}`);
    if (data.detail !== undefined) {
      out.push("", "```text", ...data.detail, "```");
    }
    if (data.keys !== undefined && data.keys.length > 0) {
      out.push(
        "",
        data.kind === "family" ? "Params:" : "Keys:",
        "",
        "| Key | Type | Default | Description |",
        "| --- | --- | --- | --- |",
        ...data.keys.map((row) =>
          `| \`${row.name}\` | ${row.type} | ${
            row.default === undefined ? "—" : `\`${row.default}\``
          } | ${row.description.replace(/\|/g, "\\|")} |`
        ),
      );
    }
  }
  if (data.value !== undefined) {
    out.push("", "Current value:", "", "```toml", data.value, "```");
  }
  for (const example of data.examples ?? []) {
    out.push("", `${example.lead}:`, "", "```toml", example.toml, "```");
  }
  out.push("", `Reference: ${data.reference}`);
  return `${out.join("\n")}\n`;
}
