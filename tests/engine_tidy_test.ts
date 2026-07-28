import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ensureDir, walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  assertFrontmatterPreserved,
  formatMarkdownText,
  formatTomlText,
} from "../src/lib/tidy_format.ts";
import { planTidy, tidyResult } from "../src/engine/tidy/tidy.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { scanRuledBanners } from "../src/lib/config_banners.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

function fencedBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let start: number | undefined;
  let fence: { char: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trimStart() ?? "";
    const run = /^(`{3,}|~{3,})/.exec(trimmed)?.[0];
    if (fence === undefined && run !== undefined) {
      start = i;
      fence = { char: run[0] ?? "", length: run.length };
    } else if (
      fence !== undefined && run !== undefined && run[0] === fence.char &&
      run.length >= fence.length && trimmed.slice(run.length).trim() === ""
    ) {
      blocks.push(lines.slice(start, i + 1).join("\n"));
      start = undefined;
      fence = undefined;
    }
  }
  return blocks;
}

function commentLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trimStart().startsWith("#"));
}

async function write(path: string, text: string): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, text);
}

async function seedTidyProject(root: string): Promise<void> {
  await write(
    join(root, "discern.toml"),
    [
      "[meta]",
      "bootstrapped=true",
      "",
      "[project]",
      'todo="notes/TODO.md"',
      "",
      "[guidance]",
      'sources=["instructions/*.md"]',
      "",
      "[skills]",
      'dir="docs/skills"',
      "",
      "[map]",
      'dir="docs/"',
      "",
    ].join("\n"),
  );
  await write(join(root, "docs", "README.md"), "# Map\n\n-   item\n");
  await write(join(root, "notes", "TODO.md"), "# Todo\n\n-   item\n");
  await write(
    join(root, "instructions", "one.md"),
    "# Guidance\n\n-   item\n",
  );
  await write(join(root, "docs", "skills", "one.md"), "#Skill\n");
  await write(join(root, "discern", "brief.md"), "#Brief\n");
}

Deno.test("embedded formatters are deterministic and preserve fenced code and TOML comments", async () => {
  const markdown = [
    "# Heading  ",
    "",
    "```md",
    "#Inner stays compact",
    "-   fence spacing stays",
    "```",
    "",
    "> ```js",
    "> const nested={spacing:   'stays'};",
    "> ```",
    "",
  ].join("\n");
  const markdownOnce = await formatMarkdownText("example.md", markdown);
  assertMatch(markdownOnce, /^# Heading$/m);
  assertEquals(fencedBlocks(markdownOnce), fencedBlocks(markdown));
  assertStringIncludes(
    markdownOnce,
    "> ```js\n> const nested={spacing:   'stays'};\n> ```",
  );
  assertEquals(
    await formatMarkdownText("example.md", markdownOnce),
    markdownOnce,
  );

  const toml = [
    "# ── ruled banner ───────────────────────────",
    "[project] # table comment",
    'slug="example" # value comment',
    "",
  ].join("\n");
  const tomlOnce = await formatTomlText("discern.toml", toml);
  assertEquals(commentLines(tomlOnce), commentLines(toml));
  assertEquals(await formatTomlText("discern.toml", tomlOnce), tomlOnce);
});

Deno.test("fresh setup writes tidy TOML without breaking ruled-banner regions", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { bootstrapped: false });
    await assertDiscernTomlTidy(root, "setup scaffold");
    const text = await Deno.readTextFile(join(root, "discern.toml"));
    const identities = scanRuledBanners(text).map((banner) => banner.identity);
    assert(
      identities.length > 10,
      "the scaffold should retain its ruled banners",
    );
    assert(identities.includes("jobs"));
    assert(identities.includes("meta"));
  });
});

Deno.test("tidy plans configured Markdown only, previews without writes, and becomes a no-op", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    const originalMap = await Deno.readTextFile(
      join(root, "docs", "README.md"),
    );

    const plan = await planTidy(root, "md");
    assertEquals(
      plan.changes.map((change) => change.display),
      ["docs/README.md", "instructions/one.md", "notes/TODO.md"],
    );

    const preview = await tidyResult(root, { type: "md", dryRun: true });
    assertEquals(preview.ok, true);
    assertEquals(preview.dry_run, true);
    assertEquals(preview.plan?.steps.length, 3);
    assertEquals(
      await Deno.readTextFile(join(root, "docs", "README.md")),
      originalMap,
    );

    const applied = await tidyResult(root, { type: "md" });
    assertEquals(applied.ok, true);
    assertEquals(applied.steps?.map((step) => step.outcome), [
      "ok",
      "ok",
      "ok",
    ]);
    assertMatch(
      await Deno.readTextFile(join(root, "docs", "README.md")),
      /^# Map/m,
    );
    assertEquals(
      await Deno.readTextFile(join(root, "docs", "skills", "one.md")),
      "#Skill\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "discern", "brief.md")),
      "#Brief\n",
    );

    const settled = await tidyResult(root, { type: "md" });
    assertEquals(settled.ok, true);
    assertEquals(settled.steps, []);
  });
});

Deno.test("missing configured Markdown paths are a no-op success", async () => {
  await withTempDir(async (root) => {
    await write(
      join(root, "discern.toml"),
      [
        "[project]",
        'todo = "missing/TODO.md"',
        "",
        "[guidance]",
        'sources = ["missing/guidance/*.md"]',
        "",
        "[map]",
        'dir = "missing/map/"',
        "",
      ].join("\n"),
    );

    const result = await tidyResult(root, { type: "md" });
    assertEquals(result.ok, true);
    assertEquals(result.steps, []);
  });
});

Deno.test("tidy CLI previews both types, applies selectors, and rejects an unknown selector", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    const before = await Deno.readTextFile(join(root, "discern.toml"));

    const preview = await runAgent(root, ["tidy", "--dry-run", "--json"]);
    assertEquals(preview.code, 0);
    const previewJson = JSON.parse(preview.stdout) as {
      dry_run: boolean;
      plan: { steps: Array<{ label: string }> };
    };
    assertEquals(previewJson.dry_run, true);
    assert(
      previewJson.plan.steps.some((step) => step.label === "discern.toml"),
    );
    assertEquals(await Deno.readTextFile(join(root, "discern.toml")), before);

    const toml = await runAgent(root, ["tidy", "toml", "--json"]);
    assertEquals(toml.code, 0);
    assertMatch(
      await Deno.readTextFile(join(root, "discern.toml")),
      /bootstrapped = true/,
    );
    assertEquals(
      await Deno.readTextFile(join(root, "docs", "README.md")),
      "# Map\n\n-   item\n",
    );

    const invalid = await runAgent(root, ["tidy", "yaml", "--json"]);
    assertEquals(invalid.code, 1);
    const invalidJson = JSON.parse(invalid.stdout) as {
      error: string;
      message: string;
    };
    assertEquals(invalidJson.error, "invalid_arguments");
    assertMatch(invalidJson.message, /discern tidy toml/);
  });
});

Deno.test("a parse failure aborts bare tidy before any Markdown write", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    const mapPath = join(root, "docs", "README.md");
    const before = await Deno.readTextFile(mapPath);
    await Deno.writeTextFile(join(root, "discern.toml"), "[project\n");

    const result = await runAgent(root, ["tidy", "--json"]);
    assertEquals(result.code, 1);
    const json = JSON.parse(result.stdout) as { error: string };
    assertEquals(json.error, "invalid_toml");
    assertEquals(await Deno.readTextFile(mapPath), before);
  });
});

Deno.test("the real map corpus and discern.toml are formatter-idempotent", async () => {
  const mapRoot = join(REPO_ROOT, "project", "map");
  let count = 0;
  for await (
    const entry of walk(mapRoot, { includeDirs: false, exts: [".md"] })
  ) {
    const before = await Deno.readTextFile(entry.path);
    const once = await formatMarkdownText(entry.path, before);
    assertEquals(
      await formatMarkdownText(entry.path, once),
      once,
      entry.path,
    );
    assertEquals(fencedBlocks(once), fencedBlocks(before), entry.path);
    count += 1;
  }
  assert(count > 300);

  const configPath = join(REPO_ROOT, "discern.toml");
  const before = await Deno.readTextFile(configPath);
  const once = await formatTomlText(configPath, before);
  assertEquals(await formatTomlText(configPath, once), once);
  assertEquals(commentLines(once), commentLines(before));
});

Deno.test("tidy fails on a misaligned fenced diagram, naming file, line, and column", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    await write(
      join(root, "docs", "diagram.md"),
      ["# D", "", "```", "┌───┐", "│ x  │", "└───┘", "```", ""].join("\n"),
    );
    const result = await tidyResult(root);
    assertEquals(result.ok, false);
    assertEquals(result.error, "diagrams_misaligned");
    const messages = (result.diagnostics ?? []).map((d) => d.message);
    assert(
      messages.some((m) => m.startsWith("docs/diagram.md:5:6")),
      messages.join("\n"),
    );
    // Formatting still converged the rest of the tree in the same run.
    assertEquals(
      await Deno.readTextFile(join(root, "docs", "README.md")),
      "# Map\n\n- item\n",
    );
  });
});

Deno.test("a freeform-tagged fence and the toml selector skip the diagram check", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    const art = ["```freeform", "┌───┐", "│ x  │", "└───┘", "```", ""]
      .join("\n");
    await write(join(root, "docs", "art.md"), `# Art\n\n${art}`);
    const tagged = await tidyResult(root);
    assertEquals(tagged.ok, true);

    await write(
      join(root, "docs", "art.md"),
      `# Art\n\n${art.replace("```freeform", "```")}`,
    );
    const toml = await tidyResult(root, { type: "toml" });
    assertEquals(toml.ok, true);
    const md = await tidyResult(root, { type: "md" });
    assertEquals(md.ok, false);
  });
});

Deno.test("tidy --dry-run reports diagram findings and writes nothing", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    await write(
      join(root, "docs", "diagram.md"),
      ["# D", "", "```", "┌───┐", "│ x  │", "└───┘", "```", ""].join("\n"),
    );
    const result = await tidyResult(root, { dryRun: true });
    assertEquals(result.ok, false);
    assertEquals(result.error, "diagrams_misaligned");
    assert((result.diagnostics ?? []).length > 0);
    assertEquals(
      await Deno.readTextFile(join(root, "docs", "README.md")),
      "# Map\n\n-   item\n",
    );
  });
});

Deno.test("markdown formatting refuses unparseable frontmatter instead of rewriting it", async () => {
  // The incident shape: an unquoted `: ` inside a value turns the block into
  // invalid YAML; a recovering formatter re-indents the flush-left siblings
  // underneath it. The embedded formatter must refuse the file instead.
  const incident = [
    "---",
    "name: repro-fixture",
    "description: foo bar: baz",
    "metadata:",
    "  author: discern",
    "  version: 1.0.0",
    "---",
    "",
    "# Repro",
    "",
    "Body.",
    "",
  ].join("\n");
  await assertRejects(
    () => formatMarkdownText("SKILL.md", incident),
    Error,
    "not valid YAML",
  );

  // A future sibling of the same mechanism under unrelated names and in an
  // unrelated container must be refused without any name-specific rule.
  const sibling = [
    "---",
    "sprocket: gear: tooth",
    "widgets:",
    "  rim: brass",
    "---",
    "",
    "Notes.",
    "",
  ].join("\n");
  await assertRejects(
    () => formatMarkdownText("notes.md", sibling),
    Error,
    "not valid YAML",
  );

  // An opening fence that never closes is a broken block, not content.
  await assertRejects(
    () => formatMarkdownText("doc.md", "---\ntitle: x\n\nBody.\n"),
    Error,
    "unterminated frontmatter fence",
  );

  // A list is valid YAML but not a frontmatter mapping.
  await assertRejects(
    () => formatMarkdownText("doc.md", "---\n- a\n- b\n---\n\nBody.\n"),
    Error,
    "must be a YAML mapping",
  );
});

Deno.test("markdown formatting preserves a valid frontmatter block verbatim", async () => {
  // Non-canonical YAML spacing must come through byte-for-byte while the
  // Markdown body still formats.
  const block = [
    "---",
    'description:     "a: quoted value"',
    "metadata:",
    "    author:   ada",
    "---",
  ].join("\n");
  const input = `${block}\n\n#  Title\n\n-   item\n`;
  const output = await formatMarkdownText("doc.md", input);
  assert(
    output.startsWith(`${block}\n`),
    `frontmatter block must survive unchanged, got:\n${output}`,
  );
  assertStringIncludes(output, "# Title");
  assertStringIncludes(output, "- item");

  // Line endings follow the document-wide LF convention; the block's content
  // is otherwise untouched.
  const crlf = "---\r\ndescription: x\r\n---\r\n\r\n# T\r\n";
  const crlfOut = await formatMarkdownText("doc.md", crlf);
  assert(crlfOut.startsWith("---\ndescription: x\n---\n"), crlfOut);
});

Deno.test("unparseable frontmatter aborts tidy md before any write", async () => {
  await withTempDir(async (root) => {
    await seedTidyProject(root);
    const badPath = join(root, "docs", "broken.md");
    const bad = [
      "---",
      "description: foo bar: baz",
      "metadata:",
      "  author: discern",
      "---",
      "",
      "# Broken",
      "",
      "-   item",
      "",
    ].join("\n");
    await write(badPath, bad);
    const readmePath = join(root, "docs", "README.md");
    const readmeBefore = await Deno.readTextFile(readmePath);

    const result = await runAgent(root, ["tidy", "--json"]);
    assertEquals(result.code, 1);
    const json = JSON.parse(result.stdout) as {
      error: string;
      diagnostics: Array<{ message: string }>;
    };
    assertEquals(json.error, "tidy_parse_failed");
    const message = json.diagnostics[0]?.message ?? "";
    assertStringIncludes(message, "broken.md");
    assertStringIncludes(message, "not valid YAML");
    assertEquals(await Deno.readTextFile(badPath), bad);
    assertEquals(await Deno.readTextFile(readmePath), readmeBefore);
  });
});

Deno.test("a formatter that altered frontmatter is refused, never written", () => {
  const before = "---\ndescription: x\n---\n\n# T\n";
  const altered = "---\ndescription: x\n  extra: y\n---\n\n# T\n";
  assertFrontmatterPreserved("doc.md", before, before);
  assertThrows(
    () => assertFrontmatterPreserved("doc.md", before, altered),
    Error,
    "altered the frontmatter",
  );
});
