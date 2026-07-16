/**
 * Tests for `discern help` — the surface that ships discern's OWN documentation
 * to every install. It shares the docs core (`src/commands/docs.ts`), so these
 * focus on what is genuinely different: it serves the BUNDLED tree (never the
 * project's `docs/`), it is always available (even with the `docs` feature off),
 * and it surfaces only the public subtrees. The command is driven end-to-end via
 * the CLI subprocess (piped stdio — the non-interactive agent/script path), with
 * `DISCERN_DOCS_DIR` pointing the bundled-docs resolver at a controlled fixture.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { readTarget, runCli, seedConfig, withTempDir } from "./helpers.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import {
  COMMAND_SYNONYM_SUGGESTIONS,
  RETIRED_COMMAND_REDIRECTS,
} from "../src/shared/vocabulary.ts";
import { stageBundledDocs } from "../scripts/build.ts";

/** This repo's root — used by the dogfood test to resolve discern's real docs. */
const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

/**
 * Lay a project that has BOTH its own `docs/` (a decoy `help` must never show)
 * and a separate "bundled" docs fixture, including internal `_`-prefixed subtrees
 * that `help` must exclude. Returns the fixture path to pass as `DISCERN_DOCS_DIR`.
 */
async function makeHelpFixture(
  dir: string,
  config =
    '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
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
    "00-orientation/README.md": "# Intro\n",
    "00-orientation/concepts.md": "# Concepts at a glance\n\n" +
      "The concepts body, decided early ([ADR 0001](../_adr/0001-first.md)).\n",
    "00-orientation/glossary.md": "# Glossary\n",
    "00-orientation/hidden.md":
      "---\npublish: false\n---\n# Hidden draft\n\nWithheld.\n",
    "_adr/0001-first.md": "# ADR 0001: First\n",
    "_internal/brief.md": "# Documenter brief\n",
    "_private/positioning.md": "# Positioning\n",
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
    assertEquals(res.data.map_dir, undefined);
    // Exactly the 4 PUBLISHED docs of the fixture — not the project's decoy,
    // and not the publish: false draft (help honours isPublicDoc).
    assertEquals(res.data.count, 4);
    assert(res.data.docs.some((d: { slug: string }) => d.slug === "concepts"));
    assert(
      !res.data.docs.some((d: { slug: string }) => d.slug === "hidden"),
      "help must withhold publish: false docs",
    );
    assert(
      !res.data.docs.some((d: { slug: string }) => d.slug === "decoy"),
      "help must not surface the project's own docs/",
    );

    // Contrast: `docs` (same cwd) DOES serve the project tree — they diverge.
    const docs = await runCli(["map", "--json"], dir);
    const dres = JSON.parse(docs.stdout);
    assert(
      dres.data.docs.some((d: { slug: string }) => d.slug === "decoy"),
      "docs must serve the project's own docs/",
    );
    assertEquals(dres.verb, "map");
  });
});

Deno.test("help <slug> --json strips inline citations, keeps them as fields", async () => {
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
    // Human-facing product docs: the inline citation group is stripped from
    // content, and the clause still reads; the decision survives as a field.
    assertStringIncludes(
      res.data.doc.content,
      "The concepts body, decided early.",
    );
    assert(!res.data.doc.content.includes("[ADR 0001]"));
    assertEquals(res.data.doc.cited_adrs, [
      { number: "0001", slug: "first", path: "../_adr/0001-first.md" },
    ]);
  });
});

Deno.test("help <slug> --raw prints the pristine source, citations included", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "concepts", "--raw"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    assertEquals(
      stdout,
      "# Concepts at a glance\n\n" +
        "The concepts body, decided early ([ADR 0001](../_adr/0001-first.md)).\n",
    );
  });
});

Deno.test("a publish: false doc is unreachable through every help surface", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);

    // Not resolvable as a target...
    const target = await runCli(
      ["help", "hidden", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(target.code, 1);
    assertEquals(JSON.parse(target.stdout).error, "not_found");

    // ...absent from the TOC...
    const list = await runCli(
      ["help", "--list"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assert(!list.stdout.includes("Hidden draft"));

    // ...and absent from an export.
    const exported = await runCli(
      ["help", "--export", "public"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(exported.code, 0);
    assert(!exported.stdout.includes("hidden.md"));
    assert(!exported.stdout.includes("Withheld."));
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
    assertStringIncludes(stdout, "00-orientation/");
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

Deno.test("help <near miss> --json suggests valid doc targets", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stdout } = await runCli(
      ["help", "concept", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 1);
    const res = JSON.parse(stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "help");
    assertEquals(res.error, "not_found");
    assertStringIncludes(res.message, "Closest match");
    assertEquals(res.data.suggestions[0].slug, "concepts");
    assertEquals(
      res.data.suggestions[0].path,
      "helpdocs/00-orientation/concepts.md",
    );
  });
});

Deno.test("help <ambiguous> --json reports ambiguous with candidates", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    // README exists at the root and under 00-orientation/ → a bare "README" is ambiguous.
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

Deno.test("help excludes internal _adr/_internal/_private from every view", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);

    const index = await runCli(
      ["help", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    const res = JSON.parse(index.stdout);
    for (const buried of ["_adr", "_internal", "_private"]) {
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
    for (const buried of ["_adr", "_internal", "_private", "Positioning"]) {
      assert(
        !list.stdout.includes(buried),
        `the help TOC must not list ${buried}`,
      );
    }
  });
});

Deno.test("help --adr surfaces ONLY the ADR tree, never _internal/_private", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);

    // --adr widens the index to include the ADR subtree...
    const { code, stdout } = await runCli(
      ["help", "--adr", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 0);
    const res = JSON.parse(stdout);
    assert(
      res.data.docs.some((d: { slug: string }) => d.slug === "0001-first"),
      "--adr surfaces the ADR docs",
    );
    // ...but never the other internal subtrees (allowlist, not all-internal).
    for (const buried of ["_internal", "_private"]) {
      assert(
        res.data.docs.every((d: { path: string }) => !d.path.includes(buried)),
        `--adr must not surface ${buried}`,
      );
    }

    // An ADR resolves as a target only with --adr; it is hidden by default.
    const withAdr = await runCli(
      ["help", "--adr", "0001-first", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(withAdr.code, 0);
    assertEquals(JSON.parse(withAdr.stdout).data.doc.slug, "0001-first");

    const withoutAdr = await runCli(
      ["help", "0001-first", "--json"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(withoutAdr.code, 1);
    assertEquals(JSON.parse(withoutAdr.stdout).error, "not_found");
  });
});

Deno.test("installed help --adr points to the public decision archive", async () => {
  await withTempDir(async (dir) => {
    const source = await makeHelpFixture(dir);
    const staged = join(dir, "staged-help");
    await stageBundledDocs(source, staged);

    const json = await runCli(
      ["help", "--adr", "--json"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(json.code, 0);
    const result = JSON.parse(json.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.verb, "help");
    assertStringIncludes(result.message, "not bundled with installed binaries");
    assertStringIncludes(result.message, "https://discern.sh/docs/decisions");
    assert(!result.message.includes("0001-first"));

    const human = await runCli(
      ["help", "--adr"],
      dir,
      { DISCERN_DOCS_DIR: staged },
    );
    assertEquals(human.code, 0);
    assertStringIncludes(human.stdout, "https://discern.sh/docs/decisions");
  });
});

Deno.test("help --adr cannot be combined with --export", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const { code, stderr } = await runCli(
      ["help", "--export", "public", "--adr"],
      dir,
      { DISCERN_DOCS_DIR: help },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "--export cannot be combined with --adr");
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
    assert(!stdout.includes("Positioning"), "must not export _private");
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
  // repo's configured map, exactly as a checkout run does. Proves the real wiring, and
  // that the cwd's project resolution is bypassed.
  const single = await runCli(
    ["help", "config-reference", "--json"],
    REPO_ROOT,
  );
  assertEquals(single.code, 0);
  const sres = JSON.parse(single.stdout);
  assertEquals(sres.ok, true);
  assertEquals(sres.verb, "help");
  assertEquals(sres.data.doc.slug, "config-reference");
  assertStringIncludes(sres.data.doc.content, "config reference");

  const index = await runCli(["help", "--json"], REPO_ROOT);
  const ires = JSON.parse(index.stdout);
  assertEquals(ires.data.map_dir, undefined);
  assert(ires.data.count > 0);
  assert(
    ires.data.docs.every((d: { path: string }) =>
      !d.path.includes("_adr") && !d.path.includes("_private") &&
      !d.path.includes("_internal")
    ),
    "the dogfood index must exclude discern's own internal subtrees",
  );

  const decision = await runCli(
    ["help", "--adr", "0141-adr-citations-strip-at-render", "--json"],
    REPO_ROOT,
  );
  assertEquals(decision.code, 0);
  const dres = JSON.parse(decision.stdout);
  assertEquals(dres.ok, true);
  assertEquals(dres.data.doc.slug, "0141-adr-citations-strip-at-render");
});

// ── `help <verb>` fallthrough ────────────────────────────────────────────────
//
// Git users type `git help push` and `git push --help` interchangeably, and git
// forwards one to the other. `discern help <verb>` does the same: for every
// registered verb it renders that verb's own command help, byte-identical to
// `<verb> --help`. Driven off the verb registry, never a hand list, so a new
// verb auto-enrols.

Deno.test("help <verb> matches <verb> --help for every registered verb", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const env = { DISCERN_DOCS_DIR: help };
    await Promise.all([...KNOWN_VERBS].map(async (verb) => {
      const direct = await runCli([verb, "--help"], dir, env);
      const fallthrough = await runCli(["help", verb], dir, env);
      assertEquals(direct.code, 0, `${verb} --help failed:\n${direct.stderr}`);
      assertEquals(
        fallthrough.code,
        0,
        `help ${verb} failed:\n${fallthrough.stderr}`,
      );
      assertEquals(
        fallthrough.stdout,
        direct.stdout,
        `help ${verb} diverged from ${verb} --help`,
      );
    }));
  });
});

Deno.test("help <target> teaches for retired spellings and synonyms", async () => {
  await withTempDir(async (dir) => {
    const help = await makeHelpFixture(dir);
    const env = { DISCERN_DOCS_DIR: help };
    for (
      const [retired, successor] of Object.entries(RETIRED_COMMAND_REDIRECTS)
        .filter(([spelling]) => !spelling.includes(" "))
    ) {
      const r = await runCli(["help", retired], dir, env);
      assertEquals(r.code, 1, r.stdout + r.stderr);
      assertStringIncludes(r.stderr, "was renamed");
      assertStringIncludes(r.stderr, successor);
    }
    for (
      const [synonym, canonical] of Object.entries(COMMAND_SYNONYM_SUGGESTIONS)
    ) {
      const r = await runCli(["help", synonym], dir, env);
      assertEquals(r.code, 1, r.stdout + r.stderr);
      assertStringIncludes(r.stderr, `unknown command "${synonym}"`);
      assertStringIncludes(r.stderr, `discern ${canonical}`);
    }
  });
});
