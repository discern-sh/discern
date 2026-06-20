/**
 * The migration-system invariant (ADR 0014), narrowed to what survives the
 * managed-file teardown: an install brought forward by `upgrade` must reach the
 * **current schema**, with its config migrated into the **same shape** a fresh
 * init produces at that schema. (Byte-for-byte convergence is gone — there are no
 * managed files to converge, and a migrated *seed* carries no surrounding
 * comments, which is fine: the seed is the user's, not the kit's.)
 *
 * Installs are created in throwaway dirs (not git repos), so `upgrade`'s
 * clean-tree guard sees a non-repo; `--allow-dirty` keeps the runs deterministic.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { readTarget, runCli, withTempDir } from "./helpers.ts";

/**
 * Scaffold a fresh install into `dir`. `--name` is pinned for parity with a
 * real in-place upgrade (which keeps the same directory).
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

/** The recorded `[meta].schema_version` of an install's config. */
async function recordedSchema(dir: string): Promise<number> {
  const m = (await readTarget(dir, ".icculus/config.toml")).match(
    /schema_version\s*=\s*(\d+)/,
  );
  return m ? Number(m[1]) : NaN;
}

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, ".icculus/config.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
}

Deno.test("upgrade of a current install applies no migrations and stays at the current schema", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const fresh = await recordedSchema(dir);
    const res = await upgrade(dir);
    assertEquals(res.migrations_applied, []);
    assertEquals(res.schema.current, fresh);
    assertEquals(await recordedSchema(dir), fresh);
  });
});

Deno.test("a second upgrade is a no-op (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await upgrade(dir);
    const res = await upgrade(dir);
    assertEquals(res.migrations_applied, []);
  });
});

Deno.test("upgrade re-materializes the bundled skills and stamps the current schema", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Drop and tamper with a materialized skill: upgrade must restore it.
    const skill = join(dir, ".icculus/skills/bootstrap/SKILL.md");
    await Deno.writeTextFile(skill, "tampered\n");
    const res = await upgrade(dir);
    assert(
      res.skills_materialized.includes(".icculus/skills/bootstrap/SKILL.md"),
      "the bundled skill should be re-materialized",
    );
    assert(
      !(await readTarget(dir, ".icculus/skills/bootstrap/SKILL.md")).includes(
        "tampered",
      ),
      "the kit's skill bytes should overwrite the tampered copy",
    );
    assertEquals(await recordedSchema(dir), res.schema.current);
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

Deno.test("a schema-1 install missing main_branch upgrades to the current schema and restores the field", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      // Regress a current install to look like a schema-1 one made before
      // main_branch existed: strip the field and reset the recorded schema.
      await init(older);
      await removeMainBranch(older);
      await setSchema(older, 1);

      const res = await upgrade(older); // runs 1→2 … 4→5, materializes, stamps
      assertEquals(
        res.migrations_applied.map((m: { from: number }) => m.from),
        [1, 2, 3, 4],
      );

      await init(fresh); // a fresh install at the current schema

      // The migrated install reaches the same schema as a fresh one…
      assertEquals(await recordedSchema(older), await recordedSchema(fresh));
      // …and the 1→2 step restored the backfilled field.
      assertStringIncludes(
        await readTarget(older, ".icculus/config.toml"),
        'main_branch = "main"',
      );
    });
  });
});

/**
 * Reverse the schema-4 capabilities shape on a fresh install: overwrite the seed
 * `.icculus/config.toml` with an equivalent pre-4 `[slots]`/`[scopes]`/`[evidence]`
 * config and reset the recorded schema to 3. The 3→4 step transforms only the
 * seed config; the later prune step finds nothing to remove on this fresh tree.
 */
async function regressToV3(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, ".icculus/config.toml"),
    [
      "[meta]",
      "schema_version = 3",
      "",
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
}

Deno.test("a schema-3 [slots] install upgrades to the capabilities shape and the current schema", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      await init(older); // a fresh install at the current schema
      await regressToV3(older); // reverse the seed config to the pre-4 shape

      const res = await upgrade(older); // runs 3→4 then 4→5, materializes, stamps
      assertEquals(
        res.migrations_applied.map((m: { from: number }) => m.from),
        [3, 4],
      );

      await init(fresh);
      // The migrated install reaches the same schema as a fresh one.
      assertEquals(await recordedSchema(older), await recordedSchema(fresh));
      // The seed converges in shape: capabilities present, the legacy structure gone.
      const toml = await readTarget(older, ".icculus/config.toml");
      assertStringIncludes(toml, "[capabilities]");
      assertStringIncludes(toml, 'format = "deno fmt"');
      assert(!toml.includes("[slots."));
      assert(!toml.includes("[evidence]"));
    });
  });
});

Deno.test("a legacy install whose schema lives only in a manifest upgrades and prunes the shell engine", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Model a genuine pre-teardown install: schema recorded ONLY in a legacy
    // manifest (no [meta] in the config), plus a committed shell engine + agent.
    const p = join(dir, ".icculus/config.toml");
    const stripped = (await Deno.readTextFile(p))
      .split("\n")
      .filter((l) => !/^\s*schema_version\s*=/.test(l) && l.trim() !== "[meta]")
      .join("\n");
    await Deno.writeTextFile(p, stripped);
    await Deno.writeTextFile(
      join(dir, ".icculus/manifest.json"),
      '{ "kit_version": "1.0.0", "schema_version": 4 }\n',
    );
    await Deno.mkdir(join(dir, ".icculus/engine"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".icculus/engine/finish"),
      "#!/bin/sh\n",
    );
    await Deno.writeTextFile(join(dir, "agent"), "#!/bin/sh\n");

    const res = await upgrade(dir);
    // The legacy manifest anchored the chain at schema 4 → only 4→5 runs.
    assertEquals(
      res.migrations_applied.map((m: { from: number }) => m.from),
      [4],
    );
    // The prune step shed the shell engine, the dispatcher, and the manifest…
    assertEquals(await runCliExists(dir, ".icculus/engine"), false);
    assertEquals(await runCliExists(dir, "agent"), false);
    assertEquals(await runCliExists(dir, ".icculus/manifest.json"), false);
    // …and the schema is now stamped in the config the user owns.
    assertEquals(await recordedSchema(dir), res.schema.current);
  });
});

/** True when a path exists under an install dir. */
async function runCliExists(dir: string, rel: string): Promise<boolean> {
  try {
    await Deno.stat(join(dir, rel));
    return true;
  } catch {
    return false;
  }
}
