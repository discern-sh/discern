import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  GLOSSARY,
  renderGlossaryDoc,
  sortedGlossary,
} from "../scripts/glossary_registry.ts";
import { KNOWN_CAPABILITIES, STAGES } from "../src/shared/capabilities.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

// These prove the committed glossary page stays in lockstep with the term
// registry (the same drift-guard discipline as the config and CLI references):
// a registry change that isn't regenerated (`deno task codegen`) fails here, in
// the gate's test stage.

Deno.test("the configured map's glossary matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    `${REPO_AUTHORED_PATHS.map}/00-orientation/glossary.md`,
  );
  assertEquals(
    committed,
    renderGlossaryDoc(),
    `${REPO_AUTHORED_PATHS.mapRel}/00-orientation/glossary.md is stale — run \`deno task codegen\``,
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

Deno.test("the glossary defines the receipt and test concepts directly", () => {
  for (const term of ["Receipt", "Test"]) {
    assert(
      GLOSSARY.some((entry) => entry.term === term),
      `the glossary must define ${term}`,
    );
  }
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

Deno.test("the capability entry closes over exactly the live capability vocabulary", () => {
  const entry = GLOSSARY.find((e) => e.term === "Capability");
  assert(entry !== undefined, "the glossary must define Capability");
  for (const name of Object.keys(KNOWN_CAPABILITIES)) {
    assertStringIncludes(
      entry.definition,
      `\`${name}\``,
      `the Capability entry must name the ${name} capability — it interpolates KNOWN_CAPABILITIES`,
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
