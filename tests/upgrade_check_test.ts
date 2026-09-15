/**
 * CLI tests for `discern upgrade --check` — the read-only currency primitive.
 * `--check` reports schema and scaffold currency without writing. The first
 * public baseline has no pending production migrations; synthetic in-process
 * tests exercise that branch until the first public migration exists.
 *
 * Guards: boundary:explicit-upgrades
 */

import { inspectReleaseCheck } from "../src/shared/release_check.ts";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  DISCERN_VERSION,
  SCHEMA_VERSION,
  UPDATE_CHANNEL,
} from "../src/lib/version.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { git, gitInit } from "./engine_helpers.ts";

/** Fresh install in `dir`. */
async function setup(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# Upgrade fixture\n");
  await gitInit(dir);
  assertEquals(
    (await runCli(
      ["setup", "begin", "--confirmed", "--slug", "demo"],
      dir,
    ))
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

Deno.test("upgrade --check reports pending adoption on a byte-current unfinished setup", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = decodeCliResult(r.stdout, "upgrade");
    assertResultDataKey(res, "check");
    assert(res.data.schema !== undefined);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "upgrade");
    assertEquals(res.data.check, true);
    assertEquals((await inspectReleaseCheck(dir)).status, "missing");
    assertEquals(res.data.pending_migrations, []);
    assertEquals(res.data.managed_version, {
      previous: null,
      adopted: DISCERN_VERSION,
    });
    assertEquals(res.data.schema.recorded, res.data.schema.current);
  });
});

Deno.test("upgrade --check writes nothing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const before = await Deno.readTextFile(join(dir, "discern.toml"));
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      before,
    );
  });
});

Deno.test("upgrade detects and reconciles a stale generated-merge block", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '\n[generated.bundle]\npaths = ["generated/**"]\nrun = "sh -c true"\n',
      { append: true },
    );
    const refresh = await runCli(["refresh", "--json"], dir);
    assertEquals(refresh.code, 0, `${refresh.stdout}${refresh.stderr}`);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "declare generated bundle");
    const attributesPath = join(dir, ".gitattributes");
    const current = await Deno.readTextFile(attributesPath);
    await Deno.writeTextFile(
      attributesPath,
      current.replace("generated/**", "stale/**"),
    );

    const check = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(check.code, 1, check.stderr);
    const pending = decodeCliResult(check.stdout, "upgrade");
    assertResultDataKey(pending, "pending_gitattributes_reconciliation");
    assertEquals(pending.ok, false);
    assertEquals(
      pending.data.pending_gitattributes_reconciliation,
      [{ kind: "replace-block", path: ".gitattributes" }],
    );

    const upgrade = await runCli(["upgrade", "--allow-dirty"], dir);
    assertEquals(upgrade.code, 0, upgrade.stderr);
    const releaseClock = await inspectReleaseCheck(dir);
    assert(releaseClock.status === "recorded");
    assertEquals(releaseClock.value.last_handoff_at, undefined);
    assertTerminalTextIncludes(
      upgrade.stderr,
      "managed gitattributes fragment reconciled",
    );
    assertTerminalTextIncludes(
      upgrade.stderr,
      "effective generated-path protection is verified separately by discern doctor",
    );
    assertStringIncludes(
      await Deno.readTextFile(attributesPath),
      "generated/** merge=discern-generated",
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
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, false);
    assertEquals(res.error, "schema_version_too_new");
    assert(res.message !== undefined);
    assertStringIncludes(res.message, "this project needs a newer discern");
    assertStringIncludes(res.message, "re-run the installer");
    assertEquals(await Deno.readTextFile(join(dir, "discern.toml")), before);
  });
});

Deno.test("upgrade --check (human) confirms an up-to-date install and exits zero", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    assertEquals((await runCli(["upgrade", "--allow-dirty"], dir)).code, 0);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertTerminalTextIncludes(r.stderr, "up to date");
  });
});

Deno.test("upgrade --check on a current install tells the truth: version, channel, no network", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    assertEquals((await runCli(["upgrade", "--allow-dirty"], dir)).code, 0);

    // Human surface: the installed version and the one real update channel —
    // never an implied network poll (discern makes no network requests).
    const human = await runCli(["upgrade", "--check"], dir);
    assertEquals(human.code, 0, human.stderr);
    assertTerminalTextIncludes(human.stderr, `discern ${DISCERN_VERSION}`);
    assertTerminalTextIncludes(human.stderr, `schema ${SCHEMA_VERSION}`);
    assertTerminalTextIncludes(human.stderr, UPDATE_CHANNEL);
    assertTerminalTextIncludes(human.stderr, "never checks the network");

    // JSON surface: the same facts ride the envelope.
    const json = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(json.code, 0, json.stderr);
    const res = decodeCliResult(json.stdout, "upgrade");
    assertResultDataKey(res, "discern_version");
    assertEquals(res.data.discern_version, DISCERN_VERSION);
    const expected = assertHasHint(res, HINTS["upgrade-newer-discern"], {
      updateChannel: UPDATE_CHANNEL,
    });
    assertTerminalTextIncludes(human.stderr, expected);
  });
});
