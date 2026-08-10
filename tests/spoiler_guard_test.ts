/**
 * Spoiler guard — the surprise behind the hidden `triangle` verb survives
 * only while committed text never names the convention it belongs to. The one
 * sanctioned home for that name is the leading comment block of
 * `src/commands/triangle.ts`, where it addresses a reader who has already
 * found the verb.
 *
 * The banned phrase lives here encoded, so the guard is not itself the leak:
 * anyone searching the repo for the phrase finds the sanctioned comment and
 * nothing else. Generated Markdown is deliberately in the scanned universe —
 * a registry string leaking through codegen fails exactly like a hand edit.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { AUTHORED_TEXT_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

/** The phrase, assembled at runtime only; tolerates any word separator. */
const PHRASE = new RegExp(`${atob("ZWFzdGVy")}[\\s-]*${atob("ZWdn")}`, "i");

/** The one file allowed to say it, inside its leading comment block only. */
const SANCTIONED = "src/commands/triangle.ts";

Deno.test("the hidden verb's surprise stays out of committed text", async () => {
  const offenders: string[] = [];
  for (const rel of AUTHORED_TEXT_FILES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    const scanned = rel === SANCTIONED
      ? text.slice(text.indexOf("*/") + "*/".length)
      : text;
    if (PHRASE.test(scanned)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "the surprise leaked into committed text — reword each file the way the " +
      "feature canon's recorded absence does (enigmatic, not explanatory), " +
      `and keep the phrase out of registries that feed codegen:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("spoiler guard: the detector matches the phrase it bans", () => {
  assertMatch(atob("RWFzdGVyIGVnZw=="), PHRASE);
  assertMatch(atob("ZWFzdGVyLWVnZw=="), PHRASE);
  assertMatch(atob("RUFTVEVSICBFR0dT"), PHRASE);
  assert(!PHRASE.test("weave, spinner, gasket, pyramid"));
});

Deno.test("spoiler guard: the sanctioned home still opens its file", async () => {
  const text = await Deno.readTextFile(join(REPO_ROOT, SANCTIONED));
  assert(
    text.startsWith("/**"),
    "the sanctioned file must open with its leading comment block",
  );
  assertMatch(text.slice(0, text.indexOf("*/")), PHRASE);
});
