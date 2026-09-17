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
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { CAPTURE_CAP } from "../src/shared/result.ts";
import { HINTS } from "../src/shared/hints.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
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
import { refreshScaffold } from "./engine_done_fixture.ts";
import {
  assertFailedStepsHaveDiagnostics,
  decodeGateResult,
  diagFor,
  hasDroppedC0Control,
  pathExists,
  stepFor,
} from "./engine_done_json_shared.ts";

Deno.test("done --json: a fresh gate runs only its embedded format job", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);

    const obj = decodeGateResult(r.stdout); // stdout must be ONLY the JSON object
    assertEquals(obj.ok, true);
    assertEquals(obj.verb, "done");
    assertEquals(obj.data.failed_stage, null);
    const gateProof = obj.data.gate_proof;
    assert(
      gateProof,
      `expected Gate proof data, got ${JSON.stringify(obj.data)}`,
    );
    assertEquals(gateProof.status, "recorded");
    assert(
      typeof gateProof.path === "string" && gateProof.path.length > 0,
      `expected a proof path, got ${JSON.stringify(gateProof)}`,
    );
    // A fresh install wires only discern's own formatter. Project-specific
    // capabilities remain unset until setup discovers the stack.
    assert(obj.steps, `expected executed steps, got ${JSON.stringify(obj)}`);
    const jobs = obj.steps.filter((step) => step.kind === "job");
    assertEquals(
      jobs.map((step) => ({
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

Deno.test("done --json: a trunk advancing during validation stays bound to the observed predecessor", async () => {
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
    await refreshScaffold(dir);
    const wt = await addWorktree(dir, "mid-gate-main-advance");
    await writeExecutable(join(wt, "feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const mainBefore = await gitOut(dir, "rev-parse", "main");

    const r = await runAgent(wt, ["done", "--json"]);
    // The run proves the committed tip against the trunk tip it observed at
    // its start. A trunk that advances mid-run does not invalidate this run's
    // Proof; acceptance re-checks the trunk and refuses with the update route.
    assertEquals(r.code, 0, r.output);
    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.completion?.kind, "complete");
    assert(
      (await gitOut(dir, "rev-parse", "main")) !== mainBefore,
      "the gate job must advance the shared trunk ref",
    );
    const candidateId = obj.data.completion?.candidate_id;
    assert(typeof candidateId === "string");
    const reading = await readCompletionRecord(dir, {
      kind: "candidate",
      id: candidateId,
    });
    assert(reading.kind === "recorded" && reading.record.kind === "candidate");
    assertEquals(
      reading.record.data.predecessor,
      mainBefore,
      "the candidate binds the predecessor observed before the run",
    );
  });
});

// Each red-diagnostic variant below is a fact about ONE failing check job's own
// diagnostic, so the four variants ride one red gate as four check jobs — a
// captured stderr failure, a missing tool, a noisy Tier-0 offload, and an empty
// SARIF fallback. Each step carries the name of the case it replaced, so a
// failure still names the behaviour.
Deno.test("done --json: one red gate carries each failing check's own diagnostic — captured stderr, exit-127 guidance, bounded Tier-0 noise, and the empty-SARIF fallback", async (t) => {
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
    await Deno.writeTextFile(
      join(dir, "empty.sarif"),
      JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
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
        "[scopes.map]",
        'paths = ["docs/"]',
        "neutral = true",
        "",
        "[jobs]",
        'format = "true"',
        // a check-stage capability that prints to stderr, then fails
        'lint = "echo boom-on-stderr >&2; exit 1"',
        "",
        // a command that does not exist → the shell exits 127 ("command not found")
        "[jobs.missing-tool]",
        'stage = "check"',
        'run = "discern-no-such-command-xyz --run"',
        "",
        "[jobs.noisy]",
        'stage = "check"',
        'run = "./noisy-check.sh"',
        "",
        "[jobs.empty-sarif]",
        'stage = "check"',
        'run = "cat empty.sarif; exit 1"',
        "",
        // The four checks share one stage; without fail-fast the first failure
        // cannot cancel a sibling before its diagnostic evidence is complete.
        "[gate]",
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await refreshScaffold(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = decodeGateResult(r.stdout);

    await t.step(
      "done --json: a failing check reports ok:false, a failed step, and a diagnostic with captured output",
      () => {
        assertEquals(obj.ok, false);
        assertEquals(obj.verb, "done");
        assertEquals(obj.data.failed_stage, "check");
        // The failure is attributed to the precise job step.
        const lint = stepFor(obj, "lint");
        assertEquals(lint.outcome, "failed");
        assertEquals(lint.kind, "job");
        // …and to a structured diagnostic carrying the reproduce command + output.
        const diag = diagFor(obj, "lint");
        assert(
          diag,
          `expected a diagnostic for lint, got ${
            JSON.stringify(obj.diagnostics)
          }`,
        );
        assertEquals(diag.severity, "error");
        assertEquals(diag.reproduce_cmd, "echo boom-on-stderr >&2; exit 1");
        assertEquals(diag.fix_available, true);
        assert(diag.output !== undefined, "expected captured lint output");
        assertStringIncludes(diag.output, "boom-on-stderr");
        assertFailedStepsHaveDiagnostics(obj);
      },
    );

    await t.step(
      "done --json: an exit-127 failure explains command-not-found and points at [repository].ensure",
      () => {
        // The class this guards: a tool present in the main checkout but absent from a
        // fresh worktree fails with a bare `sh: <cmd>: not found` and exit 127, and nothing
        // links the failure to worktrees or to [repository].ensure. The hint stays
        // generic — no tool or ecosystem names — since discern never sniffs the stack.
        const diag = diagFor(obj, "missing-tool");
        assert(
          diag,
          `expected a diagnostic for missing-tool, got ${
            JSON.stringify(obj.diagnostics)
          }`,
        );
        assertStringIncludes(diag.message, "exit 127");
        assertStringIncludes(diag.message, "command not found");
        assertStringIncludes(diag.message, "[repository].ensure");
      },
    );

    await t.step(
      "done --json: Tier-0 diagnostic output is normalized, bounded, and offloaded when long",
      async () => {
        const diag = diagFor(obj, "noisy");
        assert(diag !== undefined, `expected a noisy diagnostic: ${r.stdout}`);
        assert(diag.output !== undefined, "expected bounded diagnostic output");

        assert(!diag.output.includes("\x1b"), diag.output);
        assert(!diag.output.includes("\r"), diag.output);
        assert(!hasDroppedC0Control(diag.output), diag.output);
        assertTerminalTextIncludes(diag.output, "progress done");
        assert(!diag.output.includes("progress 10%"), diag.output);
        assert(
          diag.output.length <= CAPTURE_CAP,
          `diagnostic output should stay within ${CAPTURE_CAP} chars; got ${diag.output.length}`,
        );
        assertEquals(diag.truncated, true);
        assert(
          typeof diag.output_path === "string",
          "expected offloaded output path",
        );

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
      },
    );

    await t.step(
      "done --json: empty SARIF falls back to a raw Tier-0 diagnostic",
      () => {
        const diag = diagFor(obj, "empty-sarif");
        assert(diag, `expected Tier-0 fallback diagnostic, got ${r.stdout}`);
        assertEquals(diag.message, "empty-sarif failed (exit 1)");
        assertEquals(diag.reproduce_cmd, "cat empty.sarif; exit 1");
        assert(diag.output !== undefined, "expected raw fallback output");
        assertStringIncludes(diag.output, '"results":[]');
        assertEquals(diag.file, undefined);
        assertFailedStepsHaveDiagnostics(obj);
      },
    );
  });
});

Deno.test("done --json: one green gate reports a loud passing job's advisory artifact and the fired and unchanged scope gates", async (t) => {
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
        "[scopes.map]",
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
    await refreshScaffold(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x"); // only widget changed

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.ok, true);

    await t.step(
      "done --json: a passing job with suspicious output exposes an advisory artifact",
      async () => {
        assertEquals(obj.diagnostics, undefined);
        const lint = stepFor(obj, "lint");
        assertEquals(lint.outcome, "ok");
        assertEquals(lint.output_lines, 12);
        assertEquals(lint.error_like_lines, 12);
        assert(
          typeof lint.output_path === "string",
          "expected a captured output path",
        );
        const output = await Deno.readTextFile(lint.output_path);
        assertStringIncludes(output, "error: one");
        assertStringIncludes(output, "warning: eight");
        assertHasHint(obj, HINTS["gate-job-loud-success"], {
          label: "lint",
          errorLikeLines: 12,
          outputLines: 12,
          outputPath: lint.output_path,
        });
      },
    );

    await t.step(
      "done --json: scope-gates report fired (ok) and unchanged (skipped) steps",
      () => {
        const widget = stepFor(obj, "scope:widget");
        const gadget = stepFor(obj, "scope:gadget");
        assertEquals(widget.kind, "scope-gate");
        assertEquals(widget.outcome, "ok"); // fired and passed
        assertEquals(gadget.outcome, "skipped"); // configured, scope unchanged
        assert(obj.data.scopes_changed.includes("widget"));
      },
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
        "[jobs]",
        "lint = \"printf 'STREAM-JSON-MARKER\\n'; exit 1\"",
        "",
        "[gate]",
        "stream_output = true",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await refreshScaffold(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "check");
    const diag = diagFor(obj, "lint");
    assert(diag, `expected a diagnostic for lint, got ${r.stdout}`);
    assert(diag.output !== undefined, "expected captured streamed output");
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
    await refreshScaffold(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = decodeGateResult(r.stdout);
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
    assert(diag.output !== undefined, "expected captured format output");
    assertStringIncludes(diag.output, "FORMAT-BOOM");
    assertFailedStepsHaveDiagnostics(obj);

    const prepare = await runAgent(dir, ["prepare"]);
    assertEquals(prepare.code, 1, prepare.output);
    assertTerminalTextIncludes(prepare.output, "A fixer failed.");
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
        "[scopes.map]",
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
    await refreshScaffold(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const r = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
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

Deno.test("done --json: one red gate yields Tier-1 diagnostics from a SARIF-emitting check and a JUnit-emitting test job", async (t) => {
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
    const junit = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="test run" tests="2" failures="1" errors="0" time="0.1">',
      '    <testsuite name="./checks/upload_check.txt" tests="2" failures="1">',
      '        <testcase name="keeps going" classname="./checks/upload_check.txt" time="0.01" line="4" col="6">',
      "        </testcase>",
      '        <testcase name="retries the upload" classname="./checks/upload_check.txt" time="0.02" line="9" col="6">',
      '            <failure message="expected 2 retries, saw 1">expected 2 retries, saw 1</failure>',
      "        </testcase>",
      "    </testsuite>",
      "</testsuites>",
    ].join("\n");
    await Deno.writeTextFile(join(dir, "report.xml"), junit);
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
        // The test job prints JUnit (as a real `--reporter=junit` run would), then fails.
        'test = "cat report.xml; exit 1"',
        "",
        // Both jobs share the check/test group; without fail-fast the first
        // failure cannot cancel its sibling before that report is emitted.
        "[gate]",
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await refreshScaffold(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);

    const obj = decodeGateResult(r.stdout);
    assertEquals(obj.ok, false);

    await t.step(
      "done --json: a SARIF-emitting check yields Tier-1 diagnostics with file/line/rule",
      () => {
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
      },
    );

    await t.step(
      "done --json: a JUnit-emitting test job yields Tier-1 diagnostics naming the failing test",
      () => {
        // The raw report was normalized into one located finding per failing test.
        const diag = diagFor(obj, "test");
        assert(
          diag,
          `expected a test diagnostic, got ${JSON.stringify(obj.diagnostics)}`,
        );
        assertEquals(diag.file, "checks/upload_check.txt");
        assertEquals(diag.line, 9);
        assertEquals(diag.col, 6);
        assertEquals(diag.rule, "retries the upload");
        assertEquals(diag.severity, "error");
        assertStringIncludes(diag.message, "expected 2 retries");
        // reproduce_cmd is still the gate job's own command.
        assertEquals(diag.reproduce_cmd, "cat report.xml; exit 1");
        assertFailedStepsHaveDiagnostics(obj);
      },
    );
  });
});
