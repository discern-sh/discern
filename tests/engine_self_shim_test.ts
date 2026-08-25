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
 * The identity test guards the population class (ADR 0249): shim dirs live
 * under the repository's Git admin state, one per engine identity, reused by
 * every process — an engine that mints one OS-temp dir per process regrows
 * an unbounded backlog the reaper cannot drain.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { selfShimPath } from "../src/shared/self_shim.ts";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  suiteTempDir,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

/** A base PATH with sh and git but certainly no discern. */
const SCRUBBED_BASE = "/usr/bin:/bin";

/**
 * A PATH for a spawned engine process that carries no discern: the scrubbed
 * base plus a directory holding only a `deno` symlink, so the engine itself
 * can be spawned (`runAgent` invokes `deno run …`) without dragging in the
 * developer's bin directory — which is exactly where a dev-wrapper `discern`
 * would live and quietly satisfy the test.
 */
async function withDenoOnlyPath<T>(
  fn: (path: string) => T | Promise<T>,
): Promise<T> {
  return await withTempDir(async (dir) => {
    await Deno.symlink(Deno.execPath(), join(dir, "deno"));
    return await fn(`${dir}:${SCRUBBED_BASE}`);
  }, {
    parent: await suiteTempDir(),
    prefix: "deno-only-",
  });
}

Deno.test("self-shim: `discern` runs from a PATH holding no discern", async () => {
  const out = await new Deno.Command("sh", {
    args: ["-c", "discern --version"],
    env: { PATH: await selfShimPath(undefined, SCRUBBED_BASE) },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, stderr);
  assertStringIncludes(new TextDecoder().decode(out.stdout), "discern");
});

Deno.test("self-shim: engine processes converge on one git-admin identity, not one temp dir each", async () => {
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
    for (let i = 0; i < 2; i++) {
      const r = await runAgent(dir, ["prepare", "--json"]);
      assertEquals(r.code, 0, r.output);
    }
    const home = join(dir, ".git", "discern", "shim");
    const identities = await Array.fromAsync(Deno.readDir(home));
    assertEquals(
      identities.map((entry) => entry.isDirectory),
      [true],
      "two processes of one engine must share one shim identity under .git",
    );
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
    const r = await withDenoOnlyPath((path) =>
      runAgent(dir, ["prepare", "--json"], {
        env: { PATH: path },
      })
    );
    assertEquals(r.code, 0, r.output);
    const envelope = decodeCliResult(r.stdout, "prepare");
    assert(envelope.ok === true, r.output);
  });
});
