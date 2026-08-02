/**
 * `discern` inside an operator command resolves to the RUNNING engine, never
 * to whatever the ambient PATH holds (src/shared/self_shim.ts, ADR 0182).
 *
 * The class this guards: an environment with no discern on PATH at all — CI
 * running the engine from source, an MCP server spawned with a stripped
 * environment — must still run a self-invoking job like the seeded
 * `format = "discern tidy"`. The incident: CI's `deno task dev done` died
 * with `format#2 failed (exit 127) — sh: discern: not found`, because the
 * gate job's PATH had no dev wrapper and no binary. The PATH tests below
 * scrub every discern off the base PATH, so they fail on any engine that
 * leans on ambient resolution again.
 *
 * The cache tests guard the population class (ADR 0249): shim dirs are
 * per-identity and reused — an engine that mints one per process regrows an
 * unbounded OS-temp backlog — and stale identities are pruned on churn.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  pruneStaleCachedShims,
  selfShimPath,
} from "../src/shared/self_shim.ts";
import { TEMP_ARTIFACT_TTL_MS } from "../src/shared/temp_artifacts.ts";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** A base PATH with sh and git but certainly no discern. */
const SCRUBBED_BASE = "/usr/bin:/bin";

/**
 * A PATH for a spawned engine process that carries no discern: the scrubbed
 * base plus a directory holding only a `deno` symlink, so the engine itself
 * can be spawned (`runAgent` invokes `deno run …`) without dragging in the
 * developer's bin directory — which is exactly where a dev-wrapper `discern`
 * would live and quietly satisfy the test.
 */
async function denoOnlyPath(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "discern-deno-only-" });
  await Deno.symlink(Deno.execPath(), join(dir, "deno"));
  return `${dir}:${SCRUBBED_BASE}`;
}

Deno.test("self-shim: `discern` runs from a PATH holding no discern", async () => {
  const out = await new Deno.Command("sh", {
    args: ["-c", "discern --version"],
    env: { PATH: await selfShimPath(SCRUBBED_BASE) },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, stderr);
  assertStringIncludes(new TextDecoder().decode(out.stdout), "discern");
});

Deno.test("self-shim: engine processes converge on one cached identity, not one dir each", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'format = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const home = join(dir, "home");
    await Deno.mkdir(home);
    // An empty XDG_CACHE_HOME is not absolute, so the injected HOME decides
    // the cache root and the developer's real cache stays untouched.
    const env = { HOME: home, XDG_CACHE_HOME: "" };
    for (let i = 0; i < 2; i++) {
      const r = await runAgent(dir, ["prepare", "--json"], { env });
      assertEquals(r.code, 0, r.output);
    }
    const shims = join(home, ".cache", "discern", "shims");
    const identities = await Array.fromAsync(Deno.readDir(shims));
    assertEquals(
      identities.map((entry) => entry.isDirectory),
      [true],
      "two engine processes of one engine must share one shim identity",
    );
  });
});

Deno.test("self-shim: a stale cached identity is pruned; a fresh or file-shaped entry survives", async () => {
  await withTempDir(async (root) => {
    const stale = join(root, "stale-identity");
    const fresh = join(root, "fresh-identity");
    for (const dir of [stale, fresh]) {
      await Deno.mkdir(dir);
      await Deno.writeTextFile(join(dir, "discern"), "#!/usr/bin/env sh\n");
    }
    const fileTrap = join(root, "file-trap");
    await Deno.writeTextFile(fileTrap, "not a shim dir\n");
    const then = new Date(Date.now() - TEMP_ARTIFACT_TTL_MS - 60_000);
    await Deno.utime(stale, then, then);
    await Deno.utime(fileTrap, then, then);

    assertEquals(await pruneStaleCachedShims(root), 1);

    const survivors = (await Array.fromAsync(Deno.readDir(root)))
      .map((entry) => entry.name)
      .sort();
    assertEquals(survivors, ["file-trap", "fresh-identity"]);
  });
});

Deno.test("gate: a job invoking `discern` succeeds with no discern on PATH", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'format = "discern --version"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["prepare", "--json"], {
      env: { PATH: await denoOnlyPath() },
    });
    assertEquals(r.code, 0, r.output);
    const envelope = JSON.parse(r.stdout.trim());
    assert(envelope.ok === true, r.output);
  });
});
