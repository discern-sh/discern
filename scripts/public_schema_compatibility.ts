/**
 * Structural compatibility checks for generated public JSON Schemas.
 *
 * This is a same-major ratchet, not a general JSON Schema theorem prover. It
 * holds the constructs emitted by discern's generators: object properties,
 * definitions, required fields, types, literals, unions, array items, and
 * scalar validation constraints. Annotation prose may change.
 */

import { Ajv2020 } from "ajv-2020";
import {
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  isPublicSchemaCompatibility,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  PUBLIC_SCHEMA_EXTENSION_KEYWORDS,
  type PUBLIC_SCHEMA_PUBLICATIONS,
  type PublicSchemaCompatibility,
  type PublicSchemaPublication,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
} from "../src/shared/public_schemas.ts";
import {
  buildCliManifest,
  buildConventionsManifest,
  buildMcpToolsManifest,
} from "./contract_manifests.ts";
import {
  buildConfigDocJsonSchema,
  buildConfigJsonSchema,
} from "../src/shared/config_codegen.ts";
import {
  buildProofNoteJsonSchema,
  buildResultJsonSchema,
} from "../src/shared/result_codegen.ts";
import { RESULT_CONTRACT_REFERENCE_FIELDS } from "../src/shared/result_contracts.ts";
import {
  isObject,
  json,
  type JsonObject,
  type JsonValue,
  pathKey,
  sameJson,
  stringSet,
} from "./public_contract_compatibility_common.ts";
import {
  isManifestCompatibility,
  publicManifestCompatibilityIssues,
  publicManifestValidityIssues,
} from "./contract_manifest_compatibility.ts";

export type {
  JsonObject,
  JsonValue,
} from "./public_contract_compatibility_common.ts";

export { publicSchemaBaselineTag } from "./public_schema_release_baseline.ts";

type ResultContractReferenceRole =
  keyof typeof RESULT_CONTRACT_REFERENCE_FIELDS;
type ContractReferenceSets = Readonly<
  Record<ResultContractReferenceRole, ReadonlySet<string>>
>;

const RESULT_CONTRACT_REFERENCE_ROLES = Object.keys(
  RESULT_CONTRACT_REFERENCE_FIELDS,
) as ResultContractReferenceRole[];

interface ComparisonContext {
  readonly policy: PublicSchemaCompatibility;
  readonly allowTypeSetWidening: boolean;
  readonly previousContractRefs: ContractReferenceSets;
  readonly newContractRefs: ContractReferenceSets;
  readonly contractAggregateRoles: ReadonlyMap<
    string,
    ResultContractReferenceRole
  >;
  readonly newRoleAggregateEntrypoints: ReadonlySet<string>;
}

type PublicSchemaArtifactPath =
  (typeof PUBLIC_SCHEMA_PUBLICATIONS)[number]["artifactPath"];

const CURRENT_SCHEMA_BUILDERS: Record<
  PublicSchemaArtifactPath,
  () => Record<string, unknown>
> = {
  "schema/discern-config.schema.json": buildConfigJsonSchema,
  "schema/discern-setup-config.schema.json": buildConfigDocJsonSchema,
  "schema/discern-results.schema.json": buildResultJsonSchema,
  "schema/discern-proof-note.schema.json": buildProofNoteJsonSchema,
  "schema/discern-mcp-tools.json": buildMcpToolsManifest,
  "schema/discern-cli.json": buildCliManifest,
  "schema/discern-conventions.json": buildConventionsManifest,
};

const ANNOTATION_KEYS = new Set([
  "$comment",
  "description",
  "deprecated",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

/** Build a validator that recognizes every public-schema extension keyword. */
function publicSchemaAjv(strict: boolean): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict,
    validateSchema: true,
  });
  for (const keyword of PUBLIC_SCHEMA_EXTENSION_KEYWORDS) {
    ajv.addKeyword(keyword);
  }
  return ajv;
}

/** Report members added to or removed from an enum-like string collection. */
function compareStringSets(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  issues: string[],
): void {
  const before = stringSet(previous);
  const after = stringSet(current);
  if (before === undefined || after === undefined) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }
  for (const member of before) {
    if (!after.includes(member)) {
      issues.push(`${path}: removed value ${JSON.stringify(member)}`);
    }
  }
  for (const member of after) {
    if (!before.includes(member)) {
      issues.push(`${path}: added value ${JSON.stringify(member)}`);
    }
  }
}

/** Normalize a scalar or array `type` keyword into a comparable collection. */
function schemaTypeSet(value: JsonValue | undefined): string[] | undefined {
  return typeof value === "string" ? [value] : stringSet(value);
}

/** Report type constraints that narrow the instances accepted by the trunk schema. */
function compareTypeSetInclusion(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  issues: string[],
): void {
  if (current === undefined) {
    return;
  }
  if (previous === undefined) {
    issues.push(`${path}: added type constraint ${json(current)}`);
    return;
  }
  const before = schemaTypeSet(previous);
  const after = schemaTypeSet(current);
  if (before === undefined || after === undefined) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }
  for (const member of before) {
    if (!after.includes(member)) {
      issues.push(`${path}: removed accepted type ${JSON.stringify(member)}`);
    }
  }
}

/** Report newly required fields and result fields whose requiredness was weakened. */
function compareRequired(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  const before = stringSet(previous) ?? [];
  const after = stringSet(current) ?? [];
  for (const field of after) {
    if (!before.includes(field)) {
      issues.push(`${path}: added required field ${JSON.stringify(field)}`);
    }
  }
  if (context.policy === RESULT_SCHEMA_COMPATIBILITY_POLICY) {
    for (const field of before) {
      if (!after.includes(field)) {
        issues.push(
          `${path}: made required result field ${
            JSON.stringify(field)
          } optional`,
        );
      }
    }
  }
}

/** Recursively compare existing object members and report removals. */
function compareMap(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  if (!isObject(previous) || !isObject(current)) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }
  for (const [key, previousValue] of Object.entries(previous)) {
    const childPath = pathKey(path, key);
    const currentValue = current[key];
    if (currentValue === undefined) {
      issues.push(`${childPath}: removed`);
      continue;
    }
    compareNode(previousValue, currentValue, childPath, context, issues);
  }
}

/** Recognize `true` or an annotation-only object as accepting every instance. */
function isUnconstrainedSchema(value: JsonValue | undefined): boolean {
  return value === true ||
    (isObject(value) &&
      Object.keys(value).every((key) => ANNOTATION_KEYS.has(key)));
}

/** Check existing properties and reject additions that narrow an open trunk object. */
function compareProperties(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  previousAdditionalProperties: JsonValue | undefined,
  parentPath: string,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  const previousProperties = previous ?? {};
  compareMap(previousProperties, current, path, context, issues);
  if (
    !isObject(previousProperties) ||
    !isObject(current)
  ) {
    return;
  }
  const addedProperties = Object.entries(current).filter(([key]) =>
    previousProperties[key] === undefined
  );
  if (
    context.policy === RESULT_SCHEMA_COMPATIBILITY_POLICY &&
    context.contractAggregateRoles.has(pathKey(parentPath, "oneOf"))
  ) {
    for (const [key] of addedProperties) {
      issues.push(
        `${pathKey(path, key)}: added property to a result-role aggregate`,
      );
    }
    return;
  }
  if (context.policy !== CONFIG_SCHEMA_COMPATIBILITY_POLICY) {
    return;
  }
  const catchall = previousAdditionalProperties ?? true;
  if (catchall === false) {
    return;
  }
  for (const [key, currentValue] of addedProperties) {
    const childPath = pathKey(path, key);
    const acceptanceValue = isObject(currentValue) && "default" in currentValue
      ? Object.fromEntries(
        Object.entries(currentValue).filter(([key]) => key !== "default"),
      )
      : currentValue;
    if (isUnconstrainedSchema(acceptanceValue)) {
      continue;
    }
    if (isObject(catchall)) {
      const localIssues: string[] = [];
      compareNode(
        catchall,
        acceptanceValue,
        childPath,
        {
          ...context,
          allowTypeSetWidening:
            context.policy === CONFIG_SCHEMA_COMPATIBILITY_POLICY,
        },
        localIssues,
      );
      if (localIssues.length === 0) {
        continue;
      }
      issues.push(
        `${childPath}: added property narrows values admitted by the trunk ` +
          `additionalProperties schema (${localIssues[0]})`,
      );
      continue;
    }
    issues.push(
      `${childPath}: added property narrows values admitted by trunk ` +
        `additionalProperties: ${json(catchall)}`,
    );
  }
}

/** Derive a stable matching key for reordered schema alternatives. */
function alternativeIdentity(value: JsonValue): string {
  if (isObject(value)) {
    if (typeof value.$ref === "string") {
      return `$ref:${value.$ref}`;
    }
    if (value.const !== undefined) {
      return `const:${json(value.const)}`;
    }
    if (value.type !== undefined) {
      return `type:${json(value.type)}`;
    }
  }
  return `schema:${json(value)}`;
}

/** Extract a pure `$ref` alternative whose other fields are annotations. */
function referenceAlternative(value: JsonValue): string | undefined {
  if (
    !isObject(value) ||
    typeof value.$ref !== "string" ||
    !Object.keys(value).every((key) =>
      key === "$ref" || ANNOTATION_KEYS.has(key)
    )
  ) {
    return undefined;
  }
  return value.$ref;
}

/** Identify the single contract role containing every referenced alternative. */
function matchingContractReferenceRole(
  alternatives: readonly JsonValue[],
  references: ContractReferenceSets,
): ResultContractReferenceRole | undefined {
  const matchingRoles = RESULT_CONTRACT_REFERENCE_ROLES.filter((role) =>
    alternatives.every((alternative) => {
      const reference = referenceAlternative(alternative);
      return reference !== undefined &&
        references[role].has(reference);
    })
  );
  return matchingRoles.length === 1 ? matchingRoles[0] : undefined;
}

/** Unwrap a `oneOf` aggregate whose other fields add no instance constraints. */
function transparentRoleAggregateAlternatives(
  definition: JsonValue | undefined,
): readonly JsonValue[] | undefined {
  if (
    !isObject(definition) ||
    !Array.isArray(definition.oneOf) ||
    !Object.keys(definition).every((key) =>
      key === "oneOf" || ANNOTATION_KEYS.has(key)
    )
  ) {
    return undefined;
  }
  return definition.oneOf;
}

/** Confirm that a canonical aggregate still contains references from its prior role. */
function contractAggregatorRole(
  path: string,
  alternatives: readonly JsonValue[],
  context: ComparisonContext,
): ResultContractReferenceRole | undefined {
  const canonicalRole = context.contractAggregateRoles.get(path);
  if (canonicalRole === undefined) {
    return undefined;
  }
  return matchingContractReferenceRole(
      alternatives,
      context.previousContractRefs,
    ) === canonicalRole
    ? canonicalRole
    : undefined;
}

/** Match reordered alternatives and authorize only registry-backed result additions. */
function compareAlternatives(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  keyword: "oneOf" | "anyOf" | "allOf" | "prefixItems",
  context: ComparisonContext,
  issues: string[],
): void {
  if (!Array.isArray(previous) || !Array.isArray(current)) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }
  const available = new Map<string, number[]>();
  current.forEach((alternative, index) => {
    const identity = alternativeIdentity(alternative);
    available.set(identity, [...(available.get(identity) ?? []), index]);
  });
  const matched = new Set<number>();
  for (const alternative of previous) {
    const identity = alternativeIdentity(alternative);
    const candidates = available.get(identity) ?? [];
    const index = candidates.find((candidate) => !matched.has(candidate));
    if (index === undefined) {
      issues.push(`${path}: removed alternative ${json(alternative)}`);
      continue;
    }
    matched.add(index);
    compareNode(
      alternative,
      current[index] ?? null,
      `${path}[${JSON.stringify(identity)}]`,
      context,
      issues,
    );
  }
  const aggregatorRole =
    context.policy === RESULT_SCHEMA_COMPATIBILITY_POLICY &&
      keyword === "oneOf" &&
      previous.length > 0
      ? contractAggregatorRole(path, previous, context)
      : undefined;
  current.forEach((alternative, index) => {
    if (matched.has(index)) {
      return;
    }
    const reference = referenceAlternative(alternative);
    const occurrences = reference === undefined
      ? 0
      : current.filter((candidate) =>
        referenceAlternative(candidate) === reference
      ).length;
    const createsRoleAggregate =
      context.policy === RESULT_SCHEMA_COMPATIBILITY_POLICY &&
      keyword === "oneOf" &&
      path === "$.oneOf" &&
      reference !== undefined &&
      context.newRoleAggregateEntrypoints.has(reference);
    if (
      reference !== undefined &&
      occurrences === 1 &&
      (createsRoleAggregate ||
        (aggregatorRole !== undefined &&
          context.newContractRefs[aggregatorRole].has(reference)))
    ) {
      return;
    }
    issues.push(`${path}: added alternative ${json(alternative)}`);
  });
}

/** Compare tuple positions in order and report removed or appended slots. */
function comparePrefixItems(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  if (!Array.isArray(previous) || !Array.isArray(current)) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }
  previous.forEach((schema, index) => {
    const next = current[index];
    const childPath = `${path}[${index}]`;
    if (next === undefined) {
      issues.push(`${childPath}: removed`);
      return;
    }
    compareNode(schema, next, childPath, context, issues);
  });
  current.slice(previous.length).forEach((schema, offset) => {
    const index = previous.length + offset;
    issues.push(`${path}[${index}]: added ${json(schema)}`);
  });
}

/** Read a string contract ID from one registry metadata record. */
function contractId(value: JsonValue): string | undefined {
  return isObject(value) && typeof value.id === "string" ? value.id : undefined;
}

/** Read a contract role field only when it points into root `$defs`. */
function contractSchemaReference(
  value: JsonValue,
  field: string,
): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const candidate = value[field];
  return typeof candidate === "string" &&
      definitionName(candidate) !== undefined
    ? candidate
    : undefined;
}

/** Treat absent or malformed contract metadata as an empty registry. */
function contractRecords(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

/** Index every contract definition reference by its CLI or MCP role. */
function contractReferenceSets(
  contracts: readonly JsonValue[],
): Record<ResultContractReferenceRole, Set<string>> {
  const references = Object.fromEntries(
    RESULT_CONTRACT_REFERENCE_ROLES.map((role) => [role, new Set<string>()]),
  ) as Record<ResultContractReferenceRole, Set<string>>;
  for (const contract of contracts) {
    for (const role of RESULT_CONTRACT_REFERENCE_ROLES) {
      const reference = contractSchemaReference(
        contract,
        RESULT_CONTRACT_REFERENCE_FIELDS[role],
      );
      if (reference !== undefined) {
        references[role].add(reference);
      }
    }
  }
  return references;
}

/** Decode a single-segment root `$defs` JSON Pointer reference. */
function definitionName(reference: string): string | undefined {
  const prefix = "#/$defs/";
  if (!reference.startsWith(prefix)) {
    return undefined;
  }
  const encoded = reference.slice(prefix.length);
  if (encoded.length === 0 || encoded.includes("/")) {
    return undefined;
  }
  return encoded.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Encode a definition name as a root `$defs` JSON Pointer reference. */
function definitionReference(name: string): string {
  return `#/$defs/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/**
 * Give widening authority to a role aggregate reached by one acyclic,
 * same-instance route from the trunk entrypoints. Repeated branches and
 * wrapper references retain their multiplicity and close the aggregate.
 */
function contractAggregateRoles(
  previous: JsonObject,
  previousDefinitions: JsonObject,
  previousContractRefs: ContractReferenceSets,
): ReadonlyMap<string, ResultContractReferenceRole> {
  if (!Array.isArray(previous.oneOf)) {
    return new Map();
  }
  const candidates: ContractAggregateReach[] = [];
  const transparentPaths = new Set<string>();
  for (const entrypoint of previous.oneOf) {
    const reachable = reachableContractAggregates(
      entrypoint,
      previousDefinitions,
      previousContractRefs,
    );
    candidates.push(...reachable);
    const reference = referenceAlternative(entrypoint);
    const name = reference === undefined
      ? undefined
      : definitionName(reference);
    if (name === undefined) {
      continue;
    }
    const directPath = pathKey(
      pathKey(pathKey("$", "$defs"), name),
      "oneOf",
    );
    if (reachable.some(([path]) => path === directPath)) {
      transparentPaths.add(directPath);
    }
  }
  const roleCounts = new Map<ResultContractReferenceRole, number>();
  for (const [, role] of candidates) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  return new Map(
    candidates.filter(([path, role]) =>
      roleCounts.get(role) === 1 && transparentPaths.has(path)
    ),
  );
}

const SAME_INSTANCE_SCHEMA_KEYS = [
  "allOf",
  "anyOf",
  "oneOf",
  "if",
  "then",
  "else",
  "not",
] as const;

type ContractAggregateReach = readonly [
  string,
  ResultContractReferenceRole,
];

/** Traverse same-instance schema links to find acyclic role aggregates. */
function reachableContractAggregates(
  entrypoint: JsonValue,
  definitions: JsonObject,
  references: ContractReferenceSets,
): readonly ContractAggregateReach[] {
  const aggregates: ContractAggregateReach[] = [];

  const visit = (
    schema: JsonValue | undefined,
    activeDefinitions: ReadonlySet<string>,
  ): void => {
    if (!isObject(schema)) {
      return;
    }
    const name = typeof schema.$ref === "string"
      ? definitionName(schema.$ref)
      : undefined;
    if (name !== undefined && !activeDefinitions.has(name)) {
      const nextActiveDefinitions = new Set(activeDefinitions);
      nextActiveDefinitions.add(name);
      const definition = definitions[name];
      if (isObject(definition)) {
        const alternatives = transparentRoleAggregateAlternatives(definition);
        const role = alternatives !== undefined && alternatives.length > 0
          ? matchingContractReferenceRole(
            alternatives,
            references,
          )
          : undefined;
        if (role !== undefined) {
          const definitionPath = pathKey(pathKey("$", "$defs"), name);
          aggregates.push([pathKey(definitionPath, "oneOf"), role]);
        } else {
          visit(definition, nextActiveDefinitions);
        }
      }
    }
    for (const key of SAME_INSTANCE_SCHEMA_KEYS) {
      const nested = schema[key];
      if (Array.isArray(nested)) {
        nested.forEach((candidate) => visit(candidate, activeDefinitions));
      } else {
        visit(nested, activeDefinitions);
      }
    }
    const dependentSchemas = schema.dependentSchemas;
    if (isObject(dependentSchemas)) {
      Object.values(dependentSchemas).forEach((candidate) =>
        visit(candidate, activeDefinitions)
      );
    }
  };

  visit(entrypoint, new Set());
  return aggregates;
}

/** Require two schema-reference sets to contain exactly the same members. */
function sameReferences(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size &&
    [...left].every((reference) => right.has(reference));
}

/** Verify an aggregate contains each expected reference once and nothing else. */
function aggregateContainsExactly(
  definition: JsonValue | undefined,
  references: ReadonlySet<string>,
): boolean {
  const alternatives = transparentRoleAggregateAlternatives(definition);
  if (alternatives === undefined) {
    return false;
  }
  if (alternatives.length !== references.size) {
    return false;
  }
  const seen = new Set<string>();
  for (const alternative of alternatives) {
    const reference = referenceAlternative(alternative);
    if (
      reference === undefined ||
      !references.has(reference) ||
      seen.has(reference)
    ) {
      return false;
    }
    seen.add(reference);
  }
  return seen.size === references.size;
}

/** Authorize entrypoints that add a complete aggregate for a role absent from the baseline. */
function newRoleAggregateEntrypoints(
  current: JsonObject,
  previousDefinitions: JsonObject,
  currentDefinitions: JsonObject,
  previousContractRefs: ContractReferenceSets,
  currentContractRefs: ContractReferenceSets,
  newContractRefs: ContractReferenceSets,
): ReadonlySet<string> {
  if (!Array.isArray(current.oneOf)) {
    return new Set();
  }
  const reachable = current.oneOf.flatMap((entrypoint) =>
    reachableContractAggregates(
      entrypoint,
      currentDefinitions,
      currentContractRefs,
    )
  );
  const authorized = new Set<string>();
  for (const role of RESULT_CONTRACT_REFERENCE_ROLES) {
    const priorReferences = previousContractRefs[role];
    const currentReferences = currentContractRefs[role];
    if (
      priorReferences.size > 0 ||
      currentReferences.size === 0 ||
      !sameReferences(currentReferences, newContractRefs[role])
    ) {
      continue;
    }
    const aggregateNames = Object.entries(currentDefinitions)
      .filter(([name, definition]) =>
        previousDefinitions[name] === undefined &&
        aggregateContainsExactly(definition, currentReferences)
      )
      .map(([name]) => name);
    if (aggregateNames.length !== 1) {
      continue;
    }
    const name = aggregateNames[0];
    if (name === undefined) {
      continue;
    }
    const reference = definitionReference(name);
    const aggregatePath = pathKey(
      pathKey(pathKey("$", "$defs"), name),
      "oneOf",
    );
    const roleRoutes = reachable.filter(([, candidateRole]) =>
      candidateRole === role
    );
    const pureEntrypoints = current.oneOf.filter((entrypoint) =>
      referenceAlternative(entrypoint) === reference
    );
    if (
      roleRoutes.length === 1 &&
      roleRoutes[0]?.[0] === aggregatePath &&
      pureEntrypoints.length === 1
    ) {
      authorized.add(reference);
    }
  }
  return authorized;
}

/** Derive definitions and contract-role metadata that govern one comparison. */
function comparisonContext(
  previous: JsonObject,
  current: JsonObject,
  policy: PublicSchemaCompatibility,
): ComparisonContext {
  const previousContracts = contractRecords(
    previous["x-discern-contracts"],
  );
  const currentContracts = contractRecords(current["x-discern-contracts"]);
  const previousContractsById = new Map<string, JsonValue>();
  for (const contract of previousContracts) {
    const id = contractId(contract);
    if (id !== undefined) {
      previousContractsById.set(id, contract);
    }
  }
  const previousContractRefs = contractReferenceSets(previousContracts);
  const currentContractRefs = contractReferenceSets(currentContracts);
  const previousDefinitions = isObject(previous.$defs) ? previous.$defs : {};
  const currentDefinitions = isObject(current.$defs) ? current.$defs : {};
  const newContractRefs = Object.fromEntries(
    RESULT_CONTRACT_REFERENCE_ROLES.map((role) => [role, new Set<string>()]),
  ) as Record<ResultContractReferenceRole, Set<string>>;
  for (const contract of currentContracts) {
    const id = contractId(contract);
    if (id === undefined) {
      continue;
    }
    const previousContract = previousContractsById.get(id);
    const previousCliReference = previousContract === undefined
      ? undefined
      : contractSchemaReference(
        previousContract,
        RESULT_CONTRACT_REFERENCE_FIELDS.cli,
      );
    const currentCliReference = contractSchemaReference(
      contract,
      RESULT_CONTRACT_REFERENCE_FIELDS.cli,
    );
    const firstMcpExposure = previousContract !== undefined &&
      isObject(previousContract) &&
      previousCliReference !== undefined &&
      currentCliReference === previousCliReference &&
      previousContract.mcp_tool === undefined &&
      previousContract[RESULT_CONTRACT_REFERENCE_FIELDS.mcp] === undefined &&
      isObject(contract) &&
      typeof contract.mcp_tool === "string";
    for (const role of RESULT_CONTRACT_REFERENCE_ROLES) {
      const field = RESULT_CONTRACT_REFERENCE_FIELDS[role];
      const authorized = previousContract === undefined ||
        (firstMcpExposure &&
          field === RESULT_CONTRACT_REFERENCE_FIELDS.mcp);
      if (!authorized) {
        continue;
      }
      const reference = contractSchemaReference(contract, field);
      if (reference === undefined) {
        continue;
      }
      const name = definitionName(reference);
      if (
        !previousContractRefs[role].has(reference) &&
        name !== undefined &&
        previousDefinitions[name] === undefined &&
        currentDefinitions[name] !== undefined
      ) {
        newContractRefs[role].add(reference);
      }
    }
  }
  return {
    policy,
    allowTypeSetWidening: false,
    previousContractRefs,
    newContractRefs,
    contractAggregateRoles: contractAggregateRoles(
      previous,
      previousDefinitions,
      previousContractRefs,
    ),
    newRoleAggregateEntrypoints: newRoleAggregateEntrypoints(
      current,
      previousDefinitions,
      currentDefinitions,
      previousContractRefs,
      currentContractRefs,
      newContractRefs,
    ),
  };
}

/** Compare contract metadata while permitting additive, uniquely identified records. */
function compareContracts(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  if (!Array.isArray(previous) || !Array.isArray(current)) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }
  const byId = new Map<string, JsonValue>();
  for (const contract of current) {
    const id = contractId(contract);
    if (id !== undefined) {
      byId.set(id, contract);
    }
  }
  for (const contract of previous) {
    const id = contractId(contract);
    if (id === undefined) {
      issues.push(`${path}: previous contract has no string id`);
      continue;
    }
    const next = byId.get(id);
    if (next === undefined) {
      issues.push(`${path}: removed contract ${JSON.stringify(id)}`);
      continue;
    }
    if (!isObject(contract) || !isObject(next)) {
      compareNode(
        contract,
        next,
        `${path}[id=${JSON.stringify(id)}]`,
        context,
        issues,
      );
      continue;
    }
    for (const [key, value] of Object.entries(contract)) {
      const nextValue = next[key];
      const childPath = `${path}[id=${JSON.stringify(id)}].${key}`;
      if (nextValue === undefined) {
        issues.push(`${childPath}: removed`);
      } else if (key === "commands") {
        const commandIssues: string[] = [];
        compareStringSets(value, nextValue, childPath, commandIssues);
        issues.push(
          ...commandIssues.filter((issue) => !issue.includes(": added value ")),
        );
      } else {
        compareNode(value, nextValue, childPath, context, issues);
      }
    }
  }
  if (context.policy !== RESULT_SCHEMA_COMPATIBILITY_POLICY) {
    for (const contract of current) {
      const id = contractId(contract);
      if (
        id !== undefined &&
        !previous.some((candidate) => contractId(candidate) === id)
      ) {
        issues.push(`${path}: added contract ${JSON.stringify(id)}`);
      }
    }
  }
}

/** Reject object catchall changes that admit fewer instances than trunk. */
function compareAdditionalProperties(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  const before = previous ?? true;
  const after = current ?? true;
  if (isObject(before) && isObject(after)) {
    compareNode(before, after, path, context, issues);
    return;
  }
  if (!sameJson(before, after)) {
    issues.push(`${path}: changed from ${json(before)} to ${json(after)}`);
  }
}

/** Apply keyword-specific compatibility rules recursively to one schema node. */
function compareNode(
  previous: JsonValue,
  current: JsonValue,
  path: string,
  context: ComparisonContext,
  issues: string[],
): void {
  if (!isObject(previous) || !isObject(current)) {
    if (!sameJson(previous, current)) {
      issues.push(
        `${path}: changed from ${json(previous)} to ${json(current)}`,
      );
    }
    return;
  }

  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const key of keys) {
    if (ANNOTATION_KEYS.has(key)) {
      continue;
    }
    const before = previous[key];
    const after = current[key];
    const childPath = pathKey(path, key);
    switch (key) {
      case "properties":
        compareProperties(
          before,
          after,
          previous.additionalProperties,
          path,
          childPath,
          context,
          issues,
        );
        break;
      case "$defs":
      case "definitions":
        compareMap(before, after, childPath, context, issues);
        break;
      case "required":
        compareRequired(before, after, childPath, context, issues);
        break;
      case "enum":
        compareStringSets(before, after, childPath, issues);
        break;
      case "type":
        if (context.allowTypeSetWidening) {
          compareTypeSetInclusion(before, after, childPath, issues);
        } else {
          compareStringSets(before, after, childPath, issues);
        }
        break;
      case "oneOf":
      case "anyOf":
      case "allOf":
        compareAlternatives(
          before,
          after,
          childPath,
          key,
          context,
          issues,
        );
        break;
      case "prefixItems":
        comparePrefixItems(before, after, childPath, context, issues);
        break;
      case "items":
      case "propertyNames":
      case "contains":
      case "not":
      case "if":
      case "then":
      case "else":
        if (before === undefined || after === undefined) {
          if (!sameJson(before, after)) {
            issues.push(
              `${childPath}: changed from ${json(before)} to ${json(after)}`,
            );
          }
        } else {
          compareNode(before, after, childPath, context, issues);
        }
        break;
      case "additionalProperties":
      case "unevaluatedProperties":
        compareAdditionalProperties(before, after, childPath, context, issues);
        break;
      case "default":
        if (
          context.policy === CONFIG_SCHEMA_COMPATIBILITY_POLICY &&
          !sameJson(before, after)
        ) {
          issues.push(
            `${childPath}: changed from ${json(before)} to ${json(after)}`,
          );
        }
        break;
      case "x-discern-error-slugs": {
        const localIssues: string[] = [];
        compareStringSets(before, after, childPath, localIssues);
        issues.push(
          ...(context.policy === RESULT_SCHEMA_COMPATIBILITY_POLICY
            ? localIssues.filter((issue) => !issue.includes(": added value "))
            : localIssues),
        );
        break;
      }
      case "x-discern-contracts":
        compareContracts(before, after, childPath, context, issues);
        break;
      default:
        if (!sameJson(before, after)) {
          issues.push(
            `${childPath}: changed from ${json(before)} to ${json(after)}`,
          );
        }
    }
  }
}

/**
 * Return every structural same-major break between a trunk schema and the
 * current generated schema. An empty result is compatible.
 */
export function publicSchemaCompatibilityIssues(
  previous: JsonObject,
  current: JsonObject,
  policy: PublicSchemaCompatibility,
): string[] {
  if (isManifestCompatibility(policy)) {
    return publicManifestCompatibilityIssues(previous, current, policy);
  }
  const issues = [
    ...publicSchemaValidityIssues(previous, "trunk schema"),
    ...publicSchemaValidityIssues(current, "current schema"),
  ];
  if (issues.length > 0) {
    return issues;
  }
  compareNode(
    previous,
    current,
    "$",
    comparisonContext(previous, current, policy),
    issues,
  );
  return issues;
}

/** Compile a draft-2020-12 schema and turn validation failure into one issue. */
function publicSchemaValidityIssues(
  schema: JsonObject,
  label: string,
  strict = false,
): string[] {
  try {
    publicSchemaAjv(strict).compile(schema);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      `${label}: invalid JSON Schema draft 2020-12: ${message}`,
    ];
  }
}

interface PublicSchemaIdentity {
  readonly major: number;
  readonly name: string;
}

const PUBLIC_SCHEMA_ID_PATTERN =
  /^https:\/\/discern\.sh\/schema\/v([1-9][0-9]*)\/([^/?#]+\.json)$/;

/** Validate and split discern's versioned public schema URL into major and name. */
function parsePublicSchemaIdentity(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
): PublicSchemaIdentity | undefined {
  if (typeof value !== "string") {
    issues.push(`${path}: ${json(value)} is not a canonical public schema id`);
    return undefined;
  }
  const match = PUBLIC_SCHEMA_ID_PATTERN.exec(value);
  const majorText = match?.[1];
  const name = match?.[2];
  const major = majorText === undefined ? NaN : Number(majorText);
  if (
    match === null ||
    name === undefined ||
    !Number.isSafeInteger(major) ||
    major < 1
  ) {
    issues.push(
      `${path}: ${JSON.stringify(value)} is not a canonical public schema id`,
    );
    return undefined;
  }
  return { major, name };
}

/** Validate the root compatibility-policy extension against the public canon. */
function publicSchemaCompatibilityPolicy(
  schema: JsonObject,
  issues: string[],
): PublicSchemaCompatibility | undefined {
  const value = schema[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY];
  if (!isPublicSchemaCompatibility(value)) {
    issues.push(
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: ${json(value)} is not a ` +
        "public schema compatibility policy",
    );
    return undefined;
  }
  return value;
}

/**
 * Validate the generated identity against its registry record independently
 * of any trunk artifact. Initial publication enrollment still proves this
 * half before it establishes its first structural baseline.
 */
export function publicSchemaPublicationIdentityIssues(
  current: JsonObject,
  publication: PublicSchemaPublication,
): string[] {
  const issues = isManifestCompatibility(publication.compatibility)
    ? publicManifestValidityIssues(
      current,
      publication.compatibility,
      "current manifest",
    )
    : publicSchemaValidityIssues(current, "current schema", true);
  if (issues.length > 0) {
    return issues;
  }
  const registered = parsePublicSchemaIdentity(
    publication.id,
    "publication id",
    issues,
  );
  if (registered === undefined) {
    return issues;
  }
  if (
    !Number.isSafeInteger(publication.major) ||
    publication.major < 1
  ) {
    issues.push(
      `publication major ${json(publication.major)} is not a positive integer`,
    );
    return issues;
  }
  if (registered.major !== publication.major) {
    issues.push(
      `publication id ${JSON.stringify(publication.id)} carries ` +
        `v${registered.major}, not registered v${publication.major}`,
    );
    return issues;
  }
  if (!isPublicSchemaCompatibility(publication.compatibility)) {
    issues.push(
      `publication compatibility ${json(publication.compatibility)} is not a ` +
        "public schema compatibility policy",
    );
    return issues;
  }
  const expectedArtifactPath = publication.major === 1
    ? `schema/${registered.name}`
    : `schema/v${publication.major}/${registered.name}`;
  if (publication.artifactPath !== expectedArtifactPath) {
    issues.push(
      `publication artifact ${JSON.stringify(publication.artifactPath)} does ` +
        `not match registered id path ${JSON.stringify(expectedArtifactPath)}`,
    );
    return issues;
  }
  if (current.$id !== publication.id) {
    issues.push(
      `$.$id: generated id ${json(current.$id)} does not match registered id ` +
        JSON.stringify(publication.id),
    );
  }
  const artifactPolicy = publicSchemaCompatibilityPolicy(current, issues);
  if (
    artifactPolicy !== undefined &&
    artifactPolicy !== publication.compatibility
  ) {
    issues.push(
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: generated policy ` +
        `${JSON.stringify(artifactPolicy)} does not match registered policy ` +
        JSON.stringify(publication.compatibility),
    );
  }
  return issues;
}

/**
 * Keep every public artifact path enrolled after the publication registry has
 * landed. New paths may join; an existing path cannot disappear by moving its
 * generator and registry record together.
 */
export function publicSchemaArtifactEnrollmentIssues(
  previousArtifactPaths: readonly string[],
  currentPublications: readonly PublicSchemaPublication[],
): string[] {
  const currentPaths = new Set<string>(
    currentPublications.map((publication) => publication.artifactPath),
  );
  return [...previousArtifactPaths]
    .filter((path) => !currentPaths.has(path))
    .sort()
    .map((path) =>
      `${path}: trunk public schema artifact is no longer enrolled`
    );
}

/**
 * Enforce one enrolled publication across a trunk transition.
 *
 * An artifact path and its public identity are append-only. Same-major changes
 * use the policy recorded by the trunk artifact; a new major starts at a new
 * artifact path while its predecessor publication and route stay enrolled.
 */
export function publicSchemaPublicationCompatibilityIssues(
  previous: JsonObject,
  current: JsonObject,
  publication: PublicSchemaPublication,
): string[] {
  const issues = publicSchemaPublicationIdentityIssues(current, publication);
  if (issues.length > 0) {
    return issues;
  }
  const registered = parsePublicSchemaIdentity(
    publication.id,
    "publication id",
    issues,
  );
  const prior = parsePublicSchemaIdentity(previous.$id, "$.$id", issues);
  if (registered === undefined || prior === undefined) {
    return issues;
  }
  if (prior.name !== registered.name) {
    return [
      `$.$id: schema identity changed from ${JSON.stringify(prior.name)} to ` +
      `${JSON.stringify(registered.name)}; only the major may change`,
    ];
  }
  if (prior.major > registered.major) {
    return [
      `$.$id: schema major regressed from v${prior.major} to ` +
      `v${registered.major}`,
    ];
  }
  if (prior.major < registered.major) {
    return [
      `$.$id: schema major changed in place from v${prior.major} to ` +
      `v${registered.major}; retain the v${prior.major} publication and add ` +
      `v${registered.major} at a new artifact path`,
    ];
  }
  const previousPolicy = publicSchemaCompatibilityPolicy(previous, issues);
  if (previousPolicy === undefined) {
    return issues;
  }
  if (previousPolicy !== publication.compatibility) {
    return [
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: same-major policy changed ` +
      `from ${JSON.stringify(previousPolicy)} to ` +
      `${JSON.stringify(publication.compatibility)}; add a new-major ` +
      "publication instead",
    ];
  }
  return publicSchemaCompatibilityIssues(
    previous,
    current,
    previousPolicy,
  );
}

/** Generate the current branch schema enrolled by one publication record. */
export function buildCurrentPublicSchema(
  publication: PublicSchemaPublication,
): JsonObject {
  const builder = CURRENT_SCHEMA_BUILDERS[
    publication.artifactPath as PublicSchemaArtifactPath
  ];
  if (builder === undefined) {
    throw new Error(
      `no current-schema builder is enrolled for ${publication.artifactPath}`,
    );
  }
  return builder() as unknown as JsonObject;
}
