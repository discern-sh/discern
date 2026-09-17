/** Same-major append-only compatibility for generated registry manifests. */

import {
  CLI_COMPATIBILITY_POLICY,
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  CONVENTIONS_COMPATIBILITY_POLICY,
  MCP_TOOLS_COMPATIBILITY_POLICY,
  type PublicSchemaCompatibility,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
} from "../src/shared/public_schemas.ts";
import {
  isObject,
  json,
  type JsonObject,
  type JsonValue,
  pathKey,
  sameJson,
  stringSet,
  withoutEvolvingMembers,
  withoutSchemaDocumentation,
} from "./public_contract_compatibility_common.ts";

/** Whether a policy governs a registry manifest rather than a JSON Schema. */
export function isManifestCompatibility(
  policy: PublicSchemaCompatibility,
): boolean {
  return policy === MCP_TOOLS_COMPATIBILITY_POLICY ||
    policy === CLI_COMPATIBILITY_POLICY ||
    policy === CONVENTIONS_COMPATIBILITY_POLICY;
}

/** Read an array of JSON objects, reporting malformed manifest structure. */
function objectArray(
  value: JsonValue | undefined,
  path: string,
  issues: string[],
): JsonObject[] {
  if (!Array.isArray(value) || value.some((entry) => !isObject(entry))) {
    issues.push(`${path}: expected an array of objects`);
    return [];
  }
  return value as JsonObject[];
}

/** Index records by one required string identity, rejecting duplicates. */
function recordsByStringField(
  records: readonly JsonObject[],
  field: string,
  path: string,
  issues: string[],
): Map<string, JsonObject> {
  const indexed = new Map<string, JsonObject>();
  for (const [index, record] of records.entries()) {
    const id = record[field];
    if (typeof id !== "string" || id === "") {
      issues.push(`${path}[${index}].${field}: expected a non-empty string`);
      continue;
    }
    if (indexed.has(id)) {
      issues.push(`${path}: duplicate ${field} ${JSON.stringify(id)}`);
      continue;
    }
    indexed.set(id, record);
  }
  return indexed;
}

/** Existing MCP request schemas stay fixed except for optional properties. */
function compareMcpInputSchema(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
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
  const previousKeys = new Set(Object.keys(previous));
  for (const [key, before] of Object.entries(previous)) {
    const after = current[key];
    const childPath = pathKey(path, key);
    if (after === undefined) {
      issues.push(`${childPath}: removed`);
      continue;
    }
    if (key === "properties") {
      if (!isObject(before) || !isObject(after)) {
        if (!sameJson(before, after)) {
          issues.push(
            `${childPath}: changed from ${json(before)} to ${json(after)}`,
          );
        }
        continue;
      }
      for (const [property, priorSchema] of Object.entries(before)) {
        const nextSchema = after[property];
        const propertyPath = pathKey(childPath, property);
        if (nextSchema === undefined) {
          issues.push(`${propertyPath}: removed`);
        } else {
          compareMcpInputSchema(
            priorSchema,
            nextSchema,
            propertyPath,
            issues,
          );
        }
      }
      continue;
    }
    if (key === "enum") {
      // Tool inputs are append-only: a request valid against the baseline
      // stays valid when the accepted values grow.
      compareAppendOnlyStrings(before, after, childPath, issues);
      continue;
    }
    if (key === "required") {
      const beforeRequired = stringSet(before);
      const afterRequired = stringSet(after);
      if (beforeRequired === undefined || afterRequired === undefined) {
        if (!sameJson(before, after)) {
          issues.push(
            `${childPath}: changed from ${json(before)} to ${json(after)}`,
          );
        }
        continue;
      }
      for (const required of afterRequired) {
        if (!beforeRequired.includes(required)) {
          issues.push(
            `${childPath}: added required input ${JSON.stringify(required)}`,
          );
        }
      }
      continue;
    }
    compareMcpInputSchema(before, after, childPath, issues);
  }
  for (const key of Object.keys(current)) {
    if (!previousKeys.has(key) && key === "required") {
      const addedRequired = stringSet(current[key]);
      if (addedRequired === undefined) {
        issues.push(`${pathKey(path, key)}: added invalid required constraint`);
      } else {
        for (const required of addedRequired) {
          issues.push(
            `${pathKey(path, key)}: added required input ${
              JSON.stringify(required)
            }`,
          );
        }
      }
      continue;
    }
    if (!previousKeys.has(key) && key !== "properties") {
      issues.push(`${pathKey(path, key)}: added request constraint`);
    }
  }
}

/** Compare tool identities, safety annotations, and requests; documentation may evolve. */
function mcpToolsManifestCompatibilityIssues(
  previous: JsonObject,
  current: JsonObject,
): string[] {
  const issues: string[] = [];
  const before = objectArray(previous.tools, "$.tools", issues);
  const after = objectArray(current.tools, "$.tools", issues);
  const beforeByName = recordsByStringField(
    before,
    "name",
    "$.tools",
    issues,
  );
  const afterByName = recordsByStringField(
    after,
    "name",
    "$.tools",
    issues,
  );
  for (const [name, prior] of beforeByName) {
    const next = afterByName.get(name);
    if (next === undefined) {
      issues.push(`$.tools[name=${JSON.stringify(name)}]: removed`);
      continue;
    }
    const toolPath = `$.tools[name=${JSON.stringify(name)}]`;
    for (const key of ["name", "annotations"]) {
      if (!sameJson(prior[key], next[key])) {
        issues.push(
          `${pathKey(toolPath, key)}: changed from ${json(prior[key])} to ${
            json(next[key])
          }`,
        );
      }
    }
    compareMcpInputSchema(
      withoutSchemaDocumentation(prior.inputSchema),
      withoutSchemaDocumentation(next.inputSchema),
      pathKey(toolPath, "inputSchema"),
      issues,
    );
  }
  // Resources mirror tools: append-only by name, with the URI (or template)
  // and the kind immutable. Their descriptions never enter the manifest.
  const beforeResources = recordsByStringField(
    objectArray(previous.resources ?? [], "$.resources", issues),
    "name",
    "$.resources",
    issues,
  );
  const afterResources = recordsByStringField(
    objectArray(current.resources ?? [], "$.resources", issues),
    "name",
    "$.resources",
    issues,
  );
  for (const [name, prior] of beforeResources) {
    const next = afterResources.get(name);
    const resourcePath = `$.resources[name=${JSON.stringify(name)}]`;
    if (next === undefined) {
      issues.push(`${resourcePath}: removed`);
      continue;
    }
    for (const key of ["kind", "uri"]) {
      if (!sameJson(prior[key], next[key])) {
        issues.push(
          `${pathKey(resourcePath, key)}: changed from ${json(prior[key])} to ${
            json(next[key])
          }`,
        );
      }
    }
  }
  return issues;
}

/** A command path's stable identity in the flattened CLI manifest. */
function cliPath(record: JsonObject): string | undefined {
  const path = stringSet(record.path);
  return path === undefined ? undefined : JSON.stringify(record.path);
}

/** Index commands by their ordered path. */
function commandsByPath(
  records: readonly JsonObject[],
  path: string,
  issues: string[],
): Map<string, JsonObject> {
  const indexed = new Map<string, JsonObject>();
  for (const [index, record] of records.entries()) {
    const id = cliPath(record);
    if (id === undefined) {
      issues.push(`${path}[${index}].path: expected an array of strings`);
      continue;
    }
    if (indexed.has(id)) {
      issues.push(`${path}: duplicate command path ${id}`);
      continue;
    }
    indexed.set(id, record);
  }
  return indexed;
}

/** Existing string members cannot disappear; additions remain compatible. */
function compareAppendOnlyStrings(
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
      issues.push(`${path}: removed ${JSON.stringify(member)}`);
    }
  }
}

/** Compare one command's flags by their first registered spelling. */
function compareCliFlags(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  issues: string[],
): void {
  const before = objectArray(previous, path, issues);
  const after = objectArray(current, path, issues);
  for (const prior of before) {
    const priorSpellings = stringSet(prior.spellings);
    if (priorSpellings === undefined || priorSpellings.length === 0) {
      issues.push(`${path}: existing flag has no spellings`);
      continue;
    }
    const identity = priorSpellings[0] ?? "";
    const next = after.find((candidate) => {
      const spellings = stringSet(candidate.spellings);
      return spellings?.includes(identity) === true;
    });
    const flagPath = `${path}[flag=${JSON.stringify(identity)}]`;
    if (next === undefined) {
      issues.push(`${flagPath}: removed`);
      continue;
    }
    compareAppendOnlyStrings(
      prior.spellings,
      next.spellings,
      `${flagPath}.spellings`,
      issues,
    );
    if (prior.choices !== undefined || next.choices !== undefined) {
      // Accepted values are append-only, like every other input enum.
      compareAppendOnlyStrings(
        prior.choices,
        next.choices,
        `${flagPath}.choices`,
        issues,
      );
    }
    for (
      const key of [
        "type_definition",
        "arity",
        "value_types",
        "default",
        "hidden",
        "global",
      ]
    ) {
      if (!sameJson(prior[key], next[key])) {
        issues.push(
          `${pathKey(flagPath, key)}: changed from ${json(prior[key])} to ${
            json(next[key])
          }`,
        );
      }
    }
  }
}

/** Compare one CLI command while permitting append-only grammar growth. */
function compareCliCommand(
  previous: JsonObject,
  current: JsonObject,
  path: string,
  issues: string[],
): void {
  for (
    const key of [
      "path",
      "hidden",
      "hidden_when",
    ]
  ) {
    if (!sameJson(previous[key], current[key])) {
      issues.push(
        `${pathKey(path, key)}: changed from ${json(previous[key])} to ${
          json(current[key])
        }`,
      );
    }
  }
  compareAppendOnlyStrings(
    previous.aliases,
    current.aliases,
    `${path}.aliases`,
    issues,
  );
  comparePositionals(
    previous.positionals,
    current.positionals,
    `${path}.positionals`,
    issues,
  );
  compareCliFlags(previous.flags, current.flags, `${path}.flags`, issues);
}

/**
 * Existing positionals keep their place, name, requiredness, arity, and value
 * types, and their accepted values are append-only. A new positional must be
 * optional and trailing, so an invocation written against the baseline still
 * parses.
 */
function comparePositionals(
  previous: JsonValue | undefined,
  current: JsonValue | undefined,
  path: string,
  issues: string[],
): void {
  const before = objectArray(previous, path, issues);
  const after = objectArray(current, path, issues);
  before.forEach((positional, index) => {
    const next = after[index];
    const slotPath = `${path}[${index}]`;
    if (next === undefined) {
      issues.push(`${slotPath}: removed ${json(positional)}`);
      return;
    }
    for (const key of ["name", "optional", "variadic", "value_types"]) {
      if (!sameJson(positional[key], next[key])) {
        issues.push(
          `${pathKey(slotPath, key)}: changed from ${
            json(positional[key])
          } to ${json(next[key])}`,
        );
      }
    }
    if (positional.choices !== undefined || next.choices !== undefined) {
      compareAppendOnlyStrings(
        positional.choices,
        next.choices,
        `${slotPath}.choices`,
        issues,
      );
    }
  });
  after.slice(before.length).forEach((positional, offset) => {
    if (positional.optional !== true) {
      issues.push(
        `${path}[${before.length + offset}]: added required positional ${
          json(positional.name)
        }`,
      );
    }
  });
}

/** Compare the frozen CLI grammar. */
function cliManifestCompatibilityIssues(
  previous: JsonObject,
  current: JsonObject,
): string[] {
  const issues: string[] = [];
  if (!isObject(previous.implicit_flags) || !isObject(current.implicit_flags)) {
    issues.push("$.implicit_flags: expected an object");
  } else {
    for (const scope of Object.keys(previous.implicit_flags)) {
      compareAppendOnlyStrings(
        previous.implicit_flags[scope],
        current.implicit_flags[scope],
        pathKey("$.implicit_flags", scope),
        issues,
      );
    }
  }
  const before = objectArray(previous.commands, "$.commands", issues);
  const after = objectArray(current.commands, "$.commands", issues);
  const beforeByPath = commandsByPath(before, "$.commands", issues);
  const afterByPath = commandsByPath(after, "$.commands", issues);
  for (const [id, prior] of beforeByPath) {
    const next = afterByPath.get(id);
    if (next === undefined) {
      issues.push(`$.commands[path=${id}]: removed`);
      continue;
    }
    compareCliCommand(prior, next, `$.commands[path=${id}]`, issues);
  }
  return issues;
}

/** Every existing conventions value is immutable; new object members may join. */
function compareImmutableObjectSubset(
  previous: JsonValue,
  current: JsonValue | undefined,
  path: string,
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
  for (const [key, prior] of Object.entries(previous)) {
    const next = current[key];
    const childPath = pathKey(path, key);
    if (next === undefined) {
      issues.push(`${childPath}: removed`);
    } else {
      compareImmutableObjectSubset(prior, next, childPath, issues);
    }
  }
}

/** Validate the small root shape common to every generated manifest. */
export function publicManifestValidityIssues(
  manifest: JsonObject,
  policy: PublicSchemaCompatibility,
  label: string,
): string[] {
  const issues: string[] = [];
  if (manifest.format !== 1) {
    issues.push(`${label}: $.format must be 1`);
  }
  switch (policy) {
    case MCP_TOOLS_COMPATIBILITY_POLICY:
      objectArray(manifest.tools, `${label}: $.tools`, issues);
      if (manifest.resources !== undefined) {
        objectArray(manifest.resources, `${label}: $.resources`, issues);
      }
      break;
    case CLI_COMPATIBILITY_POLICY:
      objectArray(manifest.commands, `${label}: $.commands`, issues);
      if (!isObject(manifest.implicit_flags)) {
        issues.push(`${label}: $.implicit_flags must be an object`);
      }
      break;
    case CONVENTIONS_COMPATIBILITY_POLICY:
      if (!isObject(manifest.git) || !isObject(manifest.providers)) {
        issues.push(`${label}: conventions registries must be objects`);
      }
      if (!isObject(manifest.exit_statuses)) {
        issues.push(`${label}: $.exit_statuses must be an object`);
      }
      if (!isObject(manifest.script_protocols)) {
        issues.push(`${label}: $.script_protocols must be an object`);
      }
      break;
    case CONFIG_SCHEMA_COMPATIBILITY_POLICY:
    case RESULT_SCHEMA_COMPATIBILITY_POLICY:
      issues.push(`${label}: schema policy is not a manifest policy`);
      break;
  }
  return issues;
}

/** Dispatch one same-major manifest comparison to its declared policy. */
export function publicManifestCompatibilityIssues(
  previous: JsonObject,
  current: JsonObject,
  policy: PublicSchemaCompatibility,
): string[] {
  const issues = [
    ...publicManifestValidityIssues(previous, policy, "trunk manifest"),
    ...publicManifestValidityIssues(current, policy, "current manifest"),
  ];
  if (issues.length > 0) return issues;
  // Evolving records are exempt from the same-major rules; compare the stable
  // remainder of both manifests after the complete ones have been validated.
  const stablePrevious = withoutEvolvingMembers(previous);
  const stableCurrent = withoutEvolvingMembers(current);
  switch (policy) {
    case MCP_TOOLS_COMPATIBILITY_POLICY:
      issues.push(
        ...mcpToolsManifestCompatibilityIssues(stablePrevious, stableCurrent),
      );
      break;
    case CLI_COMPATIBILITY_POLICY:
      issues.push(
        ...cliManifestCompatibilityIssues(stablePrevious, stableCurrent),
      );
      break;
    case CONVENTIONS_COMPATIBILITY_POLICY:
      compareImmutableObjectSubset(stablePrevious, stableCurrent, "$", issues);
      break;
    case CONFIG_SCHEMA_COMPATIBILITY_POLICY:
    case RESULT_SCHEMA_COMPATIBILITY_POLICY:
      issues.push("schema policy is not a manifest policy");
      break;
  }
  return issues;
}
