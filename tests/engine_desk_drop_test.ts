/** A destructive confirmation belongs to one exact checkout and content snapshot. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Logger } from "../src/lib/log.ts";
import {
  DropWouldDiscardWork,
  lifecycleContext,
  worktreeDrop,
  worktreeDropPlan,
  WorktreeGitError,
} from "../src/engine/worktree/lifecycle.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";

Deno.test("Drop refuses stale content, revision, branch and grant reviews, then applies only the refreshed exact plan", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const ctx = await lifecycleContext(
      root,
      new Logger({ json: true, noColor: true }),
    );
    const initial = await worktreeDropPlan(ctx, path);
    assertEquals(
      [initial.subject.endsGrant, initial.subject.leavesQueue],
      [false, false],
      "the plan names no landing record it would end",
    );
    await assertRejects(
      () => worktreeDrop(ctx, path, { expected: initial.subject }),
      DropWouldDiscardWork,
    );
    for (
      const change of [
        async () => {
          await Deno.writeTextFile(`${path}/executions`, "new ignored work\n");
        },
        async () => {
          await Deno.writeTextFile(
            `${path}/executions`,
            "changed ignored work\n",
          );
        },
        async () => {
          await Deno.writeTextFile(`${path}/source`, "changed after review\n");
        },
        async () => {
          await git(path, "add", "source");
          await git(path, "commit", "-m", "Change reviewed commit");
        },
        async () => {
          await git(path, "branch", "-m", "agent/changed-after-review");
        },
        async () => {
          await Deno.writeTextFile(`${path}/untracked`, "new untracked work\n");
        },
        async () => {
          await Deno.writeTextFile(
            `${path}/untracked`,
            "different untracked work\n",
          );
        },
        // A grant recorded after the review is a landing record the reviewed
        // plan did not say it would end.
        async () => {
          await grantEffort(
            path,
            await gitOut(path, "branch", "--show-current"),
            "2026-09-12T10:00:00.000Z",
          );
        },
      ]
    ) {
      const before = await worktreeDropPlan(ctx, path);
      await change();
      await assertRejects(
        () =>
          worktreeDrop(ctx, path, { force: true, expected: before.subject }),
        WorktreeGitError,
        "reviewed Drop target or its work changed",
      );
      assert(await targetExists(path));
    }
    const fresh = await worktreeDropPlan(ctx, path);
    assertEquals(fresh.subject.endsGrant, true);
    assert(fresh.details.includes("Landing grant:  removed"));
    await worktreeDrop(ctx, path, { force: true, expected: fresh.subject });
    assertEquals(await targetExists(path), false);
    // Disappearance cannot redirect the same confirmation to another checkout.
    await assertRejects(
      () => worktreeDrop(ctx, path, { force: true, expected: fresh.subject }),
      WorktreeGitError,
    );
  });
});
