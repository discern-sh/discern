/**
 * The scriptorium's entry resolution: every canon entry across the five prose
 * registries enumerates with a source position that really is its own line,
 * lookups tier from exact to forgiving, and field paths classify literals the
 * way the editor relies on (plain strings editable, interpolation locked).
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { REPO_ROOT } from "../scripts/scriptorium/root.ts";
import {
  type CanonEntryRef,
  fieldLeaves,
  fieldTarget,
  findEntries,
  openRegistryProject,
  PROSE_REGISTRIES,
  registryEntries,
} from "../scripts/scriptorium/registry_ast.ts";

const project = openRegistryProject(REPO_ROOT);
const entries = registryEntries(project, REPO_ROOT);

/** Resolve a query that must match exactly one entry. */
function only(query: string): CanonEntryRef {
  const matches = findEntries(entries, query);
  assertEquals(
    matches.length,
    1,
    `expected one match for "${query}", got ${
      matches.map((m) => m.id).join(", ")
    }`,
  );
  const match = matches[0];
  assert(match !== undefined);
  return match;
}

Deno.test("every registry enumerates entries", () => {
  for (const spec of PROSE_REGISTRIES) {
    const count = entries.filter((entry) => entry.registry === spec.name)
      .length;
    assert(count > 0, `registry ${spec.name} enumerated no entries`);
  }
});

Deno.test("every entry's recorded line carries its own quoted identity", async () => {
  const linesByFile = new Map<string, string[]>();
  for (const spec of PROSE_REGISTRIES) {
    if (!linesByFile.has(spec.file)) {
      const text = await Deno.readTextFile(join(REPO_ROOT, spec.file));
      linesByFile.set(spec.file, text.split("\n"));
    }
  }
  for (const entry of entries) {
    const lines = linesByFile.get(entry.file);
    assert(lines !== undefined, `no source lines for ${entry.file}`);
    const line = lines[entry.line - 1];
    assert(
      line !== undefined && line.includes(`"${entry.id}"`),
      `${entry.registry} ${entry.id}: ${entry.file}:${entry.line} reads ${
        JSON.stringify(line)
      }`,
    );
  }
});

Deno.test("ids are unique within each registry", () => {
  for (const spec of PROSE_REGISTRIES) {
    const ids = entries
      .filter((entry) => entry.registry === spec.name)
      .map((entry) => entry.id);
    assertEquals(
      new Set(ids).size,
      ids.length,
      `registry ${spec.name} repeats an id`,
    );
  }
});

Deno.test("lookups tier from exact id to slug to title substring", () => {
  assertEquals(only("proof").registry, "feature");
  assertEquals(only("Proof").registry, "glossary");
  assertEquals(only("file-ownership").title, "File ownership");
  assertEquals(only("reduced-review-burden").registry, "claims");
  assertEquals(only("context-for-the-task").registry, "benefit");
  assertEquals(only("only-better").registry, "practice");
  assertEquals(
    only("worktree").registry,
    "glossary",
    "a slug-tier hit resolves uniquely instead of drowning in substrings",
  );
  const ambiguous = findEntries(entries, "review");
  assert(ambiguous.length > 1, "a broad query should list its matches");
});

Deno.test("field paths resolve and classify the literals the editor handles", () => {
  const proof = only("proof");
  assertEquals(fieldTarget(proof, "what")?.kind, "string");
  assertEquals(fieldTarget(proof, "plain.what")?.kind, "string");
  assertEquals(fieldTarget(proof, "hints")?.kind, "string-array");
  assertEquals(fieldTarget(proof, "missing")?.kind, undefined);

  const interpolated = only("jobs-table");
  assertEquals(fieldTarget(interpolated, "what")?.kind, "template");

  const staged = only("staged-pipeline");
  assertEquals(fieldTarget(staged, "surfaces")?.kind, "computed");

  const benefit = only("context-for-the-task");
  assertEquals(fieldTarget(benefit, "drawsOn")?.kind, "string-array");

  const ownership = only("file-ownership");
  assertEquals(fieldTarget(ownership, "retired.0.pattern")?.kind, "template");
});

Deno.test("field inventories flatten nested accounts without child entries", () => {
  const proof = only("proof");
  const paths = fieldLeaves(proof).map((leaf) => leaf.path);
  assert(paths.includes("what"), "proof.what missing from the inventory");
  assert(paths.includes("plain.what"), "proof.plain.what missing");
  assert(
    paths.every((path) => !path.startsWith("children")),
    "child entries are entries of their own, not fields",
  );

  const tenet = only("only-better");
  const tenetPaths = fieldLeaves(tenet).map((leaf) => leaf.path);
  assert(
    tenetPaths.includes("upheld.enforced"),
    "the tenet's upheld tiers flatten into dotted leaves",
  );
});
