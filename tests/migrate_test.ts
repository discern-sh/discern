/**
 * CLI tests for `icculus migrate` (ADR 0014). It is now the read-only migration
 * *status* surface: it reports the install's recorded schema and any pending
 * chain steps, and points at `upgrade` to apply them — it never writes. The
 * bespoke 0.x→1.0 transform it once performed is retired (the chain starts clean
 * at schema 1), so a current install always reports "up to date".
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runMigrate } from "../src/commands/migrate.ts";
import type { Migration } from "../src/lib/migrations.ts";
import { runCli, withTempDir } from "./helpers.ts";

async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
    0,
  );
}

async function setSchema(dir: string, version: number): Promise<void> {
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.schema_version = version;
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

/** Run `runMigrate` in-process against `dir` (resolves from Deno.cwd()). */
async function migrateIn(
  dir: string,
  registry: Migration[],
  check: boolean,
): Promise<number> {
  const cwd = Deno.cwd();
  try {
    Deno.chdir(dir);
    return await runMigrate({ json: true, noColor: true, check, registry });
  } finally {
    Deno.chdir(cwd);
  }
}

Deno.test("migrate reports up to date on a current install (empty chain)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.pending_migrations, []);
    assertEquals(res.schema.recorded, res.schema.current);
  });
});

Deno.test("migrate --check exits 0 when nothing is pending", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    assertEquals((await runCli(["migrate", "--check"], dir)).code, 0);
  });
});

Deno.test("migrate errors cleanly when not initialized", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 1);
    assertEquals(JSON.parse(r.stdout).error, "not_initialized");
  });
});

Deno.test("migrate --check signals pending steps; bare migrate does not", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 0); // one schema behind
    const chain: Migration[] = [{
      from: 0,
      describe: "a pending step",
      apply: () => Promise.resolve(),
    }];
    // --check turns "pending" into a non-zero exit (a scripting signal)...
    assertEquals(await migrateIn(dir, chain, true), 1);
    // ...while a bare report exits 0 (migrate never writes — `upgrade` applies).
    assertEquals(await migrateIn(dir, chain, false), 0);
  });
});
