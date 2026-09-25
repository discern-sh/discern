import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  GLOSSARY,
  glossarySummary,
  renderGlossaryDoc,
  renderManualGlossaryDoc,
  retiredSynonyms,
  sortedGlossary,
} from "../scripts/glossary_registry.ts";
import { renderManualGlossaryArtifact } from "../scripts/glossary_codegen.ts";
import { DISCERN_REPOSITORY_URL } from "../src/shared/brand.ts";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

// These prove the committed glossary page stays in lockstep with the term
// registry (the same drift-guard discipline as the config and CLI references):
// a registry change that isn't regenerated (`deno task codegen`) fails here, in
// the gate's test stage.

Deno.test("the configured map's glossary matches the generator (run `deno task codegen`)", async () => {
  const path = `${REPO_AUTHORED_PATHS.map}/00-orientation/glossary.md`;
  const committed = await Deno.readTextFile(path);
  assertEquals(
    committed,
    await canonicalGeneratedMarkdown(path, renderGlossaryDoc()),
    `${REPO_AUTHORED_PATHS.mapRel}/00-orientation/glossary.md is stale — run \`deno task codegen\``,
  );
});

Deno.test("the public manual's glossary matches the term registry", async () => {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.manual,
  });
  assert(tree !== undefined);
  const manual = await buildManualProjection(tree.entries);
  const path = `${REPO_AUTHORED_PATHS.manual}/30-reference/glossary.md`;
  const rendered = renderManualGlossaryArtifact(manual);
  // Follow-up links work in the offline human manual, down to the section
  // that holds a concept, and none leaves it for the repository.
  for (
    const destination of [
      "../10-understand/proof.md",
      "../10-understand/checkpoints.md",
      "../10-understand/standards.md",
      "../20-guides/write-project-instructions.md",
      "../20-guides/create-and-manage-skills.md",
      "files-and-ownership.md",
      "files-and-ownership.md#registered-project-paths",
      "mcp-and-results.md#progress-handles-and-reconnect",
    ]
  ) {
    assertStringIncludes(rendered, `](${destination})`);
  }
  assert(
    !rendered.includes(DISCERN_REPOSITORY_URL),
    "the manual glossary links no repository page",
  );
  assertEquals(
    await Deno.readTextFile(path),
    await canonicalGeneratedMarkdown(path, rendered),
    `${REPO_AUTHORED_PATHS.manualRel}/30-reference/glossary.md is stale — run \`deno task codegen\``,
  );
});

Deno.test("every term is unique and defined (the registry is a canon, not a list)", () => {
  const seen = new Set<string>();
  for (const { term, definition } of GLOSSARY) {
    const key = term.toLowerCase();
    assert(!seen.has(key), `duplicate glossary term: ${term}`);
    seen.add(key);
    assert(definition.trim().length > 0, `empty definition for: ${term}`);
  }
});

Deno.test("every entry has a one-sentence hover summary without duplicating short definitions", () => {
  assertEquals(
    glossarySummary({
      term: "Fixture",
      definition: "Use `AGENTS.md`, then continue. Full detail follows.",
    }),
    "Use `AGENTS.md`, then continue.",
  );
  assertEquals(
    glossarySummary({
      term: "Fixture",
      summary: "A tighter sentence.",
      definition: "A long first sentence with details. More follows.",
    }),
    "A tighter sentence.",
  );

  for (const entry of GLOSSARY) {
    const summary = glossarySummary(entry);
    assert(summary.trim().length > 0, `empty summary for: ${entry.term}`);
    assert(
      /[.!?]$/u.test(summary),
      `summary is not one complete sentence: ${entry.term}`,
    );
  }
});

Deno.test("the glossary defines the Proof concept directly", () => {
  assert(
    GLOSSARY.some((entry) => entry.term === "Proof"),
    "the glossary must define Proof",
  );
});

Deno.test("the rendered page alphabetizes every entry under its own heading", () => {
  const doc = renderGlossaryDoc();
  let at = -1;
  for (const { term } of sortedGlossary()) {
    const index = doc.indexOf(`### ${term}\n`);
    assert(index !== -1, `no heading rendered for: ${term}`);
    assert(index > at, `entry out of alphabetical order: ${term}`);
    at = index;
  }
});

Deno.test("a future glossary term auto-enrols in the manual heading and search aliases", () => {
  const document = renderManualGlossaryDoc([
    ...GLOSSARY,
    {
      term: "Future contract",
      runningCase: "lowercase",
      plain: { keep: "a synthetic reference term" },
      definition: "A synthetic term proving future glossary enrollment.",
    },
  ]);
  assertStringIncludes(document, "### Future contract");
  const frontmatter = document.split("\n---\n")[0] ?? "";
  assertStringIncludes(frontmatter, "  - future contract");
});

Deno.test("retired guard vocabulary never becomes a glossary search alias", () => {
  const futureRetiredPhrase = "discarded future launcher";
  const glossary = [
    ...GLOSSARY,
    {
      term: "Future contract",
      runningCase: "lowercase" as const,
      plain: { keep: "a synthetic reference term" },
      definition: "A synthetic term proving future glossary enrollment.",
      retired: [{ phrase: futureRetiredPhrase }],
    },
  ];
  const retiredPhrases = [
    ...retiredSynonyms().map(({ synonym }) => synonym.phrase.toLowerCase()),
    futureRetiredPhrase,
  ];

  for (
    const document of [
      renderGlossaryDoc(glossary),
      renderManualGlossaryDoc(glossary),
    ]
  ) {
    const frontmatter = document.split("\n---\n")[0] ?? "";
    assertStringIncludes(frontmatter, "  - future contract");
    assertEquals(
      retiredPhrases.filter((phrase) =>
        frontmatter.includes(`  - ${phrase}\n`)
      ),
      [],
      "retired guard data is internal history, not a public search alias",
    );
  }
});

Deno.test("the gate job entry closes over exactly the live known-job vocabulary", () => {
  const entry = GLOSSARY.find((e) => e.term === "Gate job");
  assert(entry !== undefined, "the glossary must define Gate job");
  for (const name of Object.keys(KNOWN_JOBS)) {
    assertStringIncludes(
      entry.definition,
      `\`${name}\``,
      `the Gate job entry must name the ${name} known job — it interpolates KNOWN_JOBS`,
    );
  }
});

Deno.test("the stage entry closes over exactly the live stage vocabulary", () => {
  const entry = GLOSSARY.find((e) => e.term === "Stage");
  assert(entry !== undefined, "the glossary must define Stage");
  for (const stage of STAGES) {
    assertStringIncludes(
      entry.definition,
      `\`${stage}\``,
      `the Stage entry must name the ${stage} stage — it interpolates STAGES`,
    );
  }
});

Deno.test("every term is a search alias of the generated page", () => {
  const doc = renderGlossaryDoc();
  const frontmatter = doc.split("---\n")[1] ?? "";
  for (const { term } of GLOSSARY) {
    assertStringIncludes(
      frontmatter,
      `  - ${term.toLowerCase()}\n`,
      `"${term}" should be a frontmatter alias so \`discern map\` search reaches the glossary`,
    );
  }
});
