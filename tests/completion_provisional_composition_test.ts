/**
 * A provisional effort that fell behind the trunk composes against the trunk
 * on `done` — whatever its place in the queue — and lands without another
 * producer run. Selection and admission agree on the trunk as that effort's
 * predecessor; a green run that cannot be recorded says why in its first
 * paragraph.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { recordEnvironmentProof } from "../src/engine/execution/probe_record.ts";
import { declarationIdentity } from "../src/engine/execution/subjects.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";

const declaration = `
[execution.local]
kind = 'borrowed'
capacity = 2
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`;

/** Author one committed file so the effort has work of its own. */
async function commitFile(path: string, name: string): Promise<void> {
  await Deno.writeTextFile(`${path}/${name}`, `${name}\n`);
  await git(path, "add", name);
  await git(path, "commit", "-q", "-m", `Author ${name}`);
}

/** The physical producer count a shared counter file records. */
async function executions(counter: string): Promise<number> {
  try {
    return (await Deno.readTextFile(counter)).length;
  } catch {
    return 0;
  }
}

Deno.test("a provisional effort behind the trunk composes on done at any queue position and lands without another run", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const counter = `${aux}/executions`;
      const first = await project(
        root,
        ["local"],
        declaration,
        `printf t >> ${
          quoteCommandWord(counter)
        }; printf 'DISCERN_METRIC coverage 93\\n'`,
        ["**"],
        { concurrency: 2, lookahead: 4 },
      );
      // Prove the declaration as setup would record it, so composition in a
      // borrowed checkout is operational.
      const config = await loadConfig(root);
      const local = config.execution["local"];
      assert(local !== undefined);
      await recordEnvironmentProof(root, {
        context: "local",
        declaration: await declarationIdentity(local),
        proven_at: SYSTEM_CLOCK.wallNow(),
        source: {
          branch: "refs/heads/main",
          head: await gitOut(root, "rev-parse", "HEAD"),
        },
        exercised: ["success", "failure", "cancellation"],
      });
      const second = await addWorktree(root, "second");
      await commitFile(second, "second-source");
      const third = await addWorktree(root, "third");
      await commitFile(third, "third-source");
      for (const path of [first, second, third]) {
        const done = await runAgent(path, ["done", "--json"]);
        assertEquals(done.code, 0, done.output);
      }
      assertEquals(await executions(counter), 3);
      await grantEffort(
        first,
        "agent/public-done",
        wallTimeIso(SYSTEM_CLOCK.wallNow()),
      );
      const landed = await runAgent(first, ["accept", "--json"]);
      assertEquals(landed.code, 0, landed.output);
      assertEquals(await executions(counter), 3, "a source tip lands as is");
      // The third effort is provisional and NOT at the head of the queue (the
      // second sits ahead of it), and its source now lies behind the trunk.
      await commitFile(third, "third-revision");
      const composed = await runAgent(third, ["done", "--json"]);
      assertEquals(composed.code, 0, composed.output);
      assertEquals(await executions(counter), 4, "one composition run");
      const result = decodeCliResult(composed.stdout, "done");
      assert(
        result.data !== undefined && "completion" in result.data,
        composed.output,
      );
      assertEquals(result.data.completion?.kind, "complete");
      // Landing the composed candidate reuses its evidence: no producer runs.
      await grantEffort(
        third,
        "agent/third",
        wallTimeIso(SYSTEM_CLOCK.wallNow()),
      );
      const accepted = await runAgent(root, [
        "accept",
        "--target",
        "third",
        "--json",
      ]);
      assertEquals(accepted.code, 0, accepted.output);
      assertTerminalTextIncludes(
        decodeCliResult(accepted.stdout, "accept").message ?? "",
        "Selected effort `agent/third`: landed.",
      );
      assertEquals(
        await executions(counter),
        4,
        "an unchanged predicted predecessor adds no producer run at acceptance",
      );
    });
  });
});

Deno.test("a green run that cannot be recorded as complete names its cause first", async () => {
  await withTempDir(async (root) => {
    // No declared environment: a source that fell behind the trunk cannot be
    // composed, and the refusal must say so instead of a generic sentence.
    const first = await project(root, ["local"]);
    const behind = await addWorktree(root, "behind");
    await commitFile(behind, "behind-source");
    for (const path of [first, behind]) {
      const done = await runAgent(path, ["done", "--json"]);
      assertEquals(done.code, 0, done.output);
    }
    await grantEffort(
      first,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const landed = await runAgent(first, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    await commitFile(behind, "behind-revision");
    const refused = await runAgent(behind, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const message = decodeCliResult(refused.stdout, "done").message ?? "";
    assert(
      !message.includes(
        "complete evidence or environment recovery is still pending",
      ),
      message,
    );
    assertStringIncludes(
      message,
      "This source fell behind the trunk and no declared environment can compose it here. Declare execution.local, or run discern update in this worktree, then discern done.",
    );
    assert(!/candidate/.test(message), message);
  });
});
