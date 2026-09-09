/** Public wrappers must share checkout ownership with legitimate queued children. */
import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { completionMcpPeer } from "./completion_mcp_fixture.ts";
import {
  AcceptOutputSchema,
  FinishOutputSchema,
} from "../src/shared/result_schemas.ts";

Deno.test("public prepare and done run queued canary and test children, then MCP release and acceptance preserve ownership", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[gate]
concurrent_test_runs = 1
[jobs.canary]
stage = 'check'
run = "discern queue -- sh -c 'printf c >> executions'"
`,
      "discern queue -- sh -c \"printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'\"",
    );
    const source = await gitOut(path, "rev-parse", "HEAD");
    const prepare = await runAgent(path, ["prepare", "--json"]);
    assertEquals(prepare.code, 0, prepare.output);
    const done = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(
      [...(await Deno.readTextFile(`${path}/executions`))].sort().join(""),
      "cct",
    );
    await using peer = await completionMcpPeer(root);
    await peer.call(2, "discern_done", { path, release_checkout: true });
    const released = z.object({ structuredContent: FinishOutputSchema }).parse(
      (await peer.response(2)).result,
    ).structuredContent;
    assert(released.ok, JSON.stringify(released));
    await peer.call(3, "discern_accept", {
      path: root,
      target: "public-done",
      confirmed: true,
      dry_run: true,
    });
    const preview = z.object({ structuredContent: AcceptOutputSchema }).parse(
      (await peer.response(3)).result,
    ).structuredContent;
    assert(
      preview.ok && preview.data !== undefined && "pending" in preview.data,
      JSON.stringify(preview),
    );
    assertEquals(preview.data.pending, []);
    await peer.call(4, "discern_accept", {
      path: root,
      target: "public-done",
      confirmed: true,
    });
    const landed = z.object({ structuredContent: AcceptOutputSchema }).parse(
      (await peer.response(4)).result,
    ).structuredContent;
    assert(landed.ok, JSON.stringify(landed));
    assertEquals(await gitOut(root, "rev-parse", "main"), source);
  });
});
