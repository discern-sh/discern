/**
 * Engine tests for structured `agent finish --json` output (ADR 0004).
 *
 * In --json mode finish emits a single JSON object on stdout (human output goes
 * to stderr): per-phase results (the execution unit — slots run joined within a
 * phase), per-side-gate results (fired = ok/failed, configured-but-unchanged =
 * skipped), the scopes that changed, and the failed stage. These tests parse the
 * stdout and assert the shape.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

Deno.test("finish --json: no-op gate emits ok:true with all phases noop", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assertEquals(obj.failed_stage, null);
    assertEquals(obj.phases.length, 4);
    for (const p of obj.phases) {
      assertEquals(p.status, "noop", `phase ${p.name} should be noop`);
    }
    assert(Array.isArray(obj.side_gates));
    assert(Array.isArray(obj.scopes_changed));
  });
});

Deno.test("finish --json: a failing check reports ok:false and the failed stage", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]',
        "",
        "[slots.lint]",
        'phase = "check"',
        'run = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.failed_stage, "check/test");
    const check = obj.phases.find((p: { name: string }) => p.name === "check");
    assertEquals(check.status, "failed");
  });
});

Deno.test("finish --json: side-gates report fired (ok) and unchanged (skipped)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]',
        'widget = ["widget/**"]',
        'gadget = ["gadget/**"]',
        "",
        "[scopes.side_gates]",
        'widget = "echo widget-ok"',
        'gadget = "echo gadget-ok"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x"); // only widget changed

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    const widget = obj.side_gates.find((g: { scope: string }) =>
      g.scope === "widget"
    );
    const gadget = obj.side_gates.find((g: { scope: string }) =>
      g.scope === "gadget"
    );
    assertEquals(widget.status, "ok"); // fired and passed
    assertEquals(gadget.status, "skipped"); // configured, scope unchanged
    assert(obj.scopes_changed.includes("widget"));
  });
});

Deno.test("finish --json: a failing side-gate reports ok:false at the side_gates stage", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]',
        'widget = ["widget/**"]',
        "",
        "[scopes.side_gates]",
        'widget = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.failed_stage, "side_gates");
    const widget = obj.side_gates.find((g: { scope: string }) =>
      g.scope === "widget"
    );
    assertEquals(widget.status, "failed");
  });
});

Deno.test("finish --json: human mode is unaffected (stdout still human, not JSON)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["finish"]); // no --json
    assertEquals(r.code, 0, r.output);
    // Human stdout, not JSON.
    let parsed = true;
    try {
      JSON.parse(r.stdout.trim());
    } catch {
      parsed = false;
    }
    assert(!parsed, "human-mode stdout should not be a JSON object");
  });
});
