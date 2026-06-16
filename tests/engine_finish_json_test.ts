/**
 * Engine tests for structured `agent finish --json` output (ADR 0004).
 *
 * In --json mode finish emits a single JSON object on stdout (human output goes
 * to stderr): per-SLOT results (the execution unit — each [slots.<name>] runs as
 * its own job, reported as {name, phase, status, duration_s}), per-side-gate
 * results (fired = ok/failed, configured-but-unchanged = skipped), the scopes
 * that changed, and the failed stage. These tests parse the stdout and assert
 * the shape.
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

Deno.test("finish --json: no-op gate emits ok:true with every slot noop", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assertEquals(obj.failed_stage, null);
    // The default install ships several slots, all no-ops.
    assert(
      obj.slots.length >= 4,
      `expected the default slots, got ${obj.slots.length}`,
    );
    for (const s of obj.slots) {
      assertEquals(s.status, "noop", `slot ${s.name} should be noop`);
      assert(typeof s.phase === "string" && s.phase.length > 0);
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
    // The failure is attributed to the precise slot, not a whole phase.
    const lint = obj.slots.find((s: { name: string }) => s.name === "lint");
    assertEquals(lint.status, "failed");
    assertEquals(lint.phase, "check");
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
