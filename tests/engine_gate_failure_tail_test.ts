/**
 * The shared human failure tail (renderFailureTail) across the gate verbs — finish,
 * prepare, test. The regression it pins: a real session piped `finish 2>&1 | tail -6`
 * and saw only the generic gotchas pointer; the actionable recap had scrolled past the
 * cut. All three verbs now end a failure on the structured recap plus a one-line
 * summary (the BLUF), derived from the SAME diagnostics[] the --json envelope carries,
 * so the end of the merged stream is always actionable — and prepare/test, which used
 * to print a bare "A check failed." / "Tests failed.", now match finish.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import {
  engineEnv,
  gitInit,
  runAgent,
  runAgentMerged,
  runAgentPty,
  type RunResult,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { renderFailureTail } from "../src/engine/gate/failure_tail.ts";
import { makeOut } from "../src/engine/output.ts";
import type { Diagnostic } from "../src/shared/result.ts";

const EXIT_127_TITLE = "A gate command fails with exit 127 (command not found)";
const MATCHED_TRAP_GATE_LAUNCH_BUDGET = 4;
const GATE_FAILURE_HELP_COMMAND =
  "discern docs 20-quality-gate/when-the-gate-fails";
const TEMPLATE_GOTCHAS = join(
  REAL_TEMPLATES,
  "setup",
  "skeleton",
  "docs",
  "80-development",
  "done-gate-gotchas.md",
);

/** The reproduce commands the --json envelope reports — the machine SSOT a human tail
 * must mirror. */
function reprosOf(stdout: string): string[] {
  const obj = JSON.parse(stdout.trim());
  // deno-lint-ignore no-explicit-any
  return (obj.diagnostics ?? []).map((d: any) => d.reproduce_cmd as string);
}

/** The matched gotchas hint, as carried by a failed result envelope. */
function matchedGotchasHintOf(stdout: string): string {
  const obj = JSON.parse(stdout.trim()) as { hints?: string[] };
  const hint = obj.hints?.find((text) =>
    text.includes(`This failure matches "${EXIT_127_TITLE}"`)
  );
  assert(hint !== undefined, `expected the matched gotchas hint in ${stdout}`);
  return hint;
}

/** A malformed-matcher warning carried beside the matched hint. */
function matcherWarningOf(stdout: string): string {
  const obj = JSON.parse(stdout.trim()) as { hints?: string[] };
  const warning = obj.hints?.find((text) =>
    text.includes(
      'Fix the `gotcha-match` block in the gotchas entry "Broken matcher"',
    )
  );
  assert(warning !== undefined, `expected a matcher warning in ${stdout}`);
  return warning;
}

/** The pasteable map command from the shared human failure tail. */
function gotchasMapCommand(output: string): {
  line: string;
  command: string;
} {
  const line = output.split("\n").find((candidate) =>
    candidate.includes("Read the full page with")
  );
  assert(line !== undefined, `expected a gotchas map reference in ${output}`);
  const command = /`(discern map [^`]+)`/.exec(line)?.[1];
  assert(command !== undefined, `expected a quoted map fetch in ${line}`);
  return { line, command };
}

/** The pasteable failure-guide command from the shared human failure tail. */
function failureGuideCommand(output: string): string {
  const line = output.split("\n").find((candidate) =>
    candidate.includes("Failure guide:")
  );
  assert(line !== undefined, `expected a failure-guide reference in ${output}`);
  const command = /`(discern docs [^`]+)`/.exec(line)?.[1];
  assert(command !== undefined, `expected a quoted help command in ${line}`);
  return command;
}

/** Run a failure pointer's command byte-for-byte through the user's shell. */
async function runPrintedCommand(
  dir: string,
  command: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command("sh", {
    args: ["-c", command],
    cwd: dir,
    env: await engineEnv(),
    stdout: "piped",
    stderr: "piped",
  });
  const result = await child.output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

/**
 * Assert a verb's human failure tail mirrors its --json diagnostics[] and survives a
 * `2>&1 | tail`: every reproduce command appears, the LAST line is the BLUF, and a
 * reproduce command lands within the last six lines (the exact screenshot scenario).
 */
async function assertActionableFailureTail(
  dir: string,
  argv: string[],
  verb: string,
): Promise<string> {
  // --json is the machine SSOT for what failed and how to reproduce it.
  const j = await runAgent(dir, [...argv, "--json"]);
  assertEquals(j.code, 1, j.output);
  const repros = reprosOf(j.stdout);
  assert(repros.length > 0, `${verb}: fixture must produce a diagnostic`);

  // The real time-interleaved stream an agent captures with `<verb> 2>&1 | …`.
  // For `done` the tree is unchanged since the --json run above, so the
  // output-parity rerun carries the attestation the rerun precondition requires.
  const humanArgv = argv[0] === "done" ? [...argv, "--confirmed"] : argv;
  const r = await runAgentMerged(dir, humanArgv);
  assertEquals(r.code, 1, r.output);
  const lines = r.stdout.split("\n").filter((l) => l.trim() !== "");

  // 1. Stranger identity — both the failure headline and the tail-safe BLUF name
  //    the full discern command, and the shared tail carries one stable help route.
  const failureIdentity = `discern ${verb} failed`;
  assertEquals(
    lines.filter((line) => line.includes(failureIdentity)).length,
    2,
    `${verb}: headline and BLUF must identify discern as the speaker`,
  );
  assertEquals(
    lines.filter((line) => line.includes(GATE_FAILURE_HELP_COMMAND)).length,
    1,
    `${verb}: shared tail must carry one stable failure-guide command`,
  );
  const helpCommand = failureGuideCommand(r.stdout);
  assertEquals(helpCommand, GATE_FAILURE_HELP_COMMAND);

  // 2. Parity — every reproduce command in the envelope is surfaced to the human.
  for (const cmd of repros) {
    assertStringIncludes(
      r.stdout,
      cmd,
      `${verb}: human tail must surface ${cmd}`,
    );
  }

  // 3. tail -1 safety — the LAST line is the BLUF: it names the command and carries a
  //    reproduce command.
  const last = lines.at(-1) ?? "";
  assertStringIncludes(
    last,
    failureIdentity,
    `${verb}: last line must be the BLUF`,
  );
  assert(
    repros.some((c) => last.includes(c)),
    `${verb}: the BLUF must carry a reproduce command; got: ${last}`,
  );

  // 4. tail -6 safety — the screenshot scenario: the last six lines must reach an
  //    actionable reproduce command, not bottom out in the generic gotchas pointer.
  const tail6 = lines.slice(-6);
  assert(
    repros.some((c) => tail6.some((l) => l.includes(c))),
    `${verb}: last 6 lines must include a reproduce command.\n${
      tail6.join("\n")
    }`,
  );
  return helpCommand;
}

/** A failing check capability (lint) — fails finish's check/test stage and prepare's
 * check stage, so both produce a diagnostic. */
const FAILING_CHECK = [
  "[project]",
  'slug = "engine-test"',
  'gotchas_doc = "docs/g.md"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  `lint = "echo LINT-BROKE; exit 7"`,
  "",
].join("\n");

/** A failing test capability — fails the test stage. */
const FAILING_TEST = [
  "[project]",
  'slug = "engine-test"',
  'gotchas_doc = "docs/g.md"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  `test = "echo TEST-BROKE; exit 3"`,
  "",
].join("\n");

Deno.test("done: a failing gate ends on the actionable recap, surviving `2>&1 | tail`", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, FAILING_CHECK);
    await gitInit(dir);
    const helpCommand = await assertActionableFailureTail(
      dir,
      ["done"],
      "done",
    );
    const help = await runPrintedCommand(dir, helpCommand);
    assertEquals(help.code, 0, help.stderr);
    assertStringIncludes(help.stdout, "When the Gate fails");
  });
});

Deno.test("prepare: a failing check ends on the actionable recap, like finish (shared tail)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, FAILING_CHECK);
    await gitInit(dir);
    await assertActionableFailureTail(dir, ["prepare"], "prepare");
  });
});

Deno.test("test: a failing test capability ends on the actionable recap, like finish (shared tail)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, FAILING_TEST);
    await gitInit(dir);
    await assertActionableFailureTail(dir, ["test"], "test");
  });
});

Deno.test("gate failure: a seeded matched trap reaches every result surface from one black-box fixture", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const mapDir = "knowledge";
    const target = "91-unrelated/operator notes";
    const doc = `${mapDir}/${target}.md`;
    const body = [
      (await Deno.readTextFile(TEMPLATE_GOTCHAS)).trimEnd(),
      "",
      "### Broken matcher",
      "",
      "Prose.",
      "",
      "```gotcha-match",
      'stage = "timeout"',
      "```",
      "",
    ].join("\n");
    await Deno.mkdir(join(dir, mapDir, "91-unrelated"), {
      recursive: true,
    });
    await Deno.writeTextFile(join(dir, doc), body);
    // The template's intro links to its real skeleton siblings; lay them so
    // the map-integrity preflight (which precedes the failing jobs this test
    // is about) has nothing to say.
    for (const sibling of ["getting-started.md", "code-conventions.md"]) {
      await Deno.writeTextFile(
        join(dir, mapDir, "91-unrelated", sibling),
        "# Placeholder\n",
      );
    }
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        `gotchas_doc = "${doc}"`,
        "",
        "[map]",
        `dir = "${mapDir}/"`,
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "definitely-missing-command-x"',
        'test = "definitely-missing-command-y"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    let gateLaunches = 0;
    const runGate = async (args: string[]): Promise<RunResult> => {
      gateLaunches++;
      return await runAgent(dir, args);
    };

    // JSON is the same result core MCP returns. Every gate verb that prints the
    // shared human tail must carry the same matched hint and warning.
    const doneJson = await runGate(["done", "--json"]);
    assertEquals(doneJson.code, 1, doneJson.output);
    const expectedCommand = `discern map '${target}' --json`;
    const envelopeHint = matchedGotchasHintOf(doneJson.stdout);
    const envelopeWarning = matcherWarningOf(doneJson.stdout);
    assertStringIncludes(envelopeHint, "[repository].ensure");
    assertStringIncludes(envelopeHint, `\`${expectedCommand}\``);
    for (const verb of ["prepare", "test"]) {
      const result = await runGate([verb, "--json"]);
      assertEquals(result.code, 1, result.output);
      assertEquals(
        matchedGotchasHintOf(result.stdout),
        envelopeHint,
        `${verb}'s matched trap must match done's`,
      );
      assertEquals(
        matcherWarningOf(result.stdout),
        envelopeWarning,
        `${verb}'s matcher warning must match done's`,
      );
    }

    // `done` now needs an attestation because the JSON run judged this exact
    // tree red. Its human failure tail prints the same fired texts verbatim.
    const human = await runGate(["done", "--confirmed"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stderr, envelopeHint);
    assertStringIncludes(human.stderr, envelopeWarning);
    const printed = gotchasMapCommand(human.stderr);
    assertEquals(printed.command, expectedCommand);
    assertEquals(
      gateLaunches,
      MATCHED_TRAP_GATE_LAUNCH_BUDGET,
      "the matched-trap surface proof must reuse these gate runs instead of " +
        "adding per-variant CLI launches",
    );

    // The adversarial future sibling: an unrelated map root and a nested page
    // containing a space. The command must survive shell parsing unchanged and
    // return the structured page, using the map verb's canonical target.
    const fetched = await runPrintedCommand(dir, printed.command);
    assertEquals(fetched.code, 0, fetched.stderr);
    const result = JSON.parse(fetched.stdout);
    assertEquals(result.ok, true);
    assertEquals(result.data.doc.path, doc);
    assertEquals(result.data.doc.content, body);
  });
});

// The marker only the command's OUTPUT contains: the command text (echoed by the
// job table, the reproduce lines, and the BLUF) reads `BROKE-''DETAIL`, which the
// shell collapses to `BROKE-DETAIL` when it runs — so counting the collapsed form
// counts real output, never command echoes.
const OUTPUT_MARKER = "BROKE-DETAIL";
const OUTPUT_COMMAND = "echo BROKE-''DETAIL; exit 7";

/** Occurrences of `needle` in `haystack`. */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The withheld-output class guard, across every gate verb's human TTY surface: a
 * failed command's captured output must reach the terminal EXACTLY once. `done` and
 * `prepare` quiet the runner behind the live table, so their failure tail must carry
 * the output (zero = the regression where only "failed (exit N)" reached a human);
 * `test` narrates through the runner, so its tail must NOT repeat it (two = the
 * double-print regression).
 */
Deno.test("gate TTY: every verb surfaces a failed command's output exactly once", async () => {
  for (
    const { verb, job } of [
      { verb: "done", job: `lint = "${OUTPUT_COMMAND}"` },
      { verb: "prepare", job: `lint = "${OUTPUT_COMMAND}"` },
      { verb: "test", job: `test = "${OUTPUT_COMMAND}"` },
    ]
  ) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        [
          "[project]",
          'slug = "engine-test"',
          'gotchas_doc = "docs/g.md"',
          "",
          "[repository]",
          'trunk = "main"',
          "",
          "[jobs]",
          job,
          "",
        ].join("\n"),
      );
      await gitInit(dir);
      const r = await runAgentPty(dir, [verb], {
        env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
        timeoutMs: 20_000,
      });
      assertEquals(r.code, 1, `${verb}: ${r.output}`);
      assertEquals(
        countOf(r.output, OUTPUT_MARKER),
        1,
        `${verb}: a failed command's output must reach the terminal exactly ` +
          `once.\n${r.output}`,
      );
    });
  }
});

Deno.test("failure tail: a quieted run leads with the withheld output and the full-capture path", () => {
  const chunks: string[] = [];
  const out = makeOut(false, {
    stdout: (text) => chunks.push(text),
    stderr: () => {},
  });
  const withOutput: Diagnostic = {
    tool: "prose",
    severity: "error",
    message: "prose failed (exit 1)",
    reproduce_cmd: "run prose",
    output: "docs/a.md:3: heading too wordy",
    truncated: true,
    output_path: "/tmp/discern-diag-full.log",
  };
  const withoutOutput: Diagnostic = {
    tool: "quiet-job",
    severity: "error",
    message: "quiet-job failed (exit 2)",
    reproduce_cmd: "run quiet-job",
  };
  renderFailureTail(out, {
    verb: "done",
    headline: "The gate failed.",
    diagnostics: [withOutput, withoutOutput],
    gotchas: undefined,
    outputWithheld: true,
  });
  const text = chunks.join("");
  assertStringIncludes(text, "── prose ─ output");
  assertStringIncludes(text, "docs/a.md:3: heading too wordy");
  assertStringIncludes(text, "full output: /tmp/discern-diag-full.log");
  assertEquals(
    text.includes("── quiet-job ─ output"),
    false,
    "a diagnostic with no captured output must not open an output section",
  );
  assert(
    text.indexOf("── prose ─ output") < text.indexOf("Failures (2)"),
    "withheld output must lead the tail, keeping the recap and BLUF last",
  );
});

Deno.test("failure tail: a narrated run keeps the tail output-free", () => {
  const chunks: string[] = [];
  const out = makeOut(false, {
    stdout: (text) => chunks.push(text),
    stderr: () => {},
  });
  renderFailureTail(out, {
    verb: "test",
    headline: "Tests failed.",
    diagnostics: [{
      tool: "test",
      severity: "error",
      message: "test failed (exit 3)",
      reproduce_cmd: "run tests",
      output: "1 test failed: orbit_test",
    }],
    gotchas: undefined,
    outputWithheld: false,
  });
  const text = chunks.join("");
  assertEquals(
    text.includes("orbit_test"),
    false,
    "the runner already narrated this output; the tail must not repeat it",
  );
});

Deno.test("gate failure: a gotchas doc outside the map keeps the path pointer", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const doc = "notes/gate-gotchas.md";
    await Deno.mkdir(join(dir, "notes"), { recursive: true });
    await Deno.writeTextFile(join(dir, doc), "# Gate notes\n");
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        `gotchas_doc = "${doc}"`,
        "",
        "[map]",
        'dir = "knowledge/"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "exit 7"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const failure = await runAgent(dir, ["done"]);
    assertEquals(failure.code, 1, failure.output);
    const line = failure.stderr.split("\n").find((candidate) =>
      candidate.includes("known gate failures and fixes")
    );
    assert(line !== undefined, failure.stderr);
    assertStringIncludes(line, join(dir, doc));
    assert(
      !line.includes("discern map"),
      `an out-of-map doc must keep the path fallback: ${line}`,
    );
  });
});
