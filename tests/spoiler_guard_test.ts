/**
 * Spoiler guard — the surprise behind the hidden `triangle` verb survives
 * only while committed text never names the convention it belongs to. No
 * committed file says it today; `SANCTIONED` keeps one carve-out in reserve —
 * the leading comment block of `src/commands/triangle.ts` — should the verb
 * ever need to address a reader who has already found it.
 *
 * The banned phrase lives here encoded, so the guard is not itself the leak:
 * anyone searching the repo for the phrase finds nothing at all. Generated
 * Markdown is deliberately in the scanned universe — a registry string
 * leaking through codegen fails exactly like a hand edit.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** The phrase, assembled at runtime only; tolerates any word separator. */
const PHRASE = new RegExp(`${atob("ZWFzdGVy")}[\\s-]*${atob("ZWdn")}`, "i");

/** The one file whose leading comment block may say it, held in reserve. */
const SANCTIONED = "src/commands/triangle.ts";

/** The portion of one file the sweep scans; the sanctioned file forfeits
 * only its leading comment block. */
function scannedPortion(rel: string, text: string): string {
  return rel === SANCTIONED
    ? text.slice(text.indexOf("*/") + "*/".length)
    : text;
}

Deno.test("the hidden verb's surprise stays out of committed text", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/spoiler_guard_test.ts#hidden-surprise-phrase",
      universe: "authored-text",
    })
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (PHRASE.test(scannedPortion(rel, text))) {
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

Deno.test("spoiler guard: the reserve carve-out shields only the leading block", () => {
  const phrase = atob("RWFzdGVyIGVnZw==");
  const shielded = `/**\n * ${phrase} lives here.\n */\nconst x = 1;\n`;
  assert(
    !PHRASE.test(scannedPortion(SANCTIONED, shielded)),
    "the sanctioned file's leading comment block must stay shielded",
  );
  assertMatch(scannedPortion("src/any/other.ts", shielded), PHRASE);
  const leaked = `/** clean */\nconst note = "${phrase}";\n`;
  assertMatch(scannedPortion(SANCTIONED, leaked), PHRASE);
});
