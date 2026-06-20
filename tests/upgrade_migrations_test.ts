/**
 * The migration fold (ADR 0014): `upgrade` runs pending chain migrations before
 * the file sync, rebuilds the plan if a step moved files, then stamps the new
 * schema. The production chain is empty at schema 1, so the CLI path is a
 * migration no-op (asserted here). An injected synthetic chain drives the fold
 * end-to-end in-process — exercising the run → rebuild → stamp that Phase 2's
 * rename will rely on, without a real SCHEMA_VERSION bump.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runUpgrade } from "../src/commands/upgrade.ts";
import type { Migration } from "../src/lib/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { readTarget, runCli, targetExists, withTempDir } from "./helpers.ts";

async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo", "--name", "Demo"], dir))
      .code,
    0,
  );
}

/** Overwrite the install's recorded `[meta].schema_version` (to model one behind). */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, ".icculus/config.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
}

/** The recorded `[meta].schema_version` of an install's config. */
async function recordedSchema(dir: string): Promise<number> {
  const m = (await readTarget(dir, ".icculus/config.toml")).match(
    /schema_version\s*=\s*(\d+)/,
  );
  return m ? Number(m[1]) : NaN;
}

/**
 * Run `runUpgrade` in-process against `dir`. It resolves the project from
 * `Deno.cwd()`, so we chdir for the call and restore after (the test suite runs
 * sequentially, so the global cwd is safe to borrow). `json` keeps output to one
 * line; `--allow-dirty` skips the clean-tree guard for the throwaway install.
 */
async function upgradeIn(dir: string, registry?: Migration[]): Promise<number> {
  const cwd = Deno.cwd();
  try {
    Deno.chdir(dir);
    return await runUpgrade({
      json: true,
      noColor: true,
      dryRun: false,
      check: false,
      allowDirty: true,
      registry,
    });
  } finally {
    Deno.chdir(cwd);
  }
}

Deno.test("a current install has nothing pending and applies no migrations", async () => {
  await withTempDir(async (dir) => {
    await init(dir); // a fresh install is stamped at the current schema
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).migrations_applied, []);
    const c = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(JSON.parse(c.stdout).pending_migrations, []);
  });
});

Deno.test("upgrade runs a pending migration before the sync, then stamps the schema", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, SCHEMA_VERSION - 1); // model an install one schema behind (build is at 2)

    const ran: string[] = [];
    // A synthetic 1→2 step (overrides the production chain via the registry seam).
    const chain: Migration[] = [{
      from: SCHEMA_VERSION - 1,
      describe: "write a marker and set a config key",
      apply: async (ctx) => {
        ran.push("applied");
        await ctx.writeText("MIGRATED", "yes\n");
        await ctx.editToml((e) => e.setString("project.branch_prefix", "wt/"));
      },
    }];

    assertEquals(await upgradeIn(dir, chain), 0);
    assertEquals(ran, ["applied"]); // the step ran exactly once
    // Its effects landed: the marker file and the config edit.
    assertEquals(await targetExists(dir, "MIGRATED"), true);
    assert(
      (await readTarget(dir, ".icculus/config.toml")).includes(
        'branch_prefix = "wt/"',
      ),
    );
    // And the config was stamped to the current schema.
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
  });
});

Deno.test("upgrade re-running an applied migration is a no-op (idempotent fold)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, SCHEMA_VERSION - 1);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION - 1,
      describe: "create a marker",
      apply: (ctx) => ctx.writeText("MIGRATED", "yes\n"),
    }];
    assertEquals(await upgradeIn(dir, chain), 0); // schema 1 → 2, runs
    // Now at the current schema: re-running finds nothing pending, still succeeds.
    assertEquals(await upgradeIn(dir, chain), 0);
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
  });
});
