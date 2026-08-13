/** Real-PTY proof for Discern's exported production prompt wrappers. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  type InteractiveTtyResult,
  type InteractiveTtyScenario,
  POST_PROMPT_DIAGNOSTIC,
} from "./fixtures/interactive_tty_harness.ts";
import {
  type PtyInputStep,
  type PtyProcessResult,
  runPtyProcess,
} from "./fixtures/pty_process.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const DENO_JSON = join(REPO_ROOT, "deno.json");
const HARNESS = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "interactive_tty_harness.ts",
);
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const SGR = /\x1b\[[0-9;]*m/u;
const READY_DELAY_MS = 350;

interface HarnessRun {
  readonly process: PtyProcessResult;
  readonly result: InteractiveTtyResult;
}

interface HarnessRunOptions {
  readonly scenario: InteractiveTtyScenario;
  readonly input?: readonly PtyInputStep[];
  readonly env?: Readonly<Record<string, string>>;
  readonly size?: { readonly columns: number; readonly rows: number };
  readonly resize?: {
    readonly columns: number;
    readonly rows: number;
    readonly afterMs: number;
  };
  readonly noColor?: boolean;
  readonly canonicalEofAfterMs?: number;
  readonly timeoutMs?: number;
}

function sizeArgument(size: { columns: number; rows: number }): string {
  return `${size.columns}x${size.rows}`;
}

async function runHarness(options: HarnessRunOptions): Promise<HarnessRun> {
  const resultPath = await Deno.makeTempFile({
    prefix: "discern-interactive-result-",
    suffix: ".json",
  });
  try {
    const args = [
      "run",
      "--no-check",
      "--config",
      DENO_JSON,
      "-A",
      HARNESS,
      "--scenario",
      options.scenario,
      "--result",
      resultPath,
      ...(options.noColor === true ? ["--no-color"] : []),
      ...(options.size === undefined
        ? []
        : ["--size", sizeArgument(options.size)]),
      ...(options.resize === undefined ? [] : [
        "--resize",
        sizeArgument(options.resize),
        "--resize-after",
        String(options.resize.afterMs),
      ]),
      ...(options.canonicalEofAfterMs === undefined
        ? []
        : ["--canonical-eof-after", String(options.canonicalEofAfterMs)]),
    ];
    const process = await runPtyProcess({
      command: Deno.execPath(),
      args,
      cwd: REPO_ROOT,
      ...(options.env === undefined ? {} : { env: options.env }),
      input: options.input ?? [{ delayMs: READY_DELAY_MS, bytes: "\r" }],
      timeoutMs: options.timeoutMs ?? 8_000,
    });
    const raw = await Deno.readTextFile(resultPath);
    assert(raw.trim() !== "", `child wrote no result:\n${process.transcript}`);
    return {
      process,
      result: JSON.parse(raw) as InteractiveTtyResult,
    };
  } finally {
    await Deno.remove(resultPath).catch(() => undefined);
  }
}

function keys(bytes: string, delayMs = READY_DELAY_MS): PtyInputStep[] {
  return [{ delayMs, bytes }];
}

function assertRestored(run: HarnessRun): void {
  assertEquals(run.process.code, 0, run.process.transcript);
  assertEquals(
    run.result.terminal.restored,
    true,
    `${
      JSON.stringify(run.result.terminal, null, 2)
    }\n${run.process.transcript}`,
  );
  const hiddenAt = run.process.transcript.lastIndexOf(HIDE_CURSOR);
  const shownAt = run.process.transcript.lastIndexOf(SHOW_CURSOR);
  assert(hiddenAt >= 0, run.process.transcript);
  assert(shownAt > hiddenAt, run.process.transcript);
  assertEquals(
    run.process.transcript.slice(shownAt + SHOW_CURSOR.length).includes(
      "\x1b[",
    ),
    false,
    "no redraw control may leak after the final cursor restoration",
  );
}

function assertValue(run: HarnessRun, expected: unknown): void {
  assertEquals(run.result.outcome, "value", run.process.transcript);
  assertEquals(run.result.value, expected, run.process.transcript);
  assertRestored(run);
}

Deno.test({
  name: "production text wrapper edits Unicode graphemes across partial chunks",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const emoji = new TextEncoder().encode("👩‍💻");
    const run = await runHarness({
      scenario: "text",
      input: [
        { delayMs: READY_DELAY_MS, bytes: "A" },
        { delayMs: 5, bytes: emoji.slice(0, 3) },
        { delayMs: 5, bytes: emoji.slice(3) },
        { delayMs: 5, bytes: "B" },
        { delayMs: 5, bytes: "\x1b" },
        { delayMs: 5, bytes: "[" },
        { delayMs: 5, bytes: "D" },
        { delayMs: 5, bytes: "\x7f" },
        { delayMs: 5, bytes: "é" },
        { delayMs: 5, bytes: "\x1b[HΩ\x1b[F!\r" },
      ],
    });
    assertValue(run, "ΩAéB!");
    assert(
      /^\r?\n\x1b\[\?25l/u.test(run.process.transcript),
      `the prompt needs exactly one leading semantic boundary:\n${run.process.transcript}`,
    );
  },
});

Deno.test({
  name: "production wrappers preserve text, confirmation, and choice defaults",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const [text, confirmation, selection] = await Promise.all([
      runHarness({ scenario: "text-default" }),
      runHarness({ scenario: "confirm-default-no" }),
      runHarness({ scenario: "select-default" }),
    ]);
    assertValue(text, "remembered-value");
    assertValue(confirmation, false);
    assertValue(selection, "beta");
  },
});

Deno.test({
  name: "select honors arrow, Vim, control, Home, and End navigation",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const cases: readonly {
      readonly name: string;
      readonly scenario: InteractiveTtyScenario;
      readonly input: string;
      readonly expected: string;
    }[] = [
      {
        name: "arrow up/down",
        scenario: "select",
        input: "\x1b[B\x1b[A\x1b[B\r",
        expected: "beta",
      },
      {
        name: "Vim j/k",
        scenario: "select",
        input: "jkj\r",
        expected: "beta",
      },
      {
        name: "Vim h/l",
        scenario: "select",
        input: "lhl\r",
        expected: "beta",
      },
      {
        name: "control n/p",
        scenario: "select",
        input: "\x0e\x10\x0e\r",
        expected: "beta",
      },
      {
        name: "control f/b",
        scenario: "select",
        input: "\x06\x02\x06\r",
        expected: "beta",
      },
      {
        name: "Home",
        scenario: "select-default",
        input: "\x1b[H\r",
        expected: "alpha",
      },
      {
        name: "End",
        scenario: "select-default",
        input: "\x1b[F\r",
        expected: "omega",
      },
    ];
    await Promise.all(cases.map(async (testCase) => {
      const run = await runHarness({
        scenario: testCase.scenario,
        input: keys(testCase.input),
      });
      assertValue(run, testCase.expected);
    }));
  },
});

Deno.test({
  name:
    "grouped select keeps headings, disabled values, stable ids, and scrolling",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const [duplicate, scrolled, search] = await Promise.all([
      runHarness({
        scenario: "grouped-select",
        input: keys("\x1b[B\r"),
      }),
      runHarness({
        scenario: "grouped-select",
        input: keys("\x1b[B\x1b[B\x1b[B\x1b[B\r"),
      }),
      runHarness({
        scenario: "search",
        input: keys("beta\x1b[B\r"),
      }),
    ]);
    assertValue(duplicate, "beta");
    assertValue(scrolled, "quit");
    assertValue(search, "beta");
    for (const heading of ["Primary", "Secondary", "Navigation"]) {
      assertStringIncludes(scrolled.process.transcript, heading);
    }
    assertStringIncludes(duplicate.process.transcript, "Duplicate label");
    assertStringIncludes(search.process.transcript, "Documents");
    assertStringIncludes(search.process.transcript, "Beta guide");
  },
});

Deno.test({
  name:
    "multiselect preserves defaults, validates minimums, and toggles enabled values",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const [toggled, defaults] = await Promise.all([
      runHarness({
        scenario: "multiselect",
        input: keys("\r\x01\r"),
      }),
      runHarness({ scenario: "multiselect-default" }),
    ]);
    assertValue(toggled, ["alpha", "gamma", "delta"]);
    assertValue(defaults, ["alpha", "gamma"]);
    assertStringIncludes(
      toggled.process.transcript,
      "Select at least 2 options.",
    );
    assertStringIncludes(toggled.process.transcript, "Beta disabled");
  },
});

Deno.test({
  name: "validation, Ctrl-C, EOF, and unavailable back have precise outcomes",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const [validation, ctrlC, back, eof] = await Promise.all([
      runHarness({
        scenario: "validation",
        input: keys("bad\r\x7f\x7f\x7fvalid\r"),
      }),
      runHarness({ scenario: "cancellation", input: keys("\x03") }),
      runHarness({ scenario: "cancellation", input: keys("\x15\x03") }),
      runHarness({
        scenario: "cancellation",
        canonicalEofAfterMs: 180,
        input: keys("\x04", 450),
      }),
    ]);
    assertValue(validation, "valid");
    assertStringIncludes(validation.process.transcript, "Enter valid.");
    for (const cancellation of [ctrlC, back, eof]) {
      assertEquals(cancellation.result.outcome, "cancelled");
      assertRestored(cancellation);
    }
    assertStringIncludes(ctrlC.process.transcript, "Cancelled.");
    assertStringIncludes(eof.process.transcript, "Input ended.");
    assertStringIncludes(
      back.process.transcript,
      "There is no previous form step.",
    );
  },
});

Deno.test({
  name: "a live narrow-to-wide resize is reflected by the production painter",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const run = await runHarness({
      scenario: "grouped-select",
      size: { columns: 32, rows: 10 },
      resize: { columns: 100, rows: 30, afterMs: 180 },
      input: keys("\x04\r", 450),
    });
    assertValue(run, "alpha");
    assertEquals(run.result.terminal.initialSize, { columns: 32, rows: 10 });
    assertEquals(run.result.terminal.resizedSize, {
      columns: 100,
      rows: 30,
    });
    assertStringIncludes(run.process.transcript, "…");
    const visible = run.process.transcript.replaceAll(
      /\x1b\[[0-?]*[ -/]*[@-~]/gu,
      "",
    ).replaceAll(/\s+/gu, " ");
    assertStringIncludes(visible, "Choose from semantic groups [active]");
    assertStringIncludes(visible, "Alpha with a deliberately long label");
    assertStringIncludes(visible, "that becomes complete after resize");
  },
});

Deno.test({
  name:
    "capability matrix degrades truecolour, 256, 16, no-colour, dumb, and ASCII",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const [truecolor, ansi256, ansi16, noColor, dumb, ascii, flag] =
      await Promise
        .all([
          runHarness({
            scenario: "confirm-default-no",
            env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
          }),
          runHarness({
            scenario: "confirm-default-no",
            env: { TERM: "xterm-256color", COLORTERM: "" },
          }),
          runHarness({
            scenario: "confirm-default-no",
            env: { TERM: "xterm", COLORTERM: "" },
          }),
          runHarness({
            scenario: "confirm-default-no",
            env: {
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
              NO_COLOR: "1",
            },
          }),
          runHarness({
            scenario: "confirm-default-no",
            env: { TERM: "dumb", COLORTERM: "" },
          }),
          runHarness({
            scenario: "confirm-default-no",
            env: { TERM: "xterm", LC_ALL: "C", LANG: "C", NO_COLOR: "1" },
          }),
          runHarness({
            scenario: "confirm-default-no",
            noColor: true,
            env: { TERM: "xterm-256color", COLORTERM: "truecolor" },
          }),
        ]);
    for (
      const run of [truecolor, ansi256, ansi16, noColor, dumb, ascii, flag]
    ) {
      assertValue(run, false);
    }
    assert(/\x1b\[[0-9;]*38;2;/u.test(truecolor.process.transcript));
    assert(/\x1b\[[0-9;]*38;5;/u.test(ansi256.process.transcript));
    assert(SGR.test(ansi16.process.transcript));
    assertEquals(/38;(?:2|5);/u.test(ansi16.process.transcript), false);
    for (const run of [noColor, dumb, ascii, flag]) {
      assertEquals(
        SGR.test(run.process.transcript),
        false,
        run.process.transcript,
      );
    }
    assertEquals(/[^\x00-\x7f]/u.test(ascii.process.transcript), false);
  },
});

Deno.test({
  name:
    "unexpected validator faults restore the real terminal before diagnostics",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const run = await runHarness({ scenario: "error" });
    assertEquals(run.result.outcome, "error", run.process.transcript);
    assertEquals(run.result.error, {
      name: "Error",
      message: "synthetic validator fault",
    });
    assertRestored(run);
    const diagnosticAt = run.process.transcript.indexOf(POST_PROMPT_DIAGNOSTIC);
    assert(diagnosticAt >= 0, run.process.transcript);
    assert(
      /\r?\n$/u.test(run.process.transcript.slice(0, diagnosticAt)),
      `the next diagnostic must begin below the restored frame:\n${run.process.transcript}`,
    );
  },
});
