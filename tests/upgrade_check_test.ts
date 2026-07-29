/**
 * CLI tests for `discern upgrade --check` — the read-only currency primitive.
 * `--check` reports schema and scaffold currency without writing. The first
 * public baseline has no pending production migrations; synthetic in-process
 * tests exercise that branch until the first public migration exists.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  KIT_VERSION,
  SCHEMA_VERSION,
  UPDATE_CHANNEL,
} from "../src/lib/version.ts";
import { HINTS } from "../src/shared/hints.ts";
import { runCli, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** Fresh install in `dir`. */
async function setup(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["setup", "--confirmed", "--yes", "--slug", "demo"], dir))
      .code,
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
    await setup(dir);
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
    await setup(dir);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

Deno.test("upgrade --check refuses a config from a newer schema", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION + 1);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));

    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "schema_version_too_new");
    assertStringIncludes(res.message, "this project needs a newer discern");
    assertStringIncludes(res.message, "re-run the installer");
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), before);
  });
});

Deno.test("upgrade --check (human) confirms an up-to-date install and exits zero", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "up to date");
  });
});

Deno.test("upgrade --check on a current install tells the truth: version, channel, no network", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);

    // Human surface: the installed version and the one real update channel —
    // never an implied network poll (discern makes no network requests).
    const human = await runCli(["upgrade", "--check"], dir);
    assertEquals(human.code, 0, human.stderr);
    assertStringIncludes(human.stderr, `discern ${KIT_VERSION}`);
    assertStringIncludes(human.stderr, `schema ${SCHEMA_VERSION}`);
    assertStringIncludes(human.stderr, UPDATE_CHANNEL);
    assertStringIncludes(human.stderr, "never checks the network");

    // JSON surface: the same facts ride the envelope.
    const json = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(json.code, 0, json.stderr);
    const res = JSON.parse(json.stdout);
    assertEquals(res.data.kit_version, KIT_VERSION);
    const expected = assertHasHint(res, HINTS["upgrade-newer-discern"], {
      updateChannel: UPDATE_CHANNEL,
    });
    assertStringIncludes(human.stderr, expected);
  });
});
