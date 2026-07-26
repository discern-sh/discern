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
import { withTempDir } from "./helpers.ts";
import {
  engineEnv,
  gitInit,
  runAgent,
  runAgentMerged,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** The reproduce commands the --json envelope reports — the machine SSOT a human tail
 * must mirror. */
function reprosOf(stdout: string): string[] {
  const obj = JSON.parse(stdout.trim());
  // deno-lint-ignore no-explicit-any
  return (obj.diagnostics ?? []).map((d: any) => d.reproduce_cmd as string);
}

/** The registered gotchas hint, as carried by a failed result envelope. */
function gotchasHintOf(stdout: string): string {
  const obj = JSON.parse(stdout.trim()) as { hints?: string[] };
  const hint = obj.hints?.find((text) =>
    text.includes("known gate failures and their fixes")
  );
  assert(hint !== undefined, `expected a gotchas hint in ${stdout}`);
  return hint;
}

/** The pasteable map command from the shared human failure pointer. */
function gotchasMapCommand(output: string): {
  line: string;
  command: string;
} {
  const line = output.split("\n").find((candidate) =>
    candidate.includes("known gate failures and their fixes")
  );
  assert(line !== undefined, `expected a gotchas pointer in ${output}`);
  const command = /`(discern map [^`]+)`/.exec(line)?.[1];
  assert(command !== undefined, `expected a quoted map fetch in ${line}`);
  return { line, command };
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
): Promise<void> {
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

  // 1. Parity — every reproduce command in the envelope is surfaced to the human.
  for (const cmd of repros) {
    assertStringIncludes(
      r.stdout,
      cmd,
      `${verb}: human tail must surface ${cmd}`,
    );
  }

  // 2. tail -1 safety — the LAST line is the BLUF: it names the verb and carries a
  //    reproduce command.
  const last = lines.at(-1) ?? "";
  assertStringIncludes(
    last,
    `${verb} failed`,
    `${verb}: last line must be the BLUF`,
  );
  assert(
    repros.some((c) => last.includes(c)),
    `${verb}: the BLUF must carry a reproduce command; got: ${last}`,
  );

  // 3. tail -6 safety — the screenshot scenario: the last six lines must reach an
  //    actionable reproduce command, not bottom out in the generic gotchas pointer.
  const tail6 = lines.slice(-6);
  assert(
    repros.some((c) => tail6.some((l) => l.includes(c))),
    `${verb}: last 6 lines must include a reproduce command.\n${
      tail6.join("\n")
    }`,
  );
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
    await assertActionableFailureTail(dir, ["done"], "done");
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

Deno.test("gate failure: an in-map gotchas pointer prints the canonical fetch and every result surface agrees", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const mapDir = "knowledge";
    const target = "91-unrelated/operator notes";
    const doc = `${mapDir}/${target}.md`;
    const body = "# Operator notes\n\nFresh-name gotchas body.\n";
    await Deno.mkdir(join(dir, mapDir, "91-unrelated"), {
      recursive: true,
    });
    await Deno.writeTextFile(join(dir, doc), body);
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
        'lint = "exit 7"',
        'test = "exit 9"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // JSON is the same result core MCP returns. Every gate verb that prints the
    // shared human pointer must carry the same hint on its structured surface.
    const doneJson = await runAgent(dir, ["done", "--json"]);
    assertEquals(doneJson.code, 1, doneJson.output);
    const expectedCommand = `discern map '${target}' --json`;
    const envelopeHint = gotchasHintOf(doneJson.stdout);
    assertStringIncludes(envelopeHint, `\`${expectedCommand}\``);
    for (const verb of ["prepare", "test"]) {
      const result = await runAgent(dir, [verb, "--json"]);
      assertEquals(result.code, 1, result.output);
      assertEquals(
        gotchasHintOf(result.stdout),
        envelopeHint,
        `${verb}'s structured failure pointer must match done's`,
      );
    }

    // `done` now needs an attestation because the JSON run judged this exact
    // tree red. Its human failure tail must print the envelope hint verbatim.
    const human = await runAgent(dir, ["done", "--confirmed"]);
    assertEquals(human.code, 1, human.output);
    const printed = gotchasMapCommand(human.stderr);
    assertEquals(printed.command, expectedCommand);
    assertStringIncludes(printed.line, envelopeHint);

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
      candidate.includes("known gate failures and their fixes")
    );
    assert(line !== undefined, failure.stderr);
    assertStringIncludes(line, join(dir, doc));
    assert(
      !line.includes("discern map"),
      `an out-of-map doc must keep the path fallback: ${line}`,
    );
  });
});
