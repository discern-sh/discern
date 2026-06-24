/**
 * Tests for `discern help` — the surface that ships discern's OWN documentation
 * to every install. It shares the docs core (`src/commands/docs.ts`), so these
 * focus on what is genuinely different: it serves the BUNDLED tree (never the
 * project's `docs/`), it is always available (even with the `docs` feature off),
 * and it surfaces only the public subtrees. The command is driven end-to-end via
 * the CLI subprocess (piped stdio — the non-interactive agent/script path), with
 * `DISCERN_DOCS_DIR` pointing the bundled-docs resolver at a controlled fixture.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { readTarget, runCli, seedConfig, withTempDir } from "./helpers.ts";

/** This repo's root — used by the dogfood test to resolve discern's real docs. */
const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

/**
 * Lay a project that has BOTH its own `docs/` (a decoy `help` must never show)
 * and a separate "bundled" docs fixture, including internal `_`-prefixed subtrees
 * that `help` must exclude. Returns the fixture path to pass as `DISCERN_DOCS_DIR`.
 */
async function makeHelpFixture(
  dir: string,
  config = 'slug = "demo"\n',
): Promise<string> {
  await seedConfig(dir, config);

  // The project's OWN docs/ — present so a passing test proves `help` ignores it.
  await Deno.mkdir(join(dir, "docs"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "docs/decoy.md"),
    "# Project Decoy\n\nThe project's own docs.\n",
  );

  // discern's bundled docs fixture (a differently-named tree the resolver points
  // at via DISCERN_DOCS_DIR), carrying internal subtrees curation must drop.
  const help = join(dir, "helpdocs");
  const files: Record<string, string> = {
    "README.md": "# discern documentation\n\nWelcome.\n",
    "00-intro/README.md": "# Intro\n",
    "00-intro/concepts.md": "# Concepts at a glance\n\nThe concepts body.\n",
    "00-intro/glossary.md": "# Glossary\n",
    "_adr/0001-first.md": "# ADR 0001: First\n",
    "_internal/brief.md": "# Documenter brief\n",
    "_maintainer/positioning.md": "# Positioning\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    await Deno.mkdir(join(help, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(help, rel), content);
  }
  return help;
}

Deno.test("help serves the bundled tree, never the project's own docs/", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "help");
    // Exactly the 4 public docs of the fixture — and NOT the project's decoy.
    assertEquals(res.data.count, 4);
    assert(res.data.docs.some((d: { slug: string }) => d.slug === "concepts"));
    assert(
      !res.data.docs.some((d: { slug: string }) => d.slug === "decoy"),
      "help must not surface the project's own docs/",
    );

    // Contrast: `docs` (same cwd) DOES serve the project tree — they diverge.
    const docs = await runCli(["docs", "--json"], dir);
    const dres = JSON.parse(docs.stdout);
    assert(
      dres.data.docs.some((d: { slug: string }) => d.slug === "decoy"),
      "docs must serve the project's own docs/",
    );
    assertEquals(dres.verb, "docs");
  });
});

Deno.test("help <slug> --json returns the single doc with its content", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "concepts", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "help");
    assertEquals(res.data.doc.slug, "concepts");
    assertStringIncludes(res.data.doc.content, "The concepts body.");
  });
});

Deno.test("help <slug> --raw prints the pristine source", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "concepts", "--raw"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    assertEquals(stdout, "# Concepts at a glance\n\nThe concepts body.\n");
  });
});

Deno.test("help --list prints a grouped TOC titled `discern help`", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "--list"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "discern help");
    assertStringIncludes(stdout, "00-intro/");
    assertStringIncludes(stdout, "Concepts at a glance");
  });
});

Deno.test("help <unknown> --json reports not_found, exit 1", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "nonesuch", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "help");
    assertEquals(res.error, "not_found");
    assertStringIncludes(res.message, "nonesuch");
  });
});

Deno.test("help <ambiguous> --json reports ambiguous with candidates", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    // README exists at the root and under 00-intro/ → a bare "README" is ambiguous.
    const { code, stdout } = await runCli(
      ["help", "README", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.error, "ambiguous");
    assert(res.data.candidates.length >= 2);
  });
});

Deno.test("help excludes internal _adr/_internal/_maintainer from every view", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);

    const index = await runCli(
      ["help", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    const res = JSON.parse(index.stdout);
    for (const buried of ["_adr", "_internal", "_maintainer"]) {
      assert(
        res.data.docs.every((d: { path: string }) => !d.path.includes(buried)),
        `the help index must not contain ${buried}`,
      );
    }
    // The marketing/internal bodies must not be reachable as targets either.
    const positioning = await runCli(
      ["help", "positioning", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(positioning.code, 1);
    assertEquals(JSON.parse(positioning.stdout).error, "not_found");

    const list = await runCli(
      ["help", "--list"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    for (const buried of ["_adr", "_internal", "_maintainer", "Positioning"]) {
      assert(
        !list.stdout.includes(buried),
        `the help TOC must not list ${buried}`,
      );
    }
  });
});

Deno.test("help is available even when the `docs` feature is disabled", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir, "[features]\ndocs = false\n");

    // `help` works regardless of the project's `docs` feature.
    const helpRun = await runCli(
      ["help", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(helpRun.code, 0);
    assertEquals(JSON.parse(helpRun.stdout).ok, true);

    // Contrast: `docs` refuses, pointing at the disabled feature.
    const docsRun = await runCli(["docs", "--json"], dir);
    assertEquals(docsRun.code, 1);
    assertStringIncludes(docsRun.stderr, "disabled");
  });
});

Deno.test("help --export public concatenates only the public docs", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout, stderr } = await runCli(
      ["help", "--export", "public"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    assertEquals(stderr, "");
    assert(stdout.startsWith("<!-- BEGIN SOURCE: helpdocs/README.md -->\n\n"));
    assertStringIncludes(stdout, "Concepts at a glance");
    assert(!stdout.includes("Positioning"), "must not export _maintainer");
    assert(!stdout.includes("Documenter brief"), "must not export _internal");
    assertEquals(stdout.match(/^<!-- BEGIN SOURCE:/gm)?.length, 4);
  });
});

Deno.test("help rejects export scopes other than public", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    for (const scope of ["all", "select", "private"]) {
      const { code, stderr } = await runCli(
        ["help", "--export", scope],
        dir,
        { DISCERN_DOCS_DIR: help },
      );
      assertEquals(code, 1, scope);
      assertStringIncludes(stderr, "unknown export scope");
      assertStringIncludes(stderr, "expected public.");
    }
  });
});

Deno.test("help --export public --output writes a bundle file", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout, stderr } = await runCli(
      ["help", "--export", "public", "--output", "help-bundle.md"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "Exported 4 documents to help-bundle.md");
    const bundle = await readTarget(dir, "help-bundle.md");
    assertStringIncludes(bundle, "discern documentation");
    assert(!bundle.includes("Positioning"));
  });
});

Deno.test("help reports a build defect (no bundled tree) cleanly", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(dir, 'slug = "demo"\n');
    // Point the resolver at a path that does not exist: the override misses, the
    // resolver returns undefined, and help must NOT fall back to the project's docs.
    const { code, stdout } = await runCli(
      ["help", "--json"],
      dir,
      { DISCERN_DOCS_DIR: join(dir, "does-not-exist") },
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "help");
    assertEquals(res.error, "no_help");
  });
});

Deno.test("dogfood: help serves THIS repo's own docs (config reference)", async () => {
  // No DISCERN_DOCS_DIR override: the resolver walks up from the module to this
  // repo's docs/, exactly as a checkout run does. Proves the real wiring, and
  // that the cwd's project resolution is bypassed.
  const single = await runCli(["help", "config-reference", "--json"], REPO_ROOT);
  assertEquals(single.code, 0);
  const sres = JSON.parse(single.stdout);
  assertEquals(sres.ok, true);
  assertEquals(sres.verb, "help");
  assertEquals(sres.data.doc.slug, "config-reference");
  assertStringIncludes(sres.data.doc.content, "config reference");

  const index = await runCli(["help", "--json"], REPO_ROOT);
  const ires = JSON.parse(index.stdout);
  assert(ires.data.count > 0);
  assert(
    ires.data.docs.every((d: { path: string }) =>
      !d.path.includes("_adr") && !d.path.includes("_maintainer") &&
      !d.path.includes("_internal")
    ),
    "the dogfood index must exclude discern's own internal subtrees",
  );
});
