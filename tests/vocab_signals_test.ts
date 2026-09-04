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
import { withTempDir } from "./helpers.ts";

const FIXTURE: GlossaryEntry[] = [
  {
    term: "Gate",
    runningCase: "lowercase",
    definition: "The full check.",
    plain: { keep: "fixture" },
  },
  {
    term: "Trunk",
    runningCase: "lowercase",
    definition: "The shared branch.",
    plain: { keep: "fixture" },
  },
  {
    term: "Gate job",
    runningCase: "lowercase",
    definition: "One kind of gate work.",
    plain: { keep: "fixture" },
  },
  {
    term: "Widget",
    runningCase: "lowercase",
    definition: "A term no page uses.",
    plain: { keep: "fixture" },
  },
];

/** Materialize an isolated documentation corpus in one owned map root. */
async function fixtureMap(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, text);
  }
}

Deno.test("vocab signals: dead terms, link-only references, plurals, and redefinitions", async () => {
  await withTempDir(async (dir) => {
    await fixtureMap(dir, {
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
    const signals = await measureVocabSignals(dir, FIXTURE);
    assertEquals(signals.deadTerms, ["Widget"]);
    assertEquals(signals.redefinitions, [
      { file: "10-topic/page.md", line: 11, term: "Gate" },
    ]);
    assertEquals(signals.debt, 2);
  }, { prefix: "vocab_signals_" });
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

Deno.test("vocab signals ignore hover matching controls", async () => {
  const glossary: GlossaryEntry[] = [
    {
      term: "Update",
      runningCase: "lowercase",
      definition: "The update concept.",
      matches: [],
      plain: { keep: "fixture" },
    },
    {
      term: "Accept",
      runningCase: "lowercase",
      definition: "The accept concept.",
      matches: [],
      plain: { keep: "fixture" },
    },
  ];
  await withTempDir(async (dir) => {
    await fixtureMap(dir, {
      [GLOSSARY_PAGE_REL]: "# Glossary\n\n### Update\n\n### Accept\n",
      "10-topic/page.md": [
        "Update the docs.",
        "",
        "Land with [the command](../00-orientation/glossary.md#accept).",
        "",
        "**Update** — a second definition.",
      ].join("\n"),
    });
    const signals = await measureVocabSignals(dir, glossary);
    assertEquals(signals.deadTerms, []);
    assertEquals(signals.redefinitions, [
      { file: "10-topic/page.md", line: 5, term: "Update" },
    ]);
    assertEquals(signals.debt, 1);
  }, { prefix: "vocab_signals_" });
});
