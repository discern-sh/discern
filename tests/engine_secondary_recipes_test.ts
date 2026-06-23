/**
 * Engine coverage for the public recipes the suite never exercised directly:
 *   - `prepare` / `test` — the fast-loop and test-stage entry points (previously
 *     reached only transitively through `finish`).
 *   - `doctor`'s failure path — the smoke test only covered the happy path.
 * Each shells out through the real dispatcher.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** Parse stdout as a single JSON object — throws (failing the test) if it's
 * polluted with human text, which is the regression these `--json` tests guard. */
// deno-lint-ignore no-explicit-any
function pureJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

// --- prepare / test (entry points, not only transitively via finish) ------

Deno.test("prepare: the fast inner loop passes on a fresh no-op scaffold", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["prepare"]);
    assertEquals(r.code, 0, r.output);
  });
});

Deno.test("test: the test phase passes on a fresh no-op scaffold", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["test"]);
    assertEquals(r.code, 0, r.output);
  });
});

Deno.test("prepare/test/refresh --json: stdout is a pure DiscernResult, never human text", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // prepare --json on a clean scaffold → ok envelope, stdout NOT polluted by the
    // "Fixing code…"/"Checking…" headings (which would break JSON.parse).
    const prep = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prep.code, 0, prep.output);
    const prepObj = pureJson(prep.stdout);
    assertEquals(prepObj.ok, true);
    assertEquals(prepObj.verb, "prepare");

    const test = await runAgent(dir, ["test", "--json"]);
    assertEquals(test.code, 0, test.output);
    assertEquals(pureJson(test.stdout).verb, "test");

    const refresh = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refresh.code, 0, refresh.output);
    const refreshObj = pureJson(refresh.stdout);
    assertEquals(refreshObj.ok, true);
    assertEquals(refreshObj.verb, "refresh");
    assert(Array.isArray(refreshObj.data.agents_written), refresh.stdout);
  });
});

Deno.test("prepare --json: a failing check reports ok:false on stdout, error text on stderr", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'lint = "echo boom-on-stderr >&2; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = pureJson(r.stdout); // stdout is STILL pure JSON on failure
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "prepare");
    // The command's own output went to stderr, off the JSON channel.
    assertStringIncludes(r.stderr, "boom-on-stderr");
  });
});

// --- doctor failure path --------------------------------------------------

Deno.test("doctor: fails and names a capability whose command does not resolve", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A capability pointing at a binary that is not installed.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "doctor-test"',
        "[capabilities]",
        'lint = "totally-not-a-real-binary-zzz --flag"',
        "",
      ].join("\n"),
    );
    const r = await runAgent(dir, ["doctor"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "totally-not-a-real-binary-zzz");
  });
});
