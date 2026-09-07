/** Black-box coverage for `prepare`'s shared gate-job TTY presentation. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";

const CSI = `${String.fromCharCode(27)}[`;
const REPAINT = `${CSI}1G`;
const SHOW_CURSOR = `${CSI}?25h`;
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "u");

/** Build the minimal prepare fixture config for one job and gate-mode matrix row. */
function config(
  jobs: readonly string[],
  gate: readonly string[] = [],
): string {
  return [
    "[project]",
    'slug = "prepare-tty-test"',
    "agents = []",
    "",
    "[instructions]",
    "sources = []",
    ...(gate.length > 0 ? ["", "[gate]", ...gate] : []),
    ...(jobs.length > 0 ? ["", "[jobs]", ...jobs] : []),
    "",
  ].join("\n");
}

/** Scaffold and commit a configured project ready for a prepare invocation. */
async function preparedRepo(
  dir: string,
  toml: string,
): Promise<void> {
  await scaffoldEngine(dir, { agents: [] });
  await writeConfig(dir, toml);
  await gitInit(dir);
}

realPtyTest({
  name:
    "prepare TTY: the live activity frame moves every job through execution",
  contracts: ["terminal-modes", "control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await preparedRepo(
        dir,
        config([
          'format = "true"',
          'lint = "true"',
        ]),
      );

      const result = await runAgentPty(dir, ["prepare"], {
        env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      });
      assertEquals(result.code, 0, result.output);
      assertStringIncludes(result.output, "Gate");
      assertTerminalTextIncludes(result.output, "format started");
      assertTerminalTextIncludes(result.output, "format passed");
      assertTerminalTextIncludes(result.output, "lint started");
      assertTerminalTextIncludes(result.output, "lint passed");
      assert(result.stdout.includes(REPAINT), result.output);
      assertTerminalTextIncludes(result.output, "Applying fixers");
      assertEquals(result.output.includes("── format"), false);

      const passed = result.stdout.lastIndexOf(
        "Fix and check stages passed. Build and test stages did not run.",
      );
      assert(passed > result.stdout.lastIndexOf("lint passed"), result.stdout);
      assert(passed > result.stdout.lastIndexOf(SHOW_CURSOR), result.stdout);
      assertEquals(SGR.test(result.output), false);
    });
  },
});
realPtyTest({
  name: "prepare TTY: a failed live table completes before the actionable tail",
  contracts: ["terminal-modes", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const failing = "echo PREPARE-BROKE; exit 7";
      await preparedRepo(
        dir,
        config([
          'format = "true"',
          `lint = "${failing}"`,
          'typecheck = "tail -f /dev/null"',
        ]),
      );

      const result = await runAgentPty(dir, ["prepare"], {
        env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      });
      assertEquals(result.code, 1, result.output);
      assertTerminalTextIncludes(result.output, "lint failed");
      assertTerminalTextIncludes(result.output, "typecheck cancelled");
      const tailStart = result.stdout.indexOf("Failure guide:");
      assert(tailStart > result.stdout.lastIndexOf(SHOW_CURSOR), result.stdout);
      assert(tailStart > result.stdout.indexOf("lint failed"), result.stdout);
      assertTerminalTextIncludes(
        result.stdout.slice(tailStart),
        "FAILURE: lint",
      );
      assertTerminalTextIncludes(
        result.stdout.slice(tailStart),
        `Reproduce: $ ${failing}`,
      );
      assertTerminalTextIncludes(
        result.stdout.slice(tailStart),
        "Safe to retry",
      );
      assertTerminalTextIncludes(
        result.stdout.slice(tailStart),
        "Failed: discern prepare failed",
      );
      assertTerminalTextIncludes(
        result.stdout.slice(tailStart),
        `reproduce: ${failing}`,
      );
    });
  },
});
Deno.test("prepare pipe and JSON surfaces keep their non-interactive contracts", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(
      dir,
      config([
        'format = "echo buffered-fix"',
        'lint = "true"',
      ]),
    );

    const piped = await runAgent(dir, ["prepare"]);
    assertEquals(piped.code, 0, piped.output);
    assertTerminalTextIncludes(piped.output, "Applying fixers");
    assertStringIncludes(piped.output, "buffered-fix");
    assertTerminalTextIncludes(piped.output, "── format");
    assertTerminalTextIncludes(
      piped.output,
      "Fix and check stages passed. Build and test stages did not run.",
    );
    assertEquals(piped.output.includes("JOB                 COMMAND"), false);
    assertEquals(piped.output.includes(CSI), false);
    assertEquals(SGR.test(piped.output), false);

    const json = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(json.code, 0, json.output);
    const envelope = decodeCliResult(json.stdout, "prepare");
    assertEquals(envelope.ok, true);
    assertEquals(envelope.verb, "prepare");
    assertEquals(json.stderr, "");
    assertEquals(json.stdout.includes("JOB"), false);
    assertEquals(json.stdout.includes("Fix and check stages passed"), false);
  });
});
