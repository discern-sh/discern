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

interface JsonStep {
  kind: string;
  label: string;
  outcome: string;
}

interface JsonDiagnostic {
  tool: string;
}

function assertFailedStepsHaveDiagnostics(obj: {
  steps?: JsonStep[];
  diagnostics?: JsonDiagnostic[];
}): void {
  const failed = (obj.steps ?? []).filter((s) =>
    (s.kind === "job" || s.kind === "scope-gate") && s.outcome === "failed"
  );
  assert(failed.length > 0, "expected at least one genuinely failed job step");
  const tools = new Set((obj.diagnostics ?? []).map((d) => d.tool));
  for (const step of failed) {
    assert(
      tools.has(step.label),
      `failed step ${step.label} must yield a diagnostic: ${
        JSON.stringify(obj.diagnostics)
      }`,
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function hasDroppedC0Control(s: string): boolean {
  return s.split("").some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 && code !== 0x0a && code !== 0x09;
  });
}

Deno.test("done --json: a no-op gate emits ok:true, verb, and no job steps", async () => {
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
        "[capabilities]",
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
        "[capabilities]",
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
        "[capabilities]",
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
    assert(
      (obj.hints ?? []).some((hint: string) =>
        hint.includes("lint passed but printed 12 error-like line(s)") &&
        hint.includes(lint.output_path)
      ),
      `expected a loud-success advisory hint, got ${JSON.stringify(obj.hints)}`,
    );
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
        "[capabilities]",
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
        "[capabilities]",
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
        "[capabilities]",
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
        "[capabilities]",
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
        "[capabilities]",
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

Deno.test("done --dry-run --json: emits a preview envelope (plan, no steps)", async () => {
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
        "[capabilities]",
        'test = "echo hi"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "done");
    assertEquals(obj.dry_run, true); // the uniform "is this a preview?" signal
    assertEquals(obj.plan.title, "Gate plan");
    assert(
      obj.plan.steps.some((s: { label: string }) => s.label === "test"),
      "dry-run plan should list the test job",
    );
    assert(
      obj.plan.steps.some((s: { label: string; disposition: string }) =>
        s.label === "tracked-artifacts-check" && s.disposition === "gate"
      ),
      "dry-run plan should list the tracked-artifacts precondition",
    );
    // A preview ran nothing, so there are no executed steps.
    assertEquals(obj.steps, undefined);
  });
});

Deno.test("done (human): a failure prints a structured Failures block with reproduce commands", async () => {
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
        "[capabilities]",
        'lint = "exit 7"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done"]); // human mode
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Failures");
    assertStringIncludes(r.output, "reproduce:");
    assertStringIncludes(r.output, "exit 7");
  });
});

Deno.test("done --json: a passing gate carries next-step hints, and the human tail prints the SAME strings", async () => {
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
        "[capabilities]",
        'test = "echo ok"',
        "",
        "[standards.cov]",
        'run = "echo DISCERN_METRIC cov 90"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // --json: the advice rides in the envelope (promoted off the human-only tail).
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assert(Array.isArray(obj.hints), `expected hints[], got ${r.stdout}`);
    const hints = obj.hints.join("\n");
    assertStringIncludes(hints, "docs"); // update-the-docs nudge
    // The standard was measured IN the gate (not deferred to a follow-up verb),
    // so no "run discern standards" nudge is owed — the step itself is the record.
    const stdStep = stepFor(obj, "standard:cov");
    assertEquals(stdStep?.outcome, "ok", JSON.stringify(obj.steps));

    // Human mode renders the exact same hint strings (one source of truth).
    const human = await runAgent(dir, ["done"]);
    assertEquals(human.code, 0, human.output);
    for (const hint of obj.hints) {
      assertStringIncludes(human.output, hint);
    }
  });
});

Deno.test("done --json: a failing gate carries the gotchas-doc pointer as a hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'gotchas_doc = "docs/gotchas.md"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[capabilities]",
        'lint = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assert(Array.isArray(obj.hints), `expected hints[], got ${r.stdout}`);
    assertStringIncludes(obj.hints.join("\n"), "docs/gotchas.md");
  });
});

Deno.test("done --json: human mode is unaffected (stdout still human, not JSON)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["done"]); // no --json
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

Deno.test("done --json: a STALE generated agent file fails the guidance check; refresh fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]); // compile CLAUDE.md so it is current

    // Baseline: current generated files → the gate passes.
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    // Hand-edit the generated file → stale → the gate blocks.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\nstray hand edit\n`,
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "guidance");
    const diag = diagFor(obj, "guidance");
    assert(diag !== undefined, `expected a guidance diagnostic: ${r.stdout}`);
    assertEquals(diag.reproduce_cmd, "discern refresh");
    assertStringIncludes(diag.output, "CLAUDE.md");
    assertStringIncludes(diag.output, "[guidance].sources"); // the redirect
    assertStringIncludes(diag.output, "stray hand edit"); // the diff shows the loss

    // Regenerating satisfies the check — the gate passes again.
    await runAgent(dir, ["refresh"]);
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "refresh should clear the drift",
    );
  });
});

Deno.test("done --json: a malformed authored SKILL.md fails the skill_frontmatter check; an edit fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    assertEquals((await runAgent(dir, ["done", "--json"])).code, 0);

    // An authored skill whose description sits on an indented continuation
    // line containing `: ` — a real YAML parser reads a nested mapping, not a
    // string, so an agent runtime would reject or misread the skill.
    const skillMd = join(
      dir,
      "discern",
      "skills",
      "label-the-jars",
      "SKILL.md",
    );
    const skillDoc = (description: string[]): string =>
      [
        "---",
        "name: label-the-jars",
        ...description,
        "---",
        "",
        "# Label the jars",
        "",
        "Body.",
        "",
      ].join("\n");
    await Deno.mkdir(join(dir, "discern", "skills", "label-the-jars"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      skillMd,
      skillDoc([
        "description:",
        "  Label every jar in the pantry. Out of scope: the fridge.",
      ]),
    );
    await runAgent(dir, ["refresh"]); // materialize, so the currency check is clean

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "skill_frontmatter");
    const diag = diagFor(obj, "skill-frontmatter");
    assert(
      diag !== undefined,
      `expected a skill-frontmatter diagnostic: ${r.stdout}`,
    );
    assertStringIncludes(diag.message, "label-the-jars");
    assertStringIncludes(diag.output, "nested mapping"); // what a YAML parser reads
    assertStringIncludes(diag.output, "double quotes"); // the remedy

    // Folding the value onto one quoted line satisfies every parser.
    await Deno.writeTextFile(
      skillMd,
      skillDoc([
        'description: "Label every jar in the pantry. Out of scope: the fridge."',
      ]),
    );
    assertEquals(
      (await runAgent(dir, ["done", "--json"])).code,
      0,
      "a valid identity should clear the check",
    );
  });
});

Deno.test("done --json: a stale generated file fails FAST — the currency check precedes the slow stage, so the capability is skipped (ADR 0056)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Wire one observable capability so its step outcome proves whether it ran.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[guidance]",
        'agents = ["claude_code"]',
        "",
        "[capabilities]",
        'test = "true"',
        "",
      ].join("\n"),
    );
    await runAgent(dir, ["refresh"]); // materialize the agent files + skills (current)

    // Baseline: current artifacts → the currency checks pass and the capability runs.
    const ok = parseJson((await runAgent(dir, ["done", "--json"])).stdout);
    assertEquals(ok.data.failed_stage, null);
    assert(
      ok.steps.some((s: { kind: string; outcome: string }) =>
        s.kind === "job" && s.outcome === "ok"
      ),
      `baseline: the capability should run and pass: ${
        JSON.stringify(ok.steps)
      }`,
    );

    // Stale a generated agent file → the guidance currency precondition fails FIRST.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\nstray hand edit\n`,
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.data.failed_stage, "guidance");
    // Fail-fast (ADR 0056): the expensive stage never ran — every planned step is
    // skipped, exactly as for the merge precondition (ADR 0050). Were the currency
    // check still last, the capability would have run first (its step would be `ok`).
    assert(
      obj.steps.length >= 1,
      `expected a planned capability step: ${r.stdout}`,
    );
    assert(
      obj.steps.every((s: { outcome: string }) => s.outcome === "skipped"),
      `the capability must not run when the currency check fails first: ${r.stdout}`,
    );
  });
});

Deno.test("done --json: a MISSING generated agent file does NOT block (absent copy tolerated)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    await Deno.remove(join(dir, "CLAUDE.md")); // model a deletion, or a project keeping them untracked

    const r = await runAgent(dir, ["done", "--json"]);
    // Missing is advisory (surfaced by `status`), never a gate failure — a
    // project that keeps the compiled files untracked would otherwise
    // red-light first-run CI on every fresh checkout.
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    assertEquals(diagFor(obj, "guidance"), undefined);
  });
});

Deno.test("done --json: tracked discern-managed ignored artifacts fail before jobs run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[guidance]",
        'agents = ["claude_code", "codex"]',
        "",
        "[capabilities]",
        'test = "true"',
        "",
      ].join("\n"),
    );
    await runAgent(dir, ["refresh"]);
    // The compiled guidance files are tracked by design — add them normally.
    // Machine-local state forced into the index is what the check catches.
    await git(dir, "add", "AGENTS.md", "CLAUDE.md");
    await Deno.writeTextFile(
      join(dir, ".claude", "settings.local.json"),
      "{}\n",
    );
    await git(dir, "add", "-f", ".claude/settings.local.json");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "tracked_artifacts");
    assert(
      obj.steps.every((s: { outcome: string }) => s.outcome === "skipped"),
      `the test job must not run after the tracked-artifacts precondition fails: ${r.stdout}`,
    );
    const diag = diagFor(obj, "tracked-artifacts");
    assert(
      diag !== undefined,
      `expected tracked-artifacts diagnostic: ${r.stdout}`,
    );
    assertStringIncludes(diag.reproduce_cmd, "git ls-files --");
    assertStringIncludes(
      diag.output,
      "git rm -r --cached -- .claude/settings.local.json",
    );
    assertStringIncludes(diag.output, "discern refresh");
    assertEquals(diagFor(obj, "guidance"), undefined);
  });
});

Deno.test("done --json: a hand-edited materialized skill blocks (skills); a foreign drop-in does not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Materialize the agent files + skills so the currency checks have real artifacts.
    await runAgent(dir, ["refresh"]);
    const skillsDir = join(dir, ".claude", "skills");

    // Hand-edit a copied bundled skill → stale → finish blocks with a skills diagnostic.
    await Deno.writeTextFile(
      join(skillsDir, "discern-write-adr", "SKILL.md"),
      "\nHAND EDIT\n",
      { append: true },
    );
    let obj = parseJson((await runAgent(dir, ["done", "--json"])).stdout);
    assertEquals(obj.data.failed_stage, "skills");
    const diag = diagFor(obj, "skills");
    assert(diag !== undefined, "a skills diagnostic should be attached");
    assertEquals(diag.reproduce_cmd, "discern refresh");

    // Re-materialize, then drop in a FOREIGN skill discern never owns — it must NOT
    // block finish (the never-clobber contract; only `stale` blocks).
    await runAgent(dir, ["refresh"]);
    await Deno.mkdir(join(skillsDir, "user-dropin"));
    await Deno.writeTextFile(
      join(skillsDir, "user-dropin", "SKILL.md"),
      "# mine\n",
    );
    obj = parseJson((await runAgent(dir, ["done", "--json"])).stdout);
    assertEquals(
      obj.data.failed_stage,
      null,
      "a foreign drop-in must not block finish",
    );
  });
});

// ── the receipt (v1): the review-moment summary a green gate emits ──────────────

const RECEIPT_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[capabilities]",
  'test = "echo receipt-gate-ok"',
  "",
].join("\n");

/** Strip the duration fragments (`· 3s`) — the one part of a receipt allowed to
 * differ between runs of the same tree. */
function stripDurations(md: string): string {
  return md.replaceAll(/ · \d+s/g, "");
}

Deno.test("done --json: a green worktree gate emits the receipt in data and stores it in the marker", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, RECEIPT_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await writeExecutable(join(wt, "feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "Add the feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);

    // The structured receipt: git facts + the rendered markdown, one derivation.
    const receipt = obj.data.receipt;
    assert(receipt !== undefined, `expected data.receipt: ${r.stdout}`);
    assertEquals(receipt.branch, "agent/alpha");
    assertEquals(receipt.trunk, "main");
    assertEquals(receipt.commits_total, 1);
    assertEquals(receipt.commits[0].subject, "Add the feature");
    assertEquals(receipt.files_total, 1);
    assertEquals(receipt.files[0].path, "feature.txt");
    assertStringIncludes(receipt.markdown, "### Receipt — `agent/alpha`");
    assertStringIncludes(
      receipt.markdown,
      "| test | `echo receipt-gate-ok` | ok",
    );
    assertStringIncludes(receipt.markdown, "- `feature.txt`");
    assertStringIncludes(
      receipt.markdown,
      "Inspect: `git diff main...agent/alpha`",
    );

    // The relay affordance rides the envelope's hints.
    assert(
      (obj.hints ?? []).some((h: string) => h.includes("relay the receipt")),
      `expected the relay hint: ${JSON.stringify(obj.hints)}`,
    );

    // The marker stores the markdown beside the sha it vouches for, so status and
    // accept can surface the receipt without re-running the gate.
    assertEquals(obj.data.gate_receipt.status, "recorded");
    const marker = await Deno.readTextFile(obj.data.gate_receipt.path);
    const head = (await gitOut(wt, "rev-parse", "HEAD")).trim();
    assert(
      marker.startsWith(`${head}\n\n### Receipt`),
      `marker must carry sha + markdown: ${marker.slice(0, 80)}`,
    );

    // Deterministic: the same tree and result render the same receipt (durations
    // excepted).
    const again = parseJson((await runAgent(wt, ["done", "--json"])).stdout);
    assertEquals(
      stripDurations(again.data.receipt.markdown),
      stripDurations(receipt.markdown),
    );
  });
});

Deno.test("done --json: no receipt on the trunk itself, or over a dirty tree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, RECEIPT_CONFIG);
    await gitInit(dir);

    // The trunk: nothing ahead of main to review — no receipt, gate still records.
    const onMain = parseJson(
      (await runAgent(dir, ["done", "--json"])).stdout,
    );
    assertEquals(onMain.ok, true);
    assertEquals(onMain.data.receipt, undefined);

    // A dirty worktree: the diff vs the trunk would describe a different tree than
    // the one the gate validated — no receipt, and no relay hint.
    const wt = await addWorktree(dir, "beta");
    await writeExecutable(join(wt, "feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "Add the feature", "--no-gpg-sign");
    await Deno.writeTextFile(join(wt, "wip.txt"), "wip\n");
    const dirty = parseJson((await runAgent(wt, ["done", "--json"])).stdout);
    assertEquals(dirty.ok, true);
    assertEquals(dirty.data.receipt, undefined);
    assertEquals(dirty.data.gate_receipt.status, "skipped_dirty");
    // The refusal NAMES what blocks the receipt — in the reason and the hint —
    // so the agent commits the right file instead of diagnosing a bare "dirty".
    assertStringIncludes(dirty.data.gate_receipt.reason, "wip.txt");
    assert(
      (dirty.hints ?? []).some((h: string) => h.includes("wip.txt")),
      `the dirty hint must name the blocking path: ${
        JSON.stringify(dirty.hints)
      }`,
    );
    assert(
      !(dirty.hints ?? []).some((h: string) => h.includes("relay the receipt")),
      `no relay hint without a receipt: ${JSON.stringify(dirty.hints)}`,
    );
  });
});
