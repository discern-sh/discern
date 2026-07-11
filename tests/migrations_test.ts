/**
 * The migration framework (ADR 0014): the chain runner, step selection, and the
 * MigrationContext operations. The production chain is empty at schema 1, so
 * these exercise the machinery with synthetic migrations against temp dirs —
 * proving selection/ordering, the contiguity guard, idempotency, composition,
 * and every context operation a real migration (Phase 2's rename) will lean on.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { copy, walk } from "@std/fs";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { parseDiscernToml } from "../src/lib/toml_render.ts";
import {
  applyMigrations as applyMigrationsUnchecked,
  createMigrationContext,
  isChainContiguous,
  type Migration,
  MIGRATIONS,
  pendingMigrations,
} from "../src/lib/migrations.ts";
import { parseConfig } from "../src/shared/config_schema.ts";
import { bundledSkillNames } from "../src/lib/skills.ts";
import {
  fakeEnv,
  REAL_TEMPLATES,
  targetExists,
  withTempDir,
} from "./helpers.ts";

const HISTORICAL_FIXTURES = join(
  dirname(fromFileUrl(import.meta.url)),
  "fixtures",
  "historical-installs",
);
const HISTORICAL_FIXTURE_RE = /^schema-(\d+)$/;

const CORPUS_EXEMPT_FROMS: ReadonlyMap<number, string> = new Map([
  // Covered by "migration 1→2 backfills [project].main_branch when the config predates it".
  [
    1,
    "migration 1→2 backfills [project].main_branch when the config predates it",
  ],
  // Covered by "migration 2→3 moves the config + guidance seeds (shell dispatcher left to the prune step)".
  [
    2,
    "migration 2→3 moves the config + guidance seeds (shell dispatcher left to the prune step)",
  ],
  // Covered by "migration 3→4 converts slots→capabilities/checks, inlines ratchet runs, folds side-gates, drops evidence".
  [
    3,
    "migration 3→4 converts slots→capabilities/checks, inlines ratchet runs, folds side-gates, drops evidence",
  ],
  // Covered by "migration 4→5 prunes a pre-existing on-disk shell engine, agent, and manifest".
  [
    4,
    "migration 4→5 prunes a pre-existing on-disk shell engine, agent, and manifest",
  ],
  // Covered by "migration 5→6 dissolves .discern/: moves config/guidance/recipes/authored-skills out, prunes bundled, adds sections".
  [
    5,
    "migration 5→6 dissolves .discern/: moves config/guidance/recipes/authored-skills out, prunes bundled, adds sections",
  ],
]);

function historicalFixtureName(from: number): string {
  return `schema-${String(from).padStart(2, "0")}`;
}

function historicalFixtureFrom(name: string): number {
  const match = HISTORICAL_FIXTURE_RE.exec(name);
  if (match === null || match[1] === undefined) {
    throw new Error(`not a historical fixture directory: ${name}`);
  }
  return Number(match[1]);
}

async function historicalFixtureNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(HISTORICAL_FIXTURES)) {
    if (!entry.isDirectory) continue;
    const match = HISTORICAL_FIXTURE_RE.exec(entry.name);
    if (match === null || match[1] === undefined) continue;
    const from = Number(match[1]);
    assertEquals(
      entry.name,
      historicalFixtureName(from),
      "historical fixture directories must be zero-padded, e.g. schema-06",
    );
    names.push(entry.name);
  }
  names.sort();
  return names;
}

async function historicalFixtureFroms(): Promise<Set<number>> {
  return new Set((await historicalFixtureNames()).map(historicalFixtureFrom));
}

/** Every tracked file under `dir` (excluding `.git`) as path → content, for
 * byte-for-byte no-op comparison across a migration re-application. */
async function snapshotDir(dir: string): Promise<Map<string, string>> {
  const snap = new Map<string, string>();
  for await (
    const entry of walk(dir, { includeDirs: false, includeSymlinks: false })
  ) {
    const rel = relative(dir, entry.path);
    if (rel === ".git" || rel.startsWith(`.git${"/"}`)) continue;
    snap.set(rel, await Deno.readTextFile(entry.path));
  }
  return snap;
}

/** A synthetic step that records its `from` when applied. */
function recordingStep(from: number, log: number[]): Migration {
  return {
    from,
    describe: `step ${from}→${from + 1}`,
    apply: () => {
      log.push(from);
      return Promise.resolve();
    },
  };
}

async function assertConfigParses(
  dir: string,
  validateCurrentSchema: boolean,
): Promise<void> {
  for (const rel of ["discern.toml", ".discern/config.toml"]) {
    const path = join(dir, rel);
    try {
      const text = await Deno.readTextFile(path);
      parseDiscernToml(text);
      if (validateCurrentSchema) {
        const { issues } = parseConfig(text);
        assertEquals(issues, [], `${rel} should validate with zero issues`);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw error;
    }
  }
}

async function applyMigrations(
  params: Parameters<typeof applyMigrationsUnchecked>[0],
): Promise<Migration[]> {
  const applied = await applyMigrationsUnchecked(params);
  await assertConfigParses(params.destDir, params.to === SCHEMA_VERSION);
  return applied;
}

// ---- the production chain --------------------------------------------------

Deno.test("the production chain is contiguous up to the current schema", () => {
  // One step per bump, from 1 up to SCHEMA_VERSION: 1→2 (main_branch backfill),
  // 2→3 (the .discern/ surface consolidation), 3→4 (capabilities/checks),
  // 4→5 (prune the pre-existing on-disk shell engine), 5→6 (dissolve .discern/
  // into the single-file footprint), 6→7 (setup skill → command),
  // 7→8 (db/dev_server → [worktree.resources.*]), 8→9 (untrack AGENTS.md),
  // 9→10 (ignore .agents/skills/), 10→11 (drop [features].mcp), 11→12 (rename
  // [worktree].graduate_to "main" → "trunk"), 12→13 (add [worktree].root),
  // 13→14 (keep machine-local provider settings ignored), 14→15 (move the
  // authored surface into the discern/ namespace), 15→16 (retire the
  // [features] toggles and [worktree].enabled), and 16→17 (drop
  // [worktree].graduate_to — accept always lands on the trunk).
  assertEquals(MIGRATIONS.map((m) => m.from), [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
  ]);
  assert(isChainContiguous(MIGRATIONS, SCHEMA_VERSION));
});

Deno.test("EVERY migration step has corpus idempotency coverage or an honest exemption", async () => {
  // The corpus idempotency guard below iterates fixtures. This companion guard
  // iterates the MIGRATIONS chain itself, so adding a new step auto-enrols it:
  // either capture schema-XX, or add a named exemption that points at its
  // per-step re-run test.
  const fixtureFroms = await historicalFixtureFroms();
  const migrationFroms = new Set(MIGRATIONS.map((m) => m.from));

  for (const [from, coveredBy] of CORPUS_EXEMPT_FROMS) {
    assert(
      migrationFroms.has(from),
      `CORPUS_EXEMPT_FROMS lists ${from}, but MIGRATIONS has no ${from}→${
        from + 1
      } step`,
    );
    assert(
      !fixtureFroms.has(from),
      `CORPUS_EXEMPT_FROMS lists ${from}, but ${
        historicalFixtureName(from)
      } now exists; delete the exemption and let the corpus guard cover it`,
    );
    assertStringIncludes(
      coveredBy,
      `migration ${from}→${from + 1}`,
      `CORPUS_EXEMPT_FROMS[${from}] must name the per-step re-run test`,
    );
  }

  for (const migration of MIGRATIONS) {
    assert(
      fixtureFroms.has(migration.from) ||
        CORPUS_EXEMPT_FROMS.has(migration.from),
      `migration ${migration.from}→${migration.from + 1} has no ${
        historicalFixtureName(migration.from)
      } fixture and no CORPUS_EXEMPT_FROMS entry naming per-step re-run coverage`,
    );
  }
});

Deno.test("EVERY historical-corpus migration step is idempotent on its own before-state", async () => {
  // Migration.apply is documented "MUST be idempotent" — re-running a step on the
  // state it just produced must change nothing. Each step is era-specific (2→3 moves
  // the config into .discern/, which 5→6 later dissolves), so idempotency is only
  // meaningful against the step's OWN before-state: a real install at that schema.
  // The historical corpus supplies exactly those, so this ties the contract to real
  // installs across the corpus-covered range and auto-enrols a new fixture. The
  // per-step unit tests cover the shape variations; the companion guard above
  // forces every non-corpus step to name its own re-run test.
  const names = await historicalFixtureNames();
  assert(names.length > 0, "the historical fixture corpus should not be empty");

  for (const name of names) {
    const from = Number(name.slice("schema-".length));
    if (from >= SCHEMA_VERSION) continue; // no step beyond the current schema
    await withTempDir(async (dir) => {
      await copy(join(HISTORICAL_FIXTURES, name), dir, { overwrite: true });
      const step = { destDir: dir, from, to: from + 1, onNote: () => {} };
      await applyMigrationsUnchecked(step); // the real transform
      const afterFirst = await snapshotDir(dir);
      await applyMigrationsUnchecked(step); // re-apply — must be a clean no-op
      assertEquals(
        await snapshotDir(dir),
        afterFirst,
        `migration ${from}→${
          from + 1
        } is not idempotent on the schema-${from} install`,
      );
    });
  }
});

Deno.test("migration 7→8 converts non-empty db/dev_server into [worktree.resources.*]", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[project]",
        'slug = "demo"',
        "",
        "[worktree]",
        "enabled = true",
        "port = true",
        "",
        "# Database seam.",
        "[worktree.db]",
        'clone = "createdb @db@"',
        'drop  = "dropdb @db@"',
        "",
        "# Dev-server seam.",
        "[worktree.dev_server]",
        'link   = "up @site@"',
        'unlink = "down @site@"',
        "",
        "# Post-create setup.",
        "[worktree.setup]",
        "steps = []",
        "",
      ].join("\n"),
    );
    await applyMigrations({ destDir: dir, from: 7, to: 8 });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    // Legacy tables (and their own doc comments) are gone; [worktree.setup] stays.
    assert(!toml.includes("[worktree.db]"), "legacy db table not removed");
    assert(
      !toml.includes("[worktree.dev_server]"),
      "legacy dev_server not removed",
    );
    assert(!toml.includes("# Database seam"), "stale db comment left behind");
    assertStringIncludes(toml, "# Post-create setup."); // sibling comment preserved
    // Commands carried forward, tokens unchanged.
    assertStringIncludes(toml, "[worktree.resources.db]");
    assertStringIncludes(toml, 'create  = "createdb @db@"');
    assertStringIncludes(toml, 'destroy = "dropdb @db@"');
    assertStringIncludes(toml, "[worktree.resources.dev_server]");
    assertStringIncludes(toml, 'create  = "up @site@"');
  });
});

Deno.test("migration 7→8 is idempotent and adds examples for an empty-seam config", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[worktree]",
        "enabled = true",
        "port = true",
        "",
        "[worktree.db]",
        'clone = ""',
        'drop  = ""',
        "",
        "[worktree.dev_server]",
        'link   = ""',
        'unlink = ""',
        "",
        "[worktree.setup]",
        "steps = []",
        "",
      ].join("\n"),
    );
    await applyMigrations({ destDir: dir, from: 7, to: 8 });
    const once = await Deno.readTextFile(join(dir, "discern.toml"));
    // Empty seams → removed, no live tables, commented examples added.
    assert(!once.includes("[worktree.db]"));
    assertStringIncludes(once, "# [worktree.resources.db]");
    assertStringIncludes(once, "# [worktree.resources.example]");
    // Re-running the step is a no-op (the legacy tables are already gone).
    await applyMigrations({ destDir: dir, from: 7, to: 8 });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), once);
  });
});

Deno.test("migration 7→8 never clobbers a hand-added resource of the same name", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[worktree]",
        "enabled = true",
        "",
        "[worktree.db]",
        'clone = "createdb @db@"',
        "",
        "[worktree.resources.db]",
        'create = "my-own-createdb @db@"',
        "",
      ].join("\n"),
    );
    await applyMigrations({ destDir: dir, from: 7, to: 8 });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!toml.includes("[worktree.db]\n"), "legacy table not removed");
    assertStringIncludes(toml, 'create = "my-own-createdb @db@"'); // user's wins
    assert(
      !toml.includes('create = "createdb @db@"'),
      "legacy clone clobbered the hand-added resource",
    );
  });
});

Deno.test("migration 8→9 ignores AGENTS.md and notes the one-time git rm --cached", async () => {
  await withTempDir(async (dir) => {
    // A schema-8 .gitignore: the mirrors are ignored, AGENTS.md is still tracked.
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      [
        "/node_modules",
        "",
        "# --- discern ---",
        "/CLAUDE.md",
        "/GEMINI.md",
        "",
      ].join("\n"),
    );
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 8,
      to: 9,
      onNote: (m) => notes.push(m),
    });

    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    // AGENTS.md is now ignored exactly once, grouped with the mirrors (before
    // /CLAUDE.md), and the pre-existing entry is preserved.
    assertEquals(gitignore.match(/^\s*\/?AGENTS\.md\b/gm)?.length, 1);
    assert(
      gitignore.indexOf("/AGENTS.md") < gitignore.indexOf("/CLAUDE.md"),
      "AGENTS.md should be grouped with the other mirrors",
    );
    assertStringIncludes(gitignore, "/node_modules");
    // The .gitignore line cannot drop an already-committed file from the index, so
    // the step tells the user the one git command to finish the untracking.
    assert(
      notes.some((n) => n.includes("git rm --cached AGENTS.md")),
      `expected a git-rm note, got: ${notes.join(" | ")}`,
    );

    // Idempotent: a re-run adds no duplicate and changes nothing.
    await applyMigrations({ destDir: dir, from: 8, to: 9, onNote: () => {} });
    const again = await Deno.readTextFile(join(dir, ".gitignore"));
    assertEquals(again, gitignore);
    assertEquals(again.match(/^\s*\/?AGENTS\.md\b/gm)?.length, 1);
  });
});

Deno.test("migration 8→9 is a no-op when there is no .gitignore to amend", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "demo"\n',
    );
    // No .gitignore present — the step must neither throw nor create one.
    await applyMigrations({ destDir: dir, from: 8, to: 9, onNote: () => {} });
    assertEquals(await targetExists(dir, ".gitignore"), false);
  });
});

Deno.test("migration 8→9 also cleans stale schema-8 worktree db/dev_server tables", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[meta]",
        "schema_version = 8",
        "",
        "[project]",
        'slug = "demo"',
        "",
        "[worktree]",
        "port = true",
        "",
        "[worktree.db]",
        'clone = ""',
        'drop = ""',
        "",
        "[worktree.dev_server]",
        'link = ""',
        'unlink = ""',
        "",
      ].join("\n"),
    );
    await applyMigrations({ destDir: dir, from: 8, to: 9 });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!toml.includes("[worktree.db]"));
    assert(!toml.includes("[worktree.dev_server]"));
    assertStringIncludes(toml, "# [worktree.resources.db]");
    assertEquals(parseConfig(toml).issues, []);
  });
});

Deno.test("migration 9→10 ignores .agents/skills/ after the .claude block, idempotently", async () => {
  await withTempDir(async (dir) => {
    // A schema-9 .gitignore carrying the .claude materialized-skills block.
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      [
        "/node_modules",
        "",
        "# --- discern ---",
        "/AGENTS.md",
        "/CLAUDE.md",
        "/GEMINI.md",
        "/.claude/*",
        "!/.claude/settings.json",
        "!/.claude/settings.local.json",
        "",
      ].join("\n"),
    );
    await applyMigrations({ destDir: dir, from: 9, to: 10, onNote: () => {} });

    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    // Ignored exactly once, after the whole .claude block (past its ! exceptions).
    assertEquals(gitignore.match(/^\s*\/?\.agents\/skills\b/gm)?.length, 1);
    assert(
      gitignore.indexOf("/.agents/skills/") >
        gitignore.indexOf("!/.claude/settings.local.json"),
      ".agents/skills should sit after the .claude block's exceptions",
    );
    assertStringIncludes(gitignore, "/node_modules");

    // Idempotent: a re-run adds no duplicate and changes nothing.
    await applyMigrations({ destDir: dir, from: 9, to: 10, onNote: () => {} });
    const again = await Deno.readTextFile(join(dir, ".gitignore"));
    assertEquals(again, gitignore);
    assertEquals(again.match(/^\s*\/?\.agents\/skills\b/gm)?.length, 1);
  });
});

Deno.test("migration 9→10 appends with a note when there is no .claude/* anchor", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "/node_modules\n");
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 9,
      to: 10,
      onNote: (m) => notes.push(m),
    });
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assertEquals(gitignore.match(/^\s*\/?\.agents\/skills\b/gm)?.length, 1);
    assertStringIncludes(gitignore, "/node_modules");
    assert(
      notes.some((n) => n.includes(".agents/skills")),
      `expected an .agents/skills note, got: ${notes.join(" | ")}`,
    );
  });
});

Deno.test("migration 9→10 is a no-op when there is no .gitignore to amend", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "demo"\n',
    );
    await applyMigrations({ destDir: dir, from: 9, to: 10, onNote: () => {} });
    assertEquals(await targetExists(dir, ".gitignore"), false);
  });
});

Deno.test("migration 10→11 drops [features].mcp, preserving the rest of [features]", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[features]",
        "worktrees = true",
        "docs      = true",
        "mcp       = true   # the discern mcp server",
        "",
        "[guidance]",
        'agents = ["codex"]',
        "",
      ].join("\n"),
    );
    await applyMigrations({ destDir: dir, from: 10, to: 11, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!/^\s*mcp\s*=/m.test(toml), `the mcp key must be gone:\n${toml}`);
    assertStringIncludes(toml, "worktrees = true"); // siblings kept
    assertStringIncludes(toml, "docs      = true");
    assertStringIncludes(toml, "[guidance]"); // the rest of the config is intact

    // Idempotent: re-running 10→11 on the now-mcp-less config changes nothing.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    await applyMigrations({ destDir: dir, from: 10, to: 11, onNote: () => {} });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), after);
  });
});

Deno.test('migration 11→12 renames [worktree].graduate_to "main" → "trunk"', async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[worktree]\nport = true\ngraduate_to = "main"\n',
    );
    await applyMigrations({ destDir: dir, from: 11, to: 12, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'graduate_to = "trunk"');
    assert(
      !/graduate_to\s*=\s*"main"/.test(toml),
      `value must be carried:\n${toml}`,
    );
    assertStringIncludes(toml, "port = true"); // siblings untouched

    // Idempotent: re-running on the now-"trunk" config changes nothing.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    await applyMigrations({ destDir: dir, from: 11, to: 12, onNote: () => {} });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), after);
  });
});

Deno.test('migration 11→12 leaves graduate_to = "branch" and an absent key untouched', async () => {
  await withTempDir(async (dir) => {
    // The default value is never rewritten (it is not the renamed legacy value).
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[worktree]\ngraduate_to = "branch"\n',
    );
    await applyMigrations({ destDir: dir, from: 11, to: 12, onNote: () => {} });
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'graduate_to = "branch"',
    );

    // An absent key is not invented — the schema default still applies.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[worktree]\nport = true\n",
    );
    await applyMigrations({ destDir: dir, from: 11, to: 12, onNote: () => {} });
    assert(
      !/graduate_to/.test(await Deno.readTextFile(join(dir, "discern.toml"))),
      "an absent graduate_to must stay absent",
    );
  });
});

Deno.test("migration 16→17 drops [worktree].graduate_to and its doc comment", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[worktree]\nport = true\n\n" +
        "# Where `discern accept` lands by default (override per-run with `--to`):\n" +
        '#   "branch"  leave the work on its own branch for review.\n' +
        'graduate_to = "branch"\n\n' +
        "# Track ignored files at worktree setup.\n" +
        "ignored_file_drift = true\n",
    );
    await applyMigrations({ destDir: dir, from: 16, to: 17, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!/graduate_to/.test(toml), `key must be dropped:\n${toml}`);
    assert(
      !/Where `discern accept` lands/.test(toml),
      `the key's own doc comment goes with it:\n${toml}`,
    );
    assertStringIncludes(toml, "port = true"); // siblings untouched
    assertStringIncludes(toml, "ignored_file_drift = true");
    assertStringIncludes(toml, "# Track ignored files"); // the NEXT key's comment stays

    // Idempotent: re-running on the already-dropped config changes nothing.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    await applyMigrations({ destDir: dir, from: 16, to: 17, onNote: () => {} });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), after);
  });
});

Deno.test("migration 16→17 removes the dotted top-level form too", async () => {
  await withTempDir(async (dir) => {
    // `worktree.graduate_to = ...` is the same key in TOML's dotted spelling —
    // detecting it semantically but removing only the table form claimed a
    // "dropped" the file didn't contain, looping the user through `discern
    // upgrade` forever.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'worktree.graduate_to = "branch"\nworktree.port = true\n',
    );
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 16,
      to: 17,
      onNote: (n) => notes.push(n),
    });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!/graduate_to/.test(toml), `key must be dropped:\n${toml}`);
    assertStringIncludes(toml, "worktree.port = true"); // siblings untouched
    assert(
      notes.some((n) => n.includes("dropped [worktree].graduate_to")),
      notes.join("\n"),
    );
  });
});

Deno.test("migration 16→17 removes an inline-table entry without splitting array siblings", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'worktree = { graduate_to = "branch", env_files = [".env", ".env.local"] }\n',
    );
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 16,
      to: 17,
      onNote: (n) => notes.push(n),
    });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!/graduate_to/.test(toml), `key must be dropped:\n${toml}`);
    assertStringIncludes(
      toml,
      'env_files = [".env", ".env.local"]',
      `a comma-bearing sibling survives intact:\n${toml}`,
    );
    assert(
      notes.some((n) => n.includes("dropped [worktree].graduate_to")),
      notes.join("\n"),
    );
  });
});

Deno.test("migration 16→17 never claims a removal it couldn't perform", async () => {
  await withTempDir(async (dir) => {
    // A QUOTED dotted key is legal TOML the lexical rewrites don't recognise:
    // the note must say 'remove it by hand', never 'dropped'. (Unchecked
    // runner: this config deliberately cannot be made valid automatically.)
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `'worktree'.'graduate_to' = "branch"\n`,
    );
    const notes: string[] = [];
    await applyMigrationsUnchecked({
      destDir: dir,
      from: 16,
      to: 17,
      onNote: (n) => notes.push(n),
    });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, "graduate_to"); // untouched — and admitted
    assert(
      notes.some((n) => n.includes("remove the key from discern.toml by hand")),
      notes.join("\n"),
    );
    assert(
      !notes.some((n) => n.includes("dropped [worktree].graduate_to")),
      `no false success note:\n${notes.join("\n")}`,
    );
  });
});

Deno.test("migration 16→17 collapses blanks at the removal site only, not file-wide", async () => {
  await withTempDir(async (dir) => {
    // A deliberate three-blank-line run elsewhere in the file is the user's
    // formatting, not ours to normalise.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[project]\nslug = 'x'\n\n\n\n# spaced out on purpose\n\n[worktree]\n" +
        'graduate_to = "trunk"\nport = true\n',
    );
    await applyMigrations({ destDir: dir, from: 16, to: 17, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!/graduate_to/.test(toml), toml);
    assertStringIncludes(
      toml,
      "\n\n\n\n# spaced out on purpose",
      `the user's own blank run stays:\n${toml}`,
    );
  });
});

Deno.test("migration 16→17 never eats a user's unrelated comment above the key", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[worktree]\n# our team's deploy notes live in the wiki\n" +
        'graduate_to = "trunk"\nport = true\n',
    );
    await applyMigrations({ destDir: dir, from: 16, to: 17, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!/graduate_to/.test(toml), `key must be dropped:\n${toml}`);
    assertStringIncludes(toml, "deploy notes live in the wiki"); // not ours to eat
  });
});

Deno.test("migration 12→13 adds a documented [worktree].root key as the first [worktree] key", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[worktree]\nenabled = true\nport = true\n",
    );
    await applyMigrations({ destDir: dir, from: 12, to: 13, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    // The key is added (empty = the sibling default) with its documentation…
    assertStringIncludes(toml, 'root = ""');
    assertStringIncludes(toml, "a SIBLING of the repo");
    // …as the FIRST key of the table (right after the header), siblings intact.
    assert(
      /\[worktree\]\n(?:#[^\n]*\n)*root = ""\n/.test(toml),
      `root must lead the [worktree] table:\n${toml}`,
    );
    assertStringIncludes(toml, "enabled = true");
    assertStringIncludes(toml, "port = true");

    // Idempotent: re-running on a config that already has root changes nothing.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    await applyMigrations({ destDir: dir, from: 12, to: 13, onNote: () => {} });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), after);
  });
});

Deno.test("migration 12→13 never invents a second root, and no-ops without a [worktree] table", async () => {
  await withTempDir(async (dir) => {
    // A hand-set root is preserved verbatim (only-if-absent).
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[worktree]\nroot = "../custom-wts"\n',
    );
    await applyMigrations({ destDir: dir, from: 12, to: 13, onNote: () => {} });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'root = "../custom-wts"');
    assert(
      (toml.match(/^root = /gm) ?? []).length === 1,
      `exactly one root key:\n${toml}`,
    );

    // No [worktree] table → nothing inserted (the schema default governs at read).
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "x"\n',
    );
    await applyMigrations({ destDir: dir, from: 12, to: 13, onNote: () => {} });
    assert(
      !/root = /.test(await Deno.readTextFile(join(dir, "discern.toml"))),
      "must not add [worktree].root when there is no [worktree] table",
    );
  });
});

Deno.test("migration 13→14 removes the .claude/settings.local.json un-ignore", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      [
        "/node_modules",
        "",
        "# --- discern ---",
        "/AGENTS.md",
        "/CLAUDE.md",
        "/GEMINI.md",
        "/.claude/*",
        "!/.claude/settings.json",
        "!/.claude/settings.local.json",
        "/.agents/skills/",
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[meta]\nschema_version = 13\n[project]\nslug = "demo"\n',
    );

    await applyMigrations({ destDir: dir, from: 13, to: 14, onNote: () => {} });

    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assertStringIncludes(gitignore, "/.claude/*");
    assertStringIncludes(gitignore, "!/.claude/settings.json");
    assert(
      !/^\s*!\/?\.claude\/settings\.local\.json\s*$/m.test(gitignore),
      `.claude/settings.local.json should stay ignored:\n${gitignore}`,
    );
    assertStringIncludes(gitignore, "/node_modules");

    await applyMigrations({ destDir: dir, from: 13, to: 14, onNote: () => {} });
    assertEquals(await Deno.readTextFile(join(dir, ".gitignore")), gitignore);
  });
});

Deno.test("migration 1→2 backfills [project].main_branch when the config predates it", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "demo"\n',
    );
    // Drive the real production chain (default registry) from schema 1 to 2.
    const applied = await applyMigrations({ destDir: dir, from: 1, to: 2 });
    assertEquals(applied.map((m) => m.from), [1]);
    const migrated = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(migrated, 'main_branch = "main"');

    // Idempotent: re-running 1→2 on the now-backfilled config changes nothing.
    const afterFirst = await snapshotDir(dir);
    await applyMigrations({ destDir: dir, from: 1, to: 2 });
    assertEquals(await snapshotDir(dir), afterFirst);
  });
});

Deno.test("migration 1→2 never clobbers a custom main_branch", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "demo"\nmain_branch = "trunk"\n',
    );
    await applyMigrations({ destDir: dir, from: 1, to: 2 });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "trunk"'); // preserved
    assert(!toml.includes('main_branch = "main"')); // not overwritten or duplicated
  });
});

Deno.test("migration 2→3 moves the config + guidance seeds (shell dispatcher left to the prune step)", async () => {
  await withTempDir(async (dir) => {
    // An old-layout install: config at the root, guidance under .ai/, and
    // worktree hooks that call ./bin/agent. The shell dispatcher (bin/agent) is
    // left in place by 2→3 — the final prune step (4→5) removes it, not a rename.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "demo"\n\n[scopes]\nneutral = ["docs/", ".ai/", ".claude/"]\n',
    );
    await Deno.mkdir(join(dir, ".ai/guidelines"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".ai/guidelines/demo.md"),
      "# guidance\n",
    );
    await Deno.mkdir(join(dir, "bin"));
    await Deno.writeTextFile(join(dir, "bin/agent"), "#!/usr/bin/env sh\n");
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".claude/settings.json"),
      '{ "hooks": { "SessionStart": [{ "command": "./bin/agent worktree ensure" }] } }\n',
    );

    // Run the real 2→3 step via the production chain.
    const applied = await applyMigrations({ destDir: dir, from: 2, to: 3 });
    assertEquals(applied.map((m) => m.from), [2]);

    // The seeds moved into the namespace; their old paths are gone.
    assert(await targetExists(dir, ".discern/config.toml"), "config moved");
    assert(
      await targetExists(dir, ".discern/guidelines/demo.md"),
      "guidance moved",
    );
    assertEquals(await targetExists(dir, "discern.toml"), false);
    assertEquals(await targetExists(dir, ".ai/guidelines/demo.md"), false);
    // The shell dispatcher is untouched here — the 4→5 prune step removes it.
    assertEquals(await targetExists(dir, "bin/agent"), true);

    // Hooks repointed at the root dispatcher; neutral globs repointed at .discern/.
    const settings = await Deno.readTextFile(
      join(dir, ".claude/settings.json"),
    );
    assertStringIncludes(settings, "./agent worktree ensure");
    assert(!settings.includes("./bin/agent"), "no stale ./bin/agent hook");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".discern/config.toml")),
      '".discern/"',
    );

    // Idempotent: a second run over the now-moved seeds is a clean no-op.
    const afterFirst = await snapshotDir(dir);
    await applyMigrations({ destDir: dir, from: 2, to: 3 });
    assertEquals(await snapshotDir(dir), afterFirst);
  });
});

Deno.test("migration 3→4 converts slots→capabilities/checks, inlines ratchet runs, folds side-gates, drops evidence", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      [
        "[project]",
        'slug = "demo"',
        "",
        "[slots.format]", // a known capability at its canonical stage
        'phase = "fix"',
        'run = "deno fmt"',
        "",
        "[slots.selfcheck]", // not vocabulary → a check
        'phase = "check"',
        'run = "make selfcheck"',
        "",
        "[slots.build]", // a no-op → dropped (absence is the new "unfilled")
        'phase = "build"',
        'run = ":"',
        "",
        "[slots.cov]", // a measurement slot → inlined into the ratchet
        'run = "measure-cov"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]', // the implicit code default → dropped
        'previewable = ["public/**"]',
        'native = ["native/**"]',
        "",
        "[scopes.side_gates]",
        'native = "make -C native check"',
        "",
        "[ratchets.coverage]",
        'direction = "up"',
        "limit = 80",
        'slot = "cov"',
        "",
        "[evidence]",
        "enabled = false",
        "",
      ].join("\n"),
    );

    const applied = await applyMigrations({ destDir: dir, from: 3, to: 4 });
    assertEquals(applied.map((m) => m.from), [3]);

    const toml = await Deno.readTextFile(join(dir, ".discern/config.toml"));
    // A known slot at its canonical stage → a capability (the stage is dropped).
    assertStringIncludes(toml, "[capabilities]");
    assertStringIncludes(toml, 'format = "deno fmt"');
    // A non-vocabulary slot → a check carrying its stage.
    assertStringIncludes(toml, "[checks.selfcheck]");
    assertStringIncludes(toml, 'stage = "check"');
    assertStringIncludes(toml, 'run = "make selfcheck"');
    // A no-op slot (build = ":") is dropped, not carried forward.
    assert(!/^\s*build\s*=/m.test(toml));
    // The measurement slot's run is inlined into the ratchet; `slot` is gone.
    assertStringIncludes(toml, 'run = "measure-cov"');
    assert(!toml.includes('slot = "cov"'));
    // Reserved scopes become flagged tables; the side gate folds into the scope.
    assertStringIncludes(toml, "[scopes.docs]");
    assertStringIncludes(toml, "neutral = true");
    assertStringIncludes(toml, "[scopes.native]");
    assertStringIncludes(toml, 'gate = "make -C native check"');
    // The legacy structure is gone.
    assert(!toml.includes("[slots."));
    assert(!toml.includes("[scopes.side_gates]"));
    assert(!toml.includes("[evidence]"));

    // Idempotent: a second run is a clean no-op.
    const afterFirst = await snapshotDir(dir);
    await applyMigrations({ destDir: dir, from: 3, to: 4 });
    assertEquals(await snapshotDir(dir), afterFirst);
  });
});

Deno.test("migration 4→5 prunes a pre-existing on-disk shell engine, agent, and manifest", async () => {
  await withTempDir(async (dir) => {
    // An install made before the TS-native engine carried a committed shell
    // engine: the engine tree, a root dispatcher, and a hash-tracking manifest.
    await Deno.mkdir(join(dir, ".discern/engine/lib"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/engine/finish"),
      "#!/bin/sh\n",
    );
    await Deno.writeTextFile(
      join(dir, ".discern/engine/lib/output.sh"),
      "x() { :; }\n",
    );
    await Deno.writeTextFile(join(dir, "agent"), "#!/bin/sh\n");
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/manifest.json"),
      '{ "kit_version": "1.0.0" }\n',
    );
    // A seed the step must NOT touch.
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      '[project]\nslug = "demo"\n',
    );
    // Pre-cutover worktree hooks calling the `./agent` dispatcher that the prune
    // deletes. The `agent/$name` branch prefix must survive — only `./agent`
    // names the dispatcher.
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".claude/settings.json"),
      `${
        JSON.stringify({
          hooks: {
            SessionStart: [{ command: "./agent worktree ensure" }],
            WorktreeRemove: [{
              command:
                "sh -c 'git worktree add -b agent/$name dir; ./agent worktree teardown'",
            }],
          },
        })
      }\n`,
    );
    // A pre-cutover .gitignore: it already ignores CLAUDE.md (self-host era) and
    // carries a user entry, but NOT the now-materialized skills (those were
    // committed-managed before the cutover).
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      "/node_modules\n/CLAUDE.md\n",
    );

    const applied = await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(applied.map((m) => m.from), [4]);

    // The whole shell engine tree, the dispatcher, and the manifest are gone.
    assertEquals(await targetExists(dir, ".discern/engine"), false);
    assertEquals(await targetExists(dir, ".discern/engine/finish"), false);
    assertEquals(await targetExists(dir, "agent"), false);
    assertEquals(await targetExists(dir, ".discern/manifest.json"), false);
    // The seed config is untouched.
    assertEquals(await targetExists(dir, ".discern/config.toml"), true);

    // The worktree hooks are repointed off the pruned `./agent` at `discern`,
    // and the `agent/<name>` branch prefix is left intact.
    const settings = await Deno.readTextFile(
      join(dir, ".claude/settings.json"),
    );
    assert(!settings.includes("./agent"), "no stale ./agent hook remains");
    assertStringIncludes(settings, "discern worktree ensure");
    assertStringIncludes(settings, "discern worktree teardown");
    assertStringIncludes(settings, "agent/$name");

    // The materialized skills are now gitignored; the user's entry and the
    // already-present CLAUDE.md line survive, and CLAUDE.md is not duplicated.
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assertStringIncludes(gitignore, "/.discern/skills/");
    assertStringIncludes(gitignore, "/node_modules");
    assertEquals(gitignore.match(/^\s*\/?CLAUDE\.md\b/gm)?.length, 1);

    // Idempotent: a re-run over the already-pruned install is a clean no-op.
    const afterFirst = await snapshotDir(dir);
    await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(await snapshotDir(dir), afterFirst);
  });
});

Deno.test("migration 4→5 is a clean no-op on a fresh install (no shell engine to prune)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      '[project]\nslug = "demo"\n',
    );
    // No engine, no agent, no manifest — the step removes nothing and does not
    // throw.
    const applied = await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(applied.map((m) => m.from), [4]);
    assertEquals(await targetExists(dir, ".discern/config.toml"), true);
  });
});

Deno.test("migration 5→6 dissolves .discern/: moves config/guidance/recipes/authored-skills out, prunes bundled, adds sections", async () => {
  await withTempDir(async (dir) => {
    // A realistic schema-5 install: config + guidelines + recipes + a MIX of a
    // bundled skill (pristine, to be pruned) and an authored one (to be moved),
    // a brief, and a pre-6 .gitignore.
    await Deno.mkdir(join(dir, ".discern/guidelines"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      [
        "[meta]",
        "schema_version = 5",
        "[project]",
        'slug = "demo"',
        'agents = ["claude_code"]',
        "[recipes]",
        'dir = ".discern/recipes"',
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, ".discern/guidelines/discern.md"),
      "# my authored guidance\n",
    );
    await Deno.writeTextFile(join(dir, ".discern/brief.md"), "build a thing\n");
    await Deno.mkdir(join(dir, ".discern/recipes"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".discern/recipes/README.md"), "docs\n");
    await Deno.writeTextFile(
      join(dir, ".discern/recipes/deploy"),
      "#!/bin/sh\n",
    );
    // A pristine bundled skill (the WHOLE tree copied byte-for-byte → pruned, since
    // the binary re-ships it) and an authored skill (a unique name → moved to
    // ./skills/, preserved). The prune check compares every file in the tree, not
    // just SKILL.md, so the fixture mirrors the full bundled directory.
    await Deno.mkdir(join(dir, ".discern/skills"), { recursive: true });
    await copy(
      join(REAL_TEMPLATES, "skills/discern-write-adr"),
      join(dir, ".discern/skills/discern-write-adr"),
    );
    await Deno.mkdir(join(dir, ".discern/skills/kit-special"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, ".discern/skills/kit-special/SKILL.md"),
      "# my own hand-authored skill\n",
    );
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      "/node_modules\n/CLAUDE.md\n/.discern/skills/\n",
    );

    const applied = await applyMigrations({
      destDir: dir,
      from: 5,
      to: 6,
      onNote: () => {},
    });
    assertEquals(applied.map((m) => m.from), [5]);

    // Config moved to the root single-file footprint; new sections present.
    assertEquals(await targetExists(dir, "discern.toml"), true);
    assertEquals(await targetExists(dir, ".discern"), false);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, "[guidance]");
    assertStringIncludes(toml, "[skills]");
    // The retired [features] section is never introduced (ADR 0101): the chain
    // runs to the current schema, where the toggles no longer exist.
    assert(!toml.includes("[features]"), "no [features] section is added");
    // Each new section arrives WITH its canonical doc block (not a bare EOF
    // append), so a migrated config reads like a fresh init's — the papercut.
    assertStringIncludes(toml, "# [guidance] — the author-once");
    assertStringIncludes(toml, "# [skills] — focused, reusable task playbooks");
    // ...and at the canonical position: grouped, in order, after [project] —
    // never dumped at EOF.
    const at = (s: string) => toml.indexOf(s);
    assert(
      at("[project]") < at("[guidance]") &&
        at("[guidance]") < at("[skills]"),
      "new sections are grouped, in order, after [project]",
    );
    // No template token leaked into the installed config.
    assertEquals([...toml.matchAll(/\{\{/g)].length, 0, "no unfilled tokens");
    // The legacy [recipes].dir default is repointed at the root layout.
    assertStringIncludes(toml, 'dir = "recipes"');
    // Agents migrated from [project] to [guidance].
    assert(!/\[project\][^[]*agents/s.test(toml), "[project].agents removed");
    assertStringIncludes(toml, 'agents = ["claude_code"]');

    // Guidance prose moved to ./guidance.md; recipes moved to ./recipes/.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "guidance.md")),
      "my authored guidance",
    );
    assertEquals(await targetExists(dir, "recipes/deploy"), true);
    assertEquals(await targetExists(dir, "brief.md"), true);

    // R1: the AUTHORED skill is preserved (moved to ./skills/); the pristine
    // bundled one is pruned (the binary re-ships it).
    assertEquals(await targetExists(dir, "skills/kit-special/SKILL.md"), true);
    assertEquals(await targetExists(dir, "skills/discern-write-adr"), false);

    // .gitignore: the dead .discern ignore is gone; the mirrors are ignored;
    // AGENTS.md is NOT ignored; the user's entry survives.
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assert(!/\.discern/.test(gitignore), "no .discern ignore remains");
    assertStringIncludes(gitignore, "/node_modules");
    assertStringIncludes(gitignore, "/GEMINI.md");
    assert(!/^\s*\/?AGENTS\.md\b/m.test(gitignore), "AGENTS.md stays tracked");

    // Idempotent: a re-run over the migrated install changes nothing.
    const afterFirst = await snapshotDir(dir);
    await applyMigrations({ destDir: dir, from: 5, to: 6, onNote: () => {} });
    assertEquals(await snapshotDir(dir), afterFirst);
  });
});

Deno.test("migration 5→6 inserts a documented [meta] at the top when an install never had one", async () => {
  await withTempDir(async (dir) => {
    // A legacy-shaped schema-5 config with NO [meta] (its version came from a
    // manifest). Without this, the schema stamp would later append a bare [meta]
    // at EOF — the bottom-heavy papercut, for the oldest installs.
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      '[project]\nslug = "demo"\n',
    );

    await applyMigrations({ destDir: dir, from: 5, to: 6, onNote: () => {} });

    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    // [meta] is present, documented, and first — ahead of [project].
    assertStringIncludes(toml, "[meta]");
    assertStringIncludes(toml, "# The install schema version");
    assertStringIncludes(toml, "schema_version =");
    assert(
      toml.indexOf("[meta]") < toml.indexOf("[project]"),
      "[meta] is first",
    );
    // The new sections still group after [project].
    assert(toml.indexOf("[project]") < toml.indexOf("[guidance]"));
  });
});

Deno.test("migration 5→6 still adds the sections (bare) when the template can't be read", async () => {
  // Graceful degradation: if the bundled template can't be resolved, the
  // migration must still produce a functionally complete config — just without
  // the doc blocks — rather than dropping the new sections.
  await withTempDir(async (dir) => {
    // A templates dir that doesn't exist forces readConfigTemplate's fallback.
    // It is injected via a fake env, not set on the process env, so this test
    // never leaks state into other files under `deno test --parallel`.
    const env = fakeEnv({
      DISCERN_TEMPLATES_DIR: join(dir, "no-such-dir-xyz"),
    });
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      '[meta]\nschema_version = 5\n[project]\nslug = "demo"\n',
    );

    await applyMigrations({
      destDir: dir,
      from: 5,
      to: 6,
      onNote: () => {},
      env,
    });

    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, "[guidance]");
    assertStringIncludes(toml, "[skills]");
    // Functional, but undocumented — the fallback path took over.
    assert(
      !toml.includes("# [guidance] — the author-once"),
      "no doc block in fallback",
    );
  });
});

Deno.test("migration 5→6 preserves a CUSTOMIZED bundled skill that differs only in a non-SKILL.md file (R1)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      '[meta]\nschema_version = 5\n[project]\nslug = "demo"\n',
    );
    // A bundled-named skill whose SKILL.md is the PRISTINE shipped copy, but with
    // a user-added file elsewhere in the tree. The SKILL.md-only check would have
    // judged this "pristine" and deleted the whole dir, losing the custom file.
    const shippedSkill = await Deno.readTextFile(
      join(REAL_TEMPLATES, "skills/discern-write-adr/SKILL.md"),
    );
    await Deno.mkdir(
      join(dir, ".discern/skills/discern-write-adr/skel/docs/_adr"),
      {
        recursive: true,
      },
    );
    await Deno.writeTextFile(
      join(dir, ".discern/skills/discern-write-adr/SKILL.md"),
      shippedSkill,
    );
    await Deno.writeTextFile(
      join(dir, ".discern/skills/discern-write-adr/skel/docs/_adr/MY-NOTE.md"),
      "# my customization the migration must not delete\n",
    );

    await applyMigrations({ destDir: dir, from: 5, to: 6, onNote: () => {} });

    // The whole customized tree is preserved as an authored override, not pruned.
    assertEquals(
      await targetExists(dir, "skills/discern-write-adr/SKILL.md"),
      true,
    );
    assertEquals(
      await targetExists(
        dir,
        "skills/discern-write-adr/skel/docs/_adr/MY-NOTE.md",
      ),
      true,
    );
    assertEquals(await targetExists(dir, ".discern"), false);
  });
});

Deno.test("migration 6→7 back-fills [meta].bootstrapped = true when capabilities are wired", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[meta]\nschema_version = 6\n[project]\nslug = "demo"\n[capabilities]\nformat = "deno fmt"\n',
    );
    const applied = await applyMigrations({ destDir: dir, from: 6, to: 7 });
    assertEquals(applied.map((m) => m.from), [6]);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("migration 6→7 back-fills true when a docs/ tree exists, even without capabilities", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[meta]\nschema_version = 6\n[project]\nslug = "demo"\n',
    );
    await Deno.mkdir(join(dir, "docs"));
    await applyMigrations({ destDir: dir, from: 6, to: 7 });
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("migration 6→7 leaves the marker absent for a bare install (absent ≡ not set up)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[meta]\nschema_version = 6\n[project]\nslug = "demo"\n',
    );
    await applyMigrations({ destDir: dir, from: 6, to: 7 });
    // No capabilities, no docs/ → first `discern setup` should still run, so
    // the migration records nothing (a bare install reads as not set up).
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped",
      ),
    );
  });
});

Deno.test("migration 6→7 prunes the stale materialized setup skill and never clobbers an explicit marker", async () => {
  await withTempDir(async (dir) => {
    // A configured install that already recorded bootstrapped = false by hand:
    // the back-fill must not flip it to true despite the capabilities.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[meta]\nschema_version = 6\nbootstrapped = false\n[project]\nslug = "demo"\n[capabilities]\nformat = "x"\n',
    );
    await Deno.mkdir(join(dir, ".claude/skills/bootstrap"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, ".claude/skills/bootstrap/SKILL.md"),
      "stale materialized copy\n",
    );
    await applyMigrations({ destDir: dir, from: 6, to: 7 });
    // The retired skill's materialized copy is gone (it is no longer bundled).
    assertEquals(await targetExists(dir, ".claude/skills/bootstrap"), false);
    // The hand-set marker is preserved, not overwritten.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = false",
    );
  });
});

Deno.test("isChainContiguous accepts a full chain and rejects gaps / dups / wrong length", () => {
  const step = (from: number): Migration => ({
    from,
    describe: "",
    apply: () => Promise.resolve(),
  });
  assert(isChainContiguous([step(1), step(2)], 3)); // 1→2→3
  assert(isChainContiguous([], 1)); // empty is valid at v1
  assert(!isChainContiguous([step(1)], 3)); // missing 2→3
  assert(!isChainContiguous([step(1), step(3)], 4)); // gap at 2
  assert(!isChainContiguous([step(1), step(1)], 3)); // duplicate
});

// ---- step selection --------------------------------------------------------

Deno.test("pendingMigrations selects [recorded, current) and orders ascending", () => {
  const reg = [
    recordingStep(3, []),
    recordingStep(1, []),
    recordingStep(2, []),
  ];
  assertEquals(pendingMigrations(1, 4, reg).map((m) => m.from), [1, 2, 3]);
  assertEquals(pendingMigrations(2, 4, reg).map((m) => m.from), [2, 3]);
  assertEquals(pendingMigrations(4, 4, reg).map((m) => m.from), []); // current
  assertEquals(pendingMigrations(1, 1, reg).map((m) => m.from), []); // nothing
});

// ---- the runner ------------------------------------------------------------

Deno.test("applyMigrations runs pending steps in order and returns them", async () => {
  await withTempDir(async (dir) => {
    const log: number[] = [];
    const reg = [recordingStep(1, log), recordingStep(2, log)];
    const applied = await applyMigrations({
      destDir: dir,
      from: 1,
      to: 3,
      registry: reg,
    });
    assertEquals(log, [1, 2]);
    assertEquals(applied.map((m) => m.from), [1, 2]);
  });
});

Deno.test("applyMigrations composes: 1→3 equals 1→2 then 2→3", async () => {
  await withTempDir(async (dir) => {
    const direct: number[] = [];
    const reg = [recordingStep(1, direct), recordingStep(2, direct)];
    await applyMigrations({ destDir: dir, from: 1, to: 3, registry: reg });

    const stepwise: number[] = [];
    const reg2 = [recordingStep(1, stepwise), recordingStep(2, stepwise)];
    await applyMigrations({ destDir: dir, from: 1, to: 2, registry: reg2 });
    await applyMigrations({ destDir: dir, from: 2, to: 3, registry: reg2 });

    assertEquals(direct, stepwise);
  });
});

Deno.test("applyMigrations throws on a broken chain (a missing step)", async () => {
  await withTempDir(async (dir) => {
    const reg = [recordingStep(1, [])]; // no step for 2→3
    await assertRejects(
      () => applyMigrations({ destDir: dir, from: 1, to: 3, registry: reg }),
      Error,
      "broken migration chain",
    );
  });
});

// ---- the MigrationContext --------------------------------------------------

Deno.test("context: write / read / exists / remove (idempotent)", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    assertEquals(await ctx.exists("a/b.txt"), false);
    await ctx.writeText("a/b.txt", "hello"); // creates parent dir
    assertEquals(await ctx.exists("a/b.txt"), true);
    assertEquals(await ctx.readText("a/b.txt"), "hello");
    assertEquals(await ctx.readText("missing"), undefined);
    await ctx.remove("a/b.txt");
    assertEquals(await ctx.exists("a/b.txt"), false);
    await ctx.remove("a/b.txt"); // already gone — no throw
  });
});

Deno.test("context: removeAll deletes a subtree and is idempotent", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText("tree/sub/leaf.txt", "x"); // creates the nested dirs
    assertEquals(await ctx.exists("tree/sub/leaf.txt"), true);
    await ctx.removeAll("tree"); // recursive — removes the whole subtree
    assertEquals(await ctx.exists("tree"), false);
    await ctx.removeAll("tree"); // already gone — no throw
    // A plain file is removed too.
    await ctx.writeText("solo", "y");
    await ctx.removeAll("solo");
    assertEquals(await ctx.exists("solo"), false);
  });
});

Deno.test("context: rename moves content and is idempotent on re-run", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText("old/name", "carry me");
    await ctx.rename("old/name", "new/name"); // creates new/, moves content
    assertEquals(await ctx.exists("old/name"), false);
    assertEquals(await ctx.readText("new/name"), "carry me");
    // Re-run: source gone, destination present → no-op, no throw.
    await ctx.rename("old/name", "new/name");
    assertEquals(await ctx.readText("new/name"), "carry me");
  });
});

Deno.test("context: rewrite transforms text, no-ops on absent or unchanged", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText("f", "DISCERN_HOME and DISCERN_LIB");
    await ctx.rewrite("f", (t) => t.replaceAll("DISCERN_", "KIT_"));
    assertEquals(await ctx.readText("f"), "KIT_HOME and KIT_LIB");
    // Absent file → no-op (no throw, no creation).
    await ctx.rewrite("ghost", (t) => t.toUpperCase());
    assertEquals(await ctx.exists("ghost"), false);
  });
});

Deno.test("context: editToml edits comment-preserving, no-ops without a config", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    // No .discern/config.toml yet → no-op.
    await ctx.editToml((e) => e.setString("project.slug", "x"));
    assertEquals(await ctx.exists(".discern/config.toml"), false);

    await ctx.writeText(
      ".discern/config.toml",
      '# my config\n[project]\nslug = "demo"\n',
    );
    await ctx.editToml((e) => e.setString("project.branch_prefix", "agent/"));
    const toml = await ctx.readText(".discern/config.toml");
    assertExists(toml);
    assert(toml.includes('branch_prefix = "agent/"'));
    assert(toml.includes("# my config"), "comments are preserved");
  });
});

Deno.test("context: mergeSettings deep-merges into .claude/settings.json", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    // Absent → created.
    await ctx.mergeSettings({ model: "opus" });
    const created = await ctx.readText(".claude/settings.json");
    assertExists(created);
    let settings = JSON.parse(created);
    assertEquals(settings.model, "opus");
    // Existing → merged, prior keys kept.
    await ctx.mergeSettings({ permissions: { deny: ["Read(./.env)"] } });
    const merged = await ctx.readText(".claude/settings.json");
    assertExists(merged);
    settings = JSON.parse(merged);
    assertEquals(settings.model, "opus");
    assertEquals(settings.permissions.deny, ["Read(./.env)"]);
  });
});

Deno.test("context: note forwards to the provided sink", () => {
  // note() touches no disk, so no temp dir is needed.
  const notes: string[] = [];
  const ctx = createMigrationContext("/unused", (m) => notes.push(m));
  ctx.note("renamed the engine dir");
  assertEquals(notes, ["renamed the engine dir"]);
});

Deno.test("a rename migration is idempotent end-to-end through applyMigrations", async () => {
  await withTempDir(async (dir) => {
    const renameStep: Migration = {
      from: 1,
      describe: "rename a → b",
      apply: async (ctx) => {
        await ctx.rename("a", "b");
        ctx.note("moved a to b");
      },
    };
    await Deno.writeTextFile(join(dir, "a"), "data");
    await applyMigrations({
      destDir: dir,
      from: 1,
      to: 2,
      registry: [renameStep],
    });
    assertEquals(await targetExists(dir, "a"), false);
    assertEquals(await targetExists(dir, "b"), true);
    // Running the same step again must not fail or change the result.
    await applyMigrations({
      destDir: dir,
      from: 1,
      to: 2,
      registry: [renameStep],
    });
    assertEquals(await targetExists(dir, "b"), true);
  });
});

// ---- failure-branch recovery (the untested half of the recovery model) -----
//
// The migration runner's safety story is: a step that throws ABORTS the chain
// (later steps never run), the CALLER never stamps the schema on failure (the
// stamp happens only after applyMigrations returns), and because every step is
// idempotent, a re-run replays the full pending set safely and converges. The
// idempotency half is well-covered above; this pins the FAILURE half — the one
// the audit flagged as the missing guard for the data-loss concern.

Deno.test("applyMigrations: a step that throws aborts the chain, runs no later step, and a clean re-run converges idempotently", async () => {
  await withTempDir(async (dir) => {
    const calls: { s1: number; s2: number; s3: number } = {
      s1: 0,
      s2: 0,
      s3: 0,
    };
    // Each step writes its marker ONCE (the real idempotent pattern: a no-op when
    // already applied). The middle step throws on its first attempt only,
    // modelling a transient failure partway through the chain.
    const writeOnce = async (
      ctx: {
        exists(r: string): Promise<boolean>;
        writeText(r: string, c: string): Promise<void>;
      },
      marker: string,
    ): Promise<void> => {
      if (!(await ctx.exists(marker))) {
        await ctx.writeText(marker, "applied");
      }
    };
    const registry: Migration[] = [
      {
        from: 1,
        describe: "s1",
        apply: (ctx) => {
          calls.s1++;
          return writeOnce(ctx, "s1.marker");
        },
      },
      {
        from: 2,
        describe: "s2 (transiently fails once)",
        apply: async (ctx) => {
          calls.s2++;
          if (calls.s2 === 1) {
            throw new Error("transient boom");
          }
          await writeOnce(ctx, "s2.marker");
        },
      },
      {
        from: 3,
        describe: "s3",
        apply: (ctx) => {
          calls.s3++;
          return writeOnce(ctx, "s3.marker");
        },
      },
    ];

    // First run: the middle step throws → applyMigrations propagates and aborts.
    await assertRejects(
      () => applyMigrations({ destDir: dir, from: 1, to: 4, registry }),
      Error,
      "transient boom",
    );
    // Partial progress persisted for the step that ran; the LATER step never ran
    // (the throw must abort the loop, not skip-and-continue).
    assertEquals(await targetExists(dir, "s1.marker"), true);
    assertEquals(await targetExists(dir, "s2.marker"), false);
    assertEquals(
      await targetExists(dir, "s3.marker"),
      false,
      "a step AFTER the failure ran despite the abort",
    );
    assertEquals(calls, { s1: 1, s2: 1, s3: 0 });

    // applyMigrations THREW, so it never returned — the caller's post-return
    // schema stamp is structurally unreachable, leaving the full pending set to
    // re-run. Re-run with the now-recovered registry: it converges.
    const applied = await applyMigrations({
      destDir: dir,
      from: 1,
      to: 4,
      registry,
    });
    assertEquals(applied.map((m) => m.from), [1, 2, 3]);
    // Every step's effect is present now.
    assertEquals(await targetExists(dir, "s1.marker"), true);
    assertEquals(await targetExists(dir, "s2.marker"), true);
    assertEquals(await targetExists(dir, "s3.marker"), true);
    // The already-applied step was REPLAYED (called again) but idempotent — its
    // marker is untouched, proving the replay is safe, not corrupting.
    assertEquals(calls, { s1: 2, s2: 2, s3: 1 });
  });
});

// ── the 14→15 namespace consolidation (ADR 0099/0102) ────────────────────────

/** A default-layout schema-14 install: every authored source at its old root
 * default, with the keys written the way the schema-14 template wrote them. */
async function layDefaultLayoutInstall(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, "discern.toml"),
    [
      "[meta]",
      "schema_version = 14",
      "",
      "[project]",
      'slug = "demo"',
      'gotchas_doc = "docs/80-development/done-gate-gotchas.md"',
      "",
      "[guidance]",
      'sources = ["guidance.md"]',
      'agents = ["codex"]',
      "",
      "[skills]",
      'dir = "skills"',
      "",
      "[docs]",
      'dir = "docs/"',
      "",
      "[scopes.docs]",
      'paths   = ["${docs.dir}", "skills/", ".claude/"]',
      "neutral = true",
      "",
      "[recipes]",
      'dir = "recipes"',
      "",
    ].join("\n"),
  );
  await Deno.writeTextFile(join(dir, "guidance.md"), "# Mine\n");
  await Deno.writeTextFile(join(dir, "TODO.md"), "# TODO\n- [ ] a thing\n");
  await Deno.writeTextFile(join(dir, "brief.md"), "# Brief\n");
  await Deno.mkdir(join(dir, "docs/80-development"), { recursive: true });
  await Deno.writeTextFile(join(dir, "docs/README.md"), "# Docs\n");
  await Deno.writeTextFile(
    join(dir, "docs/80-development/done-gate-gotchas.md"),
    "# Gotchas\n",
  );
  await Deno.mkdir(join(dir, "skills/my-skill"), { recursive: true });
  await Deno.writeTextFile(join(dir, "skills/my-skill/SKILL.md"), "do it\n");
  await Deno.mkdir(join(dir, "recipes"), { recursive: true });
  await Deno.writeTextFile(join(dir, "recipes/hello"), "#!/bin/sh\necho hi\n");
}

Deno.test("migration 14→15 moves a default layout into discern/ and repoints the written keys", async () => {
  await withTempDir(async (dir) => {
    await layDefaultLayoutInstall(dir);
    await applyMigrations({ destDir: dir, from: 14, to: 15 });

    // Every source moved to its namespace default, content intact.
    assertEquals(await targetExists(dir, "discern/guidance.md"), true);
    assertEquals(await targetExists(dir, "discern/TODO.md"), true);
    assertEquals(await targetExists(dir, "discern/brief.md"), true);
    assertEquals(await targetExists(dir, "discern/docs/README.md"), true);
    assertEquals(
      await targetExists(dir, "discern/skills/my-skill/SKILL.md"),
      true,
    );
    assertEquals(await targetExists(dir, "discern/recipes/hello"), true);
    // …and the old locations are gone.
    for (
      const old of [
        "guidance.md",
        "TODO.md",
        "brief.md",
        "docs",
        "skills",
        "recipes",
      ]
    ) {
      assertEquals(await targetExists(dir, old), false, `${old} left behind`);
    }

    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    // The written old-default keys converge on the new defaults…
    assertStringIncludes(toml, 'sources = ["discern/guidance.md"]');
    assertStringIncludes(toml, 'dir = "discern/skills"');
    assertStringIncludes(toml, 'dir = "discern/docs/"');
    assertStringIncludes(toml, 'dir = "discern/recipes"');
    // …the gotchas pointer follows the moved docs tree…
    assertStringIncludes(
      toml,
      'gotchas_doc = "discern/docs/80-development/done-gate-gotchas.md"',
    );
    // …and the seeded neutral-scope skills glob is repointed (${docs.dir} needs
    // no repoint — it follows the key).
    assertStringIncludes(toml, '"discern/skills/"');

    // Idempotent: a second run changes nothing.
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    await applyMigrations({ destDir: dir, from: 14, to: 15 });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), before);
  });
});

Deno.test("migration 14→15 leaves a pointed layout completely untouched", async () => {
  await withTempDir(async (dir) => {
    const toml = [
      "[meta]",
      "schema_version = 14",
      "",
      "[project]",
      'slug = "demo"',
      "",
      "[guidance]",
      'sources = ["conventions/rules.md"]',
      'agents = ["codex"]',
      "",
      "[skills]",
      'dir = "tools/skills"',
      "",
      "[docs]",
      'dir = "documentation/"',
      "",
      "[recipes]",
      'dir = "tools/recipes"',
      "",
    ].join("\n");
    await Deno.writeTextFile(join(dir, "discern.toml"), toml);
    await Deno.mkdir(join(dir, "conventions"), { recursive: true });
    await Deno.writeTextFile(join(dir, "conventions/rules.md"), "# Rules\n");
    await Deno.mkdir(join(dir, "documentation"), { recursive: true });
    await Deno.writeTextFile(join(dir, "documentation/README.md"), "# Docs\n");

    await applyMigrations({ destDir: dir, from: 14, to: 15 });

    // Pointed paths: nothing moved, nothing rewritten, no discern/ created.
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), toml);
    assertEquals(await targetExists(dir, "conventions/rules.md"), true);
    assertEquals(await targetExists(dir, "documentation/README.md"), true);
    assertEquals(await targetExists(dir, "discern"), false);
  });
});

Deno.test("migration 14→15 pins a key to its old location when the namespace target is occupied", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      ["[meta]", "schema_version = 14", "", "[docs]", 'dir = "docs/"', ""].join(
        "\n",
      ),
    );
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Old\n");
    await Deno.mkdir(join(dir, "discern/docs"), { recursive: true });
    await Deno.writeTextFile(join(dir, "discern/docs/README.md"), "# New\n");

    await applyMigrations({ destDir: dir, from: 14, to: 15 });

    // Neither tree was clobbered; the key still points at the working old tree.
    assertEquals(
      await Deno.readTextFile(join(dir, "docs/README.md")),
      "# Old\n",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, "discern/docs/README.md")),
      "# New\n",
    );
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'dir = "docs/"');
  });
});

Deno.test("migration 14→15 with absent keys moves the files and writes no keys", async () => {
  await withTempDir(async (dir) => {
    const toml = ["[meta]", "schema_version = 14", ""].join("\n");
    await Deno.writeTextFile(join(dir, "discern.toml"), toml);
    await Deno.writeTextFile(join(dir, "TODO.md"), "# TODO\n");
    await Deno.writeTextFile(join(dir, "guidance.md"), "# Mine\n");

    await applyMigrations({ destDir: dir, from: 14, to: 15 });

    assertEquals(await targetExists(dir, "discern/TODO.md"), true);
    assertEquals(await targetExists(dir, "discern/guidance.md"), true);
    assertEquals(await targetExists(dir, "TODO.md"), false);
    // No key was written — the new schema defaults cover the moved files.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!after.includes("todo"), "no [project].todo key should be written");
    assert(
      !after.includes("sources"),
      "no [guidance].sources key should be written",
    );
  });
});

// ---- 15→16: retire the [features] toggles (ADR 0101) ------------------------

/** A schema-15-shaped config carrying the full [features] block (values as
 * given) and a [worktree] with the retired `enabled` key. */
function schema15Toml(overrides: Partial<Record<string, string>> = {}): string {
  const v = (name: string): string => overrides[name] ?? "true";
  return [
    "[meta]",
    "schema_version = 15",
    "",
    "[project]",
    'slug = "demo"',
    "",
    "# ─────",
    "# [features] — toggle whole discern subsystems on/off.",
    "# ─────",
    "",
    "[features]",
    `worktrees = ${v("worktrees")}`,
    `ratchets  = ${v("ratchets")}`,
    `guidance  = ${v("guidance")}`,
    `skills    = ${v("skills")}`,
    `docs      = ${v("docs")}`,
    `coupling  = ${v("coupling")}`,
    "",
    "[worktree]",
    `enabled = ${overrides.enabled ?? "true"}`,
    'root = ""',
    "",
  ].join("\n");
}

Deno.test("migration 15→16 drops [features] (banner included) and [worktree].enabled, silently for all-default values", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "discern.toml"), schema15Toml());
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 15,
      to: 16,
      onNote: (m) => notes.push(m),
    });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(!toml.includes("[features]"), `[features] must be gone:\n${toml}`);
    assert(
      !toml.includes("toggle whole discern subsystems"),
      "the banner comment goes with the section",
    );
    assert(!/^\s*enabled\s*=/m.test(toml), "[worktree].enabled must be gone");
    assertStringIncludes(toml, 'root = ""'); // siblings kept
    // Every dropped value was the shipped default — nothing worth a note.
    assertEquals(notes, []);

    // Idempotent: a re-run over the migrated config changes nothing.
    const after = await Deno.readTextFile(join(dir, "discern.toml"));
    await applyMigrations({ destDir: dir, from: 15, to: 16 });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), after);
  });
});

Deno.test("migration 15→16 names every discarded non-default preference in the notes", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      schema15Toml({ coupling: "false", enabled: "false" }),
    );
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 15,
      to: 16,
      onNote: (m) => notes.push(m),
    });
    assert(
      notes.some((n) => n.includes("[features].coupling = false")),
      `the discarded coupling toggle is named:\n${notes.join("\n")}`,
    );
    assert(
      notes.some((n) => n.includes("[worktree].enabled = false")),
      `the discarded enabled key is named:\n${notes.join("\n")}`,
    );
  });
});

Deno.test("migration 15→16 maps features.skills = false to a [skills].exclude of the bundled set", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      schema15Toml({ skills: "false" }),
    );
    const notes: string[] = [];
    await applyMigrations({
      destDir: dir,
      from: 15,
      to: 16,
      onNote: (m) => notes.push(m),
    });
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    // The honest equivalent: every bundled skill excluded by name.
    for (const name of await bundledSkillNames()) {
      assertStringIncludes(toml, `"${name}"`);
    }
    assertStringIncludes(toml, "exclude");
    assert(
      notes.some((n) => n.includes("[skills].exclude")),
      `the mapping is named in the notes:\n${notes.join("\n")}`,
    );
  });
});
