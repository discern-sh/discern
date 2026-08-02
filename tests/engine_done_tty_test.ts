/**
 * Black-box coverage for `done`'s human presentation boundary. A real
 * pseudo-terminal gets the live compact table and receipt panel; a pipe keeps
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
import { withTempDir } from "./helpers.ts";

const CSI = `${String.fromCharCode(27)}[`;
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
  'format = "false"\ntest = "true"',
);

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

Deno.test("done human output uses the compact receipt only on a TTY", async () => {
  await withTempDir(async (main) => {
    await scaffoldEngine(main, { agents: [] });
    await writeConfig(main, CONFIG);
    await gitInit(main);

    const ttyWorktree = await committedWorktree(
      main,
      "tty-receipt",
      LIVE_CONFIG,
    );
    const tty = await runAgentPty(ttyWorktree, ["done"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 15_000,
    });
    assertEquals(tty.code, 0, tty.output);
    assertStringIncludes(tty.output, "JOB");
    assertStringIncludes(tty.output, "COMMAND");
    assertStringIncludes(tty.output, "RESULT");
    assertStringIncludes(tty.output, "format");
    assertStringIncludes(tty.output, "sleep 1");
    assertStringIncludes(tty.output, "test");
    assertStringIncludes(tty.output, "ok · 1s");
    const firstRedraw = tty.stdout.indexOf(CSI);
    assert(firstRedraw > 0, tty.output);
    const firstFrame = tty.stdout.slice(0, firstRedraw);
    assertStringIncludes(firstFrame, "format");
    assertStringIncludes(firstFrame, "test");
    assertStringIncludes(firstFrame, "pending");
    assertStringIncludes(tty.stdout.slice(firstRedraw), "running");
    assertEquals(tty.output.includes("Running gate checks"), false);
    assertStringIncludes(
      tty.output,
      "Receipt: gate passed on agent/tty-receipt",
    );
    assertEquals(tty.output.includes("### Receipt"), false);
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
    const failingFirstRedraw = failing.stdout.indexOf(CSI);
    assert(failingFirstRedraw > 0, failing.output);
    assertStringIncludes(
      failing.stdout.slice(0, failingFirstRedraw),
      "pending",
    );
    assertStringIncludes(failing.stdout.slice(failingFirstRedraw), "running");
    assertStringIncludes(failing.output, "failed · <1s");
    assertStringIncludes(failing.output, "skipped");
    assertEquals(failing.output.includes("Receipt: gate passed"), false);

    for (
      const { name, args, env } of [
        {
          name: "plain-receipt",
          args: ["done", "--plain"],
          env: { COLUMNS: "80", NO_COLOR: "1" },
        },
        {
          name: "ci-receipt",
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
      assertStringIncludes(staticTty.output, "JOB");
      assertStringIncludes(staticTty.output, "Receipt: gate passed");
      assertEquals(staticTty.output.includes("pending"), false);
      assertEquals(staticTty.output.includes("running"), false);
      assertEquals(staticTty.output.includes(CSI), false);
    }

    const pipedWorktree = await committedWorktree(main, "piped-receipt");
    const piped = await runAgent(pipedWorktree, ["done"]);
    assertEquals(piped.code, 0, piped.output);
    assertStringIncludes(
      piped.output,
      "Everything built and all checks passed.",
    );
    assertStringIncludes(
      piped.output,
      "### Receipt — `agent/piped-receipt`",
    );
    assertStringIncludes(piped.output, "| ran | command | result |");
    assertEquals(
      piped.output.includes("JOB                 COMMAND"),
      false,
    );

    const jsonWorktree = await committedWorktree(main, "json-receipt");
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
    assertEquals(json.output.includes("JOB"), false);
  });
});
