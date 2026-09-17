import {
  EmergencyNoteEnvelopeSchema,
  EmergencyNotePayloadSchema,
} from "./emergency_note.ts";
import {
  EMERGENCY_NOTE_ENVELOPE_DEFINITION,
  EMERGENCY_NOTE_PAYLOAD_DEFINITION,
} from "./public_schemas.ts";
/**
 * Generators for the public JSON result contract artifacts.
 *
 * The runtime source is the Zod result schema registry (`result_contracts.ts`).
 * Codegen publishes two deterministic artifacts from it:
 *
 * - `schema/discern-results.schema.json` for language-neutral validation.
 * - `types/discern-json.d.ts` for TypeScript consumers.
 */

import { z } from "@zod/zod";
import {
  CLI_JSON_RESULT_CONTRACTS,
  MCP_RESULT_CONTRACTS,
  RESULT_CONTRACT_REFERENCE_FIELDS,
  type ResultContract,
} from "./result_contracts.ts";
import {
  MANIFEST_STABILITY_FIELD,
  PROOF_NOTE_DSSE_ENVELOPE,
  PROOF_NOTE_DSSE_PROTOCOL,
  PROOF_NOTE_PAYLOAD_DEFINITION,
  PROOF_NOTE_PAYLOAD_TYPE,
  PROOF_NOTE_SCHEMA_ID,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  PUBLIC_SCHEMA_STABILITY_KEY,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
  RESULT_SCHEMA_ID,
} from "./public_schemas.ts";
import {
  EnvelopeStateSchema,
  ProofNotePayloadSchema,
  ProofNoteSchema,
} from "./result_schemas.ts";
import { ERROR_SLUGS } from "./result.ts";
import { RESULT_COMPLETION_POLICIES } from "./result_completion.ts";
import { PROOF_NOTES_REF } from "./git_conventions.ts";

const SCHEMA_TITLE = "discern CLI and MCP JSON results";

const GENERATED_BANNER =
  "Generated from the result contract registry. Regenerate rather than edit.";

const FORMAT_WIDTH = 80;

const RESULT_STATE_DEFINITION = "DiscernResultState";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

/** Narrow a JSON value to a non-null, non-array object. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert one Zod schema to its JSON-schema body. Sub-schemas registered with
 * a metadata `id` (the named definitions, e.g. the proof) convert to
 * root-relative `$refs` with their definition beside the body — `hoisted`
 * collects those definitions so the caller can place them in the document's
 * root `$defs`, where the generated references point. Identical repeats
 * coalesce; two different definitions under one name refuse loudly.
 */
function generatedSchema(schema: z.ZodType, hoisted: JsonObject): JsonObject {
  const raw = z.toJSONSchema(schema, { io: "output" }) as JsonObject;
  const { $schema: _schema, $defs, ...body } = raw;
  if (isObject($defs)) {
    for (const [name, def] of Object.entries($defs)) {
      const existing = hoisted[name];
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(def)
      ) {
        throw new Error(
          `two schemas hoist different definitions named ${name}`,
        );
      }
      hoisted[name] = def;
    }
  }
  return body;
}

/** Turn camel-cased or punctuated contract IDs into PascalCase segments. */
function pascalCase(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
}

/** Derive the exported CLI result type name for a registered contract. */
function typeName(contract: ResultContract): string {
  return `Discern${pascalCase(contract.id)}Result`;
}

/** Derive the exported MCP wrapper type name for a registered contract. */
function mcpTypeName(contract: ResultContract): string {
  return `Discern${pascalCase(contract.id)}McpToolResult`;
}

/** The stability keyword a contract's generated definitions carry, if any. */
function definitionStability(contract: ResultContract): JsonObject {
  return contract.stability === undefined
    ? {}
    : { [PUBLIC_SCHEMA_STABILITY_KEY]: contract.stability };
}

/** The stability field a contract's metadata record carries, if any. */
function recordStability(contract: ResultContract): JsonObject {
  return contract.stability === undefined
    ? {}
    : { [MANIFEST_STABILITY_FIELD]: contract.stability };
}

/** Point a JSON Schema reference at a named root definition. */
function refFor(name: string): JsonObject {
  return { $ref: `#/$defs/${name}` };
}

/** Describe the MCP text-content envelope around a structured result contract. */
function mcpToolResultSchema(structuredContentRef: JsonObject): JsonObject {
  return {
    type: "object",
    properties: {
      content: {
        description:
          "One authored Markdown presentation that is sufficient without structuredContent.",
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { const: "text" },
            text: {
              type: "string",
              description:
                "The contract-authored Markdown projection of the prepared DiscernResult.",
            },
          },
          required: ["type", "text"],
          additionalProperties: false,
        },
      },
      structuredContent: {
        ...structuredContentRef,
        description:
          "The compact structured projection, sufficient without text content.",
      },
      isError: { type: "boolean" },
    },
    required: ["content", "structuredContent", "isError"],
    additionalProperties: false,
  };
}

/** Relax a strict runtime schema to the additive compatibility policy we publish. */
function publicSchema(schema: JsonObject): JsonObject {
  const rewritten = rewritePublicOutput(schema);
  return isObject(rewritten) ? rewritten : schema;
}

/** Recognize the runtime's closed error-slug enum by ordered canonical membership. */
function isErrorSlugEnum(value: JsonObject): boolean {
  return Array.isArray(value.enum) &&
    value.enum.length === ERROR_SLUGS.length &&
    value.enum.every((member, index) => member === ERROR_SLUGS[index]);
}

/** Recursively permit additive fields and future error slugs in public output. */
export function rewritePublicOutput(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(rewritePublicOutput);
  }
  if (!isObject(value)) {
    return value;
  }
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "additionalProperties" && child === false) {
      continue;
    }
    if (key === "error" && isObject(child) && isErrorSlugEnum(child)) {
      out[key] = { type: "string" };
      continue;
    }
    out[key] = rewritePublicOutput(child);
  }
  if (Array.isArray(out.prefixItems)) {
    const tupleLength = out.prefixItems.length;
    out.minItems ??= tupleLength;
    out.maxItems ??= tupleLength;
    out.items ??= false;
  }
  return out;
}

/** Describe every CLI result as the registered union of contract definitions. */
function cliUnionSchema(): JsonObject {
  return {
    title: "DiscernCliJsonResult",
    description:
      "Any `discern <command> --json` result. Consumers with a known verb should prefer the per-verb schema referenced by x-discern-contracts for clearer validation errors.",
    oneOf: CLI_JSON_RESULT_CONTRACTS.map((contract) =>
      refFor(typeName(contract))
    ),
  };
}

/** Describe every MCP result wrapper as a union of registered tool contracts. */
function mcpUnionSchema(): JsonObject {
  return {
    title: "DiscernMcpJsonResult",
    description:
      "Any MCP tool result object returned by discern's MCP server. Its structuredContent is the same DiscernResult envelope exposed by the corresponding CLI command; content carries an independently sufficient authored Markdown projection.",
    oneOf: MCP_RESULT_CONTRACTS.map((contract) =>
      refFor(mcpTypeName(contract))
    ),
  };
}

/** Publish the exact completion contract beside one generated result schema. */
function completionPolicyMetadata(contract: ResultContract): JsonObject {
  const policy = RESULT_COMPLETION_POLICIES[contract.verb];
  if (policy === undefined) {
    throw new Error(
      `result contract '${contract.id}' has no completion policy for '${contract.verb}'`,
    );
  }
  return {
    required_postconditions: [...policy.requiredPostconditions],
    optional_advisories: [...policy.optionalAdvisories],
    refusal: policy.refusal,
    cancellation: policy.cancellation,
    partial_effect: policy.partialEffect,
    no_op: policy.noOp,
    recovery_owner: policy.recoveryOwner,
  };
}

/** Fold hoisted named definitions into a document's root `$defs`, titled like
 * every other definition. A name already taken by a contract refuses loudly. */
function placeHoistedDefs(defs: JsonObject, hoisted: JsonObject): void {
  for (const [name, def] of Object.entries(hoisted)) {
    if (defs[name] !== undefined) {
      throw new Error(
        `hoisted definition ${name} collides with an existing definition`,
      );
    }
    defs[name] = { title: name, ...(isObject(def) ? def : {}) };
  }
}

/** Replace a contract's repeated state constraint with the shared definition. */
function referenceResultState(
  schema: JsonObject,
  resultState: JsonObject,
): JsonObject {
  if (
    !Array.isArray(schema.allOf) ||
    !Array.isArray(resultState.allOf) ||
    JSON.stringify(schema.allOf) !== JSON.stringify(resultState.allOf)
  ) {
    throw new Error(
      "result contract must carry the canonical envelope state constraint",
    );
  }
  return { ...schema, allOf: [refFor(RESULT_STATE_DEFINITION)] };
}

/** Compile the result registry into the published draft-2020-12 schema document. */
export function buildResultJsonSchema(): JsonObject {
  const defs: JsonObject = {};
  const hoisted: JsonObject = {};
  const resultState = generatedSchema(EnvelopeStateSchema, hoisted);
  defs[RESULT_STATE_DEFINITION] = {
    title: RESULT_STATE_DEFINITION,
    ...resultState,
  };
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const name = typeName(contract);
    defs[name] = {
      title: name,
      ...definitionStability(contract),
      ...referenceResultState(
        generatedSchema(contract.schema, hoisted),
        resultState,
      ),
    };
  }
  placeHoistedDefs(defs, hoisted);
  for (const contract of MCP_RESULT_CONTRACTS) {
    defs[mcpTypeName(contract)] = {
      title: mcpTypeName(contract),
      ...definitionStability(contract),
      ...mcpToolResultSchema(refFor(typeName(contract))),
    };
  }
  defs.DiscernCliJsonResult = cliUnionSchema();
  defs.DiscernMcpJsonResult = mcpUnionSchema();
  return publicSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: RESULT_SCHEMA_ID,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]:
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    title: SCHEMA_TITLE,
    description:
      "The public JSON contract for discern CLI --json results and MCP tool results. Runtime schemas remain strict, but this published schema intentionally permits additive object fields so older pinned schemas can validate newer compatible output.",
    oneOf: [
      refFor("DiscernCliJsonResult"),
      refFor("DiscernMcpJsonResult"),
    ],
    $defs: defs,
    "x-discern-contracts": CLI_JSON_RESULT_CONTRACTS.map((contract) => ({
      id: contract.id,
      verb: contract.verb,
      commands: [...contract.commands],
      ...(contract.mcpTool === undefined ? {} : { mcp_tool: contract.mcpTool }),
      ...recordStability(contract),
      completion_policy: completionPolicyMetadata(contract),
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: `#/$defs/${typeName(contract)}`,
      ...(contract.mcpTool === undefined ? {} : {
        [RESULT_CONTRACT_REFERENCE_FIELDS.mcp]: `#/$defs/${
          mcpTypeName(contract)
        }`,
      }),
    })),
    "x-discern-error-slugs": [...ERROR_SLUGS],
  }) as JsonObject;
}

/** Serialize the published result schema with stable indentation and a final newline. */
export function renderResultJsonSchema(): string {
  return `${JSON.stringify(buildResultJsonSchema(), null, 2)}\n`;
}

/**
 * The durable proof note's published contract: a DSSE-compatible envelope
 * plus the decoded JSON payload definition its `payloadType` identifies.
 * Runtime writers stay strict while this publication permits additive object
 * fields, matching the tolerant durable reader.
 */
export function buildProofNoteJsonSchema(): JsonObject {
  const hoisted: JsonObject = {};
  const body = generatedSchema(ProofNoteSchema, hoisted);
  const payloadBody = generatedSchema(ProofNotePayloadSchema, hoisted);
  const emergencyPayload = generatedSchema(EmergencyNotePayloadSchema, hoisted);
  const emergencyEnvelope = generatedSchema(
    EmergencyNoteEnvelopeSchema,
    hoisted,
  );
  const defs: JsonObject = {};
  placeHoistedDefs(defs, hoisted);
  defs[EMERGENCY_NOTE_PAYLOAD_DEFINITION] = {
    title: EMERGENCY_NOTE_PAYLOAD_DEFINITION,
    ...emergencyPayload,
  };
  defs[EMERGENCY_NOTE_ENVELOPE_DEFINITION] = {
    title: EMERGENCY_NOTE_ENVELOPE_DEFINITION,
    ...emergencyEnvelope,
  };
  defs[PROOF_NOTE_PAYLOAD_DEFINITION] = {
    title: PROOF_NOTE_PAYLOAD_DEFINITION,
    ...payloadBody,
  };
  const properties = body.properties;
  if (!isObject(properties) || !isObject(properties.payload)) {
    throw new Error("Proof note schema must declare its encoded payload");
  }
  const annotatedBody: JsonObject = {
    ...body,
    properties: {
      ...properties,
      payload: {
        ...properties.payload,
        contentEncoding: "base64",
        contentMediaType: "application/json",
        contentSchema: refFor(PROOF_NOTE_PAYLOAD_DEFINITION),
      },
    },
  };
  return publicSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: PROOF_NOTE_SCHEMA_ID,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]:
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    title: "DiscernProofNoteEnvelope",
    description:
      "The discern Proof envelope follows the Dead Simple Signing Envelope " +
      "(DSSE) field and payload boundary. discern attaches it to a landed " +
      `commit as a Git note under ${PROOF_NOTES_REF}. The note body is this object as ` +
      "one line of JSON plus a newline. Decode payload from Base64 and keep " +
      "those bytes unchanged: a DSSE v1 signature is over PAE(UTF8(payloadType), " +
      "payload bytes). No other envelope field enters that signature input. " +
      "payloadType points to the payload definition in this schema. " +
      "Standard signed DSSE envelopes carry at least one signature; discern's " +
      "unsigned extension carries an empty signatures array. keyid is an " +
      "unauthenticated lookup hint; a signing profile and trust policy decide " +
      "the algorithm, verification key, and identity.",
    "x-discern-payload-type": PROOF_NOTE_PAYLOAD_TYPE,
    "x-discern-dsse-envelope": PROOF_NOTE_DSSE_ENVELOPE,
    "x-discern-dsse-protocol": PROOF_NOTE_DSSE_PROTOCOL,
    ...annotatedBody,
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
  }) as JsonObject;
}

/** Serialize the proof-envelope schema with stable indentation and a final newline. */
export function renderProofNoteJsonSchema(): string {
  return `${JSON.stringify(buildProofNoteJsonSchema(), null, 2)}\n`;
}

/** Serialize a JSON value into the equivalent TypeScript literal spelling. */
function literal(value: JsonValue): string {
  return JSON.stringify(value);
}

/** Convert a local `$defs` reference into its generated type name. */
function refTypeName(ref: string): string {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) {
    return "unknown";
  }
  return ref.slice(prefix.length);
}

/** Emit a bare TypeScript property identifier when safe, otherwise a string literal. */
function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : literal(name);
}

/** Deduplicate union members and handle the empty and singleton cases. */
function union(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (unique.length === 0) {
    return "never";
  }
  if (unique.length === 1) {
    return unique[0] ?? "never";
  }
  return unique.join(" | ");
}

/** Combine JSON Schema `allOf` members as a TypeScript intersection. */
function intersection(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (unique.length === 0) {
    return "unknown";
  }
  if (unique.length === 1) {
    return unique[0] ?? "unknown";
  }
  const expressions = unique.map((part) =>
    part.includes("\n} | {") ? `(${part})` : part
  );
  const [first, second] = expressions;
  if (
    expressions.length === 2 && first !== undefined && second !== undefined &&
    !first.includes("\n")
  ) {
    const [secondFirst = "unknown", ...secondRest] = second.split("\n");
    return [`${first} & ${secondFirst}`, ...secondRest].join("\n");
  }
  return expressions.map((expression) => {
    const [first = "unknown", ...rest] = expression.split("\n");
    return [`& ${first}`, ...rest].join("\n");
  }).join("\n");
}

/** Whether a schema node contributes a type beyond annotation metadata. */
function hasTypeConstraint(schema: JsonObject): boolean {
  return Object.keys(schema).some((key) =>
    !["title", "description", "default", "examples"].includes(key)
  );
}

/** Split a one-line union when it can be wrapped member by member. */
function unionParts(type: string): string[] | undefined {
  if (type.includes("\n") || !type.includes(" | ")) {
    return undefined;
  }
  return type.split(" | ");
}

/** Format one object property, wrapping long unions beneath its declaration. */
function renderProperty(
  name: string,
  optional: string,
  type: string,
  level: number,
): string {
  const indent = " ".repeat(level);
  const prefix = `${indent}${propertyName(name)}${optional}: `;
  const parts = unionParts(type);
  if (parts !== undefined && prefix.length + type.length + 1 > FORMAT_WIDTH) {
    return [
      `${indent}${propertyName(name)}${optional}:`,
      ...parts.map((part, index) =>
        `${indent}  | ${part}${index === parts.length - 1 ? ";" : ""}`
      ),
    ].join("\n");
  }
  return `${prefix}${type};`;
}

/** Translate JSON Schema primitive type keywords into TypeScript primitives. */
function typeFromTypeKeyword(type: JsonValue): string | undefined {
  if (typeof type === "string") {
    switch (type) {
      case "boolean":
      case "number":
      case "string":
        return type;
      case "integer":
        return "number";
      case "null":
        return "null";
      case "object":
      case "array":
        return undefined;
    }
  }
  if (Array.isArray(type)) {
    return union(
      type
        .map(typeFromTypeKeyword)
        .filter((part): part is string => part !== undefined),
    );
  }
  return undefined;
}

/** Render declared properties and an optional index signature as an object type. */
function objectType(schema: JsonObject, level: number): string {
  const props = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string =>
        typeof value === "string"
      )
      : [],
  );
  const lines: string[] = ["{"];
  for (const [name, prop] of Object.entries(props)) {
    if (!isObject(prop)) {
      continue;
    }
    const optional = required.has(name) ? "" : "?";
    lines.push(renderProperty(
      name,
      optional,
      schemaToType(prop, level + 2),
      level + 2,
    ));
  }
  if (isObject(schema.additionalProperties)) {
    lines.push(
      `${" ".repeat(level + 2)}[key: string]: ${
        schemaToType(schema.additionalProperties, level + 2)
      };`,
    );
  }
  lines.push(`${" ".repeat(level)}}`);
  return lines.join("\n");
}

/** Wrap an array item union the same way `deno fmt` does. */
function arrayType(schema: JsonObject, level: number): string {
  const isUnion = Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf);
  const itemType = schemaToType(schema, isUnion ? level + 2 : level);
  if (!isUnion || !itemType.includes("\n")) {
    return `Array<${itemType}>`;
  }
  return [
    "Array<",
    `${" ".repeat(level + 2)}${itemType}`,
    `${" ".repeat(level)}>`,
  ].join("\n");
}

/** Recursively translate the supported JSON Schema vocabulary into TypeScript. */
function schemaToType(schema: JsonObject, level = 0): string {
  if (Array.isArray(schema.allOf)) {
    const { allOf: _allOf, ...own } = schema;
    return intersection([
      ...schema.allOf
        .filter(isObject)
        .map((part) => schemaToType(part, level)),
      ...(hasTypeConstraint(own) ? [schemaToType(own, level)] : []),
    ]);
  }
  if (typeof schema.$ref === "string") {
    return refTypeName(schema.$ref);
  }
  if (isObject(schema.not) && Object.keys(schema.not).length === 0) {
    return "never";
  }
  if (Object.hasOwn(schema, "const")) {
    return literal(schema.const as JsonValue);
  }
  if (Array.isArray(schema.enum)) {
    return union(schema.enum.map(literal));
  }
  if (Array.isArray(schema.oneOf)) {
    return union(
      schema.oneOf
        .filter(isObject)
        .map((part) => schemaToType(part, level)),
    );
  }
  if (Array.isArray(schema.anyOf)) {
    return union(
      schema.anyOf
        .filter(isObject)
        .map((part) => schemaToType(part, level)),
    );
  }
  if (schema.type === "array" && isObject(schema.items)) {
    return arrayType(schema.items, level);
  }
  if (schema.type !== undefined) {
    const primitive = typeFromTypeKeyword(schema.type);
    if (primitive !== undefined) {
      return primitive;
    }
  }
  if (schema.type === "object" || isObject(schema.properties)) {
    return objectType(schema, level);
  }
  if (isObject(schema.additionalProperties)) {
    return `{ [key: string]: ${
      schemaToType(schema.additionalProperties, level)
    } }`;
  }
  return "unknown";
}

/** Render one formatter-stable interface row, including long generic values. */
function mapInterfaceRow(key: string, value: string): string {
  const property = propertyName(key);
  const line = `  ${property}: ${value};`;
  if (line.length <= FORMAT_WIDTH) return line;

  const genericOpen = value.indexOf("<");
  if (genericOpen < 1 || !value.endsWith(">")) return line;
  return [
    `  ${property}: ${value.slice(0, genericOpen + 1)}`,
    `    ${value.slice(genericOpen + 1, -1)}`,
    "  >;",
  ].join("\n");
}

/** Render an interface whose rows map literal keys to generated result types. */
function mapInterface(
  name: string,
  rows: Array<[string, string]>,
): string {
  return [
    `export interface ${name} {`,
    ...rows.map(([key, value]) => mapInterfaceRow(key, value)),
    "}",
  ].join("\n");
}

/** Keep a union alias on one line when it fits, or put each member on its own line. */
function renderUnionTypeAlias(name: string, parts: string[]): string {
  const type = union(parts);
  const line = `export type ${name} = ${type};`;
  if (line.length <= FORMAT_WIDTH) {
    return line;
  }
  return [
    `export type ${name} =`,
    ...parts.map((part, index) =>
      `  | ${part}${index === parts.length - 1 ? ";" : ""}`
    ),
  ].join("\n");
}

/** Wrap a generic alias's inner type when the declaration exceeds the width budget. */
function renderGenericTypeAlias(
  name: string,
  genericName: string,
  innerType: string,
): string {
  const line = `export type ${name} = ${genericName}<${innerType}>;`;
  if (line.length <= FORMAT_WIDTH) {
    return line;
  }
  return `export type ${name} = ${genericName}<\n  ${innerType}\n>;`;
}

/** The declaration comment an evolving contract's aliases carry. */
const EVOLVING_DECLARATION_COMMENT =
  "/** Evolving: this result shape may change in any release. */";

/** Prefix a declaration with the evolving comment when its contract carries the tier. */
function withStabilityComment(
  contract: ResultContract,
  declaration: string,
): string {
  return contract.stability === undefined
    ? declaration
    : `${EVOLVING_DECLARATION_COMMENT}\n${declaration}`;
}

/** Render a schema-derived alias, including formatter-stable intersections. */
function renderSchemaTypeAlias(name: string, type: string): string {
  if (!type.startsWith("& ")) {
    return `export type ${name} = ${type};`;
  }
  return [
    `export type ${name} =`,
    ...type.split("\n").map((line) => `  ${line}`),
  ].join("\n") + ";";
}

/** Generate the complete public declaration file from the result contract registry. */
export function renderResultTypesDts(): string {
  const schema = buildResultJsonSchema();
  const defs = isObject(schema.$defs) ? schema.$defs : {};
  const out: string[] = [
    `// ${GENERATED_BANNER}`,
    "",
    renderUnionTypeAlias(
      "DiscernKnownErrorSlug",
      ERROR_SLUGS.map((slug) => literal(slug)),
    ),
    "",
  ];
  // The named definitions the contracts reference (hoisted from metadata ids)
  // render first, so every later `$ref` resolves to an exported type.
  const contractNames = new Set([
    ...CLI_JSON_RESULT_CONTRACTS.map(typeName),
    ...MCP_RESULT_CONTRACTS.map(mcpTypeName),
    "DiscernCliJsonResult",
    "DiscernMcpJsonResult",
  ]);
  for (const [name, def] of Object.entries(defs)) {
    if (!contractNames.has(name) && isObject(def)) {
      out.push(renderSchemaTypeAlias(name, schemaToType(def)), "");
    }
  }
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const name = typeName(contract);
    const def = defs[name];
    if (isObject(def)) {
      out.push(
        withStabilityComment(
          contract,
          renderSchemaTypeAlias(name, schemaToType(def)),
        ),
        "",
      );
    }
  }
  out.push(
    renderUnionTypeAlias(
      "DiscernCliJsonResult",
      CLI_JSON_RESULT_CONTRACTS.map(typeName),
    ),
    "",
    mapInterface(
      "DiscernResultByVerb",
      CLI_JSON_RESULT_CONTRACTS.map((contract) => [
        contract.verb,
        typeName(contract),
      ]),
    ),
    "",
    mapInterface(
      "DiscernResultByCommand",
      CLI_JSON_RESULT_CONTRACTS.flatMap((contract) =>
        contract.commands.map((command): [string, string] => [
          command,
          typeName(contract),
        ])
      ),
    ),
    "",
    "export interface DiscernMcpTextContent {",
    '  type: "text";',
    "  /** An independently sufficient, contract-authored Markdown projection. */",
    "  text: string;",
    "}",
    "",
    "export interface DiscernMcpToolResult<TStructuredContent> {",
    "  /** Authored Markdown for text-only and model-facing hosts. */",
    "  content: DiscernMcpTextContent[];",
    "  /** Compact structured data for structured-first hosts and integrations. */",
    "  structuredContent: TStructuredContent;",
    "  isError: boolean;",
    "}",
    "",
    mapInterface(
      "DiscernMcpStructuredContentByTool",
      MCP_RESULT_CONTRACTS.map((contract) => [
        contract.mcpTool,
        typeName(contract),
      ]),
    ),
    "",
    mapInterface(
      "DiscernMcpToolResultByTool",
      MCP_RESULT_CONTRACTS.map((contract) => [
        contract.mcpTool,
        `DiscernMcpToolResult<${typeName(contract)}>`,
      ]),
    ),
    "",
    renderUnionTypeAlias(
      "DiscernMcpStructuredContent",
      MCP_RESULT_CONTRACTS.map(typeName),
    ),
    "",
    renderUnionTypeAlias(
      "DiscernMcpJsonResult",
      MCP_RESULT_CONTRACTS.map(mcpTypeName),
    ),
    "",
  );
  for (const contract of MCP_RESULT_CONTRACTS) {
    out.push(
      withStabilityComment(
        contract,
        renderGenericTypeAlias(
          mcpTypeName(contract),
          "DiscernMcpToolResult",
          typeName(contract),
        ),
      ),
      "",
    );
  }
  return `${out.join("\n")}`;
}
