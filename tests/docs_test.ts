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
import { runCli, withTempDir } from "./helpers.ts";

/** Write a small but representative docs tree (with an icculus.toml anchor). */
async function makeDocsProject(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "icculus.toml"), 'slug = "demo"\n');
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
