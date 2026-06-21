/**
 * Tests for the canonical-block extractor (`src/lib/config_template.ts`), the
 * single source of truth a 5→6 migration reads so it can insert a section —
 * documentation and all — instead of a bare EOF append. Covers the real template
 * (the blocks the migration actually inserts) plus the structural rules on
 * synthetic input (doc-block detection, the inline-doc/[meta] case, body bounds).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  readConfigTemplate,
  sectionBlockFromTemplate,
} from "../src/lib/config_template.ts";
import { REAL_TEMPLATES } from "./helpers.ts";

/** The real committed config template text. */
async function realTemplate(): Promise<string> {
  return await Deno.readTextFile(join(REAL_TEMPLATES, "icculus.toml.tmpl"));
}

Deno.test("extracts a ruled-doc section (features) with its doc block, header, and body", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "features")!;
  assert(block !== undefined, "features block should be found");
  // Leads with the section's documentation paragraph...
  assertStringIncludes(block, "# [features] — toggle whole icculus subsystems");
  // ...then the header...
  assertStringIncludes(block, "\n[features]\n");
  // ...then the body of defaults.
  assertStringIncludes(block, "worktrees = true");
  assertStringIncludes(block, "docs      = true");
  // No surrounding blank lines, and exactly one blank between doc and header.
  assert(!block.startsWith("\n") && !block.endsWith("\n"));
  assertStringIncludes(block, "─\n\n[features]");
});

Deno.test("extracts [guidance] including its {{agents_array}} token (for the caller to fill)", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "guidance")!;
  assertStringIncludes(block, "[guidance]");
  assertStringIncludes(block, 'sources = ["guidance.md"]');
  assertStringIncludes(block, "agents = [{{agents_array}}]");
});

Deno.test("extracts the last section ([recipes]) up to EOF, trailing blanks trimmed", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "recipes")!;
  assertStringIncludes(block, "# [recipes] — your own `icculus` commands");
  assertStringIncludes(block, "\n[recipes]\n");
  assertStringIncludes(block, 'dir = "recipes"');
  assert(!block.endsWith("\n"), "trailing blank lines are trimmed");
});

Deno.test("[meta] is inline-documented: its body holds the comments, no preamble is pulled in", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "meta")!;
  // Starts AT the header — the file preamble above [meta] is not its doc block.
  assert(
    block.startsWith("[meta]"),
    `expected to start at header, got: ${block}`,
  );
  assert(
    !block.includes("the one file that teaches"),
    "preamble not pulled in",
  );
  // The documentation lives inline in the body.
  assertStringIncludes(block, "# The install schema version");
  assertStringIncludes(block, "schema_version =");
});

Deno.test("returns undefined for a section the template does not contain", async () => {
  assertEquals(
    sectionBlockFromTemplate(await realTemplate(), "nope"),
    undefined,
  );
});

Deno.test("does not match a sub-table when asked for the top-level name", () => {
  const t = [
    "[worktree]",
    "enabled = true",
    "",
    "[worktree.db]",
    'clone = ""',
  ].join("\n");
  const block = sectionBlockFromTemplate(t, "worktree")!;
  assertStringIncludes(block, "[worktree]");
  assertStringIncludes(block, "enabled = true");
  assert(!block.includes("[worktree.db]"), "stops before the sub-table header");
});

Deno.test("body ends at the next ruled doc block, not just the next header", () => {
  // A section whose body is followed by the *doc block* of the next section: the
  // ruled `# ───` line must bound the body so the next section's docs aren't
  // swallowed. A leading section keeps [a]'s doc block off the top of the file
  // (so it isn't mistaken for preamble).
  const t = [
    "[pre]",
    "p = 0",
    "",
    "",
    "# ───",
    "# [a] — docs for a",
    "# ───",
    "",
    "[a]",
    "x = 1",
    "",
    "",
    "# ───",
    "# [b] — docs for b",
    "# ───",
    "",
    "[b]",
    "y = 2",
  ].join("\n");
  const block = sectionBlockFromTemplate(t, "a")!;
  assertEquals(block, "# ───\n# [a] — docs for a\n# ───\n\n[a]\nx = 1");
  assert(!block.includes("[b]") && !block.includes("docs for b"));
});

Deno.test("a comment run reaching the top of the file is treated as preamble, not a doc block", () => {
  // Mirrors the real [meta] shape: a file-level preamble, then the first section.
  const t = [
    "# file preamble line 1",
    "# file preamble line 2",
    "",
    "[first]",
    "k = 1",
  ].join("\n");
  const block = sectionBlockFromTemplate(t, "first")!;
  assertEquals(block, "[first]\nk = 1"); // preamble excluded
});

Deno.test("readConfigTemplate resolves the bundled template", async () => {
  const text = await readConfigTemplate();
  assert(text !== undefined, "the bundled template should resolve");
  assertStringIncludes(text!, "[features]");
  assertStringIncludes(text!, "[guidance]");
});
