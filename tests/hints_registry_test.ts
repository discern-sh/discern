/**
 * The hint-registry machinery and its standing invariants (ADR 0172).
 *
 * The behavior tests exercise `fire`/`hintTexts` through local definitions so
 * they hold regardless of which entries have migrated. The invariant tests
 * iterate the live `HINTS` table, so every entry auto-enrols as it lands:
 * ids must be unique, kebab-case, and match the entry's key. The corpus-level
 * guards (closed set, command-reference validation, renderer parity) build on
 * these and land with the migration.
 */

import { assert, assertEquals } from "@std/assert";
import {
  appendHintTexts,
  defineHint,
  fire,
  firedHintsFromTexts,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../src/shared/hints.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";

const STATIC_HINT = defineHint({
  id: "test-static",
  category: "guardrail",
  audience: "agent",
  example: undefined,
  template: (): string => "A fixed guardrail sentence.",
});

const PARAM_HINT = defineHint<{ branch: string; behind: number }>({
  id: "test-parameterized",
  category: "next-step",
  audience: "all",
  family: "test-family",
  example: { branch: "main", behind: 3 },
  template: (p): string =>
    `Branch is ${p.behind} behind ${p.branch}; run \`discern update\`.`,
});

Deno.test("fire renders a parameterless entry and carries its id", () => {
  const fired = fire(STATIC_HINT);
  assertEquals(fired, {
    id: "test-static",
    text: "A fixed guardrail sentence.",
  });
});

Deno.test("fire renders a parameterized entry from its typed params", () => {
  const fired = fire(PARAM_HINT, { branch: "main", behind: 3 });
  assertEquals(fired.id, "test-parameterized");
  assertEquals(fired.text, "Branch is 3 behind main; run `discern update`.");
});

Deno.test("hintTexts projects the wire shape in firing order", () => {
  const texts = hintTexts([
    fire(PARAM_HINT, { branch: "main", behind: 1 }),
    fire(STATIC_HINT),
  ]);
  assertEquals(texts, [
    "Branch is 1 behind main; run `discern update`.",
    "A fixed guardrail sentence.",
  ]);
});

Deno.test("hint text projection carries local ids through composition without changing the wire", () => {
  const parameterized = fire(PARAM_HINT, { branch: "main", behind: 1 });
  const first = hintTexts([parameterized]);
  const appended = appendHintTexts(first, [fire(STATIC_HINT)]);
  const merged = mergeHintTexts(appended, ["unassociated advisory text"]);

  assertEquals(firedHintsFromTexts(merged), [
    parameterized,
    fire(STATIC_HINT),
  ]);
  assertEquals(merged, [
    "Branch is 1 behind main; run `discern update`.",
    "A fixed guardrail sentence.",
    "unassociated advisory text",
  ]);
  assertEquals(JSON.parse(JSON.stringify(merged)), merged);
});

Deno.test("hint assertions render registry entries with supplied or example params", () => {
  const params = { branch: "release", behind: 2 };
  const result = {
    hints: [fire(PARAM_HINT, params).text],
  };
  assertEquals(
    assertHasHint(result, PARAM_HINT, params),
    fire(PARAM_HINT, params).text,
  );
  assertLacksHint(result, STATIC_HINT);

  const exampleResult = { hints: [fire(PARAM_HINT, PARAM_HINT.example).text] };
  assertHasHint(exampleResult, PARAM_HINT);
});

Deno.test("registry ids are unique, kebab-case, and match their keys", () => {
  const seen = new Set<string>();
  for (const [key, def] of Object.entries(HINTS)) {
    const { id } = def as { id: string };
    assert(!seen.has(id), `duplicate hint id: ${id}`);
    seen.add(id);
    assert(
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id),
      `hint id is not kebab-case: ${id}`,
    );
    assertEquals(id, key, `registry key and id disagree for ${key}`);
  }
});

Deno.test("every registry entry renders non-empty text from its example params", () => {
  for (const [key, def] of Object.entries(HINTS)) {
    const entry = def as {
      example: unknown;
      template: (params: unknown) => string;
    };
    const rendered = entry.template(entry.example);
    assert(rendered.trim().length > 0, `${key} rendered an empty example`);
  }
});
