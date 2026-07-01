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
import { CAPTURE_CAP } from "../src/shared/result.ts";
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

function hasDroppedC0Control(s: string): boolean {
  return s.split("").some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 && code !== 0x0a && code !== 0x09;
  });
}

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

Deno.test("finish --json: Tier-0 diagnostic output is normalized, bounded, and offloaded when long", async () => {
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
        'main_branch = "main"',
        "",
        "[capabilities]",
        'lint = "./noisy-check.sh"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["finish", "--json"]);
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
    assertEquals(obj.dry_run, true); // the uniform "is this a preview?" signal
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

Deno.test("finish --json: a passing gate carries next-step hints, and the human tail prints the SAME strings", async () => {
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
        'test = "echo ok"',
        "",
        "[ratchets.cov]",
        'run = "echo DISCERN_METRIC cov 90"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // --json: the advice rides in the envelope (promoted off the human-only tail).
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assert(Array.isArray(obj.hints), `expected hints[], got ${r.stdout}`);
    const hints = obj.hints.join("\n");
    assertStringIncludes(hints, "docs"); // update-the-docs nudge
    assertStringIncludes(hints, "discern ratchets"); // ratchets configured → check them

    // Human mode renders the exact same hint strings (one source of truth).
    const human = await runAgent(dir, ["finish"]);
    assertEquals(human.code, 0, human.output);
    for (const hint of obj.hints) {
      assertStringIncludes(human.output, hint);
    }
  });
});

Deno.test("finish --json: a failing gate carries the gotchas-doc pointer as a hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        'gotchas_doc = "docs/gotchas.md"',
        "",
        "[capabilities]",
        'lint = "exit 1"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, false);
    assert(Array.isArray(obj.hints), `expected hints[], got ${r.stdout}`);
    assertStringIncludes(obj.hints.join("\n"), "docs/gotchas.md");
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

Deno.test("finish --json: a STALE generated agent file fails the guidance check; refresh fixes it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]); // compile CLAUDE.md so it is current

    // Baseline: current generated files → the gate passes.
    assertEquals((await runAgent(dir, ["finish", "--json"])).code, 0);

    // Hand-edit the generated file → stale → the gate blocks.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\nstray hand edit\n`,
    );
    const r = await runAgent(dir, ["finish", "--json"]);
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
      (await runAgent(dir, ["finish", "--json"])).code,
      0,
      "refresh should clear the drift",
    );
  });
});

Deno.test("finish --json: a stale generated file fails FAST — the currency check precedes the slow stage, so the capability is skipped (ADR 0056)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Wire one observable capability so its step outcome proves whether it ran.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
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
    const ok = parseJson((await runAgent(dir, ["finish", "--json"])).stdout);
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
    const r = await runAgent(dir, ["finish", "--json"]);
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

Deno.test("finish --json: a MISSING generated agent file does NOT block (untracked artifact absent)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    await Deno.remove(join(dir, "CLAUDE.md")); // model a fresh checkout / deletion

    const r = await runAgent(dir, ["finish", "--json"]);
    // Missing is advisory (surfaced by `status`), never a gate failure — else a
    // fresh checkout with no generated file would red-light first-run CI.
    assertEquals(r.code, 0, r.output);
    const obj = parseJson(r.stdout);
    assertEquals(obj.ok, true);
    assertEquals(obj.data.failed_stage, null);
    assertEquals(diagFor(obj, "guidance"), undefined);
  });
});

Deno.test("finish --json: a hand-edited materialized skill blocks (skills); a foreign drop-in does not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Materialize the agent files + skills so the currency checks have real artifacts.
    await runAgent(dir, ["refresh"]);
    const skillsDir = join(dir, ".claude", "skills");

    // Hand-edit a copied bundled skill → stale → finish blocks with a skills diagnostic.
    await Deno.writeTextFile(
      join(skillsDir, "write-adr", "SKILL.md"),
      "\nHAND EDIT\n",
      { append: true },
    );
    let obj = parseJson((await runAgent(dir, ["finish", "--json"])).stdout);
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
    obj = parseJson((await runAgent(dir, ["finish", "--json"])).stdout);
    assertEquals(
      obj.data.failed_stage,
      null,
      "a foreign drop-in must not block finish",
    );
  });
});
