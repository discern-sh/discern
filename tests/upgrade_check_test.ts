/**
 * CLI tests for `discern upgrade --check` — the read-only currency primitive.
 * With the managed-file machinery gone there is no file drift to detect: an
 * install is current iff its recorded schema (`[meta].schema_version`) is current.
 * `--check` reports that and exits non-zero when config migrations are pending,
 * writing nothing. Human lines go to stderr, so the machine assertions read
 * `--json` from stdout.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

/** Fresh install in `dir`. */
async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
    0,
  );
}

/** Rewrite `[meta].schema_version` to model an install a migration behind. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  const replaced = text.replace(
    /schema_version\s*=\s*\d+/,
    `schema_version = ${version}`,
  );
  await Deno.writeTextFile(p, replaced);
}

Deno.test("upgrade --check passes on a fresh, in-sync install", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "upgrade");
    assertEquals(res.data.check, true);
    assertEquals(res.data.pending_migrations, []);
    assertEquals(res.data.schema.recorded, res.data.schema.current);
  });
});

Deno.test("upgrade --check writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    // A read-only check must not stamp the schema or otherwise edit the config.
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

Deno.test("upgrade --check flags a stale schema and lists the pending steps", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.data.schema.recorded, 1);
    assertEquals(res.data.schema.current, 8);
    // Every step from 1 up to the current schema is pending.
    assertEquals(
      res.data.pending_migrations.map((m: { from: number }) => m.from),
      [1, 2, 3, 4, 5, 6, 7],
    );
  });
});

Deno.test("upgrade --check (human mode) names the stale schema on stderr", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "schema");
  });
});

Deno.test("upgrade --check heals with the product command, never engine-internal vocabulary", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 1, r.stderr);
    // The hint is always the product command — the retired self-host Deno-task
    // aliases (`deno task selfsync`/`selfcheck`) must never leak into output.
    assertStringIncludes(r.stderr, "discern upgrade");
    assertEquals(r.stderr.includes("deno task"), false, r.stderr);
    assertEquals(r.stderr.includes("selfsync"), false, r.stderr);
  });
});

Deno.test("upgrade --check (human) confirms an up-to-date install and exits zero", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "up to date");
  });
});
