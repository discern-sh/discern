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
import { join } from "@std/path";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import {
  applyMigrations,
  createMigrationContext,
  isChainContiguous,
  type Migration,
  MIGRATIONS,
  pendingMigrations,
} from "../src/lib/migrations.ts";
import { REAL_TEMPLATES, targetExists, withTempDir } from "./helpers.ts";

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

// ---- the production chain --------------------------------------------------

Deno.test("the production chain is contiguous up to the current schema", () => {
  // One step per bump, from 1 up to SCHEMA_VERSION: 1→2 (main_branch backfill),
  // 2→3 (the .discern/ surface consolidation), 3→4 (capabilities/checks),
  // 4→5 (prune the pre-existing on-disk shell engine), and 5→6 (dissolve
  // .discern/ into the single-file footprint).
  assertEquals(MIGRATIONS.map((m) => m.from), [1, 2, 3, 4, 5]);
  assert(isChainContiguous(MIGRATIONS, SCHEMA_VERSION));
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
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'main_branch = "main"',
    );
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
      '{ "hooks": { "SessionStart": [{ "command": "./bin/agent worktree:ensure" }] } }\n',
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
    assertStringIncludes(settings, "./agent worktree:ensure");
    assert(!settings.includes("./bin/agent"), "no stale ./bin/agent hook");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".discern/config.toml")),
      '".discern/"',
    );

    // Idempotent: a second run over the now-moved seeds is a clean no-op.
    await applyMigrations({ destDir: dir, from: 2, to: 3 });
    assert(await targetExists(dir, ".discern/config.toml"));
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
    await applyMigrations({ destDir: dir, from: 3, to: 4 });
    assertEquals(
      await Deno.readTextFile(join(dir, ".discern/config.toml")),
      toml,
    );
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
            SessionStart: [{ command: "./agent worktree:ensure" }],
            WorktreeRemove: [{
              command:
                "sh -c 'git worktree add -b agent/$name dir; ./agent worktree:teardown'",
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
    assertStringIncludes(settings, "discern worktree:ensure");
    assertStringIncludes(settings, "discern worktree:teardown");
    assertStringIncludes(settings, "agent/$name");

    // The materialized skills are now gitignored; the user's entry and the
    // already-present CLAUDE.md line survive, and CLAUDE.md is not duplicated.
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assertStringIncludes(gitignore, "/.discern/skills/");
    assertStringIncludes(gitignore, "/node_modules");
    assertEquals(gitignore.match(/^\s*\/?CLAUDE\.md\b/gm)?.length, 1);

    // Idempotent: a re-run over the already-pruned install is a clean no-op —
    // the hooks stay repointed and the .gitignore gains no duplicate lines.
    await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(await targetExists(dir, ".discern/config.toml"), true);
    assertEquals(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
      settings,
    );
    assertEquals(await Deno.readTextFile(join(dir, ".gitignore")), gitignore);
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
    // A pristine bundled skill (byte-identical to the shipped one → pruned) and an
    // authored skill (a unique name → moved to ./skills/, preserved).
    const shippedHandoff = await Deno.readTextFile(
      join(REAL_TEMPLATES, "skills/handoff-worktree/SKILL.md"),
    );
    await Deno.mkdir(join(dir, ".discern/skills/handoff-worktree"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, ".discern/skills/handoff-worktree/SKILL.md"),
      shippedHandoff,
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
    assertStringIncludes(toml, "[features]");
    assertStringIncludes(toml, "[guidance]");
    assertStringIncludes(toml, "[skills]");
    // Each new section arrives WITH its canonical doc block (not a bare EOF
    // append), so a migrated config reads like a fresh init's — the papercut.
    assertStringIncludes(
      toml,
      "# [features] — toggle whole discern subsystems",
    );
    assertStringIncludes(toml, "# [guidance] — the author-once");
    assertStringIncludes(toml, "# [skills] — focused, reusable task playbooks");
    // ...and at the canonical position: grouped, in order, after [project] —
    // never dumped at EOF.
    const at = (s: string) => toml.indexOf(s);
    assert(
      at("[project]") < at("[features]") &&
        at("[features]") < at("[guidance]") &&
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
    assertEquals(await targetExists(dir, "skills/handoff-worktree"), false);

    // .gitignore: the dead .discern ignore is gone; the mirrors are ignored;
    // AGENTS.md is NOT ignored; the user's entry survives.
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assert(!/\.discern/.test(gitignore), "no .discern ignore remains");
    assertStringIncludes(gitignore, "/node_modules");
    assertStringIncludes(gitignore, "/GEMINI.md");
    assert(!/^\s*\/?AGENTS\.md\b/m.test(gitignore), "AGENTS.md stays tracked");

    // Idempotent: a re-run over the migrated install changes nothing — the
    // sections are present now, so insertion is skipped, not repeated.
    await applyMigrations({ destDir: dir, from: 5, to: 6, onNote: () => {} });
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), toml);
    assertEquals(await targetExists(dir, "skills/kit-special/SKILL.md"), true);
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
    assert(toml.indexOf("[project]") < toml.indexOf("[features]"));
  });
});

Deno.test("migration 5→6 still adds the sections (bare) when the template can't be read", async () => {
  // Graceful degradation: if the bundled template can't be resolved, the
  // migration must still produce a functionally complete config — just without
  // the doc blocks — rather than dropping the new sections.
  const saved = Deno.env.get("DISCERN_TEMPLATES_DIR");
  Deno.env.set(
    "DISCERN_TEMPLATES_DIR",
    join(saved ?? "/tmp", "no-such-dir-xyz"),
  );
  try {
    await withTempDir(async (dir) => {
      await Deno.mkdir(join(dir, ".discern"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".discern/config.toml"),
        '[meta]\nschema_version = 5\n[project]\nslug = "demo"\n',
      );

      await applyMigrations({ destDir: dir, from: 5, to: 6, onNote: () => {} });

      const toml = await Deno.readTextFile(join(dir, "discern.toml"));
      assertStringIncludes(toml, "[features]");
      assertStringIncludes(toml, "[guidance]");
      assertStringIncludes(toml, "[skills]");
      // Functional, but undocumented — the fallback path took over.
      assert(
        !toml.includes("# [features] — toggle"),
        "no doc block in fallback",
      );
    });
  } finally {
    if (saved === undefined) Deno.env.delete("DISCERN_TEMPLATES_DIR");
    else Deno.env.set("DISCERN_TEMPLATES_DIR", saved);
  }
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
      join(REAL_TEMPLATES, "skills/write-adr/SKILL.md"),
    );
    await Deno.mkdir(join(dir, ".discern/skills/write-adr/skel/docs/_adr"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, ".discern/skills/write-adr/SKILL.md"),
      shippedSkill,
    );
    await Deno.writeTextFile(
      join(dir, ".discern/skills/write-adr/skel/docs/_adr/MY-NOTE.md"),
      "# my customization the migration must not delete\n",
    );

    await applyMigrations({ destDir: dir, from: 5, to: 6, onNote: () => {} });

    // The whole customized tree is preserved as an authored override, not pruned.
    assertEquals(await targetExists(dir, "skills/write-adr/SKILL.md"), true);
    assertEquals(
      await targetExists(dir, "skills/write-adr/skel/docs/_adr/MY-NOTE.md"),
      true,
    );
    assertEquals(await targetExists(dir, ".discern"), false);
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
