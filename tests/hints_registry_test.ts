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

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  appendHintTexts,
  defineHint,
  failureRecoveryHint,
  fire,
  firedHintsFromTexts,
  type HintAudience,
  HINTS,
  hintTexts,
  interactiveHints,
  interactiveHintTexts,
  mergeHintTexts,
} from "../src/shared/hints.ts";
import { RETIRED_COMMAND_REDIRECTS } from "../src/shared/vocabulary.ts";
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

const PROJECTED_HINT = defineHint<{ path: string }>({
  id: "test-interactive-projection",
  category: "next-step",
  audience: "all",
  example: { path: "src/shared.ts" },
  template: (p): string => `Inspect data.paths for ${p.path}.`,
  interactiveTemplate: (p): string =>
    `Inspect ${p.path} in the attention block.`,
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

Deno.test("interactive hint wording changes the terminal projection without changing the wire", () => {
  const fired = fire(PROJECTED_HINT, { path: "src/shared.ts" });
  const texts = hintTexts([fired]);
  assertEquals(texts, ["Inspect data.paths for src/shared.ts."]);
  assertEquals(interactiveHintTexts(texts), [
    "Inspect src/shared.ts in the attention block.",
  ]);
  assertEquals(interactiveHints([fired]).map((hint) => hint.text), [
    "Inspect src/shared.ts in the attention block.",
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

Deno.test("failure recovery never fabricates a command from the result verb", () => {
  const verbs = [
    "discern",
    "zz-future-unusual-verb",
    ...Object.keys(RETIRED_COMMAND_REDIRECTS),
  ];
  const baseline = failureRecoveryHint("doctor").text;
  for (const verb of verbs) {
    const recovery = failureRecoveryHint(verb).text;
    assertEquals(
      recovery,
      baseline,
      `failure recovery must not derive instructions from ${verb}`,
    );
    assert(
      !recovery.includes(`discern ${verb}`),
      `failure recovery fabricated a command from ${verb}: ${recovery}`,
    );
  }
});

Deno.test("proof relay hints require the system-rendered line verbatim", () => {
  const relayFields = [
    ["gate-relay-proof", "data.proof.line"],
    ["status-ready-for-review", "data.gate_proof.proof.line"],
    ["accept-relay-landing-proof", "data.proof_line"],
  ] as const;
  for (const [id, field] of relayFields) {
    const def = HINTS[id];
    const rendered = def.template(def.example as never);
    assertStringIncludes(rendered, `\`${field}\``);
    assertStringIncludes(rendered, "verbatim");
  }
});

// The projections resolve audience from the live registry by id, so these
// behavior tests fire real entries — one from each audience — rather than
// local definitions the registry cannot know.
Deno.test("the interactive projections drop agent-audience entries and keep the rest", () => {
  const entries = Object.values(HINTS) as unknown as readonly {
    id: string;
    audience: HintAudience;
    example: unknown;
    template: (params: unknown) => string;
  }[];
  const agentEntry = entries.find((e) => e.audience === "agent");
  const allEntry = entries.find((e) => e.audience === "all");
  assert(agentEntry !== undefined, "registry has no agent-audience entry");
  assert(allEntry !== undefined, "registry has no all-audience entry");
  const agentFired = {
    id: agentEntry.id,
    text: agentEntry.template(agentEntry.example),
  };
  const allFired = {
    id: allEntry.id,
    text: allEntry.template(allEntry.example),
  };

  assertEquals(interactiveHints([agentFired, allFired]), [allFired]);

  const texts = mergeHintTexts(
    hintTexts([agentFired, allFired]),
    ["unassociated advisory text"],
  );
  assertEquals(interactiveHintTexts(texts), [
    allFired.text,
    "unassociated advisory text",
  ]);
  assertEquals(interactiveHintTexts(undefined), []);
});

// The class guard: every agent-audience entry — current and future — provably
// stays off the interactive surface, and every all-audience entry provably
// reaches it. Iterates the live registry, so a new entry auto-enrols.
Deno.test("every registry entry's audience decides its interactive rendering", () => {
  for (const [key, def] of Object.entries(HINTS)) {
    const entry = def as {
      audience: HintAudience;
      example: unknown;
      template: (params: unknown) => string;
      id: string;
    };
    const fired = { id: entry.id, text: entry.template(entry.example) };
    const projected = interactiveHintTexts(hintTexts([fired]));
    if (entry.audience === "agent") {
      assertEquals(
        projected,
        [],
        `${key} is agent-audience but survives the interactive projection`,
      );
    } else {
      assertEquals(
        projected,
        [fired.text],
        `${key} is all-audience but the interactive projection dropped it`,
      );
    }
  }
});
