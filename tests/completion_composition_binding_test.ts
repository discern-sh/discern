/** Composition binds once; every fixed identity and ordinary claimed subject remains protected. */
import { assert, assertEquals } from "@std/assert";
import {
  COMPLETION_FAMILIES,
  recordTransitionAllowed,
} from "../src/engine/completion/records.ts";
import { writeCompletionRecord } from "../src/engine/completion/store.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_CLOCK,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { withTempDir } from "./helpers.ts";
import { git } from "./engine_helpers.ts";

Deno.test("composition binding changes only subjects once under the identical claim", () => {
  const original = COMPLETION_FAMILIES.attempt.schema.parse(
    completionFixtures().attempt,
  );
  const composing = COMPLETION_FAMILIES.attempt.schema.parse({
    ...original,
    data: {
      ...original.data,
      subjects: [],
      state: { kind: "composing", claim: COMPLETION_CLAIM },
    },
  });
  const bound = { ...original, revision: composing.revision + 1 };
  assert(recordTransitionAllowed(composing, bound));
  assertEquals(
    recordTransitionAllowed(original, {
      ...original,
      revision: original.revision + 1,
      data: { ...original.data, subjects: [] },
    }),
    false,
  );
  assertEquals(
    recordTransitionAllowed(bound, {
      ...composing,
      revision: bound.revision + 1,
    }),
    false,
  );
  const changed = [
    { ...bound, data: { ...bound.data, environment_id: completionId(99) } },
    { ...bound, data: { ...bound.data, mode: "report" as const } },
    { ...bound, data: { ...bound.data, purpose: "diagnostic" as const } },
    {
      ...bound,
      data: {
        ...bound.data,
        identity: {
          ...bound.data.identity,
          sequence: bound.data.identity.sequence + 1,
        },
      },
    },
    {
      ...bound,
      data: {
        ...bound.data,
        state: {
          kind: "claimed" as const,
          claim: { ...COMPLETION_CLAIM, token: completionId(99) },
        },
      },
    },
    {
      ...bound,
      data: {
        ...bound.data,
        state: {
          kind: "claimed" as const,
          claim: {
            ...COMPLETION_CLAIM,
            expires_at: COMPLETION_CLAIM.expires_at + 1,
          },
        },
      },
    },
  ];
  for (const next of changed) {
    assertEquals(recordTransitionAllowed(composing, next), false);
  }
  assertEquals(
    COMPLETION_FAMILIES.attempt.schema.safeParse({
      ...composing,
      data: { ...composing.data, subjects: original.data.subjects },
    }).success,
    false,
  );
});

Deno.test("composing claims cannot publish evidence or Proof", async () => {
  await withTempDir(async (root) => {
    await git(root, "init", "-b", "main");
    const fixtures = completionFixtures();
    const original = COMPLETION_FAMILIES.attempt.schema.parse(fixtures.attempt);
    const composing = COMPLETION_FAMILIES.attempt.schema.parse({
      ...original,
      data: {
        ...original.data,
        subjects: [],
        state: { kind: "composing", claim: COMPLETION_CLAIM },
      },
    });
    const written = await writeCompletionRecord(
      root,
      composing,
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(written.kind === "written");
    const fence = { attempt_id: composing.id, token: COMPLETION_CLAIM.token };
    for (const kind of ["candidate", "evidence", "proof"] as const) {
      const result = await writeCompletionRecord(
        root,
        fixtures[kind],
        null,
        fence,
        COMPLETION_CLOCK,
      );
      assertEquals(
        result.kind,
        kind === "candidate" ? "written" : "claim-lost",
      );
    }
  });
});
