/**
 * Black-box coverage for `done`'s human presentation boundary. A real
 * pseudo-terminal gets the live compact table and proof panel; a pipe keeps
 * the stored Markdown page. Both drive the same result-producing engine.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import {
  finishResult,
  renderGateStageGapNote,
} from "../src/engine/gate/finish.ts";
import {
  resolveTerminalContext,
  terminalContextWithColor,
} from "../src/lib/terminal.ts";
import { stripAnsi } from "discern-design-system/cli";

const CSI = `${String.fromCharCode(27)}[`;
const REPAINT = `${CSI}1G`;
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
  "[guidance]",
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
    assertStringIncludes(tty.output, "format started");
    assertStringIncludes(tty.output, "format passed");
    assertStringIncludes(tty.output, "test started");
    assertStringIncludes(tty.output, "test passed");
    assert(tty.stdout.includes(REPAINT), tty.output);
    assertEquals(tty.output.includes("Running gate checks"), false);
    assertStringIncludes(
      tty.output,
      "Proof: gate passed on agent/tty-proof",
    );
    assertStringIncludes(tty.output, "Receipt: Gate proof");
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
    assertStringIncludes(failing.output, "format failed");
    assertStringIncludes(failing.output, "Failure guide:");
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
      assertStringIncludes(staticTty.output, "Gate progress");
      assertStringIncludes(staticTty.output, "Receipt: Gate proof");
      assertStringIncludes(staticTty.output, "Proof: gate passed");
      assertEquals(staticTty.output.includes("pending"), false);
      assertEquals(staticTty.output.includes("running"), false);
      assertEquals(staticTty.output.includes(CSI), false);
    }

    const pipedWorktree = await committedWorktree(main, "piped-proof");
    const piped = await runAgent(pipedWorktree, ["done"]);
    assertEquals(piped.code, 0, piped.output);
    assertStringIncludes(
      piped.output,
      "Everything built and all checks passed.",
    );
    assertStringIncludes(
      piped.output,
      "### Proof — `agent/piped-proof`",
    );
    assertStringIncludes(piped.output, "| ran | command | result |");
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
    assertStringIncludes(result.output, "Applying fixers");
    assertStringIncludes(result.output, "Checking and testing");
    assertStringIncludes(result.output, "format passed");
    assertStringIncludes(result.output, "smoke passed");
    assert(result.stdout.includes(REPAINT), "the package frame repaints");
    assertEquals(result.output.includes("── format"), false);
  });
});
