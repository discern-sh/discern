/**
 * Black-box coverage for `done`'s human presentation boundary. A real
 * pseudo-terminal gets the compact table and receipt panel; a pipe keeps the
 * stored Markdown page. Both drive the same result-producing engine.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
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

async function committedWorktree(main: string, name: string): Promise<string> {
  const worktree = await addWorktree(main, name);
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

    const ttyWorktree = await committedWorktree(main, "tty-receipt");
    const tty = await runAgentPty(ttyWorktree, ["done"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
      timeoutMs: 15_000,
    });
    assertEquals(tty.code, 0, tty.output);
    assertStringIncludes(tty.output, "JOB");
    assertStringIncludes(tty.output, "COMMAND");
    assertStringIncludes(tty.output, "RESULT");
    assertStringIncludes(tty.output, "format");
    assertStringIncludes(tty.output, "true");
    assertStringIncludes(tty.output, "ok · <1s");
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
    assertEquals(tty.output.includes("\x1b["), false);

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
