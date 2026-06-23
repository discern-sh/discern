/**
 * Engine tests for the structured `finish --json` result — the DiscernResult
 * envelope (ADR 0028).
 *
 * In --json mode finish emits a single JSON object on stdout (human output goes
 * to stderr): the uniform `{ok, verb, steps, diagnostics?, data}` shell every
 * verb returns. Each capability/check/scope-gate is a `steps[]` entry; a GENUINE
 * failure also yields a `diagnostics[]` entry carrying the command to reproduce it
 * and its captured output — the structured "why" an agent fixes from. The gate's
 * own `failed_stage` / `scopes_changed` ride in the verb-specific `data`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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

// deno-lint-ignore no-explicit-any
const stepFor = (obj: any, label: string) =>
  obj.steps.find((s: { label: string }) => s.label === label);
// deno-lint-ignore no-explicit-any
const diagFor = (obj: any, tool: string) =>
  (obj.diagnostics ?? []).find((d: { tool: string }) => d.tool === tool);

Deno.test("finish --json: a no-op gate emits ok:true, verb, and no job steps", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "finish");
    assertEquals(obj.data.failed_stage, null);
    // The default install wires no capability/check, so no JOB-kind step ran.
    const jobs = obj.steps.filter((s: { kind: string }) => s.kind === "job");
    assertEquals(
      jobs.length,
      0,
      `expected zero job steps on a no-op gate, got ${JSON.stringify(jobs)}`,
    );
    assert(Array.isArray(obj.data.scopes_changed));
    // No failure → the diagnostics field is omitted entirely.
    assertEquals(obj.diagnostics, undefined);
  });
});

Deno.test("finish --json: a failing check reports ok:false, a failed step, and a diagnostic with captured output", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes.docs]",
        'paths = ["docs/"]',
        "neutral = true",
        "",
        "[capabilities]",
        // a check-stage capability that prints to stderr, then fails
        'lint = "echo boom-on-stderr >&2; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "finish");
    assertEquals(obj.data.failed_stage, "check/test");
    // The failure is attributed to the precise job step.
    const lint = stepFor(obj, "lint");
    assertEquals(lint.outcome, "failed");
    assertEquals(lint.kind, "job");
    // …and to a structured diagnostic carrying the reproduce command + output.
    const diag = diagFor(obj, "lint");
    assert(
      diag,
      `expected a diagnostic for lint, got ${JSON.stringify(obj.diagnostics)}`,
    );
    assertEquals(diag.severity, "error");
    assertEquals(diag.reproduce_cmd, "echo boom-on-stderr >&2; exit 1");
    assertStringIncludes(diag.output, "boom-on-stderr");
  });
});

Deno.test("finish --json: scope-gates report fired (ok) and unchanged (skipped) steps", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes.docs]",
        'paths = ["docs/"]',
        "neutral = true",
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "echo widget-ok"',
        "",
        "[scopes.gadget]",
        'paths = ["gadget/**"]',
        'gate = "echo gadget-ok"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x"); // only widget changed

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    const widget = stepFor(obj, "scope:widget");
    const gadget = stepFor(obj, "scope:gadget");
    assertEquals(widget.kind, "scope-gate");
    assertEquals(widget.outcome, "ok"); // fired and passed
    assertEquals(gadget.outcome, "skipped"); // configured, scope unchanged
    assert(obj.data.scopes_changed.includes("widget"));
  });
});

Deno.test("finish --json: a failing scope-gate reports ok:false at the scope_gates stage with a diagnostic", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes.docs]",
        'paths = ["docs/"]',
        "neutral = true",
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "scope_gates");
    const widget = stepFor(obj, "scope:widget");
    assertEquals(widget.outcome, "failed");
    // A failure with no output still earns a diagnostic — its reproduce_cmd alone
    // moves the agent off "re-run and scrape".
    const diag = diagFor(obj, "scope:widget");
    assert(diag, "expected a diagnostic for the failed scope gate");
    assertEquals(diag.reproduce_cmd, "exit 1");
  });
});

Deno.test("finish --json: a SARIF-emitting check yields Tier-1 diagnostics with file/line/rule", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const sarif = JSON.stringify({
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [{
        tool: { driver: { name: "ESLint" } },
        results: [{
          ruleId: "no-debugger",
          level: "error",
          message: { text: "Unexpected 'debugger' statement." },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: "src/app.ts" },
              region: { startLine: 42, startColumn: 3 },
            },
          }],
        }],
      }],
    });
    await Deno.writeTextFile(join(dir, "lint.sarif"), sarif);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        // The check prints SARIF (as a real `--format sarif` run would), then fails.
        'lint = "cat lint.sarif; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    // The raw output was normalized into a structured, located finding.
    const diag = diagFor(obj, "lint");
    assert(
      diag,
      `expected a lint diagnostic, got ${JSON.stringify(obj.diagnostics)}`,
    );
    assertEquals(diag.file, "src/app.ts");
    assertEquals(diag.line, 42);
    assertEquals(diag.col, 3);
    assertEquals(diag.rule, "no-debugger");
    assertEquals(diag.severity, "error");
    assertStringIncludes(diag.message, "debugger");
    // reproduce_cmd is still the gate job's own command.
    assertEquals(diag.reproduce_cmd, "cat lint.sarif; exit 1");
  });
});

Deno.test("finish --dry-run --json: emits a preview envelope (plan, no steps)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'test = "echo hi"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "finish");
    assertEquals(obj.plan.title, "Gate plan");
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "test"),
      "dry-run plan should list the test job",
    );
    // A preview ran nothing, so there are no executed steps.
    assertEquals(obj.steps, undefined);
  });
});

Deno.test("finish (human): a failure prints a structured Failures block with reproduce commands", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'lint = "exit 7"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish"]); // human mode
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Failures");
    assertStringIncludes(r.output, "reproduce:");
    assertStringIncludes(r.output, "exit 7");
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
