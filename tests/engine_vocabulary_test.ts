import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import {
  normalizeVerbVariant,
  RETIRED_COMMAND_REDIRECTS,
  retiredCommandMessage,
  VERB_FORM_VARIANTS,
} from "../src/shared/vocabulary.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";

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
