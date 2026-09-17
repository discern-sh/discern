/**
 * Black-box coverage for `done`'s human presentation boundary. A real
 * pseudo-terminal gets the live compact table and proof panel; a pipe keeps
 * the stored Markdown page. Both drive the same result-producing engine.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  gitInit,
  runAgent,
  runAgentPty,
  runAgentPtyJourney,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { refreshScaffold } from "./engine_done_fixture.ts";
import { assertTerminalTextIncludes, fakeEnv, withTempDir } from "./helpers.ts";
import { ptyOutputContains } from "./fixtures/pty_process.ts";
import {
  finishResult,
  renderGateStageGapNote,
} from "../src/engine/gate/finish.ts";
import {
  resolveTerminalContext,
  terminalContextWithColor,
} from "../src/lib/terminal.ts";
import { stripAnsi } from "discern-design-system/cli";
import { CAPTURE_CAP } from "../src/shared/result.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";
import { shellBarrier } from "./shell_barrier.ts";

const CSI = `${String.fromCharCode(27)}[`;
const REPAINT = `${CSI}1G`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "u");

const CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "agents = []",
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[instructions]",
  "sources = []",
  "",
  "[jobs]",
  'format = "true"',
  "",
].join("\n");

/** Apply one job command and an explicit static transcript policy. */
function liveOutputConfig(command: string, stream: boolean): string {
  return `${
    CONFIG.replace('format = "true"', `format = ${JSON.stringify(command)}`)
  }\n[gate]\nstream_output = ${stream}\n`;
}

/** The stable package summary left immediately before cursor restoration. */
function stableLiveSummary(stdout: string): string {
  const restored = stdout.lastIndexOf(SHOW_CURSOR);
  const repainted = stdout.lastIndexOf(REPAINT, restored);
  assert(repainted >= 0 && restored > repainted, stdout);
  return stripAnsi(stdout.slice(repainted, restored)).replaceAll(/\s+/gu, " ")
    .trim();
}

Deno.test("an in-process full gate must declare its output surface", () => {
  const futureComposite = (): void => {
    // @ts-expect-error — an unrelated future caller must choose human or quiet
    void finishResult("/synthetic/orbit");
  };
  assertEquals(typeof futureComposite, "function");
});

Deno.test("the partially wired gate note preserves package SGR only in color mode", () => {
  const colorTerminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 80, rows: 24 }),
  });
  const colored = renderGateStageGapNote(2, 3, colorTerminal);
  const plain = renderGateStageGapNote(
    2,
    3,
    terminalContextWithColor(colorTerminal, false),
  );

  assert(SGR.test(colored), colored);
  assertEquals(stripAnsi(colored), plain);
  assertEquals(SGR.test(plain), false);
  assertStringIncludes(
    plain,
    "note: 2 of 3 gate stages have no command yet.",
  );
});

realPtyTest({
  name: "done updates partial lines in one live terminal frame",
  contracts: ["control-rendering", "terminal-modes", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (base) => {
      using barrier = await shellBarrier(join(base, "acknowledgement.fifo"));
      const dir = join(base, "project");
      await Deno.mkdir(dir);
      await scaffoldEngine(dir, { agents: [] });
      await writeConfig(
        dir,
        liveOutputConfig(
          `printf 'phase-one\\r'; ${barrier.wait}; printf 'phase-two\\r'; ` +
            `${barrier.wait}; printf 'tail-complete\\n'; ` +
            `printf 'tail-second\\n'; ${barrier.wait}`,
          false,
        ),
      );
      await gitInit(dir);
      await refreshScaffold(dir);

      const result = await runAgentPtyJourney(dir, ["done"], {
        geometry: { columns: 80, rows: 18 },
        env: { NO_COLOR: "1", CI: "false" },
        input: [
          { waitFor: "│ phase-one", steps: [{ effect: barrier.release }] },
          { waitFor: "│ phase-two", steps: [{ effect: barrier.release }] },
          {
            waitFor: ["tail-complete", "tail-second"],
            capture: {
              name: "active-tail",
              when: ptyOutputContains(["tail-complete", "tail-second"]),
            },
            steps: [{ effect: barrier.release }],
          },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      const active = result.keyframes["active-tail"] ?? "";
      assertStringIncludes(active, HIDE_CURSOR);
      assertStringIncludes(active, REPAINT);
      assertTerminalTextIncludes(active, "format started");
      assertTerminalTextIncludes(active, "phase-one");
      assertTerminalTextIncludes(active, "phase-two");
      assertTerminalTextIncludes(active, "tail-complete");
      assertTerminalTextIncludes(active, "format │ tail-second");
      assertTerminalTextIncludes(result.transcript, "format passed");
      assertEquals(result.transcript.includes("── format"), false);

      const restored = result.stdout.lastIndexOf(SHOW_CURSOR);
      assert(restored >= 0, result.transcript);
      const afterFrame = result.stdout.slice(restored);
      assertEquals(afterFrame.includes("tail-complete"), false);
      assertEquals(afterFrame.includes("tail-second"), false);
      assertTerminalTextIncludes(
        stableLiveSummary(result.stdout),
        "format passed",
      );
    });
  },
});

realPtyTest({
  name: "done live Ctrl-C restores the cursor and leaves stable activity facts",
  contracts: ["signal-delivery", "terminal-modes", "process-lifecycle"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir, { agents: [] });
      await writeConfig(
        dir,
        liveOutputConfig(
          "printf 'interrupt-ready\\n'; tail -f /dev/null; " +
            "printf survived > should-not-exist.txt",
          false,
        ),
      );
      await gitInit(dir);
      await refreshScaffold(dir);

      const result = await runAgentPtyJourney(dir, ["done"], {
        geometry: { columns: 80, rows: 18 },
        env: { NO_COLOR: "1", CI: "false" },
        input: [{
          waitFor: "format │ interrupt-ready",
          capture: {
            name: "running",
            when: ptyOutputContains([
              "format started",
              "format │ interrupt-ready",
            ]),
          },
          steps: [{ bytes: "\x03" }],
        }],
      });
      assert(result.code !== 0, result.transcript);
      assertTerminalTextIncludes(
        result.keyframes.running ?? "",
        "format started",
      );
      assertTerminalTextIncludes(result.transcript, "Interrupted");
      assert(
        result.stdout.lastIndexOf(SHOW_CURSOR) >
          result.stdout.lastIndexOf("Interrupted"),
        result.transcript,
      );
      await assertRejects(
        () => Deno.stat(join(dir, "should-not-exist.txt")),
        Deno.errors.NotFound,
      );
    });
  },
});

realPtyTest({
  name:
    "done live failure keeps diagnostics, raw artifact, output counts, and result fields",
  contracts: ["terminal-modes", "control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir, { agents: [] });
      await writeExecutable(
        join(dir, "live-evidence.sh"),
        [
          "#!/usr/bin/env sh",
          "printf '\\033[31mLIVE-EVIDENCE-START\\033[0m\\n'",
          "printf 'partial-one\\r'",
          "printf 'partial-two\\rpartial-done\\n'",
          "i=0",
          'while [ "$i" -lt 20000 ]; do',
          "  printf X",
          "  i=$((i + 1))",
          "done",
          "printf '\\nTAIL-SIGNAL\\n'",
          "exit 7",
          "",
        ].join("\n"),
      );
      await writeConfig(dir, liveOutputConfig("./live-evidence.sh", false));
      await gitInit(dir);
      await refreshScaffold(dir);

      const human = await runAgentPty(dir, ["done"], {
        env: { COLUMNS: "80", LINES: "18", NO_COLOR: "1", CI: "false" },
      });
      assertEquals(human.code, 1, human.output);
      assertStringIncludes(human.stdout, REPAINT);
      assertTerminalTextIncludes(human.output, "format failed");
      assertTerminalTextIncludes(human.output, "Full output artifact:");
      assert(
        human.stdout.indexOf("Failure guide:") >
          human.stdout.lastIndexOf(SHOW_CURSOR),
        human.output,
      );

      const json = await runAgent(dir, ["done", "--rerun", "--json"]);
      assertEquals(json.code, 1, json.output);
      assertEquals(json.stderr, "", json.output);
      const envelope = decodeCliResult(json.stdout, "done");
      assertEquals(envelope.ok, false);
      assertEquals(envelope.verb, "done");
      assertResultDataKey(envelope, "failed_stage");
      assertEquals(envelope.data.failed_stage, "fix");
      assertExists(envelope.steps);
      const format = envelope.steps.find((step) => step.label === "format");
      assert(format !== undefined, json.stdout);
      assertEquals(format.outcome, "failed");
      assert((format.output_lines ?? 0) >= 6, JSON.stringify(format));
      assertEquals(format.error_like_lines, 0);
      assertExists(format.output_path);
      const raw = await Deno.readFile(format.output_path);
      assert(raw.length > CAPTURE_CAP, `raw artifact was ${raw.length} bytes`);
      const rawText = new TextDecoder().decode(raw);
      assertStringIncludes(rawText, "\x1b[31mLIVE-EVIDENCE-START");
      assertStringIncludes(rawText, "partial-one\rpartial-two\r");
      assertStringIncludes(rawText, "TAIL-SIGNAL");

      assertExists(envelope.diagnostics);
      const diagnostic = envelope.diagnostics.find((item) =>
        item.tool === "format"
      );
      assert(diagnostic !== undefined, json.stdout);
      assertEquals(diagnostic.truncated, true);
      assertEquals(typeof diagnostic.output_path, "string");
      assert((diagnostic.output?.length ?? 0) <= CAPTURE_CAP);
      assertEquals(diagnostic.output?.includes("\x1b"), false);
      assertEquals(diagnostic.output?.includes("\r"), false);
    });
  },
});
