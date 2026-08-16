/**
 * Black-box coverage for `done`'s human presentation boundary. A real
 * pseudo-terminal gets the live compact table and proof panel; a pipe keeps
 * the stored Markdown page. Both drive the same result-producing engine.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  runAgentPty,
  runAgentPtyJourney,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, fakeEnv, withTempDir } from "./helpers.ts";
import {
  finishResult,
  renderGateStageGapNote,
} from "../src/engine/gate/finish.ts";
import {
  resolveTerminalContext,
  terminalContextWithColor,
} from "../src/lib/terminal.ts";
import { DISCERN_TERMINAL_MOTIF, stripAnsi } from "discern-design-system/cli";
import { CAPTURE_CAP } from "../src/shared/result.ts";

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

const LIVE_CONFIG = CONFIG.replace(
  'format = "true"',
  'format = "sleep 1"\ntest = "true"',
);
const FAILING_CONFIG = CONFIG.replace(
  'format = "true"',
  'format = "echo $((40+2))-ONE-OFF; false"\ntest = "true"',
);
const OVERSIZED_CONFIG = CONFIG.replace(
  'format = "true"',
  [
    'format = "sleep 1"',
    'build = "true"',
    'lint = "true"',
    'typecheck = "true"',
    'test = "true"',
    'smoke = "true"',
  ].join("\n"),
);

/** Apply one job command and an explicit static transcript policy. */
function liveOutputConfig(command: string, stream: boolean): string {
  return `${
    CONFIG.replace('format = "true"', `format = ${JSON.stringify(command)}`)
  }\n[gate]\nstream = ${stream}\n`;
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

/** Create a linked worktree with optional config and one clean committed change. */
async function committedWorktree(
  main: string,
  name: string,
  config?: string,
): Promise<string> {
  const worktree = await addWorktree(main, name);
  if (config !== undefined) {
    await writeConfig(worktree, config);
  }
  await Deno.writeTextFile(join(worktree, `${name}.txt`), `${name}\n`);
  await git(worktree, "add", "-A");
  await git(
    worktree,
    "commit",
    "-q",
    "-m",
    `Add ${name}`,
    "--no-gpg-sign",
  );
  return worktree;
}

Deno.test("done human output leaves live activity facts and the compact TTY proof", async () => {
  await withTempDir(async (main) => {
    await scaffoldEngine(main, { agents: [] });
    await writeConfig(main, CONFIG);
    await gitInit(main);

    const ttyWorktree = await committedWorktree(
      main,
      "tty-proof",
      LIVE_CONFIG,
    );
    const tty = await runAgentPty(ttyWorktree, ["done"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 15_000,
    });
    assertEquals(tty.code, 0, tty.output);
    assertStringIncludes(tty.output, "Gate");
    assertTerminalTextIncludes(tty.output, "format started");
    assertTerminalTextIncludes(tty.output, "format passed");
    assertTerminalTextIncludes(tty.output, "test started");
    assertTerminalTextIncludes(tty.output, "test passed");
    for (const glyph of DISCERN_TERMINAL_MOTIF.unicode.spinner) {
      assert(
        tty.output.includes(glyph),
        `live Gate omitted spinner phase ${glyph}: ${tty.output}`,
      );
    }
    assert(tty.stdout.includes(REPAINT), tty.output);
    assertEquals(tty.output.includes("Running gate checks"), false);
    assertTerminalTextIncludes(
      tty.output,
      "Proof: gate passed on agent/tty-proof",
    );
    assertTerminalTextIncludes(tty.output, "Receipt: Gate proof");
    assertEquals(tty.output.includes("### Proof"), false);
    assertEquals(tty.output.includes("| ran | command | result |"), false);
    assertEquals(
      tty.output.includes("Everything built and all checks passed."),
      false,
    );
    assertEquals(
      tty.output.includes("If you changed documented behavior"),
      false,
    );
    assertEquals(SGR.test(tty.output), false);

    const failingWorktree = await committedWorktree(
      main,
      "tty-failure",
      FAILING_CONFIG,
    );
    const failing = await runAgentPty(failingWorktree, ["done"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 15_000,
    });
    assertEquals(failing.code, 1, failing.output);
    assert(failing.stdout.includes(REPAINT), failing.output);
    assertTerminalTextIncludes(failing.output, "format failed");
    assertTerminalTextIncludes(failing.output, "Failure guide:");
    assert(
      failing.stdout.indexOf("Failure guide:") >
        failing.stdout.lastIndexOf(SHOW_CURSOR),
      failing.output,
    );
    assertEquals(failing.output.includes("Proof: gate passed"), false);

    for (
      const { name, args, env } of [
        {
          name: "plain-proof",
          args: ["done", "--plain"],
          env: { COLUMNS: "80", NO_COLOR: "1" },
        },
        {
          name: "ci-proof",
          args: ["done"],
          env: { COLUMNS: "80", NO_COLOR: "1", CI: "1" },
        },
      ]
    ) {
      const staticWorktree = await committedWorktree(main, name);
      const staticTty = await runAgentPty(staticWorktree, args, {
        env,
        timeoutMs: 15_000,
      });
      assertEquals(staticTty.code, 0, staticTty.output);
      assertTerminalTextIncludes(staticTty.output, "Gate progress");
      assertTerminalTextIncludes(staticTty.output, "Receipt: Gate proof");
      assertTerminalTextIncludes(staticTty.output, "Proof: gate passed");
      assertEquals(staticTty.output.includes("pending"), false);
      assertEquals(staticTty.output.includes("running"), false);
      assertEquals(staticTty.output.includes(CSI), false);
    }

    const pipedWorktree = await committedWorktree(main, "piped-proof");
    const piped = await runAgent(pipedWorktree, ["done"]);
    assertEquals(piped.code, 0, piped.output);
    assertTerminalTextIncludes(
      piped.output,
      "Everything built and all checks passed.",
    );
    assertTerminalTextIncludes(
      piped.output,
      "### Proof — `agent/piped-proof`",
    );
    assertTerminalTextIncludes(piped.output, "| ran | command | result |");
    assertEquals(
      piped.output.includes("JOB                 COMMAND"),
      false,
    );

    const jsonWorktree = await committedWorktree(main, "json-proof");
    const json = await runAgentPty(jsonWorktree, ["done", "--json"], {
      env: { NO_COLOR: "1" },
      timeoutMs: 15_000,
    });
    assertEquals(json.code, 0, json.output);
    const jsonStart = json.stdout.indexOf("{");
    const jsonEnd = json.stdout.lastIndexOf("}");
    assertEquals(jsonStart >= 0 && jsonEnd >= jsonStart, true, json.output);
    const envelope = JSON.parse(
      json.stdout.slice(jsonStart, jsonEnd + 1),
    ) as {
      ok: boolean;
      verb: string;
    };
    assertEquals(envelope.ok, true);
    assertEquals(envelope.verb, "done");
    assertEquals(json.output.includes("Running gate checks"), false);
    assertEquals(json.output.includes("Gate progress"), false);
  });
});

Deno.test({
  name:
    "done live frame ignores the static stream setting and updates partial lines in place",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const summaries: string[] = [];
    for (const stream of [false, true]) {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir, { agents: [] });
        await writeConfig(
          dir,
          liveOutputConfig(
            "printf 'phase-one\\r'; sleep 0.25; printf 'phase-two\\r'; " +
              "sleep 0.25; printf 'tail-complete\\n'; " +
              "printf 'tail-second\\n'; sleep 0.4",
            stream,
          ),
        );
        await gitInit(dir);

        const result = await runAgentPtyJourney(dir, ["done"], {
          geometry: { columns: 80, rows: 18 },
          env: { NO_COLOR: "1", CI: "false" },
          input: [{
            waitFor: [
              "phase-one",
              "phase-two",
              "tail-complete",
              "tail-second",
            ],
            captureAs: "active-tail",
            steps: [{ delayMs: 50 }],
          }],
          timeoutMs: 12_000,
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
        summaries.push(stableLiveSummary(result.stdout));
      });
    }
    assertEquals(summaries.length, 2);
    assertEquals(
      summaries[0],
      summaries[1],
      "both static transcript settings must leave the same live summary",
    );
  },
});

Deno.test({
  name: "done live Ctrl-C restores the cursor and leaves stable activity facts",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir, { agents: [] });
      await writeConfig(
        dir,
        liveOutputConfig(
          "printf 'interrupt-ready\\n'; sleep 20; " +
            "printf survived > should-not-exist.txt",
          false,
        ),
      );
      await gitInit(dir);

      const result = await runAgentPtyJourney(dir, ["done"], {
        geometry: { columns: 80, rows: 18 },
        env: { NO_COLOR: "1", CI: "false" },
        input: [{
          waitFor: "format │ interrupt-ready",
          captureAs: "running",
          steps: [{ delayMs: 100, bytes: "\x03" }],
        }],
        timeoutMs: 8_000,
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

Deno.test({
  name:
    "done live failure keeps diagnostics, raw artifact, output counts, and result fields",
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
          "sleep 0.2",
          "printf 'partial-two\\rpartial-done\\n'",
          "i=0",
          'while [ "$i" -lt 20000 ]; do',
          "  printf X",
          "  i=$((i + 1))",
          "done",
          "printf '\\nTAIL-SIGNAL\\n'",
          "sleep 0.2",
          "exit 7",
          "",
        ].join("\n"),
      );
      await writeConfig(dir, liveOutputConfig("./live-evidence.sh", false));
      await gitInit(dir);

      const human = await runAgentPty(dir, ["done"], {
        env: { COLUMNS: "80", LINES: "18", NO_COLOR: "1", CI: "false" },
        timeoutMs: 15_000,
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

      const json = await runAgent(dir, ["done", "--confirmed", "--json"]);
      assertEquals(json.code, 1, json.output);
      assertEquals(json.stderr, "", json.output);
      const envelope = JSON.parse(json.stdout) as {
        ok: boolean;
        verb: string;
        data: { failed_stage: string | null };
        steps: Array<{
          label: string;
          outcome: string;
          output_lines?: number;
          error_like_lines?: number;
          output_path?: string;
        }>;
        diagnostics: Array<{
          tool: string;
          output?: string;
          truncated?: boolean;
          output_path?: string;
        }>;
      };
      assertEquals(envelope.ok, false);
      assertEquals(envelope.verb, "done");
      assertEquals(envelope.data.failed_stage, "fix");
      const format = envelope.steps.find((step) => step.label === "format");
      assert(format !== undefined, json.stdout);
      assertEquals(format.outcome, "failed");
      assert((format.output_lines ?? 0) >= 6, JSON.stringify(format));
      assertEquals(format.error_like_lines, 0);
      assertEquals(typeof format.output_path, "string");
      const raw = await Deno.readFile(format.output_path as string);
      assert(raw.length > CAPTURE_CAP, `raw artifact was ${raw.length} bytes`);
      const rawText = new TextDecoder().decode(raw);
      assertStringIncludes(rawText, "\x1b[31mLIVE-EVIDENCE-START");
      assertStringIncludes(rawText, "partial-one\rpartial-two\r");
      assertStringIncludes(rawText, "TAIL-SIGNAL");

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

Deno.test("done TTY: a chatty Gate keeps one bounded package-owned live frame", async () => {
  await withTempDir(async (main) => {
    await scaffoldEngine(main, { agents: [] });
    await writeConfig(main, CONFIG);
    await gitInit(main);
    const worktree = await committedWorktree(
      main,
      "oversized-gate",
      OVERSIZED_CONFIG,
    );

    const result = await runAgentPty(worktree, ["done"], {
      env: { COLUMNS: "80", LINES: "24", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });

    assertEquals(result.code, 0, result.output);
    assertTerminalTextIncludes(result.output, "Applying fixers");
    assertTerminalTextIncludes(result.output, "Checking and testing");
    assertTerminalTextIncludes(result.output, "format passed");
    assertTerminalTextIncludes(result.output, "smoke passed");
    assert(result.stdout.includes(REPAINT), "the package frame repaints");
    assertEquals(result.output.includes("── format"), false);
  });
});
