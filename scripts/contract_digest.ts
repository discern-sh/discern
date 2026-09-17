/**
 * Render the committed public-contract artifacts as one readable Markdown
 * digest. Every command, tool, result shape, configuration key, and convention
 * becomes a table, so the contract can be reviewed without reading the JSON.
 *
 * `deno task codegen` writes the digest to the map page its framing policy
 * names; `deno run --allow-read scripts/contract_digest.ts` prints it. The
 * digest is passed through the tidy Markdown formatter first, so `discern
 * tidy` has nothing left to change.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { z } from "@zod/zod";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";
import { DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS } from "../src/shared/environment_variables.ts";
import { EXIT_STATUS_REGISTRY } from "../src/shared/exit_codes.ts";
import { ERROR_FAILURE_RECOVERY } from "../src/shared/hints.ts";
import {
  compatibilityContract,
  MANIFEST_STABILITY_FIELD,
  PUBLIC_SCHEMA_PUBLICATIONS,
  PUBLIC_SCHEMA_STABILITY_KEY,
  type PublicSchemaPublication,
  STABILITY_TIER_EVOLVING,
} from "../src/shared/public_schemas.ts";
import {
  RESULT_DECISION_VOCABULARIES,
  RESULT_OPEN_VOCABULARIES,
  RESULT_VOCABULARY_KEYWORD,
  type ResultOpenVocabularyKey,
} from "../src/shared/result.ts";
import { decodeJson } from "../src/shared/runtime_decode.ts";
import { GENERATED_INVENTORY_POLICIES } from "./generated_inventory_policy.ts";
import {
  isEvolving,
  isObject,
  type JsonObject,
  type JsonValue,
} from "./public_contract_compatibility_common.ts";

/** The framing the generated page carries: banner, title, and reading notes. */
const POLICY = GENERATED_INVENTORY_POLICIES["public-schema-publications"];

/** Artifact paths in reading order; publications outside this list follow generically. */
const READING_ORDER: readonly PublicSchemaPublication["artifactPath"][] = [
  "schema/discern-cli.json",
  "schema/discern-mcp-tools.json",
  "schema/discern-results.schema.json",
  "schema/discern-config.schema.json",
  "schema/discern-setup-config.schema.json",
  "schema/discern-conventions.json",
  "schema/discern-proof-note.schema.json",
  "schema/discern-releases.schema.json",
];

const JsonValueSchema: z.ZodType<JsonValue> = z.json();

/** Read one committed artifact as validated JSON, refusing a non-object root. */
async function readArtifact(root: string, rel: string): Promise<JsonObject> {
  const text = await Deno.readTextFile(join(root, rel));
  const value = decodeJson(JsonValueSchema, text, rel);
  if (!isObject(value)) {
    throw new Error(`${rel}: expected a JSON object at the root`);
  }
  return value;
}

/** Collapse a value onto one line for a table cell. */
function inline(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Shorten prose without leaving a code span open or cutting a word in half. */
export function clip(text: unknown, max = 120): string {
  const flat = inline(text);
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space > max / 2) cut = cut.slice(0, space);
  const ticks = cut.split("`").length - 1;
  if (ticks % 2 === 1) cut = cut.slice(0, cut.lastIndexOf("`")).trimEnd();
  return `${cut}…`;
}

/** Wrap a value in a code span, dropping backticks that would end the span early. */
function code(value: unknown): string {
  return `\`${inline(value).replace(/`/g, "")}\``;
}

/** Render several values as comma-separated code spans. */
function codes(values: readonly unknown[]): string {
  return values.map(code).join(", ");
}

/** Read an all-string JSON array in its recorded order, skipping other members. */
function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.flatMap((member) => typeof member === "string" ? [member] : [])
    : [];
}

/** Read an array of JSON objects, skipping other members. */
function objects(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Walk a key path through nested JSON objects. */
function pathValue(
  value: JsonValue | undefined,
  keys: readonly string[],
): JsonValue | undefined {
  let current = value;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Read a schema node's prose description when it has one. */
function descriptionOf(schema: JsonObject): string {
  return typeof schema.description === "string" ? schema.description : "";
}

/**
 * Append the stability tier to a member's name when the record or schema node
 * carries one below stable. Manifest records carry it as a field and schema
 * nodes as a keyword; the caller passes whichever the artifact uses.
 */
function withStability(
  name: string,
  node: JsonObject,
  marker: string,
): string {
  return isEvolving(node, marker)
    ? `${name} (${STABILITY_TIER_EVOLVING})`
    : name;
}

/** Render a table, escaping pipes in every cell so the tidy parser keeps each row intact. */
function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  const escape = (cell: string): string => cell.replace(/\|/g, "\\|");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
    "",
  ];
}

/**
 * Open one lettered section for a publication: its artifact, what the
 * registry says it promises, and the same-major changes its policy permits.
 * Both sentences come from the registry, so the digest never restates them.
 */
function section(
  letter: string,
  publication: PublicSchemaPublication,
): string[] {
  return [
    "",
    `## ${letter}. ${publication.label} (${
      code(publication.artifactPath)
    }, policy ${code(publication.compatibility)})`,
    "",
    publication.contract,
    "",
    compatibilityContract(publication.compatibility),
    "",
  ];
}

/** Describe one JSON Schema node in a short type token. */
function typeOf(schema: JsonValue | undefined): string {
  if (!isObject(schema)) return "?";
  const ref = schema.$ref;
  if (typeof ref === "string") return `→${ref.replace("#/$defs/", "")}`;
  if (schema.const !== undefined) {
    return `const ${JSON.stringify(schema.const)}`;
  }
  if (Array.isArray(schema.enum)) return "enum";
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) return alternatives.map(typeOf).join(" or ");
  if (Array.isArray(schema.allOf)) return "allOf";
  if (Array.isArray(schema.type)) return schema.type.map(String).join(" or ");
  if (schema.type === "array") return `${typeOf(schema.items)}[]`;
  if (schema.type === "object") {
    return isObject(schema.additionalProperties) && !isObject(schema.properties)
      ? "table"
      : "object";
  }
  return typeof schema.type === "string" ? schema.type : "?";
}

/** List an object schema's keys as rows, descending into nested tables and members. */
function keyRows(
  schema: JsonValue | undefined,
  prefix: string,
  depth: number,
  rows: string[][],
): void {
  if (!isObject(schema)) return;
  const required = strings(schema.required);
  if (isObject(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      if (!isObject(value)) continue;
      const name = prefix === "" ? key : `${prefix}.${key}`;
      rows.push([
        code(name) + (required.includes(key) ? " **(req)**" : ""),
        code(typeOf(value)),
        value.default === undefined ? "" : code(JSON.stringify(value.default)),
        Array.isArray(value.enum) ? codes(value.enum) : "",
        clip(descriptionOf(value), 140),
      ]);
      if (depth > 0) descend(value, name, depth - 1, rows);
    }
  }
  const catchall = schema.additionalProperties;
  if (isObject(catchall) && isObject(catchall.properties)) {
    keyRows(
      catchall,
      prefix === "" ? "<name>" : `${prefix}.<name>`,
      depth,
      rows,
    );
  }
}

/** Descend into the nested object, table, and allOf members of one key. */
function descend(
  value: JsonObject,
  name: string,
  depth: number,
  rows: string[][],
): void {
  keyRows(value, name, depth, rows);
  if (Array.isArray(value.allOf)) {
    for (const part of value.allOf) keyRows(part, name, depth, rows);
  }
}

const KEY_HEADERS = ["Key", "Type", "Default", "Enum", "Description"];

type EnvironmentVariableDefinition =
  (typeof DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS)[
    keyof typeof DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS
  ];

/** Render the CLI grammar manifest: global flags, every command, then each command's arguments. */
function renderCli(
  letter: string,
  publication: PublicSchemaPublication,
  manifest: JsonObject,
): string[] {
  const lines = section(letter, publication);
  const implicit = manifest.implicit_flags;
  if (isObject(implicit)) {
    lines.push(
      `Implicit flags: root ${codes(strings(implicit.root))}; every command ${
        codes(strings(implicit.command))
      }.`,
      "",
    );
  }
  const commands = objects(manifest.commands);
  const root = commands.find((command) => strings(command.path).length === 0);
  if (root !== undefined) {
    lines.push("### Global flags (accepted on every command)", "");
    lines.push(...table(
      ["Flag", "Value", "Default", "Description"],
      objects(root.flags).map((flag) => [
        codes(strings(flag.spellings)),
        flag.type_definition === undefined || flag.type_definition === ""
          ? ""
          : code(flag.type_definition),
        flag.default === null || flag.default === undefined
          ? ""
          : code(JSON.stringify(flag.default)),
        clip(descriptionOf(flag), 140),
      ]),
    ));
  }
  lines.push("### Commands", "");
  lines.push(...table(
    ["Command", "Hidden", "Positional arguments", "Own flags", "Description"],
    commands.map((command) => {
      const path = strings(command.path).join(" ") || "(root)";
      const hiddenWhen = typeof command.hidden_when === "string"
        ? ` (${command.hidden_when})`
        : "";
      const positionals = objects(command.positionals).map((argument) =>
        `<${inline(argument.name)}${argument.variadic === true ? "…" : ""}>${
          argument.optional === true ? "?" : ""
        }`
      ).join(" ");
      const flags = objects(command.flags).filter((flag) =>
        flag.global !== true
      ).map((flag) => strings(flag.spellings).join("/")).join(" ");
      return [
        withStability(code(path), command, MANIFEST_STABILITY_FIELD),
        command.hidden === true ? `yes${hiddenWhen}` : "",
        positionals === "" ? "" : code(positionals),
        clip(flags, 200),
        clip(descriptionOf(command), 110),
      ];
    }),
  ));
  lines.push("### Arguments by command", "");
  for (const command of commands) {
    const own = objects(command.flags).filter((flag) => flag.global !== true);
    const positionals = objects(command.positionals);
    if (own.length === 0 && positionals.length === 0) continue;
    const path = strings(command.path).join(" ") || "(root)";
    lines.push(
      `**${
        withStability(
          code(`discern ${path}`),
          command,
          MANIFEST_STABILITY_FIELD,
        )
      }**`,
      "",
    );
    const rows = positionals.map((argument) => [
      code(`<${inline(argument.name)}>`),
      `positional${argument.variadic === true ? ", repeating" : ""}${
        argument.optional === true ? ", optional" : ", required"
      }`,
      "",
      "",
    ]);
    for (const flag of own) {
      rows.push([
        codes(strings(flag.spellings)),
        flag.type_definition === undefined || flag.type_definition === ""
          ? "boolean"
          : code(flag.type_definition),
        flag.default === null || flag.default === undefined
          ? ""
          : code(JSON.stringify(flag.default)),
        clip(descriptionOf(flag), 160),
      ]);
    }
    lines.push(...table(["Argument", "Value", "Default", "Description"], rows));
  }
  return lines;
}

/** Render the MCP tools manifest: every tool with its annotations, then each tool's inputs. */
function renderMcp(
  letter: string,
  publication: PublicSchemaPublication,
  manifest: JsonObject,
): string[] {
  const lines = section(letter, publication);
  const tools = objects(manifest.tools);
  lines.push(...table(
    ["Tool", "Title", "Annotations", "Inputs"],
    tools.map((tool) => {
      const annotations = isObject(tool.annotations)
        ? codes(
          Object.entries(tool.annotations).filter(([, value]) => value === true)
            .map(([key]) => key.replace("Hint", "")),
        )
        : "";
      const properties = pathValue(tool, ["inputSchema", "properties"]);
      const required = strings(pathValue(tool, ["inputSchema", "required"]));
      const inputs = isObject(properties)
        ? codes(
          Object.entries(properties).map(([key, value]) =>
            `${key}${required.includes(key) ? "*" : ""}:${typeOf(value)}`
          ),
        )
        : "";
      return [
        withStability(code(tool.name), tool, MANIFEST_STABILITY_FIELD),
        clip(tool.title, 60),
        annotations,
        clip(inputs, 220),
      ];
    }),
  ));
  lines.push(
    "`*` marks a required input.",
    "",
    "### Tool inputs in detail",
    "",
  );
  for (const tool of tools) {
    const properties = pathValue(tool, ["inputSchema", "properties"]);
    if (!isObject(properties) || Object.keys(properties).length === 0) continue;
    const required = strings(pathValue(tool, ["inputSchema", "required"]));
    lines.push(
      `**${
        withStability(code(tool.name), tool, MANIFEST_STABILITY_FIELD)
      }** — ${clip(tool.title, 80)}`,
      "",
    );
    lines.push(...table(
      ["Input", "Type", "Required", "Description"],
      Object.entries(properties).map(([key, value]) => [
        code(key),
        code(typeOf(value)),
        required.includes(key) ? "yes" : "",
        clip(isObject(value) ? descriptionOf(value) : "", 170),
      ]),
    ));
  }
  const resources = objects(manifest.resources);
  if (resources.length > 0) {
    lines.push(
      "### Resources and resource templates",
      "",
      "A `template` URI carries a placeholder the client fills in; a `resource` URI is read as written. Names are written plain: a hyphenated `discern-` name in a code span reads as a skill citation to the map preflight.",
      "",
    );
    lines.push(...table(
      ["Resource", "Kind", "URI"],
      resources.map((resource) => [
        inline(resource.name),
        inline(resource.kind),
        code(resource.uri),
      ]),
    ));
  }
  return lines;
}

/** Flatten a `data` union into one line per alternative, bolding required fields. */
function dataBranches(data: JsonValue | undefined): string[] {
  const flatten = (schema: JsonValue | undefined): JsonValue[] => {
    if (!isObject(schema)) return schema === undefined ? [] : [schema];
    const alternatives = schema.anyOf ?? schema.oneOf;
    return Array.isArray(alternatives)
      ? alternatives.flatMap(flatten)
      : [schema];
  };
  const branches = flatten(data).map((alternative) => {
    if (!isObject(alternative)) return String(alternative);
    if (typeof alternative.$ref === "string") return code(typeOf(alternative));
    if (isObject(alternative.properties)) {
      const required = strings(alternative.required);
      return Object.keys(alternative.properties).map((key) =>
        required.includes(key) ? `**${code(key)}**` : code(key)
      ).join(", ");
    }
    return code(typeOf(alternative));
  });
  return branches.length === 0 ? ["(none)"] : branches;
}

/**
 * The one open vocabulary whose members carry a second attribute: the hint
 * registry classes each error slug's recovery, so it renders as its own table
 * instead of one row of members.
 */
const ERROR_SLUG_VOCABULARY =
  "x-discern-error-slugs" satisfies ResultOpenVocabularyKey;

/** Collect the first schema node carrying each vocabulary keyword, walking every object and array. */
export function vocabularyNodes(
  value: JsonValue | undefined,
  found: Map<string, JsonObject> = new Map(),
): Map<string, JsonObject> {
  if (Array.isArray(value)) {
    for (const member of value) vocabularyNodes(member, found);
  } else if (isObject(value)) {
    const key = value[RESULT_VOCABULARY_KEYWORD];
    if (typeof key === "string" && !found.has(key)) found.set(key, value);
    for (const child of Object.values(value)) vocabularyNodes(child, found);
  }
  return found;
}

/**
 * Render the vocabularies one artifact publishes, in registry order: every
 * open vocabulary carried as a member array at the schema root, the error
 * slugs with their recovery class, and every closed vocabulary carried as an
 * `enum` node wherever it sits. With `everyDecision`, the closed table lists
 * the whole decision registry, leaving the members empty for an entry this
 * artifact carries nowhere.
 */
function renderVocabularies(
  schema: JsonObject,
  everyDecision: boolean,
): string[] {
  const lines: string[] = [];
  const openRows = Object.entries(RESULT_OPEN_VOCABULARIES).flatMap((
    [key, vocabulary],
  ) =>
    key === ERROR_SLUG_VOCABULARY || !Array.isArray(schema[key])
      ? []
      : [[code(key), vocabulary.name, codes(strings(schema[key]))]]
  );
  if (openRows.length > 0) {
    lines.push(
      "### Open vocabularies (member arrays at the schema root)",
      "",
      "Each field carrying one is published as `type: string`; the name is its `DiscernKnown<Name>` declaration.",
      "",
    );
    lines.push(...table(["Vocabulary", "Name", "Members"], openRows));
  }
  const slugs = strings(schema[ERROR_SLUG_VOCABULARY]);
  if (slugs.length > 0) {
    const recovery = new Map(Object.entries(ERROR_FAILURE_RECOVERY));
    lines.push(
      `### Error slugs (${code(ERROR_SLUG_VOCABULARY)})`,
      "",
      "The recovery class comes from the hint registry: `evidence` slugs let the generic recovery floor stand when the result carries a message or diagnostic; `tailored` slugs require a narrower registered next step.",
      "",
    );
    lines.push(...table(
      ["Slug", "Recovery class"],
      slugs.map((slug) => [code(slug), recovery.get(slug) ?? ""]),
    ));
  }
  const nodes = vocabularyNodes(schema);
  const closedRows = Object.entries(RESULT_DECISION_VOCABULARIES).flatMap((
    [key, vocabulary],
  ) => {
    const node = nodes.get(key);
    if (node === undefined && !everyDecision) return [];
    return [[
      code(key),
      vocabulary.name,
      node === undefined ? "" : codes(strings(node.enum)),
    ]];
  });
  if (closedRows.length > 0) {
    lines.push(
      "### Closed vocabularies (`enum` nodes)",
      "",
      everyDecision
        ? "Members are read from this artifact; an empty cell means it carries no field of that vocabulary."
        : "Members are read from this artifact's `enum` nodes.",
      "",
    );
    lines.push(...table(["Vocabulary", "Name", "Members"], closedRows));
  }
  return lines;
}

/** Render the results schema: the shared envelope, every verb's data and policy, the shared definitions, and the vocabularies. */
function renderResults(
  letter: string,
  publication: PublicSchemaPublication,
  schema: JsonObject,
): string[] {
  const lines = section(letter, publication);
  const defs = isObject(schema.$defs) ? schema.$defs : {};
  const contracts = objects(schema["x-discern-contracts"]);
  const envelope = pathValue(defs, ["DiscernRootResult", "properties"]);
  if (isObject(envelope)) {
    lines.push("### Envelope fields shared by every result", "");
    const required = strings(
      pathValue(defs, ["DiscernRootResult", "required"]),
    );
    lines.push(...table(
      ["Field", "Type", "Notes"],
      Object.entries(envelope).map(([key, value]) => {
        const items = pathValue(value, ["items", "properties"]);
        const nested = isObject(items)
          ? `items: ${codes(Object.keys(items))}`
          : isObject(value) && isObject(value.properties)
          ? `fields: ${codes(Object.keys(value.properties))}`
          : "";
        return [
          code(key) + (required.includes(key) ? " **(req)**" : ""),
          code(typeOf(value)),
          nested,
        ];
      }),
    ));
  }
  lines.push(
    "### Per-verb `data` shapes",
    "",
    "One row per alternative of the `data` union, usually success first and refusal last. Bold marks a required field; `→Name` points at a shared `$defs` entry.",
    "",
  );
  lines.push(...table(
    ["Verb", "MCP tool", "`data` alternatives"],
    contracts.map((contract) => {
      const definition = typeof contract.schema === "string"
        ? defs[contract.schema.replace("#/$defs/", "")]
        : undefined;
      const branches = dataBranches(
        pathValue(definition, ["properties", "data"]),
      );
      return [
        withStability(code(contract.verb), contract, MANIFEST_STABILITY_FIELD),
        typeof contract.mcp_tool === "string" ? code(contract.mcp_tool) : "",
        branches.map((branch) => clip(branch, 600)).join("<br>— "),
      ];
    }),
  ));
  lines.push(
    "### Completion policies",
    "",
    "A completion policy is the semantic authority for when `ok: true` is allowed: which conditions must hold, which degradations may ride as advisories, and how refusal, cancellation, partial effect, and no-op are reported.",
    "",
  );
  lines.push(...table(
    [
      "Verb",
      "Required conditions",
      "Optional advisories",
      "cancel",
      "partial",
      "`no_op`",
      "recovery",
    ],
    contracts.map((contract) => {
      const policy = isObject(contract.completion_policy)
        ? contract.completion_policy
        : {};
      return [
        withStability(code(contract.verb), contract, MANIFEST_STABILITY_FIELD),
        codes(strings(policy.required_postconditions)),
        clip(codes(strings(policy.optional_advisories)), 160),
        code(policy.cancellation),
        code(policy.partial_effect),
        code(policy.no_op),
        code(policy.recovery_owner),
      ];
    }),
  ));
  lines.push("### Shared `$defs`", "");
  lines.push(...table(
    ["Definition", "Fields"],
    Object.entries(defs).filter(([name]) => !name.endsWith("Result")).map((
      [name, definition],
    ) => [
      code(name),
      clip(
        isObject(definition) && isObject(definition.properties)
          ? codes(Object.keys(definition.properties))
          : code(typeOf(definition)),
        260,
      ),
    ]),
  ));
  lines.push(...renderVocabularies(schema, true));
  return lines;
}

/** Render a configuration schema: its sections, then every key with type, default, and enum. */
function renderConfig(
  letter: string,
  publication: PublicSchemaPublication,
  schema: JsonObject,
): string[] {
  const lines = section(letter, publication);
  const sections = isObject(schema.properties) ? schema.properties : {};
  const required = strings(schema.required);
  const sectionName = (name: string, value: JsonValue): string =>
    isObject(value)
      ? withStability(code(`[${name}]`), value, PUBLIC_SCHEMA_STABILITY_KEY)
      : code(`[${name}]`);
  lines.push(...table(
    ["Section", "Required", "Kind", "Description"],
    Object.entries(sections).map(([name, value]) => [
      sectionName(name, value),
      required.includes(name) ? "yes" : "",
      code(typeOf(value)),
      clip(isObject(value) ? descriptionOf(value) : "", 150),
    ]),
  ));
  for (const [name, value] of Object.entries(sections)) {
    if (!isObject(value)) continue;
    const rows: string[][] = [];
    if (Array.isArray(value.allOf)) {
      for (const part of value.allOf) {
        keyRows(part, "", 1, rows);
        const custom = isObject(part) ? part.additionalProperties : undefined;
        if (isObject(custom) && !isObject(custom.properties)) {
          rows.push([
            code("<name>"),
            "table",
            "",
            "",
            "A custom table under this section; its accepted keys follow the schema's `allOf` members.",
          ]);
        }
      }
    } else {
      keyRows(value, "", 2, rows);
    }
    if (rows.length === 0) continue;
    lines.push(
      `### ${withStability(`[${name}]`, value, PUBLIC_SCHEMA_STABILITY_KEY)}`,
      "",
    );
    lines.push(...table(KEY_HEADERS, rows));
  }
  return lines;
}

/** Render a flat key-value table from nested convention objects. */
function flatRows(value: JsonValue, prefix: string, rows: string[][]): void {
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatRows(child, prefix === "" ? key : `${prefix}.${key}`, rows);
    }
    return;
  }
  rows.push([code(prefix), value === true ? "" : code(JSON.stringify(value))]);
}

/** Render the conventions manifest: registries of names and values, joined with their source policies. */
function renderConventions(
  letter: string,
  publication: PublicSchemaPublication,
  manifest: JsonObject,
): string[] {
  const lines = section(letter, publication);
  const definitions = new Map<string, EnvironmentVariableDefinition>(
    Object.values(DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS).map((
      definition,
    ) => [definition.name, definition]),
  );
  const handled = new Set([
    "$id",
    "format",
    "x-discern-compatibility-policy",
    "environment_variables",
    "providers",
    "git_admin_state",
    "local_formats",
  ]);
  if (isObject(manifest.environment_variables)) {
    lines.push("### Environment variables", "");
    lines.push(...table(
      ["Variable", "Group", "Visibility", "Meaning"],
      Object.keys(manifest.environment_variables).map((name) => {
        const definition = definitions.get(name);
        const documentation = definition?.documentation;
        return [
          code(name),
          definition?.group ?? "",
          documentation === undefined
            ? ""
            : documentation.public
            ? "public"
            : "**internal**",
          clip(
            documentation === undefined
              ? ""
              : documentation.public
              ? documentation.description
              : documentation.reason,
            130,
          ),
        ];
      }),
    ));
  }
  if (isObject(manifest.providers)) {
    lines.push("### Providers", "");
    lines.push(...table(
      [
        "Provider",
        "Instruction file",
        "Skills dir",
        "MCP file",
        "Hooks file",
        "Hook events",
        "Other",
      ],
      Object.entries(manifest.providers).map(([name, value]) => {
        const provider = isObject(value) ? value : {};
        const events = isObject(provider.hook_events)
          ? Object.entries(provider.hook_events).map(([event, kind]) =>
            `${event}→${inline(kind)}`
          ).join(", ")
          : "";
        const localState = isObject(provider.local_state_files)
          ? Object.keys(provider.local_state_files)
          : [];
        const other = [
          typeof provider.worktree_app_file === "string"
            ? `worktree app: ${provider.worktree_app_file}`
            : "",
          typeof provider.project_rules_file === "string"
            ? `rules: ${provider.project_rules_file}`
            : "",
          localState.length > 0 ? `local: ${localState.join(", ")}` : "",
        ].filter((entry) => entry !== "").join("; ");
        const file = (key: string): string =>
          typeof provider[key] === "string" ? code(provider[key]) : "";
        return [
          code(name),
          file("instruction_file"),
          file("skills_directory"),
          file("mcp_file"),
          file("hooks_file"),
          events,
          other,
        ];
      }),
    ));
  }
  if (isObject(manifest.git_admin_state)) {
    lines.push("### Git-administration state (paths under `.git/`)", "");
    lines.push(`Namespace: ${code(manifest.git_admin_state.namespace)}`, "");
    const entries = isObject(manifest.git_admin_state.entries)
      ? manifest.git_admin_state.entries
      : {};
    lines.push(...table(
      ["Id", "Path", "Scope", "Kind", "Validated"],
      Object.entries(entries).map(([id, value]) => {
        const entry = isObject(value) ? value : {};
        return [
          code(id),
          code(entry.path),
          inline(entry.scope),
          inline(entry.kind),
          entry.validation === true ? "yes" : "",
        ];
      }),
    ));
  }
  if (isObject(manifest.local_formats)) {
    lines.push(
      "### Local formats (identities only; private versions are not published)",
      "",
    );
    lines.push(...table(
      [
        "Format id",
        "Version field",
        "Newer-version policy",
        "Location",
        "Published version",
      ],
      Object.entries(manifest.local_formats).map(([id, value]) => {
        const format = isObject(value) ? value : {};
        const location = isObject(format.location) ? format.location : {};
        const where = location.kind === "git-note"
          ? `git-note ${inline(location.ref)}`
          : `git-admin ${strings(location.keys).join(", ")}`;
        return [
          code(id),
          code(format.version_field),
          inline(format.newer_version_policy),
          where,
          format.version === undefined ? "" : inline(format.version),
        ];
      }),
    ));
  }
  for (const [key, value] of Object.entries(manifest)) {
    if (handled.has(key)) continue;
    const rows: string[][] = [];
    flatRows(value, "", rows);
    lines.push(`### ${code(key)}`, "");
    lines.push(...table(["Convention", "Value"], rows));
  }
  return lines;
}

/** Render any other schema publication generically: root keys, alternatives, definitions, vocabularies, and extensions. */
function renderDefinitions(
  letter: string,
  publication: PublicSchemaPublication,
  schema: JsonObject,
): string[] {
  const lines = section(letter, publication);
  const rootRows: string[][] = [];
  keyRows(schema, "", 0, rootRows);
  if (rootRows.length > 0) {
    lines.push("**Root**", "", ...table(KEY_HEADERS, rootRows));
  }
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((alternative, index) => {
      const rows: string[][] = [];
      keyRows(alternative, "", 1, rows);
      lines.push(
        `**Alternative ${index + 1}**`,
        "",
        ...table(KEY_HEADERS, rows),
      );
    });
  }
  const defs = isObject(schema.$defs) ? schema.$defs : {};
  for (const [name, definition] of Object.entries(defs)) {
    const rows: string[][] = [];
    keyRows(definition, "", 0, rows);
    lines.push(`**${code(name)}**`, "", ...table(KEY_HEADERS, rows));
  }
  lines.push(...renderVocabularies(schema, false));
  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith("x-discern-") && typeof value === "string") {
      lines.push(`${code(key)}: <${value}>`, "");
    }
  }
  return lines;
}

/** Render the exit-status registry, which the manual documents but no artifact carries. */
function renderExitStatuses(letter: string): string[] {
  return [
    "",
    `## ${letter}. CLI exit statuses (registry ${
      code("src/shared/exit_codes.ts")
    }; documented in the manual, not in a schema artifact)`,
    "",
    ...table(
      ["Status", "Contract"],
      EXIT_STATUS_REGISTRY.map((
        entry,
      ) => [entry.label, clip(entry.contract, 200)]),
    ),
  ];
}

/** Select the renderer that knows one artifact's shape, falling back to the generic definitions dump. */
function renderPublication(
  letter: string,
  publication: PublicSchemaPublication,
  artifact: JsonObject,
): string[] {
  switch (publication.artifactPath) {
    case "schema/discern-cli.json":
      return renderCli(letter, publication, artifact);
    case "schema/discern-mcp-tools.json":
      return renderMcp(letter, publication, artifact);
    case "schema/discern-results.schema.json":
      return renderResults(letter, publication, artifact);
    case "schema/discern-config.schema.json":
    case "schema/discern-setup-config.schema.json":
      return renderConfig(letter, publication, artifact);
    case "schema/discern-conventions.json":
      return renderConventions(letter, publication, artifact);
    default:
      return renderDefinitions(letter, publication, artifact);
  }
}

/** Order publications for reading, appending any the reading order does not name. */
function orderedPublications(): PublicSchemaPublication[] {
  const named = READING_ORDER.flatMap((path) =>
    PUBLIC_SCHEMA_PUBLICATIONS.filter((publication) =>
      publication.artifactPath === path
    )
  );
  const rest = PUBLIC_SCHEMA_PUBLICATIONS.filter((publication) =>
    !READING_ORDER.includes(publication.artifactPath)
  );
  return [...named, ...rest];
}

/** Render the complete digest page from the artifacts under `root`, formatted for tidy stability. */
export async function renderContractDigestDoc(root: string): Promise<string> {
  const lines: string[] = [
    POLICY.banner,
    "",
    `# ${POLICY.title}`,
    "",
    `_${POLICY.subtitle}_`,
    "",
    ...POLICY.framing.flatMap((paragraph) => [paragraph, ""]),
  ];
  const publications = orderedPublications();
  for (const [index, publication] of publications.entries()) {
    const artifact = await readArtifact(root, publication.artifactPath);
    lines.push(
      ...renderPublication(
        String.fromCharCode(65 + index),
        publication,
        artifact,
      ),
    );
  }
  lines.push(
    ...renderExitStatuses(String.fromCharCode(65 + publications.length)),
  );
  return await formatMarkdownText(
    "contract-digest.md",
    `${lines.join("\n")}\n`,
  );
}

if (import.meta.main) {
  const root = dirname(dirname(fromFileUrl(import.meta.url)));
  console.log(await renderContractDigestDoc(root));
}
