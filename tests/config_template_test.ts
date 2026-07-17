/**
 * Tests for the canonical-block extractor (`src/lib/config_template.ts`), the
 * single source of truth a 5→6 migration reads so it can insert a section —
 * documentation and all — instead of a bare EOF append. Covers the real template
 * (the blocks the migration actually inserts) plus the structural rules on
 * synthetic input (doc-block detection, the inline-doc/[meta] case, body bounds).
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  keyBlockFromTemplate,
  managedBannersFromTemplate,
  readConfigTemplate,
  renameRuledBannerIdentity,
  scanManagedBanners,
  sectionBlockFromTemplate,
  sectionKeyNamesFromTemplate,
  sectionNamesFromTemplate,
} from "../src/lib/config_template.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { RECORD_CONFIG_PATHS } from "../src/lib/config_reconcile.ts";
import { REAL_TEMPLATES } from "./helpers.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";

/** The real committed config template text. */
async function realTemplate(): Promise<string> {
  return await Deno.readTextFile(join(REAL_TEMPLATES, "discern.toml.tmpl"));
}

function agentTargetPairs(
  comment: string,
): Array<{ name: string; target: string }> {
  const pairs: Array<{ name: string; target: string }> = [];
  for (
    const match of comment.matchAll(
      /"([^"]+)"\s*->\s*([A-Za-z0-9_.-]+\.md)\b/g,
    )
  ) {
    const name = match[1];
    const target = match[2];
    assertExists(name);
    assertExists(target);
    pairs.push({ name, target });
  }
  return pairs;
}

Deno.test("extracts a ruled-doc section (skills) with its doc block, header, and body", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "skills");
  assertExists(block, "skills block should be found");
  // Leads with the section's documentation paragraph...
  assertStringIncludes(block, "# [skills] — focused, reusable task playbooks");
  // ...then the header...
  assertStringIncludes(block, "\n[skills]\n");
  // ...then the body of defaults.
  assertStringIncludes(block, 'dir = "discern/skills"');
  // No surrounding blank lines, and exactly one blank between doc and header.
  assert(!block.startsWith("\n") && !block.endsWith("\n"));
  assertStringIncludes(block, "─\n\n[skills]");
});

Deno.test("extracts [guidance] including its {{agents_array}} token (for the caller to fill)", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "guidance");
  assertExists(block);
  assertStringIncludes(block, "[guidance]");
  assertStringIncludes(block, 'sources = ["discern/guidance.md"]');
  assertStringIncludes(block, "agents = [{{agents_array}}]");
});

Deno.test("lists only active template section headers, in file order", async () => {
  assertEquals(sectionNamesFromTemplate(await realTemplate()), [
    "meta",
    "project",
    "repository",
    "map",
    "guidance",
    "skills",
    "capabilities",
    "scopes.docs",
    "worktree",
    "worktree.setup",
    "gate",
    "coupling",
    "scripts",
  ]);
});

Deno.test("extracts a documented key block and section key order", async () => {
  const template = await realTemplate();
  assertEquals(sectionKeyNamesFromTemplate(template, "gate"), [
    "stream",
    "fail_fast",
    "timeout",
  ]);
  const block = keyBlockFromTemplate(template, "gate.fail_fast");
  assertExists(block);
  assertStringIncludes(block, "# Cancel the in-flight sibling commands");
  assertStringIncludes(block, "fail_fast = true");
});

Deno.test("[guidance] template comment names every known agent and guidance target", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "guidance");
  assertExists(block);
  const comment = block.split("\n")
    .filter((line) => line.trimStart().startsWith("#"))
    .join("\n");
  const pairs = agentTargetPairs(comment);
  const listedAgents = pairs.map(({ name }) => name);

  assertEquals(
    new Set(listedAgents).size,
    listedAgents.length,
    "[guidance] template comment must not list an agent twice",
  );
  assertEquals(
    [...listedAgents].sort(),
    [...AGENT_NAMES].sort(),
    "[guidance] template comment must list exactly the AGENT_NAMES members",
  );
  for (const agent of AGENT_NAMES) {
    const pair = pairs.find(({ name }) => name === agent);
    assertExists(pair);
    assertEquals(
      pair.target,
      PROVIDERS[agent].guidanceFile.path,
      `[guidance] template comment has the wrong target for "${agent}"`,
    );
  }
});

Deno.test("extracts the last section ([scripts]) up to EOF, trailing blanks trimmed", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "scripts");
  assertExists(block);
  assertStringIncludes(
    block,
    "# [scripts] — your own executable project scripts",
  );
  assertStringIncludes(block, "\n[scripts]\n");
  assertStringIncludes(block, 'dir = "discern/scripts"');
  assert(!block.endsWith("\n"), "trailing blank lines are trimmed");
});

Deno.test("[meta] is inline-documented: its body holds the comments, no preamble is pulled in", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "meta");
  assertExists(block);
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
  const block = sectionBlockFromTemplate(t, "worktree");
  assertExists(block);
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
  const block = sectionBlockFromTemplate(t, "a");
  assertExists(block);
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
  const block = sectionBlockFromTemplate(t, "first");
  assertExists(block);
  assertEquals(block, "[first]\nk = 1"); // preamble excluded
});

Deno.test("readConfigTemplate resolves the bundled template", async () => {
  const text = await readConfigTemplate();
  assertExists(text, "the bundled template should resolve");
  assertStringIncludes(text, "[guidance]");
  assertStringIncludes(text, "[skills]");
});

const RULE = `# ${"─".repeat(77)}`;

Deno.test("renameRuledBannerIdentity updates an unrelated future identity but preserves ordinary comments", () => {
  const text = [
    RULE,
    "# [legacy_console.jobs] — managed documentation",
    RULE,
    "",
    "# legacy_console stays ordinary project prose here",
    "[legacy_console.jobs.build]",
  ].join("\n");

  const renamed = renameRuledBannerIdentity(
    text,
    "legacy_console",
    "operator_desk",
  );

  assertStringIncludes(renamed, "# [operator_desk.jobs] —");
  assertStringIncludes(
    renamed,
    "# legacy_console stays ordinary project prose here",
  );
});

Deno.test("managedBannersFromTemplate finds a ruled banner for every record family", async () => {
  const banners = managedBannersFromTemplate(
    await realTemplate(),
    RECORD_CONFIG_PATHS,
  );
  assertEquals(
    [...banners.keys()].sort(),
    [...RECORD_CONFIG_PATHS].sort(),
  );
  for (const [family, block] of banners) {
    const lines = block.split("\n");
    assert(/^#\s*─/.test(lines[0] ?? ""), `${family} banner opens with a rule`);
    assert(
      /^#\s*─/.test(lines.at(-1) ?? ""),
      `${family} banner closes with a rule`,
    );
  }
});

Deno.test("scanManagedBanners ignores a fixed-section banner", () => {
  const text = [
    RULE,
    "# [gate] — ergonomics for the parallel gate stages.",
    RULE,
    "",
    "[gate]",
    "stream = false",
  ].join("\n");
  assertEquals(scanManagedBanners(text, RECORD_CONFIG_PATHS), []);
});

Deno.test("scanManagedBanners requires a clean close — a blank breaks the block", () => {
  const text = [
    RULE,
    "# [standards] — quality floors",
    "", // a blank line before the closing rule: not a clean banner
    RULE,
  ].join("\n");
  assertEquals(scanManagedBanners(text, RECORD_CONFIG_PATHS), []);
});

Deno.test("scanManagedBanners bounds a banner at its closing rule, never a following table", () => {
  const text = [
    RULE, // line 0
    "# [standards] — quality floors", // 1
    "#   limit  the floor/ceiling", // 2
    RULE, // 3 — the close
    "",
    "[standards.coverage]",
    "limit = 80",
  ].join("\n");
  assertEquals(scanManagedBanners(text, RECORD_CONFIG_PATHS), [
    { family: "standards", start: 0, end: 3 },
  ]);
});
