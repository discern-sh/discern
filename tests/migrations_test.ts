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
import { targetExists, withTempDir } from "./helpers.ts";

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
  // 2→3 (the .icculus/ surface consolidation), 3→4 (capabilities/checks), and
  // 4→5 (prune the pre-existing on-disk shell engine).
  assertEquals(MIGRATIONS.map((m) => m.from), [1, 2, 3, 4]);
  assert(isChainContiguous(MIGRATIONS, SCHEMA_VERSION));
});

Deno.test("migration 1→2 backfills [project].main_branch when the config predates it", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "icculus.toml"),
      '[project]\nslug = "demo"\n',
    );
    // Drive the real production chain (default registry) from schema 1 to 2.
    const applied = await applyMigrations({ destDir: dir, from: 1, to: 2 });
    assertEquals(applied.map((m) => m.from), [1]);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "icculus.toml")),
      'main_branch = "main"',
    );
  });
});

Deno.test("migration 1→2 never clobbers a custom main_branch", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "icculus.toml"),
      '[project]\nslug = "demo"\nmain_branch = "trunk"\n',
    );
    await applyMigrations({ destDir: dir, from: 1, to: 2 });
    const toml = await Deno.readTextFile(join(dir, "icculus.toml"));
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
      join(dir, "icculus.toml"),
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
    assert(await targetExists(dir, ".icculus/config.toml"), "config moved");
    assert(
      await targetExists(dir, ".icculus/guidelines/demo.md"),
      "guidance moved",
    );
    assertEquals(await targetExists(dir, "icculus.toml"), false);
    assertEquals(await targetExists(dir, ".ai/guidelines/demo.md"), false);
    // The shell dispatcher is untouched here — the 4→5 prune step removes it.
    assertEquals(await targetExists(dir, "bin/agent"), true);

    // Hooks repointed at the root dispatcher; neutral globs repointed at .icculus/.
    const settings = await Deno.readTextFile(
      join(dir, ".claude/settings.json"),
    );
    assertStringIncludes(settings, "./agent worktree:ensure");
    assert(!settings.includes("./bin/agent"), "no stale ./bin/agent hook");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".icculus/config.toml")),
      '".icculus/"',
    );

    // Idempotent: a second run over the now-moved seeds is a clean no-op.
    await applyMigrations({ destDir: dir, from: 2, to: 3 });
    assert(await targetExists(dir, ".icculus/config.toml"));
  });
});

Deno.test("migration 3→4 converts slots→capabilities/checks, inlines ratchet runs, folds side-gates, drops evidence", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".icculus"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
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

    const toml = await Deno.readTextFile(join(dir, ".icculus/config.toml"));
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
      await Deno.readTextFile(join(dir, ".icculus/config.toml")),
      toml,
    );
  });
});

Deno.test("migration 4→5 prunes a pre-existing on-disk shell engine, agent, and manifest", async () => {
  await withTempDir(async (dir) => {
    // An install made before the TS-native engine carried a committed shell
    // engine: the engine tree, a root dispatcher, and a hash-tracking manifest.
    await Deno.mkdir(join(dir, ".icculus/engine/lib"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".icculus/engine/finish"),
      "#!/bin/sh\n",
    );
    await Deno.writeTextFile(
      join(dir, ".icculus/engine/lib/output.sh"),
      "x() { :; }\n",
    );
    await Deno.writeTextFile(join(dir, "agent"), "#!/bin/sh\n");
    await Deno.mkdir(join(dir, ".icculus"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".icculus/manifest.json"),
      '{ "kit_version": "1.0.0" }\n',
    );
    // A seed the step must NOT touch.
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
      '[project]\nslug = "demo"\n',
    );

    const applied = await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(applied.map((m) => m.from), [4]);

    // The whole shell engine tree, the dispatcher, and the manifest are gone.
    assertEquals(await targetExists(dir, ".icculus/engine"), false);
    assertEquals(await targetExists(dir, ".icculus/engine/finish"), false);
    assertEquals(await targetExists(dir, "agent"), false);
    assertEquals(await targetExists(dir, ".icculus/manifest.json"), false);
    // The seed config is untouched.
    assertEquals(await targetExists(dir, ".icculus/config.toml"), true);

    // Idempotent: a re-run over the already-pruned install is a clean no-op.
    await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(await targetExists(dir, ".icculus/config.toml"), true);
  });
});

Deno.test("migration 4→5 is a clean no-op on a fresh install (no shell engine to prune)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".icculus"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
      '[project]\nslug = "demo"\n',
    );
    // No engine, no agent, no manifest — the step removes nothing and does not
    // throw.
    const applied = await applyMigrations({ destDir: dir, from: 4, to: 5 });
    assertEquals(applied.map((m) => m.from), [4]);
    assertEquals(await targetExists(dir, ".icculus/config.toml"), true);
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
    await ctx.writeText("f", "ICCULUS_HOME and ICCULUS_LIB");
    await ctx.rewrite("f", (t) => t.replaceAll("ICCULUS_", "KIT_"));
    assertEquals(await ctx.readText("f"), "KIT_HOME and KIT_LIB");
    // Absent file → no-op (no throw, no creation).
    await ctx.rewrite("ghost", (t) => t.toUpperCase());
    assertEquals(await ctx.exists("ghost"), false);
  });
});

Deno.test("context: editToml edits comment-preserving, no-ops without a config", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    // No .icculus/config.toml yet → no-op.
    await ctx.editToml((e) => e.setString("project.slug", "x"));
    assertEquals(await ctx.exists(".icculus/config.toml"), false);

    await ctx.writeText(
      ".icculus/config.toml",
      '# my config\n[project]\nslug = "demo"\n',
    );
    await ctx.editToml((e) => e.setString("project.branch_prefix", "agent/"));
    const toml = await ctx.readText(".icculus/config.toml");
    assert(toml!.includes('branch_prefix = "agent/"'));
    assert(toml!.includes("# my config"), "comments are preserved");
  });
});

Deno.test("context: mergeSettings deep-merges into .claude/settings.json", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    // Absent → created.
    await ctx.mergeSettings({ model: "opus" });
    let settings = JSON.parse((await ctx.readText(".claude/settings.json"))!);
    assertEquals(settings.model, "opus");
    // Existing → merged, prior keys kept.
    await ctx.mergeSettings({ permissions: { deny: ["Read(./.env)"] } });
    settings = JSON.parse((await ctx.readText(".claude/settings.json"))!);
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
