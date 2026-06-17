/**
 * Engine coverage for the public recipes the suite never exercised directly:
 *   - `evidence` — the optional per-branch work-evidence gate (zero coverage).
 *   - `tidy` / `test` — the fast-loop and test-phase entry points (previously
 *     reached only transitively through `finish`).
 *   - `doctor`'s failure path — the smoke test only covered the happy path.
 * Each shells out through the real dispatcher.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

// --- evidence -------------------------------------------------------------

Deno.test("evidence: check is a no-op when the gate is disabled (the default)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["evidence", "check"]);
    assertEquals(r.code, 0, r.output);
  });
});

Deno.test("evidence: an enabled gate fails with no evidence, then passes after capture", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "evidence-test"',
        "[evidence]",
        "enabled = true",
        "",
      ]
        .join("\n"),
    );
    await gitInit(dir);

    // Enabled + no evidence yet → the gate fails and explains how to satisfy it.
    const missing = await runAgent(dir, ["evidence", "check"]);
    assertEquals(missing.code, 1, missing.output);
    assertStringIncludes(missing.output, "No work evidence recorded");

    // Capture writes a marker under the gitignored runtime store.
    const cap = await runAgent(dir, ["evidence", "capture", "ran the thing"]);
    assertEquals(cap.code, 0, cap.output);
    assert(
      await exists(join(dir, ".icculus/evidence")),
      `evidence store not created\n${cap.output}`,
    );

    // Fresh evidence now satisfies the gate.
    const ok = await runAgent(dir, ["evidence", "check"]);
    assertEquals(ok.code, 0, ok.output);
  });
});

// --- tidy / test (entry points, not only transitively via finish) ---------

Deno.test("tidy: the fast inner loop passes on a fresh no-op scaffold", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["tidy"]);
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

Deno.test("doctor: fails and names a slot whose command does not resolve", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A check-phase slot pointing at a binary that is not installed.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "doctor-test"',
        "[slots.check]",
        'phase = "check"',
        'run = "totally-not-a-real-binary-zzz --flag"',
        "",
      ].join("\n"),
    );
    const r = await runAgent(dir, ["doctor"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "totally-not-a-real-binary-zzz");
  });
});
