/**
 * Tests for the docs browser: discovery/resolution (`src/lib/docs.ts`) in
 * process, and the `icculus docs` command surface end-to-end via the CLI.
 *
 * The interactive picker needs a TTY, so it is not exercised here; the
 * subprocess runs are all non-interactive (piped stdio), which is exactly the
 * agent/script path the command must serve without ever blocking on a prompt.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { discoverDocs, extractTitle, resolveDoc } from "../src/lib/docs.ts";
import { runCli, seedConfig, withTempDir } from "./helpers.ts";

/** Write a small but representative docs tree (with an .icculus/config.toml anchor). */
async function makeDocsProject(dir: string): Promise<void> {
  await seedConfig(dir, 'slug = "demo"\n');
  const files: Record<string, string> = {
    "docs/README.md": "# Docs Home\n\nWelcome.\n",
    "docs/00-intro/README.md": "# Intro\n",
    "docs/00-intro/alpha.md": "# Alpha\n\nThe alpha body.\n",
    "docs/00-intro/beta.md": "# Beta\n",
    "docs/_adr/0001-first.md": "# ADR 0001: First\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, rel), content);
  }
}

Deno.test("discoverDocs lists user-facing docs in reading order, README first", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const tree = await discoverDocs({ cwd: dir });
    assert(tree, "expected a docs tree");
    // The _adr subtree is internal — excluded, so it never appears.
    assertEquals(tree.entries.map((e) => e.path), [
      "docs/README.md",
      "docs/00-intro/README.md",
      "docs/00-intro/alpha.md",
      "docs/00-intro/beta.md",
    ]);
    assert(!tree.entries.some((e) => e.path.includes("_adr")));
    // Titles come from each file's first heading.
    const alpha = tree.entries.find((e) => e.slug === "alpha")!;
    assertEquals(alpha.title, "Alpha");
    assertEquals(alpha.section, "00-intro");
  });
});

Deno.test("extractTitle reads the first heading and flattens inline markup", () => {
  assertEquals(extractTitle("# Plain title\n\nbody"), "Plain title");
  assertEquals(extractTitle("## The `code` thing"), "The code thing");
  assertEquals(extractTitle("no heading here"), undefined);
});

Deno.test("resolveDoc handles slug, path, ambiguity, and misses", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const tree = (await discoverDocs({ cwd: dir }))!;

    assertEquals(resolveDoc(tree, "alpha", dir).kind, "found");
    assertEquals(resolveDoc(tree, "00-intro/beta", dir).kind, "found");
    // An internal doc is excluded from the tree, so it does not resolve.
    assertEquals(
      resolveDoc(tree, "docs/_adr/0001-first.md", dir).kind,
      "none",
    );
    // Every user-facing subtree has a README → a bare "README" is ambiguous.
    const amb = resolveDoc(tree, "README", dir);
    assertEquals(amb.kind, "ambiguous");
    assertEquals(resolveDoc(tree, "nonesuch", dir).kind, "none");
  });
});

Deno.test("docs --json emits the index", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.count, 4);
    assert(res.docs.some((d: { slug: string }) => d.slug === "alpha"));
  });
});

Deno.test("docs <slug> --json returns the single doc with its content", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs", "alpha", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.doc.path, "docs/00-intro/alpha.md");
    assertStringIncludes(res.doc.content, "The alpha body.");
  });
});

Deno.test("docs <slug> --raw prints the pristine source", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs", "alpha", "--raw"], dir);
    assertEquals(code, 0);
    assertEquals(stdout, "# Alpha\n\nThe alpha body.\n");
  });
});

Deno.test("docs --list prints a grouped table of contents", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs", "--list"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "icculus docs");
    assertStringIncludes(stdout, "00-intro/");
    assertStringIncludes(stdout, "Alpha");
  });
});

Deno.test("bare docs is non-interactive off a TTY (prints the TOC, no hang)", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "icculus docs");
  });
});

Deno.test("docs renders a target to stdout when piped", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs", "alpha"], dir);
    assertEquals(code, 0);
    // Plain (NO_COLOR + non-TTY): the heading keeps its marker.
    assertStringIncludes(stdout, "# Alpha");
    assertStringIncludes(stdout, "The alpha body.");
  });
});

Deno.test("docs reports an unknown target", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stderr } = await runCli(["docs", "nonesuch"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "no doc matches");
  });
});

Deno.test("docs reports an ambiguous target with candidates", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(
      ["docs", "README", "--json"],
      dir,
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.error, "ambiguous");
    assert(res.candidates.length >= 2);
  });
});

Deno.test("docs --json reports no_docs when there is no docs tree", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["docs", "--json"], dir);
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "no_docs");
  });
});

Deno.test("docs excludes _-prefixed internal directories from every view", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const index = await runCli(["docs", "--json"], dir);
    const res = JSON.parse(index.stdout);
    assert(
      res.docs.every((d: { path: string }) => !d.path.includes("_adr")),
      "the index must not contain internal docs",
    );
    const list = await runCli(["docs", "--list"], dir);
    assert(
      !list.stdout.includes("_adr"),
      "the TOC must not list internal docs",
    );
  });
});

Deno.test("docs --dir can target an internal subtree directly", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // Point --dir straight at it: it becomes the root, no longer underscored.
    const { code, stdout } = await runCli(
      ["docs", "--dir", "docs/_adr", "--json"],
      dir,
    );
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assert(res.docs.some((d: { slug: string }) => d.slug === "0001-first"));
  });
});

Deno.test("docs <unknown> --json reports not_found, exit 1", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["docs", "nonesuch", "--json"], dir);
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "not_found");
    assertStringIncludes(res.message, "nonesuch");
  });
});

Deno.test("docs <ambiguous> without --json lists the candidates on stderr", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // Every subtree has a README → a bare "README" matches more than one.
    const { code, stdout, stderr } = await runCli(["docs", "README"], dir);
    assertEquals(code, 1);
    // The candidate list and guidance go to stderr, not stdout.
    assertStringIncludes(stderr, "matches");
    assertStringIncludes(stderr, "Qualify it");
    assertStringIncludes(stderr, "docs/README.md");
    assertStringIncludes(stderr, "docs/00-intro/README.md");
    assertEquals(stdout, "");
  });
});

Deno.test("docs --json reports an empty tree as count 0 (only internal docs present)", async () => {
  await withTempDir(async (dir) => {
    // A docs dir holding nothing but an internal _-prefixed subtree: the tree
    // exists, but every entry is filtered out → an empty user-facing index.
    await seedConfig(dir, 'slug = "demo"\n');
    await Deno.mkdir(join(dir, "docs/_adr"), { recursive: true });
    await Deno.writeTextFile(join(dir, "docs/_adr/0001-first.md"), "# ADR\n");

    const { code, stdout } = await runCli(["docs", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.count, 0);
    assertEquals(res.docs, []);
  });
});

Deno.test("bare docs warns when the tree has no Markdown (no hang, exit 0)", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(dir, 'slug = "demo"\n');
    // A docs dir with a non-Markdown file only → discovery finds the dir but
    // indexes nothing.
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    await Deno.writeTextFile(join(dir, "docs/notes.txt"), "plain text\n");

    const { code, stderr } = await runCli(["docs"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "no Markdown files");
  });
});

Deno.test("docs --width overrides the wrap width (rendered to stdout)", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // --width is the explicit-width arm of resolveWidth; rendering must still
    // succeed and emit the doc's body.
    const { code, stdout } = await runCli(
      ["docs", "alpha", "--width", "60"],
      dir,
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "Alpha");
    assertStringIncludes(stdout, "The alpha body.");
  });
});

Deno.test("docs honours $COLUMNS for the wrap width", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // With no --width, resolveWidth reads $COLUMNS as the terminal-width source.
    const { code, stdout } = await runCli(
      ["docs", "alpha"],
      dir,
      { COLUMNS: "120" },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "The alpha body.");
  });
});

Deno.test("discoverDocs humanises the slug when a doc has no heading", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(dir, 'slug = "demo"\n');
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    // No Markdown heading at all → the title falls back to a humanised slug.
    await Deno.writeTextFile(
      join(dir, "docs/no-heading.md"),
      "Just a body, no heading.\n",
    );
    const tree = (await discoverDocs({ cwd: dir }))!;
    const entry = tree.entries.find((e) => e.slug === "no-heading")!;
    assertEquals(entry.title, "No heading");
  });
});

Deno.test("discoverDocs falls back to a humanised title when a doc cannot be read", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(dir, 'slug = "demo"\n');
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    // A dangling symlink with a .md name: walk yields it, but reading it throws,
    // so discovery swallows the error and humanises the slug instead.
    await Deno.symlink(
      join(dir, "docs/missing-target.md"),
      join(dir, "docs/dangling.md"),
    );
    const tree = (await discoverDocs({ cwd: dir }))!;
    const entry = tree.entries.find((e) => e.slug === "dangling");
    assert(entry, "expected the dangling entry to be indexed");
    assertEquals(entry!.title, "Dangling");
  });
});

Deno.test("docs without --json errors to stderr when there is no docs tree", async () => {
  await withTempDir(async (dir) => {
    // No docs dir at all: the plain (non-JSON) arm reports it on stderr.
    const { code, stdout, stderr } = await runCli(["docs"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "no docs/ directory here");
    assertEquals(stdout, "");
  });
});

Deno.test("docs --dir to a missing directory errors with that path", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(dir, 'slug = "demo"\n');
    // An explicit --dir that does not exist takes the dir-specific message.
    const { code, stderr } = await runCli(["docs", "--dir", "nope"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "no documentation directory");
    assertStringIncludes(stderr, "nope");
  });
});

Deno.test("resolveDoc treats a whitespace-only target as a miss", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const tree = (await discoverDocs({ cwd: dir }))!;
    // Trimmed to empty → an early "none", never touching the matcher.
    assertEquals(resolveDoc(tree, "   ", dir).kind, "none");
    assertEquals(resolveDoc(tree, "./", dir).kind, "none");
  });
});
