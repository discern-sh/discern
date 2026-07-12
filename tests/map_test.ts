/**
 * Tests for the map browser: documentation discovery/resolution (`src/lib/docs.ts`)
 * in process, and the `discern map` command surface end-to-end via the CLI.
 *
 * The interactive picker needs a TTY, so it is not exercised here; the
 * subprocess runs are all non-interactive (piped stdio), which is exactly the
 * agent/script path the command must serve without ever blocking on a prompt.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  discoverDocs,
  type DocEntry,
  extractTitle,
  filterDocsByGroups,
  formatDocsExport,
  groupDocs,
  resolveDoc,
} from "../src/lib/docs.ts";
import { readTarget, runCli, seedConfig, withTempDir } from "./helpers.ts";
import { git, gitInit } from "./engine_helpers.ts";

/** Write a small but representative map tree (with an .discern/config.toml anchor).
 * The tree lives at a pinned root `docs/` — a pointed, non-default layout — so
 * these behavior tests double as coverage of the pointing escape hatch. */
async function makeDocsProject(dir: string): Promise<void> {
  await seedConfig(
    dir,
    '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
  );
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

/** A minimal indexed entry for pure formatter/grouping tests. */
function entry(path: string): DocEntry {
  const relToDocs = path.replace(/^docs\//, "");
  const parts = relToDocs.split("/");
  const filename = parts.at(-1) ?? relToDocs;
  return {
    path,
    absPath: `/${path}`,
    relToDocs,
    section: parts.length > 1 ? (parts[0] ?? "") : "",
    slug: filename.replace(/\.md$/i, ""),
    title: filename,
  };
}

/** Pin the compact region wire contract: facts travel together; guesses and
 * coverage internals never do. Iterating every returned region means a newly
 * named subtree auto-enrols in the guard. */
function assertFactOnlyRegion(region: Record<string, unknown>): void {
  assert(!("staleness" in region), JSON.stringify(region));
  assert(!("status" in region), JSON.stringify(region));
  assert(!("code_paths" in region), JSON.stringify(region));
  assertEquals(
    "pages_changed_at" in region,
    "code_changes_since" in region,
    JSON.stringify(region),
  );
}

Deno.test("discoverDocs lists user-facing docs in reading order, README first", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const tree = await discoverDocs({ cwd: dir });
    assert(tree, "expected a map tree");
    // The _adr subtree is internal — excluded, so it never appears.
    assertEquals(tree.entries.map((e) => e.path), [
      "docs/README.md",
      "docs/00-intro/README.md",
      "docs/00-intro/alpha.md",
      "docs/00-intro/beta.md",
    ]);
    assert(!tree.entries.some((e) => e.path.includes("_adr")));
    // Titles come from each file's first heading.
    const alpha = tree.entries.find((e) => e.slug === "alpha");
    assertExists(alpha);
    assertEquals(alpha.title, "Alpha");
    assertEquals(alpha.section, "00-intro");
  });
});

Deno.test("discoverDocs can include internal subtrees after public docs", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await Deno.mkdir(join(dir, "docs/_internal"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs/_internal/brief.md"),
      "# Brief\n",
    );

    const tree = await discoverDocs({ cwd: dir, includeInternal: true });
    assertExists(tree);
    assertEquals(tree.entries.map((e) => e.path), [
      "docs/README.md",
      "docs/00-intro/README.md",
      "docs/00-intro/alpha.md",
      "docs/00-intro/beta.md",
      "docs/_adr/0001-first.md",
      "docs/_internal/brief.md",
    ]);
  });
});

Deno.test("groupDocs creates ordered top-level picker groups", () => {
  const entries = [
    entry("docs/README.md"),
    entry("docs/00-intro/README.md"),
    entry("docs/00-intro/alpha.md"),
    entry("docs/notes.md"),
    entry("docs/_adr/0001-first.md"),
  ];
  const groups = groupDocs(entries);

  assertEquals(
    groups.map((group) => ({
      name: group.name,
      internal: group.internal,
      count: group.entries.length,
    })),
    [
      { name: "(root)", internal: false, count: 2 },
      { name: "00-intro", internal: false, count: 2 },
      { name: "_adr", internal: true, count: 1 },
    ],
  );
  assertEquals(
    filterDocsByGroups(entries, ["(root)", "_adr"]).map((item) => item.path),
    [
      "docs/README.md",
      "docs/notes.md",
      "docs/_adr/0001-first.md",
    ],
  );
});

Deno.test("formatDocsExport adds only source comments and separator newlines", () => {
  assertEquals(
    formatDocsExport([
      { entry: entry("docs/one.md"), content: "# One" },
      { entry: entry("docs/two.md"), content: "# Two\n" },
    ]),
    "<!-- BEGIN SOURCE: docs/one.md -->\n\n" +
      "# One\n\n" +
      "<!-- END SOURCE: docs/one.md -->\n\n" +
      "<!-- BEGIN SOURCE: docs/two.md -->\n\n" +
      "# Two\n\n" +
      "<!-- END SOURCE: docs/two.md -->\n",
  );
  assertEquals(formatDocsExport([]), "");
});

Deno.test("extractTitle reads the first heading and flattens inline markup", () => {
  assertEquals(extractTitle("# Plain title\n\nbody"), "Plain title");
  assertEquals(extractTitle("## The `code` thing"), "The code thing");
  assertEquals(extractTitle("no heading here"), undefined);
});

Deno.test("resolveDoc handles slug, path, ambiguity, and misses", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const tree = await discoverDocs({ cwd: dir });
    assertExists(tree);

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

Deno.test("map --json emits the index", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "map");
    assertEquals(res.data.count, 4);
    assertEquals(res.data.regions.length, 1);
    assertEquals(res.data.regions[0].name, "00-intro");
    for (const region of res.data.regions) assertFactOnlyRegion(region);
    assert(res.data.docs.some((d: { slug: string }) => d.slug === "alpha"));
  });
});

Deno.test("bare map renders README descriptions and Git freshness facts per region", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "src", "alpha.ts"),
      "export const alpha = 1;\n",
    );
    await Deno.writeTextFile(
      join(dir, "docs", "00-intro", "README.md"),
      "# Intro\n\n_The short orientation to this project._\n\n" +
        "Implemented by [`alpha.ts`](../../src/alpha.ts).\n",
    );
    await gitInit(dir);

    // Two later commits touch the linked code without touching the region pages.
    await Deno.writeTextFile(
      join(dir, "src", "alpha.ts"),
      "export const alpha = 2;\n",
    );
    await git(dir, "add", "src/alpha.ts");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Change alpha once",
      "--no-gpg-sign",
    );
    await Deno.writeTextFile(
      join(dir, "src", "alpha.ts"),
      "export const alpha = 3;\n",
    );
    await git(dir, "add", "src/alpha.ts");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Change alpha twice",
      "--no-gpg-sign",
    );

    const human = await runCli(["map"], dir);
    assertEquals(human.code, 0);
    assertStringIncludes(human.stdout, "discern map — 1 region in docs");
    assertStringIncludes(
      human.stdout,
      "00-intro  The short orientation to this project.",
    );
    assertStringIncludes(human.stdout, "linked code changed 2 times since");

    const json = await runCli(["map", "--json"], dir);
    const payload = JSON.parse(json.stdout);
    const region = payload.data.regions[0];
    assertEquals(region.description, "The short orientation to this project.");
    assertEquals(region.code_changes_since, 2);
    assertEquals(typeof region.pages_changed_at, "string");
    assertFactOnlyRegion(region);
  });
});

Deno.test("bare map reports unknown freshness when pages link only a directory", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "src", "alpha.ts"),
      "export const alpha = 1;\n",
    );
    await Deno.writeTextFile(
      join(dir, "docs", "00-intro", "README.md"),
      "# Intro\n\nThe orientation.\n\nSee [the source](../../src/).\n",
    );
    await gitInit(dir);

    await Deno.writeTextFile(
      join(dir, "src", "alpha.ts"),
      "export const alpha = 2;\n",
    );
    await git(dir, "add", "src/alpha.ts");
    await git(dir, "commit", "-q", "-m", "Change alpha", "--no-gpg-sign");

    const human = await runCli(["map"], dir);
    assertEquals(human.code, 0);
    assertStringIncludes(human.stdout, "freshness unknown");

    const json = await runCli(["map", "--json"], dir);
    const region = JSON.parse(json.stdout).data.regions[0];
    assertFactOnlyRegion(region);
    assertEquals("pages_changed_at" in region, false);
    assertEquals("code_changes_since" in region, false);
  });
});

Deno.test("bare map reports unknown freshness without tracked file links", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await gitInit(dir);

    const human = await runCli(["map"], dir);
    assertEquals(human.code, 0);
    assertStringIncludes(human.stdout, "00-intro  Intro");
    assertStringIncludes(human.stdout, "freshness unknown");

    const json = await runCli(["map", "--json"], dir);
    const region = JSON.parse(json.stdout).data.regions[0];
    assertFactOnlyRegion(region);
    assertEquals("pages_changed_at" in region, false);
    assertEquals("code_changes_since" in region, false);
  });
});

Deno.test("map <slug> --json returns the single doc with its content", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "alpha", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.data.doc.path, "docs/00-intro/alpha.md");
    assertStringIncludes(res.data.doc.content, "The alpha body.");
  });
});

Deno.test("map <slug> --raw prints the pristine source", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "alpha", "--raw"], dir);
    assertEquals(code, 0);
    assertEquals(stdout, "# Alpha\n\nThe alpha body.\n");
  });
});

Deno.test("map --export public concatenates only user-facing docs", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout, stderr } = await runCli(
      ["map", "--export", "public"],
      dir,
    );

    assertEquals(code, 0);
    assertEquals(stderr, "");
    assert(stdout.startsWith("<!-- BEGIN SOURCE: docs/README.md -->\n\n"));
    assertStringIncludes(stdout, "# Alpha");
    assert(!stdout.includes("docs/_adr/0001-first.md"));
    assertEquals(
      stdout.match(/^<!-- BEGIN SOURCE:/gm)?.length,
      4,
    );
    assertEquals(
      stdout.match(/^<!-- END SOURCE:/gm)?.length,
      4,
    );
  });
});

Deno.test("map --export all includes internal docs after public docs", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(
      ["map", "--export", "all"],
      dir,
    );

    assertEquals(code, 0);
    const beta = stdout.indexOf("<!-- BEGIN SOURCE: docs/00-intro/beta.md -->");
    const adr = stdout.indexOf(
      "<!-- BEGIN SOURCE: docs/_adr/0001-first.md -->",
    );
    assert(beta >= 0);
    assert(adr > beta);
    assertStringIncludes(stdout, "# ADR 0001: First");
    assertEquals(stdout.match(/^<!-- BEGIN SOURCE:/gm)?.length, 5);
  });
});

Deno.test("map export can overwrite an explicit output file", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await Deno.writeTextFile(join(dir, "bundle.md"), "old\n");

    const { code, stdout, stderr } = await runCli(
      ["map", "--export", "public", "--output", "bundle.md"],
      dir,
    );

    assertEquals(code, 0);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "Exported 4 documents to bundle.md");
    const bundle = await readTarget(dir, "bundle.md");
    assert(bundle.startsWith("<!-- BEGIN SOURCE: docs/README.md -->"));
    assert(!bundle.includes("old\n"));
  });
});

Deno.test("map export refuses output inside the source map tree", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout, stderr } = await runCli(
      [
        "map",
        "--export",
        "all",
        "--output",
        "docs/complete.md",
      ],
      dir,
    );

    assertEquals(code, 1);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "refusing to write an export inside docs");
  });
});

Deno.test("map export refuses an output symlink targeting a source doc", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await Deno.symlink(
      join(dir, "docs/README.md"),
      join(dir, "bundle.md"),
    );
    const original = await readTarget(dir, "docs/README.md");

    const { code, stderr } = await runCli(
      ["map", "--export", "public", "--output", "bundle.md"],
      dir,
    );

    assertEquals(code, 1);
    assertStringIncludes(stderr, "refusing to write an export inside docs");
    assertEquals(await readTarget(dir, "docs/README.md"), original);
  });
});

Deno.test("map export validates scope and incompatible flags", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);

    const unknown = await runCli(
      ["map", "--export", "private"],
      dir,
    );
    assertEquals(unknown.code, 1);
    assertStringIncludes(unknown.stderr, "unknown export scope");

    for (
      const args of [
        ["map", "alpha", "--export", "public"],
        ["map", "--export", "public", "--raw"],
        ["map", "--export", "public", "--list"],
        ["map", "--export", "public", "--width", "80"],
        ["map", "--export", "public", "--no-pager"],
      ]
    ) {
      const result = await runCli(args, dir);
      assertEquals(result.code, 1, args.join(" "));
      assertStringIncludes(result.stderr, "--export cannot be combined");
      assertEquals(result.stdout, "");
    }

    const json = await runCli(
      ["map", "--export", "public", "--json"],
      dir,
    );
    assertEquals(json.code, 1);
    assertEquals(JSON.parse(json.stdout).error, "invalid_options");
    assertEquals(json.stderr, "");
  });
});

Deno.test("map --output requires export mode", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stderr } = await runCli(
      ["map", "--output", "bundle.md"],
      dir,
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "--output requires --export");
  });
});

Deno.test("map --export select requires output and an interactive terminal", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);

    const noOutput = await runCli(
      ["map", "--export", "select"],
      dir,
    );
    assertEquals(noOutput.code, 1);
    assertStringIncludes(noOutput.stderr, "requires --output");

    const nonInteractive = await runCli(
      [
        "map",
        "--export",
        "select",
        "--output",
        "bundle.md",
      ],
      dir,
    );
    assertEquals(nonInteractive.code, 1);
    assertStringIncludes(nonInteractive.stderr, "interactive terminal");
  });
});

Deno.test("map export reads every source before emitting output", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    await Deno.writeTextFile(join(dir, "bundle.md"), "keep me\n");
    await Deno.symlink(
      join(dir, "docs/missing.md"),
      join(dir, "docs/broken.md"),
    );

    const { code, stdout, stderr } = await runCli(
      ["map", "--export", "public"],
      dir,
    );
    assertEquals(code, 1);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "could not read every documentation source");

    const fileResult = await runCli(
      ["map", "--export", "public", "--output", "bundle.md"],
      dir,
    );
    assertEquals(fileResult.code, 1);
    assertEquals(await readTarget(dir, "bundle.md"), "keep me\n");
  });
});

Deno.test("map export reports a missing map tree without partial output", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout, stderr } = await runCli(
      ["map", "--export", "all"],
      dir,
    );
    assertEquals(code, 1);
    assertEquals(stdout, "");
    assertStringIncludes(stderr, "project map is missing");
    assertStringIncludes(stderr, "discern setup");
  });
});

Deno.test("map --list prints a grouped table of contents", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "--list"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "discern map");
    assertStringIncludes(stdout, "00-intro/");
    assertStringIncludes(stdout, "Alpha");
  });
});

Deno.test("bare docs is non-interactive off a TTY (prints the TOC, no hang)", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "discern map");
  });
});

Deno.test("map renders a target to stdout when piped", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "alpha"], dir);
    assertEquals(code, 0);
    // Plain (NO_COLOR + non-TTY): the heading keeps its marker.
    assertStringIncludes(stdout, "# Alpha");
    assertStringIncludes(stdout, "The alpha body.");
  });
});

Deno.test("map reports an unknown target", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stderr } = await runCli(["map", "nonesuch"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "no doc matches");
  });
});

Deno.test("map reports an ambiguous target with candidates", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(
      ["map", "README", "--json"],
      dir,
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.error, "ambiguous");
    assert(res.data.candidates.length >= 2);
  });
});

Deno.test("map --json reports no_map when there is no map tree", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runCli(["map", "--json"], dir);
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "no_map");
  });
});

Deno.test("map excludes _-prefixed internal directories from every view", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const index = await runCli(["map", "--json"], dir);
    const res = JSON.parse(index.stdout);
    assert(
      res.data.docs.every((d: { path: string }) => !d.path.includes("_adr")),
      "the index must not contain internal docs",
    );
    const list = await runCli(["map", "--list"], dir);
    assert(
      !list.stdout.includes("_adr"),
      "the TOC must not list internal docs",
    );
  });
});

Deno.test("map --dir can target an internal subtree directly", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // Point --dir straight at it: it becomes the root, no longer underscored.
    const { code, stdout } = await runCli(
      ["map", "--dir", "docs/_adr", "--json"],
      dir,
    );
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assert(
      res.data.docs.some((d: { slug: string }) => d.slug === "0001-first"),
    );
  });
});

Deno.test("map defaults to the configured [map].dir", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[project]\nslug = "demo"\n[map]\ndir = "docs/discern/"\n',
    );
    await Deno.mkdir(join(dir, "docs/discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs/discern/README.md"),
      "# Agent docs\n",
    );
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Human docs\n");

    const { code, stdout } = await runCli(["map", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.data.map_dir, "docs/discern");
    assertEquals(res.data.docs.map((doc: { path: string }) => doc.path), [
      "docs/discern/README.md",
    ]);
  });
});

Deno.test("map <unknown> --json reports not_found, exit 1", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "nonesuch", "--json"], dir);
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "not_found");
    assertStringIncludes(res.message, "nonesuch");
  });
});

Deno.test("map <near miss> --json suggests valid doc targets", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const { code, stdout } = await runCli(["map", "alph", "--json"], dir);
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "not_found");
    assertStringIncludes(res.message, "Closest match");
    assertEquals(res.data.suggestions[0].slug, "alpha");
    assertEquals(res.data.suggestions[0].path, "docs/00-intro/alpha.md");
  });
});

Deno.test("map <ambiguous> without --json lists the candidates on stderr", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // Every subtree has a README → a bare "README" matches more than one.
    const { code, stdout, stderr } = await runCli(["map", "README"], dir);
    assertEquals(code, 1);
    // The candidate list and guidance go to stderr, not stdout.
    assertStringIncludes(stderr, "matches");
    assertStringIncludes(stderr, "Qualify it");
    assertStringIncludes(stderr, "docs/README.md");
    assertStringIncludes(stderr, "docs/00-intro/README.md");
    assertEquals(stdout, "");
  });
});

Deno.test("map --json reports an empty tree as count 0 (only internal docs present)", async () => {
  await withTempDir(async (dir) => {
    // A docs dir holding nothing but an internal _-prefixed subtree: the tree
    // exists, but every entry is filtered out → an empty user-facing index.
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
    );
    await Deno.mkdir(join(dir, "docs/_adr"), { recursive: true });
    await Deno.writeTextFile(join(dir, "docs/_adr/0001-first.md"), "# ADR\n");

    const { code, stdout } = await runCli(["map", "--json"], dir);
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, true);
    assertEquals(res.data.count, 0);
    assertEquals(res.data.docs, []);
  });
});

Deno.test("bare docs warns when the tree has no Markdown (no hang, exit 0)", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
    );
    // A docs dir with a non-Markdown file only → discovery finds the dir but
    // indexes nothing.
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    await Deno.writeTextFile(join(dir, "docs/notes.txt"), "plain text\n");

    const { code, stderr } = await runCli(["map"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "no Markdown files");
  });
});

Deno.test("map --width overrides the wrap width (rendered to stdout)", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // --width is the explicit-width arm of resolveWidth; rendering must still
    // succeed and emit the doc's body.
    const { code, stdout } = await runCli(
      ["map", "alpha", "--width", "60"],
      dir,
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "Alpha");
    assertStringIncludes(stdout, "The alpha body.");
  });
});

Deno.test("map honours $COLUMNS for the wrap width", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    // With no --width, resolveWidth reads $COLUMNS as the terminal-width source.
    const { code, stdout } = await runCli(
      ["map", "alpha"],
      dir,
      { COLUMNS: "120" },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "The alpha body.");
  });
});

Deno.test("discoverDocs humanises the slug when a doc has no heading", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
    );
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    // No Markdown heading at all → the title falls back to a humanised slug.
    await Deno.writeTextFile(
      join(dir, "docs/no-heading.md"),
      "Just a body, no heading.\n",
    );
    const tree = await discoverDocs({ cwd: dir });
    assertExists(tree);
    const entry = tree.entries.find((e) => e.slug === "no-heading");
    assertExists(entry);
    assertEquals(entry.title, "No heading");
  });
});

Deno.test("discoverDocs falls back to a humanised title when a doc cannot be read", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
    );
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    // A dangling symlink with a .md name: walk yields it, but reading it throws,
    // so discovery swallows the error and humanises the slug instead.
    await Deno.symlink(
      join(dir, "docs/missing-target.md"),
      join(dir, "docs/dangling.md"),
    );
    const tree = await discoverDocs({ cwd: dir });
    assertExists(tree);
    const entry = tree.entries.find((e) => e.slug === "dangling");
    assertExists(entry, "expected the dangling entry to be indexed");
    assertEquals(entry.title, "Dangling");
  });
});

Deno.test("map without --json errors to stderr when there is no map tree", async () => {
  await withTempDir(async (dir) => {
    // No docs dir at all: the plain (non-JSON) arm reports it on stderr.
    const { code, stdout, stderr } = await runCli(["map"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "project map is missing");
    assertStringIncludes(stderr, "discern setup");
    assertEquals(stdout, "");
  });
});

Deno.test("map --dir to a missing directory errors with that path", async () => {
  await withTempDir(async (dir) => {
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
    );
    // An explicit --dir that does not exist takes the dir-specific message.
    const { code, stderr } = await runCli(["map", "--dir", "nope"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "no map directory");
    assertStringIncludes(stderr, "nope");
    assertStringIncludes(stderr, "check the path");
  });
});

Deno.test("resolveDoc treats a whitespace-only target as a miss", async () => {
  await withTempDir(async (dir) => {
    await makeDocsProject(dir);
    const tree = await discoverDocs({ cwd: dir });
    assertExists(tree);
    // Trimmed to empty → an early "none", never touching the matcher.
    assertEquals(resolveDoc(tree, "   ", dir).kind, "none");
    assertEquals(resolveDoc(tree, "./", dir).kind, "none");
  });
});
