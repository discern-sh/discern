/**
 * CLI tests for `discern migrate` (ADR 0014). It is now the read-only migration
 * *status* surface: it reports the install's recorded schema and any pending
 * chain steps, and points at `upgrade` to apply them — it never writes. The
 * bespoke 0.x→1.0 transform it once performed is retired (the chain starts clean
 * at schema 1), so a current install always reports "up to date".
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
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
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
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

Deno.test("migrate reports up to date on a current install", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["migrate", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "migrate");
    assertEquals(res.data.pending_migrations, []);
    assertEquals(res.data.schema.recorded, res.data.schema.current);
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
    await setSchema(dir, 1); // behind the build (schema 6) → the synthetic step is pending
    const chain: Migration[] = [{
      from: 1,
      describe: "a pending step",
      apply: () => Promise.resolve(),
    }];
    // --check turns "pending" into a non-zero exit (a scripting signal)...
    assertEquals(await migrateIn(dir, chain, true), 1);
    // ...while a bare report exits 0 (migrate never writes — `upgrade` applies).
    assertEquals(await migrateIn(dir, chain, false), 0);
  });
});

// ---- human (non-JSON) output paths ----------------------------------------

Deno.test("migrate human output reports up to date on a current install", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["migrate"], dir);
    assertEquals(r.code, 0, r.stderr);
    // The "✓ up to date" line goes to stderr (Logger.ok); JSON is absent.
    assertStringIncludes(r.stderr, "Up to date");
    assertStringIncludes(r.stderr, "schema");
    assertEquals(r.stdout, "");
  });
});

Deno.test("migrate human output errors cleanly when not initialized", async () => {
  await withTempDir(async (dir) => {
    // No `init` → no discern.toml; the non-JSON branch logs the error to stderr.
    const r = await runCli(["migrate"], dir);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "no discern install here");
    assertStringIncludes(r.stderr, "discern setup");
  });
});

Deno.test("migrate human output lists pending steps and points at upgrade", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Rewind the recorded schema so the real 1→2 step shows as pending. This
    // drives the production chain (no synthetic registry) through the CLI, so
    // the human-readable pending-output branch is exercised end to end.
    await setSchema(dir, 1);
    const r = await runCli(["migrate"], dir);
    // A bare report never fails, even with steps pending (upgrade applies).
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "migration(s) pending");
    assertStringIncludes(r.stderr, "schema 1");
    // The per-step detail line carries the step's `from→to` and description.
    assertStringIncludes(r.stderr, "1→2");
    assertStringIncludes(r.stderr, "main_branch");
    // And it points the user at the apply command.
    assertStringIncludes(r.stderr, "Apply them");
  });
});

Deno.test("migrate --check exits non-zero on a rewound schema (real chain)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1); // one behind → the 1→2 step is pending
    // --check over the production chain via the CLI: pending → non-zero exit.
    assertEquals((await runCli(["migrate", "--check"], dir)).code, 1);
  });
});

Deno.test("migrate --json lists the pending step from a rewound schema", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1);
    const r = await runCli(["migrate", "--json"], dir);
    // --check is absent, so even with a pending step the bare report exits 0.
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.data.schema.recorded, 1);
    assertEquals(res.data.schema.current, 9);
    assertEquals(res.data.pending_migrations.length, 8);
    assertEquals(res.data.pending_migrations[0].from, 1);
    assertEquals(res.data.pending_migrations[0].to, 2);
    assertStringIncludes(
      res.data.pending_migrations[0].describe,
      "main_branch",
    );
  });
});
