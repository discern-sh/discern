/**
 * Vocabulary-signal measurement — the logic behind `[standards.vocabulary]`'s
 * `vocabulary_debt` metric (scripts/vocab_signals_lib.ts), proven against
 * fixture maps: dead terms, textual and link references, plural and variant
 * matching, the `_`-tree and glossary-page exclusions, and the bold-linked
 * emphasis that a redefinition finding sanctions.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import type { GlossaryEntry } from "../scripts/glossary_registry.ts";
import {
  GLOSSARY_PAGE_REL,
  measureVocabSignals,
  redefinitionPattern,
  referencePattern,
} from "../scripts/vocab_signals_lib.ts";

const FIXTURE: GlossaryEntry[] = [
  { term: "Gate", definition: "The full check." },
  { term: "Trunk", definition: "The shared branch." },
  { term: "Gate job", definition: "One kind of gate work." },
  { term: "Widget", definition: "A term no page uses." },
];

async function fixtureMap(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "vocab_signals_" });
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, text);
  }
  return dir;
}

Deno.test("vocab signals: dead terms, link-only references, plurals, and redefinitions", async () => {
  const dir = await fixtureMap({
    // The definition site: excluded, so defining a term never counts as using it.
    [GLOSSARY_PAGE_REL]:
      "# Glossary\n\n### Gate\n\n### Trunk\n\n### Gate job\n\n### Widget\n",
    "10-topic/page.md": [
      "---",
      "title: Page",
      "---",
      "",
      "# Page",
      "",
      "The gate runs the declared gate jobs.",
      "",
      "Land on the [shared branch](../00-orientation/glossary.md#trunk).",
      "",
      "**Gate** — the project's full quality check.",
      "",
      "**[Gate](../00-orientation/glossary.md#gate)** — linked emphasis is sanctioned.",
    ].join("\n"),
    // `_`-trees are dated or private records: a use there keeps nothing alive.
    "_private/notes.md": "Widget widgets everywhere.",
  });
  try {
    const signals = await measureVocabSignals(dir, FIXTURE);
    assertEquals(signals.deadTerms, ["Widget"]);
    assertEquals(signals.redefinitions, [
      { file: "10-topic/page.md", line: 11, term: "Gate" },
    ]);
    assertEquals(signals.debt, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("vocab signals: reference matching drops a leading The, splits slashed terms, and wraps lines", () => {
  assert(referencePattern("The example file").test("the example\nfiles"));
  assert(referencePattern("Widget / Gizmo").test("one gizmo"));
  assert(referencePattern("Gate job").test("three gate jobs"));
  assert(
    !referencePattern("Gate").test("delegates delegate"),
    "a term inside another word is not a reference",
  );
});

Deno.test("vocab signals: bold emphasis is a redefinition unless it links the entry", () => {
  const pattern = redefinitionPattern("Gate");
  assert(pattern.test("**Gate** — the full check"));
  assert(redefinitionPattern("Gate").test("**the gate**: the full check"));
  assertEquals(
    "**[Gate](../00-orientation/glossary.md#gate)** — the full check".match(
      pattern,
    ),
    null,
  );
});
