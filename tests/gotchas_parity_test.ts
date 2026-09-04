/**
 * The stack-independent gate traps ship twice: the skeleton seeds them into
 * every new project's gotchas doc, and this repository's map carries the
 * dogfooded copy. The pair drifted — engine failure modes documented on the
 * live page never reached the template, so the gate pointed fresh installs at
 * a page missing the answer. This guard forces the trap inventory to move
 * together: both files must list the same `###` traps, in the same order,
 * under "## Stack-independent traps".
 *
 * Bodies stay free to diverge — the live page may cite ADRs, link engine
 * sources, and speak this repository's stack, none of which ships — and the
 * project-specific section below the inventory is each project's own. Only
 * the trap inventory is held to parity.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { fencedBlocks } from "../src/lib/docs_integrity.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

const TEMPLATE_PATH = join(
  REPO_ROOT,
  "templates",
  "setup",
  "skeleton",
  "map",
  "80-development",
  "done-gate-gotchas.md",
);
const LIVE_PATH = join(
  REPO_AUTHORED_PATHS.map,
  "80-development",
  "done-gate-gotchas.md",
);

const SECTION_HEADING = "## Stack-independent traps";

/** The `###` trap headings under the stack-independent section, in order,
 * ignoring anything inside fenced code. */
function stackIndependentTraps(md: string): string[] {
  const fenced = new Set<number>();
  for (const block of fencedBlocks(md)) {
    for (let i = 0; i < block.lines.length; i += 1) {
      fenced.add(block.startLine + i);
    }
  }
  const lines = md.split("\n");
  const start = lines.indexOf(SECTION_HEADING);
  if (start === -1) return [];
  const traps: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (fenced.has(i + 1)) continue;
    if (line.startsWith("## ")) break;
    if (line.startsWith("### ")) traps.push(line.slice(4).trimEnd());
  }
  return traps;
}

Deno.test("the trap extractor discriminates headings from prose, fences, and later sections", () => {
  const doc = [
    "# T",
    "",
    SECTION_HEADING,
    "",
    "### First trap",
    "",
    "Prose mentioning ### mid-line stays prose.",
    "",
    "```",
    "### a heading-shaped line inside a fence",
    "```",
    "",
    "### Second trap",
    "",
    "## Project-specific traps",
    "",
    "### Not part of the inventory",
  ].join("\n");
  assertEquals(stackIndependentTraps(doc), ["First trap", "Second trap"]);
});

Deno.test("the shipped gotchas template and the live map list the same stack-independent traps", async () => {
  const template = stackIndependentTraps(
    await Deno.readTextFile(TEMPLATE_PATH),
  );
  const live = stackIndependentTraps(await Deno.readTextFile(LIVE_PATH));
  const trunk = (await loadConfig(REPO_ROOT)).repository.trunk;
  const projectedTemplate = template.map((trap) =>
    trap.replaceAll("{{trunk}}", trunk)
  );
  assert(
    template.length > 0,
    `no traps found under "${SECTION_HEADING}" in ${TEMPLATE_PATH}`,
  );
  assertEquals(
    projectedTemplate,
    live,
    "the seeded trap inventory drifted: a stack-independent trap on one page is missing or re-ordered on the other. Backport the entry (generic wording, no internal citations) so both pages carry it.",
  );
});
