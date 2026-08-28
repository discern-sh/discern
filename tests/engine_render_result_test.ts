/**
 * The secondary `--render` output path: the CLI must prepare the ordinary
 * authored Markdown result, then delegate its final presentation to the shared
 * terminal Markdown component without changing the primary JSON/Markdown
 * contracts.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsi } from "discern-design-system/cli";
import { renderMarkdown } from "../src/lib/markdown.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { runAgent, runAgentPty, scaffoldEngine } from "./engine_helpers.ts";
import { realPtyTest } from "./real_pty.ts";

const STATIC_ENVIRONMENT = {
  NO_COLOR: "1",
  CI: "false",
  LANG: "en_US.UTF-8",
  LC_ALL: "",
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  COLUMNS: "67",
  LINES: "24",
} as const;

Deno.test("--render is the design-system rendering of the authored Markdown result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const args = ["status", "--local"];
    const markdown = await runAgent(dir, [...args, "--markdown"], {
      env: STATIC_ENVIRONMENT,
    });
    const rendered = await runAgent(dir, [...args, "--render"], {
      env: STATIC_ENVIRONMENT,
    });
    assertEquals(markdown.code, 0, markdown.output);
    assertEquals(rendered.code, 0, rendered.output);
    assertEquals(rendered.stderr, "");

    const terminal = resolveTerminalContext({
      noColor: true,
      env: fakeEnv(STATIC_ENVIRONMENT),
      isTerminal: () => false,
      consoleSize: () => {
        throw new Error("static output has no console size");
      },
    });
    const expected = renderMarkdown(markdown.stdout.trimEnd(), {
      width: terminal.size.columns,
      color: terminal.color,
      terminal,
    });
    assertEquals(rendered.stdout, `${expected.trimEnd()}\n`);
  });
});

realPtyTest({
  name: "--render applies terminal styling while --markdown keeps source bytes",
  contracts: ["control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      const env = { NO_COLOR: "", FORCE_COLOR: "", CI: "false" };
      const rendered = await runAgentPty(
        dir,
        ["status", "--local", "--render", "--theme", "dark"],
        { env },
      );
      const markdown = await runAgent(
        dir,
        ["status", "--local", "--markdown", "--theme", "dark"],
        { env },
      );
      assertEquals(rendered.code, 0, rendered.output);
      assertEquals(markdown.code, 0, markdown.output);
      assertStringIncludes(rendered.stdout, "\x1b[");
      assert(!markdown.stdout.includes("\x1b["), markdown.stdout);
      const visible = stripAnsi(rendered.stdout);
      assertStringIncludes(visible, "discern status");
      assertStringIncludes(visible, "Current state");
    });
  },
});
