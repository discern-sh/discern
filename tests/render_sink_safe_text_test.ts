import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsi } from "discern-design-system/cli";
import { makeOut, outSink } from "../src/engine/output.ts";
import { Logger, loggerSink } from "../src/lib/log.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import {
  type EnginePlan,
  renderPlan,
  type RenderSink,
  renderStepResults,
  type StepResult,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import { fakeEnv } from "./helpers.ts";

const HOSTILE = "repo\x1b[31m\nbranch\x00\u0085\u202E";
const SAFE = "repo␛[31m␊branch␀<U+0085><U+202E>";

/** A plan whose every human fact is operator-, config-, or repository-derived. */
function hostilePlan(): EnginePlan {
  return {
    title: HOSTILE,
    details: [HOSTILE],
    steps: [{
      kind: "job",
      label: verbatimStepLabel(HOSTILE),
      disposition: "run",
      note: HOSTILE,
      group: HOSTILE,
    }],
  };
}

/** An apply result exercises the same facts plus captured-output metadata. */
function hostileResults(): StepResult[] {
  return [{
    step: hostilePlan().steps[0] ?? {
      kind: "job",
      label: verbatimStepLabel(HOSTILE),
      disposition: "run",
    },
    outcome: "ok",
    outputPath: HOSTILE,
  }];
}

/** Drive both shared renderers through one concrete sink. */
function renderHostileViews(sink: RenderSink): void {
  renderPlan(sink, hostilePlan());
  renderStepResults(sink, {
    title: HOSTILE,
    details: [HOSTILE],
    steps: hostileResults(),
  });
}

/** Package SGR may differ, but every underlying fact has one inert transcript. */
function assertSafeTranscript(transcript: string, color: boolean): void {
  const plain = stripAnsi(transcript);
  assertStringIncludes(plain, SAFE);
  assertEquals(plain.includes(HOSTILE), false);
  for (const control of ["\x00", "\u0085", "\u202E"]) {
    assertEquals(plain.includes(control), false);
  }
  assertEquals(transcript.includes("\x1b[31m"), false);
  assertEquals(transcript.includes("\x1b["), color);
}

const COLOR_TERMINAL = resolveTerminalContext({
  noColor: false,
  env: fakeEnv({
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "en_GB.UTF-8",
  }),
  isTerminal: () => true,
  consoleSize: () => ({ columns: 80, rows: 24 }),
});

Deno.test("Out shared plan and result facts are inert before package styling", () => {
  for (const color of [true, false]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const out = makeOut(color, {
      terminal: COLOR_TERMINAL,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    renderHostileViews(outSink(out));
    assertEquals(stderr, []);
    assertSafeTranscript(stdout.join(""), color);
  }
});

Deno.test("Logger shared plan and result facts are inert before package styling", () => {
  for (const noColor of [false, true]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalOut = console.log;
    const originalErr = console.error;
    console.log = (...args: unknown[]) =>
      stdout.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) =>
      stderr.push(args.map(String).join(" "));
    try {
      renderHostileViews(loggerSink(
        new Logger({
          json: false,
          noColor,
          humanStream: "stdout",
          terminal: COLOR_TERMINAL,
        }),
      ));
    } finally {
      console.log = originalOut;
      console.error = originalErr;
    }
    assertEquals(stderr, []);
    assert(stdout.length > 0);
    assertSafeTranscript(stdout.join("\n"), !noColor);
  }
});
