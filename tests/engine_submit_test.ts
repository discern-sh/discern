/** Queue-only admission uses the public core and leaves validation and landing untouched. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { project } from "./completion_public_fixture.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { lifecycleContext } from "../src/engine/worktree/lifecycle.ts";
import { submitResult } from "../src/engine/worktree/submit.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { Logger } from "../src/lib/log.ts";
import { SubmitOutputSchema } from "../src/shared/result_schemas.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";

Deno.test("submission plans, queues idempotently, and rejects changed or unproven work", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const context = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    assertEquals((await submitResult(context)).ok, false);
    assertEquals(await readSubmission(path), { status: "missing" });
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const trunk = await gitOut(root, "rev-parse", "main");
    const preview = await submitResult(context, { dryRun: true });
    assert(preview.ok && preview.data !== undefined, JSON.stringify(preview));
    assertEquals(await readSubmission(path), { status: "missing" });
    const reviewed = preview.data;
    await assertRejects(() =>
      submitResult(context, {
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
      (await submitResult(context, { expected: preview.data })).ok,
      false,
    );
    await git(path, "branch", "-m", branch);
    const queued = await submitResult(context, { expected: preview.data });
    assert(queued.ok, JSON.stringify(queued));
    SubmitOutputSchema.parse(serializeResult(queued));
    const record = await readSubmission(path);
    assertEquals((await submitResult(context)).data, queued.data);
    assertEquals(await readSubmission(path), record);
    const renewed = await runAgent(path, ["done", "--json"]);
    assertEquals(renewed.code, 0, renewed.output);
    const refreshed = await submitResult(context);
    assert(refreshed.ok && refreshed.data !== undefined);
    assertEquals(refreshed.data.submission_id, queued.data?.submission_id);
    assertEquals(refreshed.data.submitted_at, queued.data?.submitted_at);
    const currentRecord = await readSubmission(path);
    assertEquals(await gitOut(root, "rev-parse", "main"), trunk);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    await Deno.writeTextFile(`${path}/source`, "new work\n");
    assertEquals(
      (await submitResult(context, { expected: preview.data })).ok,
      false,
    );
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Advance author work");
    assertEquals(
      (await submitResult(context, { expected: preview.data })).ok,
      false,
    );
    assertEquals(await readSubmission(path), currentRecord);
  });
});
