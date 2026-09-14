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
import { git } from "./engine_helpers.ts";

Deno.test("Drop refuses stale content, revision and branch reviews, then applies only the refreshed exact plan", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const ctx = await lifecycleContext(
      root,
      new Logger({ json: true, noColor: true }),
    );
    const initial = await worktreeDropPlan(ctx, path);
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
    await worktreeDrop(ctx, path, { force: true, expected: fresh.subject });
    assertEquals(await targetExists(path), false);
    // Disappearance cannot redirect the same confirmation to another checkout.
    await assertRejects(
      () => worktreeDrop(ctx, path, { force: true, expected: fresh.subject }),
      WorktreeGitError,
    );
  });
});
