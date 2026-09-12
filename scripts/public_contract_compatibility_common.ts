/** Shared JSON primitives for public schema and registry-manifest ratchets. */

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
