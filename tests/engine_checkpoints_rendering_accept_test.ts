/** Checkpoint rendering accept journeys with independently owned fixtures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  checkpointedWorktree,
  greenWithUnmet,
  RATIONALE,
} from "./engine_checkpoints_accept_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

Deno.test("accept: the variance refusal escapes the rationale and paths on the markdown surface", async () => {
  // The refusal message is the owner's consent moment and renders verbatim
  // under --markdown, so the agent's opaque rationale and the working-tree
  // path names must arrive inside the code-span escaping boundary, never as
  // live Markdown (links, emphasis, broken spans).
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await Deno.writeTextFile(join(wt, "api", "*wild*.txt"), "hostile name\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "hostile path", "--no-gpg-sign");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    const hostile =
      "Docs lag [x](https://evil.example) and *break* callers of `handler`.";
    assertEquals(
      (await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        hostile,
        "--json",
      ])).code,
      0,
    );
    const md = await runAgent(wt, ["accept", "--markdown"]);
    assertEquals(md.code, 1, md.output);
    assertTerminalTextIncludes(md.stdout, "Rationale: ``" + hostile + "``");
    assertStringIncludes(md.stdout, "`api/*wild*.txt`");
  });
});

Deno.test("accept: the human variance refusal keeps authored paragraphs on real lines", async () => {
  // The owner review moment is a multi-paragraph product message; its authored
  // newlines must reach the terminal as line structure, never as visible
  // newline symbols from a single-line sink.
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);
    const human = await runAgent(wt, ["accept"], {
      env: { COLUMNS: "200", NO_COLOR: "1" },
    });
    assertEquals(human.code, 1, human.output);
    assert(
      !human.output.includes("␊"),
      `authored refusal newlines leaked as visible symbols:\n${human.output}`,
    );
    assert(
      /\n\s*Question: /.test(human.output),
      `the question must open its own line:\n${human.output}`,
    );
    assert(
      /\n\s*Rationale: /.test(human.output),
      `the rationale must open its own line:\n${human.output}`,
    );
    assertTerminalTextIncludes(human.output, RATIONALE);
  });
});
