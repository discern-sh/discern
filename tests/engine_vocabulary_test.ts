import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import {
  COMMAND_SYNONYM_SUGGESTIONS,
  normalizeVerbVariant,
  RETIRED_COMMAND_REDIRECTS,
  retiredCommandMessage,
  unknownCommandMessage,
  VERB_FORM_VARIANTS,
} from "../src/shared/vocabulary.ts";
import { HINTS } from "../src/shared/hints.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

function firstTopLevelRedirect(): [string, string] {
  const entry = Object.entries(RETIRED_COMMAND_REDIRECTS).find(([command]) =>
    !command.includes(" ")
  );
  assertExists(entry);
  return entry;
}

Deno.test("retired command spellings hard-error with their canonical successor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    for (
      const [retired, successor] of Object.entries(
        RETIRED_COMMAND_REDIRECTS,
      )
    ) {
      const retiredTokens = retired.split(" ");
      const result = await runAgent(dir, retiredTokens);
      assertEquals(result.code, 1, result.output);
      assertEquals(
        result.stderr,
        `discern: ${retiredCommandMessage(retired, successor)}\n`,
      );

      const json = await runAgent(dir, [...retiredTokens, "--json"]);
      assertEquals(json.code, 1, json.output);
      assertEquals(JSON.parse(json.stdout), {
        ok: false,
        verb: retired,
        error: "renamed_command",
        message: retiredCommandMessage(retired, successor),
      });
    }
  });
});

Deno.test("a uniquely matching trailing-s variant reaches the canonical command", async () => {
  const [, canonical] = firstTopLevelRedirect();
  const variant = canonical.endsWith("s")
    ? canonical.slice(0, -1)
    : `${canonical}s`;
  assertEquals(normalizeVerbVariant(variant, KNOWN_VERBS), canonical);

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const args = ["--dry-run", "--json"];
    const direct = await runAgent(dir, [canonical, ...args]);
    const forgiven = await runAgent(dir, [variant, ...args]);
    assertEquals(direct.code, 0, direct.output);
    assertEquals(forgiven.code, 0, forgiven.output);
    assertEquals(forgiven.stdout, direct.stdout);
    assertStringIncludes(forgiven.stdout, `"verb":"${canonical}"`);
  });
});

Deno.test("standard silently reaches standards with the same result", async () => {
  assertEquals(normalizeVerbVariant("standard", KNOWN_VERBS), "standards");
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const args = ["--dry-run", "--json"];
    const direct = await runAgent(dir, ["standards", ...args]);
    const forgiven = await runAgent(dir, ["standard", ...args]);
    assertEquals(direct.code, 0, direct.output);
    assertEquals(forgiven.code, direct.code, forgiven.output);
    assertEquals(forgiven.stdout, direct.stdout);
    assertStringIncludes(forgiven.stdout, '"verb":"standards"');
  });
});

Deno.test("explicit grammatical variants reach the same canonical result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    for (const [variant, canonical] of Object.entries(VERB_FORM_VARIANTS)) {
      assertEquals(normalizeVerbVariant(variant, KNOWN_VERBS), canonical);
      const direct = await runAgent(dir, [canonical, "--json"]);
      const forgiven = await runAgent(dir, [variant, "--json"]);
      assertEquals(forgiven.code, direct.code, forgiven.output);
      assertEquals(forgiven.stdout, direct.stdout);
      assertStringIncludes(forgiven.stdout, `"verb":"${canonical}"`);
    }
  });
});

Deno.test("every command synonym suggests its canonical verb on both surfaces", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    for (
      const [synonym, canonical] of Object.entries(COMMAND_SYNONYM_SUGGESTIONS)
    ) {
      const json = await runAgent(dir, [synonym, "--json"]);
      assertEquals(json.code, 1, json.output);
      assertEquals(json.stderr, "", "the --json stream must stay pure");
      const res = JSON.parse(json.stdout);
      assertEquals(res.ok, false);
      assertEquals(res.verb, synonym);
      assertEquals(res.error, "unknown_command");
      assertEquals(res.message, unknownCommandMessage(synonym));
      const suggestion = assertHasHint(
        res,
        HINTS["unknown-command-suggestion"],
        { command: canonical },
      );
      const pointer = assertHasHint(res, HINTS["unknown-command-help"]);
      assertEquals(res.hints, [suggestion, pointer]);

      const human = await runAgent(dir, [synonym]);
      assertEquals(human.code, 1, human.output);
      assertStringIncludes(human.stderr, unknownCommandMessage(synonym));
      assertStringIncludes(human.stderr, suggestion);
      assertStringIncludes(human.stderr, pointer);
    }
  });
});

Deno.test("an unknown word with no suggestion still refuses with a hint under --json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const word = "zzzz-nothing-like-a-verb";
    const json = await runAgent(dir, [word, "--json"]);
    assertEquals(json.code, 1, json.output);
    assertEquals(json.stderr, "", "the --json stream must stay pure");
    const res = JSON.parse(json.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, word);
    assertEquals(res.error, "unknown_command");
    const pointer = assertHasHint(res, HINTS["unknown-command-help"]);
    assertEquals(res.hints, [pointer]);
  });
});

Deno.test("the unknown-command lesson shows even outside a project", async () => {
  await withTempDir(async (dir) => {
    // No scaffold on purpose: a newcomer's very first guess often lands before
    // any discern.toml exists, and must still name the right verb.
    for (
      const [synonym, canonical] of Object.entries(COMMAND_SYNONYM_SUGGESTIONS)
    ) {
      const json = await runAgent(dir, [synonym, "--json"]);
      const suggestion = assertHasHint(
        JSON.parse(json.stdout),
        HINTS["unknown-command-suggestion"],
        { command: canonical },
      );
      const r = await runAgent(dir, [synonym]);
      assertEquals(r.code, 1, r.output);
      assertStringIncludes(r.stderr, unknownCommandMessage(synonym));
      assertStringIncludes(r.stderr, suggestion);
    }
  });
});

Deno.test("synonyms are suggestions only: none dispatches, every suggested verb is canonical", () => {
  for (
    const [synonym, canonical] of Object.entries(COMMAND_SYNONYM_SUGGESTIONS)
  ) {
    assert(
      !KNOWN_VERBS.has(synonym),
      `synonym "${synonym}" must never be a registered verb`,
    );
    assert(
      RETIRED_COMMAND_REDIRECTS[synonym] === undefined,
      `"${synonym}" cannot be both a retired spelling and a synonym`,
    );
    assert(
      normalizeVerbVariant(synonym, KNOWN_VERBS) === synonym,
      `synonym "${synonym}" must not normalize into a verb — that would be a silent forward`,
    );
    assert(
      KNOWN_VERBS.has(canonical),
      `synonym "${synonym}" suggests "${canonical}", which is not a registered verb`,
    );
  }
});

Deno.test("retired spellings are absent from the canonical verb registry", () => {
  for (
    const [retired, successor] of Object.entries(
      RETIRED_COMMAND_REDIRECTS,
    ).filter(([command]) => !command.includes(" "))
  ) {
    assert(!KNOWN_VERBS.has(retired));
    assert(KNOWN_VERBS.has(successor));
  }
});
