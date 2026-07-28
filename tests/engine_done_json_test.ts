/**
 * Engine tests for the structured `done --json` result — the DiscernResult
 * envelope (ADR 0028).
 *
 * In --json mode `done` emits a single JSON object on stdout (human output goes
 * to stderr): the uniform `{ok, verb, steps, diagnostics?, data}` shell every
 * verb returns. Each capability/check/scope-gate is a `steps[]` entry; a GENUINE
 * failure also yields a `diagnostics[]` entry carrying the command to reproduce it
 * and its captured output — the structured "why" an agent fixes from. The gate's
 * own `failed_stage` / `scopes_changed` ride in the verb-specific `data`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { CAPTURE_CAP } from "../src/shared/result.ts";
import { HINTS } from "../src/shared/hints.ts";
import { gateReceiptHonored } from "../src/engine/gate/receipt.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  assertFailedStepsHaveDiagnostics,
  diagFor,
  hasDroppedC0Control,
  parseJson,
  pathExists,
  stepFor,
} from "./engine_done_json_shared.ts";

Deno.test("done --json: a fresh gate runs only its embedded format job", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "done");
    assertEquals(obj.data.failed_stage, null);
    assertEquals(obj.data.gate_receipt.status, "recorded");
    assert(
      typeof obj.data.gate_receipt.path === "string" &&
        obj.data.gate_receipt.path.length > 0,
      `expected a receipt path, got ${JSON.stringify(obj.data.gate_receipt)}`,
    );
    // A fresh install wires only discern's own formatter. Project-specific
    // capabilities remain unset until setup discovers the stack.
    const jobs = obj.steps.filter((s: { kind: string }) => s.kind === "job");
    assertEquals(
      jobs.map((step: { label: string; note: string; outcome: string }) => ({
        label: step.label,
        note: step.note,
        outcome: step.outcome,
      })),
      [{ label: "format", note: "discern tidy", outcome: "ok" }],
      `expected only the embedded format job, got ${JSON.stringify(jobs)}`,
    );
    assert(Array.isArray(obj.data.scopes_changed));
    // No failure → the diagnostics field is omitted entirely.
    assertEquals(obj.diagnostics, undefined);
  });
});

Deno.test("done --json: trunk advancing during a green gate warns and still records the receipt", async () => {
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
        `test = 'git -C "${dir}" commit --allow-empty -q -m "advance main during gate" --no-gpg-sign'`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "mid-gate-main-advance");
    await writeExecutable(join(wt, "feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const mainBefore = await gitOut(dir, "rev-parse", "main");

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    assertEquals(obj.data.gate_receipt.status, "recorded");
    assertEquals(await gateReceiptHonored(wt), true);
    assert(
      (await gitOut(dir, "rev-parse", "main")) !== mainBefore,
      "the gate job must advance the shared trunk ref",
    );
    assertHasHint(obj, HINTS["gate-trunk-advanced"]);
  });
});

Deno.test("done --json: a failing check reports ok:false, a failed step, and a diagnostic with captured output", async () => {
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
        "[scopes.docs]",
        'paths = ["docs/"]',
        "neutral = true",
        "",
        "[jobs]",
        'format = "true"',
        // a check-stage capability that prints to stderr, then fails
        'lint = "echo boom-on-stderr >&2; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "done");
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
    assertEquals(diag.fix_available, true);
    assertStringIncludes(diag.output, "boom-on-stderr");
    assertFailedStepsHaveDiagnostics(obj);
  });
});

Deno.test("done --json: an exit-127 failure explains command-not-found and points at [repository].ensure", async () => {
  // The class this guards: a tool present in the main checkout but absent from a
  // fresh worktree fails with a bare `sh: <cmd>: not found` and exit 127, and nothing
  // links the failure to worktrees or to [repository].ensure. The hint stays
  // generic — no tool or ecosystem names — since discern never sniffs the stack.
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
        // a command that does not exist → the shell exits 127 ("command not found")
        'lint = "discern-no-such-command-xyz --run"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    const diag = diagFor(obj, "lint");
    assert(
      diag,
      `expected a diagnostic for lint, got ${JSON.stringify(obj.diagnostics)}`,
    );
    assertStringIncludes(diag.message, "exit 127");
    assertStringIncludes(diag.message, "command not found");
    assertStringIncludes(diag.message, "[repository].ensure");
  });
});

Deno.test("done --json: a passing job with suspicious output exposes an advisory artifact", async () => {
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
        "lint = \"printf 'error: one\\nwarning: two\\n    ^~~~~\\nerror: three\\nwarning: four\\n    ^~~~~\\nerror: five\\nwarning: six\\n    ^~~~~\\nerror: seven\\nwarning: eight\\n    ^~~~~\\n'\"",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.diagnostics, undefined);
    const lint = stepFor(obj, "lint");
    assertEquals(lint.outcome, "ok");
    assertEquals(lint.output_lines, 12);
    assertEquals(lint.error_like_lines, 12);
    assertEquals(typeof lint.output_path, "string");
    const output = await Deno.readTextFile(lint.output_path);
    assertStringIncludes(output, "error: one");
    assertStringIncludes(output, "warning: eight");
    assertHasHint(obj, HINTS["gate-job-loud-success"], {
      label: "lint",
      errorLikeLines: 12,
      outputLines: 12,
      outputPath: lint.output_path,
    });
  });
});

Deno.test("done --json: stream-enabled failures capture output into the diagnostic", async () => {
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
        "lint = \"printf 'STREAM-JSON-MARKER\\n'; exit 1\"",
        "",
        "[gate]",
        "stream = true",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "check/test");
    const diag = diagFor(obj, "lint");
    assert(diag, `expected a diagnostic for lint, got ${r.stdout}`);
    assertStringIncludes(diag.output, "STREAM-JSON-MARKER");
    assertFailedStepsHaveDiagnostics(obj);
  });
});

Deno.test("done --json: a fix-stage failure skips later check/test jobs and scope gates", async () => {
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
        'format = "echo FORMAT-BOOM >&2; exit 2"',
        'lint = "echo LINT-RAN > lint.ran"',
        'test = "echo TEST-RAN > test.ran"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "echo SCOPE-RAN > scope.ran"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "fix");
    assert(obj.data.scopes_changed.includes("widget"), r.stdout);

    assertEquals(stepFor(obj, "format").outcome, "failed");
    assertEquals(stepFor(obj, "lint").outcome, "skipped");
    assertEquals(stepFor(obj, "test").outcome, "skipped");
    const scope = stepFor(obj, "scope:widget");
    assertEquals(scope.disposition, "run");
    assertEquals(scope.outcome, "skipped");
    assertEquals(await pathExists(join(dir, "lint.ran")), false);
    assertEquals(await pathExists(join(dir, "test.ran")), false);
    assertEquals(await pathExists(join(dir, "scope.ran")), false);

    const diag = diagFor(obj, "format");
    assert(diag, `expected a format diagnostic, got ${r.stdout}`);
    assertStringIncludes(diag.output, "FORMAT-BOOM");
    assertFailedStepsHaveDiagnostics(obj);

    const prepare = await runAgent(dir, ["prepare"]);
    assertEquals(prepare.code, 1, prepare.output);
    assertStringIncludes(prepare.output, "A fixer failed.");
  });
});

Deno.test("done --json: Tier-0 diagnostic output is normalized, bounded, and offloaded when long", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "noisy-check.sh"),
      [
        "#!/usr/bin/env sh",
        "printf '\\033[32mCheck\\033[0m src/main.ts\\n'",
        "printf '\\033]8;;https://example.test\\033\\\\click here\\033]8;;\\033\\\\\\n'",
        "printf 'progress 10%%\\rprogress 50%%\\rprogress done\\n'",
        "printf 'bell\\007back\\010space\\n'",
        "i=0",
        'while [ "$i" -lt 20000 ]; do',
        "  printf X",
        "  i=$((i + 1))",
        "done",
        "printf '\\nTAIL-SIGNAL\\n'",
        "exit 1",
        "",
      ].join("\n"),
    );
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
        'lint = "./noisy-check.sh"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    const diag = diagFor(obj, "lint");
    assert(diag !== undefined, `expected a lint diagnostic: ${r.stdout}`);

    assert(!diag.output.includes("\x1b"), diag.output);
    assert(!diag.output.includes("\r"), diag.output);
    assert(!hasDroppedC0Control(diag.output), diag.output);
    assertStringIncludes(diag.output, "progress done");
    assert(!diag.output.includes("progress 10%"), diag.output);
    assert(
      diag.output.length <= CAPTURE_CAP,
      `diagnostic output should stay within ${CAPTURE_CAP} chars; got ${diag.output.length}`,
    );
    assertEquals(diag.truncated, true);
    assertEquals(typeof diag.output_path, "string");

    const info = await Deno.stat(diag.output_path);
    assert(info.isFile, `expected a readable file at ${diag.output_path}`);
    const full = await Deno.readTextFile(diag.output_path);
    assert(
      full.length > CAPTURE_CAP,
      "full capture should exceed the inline cap",
    );
    assert(!full.includes("\x1b"), full);
    assert(!full.includes("\r"), full);
    assert(!hasDroppedC0Control(full), full);
    assertStringIncludes(full, "Check src/main.ts");
    assertStringIncludes(full, "click here");
    assertStringIncludes(full, "progress done");
    assertStringIncludes(full, "TAIL-SIGNAL");
  });
});

Deno.test("done --json: scope-gates report fired (ok) and unchanged (skipped) steps", async () => {
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

    const r = await runAgent(dir, ["done", "--json"]);
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

Deno.test("done --json: a failing scope-gate reports ok:false at the scope_gates stage with a diagnostic", async () => {
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

    const r = await runAgent(dir, ["done", "--json"]);
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
    assertFailedStepsHaveDiagnostics(obj);
  });
});

Deno.test("done --json: a SARIF-emitting check yields Tier-1 diagnostics with file/line/rule", async () => {
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        // The check prints SARIF (as a real `--format sarif` run would), then fails.
        'lint = "cat lint.sarif; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
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
    assertFailedStepsHaveDiagnostics(obj);
  });
});

Deno.test("done --json: empty SARIF falls back to a raw Tier-0 diagnostic", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [{ results: [] }],
    });
    await Deno.writeTextFile(join(dir, "empty.sarif"), sarif);
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
        'lint = "cat empty.sarif; exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    const diag = diagFor(obj, "lint");
    assert(diag, `expected Tier-0 fallback diagnostic, got ${r.stdout}`);
    assertEquals(diag.message, "lint failed (exit 1)");
    assertEquals(diag.reproduce_cmd, "cat empty.sarif; exit 1");
    assertStringIncludes(diag.output, '"results":[]');
    assertEquals(diag.file, undefined);
    assertFailedStepsHaveDiagnostics(obj);
  });
});
