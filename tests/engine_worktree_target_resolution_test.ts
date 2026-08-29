/**
 * One resolver owns every user-supplied name for a line of work. The table is
 * deliberately expressed in stable product forms rather than per-verb examples:
 * every present and future caller gets the same id/path/branch/ref equivalence by
 * consuming this resolver, while mode narrows what the caller may act on.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { awaitResult } from "../src/engine/await/await.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";
import {
  resolveWorktreeTarget,
  WorktreeTargetError,
} from "../src/engine/worktree/target_resolution.ts";

Deno.test("worktree target resolver: stable forms identify the same registered line of work", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "shared-target");
    const path = await Deno.realPath(worktree);
    const head = await gitOut(worktree, "rev-parse", "HEAD");
    const forms = [
      { kind: "worktree id", value: "shared-target" },
      { kind: "worktree path", value: path },
      { kind: "local branch", value: "agent/shared-target" },
      { kind: "full local ref", value: "refs/heads/agent/shared-target" },
    ];

    for (const form of forms) {
      const resolved = await resolveWorktreeTarget(dir, form.value, {
        cwd: dir,
        mode: "registered",
        includeMain: false,
        command: "discern test consumer",
      });
      assertEquals(resolved.id, "shared-target", form.kind);
      assertEquals(resolved.path, path, form.kind);
      assertEquals(resolved.branch, "agent/shared-target", form.kind);
      assertEquals(resolved.ref, "refs/heads/agent/shared-target", form.kind);
      assertEquals(resolved.commit, head, form.kind);
    }
  });
});

Deno.test("worktree target resolver: branch and commit consumers share aliases without losing Git refs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "source-target");
    const path = await Deno.realPath(worktree);
    const head = await gitOut(worktree, "rev-parse", "HEAD");
    const forms = [
      { value: "source-target", sourceRef: "refs/heads/agent/source-target" },
      { value: path, sourceRef: "refs/heads/agent/source-target" },
      { value: "agent/source-target", sourceRef: "agent/source-target" },
      {
        value: "refs/heads/agent/source-target",
        sourceRef: "refs/heads/agent/source-target",
      },
    ];

    for (const form of forms) {
      const branch = await resolveWorktreeTarget(dir, form.value, {
        cwd: dir,
        mode: "branch",
        command: "discern await",
      });
      assertEquals(branch.branch, "agent/source-target", form.value);
      assertEquals(branch.commit, head, form.value);

      const source = await resolveWorktreeTarget(dir, form.value, {
        cwd: dir,
        mode: "commit",
        command: "discern update --from",
      });
      assertEquals(source.ref, form.sourceRef, form.value);
      assertEquals(source.commit, head, form.value);
    }

    await git(dir, "worktree", "remove", worktree);
    const retainedBranch = await resolveWorktreeTarget(dir, "source-target", {
      cwd: dir,
      mode: "commit",
      command: "discern start --from",
    });
    assertEquals(retainedBranch.branch, "agent/source-target");
    assertEquals(retainedBranch.commit, head);

    await git(dir, "tag", "release-source", "main");
    const tag = await resolveWorktreeTarget(dir, "release-source", {
      cwd: dir,
      mode: "commit",
      command: "discern update --from",
    });
    assertEquals(tag.ref, "release-source");
    assertEquals(tag.commit, await gitOut(dir, "rev-parse", "main"));
  });
});

Deno.test("worktree target resolver: cross-vocabulary collisions refuse instead of guessing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "collision");
    await git(worktree, "commit", "--allow-empty", "-m", "worktree tip");
    await git(dir, "tag", "collision", "main");

    const error = await assertRejects(
      () =>
        resolveWorktreeTarget(dir, "collision", {
          cwd: dir,
          mode: "commit",
          command: "discern update --from",
        }),
      WorktreeTargetError,
      "ambiguous",
    );
    assertStringIncludes(error.message, "refs/tags/collision");
    assertStringIncludes(error.message, "agent/collision");
  });
});

Deno.test("branch-oriented commands accept an unambiguous worktree id or path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const source = await addWorktree(dir, "command-source");
    const caller = await addWorktree(dir, "command-caller");

    for (const target of ["command-source", await Deno.realPath(source)]) {
      const awaited = await awaitResult(dir, {
        landed: target,
        timeoutSeconds: 0,
      });
      assertEquals(awaited.ok, true, target);
      assertEquals(awaited.data?.met, false, target);
    }

    const start = await runAgent(dir, [
      "start",
      "--json",
      "--dry-run",
      "--name",
      "alias-child",
      "--from",
      "command-source",
    ]);
    assertEquals(start.code, 0, start.output);
    assertStringIncludes(start.stdout, "refs/heads/agent/command-source");

    const update = await runAgent(caller, [
      "update",
      "--json",
      "--dry-run",
      "--from",
      await Deno.realPath(source),
    ]);
    assertEquals(update.code, 0, update.output);
    assertStringIncludes(update.stdout, "refs/heads/agent/command-source");
  });
});

Deno.test("worktree-oriented commands accept an unambiguous branch or full ref", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "command-target");
    const marker = await readySentinelPath(worktree);
    if (marker === undefined) throw new Error("fixture has no worktree marker");
    await Deno.mkdir(dirname(marker), { recursive: true });
    await Deno.writeTextFile(marker, "");

    for (
      const target of [
        "agent/command-target",
        "refs/heads/agent/command-target",
      ]
    ) {
      const identity = await runAgent(dir, ["identity", "--id", target]);
      assertEquals(identity.code, 0, identity.output);
      assertEquals(identity.stdout, "command-target\n");

      const park = await runAgent(dir, [
        "worktree",
        "park",
        target,
        "--dry-run",
        "--json",
      ]);
      assertEquals(park.code, 0, park.output);

      const drop = await runAgent(dir, [
        "worktree",
        "drop",
        target,
        "--dry-run",
        "--json",
      ]);
      assertEquals(drop.code, 0, drop.output);
    }
  });
});
