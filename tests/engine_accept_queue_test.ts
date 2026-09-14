/** Queue-only admission uses the public core and leaves validation and landing untouched. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { project } from "./completion_public_fixture.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { lifecycleContext } from "../src/engine/worktree/lifecycle.ts";
import {
  acceptLandingResult,
  type AcceptRequest,
} from "../src/engine/worktree/accept.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { Logger } from "../src/lib/log.ts";
import {
  AcceptDataSchema,
  AcceptOutputSchema,
} from "../src/shared/result_schemas.ts";
import type { AcceptData } from "../src/shared/result_schemas.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";

Deno.test("accept queue-only plans, queues idempotently, and rejects changed or unproven work", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const context = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    const queue = (
      request: Partial<AcceptRequest> = {},
    ): Promise<DiscernResult<AcceptData>> =>
      acceptLandingResult(context, {
        queueOnly: true,
        dryRun: false,
        confirmed: false,
        variance: [],
        approveStandard: [],
        met: [],
        ...request,
      });
    for (
      const request of [
        { confirmed: true },
        { variance: ["question"] },
        { approveStandard: ["token"] },
        { met: ["question"] },
        { unmet: { id: "question", why: "reason" } },
        { composition: "receipt" },
      ]
    ) {
      assertEquals((await queue(request)).error, "invalid_arguments");
    }
    assertEquals((await queue()).ok, false);
    assertEquals(await readSubmission(path), { status: "missing" });
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const trunk = await gitOut(root, "rev-parse", "main");
    const preview = await queue({ dryRun: true });
    assert(
      preview.ok && preview.data?.revision !== undefined,
      JSON.stringify(preview),
    );
    assertEquals(await readSubmission(path), { status: "missing" });
    const reviewed = preview.data.revision;
    await assertRejects(() =>
      queue({
        expected: reviewed,
        signal: AbortSignal.abort(),
      })
    );
    assertEquals(
      await readSubmission(path),
      { status: "missing" },
      "cancellation cannot queue",
    );
    const branch = await gitOut(path, "branch", "--show-current");
    await git(path, "branch", "-m", "agent/changed-during-review");
    assertEquals(
      (await queue({ expected: reviewed })).ok,
      false,
    );
    await git(path, "branch", "-m", branch);
    const cliPreview = await runAgent(root, [
      "accept",
      "--queue-only",
      "--target",
      branch,
      "--dry-run",
      "--json",
    ]);
    assertEquals(cliPreview.code, 0, cliPreview.output);
    assertEquals(
      decodeCliResult(cliPreview.stdout, "accept").data,
      AcceptOutputSchema.parse(serializeResult(preview)).data,
    );
    assertEquals(await readSubmission(path), { status: "missing" });
    const tool = TOOLS.find((tool) => tool.name === "discern_accept");
    assert(tool !== undefined);
    assertEquals(TOOLS.some((tool) => tool.name === "discern_submit"), false);
    const working = new WorkingRoot(root);
    const mcp = await runTool(
      tool,
      working,
      { action: "queue", target: branch },
      undefined,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
      TEST_CLI_MODEL,
    );
    const queued = AcceptOutputSchema.parse(mcp.structuredContent);
    assertEquals(working.get(), root, "queueing keeps the MCP checkout");
    assert(queued.ok, JSON.stringify(queued));
    const queuedData = AcceptDataSchema.parse(queued.data);
    const reading = mcp.content.flatMap((block) =>
      block.type === "text" ? [block.text] : []
    ).join("\n");
    assertStringIncludes(reading, branch);
    assertStringIncludes(reading, reviewed.head.slice(0, 12));
    assertStringIncludes(reading, "Queued");
    assertEquals(queuedData.landing, undefined);

    const record = await readSubmission(path);
    assertEquals((await queue()).data, queuedData);
    assertEquals(await readSubmission(path), record);
    const cliQueued = await runAgent(path, [
      "accept",
      "--queue-only",
      "--json",
    ]);
    assertEquals(cliQueued.code, 0, cliQueued.output);
    assertEquals(decodeCliResult(cliQueued.stdout, "accept").data, queued.data);
    const mixed = await runAgent(path, [
      "accept",
      "emergency",
      "--queue-only",
      "--reason",
      "review",
      "--json",
    ]);
    assertEquals(
      decodeCliResult(mixed.stdout, "accept").error,
      "invalid_arguments",
    );
    const renewed = await runAgent(path, ["done", "--json"]);
    assertEquals(renewed.code, 0, renewed.output);
    const refreshed = await queue();
    assert(refreshed.ok && refreshed.data !== undefined);
    assertEquals(
      refreshed.data.submission?.submission_id,
      queuedData.submission?.submission_id,
    );
    assertEquals(
      refreshed.data.submission?.submitted_at,
      queuedData.submission?.submitted_at,
    );
    const currentRecord = await readSubmission(path);
    assertEquals(await gitOut(root, "rev-parse", "main"), trunk);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    await Deno.writeTextFile(`${path}/source`, "new work\n");
    assertEquals(
      (await queue({ expected: reviewed })).ok,
      false,
    );
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Advance author work");
    assertEquals(
      (await queue({ expected: reviewed })).ok,
      false,
    );
    assertEquals(await readSubmission(path), currentRecord);
  });
});
