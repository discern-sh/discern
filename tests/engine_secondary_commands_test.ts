/**
 * Engine coverage for public commands the suite never exercised directly:
 *   - `prepare` / `test` — the fast-loop and test-stage entry points (previously
 *     reached only transitively through `done`).
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

Deno.test("prepare --json: a failing check carries steps[] + diagnostics[] as the ENTIRE output (nothing leaks to stderr)", async () => {
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
    // prepare now runs through the job runner, so a failure carries the same
    // structured shape `done` does: a steps[] entry plus a Tier-0 diagnostic with
    // the tool, the command to reproduce it, and its captured output — the agent's
    // act→read→fix loop, not a bare ok:false.
    assert(Array.isArray(obj.steps) && obj.steps.length > 0, r.stdout);
    const diag = obj.diagnostics?.find((d: { tool: string }) =>
      d.tool === "lint"
    );
    assert(diag !== undefined, `expected a lint diagnostic; got: ${r.stdout}`);
    assertEquals(diag.reproduce_cmd, "echo boom-on-stderr >&2; exit 1");
    assertStringIncludes(diag.output, "boom-on-stderr");
    // --json is still quiet (ADR 0030): the failing command's output is captured
    // INTO the diagnostic, never rerouted to stderr — so an agent capturing combined
    // streams sees only the envelope on stdout and nothing on stderr.
    assert(
      !r.stderr.includes("boom-on-stderr"),
      `--json must not leak command output to stderr; got: ${r.stderr}`,
    );
  });
});

Deno.test("test --json: a failing test carries steps[] + diagnostics[] (and nothing leaks to stderr)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'test = "echo boom-in-tests >&2; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["test", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = pureJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "test");
    // `discern test` runs through the same job runner as the gate, so a failing test
    // command yields a step plus a Tier-0 diagnostic — not a bare ok:false.
    assert(Array.isArray(obj.steps) && obj.steps.length > 0, r.stdout);
    const diag = obj.diagnostics?.find((d: { tool: string }) =>
      d.tool === "test"
    );
    assert(diag !== undefined, `expected a test diagnostic; got: ${r.stdout}`);
    assertStringIncludes(diag.output, "boom-in-tests");
    assert(
      !r.stderr.includes("boom-in-tests"),
      `--json must not leak command output to stderr; got: ${r.stderr}`,
    );
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
