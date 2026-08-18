/**
 * Tests for the canonical-block extractor (`src/lib/config_template.ts`), the
 * single source of truth upgrade reconciliation reads when restoring a section
 * with its documentation. Covers the real template plus the structural rules on
 * synthetic input: doc-block detection, the inline-doc/[meta] case, and body
 * bounds.
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
  scanManagedBanners,
  sectionBlockFromTemplate,
  sectionKeyNamesFromTemplate,
  sectionNamesFromTemplate,
} from "../src/lib/config_template.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { RECORD_CONFIG_PATHS } from "../src/lib/config_reconcile.ts";
import { indentToml } from "../src/lib/toml_indent.ts";
import { REAL_TEMPLATES } from "./helpers.ts";
import { AGENT_NAMES, configSchema } from "../src/shared/config_schema.ts";

/** The real committed config template text. */
async function realTemplate(): Promise<string> {
  return await Deno.readTextFile(join(REAL_TEMPLATES, "discern.toml.tmpl"));
}

Deno.test("the bundled template is depth-indented (a fixpoint of indentToml)", async () => {
  const text = await realTemplate();
  assertEquals(
    indentToml(text),
    text,
    "templates/discern.toml.tmpl must carry the canonical depth indentation — " +
      "run indentToml over it (its placeholders keep it from parsing, so " +
      "`discern tidy` cannot) and commit the result",
  );
});

/** Decode the human-readable agent-to-instructions mappings embedded in the template comment. */
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

Deno.test("extracts [project] including its {{agents_array}} token (for the caller to fill)", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "project");
  assertExists(block);
  assertStringIncludes(block, "[project]");
  assertStringIncludes(block, "agents = [{{agents_array}}]");
});

Deno.test("extracts [instructions] with its seeded sources", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "instructions");
  assertExists(block);
  assertStringIncludes(block, "[instructions]");
  assertStringIncludes(block, 'sources = ["discern/instructions.md"]');
});

Deno.test("the seed scope comments keep instructions outside the docs grant example", async () => {
  const template = await realTemplate();
  const docs = sectionBlockFromTemplate(template, "scopes.map");
  const instructions = sectionBlockFromTemplate(
    template,
    "scopes.instructions",
  );
  const acceptance = sectionBlockFromTemplate(template, "acceptance");
  assertExists(docs);
  assertExists(instructions);
  assertExists(acceptance);
  assertStringIncludes(docs, "paths   = [{{scopes_neutral}}]");
  assertStringIncludes(instructions, "paths   = [{{scopes_instructions}}]");
  assertStringIncludes(instructions, "landing them stays owner-reviewed");
  assertStringIncludes(acceptance, 'pre_authorized = [] # e.g. ["map"]');
  assertStringIncludes(
    acceptance,
    "agent-instruction surfaces stay owner-reviewed",
  );
});

Deno.test("lists only active template section headers, in file order", async () => {
  // [project] opens the file and [meta] closes it: the first thing a user reads
  // is their project's own identity, and installer bookkeeping sits at the end.
  assertEquals(sectionNamesFromTemplate(await realTemplate()), [
    "project",
    "repository",
    "map",
    "instructions",
    "skills",
    "jobs",
    "scopes.map",
    "scopes.instructions",
    "generated",
    "acceptance",
    "worktree",
    "worktree.setup",
    // The shipped built-in checkpoints, active by reference for fresh installs.
    "checkpoints.map-focus",
    "checkpoints.instruction-economy",
    "checkpoints.skills-playbook",
    "checkpoints.gotchas-playbook",
    "checkpoints.deletion-heavy-change",
    "checkpoints.parallel-implementation",
    "checkpoints.effort-sprawl",
    "checkpoints.docs-drift",
    "checkpoints.commit-story",
    "gate",
    "coupling",
    "scripts",
    "meta",
  ]);
});

Deno.test("the template documents every top-level config section", async () => {
  // Agents learn the config surface from the template, not the reference docs,
  // so every schema section must ship in it — active ([acceptance]) or as a
  // documented example (# [standards.<name>]). Keys come straight from the
  // schema: a new section enrols here the moment it exists.
  const template = await realTemplate();
  for (const section of Object.keys(configSchema.shape)) {
    assert(
      new RegExp(`\\[${section}[\\].]`).test(template),
      `templates/discern.toml.tmpl never mentions [${section}] — add the ` +
        `section, or a commented "# [${section}]" block documenting it`,
    );
  }
});

Deno.test("extracts a documented key block and section key order", async () => {
  const template = await realTemplate();
  assertEquals(sectionKeyNamesFromTemplate(template, "gate"), [
    "stream",
    "fail_fast",
    "timeout",
    "concurrent_test_runs",
  ]);
  const block = keyBlockFromTemplate(template, "gate.fail_fast");
  assertExists(block);
  assertStringIncludes(block, "# Cancel the in-flight sibling commands");
  assertStringIncludes(block, "fail_fast = true");
});

Deno.test("the agents template comment names every known agent and instruction target", async () => {
  const block = sectionBlockFromTemplate(await realTemplate(), "project");
  assertExists(block);
  const comment = block.split("\n")
    .filter((line) => line.trimStart().startsWith("#"))
    .join("\n");
  const pairs = agentTargetPairs(comment);
  const listedAgents = pairs.map(({ name }) => name);

  assertEquals(
    new Set(listedAgents).size,
    listedAgents.length,
    "[instructions] template comment must not list an agent twice",
  );
  assertEquals(
    [...listedAgents].sort(),
    [...AGENT_NAMES].sort(),
    "[instructions] template comment must list exactly the AGENT_NAMES members",
  );
  for (const agent of AGENT_NAMES) {
    const pair = pairs.find(({ name }) => name === agent);
    assertExists(pair);
    assertEquals(
      pair.target,
      PROVIDERS[agent].instructionFile.path,
      `[instructions] template comment has the wrong target for "${agent}"`,
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

Deno.test("[meta] closes the file with its own doc block; [project] never pulls the preamble in", async () => {
  const meta = sectionBlockFromTemplate(await realTemplate(), "meta");
  assertExists(meta);
  assertStringIncludes(meta, "# [meta] — installer bookkeeping");
  assertStringIncludes(meta, "# The install schema version");
  assertStringIncludes(meta, "schema_version =");
  // [project] now sits directly under the file preamble; it must start AT its
  // header — a comment run reaching the top of the file is never a doc block.
  const project = sectionBlockFromTemplate(await realTemplate(), "project");
  assertExists(project);
  assert(
    project.startsWith("[project]"),
    `expected to start at header, got: ${project}`,
  );
  assert(
    !project.includes("teach discern about your project"),
    "preamble not pulled in",
  );
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
  assertStringIncludes(text, "[instructions]");
  assertStringIncludes(text, "[skills]");
});

const RULE = `# ${"─".repeat(77)}`;

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
    assert(
      /^\s*#\s*─/.test(lines[0] ?? ""),
      `${family} banner opens with a rule`,
    );
    assert(
      /^\s*#\s*─/.test(lines.at(-1) ?? ""),
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
