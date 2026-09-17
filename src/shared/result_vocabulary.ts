/**
 * Runtime enums for the published output vocabularies.
 *
 * `result.ts` registers every output vocabulary with its key, name, and
 * members. This module turns a registry entry into the Zod enum a strict writer
 * schema uses, binding the enum to its key in a dedicated registry. That
 * binding is never global metadata: Zod's own JSON Schema conversion, which the
 * MCP server uses to advertise output schemas, carries nothing extra, and only
 * the public generators stamp the `x-discern-vocabulary` keyword through
 * {@link stampResultVocabulary}.
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
