/**
 * Every output enum discern publishes carries a registered role. Open
 * vocabularies widen to strings and publish their members at the root; closed
 * decision vocabularies stay enums; an enum registered in neither fails here
 * before it can ship unclassified. The registries themselves are held sane:
 * disjoint keys, unique names, unique members, and no vocabulary that no
 * publication uses.
 */

import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { buildCurrentPublicSchema } from "../scripts/public_schema_compatibility.ts";
import {
  PUBLIC_SCHEMA_EXTENSION_KEYWORDS,
  PUBLIC_SCHEMA_PUBLICATIONS,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
} from "../src/shared/public_schemas.ts";
import {
  RESULT_DECISION_VOCABULARIES,
  RESULT_OPEN_VOCABULARIES,
  RESULT_VOCABULARY_KEYWORD,
  type ResultVocabulary,
} from "../src/shared/result.ts";
import { publicOutputSchema } from "../src/shared/result_codegen.ts";
import {
  decisionVocabulary,
  isDecisionVocabularyKey,
  isOpenVocabularyKey,
  openVocabulary,
  stampResultVocabulary,
  withOpenVocabulariesAsStrings,
} from "../src/shared/result_vocabulary.ts";

import { jsonObjects } from "./json_objects.ts";

type JsonObject = Record<string, unknown>;

/** Narrow unknown JSON to an object record. */
function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OUTPUT_PUBLICATIONS = PUBLIC_SCHEMA_PUBLICATIONS.filter((publication) =>
  publication.compatibility === RESULT_SCHEMA_COMPATIBILITY_POLICY
);

const LIVE_OUTPUT_SCHEMAS = OUTPUT_PUBLICATIONS.map((publication) => ({
  artifact: publication.artifactPath,
  schema: buildCurrentPublicSchema(publication),
}));

Deno.test("the vocabulary registries are disjoint, uniquely named, and non-empty", () => {
  const openKeys = Object.keys(RESULT_OPEN_VOCABULARIES);
  const decisionKeys = Object.keys(RESULT_DECISION_VOCABULARIES);
  assertEquals(
    openKeys.filter((key) => decisionKeys.includes(key)),
    [],
    "a key names one role only",
  );
  const entries: [string, ResultVocabulary][] = [
    ...Object.entries(RESULT_OPEN_VOCABULARIES),
    ...Object.entries(RESULT_DECISION_VOCABULARIES),
  ];
  const names = entries.map(([, vocabulary]) => vocabulary.name);
  assertEquals(new Set(names).size, names.length, "names are unique");
  for (const [key, vocabulary] of entries) {
    assert(
      /^x-discern-[a-z0-9-]+$/.test(key),
      `${key} is a root extension key`,
    );
    assert(
      /^[A-Z][A-Za-z0-9]+$/.test(vocabulary.name),
      `${key} names PascalCase`,
    );
    assert(vocabulary.values.length > 0, `${key} has members`);
    assertEquals(
      new Set(vocabulary.values).size,
      vocabulary.values.length,
      `${key} members are unique`,
    );
  }
});

Deno.test("an open vocabulary publishes as a string with its members at the root; a closed one stays an enum", () => {
  const schema = z.strictObject({
    kind: openVocabulary("x-discern-step-kinds"),
    nested: z.array(z.strictObject({
      disposition: openVocabulary("x-discern-step-dispositions").optional(),
      outcome: decisionVocabulary("x-discern-step-outcomes"),
    })),
  });
  const generated = z.json().parse(z.toJSONSchema(schema, {
    io: "output",
    override: stampResultVocabulary,
  }));
  assert(
    typeof generated === "object" && generated !== null &&
      !Array.isArray(generated),
  );
  const published = publicOutputSchema(generated);
  const properties = published.properties;
  assert(isRecord(properties));
  assertEquals(properties.kind, {
    type: "string",
    [RESULT_VOCABULARY_KEYWORD]: "x-discern-step-kinds",
  });
  const item = isRecord(properties.nested) && isRecord(properties.nested.items)
    ? properties.nested.items
    : undefined;
  assert(isRecord(item) && isRecord(item.properties));
  assertEquals(item.properties.disposition, {
    type: "string",
    [RESULT_VOCABULARY_KEYWORD]: "x-discern-step-dispositions",
  });
  assertEquals(item.properties.outcome, {
    type: "string",
    enum: [...RESULT_DECISION_VOCABULARIES["x-discern-step-outcomes"].values],
    [RESULT_VOCABULARY_KEYWORD]: "x-discern-step-outcomes",
  });
  assertEquals(
    published["x-discern-step-kinds"],
    [...RESULT_OPEN_VOCABULARIES["x-discern-step-kinds"].values],
  );
  assertEquals(
    published["x-discern-step-dispositions"],
    [...RESULT_OPEN_VOCABULARIES["x-discern-step-dispositions"].values],
  );
  assertEquals(published["x-discern-step-outcomes"], undefined);
  assertEquals(
    Object.keys(published).filter((key) => key.startsWith("x-discern-")),
    ["x-discern-step-kinds", "x-discern-step-dispositions"],
    "root keys follow registry order and name only the vocabularies used",
  );

  // Zod's own conversion, which the MCP server advertises, carries no marker.
  const plain = z.toJSONSchema(schema, { io: "output" });
  assert(!JSON.stringify(plain).includes(RESULT_VOCABULARY_KEYWORD));
});

Deno.test("every enum in a published output schema is a registered closed vocabulary, and every open one is a string", () => {
  const offenders: string[] = [];
  for (const { artifact, schema } of LIVE_OUTPUT_SCHEMAS) {
    for (const { path, value: node } of jsonObjects(schema)) {
      const marker = node[RESULT_VOCABULARY_KEYWORD];
      if (Array.isArray(node.enum)) {
        if (typeof marker !== "string") {
          offenders.push(`${artifact}:${path} enum carries no vocabulary key`);
        } else if (!isDecisionVocabularyKey(marker)) {
          offenders.push(
            `${artifact}:${path} enum names ${marker}, not a closed vocabulary`,
          );
        } else {
          const expected = [...RESULT_DECISION_VOCABULARIES[marker].values];
          if (JSON.stringify(node.enum) !== JSON.stringify(expected)) {
            offenders.push(
              `${artifact}:${path} enum differs from the ${marker} registry`,
            );
          }
        }
        continue;
      }
      if (typeof marker !== "string") continue;
      if (!isOpenVocabularyKey(marker)) {
        offenders.push(
          `${artifact}:${path} names ${marker}, which is registered nowhere`,
        );
      } else if (node.type !== "string") {
        offenders.push(`${artifact}:${path} open vocabulary is not a string`);
      }
    }
  }
  assertEquals(offenders, [], offenders.join("\n"));
});

Deno.test("every open vocabulary a schema uses publishes its registry members at the root, and no vocabulary is unused", () => {
  const usedOpen = new Set<string>();
  const usedDecision = new Set<string>();
  for (const { artifact, schema } of LIVE_OUTPUT_SCHEMAS) {
    const referenced = new Set<string>();
    for (const { value: node } of jsonObjects(schema)) {
      const marker = node[RESULT_VOCABULARY_KEYWORD];
      if (typeof marker !== "string") continue;
      if (isOpenVocabularyKey(marker)) referenced.add(marker);
      if (isDecisionVocabularyKey(marker)) usedDecision.add(marker);
    }
    for (const [key, vocabulary] of Object.entries(RESULT_OPEN_VOCABULARIES)) {
      if (referenced.has(key)) {
        usedOpen.add(key);
        assertEquals(
          schema[key],
          [...vocabulary.values],
          `${artifact} publishes ${key} exactly as registered`,
        );
      } else {
        assertEquals(
          schema[key],
          undefined,
          `${artifact} publishes only the vocabularies it uses`,
        );
      }
    }
  }
  assertEquals(
    Object.keys(RESULT_OPEN_VOCABULARIES).filter((key) => !usedOpen.has(key)),
    [],
    "an open vocabulary no publication uses is dead",
  );
  assertEquals(
    Object.keys(RESULT_DECISION_VOCABULARIES).filter((key) =>
      !usedDecision.has(key)
    ),
    [],
    "a closed vocabulary no publication uses is dead",
  );
});

Deno.test("strict public-schema compilers accept the vocabulary marker and every open root key", () => {
  assert(PUBLIC_SCHEMA_EXTENSION_KEYWORDS.includes(RESULT_VOCABULARY_KEYWORD));
  for (const key of Object.keys(RESULT_OPEN_VOCABULARIES)) {
    assert(PUBLIC_SCHEMA_EXTENSION_KEYWORDS.includes(key), key);
  }
});

Deno.test("the reader projection widens open vocabularies only and keeps every other constraint", () => {
  const writer = z.strictObject({
    kind: openVocabulary("x-discern-step-kinds"),
    outcome: decisionVocabulary("x-discern-step-outcomes"),
    drops: z.array(z.strictObject({
      reason: openVocabulary("x-discern-policy-checkpoint-drop-reasons"),
    })).min(1),
    source: openVocabulary("x-discern-consent-sources").optional(),
  }).refine((value) => value.drops.length < 3, "at most two drops");
  const reader = withOpenVocabulariesAsStrings(writer);
  const future = {
    kind: "future-kind",
    outcome: "ok",
    drops: [{ reason: "future_reason" }],
    source: "future-grant",
  };
  assert(reader.safeParse(future).success, "open members read as opaque");
  assert(!writer.safeParse(future).success, "the writer stays strict");
  assert(
    !reader.safeParse({ ...future, outcome: "future" }).success,
    "a closed vocabulary still refuses an unknown member",
  );
  assert(
    !reader.safeParse({ ...future, extra: true }).success,
    "object strictness survives",
  );
  assert(
    !reader.safeParse({ ...future, drops: [] }).success,
    "array constraints survive",
  );
  assert(
    !reader.safeParse({
      ...future,
      drops: [{ reason: "a" }, { reason: "b" }, { reason: "c" }],
    }).success,
    "refinements survive",
  );

  const closedOnly = z.strictObject({
    outcome: decisionVocabulary("x-discern-step-outcomes"),
  });
  assert(
    withOpenVocabulariesAsStrings(closedOnly) === closedOnly,
    "a schema without an open vocabulary is returned unchanged",
  );
});
