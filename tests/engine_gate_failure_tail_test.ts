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
import { withTempDir } from "./helpers.ts";
import {
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
  const r = await runAgentMerged(dir, argv);
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
  'main_branch = "main"',
  'gotchas_doc = "docs/g.md"',
  "",
  "[capabilities]",
  `lint = "echo LINT-BROKE; exit 7"`,
  "",
].join("\n");

/** A failing test capability — fails the test stage. */
const FAILING_TEST = [
  "[project]",
  'slug = "engine-test"',
  'main_branch = "main"',
  'gotchas_doc = "docs/g.md"',
  "",
  "[capabilities]",
  `test = "echo TEST-BROKE; exit 3"`,
  "",
].join("\n");

Deno.test("finish: a failing gate ends on the actionable recap, surviving `2>&1 | tail`", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, FAILING_CHECK);
    await gitInit(dir);
    await assertActionableFailureTail(dir, ["finish"], "finish");
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
