/**
 * Engine coverage for the public recipes the suite never exercised directly:
 *   - `prepare` / `test` — the fast-loop and test-stage entry points (previously
 *     reached only transitively through `finish`).
 *   - `doctor`'s failure path — the smoke test only covered the happy path.
 * Each shells out through the real dispatcher.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

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
