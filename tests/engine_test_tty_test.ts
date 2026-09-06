/** Black-box human-output coverage for standalone `discern test`. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  gitInit,
  runAgentPtyWithViewport,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { realPtyTest } from "./real_pty.ts";

const CSI = "\x1b[";
const REPAINT = `${CSI}1G`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "u");

/** Build the smallest standalone-test fixture configuration for one case. */
function config(command: string, stream = false): string {
  return [
    "[project]",
    'slug = "test-tty"',
    "agents = []",
    "",
    "[instructions]",
    "sources = []",
    ...(stream ? ["", "[gate]", "stream = true"] : []),
    "",
    "[jobs]",
    `test = ${JSON.stringify(command)}`,
    "",
  ].join("\n");
}

/** Scaffold and commit one standalone-test fixture repository. */
async function testRepo(
  dir: string,
  command: string,
  stream = false,
): Promise<void> {
  await scaffoldEngine(dir, { agents: [] });
  await writeConfig(dir, config(command, stream));
  await gitInit(dir);
}

/** Count exact, non-overlapping occurrences of a presentation token. */
function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

/** Discard runtime setup controls emitted before the product's first frame. */
function testOutput(output: string): string {
  const starts = [HIDE_CURSOR, "Test progress", "Running tests"]
    .map((token) => output.indexOf(token))
    .filter((at) => at >= 0);
  const start = Math.min(...starts);
  assert(Number.isFinite(start), `could not find test output:\n${output}`);
  return output.slice(start);
}

realPtyTest({
  name:
    "test TTY failure leaves one captured output, final detail, and remedy below compact live progress",
  contracts: ["terminal-modes", "control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await testRepo(
        dir,
        "sh -c 'echo $((800+8))-TEST-FAIL; sleep 1; exit 7'",
      );
      const result = await runAgentPtyWithViewport(dir, ["test"], {
        size: { columns: 80, rows: 12 },
        env: { NO_COLOR: "1", CI: "false" },
      });
      assertEquals(result.code, 1, result.output);
      const output = testOutput(result.stdout);
      assert(output.includes(REPAINT), result.output);
      assertStringIncludes(output, "test started");
      assertStringIncludes(output, "test failed");
      assert(occurrences(output, "808-TEST-FAIL") >= 1, result.output);
      const tail = output.slice(output.lastIndexOf(SHOW_CURSOR));
      assertEquals(occurrences(tail, "808-TEST-FAIL"), 1, result.output);
      assertEquals(occurrences(tail, "Failure guide:"), 1, result.output);
      assertStringIncludes(tail, "Failed: discern test failed");
      assertStringIncludes(tail, "Reproduce: $");
    });
  },
});
realPtyTest({
  name:
    "test live dashboard changes styling only between color and no-color terminals",
  contracts: ["control-rendering", "terminal-modes"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await testRepo(dir, "sleep 1");
      const noColor = await runAgentPtyWithViewport(dir, ["test"], {
        size: { columns: 80, rows: 60 },
        env: { NO_COLOR: "1", FORCE_COLOR: "", CI: "false" },
      });
      const color = await runAgentPtyWithViewport(dir, ["test"], {
        size: { columns: 80, rows: 60 },
        env: {
          NO_COLOR: "",
          FORCE_COLOR: "1",
          COLORTERM: "truecolor",
          CI: "false",
        },
      });
      for (const result of [noColor, color]) {
        assertEquals(result.code, 0, result.output);
        assert(testOutput(result.stdout).includes(CSI), result.output);
        assertTerminalTextIncludes(result.output, "Tests passed.");
      }
      assertEquals(SGR.test(testOutput(noColor.stdout)), false, noColor.output);
      assert(SGR.test(testOutput(color.stdout)), color.output);
    });
  },
});
