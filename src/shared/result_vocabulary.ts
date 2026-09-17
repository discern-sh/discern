/**
 * Runtime enums for the published output vocabularies.
 *
 * `result.ts` registers every output vocabulary with its key, name, and
 * members. This module turns a registry entry into the Zod enum a strict writer
 * schema uses, binding the enum to its key in a dedicated registry. That
 * binding is never global metadata: Zod's own JSON Schema conversion carries
 * nothing extra, and only the public generators stamp the
 * `x-discern-vocabulary` keyword through {@link stampResultVocabulary}. The
 * proof-note readers and the MCP server's advertised output schemas widen the
 * open vocabularies through {@link withOpenVocabulariesAsStrings}, so a value a
 * newer writer recorded validates at every boundary that carries it.
 */

import { z } from "@zod/zod";
import {
  RESULT_DECISION_VOCABULARIES,
  RESULT_OPEN_VOCABULARIES,
  RESULT_VOCABULARY_KEYWORD,
  type ResultDecisionVocabularyKey,
  type ResultOpenVocabularyKey,
  type ResultVocabularyKey,
} from "./result.ts";

/** Each vocabulary enum instance bound to the registry key it was built from. */
const VOCABULARY_BINDINGS = z.registry<{ readonly key: ResultVocabularyKey }>();

/** The Zod enum whose members are one registry entry's values. */
type VocabularyEnum<Values extends readonly string[]> = z.ZodEnum<
  z.core.util.ToEnum<Values[number]>
>;

/** The strict runtime enum for one open vocabulary. */
export function openVocabulary<K extends ResultOpenVocabularyKey>(
  key: K,
): VocabularyEnum<(typeof RESULT_OPEN_VOCABULARIES)[K]["values"]> {
  return z.enum(RESULT_OPEN_VOCABULARIES[key].values).register(
    VOCABULARY_BINDINGS,
    { key },
  );
}

/** The strict runtime enum for one closed decision vocabulary. */
export function decisionVocabulary<K extends ResultDecisionVocabularyKey>(
  key: K,
): VocabularyEnum<(typeof RESULT_DECISION_VOCABULARIES)[K]["values"]> {
  return z.enum(RESULT_DECISION_VOCABULARIES[key].values).register(
    VOCABULARY_BINDINGS,
    { key },
  );
}

/** Whether a key names an open vocabulary. */
export function isOpenVocabularyKey(
  key: string,
): key is ResultOpenVocabularyKey {
  return Object.hasOwn(RESULT_OPEN_VOCABULARIES, key);
}

/** Whether a key names a closed decision vocabulary. */
export function isDecisionVocabularyKey(
  key: string,
): key is ResultDecisionVocabularyKey {
  return Object.hasOwn(RESULT_DECISION_VOCABULARIES, key);
}

/** The vocabulary key an enum was built from, if it came from this module. */
export function resultVocabularyKey(
  schema: z.core.$ZodType,
): ResultVocabularyKey | undefined {
  return VOCABULARY_BINDINGS.get(schema)?.key;
}

type JsonSchemaOverride = NonNullable<
  NonNullable<Parameters<typeof z.toJSONSchema>[1]>["override"]
>;

/** A `toJSONSchema` override that stamps every vocabulary enum with its key. */
export function stampResultVocabulary(
  context: Parameters<JsonSchemaOverride>[0],
): void {
  const key = resultVocabularyKey(context.zodSchema);
  if (key !== undefined) {
    context.jsonSchema[RESULT_VOCABULARY_KEYWORD] = key;
  }
}

/** Rebuild a schema with the same definition except the named fields. The
 * clone keeps the original's global metadata, so an identified object still
 * hoists into `$defs` and keeps its description when projected. */
function rebuilt<T extends z.ZodType>(schema: T, changes: object): T {
  const definition: T["_zod"]["def"] = { ...schema._zod.def, ...changes };
  const clone = z.core.clone(schema, definition);
  const metadata = schema.meta();
  return metadata === undefined ? clone : clone.meta(metadata);
}

/** Transform every child schema, returning the same instance when none changed. */
function children<T extends z.ZodType>(
  items: readonly T[],
  transform: (schema: z.ZodType) => z.ZodType,
): { changed: boolean; items: z.ZodType[] } {
  let changed = false;
  const next = items.map((item) => {
    const replacement = transform(item);
    changed ||= replacement !== item;
    return replacement;
  });
  return { changed, items: next };
}

/**
 * The reader's projection of a writer schema: every open-vocabulary enum
 * accepts any string, while closed vocabularies, object strictness, refinements
 * and every other constraint stay as written. A schema without an open
 * vocabulary comes back as the same instance. The inferred type keeps the
 * known members, which is why engine code never branches exhaustively on an
 * open vocabulary: a value read from a newer writer may carry a member the
 * type does not name.
 */
export function withOpenVocabulariesAsStrings<T extends z.ZodType>(
  schema: T,
): T {
  const cached = WIDENED.get(schema);
  if (cached !== undefined) return cached as T;
  const widened = widenOpenVocabularies(schema);
  WIDENED.set(schema, widened);
  return widened;
}

/** Each writer schema's projection, so a schema shared by several fields
 * projects to one instance and an identified object keeps a single `$defs`
 * entry when the projection is converted to JSON Schema. */
const WIDENED = new WeakMap<z.ZodType, z.ZodType>();

/** One projection step: rebuild the path to each open enumeration as a string. */
function widenOpenVocabularies<T extends z.ZodType>(schema: T): T {
  const transform = withOpenVocabulariesAsStrings;
  if (schema instanceof z.ZodEnum) {
    const key = resultVocabularyKey(schema);
    if (key === undefined || !isOpenVocabularyKey(key)) return schema;
    const widened: z.ZodType = z.string();
    return widened as T;
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {};
    let changed = false;
    for (const [name, field] of Object.entries(schema.shape)) {
      const replacement = transform(field as z.ZodType);
      changed ||= replacement !== field;
      shape[name] = replacement;
    }
    return changed ? rebuilt(schema, { shape }) : schema;
  }
  if (schema instanceof z.ZodArray) {
    const element = transform(schema.element as z.ZodType);
    return element === schema.element ? schema : rebuilt(schema, { element });
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const innerType = transform(schema.unwrap() as z.ZodType);
    return innerType === schema.unwrap()
      ? schema
      : rebuilt(schema, { innerType });
  }
  if (schema instanceof z.ZodDefault) {
    const innerType = transform(schema.unwrap() as z.ZodType);
    return innerType === schema.unwrap()
      ? schema
      : rebuilt(schema, { innerType });
  }
  if (schema instanceof z.ZodUnion) {
    const options = children(schema.options as readonly z.ZodType[], transform);
    return options.changed
      ? rebuilt(schema, { options: options.items })
      : schema;
  }
  if (schema instanceof z.ZodIntersection) {
    const left = transform(schema._zod.def.left as z.ZodType);
    const right = transform(schema._zod.def.right as z.ZodType);
    return left === schema._zod.def.left && right === schema._zod.def.right
      ? schema
      : rebuilt(schema, { left, right });
  }
  if (schema instanceof z.ZodRecord) {
    const valueType = transform(schema.valueType as z.ZodType);
    return valueType === schema.valueType
      ? schema
      : rebuilt(schema, { valueType });
  }
  if (schema instanceof z.ZodTuple) {
    const items = children(
      schema._zod.def.items as readonly z.ZodType[],
      transform,
    );
    return items.changed ? rebuilt(schema, { items: items.items }) : schema;
  }
  if (schema instanceof z.ZodPipe) {
    const input = transform(schema.in as z.ZodType);
    const output = transform(schema.out as z.ZodType);
    return input === schema.in && output === schema.out
      ? schema
      : rebuilt(schema, { in: input, out: output });
  }
  if (schema instanceof z.ZodLazy) {
    const getter = schema._zod.def.getter;
    return rebuilt(schema, { getter: () => transform(getter() as z.ZodType) });
  }
  return schema;
}
