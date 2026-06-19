/**
 * The keystone migration-system invariant (ADR 0014): **upgrade ≡ fresh init**.
 * An install brought forward by `upgrade` must be byte-identical to a freshly
 * initialised install at the same schema version. With this property in place,
 * every future migration is validated by construction — a migration that fails
 * to converge an old install onto the current shape fails this test.
 *
 * Only schema v1 exists today (v1 == the current shape), so these assert the
 * floor: upgrade is a no-op on a current install, idempotent, and orphan removal
 * reconverges an install that drifted. When a migration first bumps the schema
 * version (Phase 1), a frozen pre-migration install is pinned under
 * `tests/fixtures/installs/<n>/` and run through the same `assertConverges`.
 *
 * Installs are created in throwaway dirs (not git repos), so `upgrade`'s
 * clean-tree guard sees a non-repo; `--allow-dirty` keeps the runs deterministic
 * regardless of where the system temp dir lives.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../src/lib/manifest.ts";
import {
  assertConverges,
  readTarget,
  runCli,
  snapshotTree,
  withTempDir,
} from "./helpers.ts";

/**
 * Scaffold a fresh install into `dir`. `--name` is pinned: it otherwise defaults
 * to the directory's basename, which differs between two throwaway temp dirs and
 * would show up (correctly) as seed-file divergence. A real in-place upgrade
 * keeps the same directory, so pinning the name models that faithfully.
 */
async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo", "--name", "Demo"], dir))
      .code,
    0,
  );
}

/** Run `upgrade --allow-dirty --json` and return the parsed report. */
// deno-lint-ignore no-explicit-any
async function upgrade(dir: string): Promise<any> {
  const r = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
  assertEquals(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** The manifest with its run-varying timestamp stripped, for equality checks. */
async function manifestSansTimestamp(dir: string): Promise<unknown> {
  const m = JSON.parse(
    await Deno.readTextFile(join(dir, ".icculus/manifest.json")),
  );
  delete m.generated_at;
  return m;
}

/** Record a pristine managed orphan: a file the templates no longer ship. */
async function recordPristineOrphan(
  dir: string,
  rel: string,
  content: string,
): Promise<void> {
  await Deno.writeTextFile(join(dir, rel), content);
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.managed.push({
    path: rel,
    sha256: await sha256Hex(new TextEncoder().encode(content)),
  });
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("upgrade of a current install changes nothing (no-op)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const res = await upgrade(dir);
    assertEquals(res.refreshed, []);
    assertEquals(res.removed, []);
    assertEquals(res.new_files, []);
  });
});

Deno.test("upgrade ≡ fresh init at the current schema version", async () => {
  await withTempDir(async (a) => {
    await withTempDir(async (b) => {
      await init(a);
      await upgrade(a); // bring the 'existing' install forward
      await init(b); // a freshly initialised install
      assertConverges(await snapshotTree(a), await snapshotTree(b));
      assertEquals(
        await manifestSansTimestamp(a),
        await manifestSansTimestamp(b),
      );
    });
  });
});

Deno.test("orphan removal reconverges a drifted install with a fresh init", async () => {
  await withTempDir(async (a) => {
    await withTempDir(async (b) => {
      await init(a);
      // `a` carries a managed file the templates no longer ship.
      await recordPristineOrphan(a, ".icculus/engine/obsolete", "old\n");
      const res = await upgrade(a);
      assertEquals(res.removed, [".icculus/engine/obsolete"]);

      await init(b);
      // After pruning the orphan, the upgraded install matches a fresh one.
      assertConverges(await snapshotTree(a), await snapshotTree(b));
      assertEquals(
        await manifestSansTimestamp(a),
        await manifestSansTimestamp(b),
      );
    });
  });
});

Deno.test("a second upgrade is a no-op (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await upgrade(dir);
    const before = await snapshotTree(dir);
    const res = await upgrade(dir);
    assertEquals(res.refreshed, []);
    assertEquals(res.removed, []);
    assertConverges(await snapshotTree(dir), before);
  });
});

// ---- the corpus: a real migration carries an old install forward ----------

/** Strip the `main_branch` line(s) from an install's .icculus/config.toml. */
async function removeMainBranch(dir: string): Promise<void> {
  const p = join(dir, ".icculus/config.toml");
  const kept = (await Deno.readTextFile(p))
    .split("\n")
    .filter((l) => !/^\s*main_branch\s*=/.test(l));
  await Deno.writeTextFile(p, kept.join("\n"));
}

/** Overwrite the recorded schema_version (to model an older install). */
async function setManifestSchema(dir: string, version: number): Promise<void> {
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.schema_version = version;
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("a schema-1 install missing main_branch upgrades to converge with a fresh install", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      // Regress a current install to look like one made before main_branch
      // existed: strip the field and reset the recorded schema to 1.
      await init(older);
      await removeMainBranch(older);
      await setManifestSchema(older, 1);

      const res = await upgrade(older); // runs 1→2 … 3→4, then syncs + stamps
      assertEquals(
        res.migrations_applied.map((m: { from: number }) => m.from),
        [1, 2, 3],
      );

      await init(fresh); // a fresh schema-2 install

      // Managed files + schema converge: identical managed hashes in the manifest
      // prove the managed files are byte-identical, and schema_version matches.
      assertEquals(
        await manifestSansTimestamp(older),
        await manifestSansTimestamp(fresh),
      );
      // The migration restored the field. A migrated *seed* converges in shape,
      // not byte-for-byte with the template — the backfill carries no surrounding
      // comment, which is fine (the seed is the user's, not the kit's).
      assertStringIncludes(
        await readTarget(older, ".icculus/config.toml"),
        'main_branch = "main"',
      );
    });
  });
});

/**
 * Reverse the schema-3 consolidation on a fresh install: move the files back to
 * the pre-3 layout (dispatcher under `bin/`, config at the root, guidance and
 * skills under `.ai/`) and rewrite the manifest's managed paths + schema, so it
 * reads as a genuine v2 install. Hashes are unchanged — only the bytes' location
 * moves — so the old copies still read as pristine and orphan-prune will remove
 * them once the new ones are synced in.
 */
async function regressToV2(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, "bin"), { recursive: true });
  await Deno.mkdir(join(dir, ".ai"), { recursive: true });
  await Deno.rename(join(dir, "agent"), join(dir, "bin/agent"));
  await Deno.rename(
    join(dir, ".icculus/config.toml"),
    join(dir, "icculus.toml"),
  );
  await Deno.rename(
    join(dir, ".icculus/guidelines"),
    join(dir, ".ai/guidelines"),
  );
  await Deno.rename(join(dir, ".icculus/skills"), join(dir, ".ai/skills"));
  const sp = join(dir, ".claude/settings.json");
  await Deno.writeTextFile(
    sp,
    (await Deno.readTextFile(sp)).replaceAll("./agent", "./bin/agent"),
  );
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.schema_version = 2;
  m.managed = m.managed.map((e: { path: string; sha256: string }) => ({
    ...e,
    path: e.path === "agent"
      ? "bin/agent"
      : e.path.replace(/^\.icculus\/skills\//, ".ai/skills/"),
  }));
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("a schema-2 old-layout install upgrades to the consolidated layout", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      await init(older); // a fresh schema-3 install (the new layout)
      await regressToV2(older); // reverse it to the pre-consolidation v2 layout

      const res = await upgrade(older); // runs 2→3 then 3→4, syncs + prunes + stamps
      assertEquals(
        res.migrations_applied.map((m: { from: number }) => m.from),
        [2, 3],
      );

      await init(fresh);
      // The managed set + schema converge with a fresh install: the dispatcher
      // and skills were recreated at their new paths and the old pristine copies
      // pruned — proving the migration + file sync carry an old install fully
      // forward, not just the seeds the step renames.
      assertEquals(
        await manifestSansTimestamp(older),
        await manifestSansTimestamp(fresh),
      );
      const snap = await snapshotTree(older);
      assert(snap.has("agent"), "dispatcher recreated at the root");
      assert(snap.has(".icculus/config.toml"), "config in the namespace");
      assert(
        snap.has(".icculus/skills/bootstrap/SKILL.md"),
        "skills recreated in the namespace",
      );
      assert(!snap.has("bin/agent"), "old dispatcher pruned");
      assert(!snap.has("icculus.toml"), "old root config gone");
      assert(
        ![...snap.keys()].some((k) => k.startsWith(".ai/")),
        "no .ai/ files left",
      );
    });
  });
});

/**
 * Reverse the schema-4 capabilities shape on a fresh install: overwrite the seed
 * `.icculus/config.toml` with an equivalent pre-4 `[slots]`/`[scopes]`/`[evidence]`
 * config and reset the recorded schema to 3. Managed files are untouched (the 3→4
 * step transforms only the seed config), so the managed set still matches a fresh
 * install — only the seed shape and the recorded schema differ.
 */
async function regressToV3(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, ".icculus/config.toml"),
    [
      "[project]",
      'slug = "demo"',
      'main_branch = "main"',
      'agents = ["claude_code", "codex"]',
      "",
      "[slots.format]",
      'phase = "fix"',
      'run = "deno fmt"',
      "",
      "[slots.lint]",
      'phase = "check"',
      'run = "deno lint"',
      "",
      "[scopes]",
      'neutral = ["docs/", ".icculus/", ".claude/"]',
      'web = ["src/**"]',
      "",
      "[evidence]",
      "enabled = false",
      "",
    ].join("\n"),
  );
  await setManifestSchema(dir, 3);
}

Deno.test("a schema-3 [slots] install upgrades to the capabilities shape and converges", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      await init(older); // a fresh schema-4 install
      await regressToV3(older); // reverse the seed config to the pre-4 shape

      const res = await upgrade(older); // runs the 3→4 migration, then syncs + stamps
      assertEquals(
        res.migrations_applied.map((m: { from: number }) => m.from),
        [3],
      );

      await init(fresh); // a fresh schema-4 install
      // Managed files + schema converge: the 3→4 step touches only the seed
      // config, so managed bytes are unchanged and the schema matches.
      assertEquals(
        await manifestSansTimestamp(older),
        await manifestSansTimestamp(fresh),
      );
      // The seed converges in shape: capabilities present, the legacy structure gone.
      const toml = await readTarget(older, ".icculus/config.toml");
      assertStringIncludes(toml, "[capabilities]");
      assertStringIncludes(toml, 'format = "deno fmt"');
      assert(!toml.includes("[slots."));
      assert(!toml.includes("[evidence]"));
    });
  });
});
