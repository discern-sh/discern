/** Black-box human-output coverage for standalone `discern test`. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  gitInit,
  runAgentPty,
  runAgentPtyWithViewport,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const CSI = "\x1b[";
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "u");

/** Build the smallest standalone-test fixture configuration for one case. */
function config(command: string, stream = false): string {
  return [
    "[project]",
    'slug = "test-tty"',
    "agents = []",
    "",
    "[guidance]",
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
  const starts = ["Test progress", "Test active", "Running tests"]
    .map((token) => output.indexOf(token))
    .filter((at) => at >= 0);
  const start = Math.min(...starts);
  assert(Number.isFinite(start), `could not find test output:\n${output}`);
  return output.slice(start);
}

Deno.test({
  name:
    "test TTY failure leaves one captured output, final detail, and remedy below compact live progress",
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
        timeoutMs: 15_000,
      });
      assertEquals(result.code, 1, result.output);
      const output = testOutput(result.stdout);
      const firstControl = output.indexOf(CSI);
      assert(firstControl > 0, result.output);
      assertStringIncludes(output.slice(0, firstControl), "Test active");
      assertEquals(output.slice(0, firstControl).includes("[pending]"), false);
      assertEquals(occurrences(output, "808-TEST-FAIL"), 1, result.output);
      const tail = output.slice(output.lastIndexOf(CSI));
      assertEquals(occurrences(tail, "test [failed]"), 1, result.output);
      assertEquals(occurrences(tail, "Failure guide:"), 1, result.output);
      assertStringIncludes(tail, "Failed: discern test failed");
      assertStringIncludes(tail, "Reproduce: $");
    });
  },
});

Deno.test({
  name:
    "test static modes never move the cursor and preserve their ordinary transcript",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const cases = [
      {
        label: "plain",
        args: ["test", "--plain"],
        env: { TERM: "xterm-256color", NO_COLOR: "1", CI: "false" },
        stream: false,
        ascii: false,
      },
      {
        label: "CI",
        args: ["test"],
        env: { TERM: "xterm-256color", NO_COLOR: "1", CI: "1" },
        stream: false,
        ascii: false,
      },
      {
        label: "TERM=dumb",
        args: ["test"],
        env: { TERM: "dumb", NO_COLOR: "1", CI: "false" },
        stream: false,
        ascii: false,
      },
      {
        label: "ASCII",
        args: ["test", "--plain"],
        env: {
          TERM: "xterm",
          LANG: "C",
          LC_ALL: "C",
          NO_COLOR: "1",
          CI: "false",
        },
        stream: false,
        ascii: true,
      },
      {
        label: "stream",
        args: ["test"],
        env: { TERM: "xterm-256color", NO_COLOR: "1", CI: "false" },
        stream: true,
        ascii: false,
      },
    ] as const;
    for (const testCase of cases) {
      await withTempDir(async (dir) => {
        await testRepo(
          dir,
          "echo $((900+9))-TEST-STATIC",
          testCase.stream,
        );
        const result = await runAgentPty(dir, [...testCase.args], {
          env: { ...testCase.env },
          timeoutMs: 10_000,
        });
        assertEquals(result.code, 0, `${testCase.label}: ${result.output}`);
        assertEquals(
          result.output.includes(CSI),
          false,
          `${testCase.label}: ${result.output}`,
        );
        assertEquals(
          occurrences(result.output, "909-TEST-STATIC"),
          1,
          `${testCase.label}: ${result.output}`,
        );
        assertStringIncludes(result.output, "Running tests");
        assertStringIncludes(result.output, "Tests passed.");
        assertEquals(result.output.includes("[pending]"), false);
        assertEquals(result.output.includes("[running]"), false);
        if (testCase.stream) {
          assertEquals(result.output.includes("Test progress"), false);
        } else {
          assertStringIncludes(result.output, "Test progress");
          assertStringIncludes(result.output, "test [passed]");
        }
        if (testCase.ascii) {
          const product = testOutput(result.output);
          const dashboard = product.slice(product.indexOf("Test progress"));
          assertEquals(
            [...dashboard].some((value) => (value.codePointAt(0) ?? 0) > 0x7f),
            false,
            dashboard,
          );
        }
      });
    }
  },
});

Deno.test({
  name:
    "test live dashboard changes styling only between color and no-color terminals",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await testRepo(dir, "sleep 1");
      const noColor = await runAgentPtyWithViewport(dir, ["test"], {
        size: { columns: 80, rows: 60 },
        env: { NO_COLOR: "1", FORCE_COLOR: "", CI: "false" },
        timeoutMs: 10_000,
      });
      const color = await runAgentPtyWithViewport(dir, ["test"], {
        size: { columns: 80, rows: 60 },
        env: {
          NO_COLOR: "",
          FORCE_COLOR: "1",
          COLORTERM: "truecolor",
          CI: "false",
        },
        timeoutMs: 10_000,
      });
      for (const result of [noColor, color]) {
        assertEquals(result.code, 0, result.output);
        assert(testOutput(result.stdout).includes(CSI), result.output);
        assertStringIncludes(result.output, "Tests passed.");
      }
      assertEquals(SGR.test(testOutput(noColor.stdout)), false, noColor.output);
      assert(SGR.test(testOutput(color.stdout)), color.output);
    });
  },
});
