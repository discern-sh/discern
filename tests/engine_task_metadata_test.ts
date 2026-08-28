/**
 * Task metadata lifecycle coverage: one worktree-admin record preserves human
 * wording while Git remains authoritative for id, branch, path, and ancestry.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import type {
  StartData,
  StatusWireData,
  TaskRenameData,
} from "../src/shared/result_schemas.ts";
import {
  fallbackTaskMetadataData,
  StoredTaskMetadataSchema,
  TASK_BRIEF_MAX_CODE_POINTS,
  TASK_TITLE_MAX_CODE_POINTS,
  TaskMetadataDataSchema,
  taskTextLength,
} from "../src/shared/task_metadata.ts";
import { taskMetadataPath } from "../src/engine/worktree/task_metadata.ts";
import { Logger } from "../src/lib/log.ts";
import {
  applyStartPlan,
  buildStartPlan,
  lifecycleContext,
  WorktreeGitError,
} from "../src/engine/worktree/lifecycle.ts";
import { withTempDir } from "./helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

/** Decode one successful start result. */
function startedData(stdout: string): StartData {
  const result = decodeCliResult(stdout, "start");
  assertResultDataKey(result, "path");
  return result.data;
}

/** Decode one successful task-title change. */
function renamedData(stdout: string): TaskRenameData {
  const result = decodeCliResult(stdout, "worktree rename");
  assertResultDataKey(result, "previous_title");
  return result.data;
}

/** Read one non-main row from the full status projection. */
async function fleetRow(
  main: string,
  branch: string,
): Promise<NonNullable<StatusWireData["fleet"]>[number]> {
  const status = await runAgent(main, ["status", "--verbose", "--json"]);
  assertEquals(status.code, 0, status.output);
  const result = decodeCliResult(status.stdout, "status");
  assertResultDataKey(result, "location");
  const row = result.data.fleet?.find((entry) => entry.branch === branch);
  assertExists(row, `status must include ${branch}\n${status.stdout}`);
  return row;
}

Deno.test("task metadata schemas preserve Unicode bytes and bound single-line input", () => {
  const title = `${"😀".repeat(TASK_TITLE_MAX_CODE_POINTS - 1)}é`;
  const brief = `${"λ".repeat(TASK_BRIEF_MAX_CODE_POINTS - 1)}!`;
  assertEquals(taskTextLength(title), TASK_TITLE_MAX_CODE_POINTS);
  assertEquals(taskTextLength(brief), TASK_BRIEF_MAX_CODE_POINTS);

  const parsed = StoredTaskMetadataSchema.parse({
    schema_version: 1,
    title,
    brief,
    created_from: {
      ref: "main",
      commit: "a".repeat(40),
    },
  });
  assertEquals(parsed.title, title);
  assertEquals(parsed.brief, brief);

  for (
    const invalid of [
      "",
      "   ",
      "line one\nline two",
      `control${String.fromCharCode(7)}`,
      "hidden\u200Bformat",
      "reversed\u202Etext",
      "x".repeat(TASK_TITLE_MAX_CODE_POINTS + 1),
    ]
  ) {
    assertEquals(
      StoredTaskMetadataSchema.safeParse({
        schema_version: 1,
        title: invalid,
      }).success,
      false,
      JSON.stringify(invalid),
    );
  }

  const fallback = fallbackTaskMetadataData(
    { id: "legacy", branch: "agent/legacy" },
    `legacy\u200B${"x".repeat(TASK_TITLE_MAX_CODE_POINTS + 20)}`,
  );
  assertEquals(taskTextLength(fallback.title), TASK_TITLE_MAX_CODE_POINTS);
  assertEquals(fallback.title.includes("\u200B"), false);
  assertEquals(TaskMetadataDataSchema.safeParse(fallback).success, true);
});

Deno.test("start, status, and rename round-trip human wording without changing Git identity", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const trunkCommit = await gitOut(dir, "rev-parse", "main^{commit}");
    const title = "修正: Café — v2 ✓";
    const brief = "Keep punctuation: α/β, please.";

    const started = await runAgent(dir, [
      "start",
      "--name",
      "Stable ID Seed",
      "--title",
      title,
      "--brief",
      brief,
      "--from",
      "main",
      "--json",
    ]);
    assertEquals(started.code, 0, started.output);
    const data = startedData(started.stdout);
    assertEquals(data.task.title, title);
    assertEquals(data.task.brief, brief);
    assertEquals(data.task.title_source, "recorded");
    assertEquals(data.task.id, data.id);
    assertEquals(data.task.branch, data.branch);
    assertEquals(data.task.created_from, {
      ref: "main",
      commit: trunkCommit,
    });
    assert(data.name_note !== undefined, started.stdout);
    assert(!data.id.includes("Café"), "stable identity must be normalized");
    assertEquals(
      await gitOut(data.path, "branch", "--show-current"),
      data.branch,
    );

    const initialRow = await fleetRow(dir, data.branch);
    assertEquals(initialRow.task, data.task);

    const renamedTitle = "新しい題名: Café ✓";
    const renamed = await runAgent(data.path, [
      "worktree",
      "rename",
      renamedTitle,
      "--json",
    ]);
    assertEquals(renamed.code, 0, renamed.output);
    const renamedTask = renamedData(renamed.stdout);
    assertEquals(renamedTask.previous_title, title);
    assertEquals(renamedTask.path, data.path);
    assertEquals(renamedTask.task.title, renamedTitle);
    assertEquals(renamedTask.task.brief, brief);
    assertEquals(renamedTask.task.created_from, data.task.created_from);
    assertEquals(renamedTask.task.id, data.id);
    assertEquals(renamedTask.task.branch, data.branch);
    assertEquals(
      await gitOut(data.path, "branch", "--show-current"),
      data.branch,
    );

    const renamedRow = await fleetRow(dir, data.branch);
    assertEquals(renamedRow.task, renamedTask.task);
  });
});

Deno.test("a retained start preview applies the same identity and exact base", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
      dir,
    );
    const prepared = await buildStartPlan(ctx, {
      worktreeRoot: `${dir}.worktrees`,
      title: "Retain preview identity 修复",
      brief:
        "Apply the exact id, branch, path, and base shown before confirmation.",
    });
    const applied = await applyStartPlan(ctx, prepared);
    assert(applied.ok);
    assertExists(applied.data);
    assertEquals(applied.data.id, prepared.plan.id);
    assertEquals(applied.data.branch, prepared.plan.branch);
    assertEquals(applied.data.path, prepared.plan.worktreePath);
    assertEquals(applied.data.task.title, prepared.plan.title);
    assertEquals(applied.data.task.brief, prepared.plan.brief);
    assertEquals(
      await gitOut(applied.data.path, "rev-parse", "HEAD"),
      prepared.plan.fromCommit,
    );
  });
});

Deno.test("a retained start preview refuses when its source moves", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const base = await addWorktree(dir, "moving-base");
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
      dir,
    );
    const prepared = await buildStartPlan(ctx, {
      worktreeRoot: `${dir}.worktrees`,
      title: "Stale preview",
      from: "agent/moving-base",
    });
    await Deno.writeTextFile(join(base, "move-base.txt"), "new base\n");
    await git(base, "add", "move-base.txt");
    await git(base, "commit", "-q", "-m", "move base", "--no-gpg-sign");

    await assertRejects(
      () => applyStartPlan(ctx, prepared),
      WorktreeGitError,
      "moved after the start preview",
    );
    assertEquals(await targetExists(prepared.plan.worktreePath), false);
    const branch = await runAgent(dir, [
      "status",
      "--json",
    ]);
    assertEquals(branch.code, 0, branch.output);
    assertEquals(
      await gitOut(dir, "branch", "--list", prepared.plan.branch),
      "",
    );
  });
});

Deno.test("legacy and malformed task records have distinct status fallbacks", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "legacy-task");
    const branch = "agent/legacy-task";

    const legacy = await fleetRow(dir, branch);
    assertEquals(legacy.task?.title, "Legacy task");
    assertEquals(legacy.task?.title_source, "identity-fallback");
    assertEquals(legacy.task?.brief, undefined);

    const record = await taskMetadataPath(worktree);
    assertExists(record);
    await Deno.mkdir(join(record, ".."), { recursive: true });
    await Deno.writeTextFile(record, "{not-json\n");

    const unavailable = await fleetRow(dir, branch);
    assertEquals(unavailable.task?.title, "Legacy task");
    assertEquals(unavailable.task?.title_source, "unavailable-fallback");
    assertStringIncludes(
      unavailable.task?.unavailable_reason ?? "",
      "not valid JSON",
    );

    const refused = await runAgent(worktree, [
      "worktree",
      "rename",
      "A valid title",
      "--json",
    ]);
    assertEquals(refused.code, 1, refused.output);
    const result = decodeCliResult(refused.stdout, "worktree rename");
    assertEquals(result.ok, false);
    assertStringIncludes(result.message ?? "", "not valid JSON");
  });
});

Deno.test("rename enrolls a legacy worktree and rejects invalid titles without changing metadata", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "legacy-enrollment");
    const branch = "agent/legacy-enrollment";
    const title = "Unicode title: Δοκιμή ✨";

    const enrolled = await runAgent(worktree, [
      "worktree",
      "rename",
      title,
      "--json",
    ]);
    assertEquals(enrolled.code, 0, enrolled.output);
    assertEquals(renamedData(enrolled.stdout).task.title_source, "recorded");

    for (
      const invalid of [
        "",
        "   ",
        `unsafe${String.fromCharCode(7)}`,
        "x".repeat(TASK_TITLE_MAX_CODE_POINTS + 1),
      ]
    ) {
      const refused = await runAgent(worktree, [
        "worktree",
        "rename",
        invalid,
        "--json",
      ]);
      assertEquals(refused.code, 1, refused.output);
      const result = decodeCliResult(refused.stdout, "worktree rename");
      assertEquals(result.ok, false);
      assertStringIncludes(result.message ?? "", "Task title");
    }

    assertEquals((await fleetRow(dir, branch)).task?.title, title);
  });
});

Deno.test("creation source records trunk, a live task, and an unlanded branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const live = await addWorktree(dir, "live-base");
    await Deno.writeTextFile(join(live, "live-base.txt"), "live base\n");
    await git(live, "add", "live-base.txt");
    await git(live, "commit", "-q", "-m", "add live base", "--no-gpg-sign");
    const liveCommit = await gitOut(live, "rev-parse", "HEAD");
    const followUp = await runAgent(dir, [
      "start",
      "--name",
      "follow-up",
      "--from",
      "agent/live-base",
      "--json",
    ]);
    assertEquals(followUp.code, 0, followUp.output);
    const followUpData = startedData(followUp.stdout);
    assertEquals(followUpData.from, "agent/live-base");
    assertEquals(followUpData.task.created_from, {
      ref: "agent/live-base",
      commit: liveCommit,
    });
    assertEquals(
      await gitOut(followUpData.path, "rev-parse", "HEAD"),
      liveCommit,
    );

    const orphanWorktree = await addWorktree(dir, "orphan-base");
    await Deno.writeTextFile(
      join(orphanWorktree, "orphan-base.txt"),
      "orphan base\n",
    );
    await git(orphanWorktree, "add", "orphan-base.txt");
    await git(
      orphanWorktree,
      "commit",
      "-q",
      "-m",
      "add orphan base",
      "--no-gpg-sign",
    );
    const orphanCommit = await gitOut(orphanWorktree, "rev-parse", "HEAD");
    await git(dir, "worktree", "remove", orphanWorktree);

    const resumed = await runAgent(dir, [
      "start",
      "--name",
      "resume-orphan",
      "--from",
      "agent/orphan-base",
      "--json",
    ]);
    assertEquals(resumed.code, 0, resumed.output);
    const resumedData = startedData(resumed.stdout);
    assertEquals(resumedData.from, "agent/orphan-base");
    assertEquals(resumedData.task.created_from, {
      ref: "agent/orphan-base",
      commit: orphanCommit,
    });
    assertEquals(
      await gitOut(resumedData.path, "rev-parse", "HEAD"),
      orphanCommit,
    );
  });
});

Deno.test("task metadata follows a worktree move and is removed with its registration", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const started = await runAgent(dir, [
      "start",
      "--name",
      "move-me",
      "--title",
      "Move this title intact",
      "--brief",
      "The record follows Git administration state.",
      "--json",
    ]);
    assertEquals(started.code, 0, started.output);
    const data = startedData(started.stdout);
    const recordBefore = await taskMetadataPath(data.path);
    assertExists(recordBefore);
    assert(await targetExists(recordBefore));

    const movedPath = join(`${dir}.worktrees`, "moved-task-checkout");
    await git(dir, "worktree", "move", data.path, movedPath);
    const recordAfter = await taskMetadataPath(movedPath);
    assertEquals(recordAfter, recordBefore);
    assertEquals((await fleetRow(dir, data.branch)).task, data.task);

    const dropped = await runAgent(dir, [
      "worktree",
      "drop",
      movedPath,
      "--force",
      "--json",
    ]);
    assertEquals(dropped.code, 0, dropped.output);
    assertEquals(await targetExists(movedPath), false);
    assertEquals(await targetExists(recordBefore), false);
  });
});
