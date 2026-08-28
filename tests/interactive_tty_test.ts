/** Real-PTY proof for Discern's exported production interaction wrappers. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { z } from "@zod/zod";
import {
  INTERACTIVE_TTY_REQUEST_LABELS,
  type InteractiveTtyScenario,
  POST_INTERACTION_DIAGNOSTIC,
} from "./fixtures/interactive_tty_harness.ts";
import {
  type PtyInputPhase,
  type PtyOutputCondition,
  type PtyProcessResult,
  runPtyProcess,
} from "./fixtures/pty_process.ts";
import { repoSourceRunArgs } from "./engine_helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);
const InteractiveTtyScenarioSchema = z
  .custom<InteractiveTtyScenario>((value) =>
    typeof value === "string" && value in INTERACTIVE_TTY_REQUEST_LABELS
  );
const TerminalDimensionsSchema = z.object({
  columns: z.number(),
  rows: z.number(),
});
const InteractiveTtyResultSchema = z.object({
  scenario: InteractiveTtyScenarioSchema,
  outcome: z.enum(["value", "cancelled", "error"]),
  value: JsonValueSchema.optional(),
  error: z.object({ name: z.string(), message: z.string() }).optional(),
  terminal: z.object({
    before: z.string(),
    after: z.string(),
    beforeDescription: z.string(),
    afterDescription: z.string(),
    restored: z.boolean(),
    exactStateRestored: z.boolean(),
    initialSize: TerminalDimensionsSchema,
    resizedSize: TerminalDimensionsSchema.optional(),
    finalSize: TerminalDimensionsSchema,
  }),
});
type DecodedInteractiveTtyResult = z.output<
  typeof InteractiveTtyResultSchema
>;

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const HARNESS = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "interactive_tty_harness.ts",
);
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CSI = "\x1b[";
const CSI_SEQUENCE = /^[0-?]*[ -/]*[@-~]/u;
const CSI_SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]/gu;

interface HarnessRun {
  readonly process: PtyProcessResult;
  readonly result: DecodedInteractiveTtyResult;
}

interface HarnessRunOptions {
  readonly scenario: InteractiveTtyScenario;
  readonly input?: readonly PtyInputPhase[];
  readonly env?: Readonly<Record<string, string>>;
  readonly size?: { readonly columns: number; readonly rows: number };
  readonly resize?: {
    readonly columns: number;
    readonly rows: number;
    readonly when: PtyOutputCondition;
  };
  readonly noColor?: boolean;
  readonly canonicalEof?: boolean;
  readonly interactionStartDelayMs?: number;
  readonly timeoutMs?: number;
}

/** Encode one terminal size for the child harness protocol. */
function sizeArgument(size: { columns: number; rows: number }): string {
  return `${size.columns}x${size.rows}`;
}

/** Return the control path created whenever resize options are present. */
function requiredResizePath(path: string | undefined): string {
  if (path === undefined) {
    throw new Error("resize control path was not created");
  }
  return path;
}

/** Run one production interaction scenario inside a real pseudo-terminal. */
async function runHarness(options: HarnessRunOptions): Promise<HarnessRun> {
  const resultPath = await Deno.makeTempFile({
    prefix: "discern-interactive-result-",
    suffix: ".json",
  });
  const resizeWhenPath = options.resize === undefined
    ? undefined
    : await Deno.makeTempFile({ prefix: "discern-interactive-resize-" });
  if (resizeWhenPath !== undefined) await Deno.remove(resizeWhenPath);
  try {
    const args = repoSourceRunArgs(HARNESS, [
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
        "--resize-when",
        requiredResizePath(resizeWhenPath),
      ]),
      ...(options.canonicalEof === true ? ["--canonical-eof"] : []),
      ...(options.interactionStartDelayMs === undefined ? [] : [
        "--interaction-start-delay",
        String(options.interactionStartDelayMs),
      ]),
    ]);
    const resizePhase: PtyInputPhase | undefined = options.resize === undefined
      ? undefined
      : {
        waitFor: options.resize.when,
        steps: [{
          effect: async () => {
            await Deno.writeTextFile(
              requiredResizePath(resizeWhenPath),
              "ready\n",
            );
          },
        }],
      };
    const process = await runPtyProcess({
      command: Deno.execPath(),
      args,
      cwd: REPO_ROOT,
      ...(options.env === undefined ? {} : { env: options.env }),
      input: [
        ...(resizePhase === undefined ? [] : [resizePhase]),
        ...(options.input ?? keys(options.scenario, "\r")),
      ],
      timeoutMs: options.timeoutMs ?? 8_000,
    });
    const raw = await Deno.readTextFile(resultPath);
    assert(raw.trim() !== "", `child wrote no result:\n${process.transcript}`);
    return {
      process,
      result: decodeWith(InteractiveTtyResultSchema, raw),
    };
  } finally {
    await Deno.remove(resultPath).catch(() => undefined);
    if (resizeWhenPath !== undefined) {
      await Deno.remove(resizeWhenPath).catch(() => undefined);
    }
  }
}

/** Send one input chunk only after the child renders its authored request label. */
function keys(
  scenario: InteractiveTtyScenario,
  bytes: string,
  delayMs = 0,
): PtyInputPhase[] {
  return [{
    waitFor: INTERACTIVE_TTY_REQUEST_LABELS[scenario][0],
    steps: [{ delayMs, bytes }],
  }];
}

/** Assert process, line-mode, cursor, and final-frame restoration under the
 * package's independently detected ANSI-control capability. */
function assertRestored(
  run: HarnessRun,
  ansiControl = true,
  allowStyledCompletion = false,
): void {
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
  if (!ansiControl) {
    assertEquals(
      hiddenAt,
      -1,
      `a terminal without ANSI control must not receive cursor-hide:\n${run.process.transcript}`,
    );
    assertEquals(
      shownAt,
      -1,
      `a terminal without ANSI control must not receive cursor-show:\n${run.process.transcript}`,
    );
    assertEquals(
      run.process.transcript.includes(CSI),
      false,
      `a terminal without ANSI control must receive no CSI sequences:\n${run.process.transcript}`,
    );
    return;
  }
  assert(hiddenAt >= 0, run.process.transcript);
  assert(shownAt > hiddenAt, run.process.transcript);
  const afterRestore = run.process.transcript.slice(
    shownAt + SHOW_CURSOR.length,
  );
  if (allowStyledCompletion) {
    const controls = [...afterRestore.matchAll(CSI_SEQUENCES)].map((match) =>
      match[0]
    );
    assert(
      controls.every((control) => control.endsWith("m")),
      `only semantic styling may follow the final cursor restoration:\n${afterRestore}`,
    );
  } else {
    assertEquals(
      afterRestore.includes(CSI),
      false,
      "no redraw control may leak after the final cursor restoration",
    );
  }
}

/** Assert an out-of-band submitted value and restored terminal. */
function assertValue(
  run: HarnessRun,
  expected: unknown,
  ansiControl = true,
  allowStyledCompletion = false,
): void {
  assertEquals(run.result.outcome, "value", run.process.transcript);
  assertEquals(run.result.value, expected, run.process.transcript);
  assertRestored(run, ansiControl, allowStyledCompletion);
}

/** Remove complete CSI controls while preserving all printable transcript text. */
function stripCsiSequences(transcript: string): string {
  const [first = "", ...rest] = transcript.split(CSI);
  return first + rest.map((part) => {
    const sequence = CSI_SEQUENCE.exec(part)?.[0];
    return sequence === undefined
      ? `${CSI}${part}`
      : part.slice(sequence.length);
  }).join("");
}

realPtyTest({
  name:
    "production text wrapper carries Unicode and cursor keys through raw mode",
  contracts: ["line-discipline", "terminal-modes", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const emoji = new TextEncoder().encode("👩‍💻");
    const run = await runHarness({
      scenario: "text",
      input: [
        {
          waitFor: INTERACTIVE_TTY_REQUEST_LABELS.text[0],
          steps: [
            { bytes: "A" },
            { bytes: emoji.slice(0, 3) },
            { bytes: emoji.slice(3) },
            { bytes: "B\x1b[D\x7fé\x1b[HΩ\x1b[F!\r" },
          ],
        },
      ],
    });
    assertValue(run, "ΩAéB!");
    assert(
      run.process.transcript.startsWith(`\n${HIDE_CURSOR}`) ||
        run.process.transcript.startsWith(`\r\n${HIDE_CURSOR}`),
      `the interaction needs exactly one leading semantic boundary:\n${run.process.transcript}`,
    );
  },
});

realPtyTest({
  name:
    "production sequential form retains answers across real-PTY back-navigation",
  contracts: ["line-discipline", "terminal-modes", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const labels = INTERACTIVE_TTY_REQUEST_LABELS["sequential-form"];
    const title = "Task ingress 修复";
    const run = await runHarness({
      scenario: "sequential-form",
      input: [{
        waitFor: labels[1],
        steps: [{ bytes: "\r" }],
      }, {
        waitFor: labels[2],
        steps: [{ bytes: `${title}\r` }],
      }, {
        waitFor: labels[3],
        steps: [{ bytes: "\x15" }],
      }, {
        waitFor: labels[2],
        steps: [{ bytes: "\r" }],
      }, {
        waitFor: labels[3],
        steps: [{ bytes: "\x1b[C\r" }],
      }],
    });

    assertValue(
      run,
      {
        base: "main",
        title,
        authority: true,
      },
      true,
      true,
    );
    const plain = stripCsiSequences(run.process.transcript);
    for (const label of labels) assertStringIncludes(plain, label);
    assert(
      plain.split(labels[2]).length >= 3,
      `back-navigation must repaint the retained title step:\n${run.process.transcript}`,
    );
  },
});

realPtyTest({
  name:
    "raw Ctrl-C and canonical EOF restore the terminal with precise outcomes",
  contracts: ["line-discipline", "eof-delivery", "terminal-modes"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const [ctrlC, eof] = await Promise.all([
      runHarness({
        scenario: "cancellation",
        input: keys("cancellation", "\x03"),
      }),
      runHarness({
        scenario: "cancellation",
        canonicalEof: true,
        // The terminal transition waits for a real read boundary even when
        // parallel suite load delays interaction startup beyond old timers.
        interactionStartDelayMs: 600,
        input: [
          {
            waitFor: "[canonical-eof-ready]",
            steps: [{ bytes: "\x04" }],
          },
        ],
      }),
    ]);
    for (const cancellation of [ctrlC, eof]) {
      assertEquals(cancellation.result.outcome, "cancelled");
      assertRestored(cancellation);
    }
    assertStringIncludes(ctrlC.process.transcript, "Cancelled.");
    assertStringIncludes(eof.process.transcript, "Input ended.");
  },
});

realPtyTest({
  name: "a live narrow-to-wide resize is reflected by the production painter",
  contracts: ["resize-delivery", "control-rendering", "terminal-modes"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const run = await runHarness({
      scenario: "grouped-select",
      size: { columns: 32, rows: 10 },
      resize: {
        columns: 100,
        rows: 30,
        when: {
          description: "the complete initial narrow grouped-selection frame",
          test: (output) =>
            stripCsiSequences(output.phaseStdout).split(/\r?\n/u).some((line) =>
              line.includes("Alpha with a") &&
              !line.includes("deliberately long")
            ),
        },
      },
      interactionStartDelayMs: 600,
      input: [
        {
          waitFor: "[resize-ready]",
          steps: [{ bytes: "\x1b[B" }],
        },
        {
          waitFor: {
            description: "the complete wide grouped-selection frame",
            test: (output) =>
              stripCsiSequences(output.phaseStdout).split(/\r?\n/u).some(
                (line) =>
                  line.includes(
                    "Alpha with a deliberately long label that becomes complete after resize",
                  ),
              ),
          },
          steps: [{ bytes: "\x1b[H\r" }],
        },
      ],
    });
    assertValue(run, "alpha");
    assert(
      run.process.transcript.indexOf(
        INTERACTIVE_TTY_REQUEST_LABELS["grouped-select"][0],
      ) < run.process.transcript.indexOf("[resize-ready]"),
      `the resize must follow the first observable interaction frame:\n${run.process.transcript}`,
    );
    assertEquals(run.result.terminal.initialSize, { columns: 32, rows: 10 });
    assertEquals(run.result.terminal.resizedSize, {
      columns: 100,
      rows: 30,
    });
    const plain = stripCsiSequences(run.process.transcript);
    const lines = plain.split(/\r?\n/u);
    assert(
      lines.some((line) =>
        line.includes("Alpha with a") && !line.includes("deliberately long")
      ),
      run.process.transcript,
    );
    assert(
      lines.some((line) =>
        line.includes(
          "Alpha with a deliberately long label that becomes complete after resize",
        )
      ),
      run.process.transcript,
    );
    const visible = plain.replaceAll(
      /\s+/gu,
      " ",
    );
    assertStringIncludes(
      visible,
      INTERACTIVE_TTY_REQUEST_LABELS["grouped-select"][0],
    );
    assertStringIncludes(visible, "deliberately long label");
    assertStringIncludes(visible, "complete after resize");
  },
});
realPtyTest({
  name:
    "unexpected validator faults restore the real terminal before diagnostics",
  contracts: ["terminal-modes", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const run = await runHarness({ scenario: "error" });
    assertEquals(run.result.outcome, "error", run.process.transcript);
    assertEquals(run.result.error, {
      name: "Error",
      message: "synthetic validator fault",
    });
    assertRestored(run);
    const diagnosticAt = run.process.transcript.indexOf(
      POST_INTERACTION_DIAGNOSTIC,
    );
    assert(diagnosticAt >= 0, run.process.transcript);
    assert(
      /\r?\n$/u.test(run.process.transcript.slice(0, diagnosticAt)),
      `the next diagnostic must begin below the restored frame:\n${run.process.transcript}`,
    );
  },
});
