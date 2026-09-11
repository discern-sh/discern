import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
/** Active public actors coordinate a separately authorized prefix and recover from competing actors. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";

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

Deno.test("accept from a worktree leads with that effort's own verdict when the walk stops ahead of it", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const first = await project(
        root,
        ["local"],
        declaration,
        `if test -f ${
          quoteCommandWord(aux + "/fail")
        }; then exit 1; fi; printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'`,
      );
      const middle = await addWorktree(root, "middle");
      await Deno.writeTextFile(`${middle}/middle-source`, "middle author\n");
      await git(middle, "add", "middle-source");
      await git(middle, "commit", "-m", "Author middle source");
      const last = await addWorktree(root, "last");
      await Deno.writeTextFile(`${last}/last-source`, "last author\n");
      await git(last, "add", "last-source");
      await git(last, "commit", "-m", "Author last source");
      for (const path of [first, middle]) {
        const done = await runAgent(path, ["done", "--json"]);
        assertEquals(done.code, 0, done.output);
      }
      await Deno.writeTextFile(`${aux}/fail`, "fail\n");
      const red = await runAgent(last, ["done", "--json"]);
      assertEquals(red.code, 1, red.output);
      await Deno.remove(`${aux}/fail`);
      const firstHead = await gitOut(first, "rev-parse", "HEAD");
      await grantEffort(
        first,
        "agent/public-done",
        wallTimeIso(SYSTEM_CLOCK.wallNow()),
      );
      // The owner runs accept in the last worktree. The approved first effort
      // lands, the unapproved middle effort stops the walk, and the answer must
      // still be about the effort the owner is standing in.
      const accepted = await runAgent(last, ["accept", "--json"]);
      assertEquals(accepted.code, 1, accepted.output);
      const result = decodeCliResult(accepted.stdout, "accept");
      assert(
        result.data !== undefined && "queue" in result.data,
        accepted.output,
      );
      const rows = result.data.queue ?? [];
      assertEquals(
        rows.map((row) => [row.effort, row.state]),
        [["public-done", "landed"], ["middle", "pending"], ["last", "pending"]],
      );
      const own = rows.at(-1);
      assertEquals(own?.pending[0]?.kind, "not-reached");
      assert(
        own?.pending.some((item) =>
          item.kind === "missing-evidence" || item.kind === "validation-failed"
        ),
        accepted.output,
      );
      assert(
        result.message?.startsWith(
          "Selected effort `agent/last`: not landed.\n- Acceptance stopped at agent/middle",
        ),
        result.message,
      );
      assertEquals(result.data.continuation, "discern accept --target last");
      // The first paragraph is the verdict, where the walk stopped, and the one
      // reason the owner acts on; every other assessed condition follows under
      // its own label, so identifiers and record vocabulary never lead.
      const [lead = "", ...after] = (result.message ?? "").split("\n\n");
      assertEquals(
        lead,
        [
          "Selected effort `agent/last`: not landed.",
          "- Acceptance stopped at agent/middle, which is ahead of this effort in the queue.",
          "- Its checks failed; rerun discern done from its worktree.",
        ].join("\n"),
      );
      assert(
        !/[0-9a-f]{8}-[0-9a-f]{4}-|candidate|prefix|claim|convergence|retirement/
          .test(lead),
        lead,
      );
      const details = after.find((section) =>
        section.startsWith("Details for `agent/last`:")
      );
      assert(details !== undefined, result.message);
      assertStringIncludes(details, "has no passing evidence from attempt");
      assertEquals(await gitOut(root, "rev-parse", "main"), firstHead);
      const preview = await runAgent(last, ["accept", "--dry-run", "--json"]);
      assertEquals(preview.code, 0, preview.output);
      const previewed = decodeCliResult(preview.stdout, "accept");
      assert(
        previewed.message?.startsWith(
          "Selected effort `agent/last`: not ready.",
        ),
        previewed.message,
      );
      assert(
        previewed.data !== undefined && "queue" in previewed.data,
        preview.output,
      );
      assertEquals(
        previewed.data.queue?.at(-1)?.effort,
        "last",
        preview.output,
      );
    });
  });
});
