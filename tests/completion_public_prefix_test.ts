import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
/** Active public actors coordinate a separately authorized prefix and recover from competing actors. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

const declaration = `
[execution.local]
kind = 'borrowed'
capacity = 1
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`;

Deno.test("fresh public accept retires its cwd after landing a granted prefix and preserves another queued source", async () => {
  await withTempDir(async (root) => {
    const first = await project(root, ["local"], declaration);
    const second = await addWorktree(root, "second");
    await Deno.writeTextFile(`${second}/second-source`, "second author\n");
    await git(second, "add", "second-source");
    await git(second, "commit", "-m", "Author second source");
    const waiting = await addWorktree(root, "waiting");
    await Deno.writeTextFile(`${waiting}/waiting-source`, "waiting author\n");
    await git(waiting, "add", "waiting-source");
    await git(waiting, "commit", "-m", "Author waiting source");
    const waitingHead = await gitOut(waiting, "rev-parse", "HEAD");
    for (const path of [first, second, waiting]) {
      const done = await runAgent(path, ["done", "--json"]);
      assertEquals(done.code, 0, done.output);
    }
    const firstHead = await gitOut(first, "rev-parse", "HEAD");
    const secondHead = await gitOut(second, "rev-parse", "HEAD");
    await grantEffort(
      first,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    await grantEffort(
      second,
      "agent/second",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const accepted = await runAgent(second, ["accept", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assert(
      result.data !== undefined && "queue" in result.data,
      accepted.output,
    );
    assertEquals(
      result.data.queue?.map(
        (row) => [row.source_head, row.state, row.retirement],
      ),
      [[firstHead, "landed", "retired"], [secondHead, "landed", "retired"]],
    );
    assertEquals(await Deno.readTextFile(`${root}/source`), "authored\n");
    assertEquals(
      await Deno.readTextFile(`${root}/second-source`),
      "second author\n",
    );
    assertEquals(await gitOut(waiting, "rev-parse", "HEAD"), waitingHead);
    assertEquals(
      await Deno.readTextFile(`${waiting}/waiting-source`),
      "waiting author\n",
    );
    const records = observedRecords(await observeQueue(root, "main"));
    const landings = records.filter((record) => record.kind === "landing");
    assertEquals(landings.length, 2);
    assertEquals(
      new Set(
        landings.map((record) =>
          record.data.claim.kind === "normal"
            ? record.data.claim.authority_id
            : null
        ),
      ).size,
      2,
    );
    assert(
      landings.every((record) =>
        record.data.outcome.kind === "landed" &&
        record.data.authority_settlement === "consumed"
      ),
    );
  });
});

Deno.test("two public accept processes produce one landing and spend one desk grant", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    await grantEffort(
      path,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const results = await Promise.all([
      runAgent(root, ["accept", "--json"]),
      runAgent(root, ["accept", "--json"]),
    ]);
    assert(
      results.some((result) => result.code === 0),
      results.map((result) => result.output).join("\n"),
    );
    const retried = await runAgent(root, ["accept", "--json"]);
    assertEquals(retried.code, 0, retried.output);
    const records = observedRecords(await observeQueue(root, "main"));
    assertEquals(
      records.filter((record) =>
        record.kind === "landing" && record.data.outcome.kind === "landed"
      ).length,
      1,
    );
    assertEquals(
      records.filter((record) =>
        record.kind === "authority" && record.data.state.kind === "consumed"
      ).length,
      1,
    );
  });
});

Deno.test("accept preserves a landed predecessor and each preview when the next candidate lacks a released composition environment", async () => {
  await withTempDir(async (root) => {
    const first = await project(
      root,
      ["local"],
      `
[scopes.first]
paths = ['source']
preview = 'echo preview-first'
[scopes.second]
paths = ['second-source']
preview = 'echo preview-second'
`,
    );
    const second = await addWorktree(root, "second");
    await Deno.writeTextFile(`${second}/second-source`, "second author\n");
    await git(second, "add", "second-source");
    await git(second, "commit", "-m", "Author separate source");
    for (
      const [path, branch] of [[first, "agent/public-done"], [
        second,
        "agent/second",
      ]] as const
    ) {
      const done = await runAgent(path, ["done", "--json"]);
      assertEquals(done.code, 0, done.output);
      await grantEffort(path, branch, wallTimeIso(SYSTEM_CLOCK.wallNow()));
    }
    const unselected = await runAgent(root, ["accept", "--dry-run", "--json"]);
    assertEquals(unselected.code, 1, unselected.output);
    assertEquals(
      decodeCliResult(unselected.stdout, "accept").error,
      "no_target",
    );
    const preview = await runAgent(root, [
      "accept",
      "--target",
      "agent/second",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    const planned = decodeCliResult(preview.stdout, "accept");
    assert(planned.data !== undefined && "queue" in planned.data);
    assertEquals(
      planned.data.queue?.map((row) =>
        row.preview_actions?.map((action) => action.command)
      ),
      [["echo preview-first"], ["echo preview-second"]],
    );
    assertEquals(
      observedRecords(await observeQueue(root, "main")).filter((record) =>
        record.kind === "landing"
      ).length,
      0,
    );
    const accepted = await runAgent(root, [
      "accept",
      "--target",
      "agent/second",
      "--json",
    ]);
    assertEquals(accepted.code, 1, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assert(result.data !== undefined && "queue" in result.data);
    assertEquals(result.error, "partial_acceptance");
    assertEquals(result.data.queue?.map((row) => row.state), [
      "landed",
      "pending",
    ]);
    assert(result.data.queue?.every((row) => row.authority_id !== null));
    assert(
      result.data.queue?.at(-1)?.pending.some((condition) =>
        condition.kind === "environment-unavailable"
      ),
      accepted.output,
    );
    assertEquals(
      await Deno.readTextFile(`${second}/executions`),
      "t",
      "No producer runs without an eligible environment",
    );
  });
});
