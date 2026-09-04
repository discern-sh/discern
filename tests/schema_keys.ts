/**
 * Every property key a zod schema can publish, for structural guards over a
 * result or configuration contract. The walk descends objects, wrappers
 * (optional, default, nullable, readonly, catch), arrays, records, unions,
 * pipes, tuples, intersections, and lazy schemas, and reports each key with
 * the dotted path it sits at, so a guard can name the exact offending field.
 */

interface SchemaDef {
  readonly type: string;
  readonly shape?: Record<string, unknown>;
  readonly innerType?: unknown;
  readonly element?: unknown;
  readonly valueType?: unknown;
  readonly options?: readonly unknown[];
  readonly items?: readonly unknown[];
  readonly in?: unknown;
  readonly out?: unknown;
  readonly left?: unknown;
  readonly right?: unknown;
  readonly getter?: () => unknown;
}

/** One published key and the dotted path that reaches it. */
export interface SchemaKey {
  readonly key: string;
  readonly path: string;
}

/** The zod definition record behind a schema, when the value is one. */
function defOf(schema: unknown): SchemaDef | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  const def = (schema as { def?: unknown }).def;
  return typeof def === "object" && def !== null &&
      typeof (def as { type?: unknown }).type === "string"
    ? def as SchemaDef
    : undefined;
}

/** Collect every key the schema can publish, depth-bounded against cycles. */
export function schemaKeys(schema: unknown, root = "$"): SchemaKey[] {
  const keys: SchemaKey[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > 24) return;
    const def = defOf(node);
    if (def === undefined) return;
    switch (def.type) {
      case "object":
        for (const [key, child] of Object.entries(def.shape ?? {})) {
          keys.push({ key, path: `${path}.${key}` });
          walk(child, `${path}.${key}`, depth + 1);
        }
        return;
      case "optional":
      case "default":
      case "nullable":
      case "readonly":
      case "catch":
      case "nonoptional":
      case "prefault":
        walk(def.innerType, path, depth + 1);
        return;
      case "array":
        walk(def.element, `${path}[]`, depth + 1);
        return;
      case "record":
        walk(def.valueType, `${path}.*`, depth + 1);
        return;
      case "union":
        for (const option of def.options ?? []) walk(option, path, depth + 1);
        return;
      case "tuple":
        for (const item of def.items ?? []) walk(item, `${path}[]`, depth + 1);
        return;
      case "pipe":
        walk(def.in, path, depth + 1);
        walk(def.out, path, depth + 1);
        return;
      case "intersection":
        walk(def.left, path, depth + 1);
        walk(def.right, path, depth + 1);
        return;
      case "lazy":
        walk(def.getter?.(), path, depth + 1);
        return;
      default:
        return;
    }
  };
  walk(schema, root, 0);
  return keys;
}
