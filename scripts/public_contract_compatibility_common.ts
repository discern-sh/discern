/** Shared JSON primitives for public schema and registry-manifest ratchets. */

import {
  MANIFEST_STABILITY_FIELD,
  PUBLIC_SCHEMA_STABILITY_KEY,
  STABILITY_TIER_EVOLVING,
} from "../src/shared/public_schemas.ts";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/** Narrow an optional JSON value to a non-null, non-array object. */
export function isObject(
  value: JsonValue | undefined,
): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialize an optional JSON fragment for exact comparison and diagnostics. */
export function json(value: JsonValue | undefined): string {
  return JSON.stringify(value);
}

/** Compare JSON fragments by their stable serialization. */
export function sameJson(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  return json(left) === json(right);
}

/** Append a property to a readable JSON path using dot or bracket notation. */
export function pathKey(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

/** Validate an all-string JSON array and sort it for set comparison. */
export function stringSet(
  value: JsonValue | undefined,
): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some((member) => typeof member !== "string")
  ) {
    return undefined;
  }
  return value.map((member) => member as string).sort();
}

/** Documentation at a JSON Schema node; names inside instance data remain structural. */
export const JSON_SCHEMA_DOCUMENTATION_KEYS: ReadonlySet<string> = new Set([
  "$comment",
  "description",
  "examples",
  "title",
]);

/** Project only schema documentation away, preserving literal values and property names. */
export function withoutSchemaDocumentation(
  value: JsonValue | undefined,
): JsonValue | undefined {
  if (Array.isArray(value)) {
    return value.map((schema) => withoutSchemaDocumentation(schema) ?? schema);
  }
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (JSON_SCHEMA_DOCUMENTATION_KEYS.has(key)) continue;
    switch (key) {
      case "properties":
      case "patternProperties":
      case "$defs":
      case "definitions":
      case "dependentSchemas":
      case "dependencies":
        result[key] = isObject(child)
          ? Object.fromEntries(
            Object.entries(child).map((
              [name, schema],
            ) => [name, withoutSchemaDocumentation(schema) ?? schema]),
          )
          : child;
        break;
      case "oneOf":
      case "anyOf":
      case "allOf":
      case "prefixItems":
        result[key] = Array.isArray(child)
          ? child.map((schema) => withoutSchemaDocumentation(schema) ?? schema)
          : child;
        break;
      case "items":
      case "additionalItems":
      case "unevaluatedItems":
      case "additionalProperties":
      case "unevaluatedProperties":
      case "contains":
      case "not":
      case "if":
      case "then":
      case "else":
      case "propertyNames":
        result[key] = withoutSchemaDocumentation(child) ?? child;
        break;
      default:
        result[key] = child;
    }
  }
  return result;
}

/** Whether a node carries the evolving tier under the given field or keyword. */
function isEvolving(value: JsonValue | undefined, marker: string): boolean {
  return isObject(value) && value[marker] === STABILITY_TIER_EVOLVING;
}

const DEFINITION_REFERENCE_PREFIX = "#/$defs/";

/** The root definition a local reference names, when it names one directly. */
function referencedDefinition(reference: string): string | undefined {
  if (!reference.startsWith(DEFINITION_REFERENCE_PREFIX)) return undefined;
  const name = reference.slice(DEFINITION_REFERENCE_PREFIX.length);
  return name.length === 0 || name.includes("/") ? undefined : name;
}

/** Whether an alternative is one local reference plus documentation only. */
function pureReferenceTo(
  value: JsonValue,
  names: ReadonlySet<string>,
): boolean {
  if (!isObject(value) || typeof value.$ref !== "string") return false;
  const name = referencedDefinition(value.$ref);
  return name !== undefined && names.has(name) &&
    Object.keys(value).every((key) =>
      key === "$ref" || JSON_SCHEMA_DOCUMENTATION_KEYS.has(key)
    );
}

/** Every root definition a value references, directly or through other definitions. */
function reachableDefinitions(
  value: JsonValue,
  definitions: JsonObject,
): Set<string> {
  const reached = new Set<string>();
  const visit = (node: JsonValue): void => {
    if (typeof node === "string") {
      const name = referencedDefinition(node);
      if (name === undefined || reached.has(name)) return;
      reached.add(name);
      const definition = definitions[name];
      if (definition !== undefined) visit(definition);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isObject(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return reached;
}

/**
 * Remove every evolving member from one artifact, recursively: properties
 * whose node carries the stability keyword (and their `required` mentions),
 * root definitions carrying it, and any `oneOf` or `anyOf` alternative that is
 * a pure reference to a removed definition. `removed` collects the definition
 * names so the caller can retire the definitions those members alone kept alive.
 */
function pruneEvolvingNodes(
  value: JsonValue,
  removed: Set<string>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => pruneEvolvingNodes(entry, removed));
  }
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$defs" && isObject(child)) {
      const kept: JsonObject = {};
      for (const [name, definition] of Object.entries(child)) {
        if (isEvolving(definition, PUBLIC_SCHEMA_STABILITY_KEY)) {
          removed.add(name);
        } else {
          kept[name] = pruneEvolvingNodes(definition, removed);
        }
      }
      result[key] = kept;
      continue;
    }
    if (key === "properties" && isObject(child)) {
      const kept: JsonObject = {};
      const dropped = new Set<string>();
      for (const [name, property] of Object.entries(child)) {
        if (isEvolving(property, PUBLIC_SCHEMA_STABILITY_KEY)) {
          dropped.add(name);
        } else {
          kept[name] = pruneEvolvingNodes(property, removed);
        }
      }
      result[key] = kept;
      if (dropped.size > 0 && Array.isArray(value.required)) {
        result.required = value.required.filter((name) =>
          typeof name !== "string" || !dropped.has(name)
        );
      }
      continue;
    }
    if (key === "required" && result.required !== undefined) continue;
    result[key] = pruneEvolvingNodes(child, removed);
  }
  return result;
}

/** Drop pure-reference alternatives that point at retired definitions. */
function withoutReferencesTo(
  value: JsonValue,
  names: ReadonlySet<string>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => withoutReferencesTo(entry, names));
  }
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = (key === "oneOf" || key === "anyOf") && Array.isArray(child)
      ? child
        .filter((alternative) => !pureReferenceTo(alternative, names))
        .map((alternative) => withoutReferencesTo(alternative, names))
      : withoutReferencesTo(child, names);
  }
  return result;
}

/**
 * Project an artifact onto its stable members. Evolving records leave the
 * root arrays (contract metadata, commands, tools), evolving definitions and
 * properties leave the schema with every pure reference to them, and a
 * definition that only evolving members reached is retired with them; a
 * definition a stable member still reaches survives. Comparators compare the
 * projected baseline with the projected current artifact, so an evolving
 * member may change or disappear freely, graduation appears as an addition,
 * and demotion appears as a removal of the member it demotes.
 */
export function withoutEvolvingMembers(artifact: JsonObject): JsonObject {
  const { $defs: definitions, ...body } = artifact;
  const completeDefinitions = isObject(definitions) ? definitions : {};
  const reachableBefore = reachableDefinitions(body, completeDefinitions);
  const removed = new Set<string>();
  const prunedRoot: JsonObject = {};
  for (const [key, value] of Object.entries(artifact)) {
    prunedRoot[key] = Array.isArray(value)
      ? value.filter((entry) => !isEvolving(entry, MANIFEST_STABILITY_FIELD))
      : value;
  }
  const pruned = pruneEvolvingNodes(prunedRoot, removed);
  if (!isObject(pruned)) return artifact;
  const detached = withoutReferencesTo(pruned, removed);
  if (!isObject(detached) || !isObject(detached.$defs)) {
    return isObject(detached) ? detached : artifact;
  }
  const { $defs: remaining, ...detachedBody } = detached;
  const reachableAfter = reachableDefinitions(detachedBody, remaining);
  const retired: JsonObject = {};
  for (const [name, definition] of Object.entries(remaining)) {
    if (reachableBefore.has(name) && !reachableAfter.has(name)) continue;
    retired[name] = definition;
  }
  // Keep the artifact's own key order so comparison diagnostics read in the
  // order the artifact is written.
  return Object.fromEntries(
    Object.entries(detached).map((
      [key, value],
    ) => [key, key === "$defs" ? retired : value]),
  );
}
