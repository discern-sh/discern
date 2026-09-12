/** Ordinary completion never spends producers on an uncommitted subject. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { completionMcpPeer } from "./completion_mcp_fixture.ts";
import { z } from "@zod/zod";
import { FinishOutputSchema } from "../src/shared/result_schemas.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";

Deno.test("ordinary completion refuses all uncommitted paths before producers; explicit standalone remains transient", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    await Deno.writeTextFile(`${path}/source`, "uncommitted\n");
    await Deno.writeTextFile(`${path}/staged`, "staged\n");
    await git(path, "add", "staged");
    await Deno.writeTextFile(`${path}/untracked`, "new\n");
    const direct = await finishResult(path, {
      surface: { kind: "quiet" },
      cliModel: TEST_CLI_MODEL,
    });
    const serialized = FinishOutputSchema.parse(serializeResult(direct));
    assertEquals(serialized.error, "dirty_worktree");
    assert(serialized.hints?.some((hint) => hint.includes("--standalone")));
    await using peer = await completionMcpPeer(path);
    await peer.call(2, "discern_done", { path });
    const mcp = z.object({ structuredContent: FinishOutputSchema }).parse(
      (await peer.response(2)).result,
    ).structuredContent;
    assertEquals(mcp.error, "dirty_worktree");
    assert(mcp.data !== undefined && "gate_ran" in mcp.data);
    assertEquals(mcp.data.gate_ran, false);
    for (const flags of [[], ["--rerun"], ["--ci"], ["--dry-run"]]) {
      const refused = await runAgent(path, ["done", ...flags, "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const result = decodeCliResult(refused.stdout, "done");
      assertEquals(result.error, "dirty_worktree", refused.output);
      for (
        const name of [
          "source",
          "staged",
          "untracked",
          "prepare",
          "test",
          "--standalone",
        ]
      ) {
        assert(refused.output.includes(name), refused.output);
      }
      assertEquals(await pathExists(`${path}/executions`), false);
      assertEquals((await observeCompletionRecords(root)).records, []);
    }
    const diagnostic = await runAgent(path, ["done", "--standalone", "--json"]);
    assertEquals(diagnostic.code, 0, diagnostic.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    assertEquals((await observeCompletionRecords(root)).records, []);
  });
});

Deno.test("completion without a first commit refuses before gate selection", async () => {
  await withTempDir(async (root) => {
    await git(root, "init");
    const { completionTreeRefusal } = await import(
      "../src/engine/gate/complete_gate.ts"
    );
    const refusal = await completionTreeRefusal(root);
    assert(refusal !== undefined);
    FinishOutputSchema.parse(serializeResult(refusal));
    assertEquals(refusal?.error, "dirty_worktree");
    assertEquals(refusal?.data?.producer_executions, {});
    assertEquals(await completionTreeRefusal(root, true), undefined);
  });
});
