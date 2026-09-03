/** Branch-preserving Park lifecycle: plan, refusal, cleanup, and resume. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";
import { WorktreeGitError } from "../src/engine/worktree/git.ts";
import {
  applyStartPlan,
  buildStartPlan,
  lifecycleContext,
} from "../src/engine/worktree/lifecycle.ts";
import {
  listParkedTaskMetadata,
  readParkedTaskMetadata,
  removeParkedTaskMetadata,
  writeParkedTaskMetadata,
} from "../src/engine/worktree/parked_task_metadata.ts";
import { writeStoredTaskMetadata } from "../src/engine/worktree/task_metadata.ts";
import { TASK_METADATA_SCHEMA_VERSION } from "../src/shared/task_metadata.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { Logger } from "../src/lib/log.ts";
import { resolveWorktreeRoot } from "../src/lib/worktree_root.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

/** Mark a fixture checkout healthy without running unrelated setup hooks. */
async function markReady(worktree: string): Promise<void> {
  const marker = await readySentinelPath(worktree);
  assert(marker !== undefined);
  await Deno.mkdir(dirname(marker), { recursive: true });
  await Deno.writeTextFile(marker, "");
}

/** Create one ready linked-worktree fixture for Park lifecycle tests. */
async function fixture(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  const worktree = await addWorktree(dir, name);
  await markReady(worktree);
  return worktree;
}

/** Create a configured, setup-ready resource fixture with a clean index. */
async function resourceFixture(
  dir: string,
  name: string,
  resourceConfig: string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(
    dir,
    '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
      resourceConfig,
  );
  await gitInit(dir);
  const worktree = await addWorktree(dir, name);
  const setup = await runAgent(worktree, ["worktree", "setup"]);
  assertEquals(setup.code, 0, setup.output);
  await git(worktree, "add", "-A");
  const staged = await gitOut(worktree, "diff", "--cached", "--name-only");
  if (staged !== "") {
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "Record setup output",
      "--no-gpg-sign",
    );
  }
  return worktree;
}

Deno.test("newer parked-task metadata is diagnosed and preserved by every mutation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const branch = "agent/future-parked-task";
    const head = await gitOut(dir, "rev-parse", "HEAD");
    const current = {
      schema_version: ON_DISK_FORMATS.parkedTaskMetadata.version,
      id: "future-parked-task",
      branch,
      head,
      parked_at: "2026-09-03T10:00:00.000Z",
      task: {
        schema_version: ON_DISK_FORMATS.taskMetadata.version,
        title: "Future parked task",
      },
    } as const;
    await writeParkedTaskMetadata(dir, current);
    const directory = await gitAdminStatePath(dir, "parkedTaskMetadata");
    assert(directory !== undefined);
    const path = join(directory, `${await sha256Hex(branch)}.json`);
    const future = `${
      JSON.stringify({
        ...current,
        schema_version: ON_DISK_FORMATS.parkedTaskMetadata.version + 1,
        future_field: true,
      })
    }\n`;
    await Deno.writeTextFile(path, future);

    for (
      const operation of [
        () => readParkedTaskMetadata(dir, branch),
        () => listParkedTaskMetadata(dir),
        () => removeParkedTaskMetadata(dir, branch),
        () => writeParkedTaskMetadata(dir, current),
      ]
    ) {
      await assertRejects(operation, Error, "written by a newer discern");
      assertEquals(await Deno.readTextFile(path), future);
    }
  });
});

Deno.test("worktree park keeps committed work and metadata while removing the checkout", async () => {
  await withTempDir(async (dir) => {
    const worktree = await fixture(dir, "parked");
    await Deno.writeTextFile(join(worktree, "parked.txt"), "retained\n");
    await git(worktree, "add", "-A");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "Retain parked work",
      "--no-gpg-sign",
    );
    await writeStoredTaskMetadata(worktree, {
      schema_version: TASK_METADATA_SCHEMA_VERSION,
      title: "Recover the parser",
      brief: "Keep this context across Park and resume.",
    });
    const grantPath = await gitAdminStatePath(worktree, "effortGrant");
    const proofPath = await gitAdminStatePath(worktree, "gateProof");
    assert(grantPath !== undefined && proofPath !== undefined);
    await Deno.mkdir(dirname(grantPath), { recursive: true });
    await Deno.writeTextFile(grantPath, "retained authority fixture\n");
    await Deno.writeTextFile(proofPath, "retained proof fixture\n");
    const head = await gitOut(worktree, "rev-parse", "HEAD");

    const preview = await runAgent(dir, [
      "worktree",
      "park",
      "parked",
      "--dry-run",
    ]);
    assertEquals(preview.code, 0, preview.output);
    assertTerminalTextIncludes(preview.output, "Park plan");
    assertTerminalTextIncludes(preview.output, "Branch kept");
    assertTerminalTextIncludes(preview.output, "Landing grant: removed");
    assertTerminalTextIncludes(preview.output, "Proof: removed with checkout");
    assert(await targetExists(worktree));

    const applied = await runAgent(dir, [
      "worktree",
      "park",
      "parked",
      "--json",
    ]);
    assertEquals(applied.code, 0, applied.output);
    assertEquals(await targetExists(worktree), false, applied.output);
    assertEquals(await targetExists(grantPath), false, applied.output);
    assertEquals(await targetExists(proofPath), false, applied.output);
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/parked"),
      "agent/parked",
    );
    assertEquals(await gitOut(dir, "rev-parse", "agent/parked"), head);
    const parked = await readParkedTaskMetadata(dir, "agent/parked");
    assertEquals(parked?.task.title, "Recover the parser");
    assertEquals(parked?.head, head);
    const result = decodeCliResult(applied.stdout, "worktree park");
    assertEquals(result.ok, true);
  });
});

Deno.test("worktree park refuses dirty and setup-incomplete checkouts", async () => {
  await withTempDir(async (dir) => {
    const dirty = await fixture(dir, "dirty-park");
    await Deno.writeTextFile(join(dirty, "wip.txt"), "uncommitted\n");
    const dirtyResult = await runAgent(dir, [
      "worktree",
      "park",
      "dirty-park",
    ]);
    assertEquals(dirtyResult.code, 1, dirtyResult.output);
    assertTerminalTextIncludes(dirtyResult.output, "uncommitted changes");
    assert(await targetExists(dirty));

    const incomplete = await addWorktree(dir, "incomplete-park");
    const incompleteResult = await runAgent(dir, [
      "worktree",
      "park",
      "incomplete-park",
    ]);
    assertEquals(incompleteResult.code, 1, incompleteResult.output);
    assertTerminalTextIncludes(incompleteResult.output, "ready marker");
    assertTerminalTextIncludes(
      incompleteResult.output,
      "discern worktree setup",
    );
    assert(await targetExists(incomplete));
  });
});

Deno.test("worktree park destroys recorded resources and retains the branch", async () => {
  await withTempDir(async (dir) => {
    await resourceFixture(
      dir,
      "park-resource",
      "[worktree.resources.lifecycle-probe]\n" +
        'create = "true"\n' +
        `destroy = "touch ${dir}/park-destroyed.marker"\n`,
    );

    const applied = await runAgent(dir, [
      "worktree",
      "park",
      "park-resource",
      "--json",
    ]);
    assertEquals(applied.code, 0, applied.output);
    assert(await targetExists(join(dir, "park-destroyed.marker")));
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/park-resource"),
      "agent/park-resource",
    );
  });
});

Deno.test("worktree park revalidates after resource cleanup and keeps a checkout changed by the destroy command", async () => {
  await withTempDir(async (dir) => {
    const worktree = await resourceFixture(
      dir,
      "park-race",
      "[worktree.resources.race-probe]\n" +
        'create = "true"\n' +
        'destroy = "touch planted-race.txt"\n',
    );

    const applied = await runAgent(dir, [
      "worktree",
      "park",
      "park-race",
    ]);
    assertEquals(applied.code, 1, applied.output);
    assertTerminalTextIncludes(applied.output, "uncommitted changes");
    assert(await targetExists(join(worktree, "planted-race.txt")));
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/park-race"),
      "agent/park-race",
    );
    assert(await targetExists(worktree));
  });
});

Deno.test("start from a parked branch transfers retained wording and consumes the Park record", async () => {
  await withTempDir(async (dir) => {
    const worktree = await fixture(dir, "resume-source");
    await Deno.writeTextFile(join(worktree, "source.txt"), "source\n");
    await git(worktree, "add", "-A");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "Create resume source",
      "--no-gpg-sign",
    );
    await writeStoredTaskMetadata(worktree, {
      schema_version: TASK_METADATA_SCHEMA_VERSION,
      title: "Resume this task",
      brief: "Retained Park brief",
    });
    const parked = await runAgent(dir, [
      "worktree",
      "park",
      "resume-source",
    ]);
    assertEquals(parked.code, 0, parked.output);

    const resumed = await runAgent(dir, [
      "start",
      "--from",
      "agent/resume-source",
      "--json",
    ]);
    assertEquals(resumed.code, 0, resumed.output);
    const result = decodeCliResult(resumed.stdout, "start");
    assertResultDataKey(result, "task");
    assertEquals(result.data.task.title, "Resume this task");
    assertEquals(result.data.task.brief, "Retained Park brief");
    assertEquals(
      await readParkedTaskMetadata(dir, "agent/resume-source"),
      undefined,
    );
  });
});

Deno.test("a Park record cleanup failure reports the created checkout and recovery command", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir, "resume-cleanup");
    const parked = await runAgent(dir, [
      "worktree",
      "park",
      "resume-cleanup",
    ]);
    assertEquals(parked.code, 0, parked.output);

    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const prepared = await buildStartPlan(ctx, {
      worktreeRoot: resolveWorktreeRoot(ctx.root, ctx.config),
      from: "agent/resume-cleanup",
    });
    const metadataDir = await gitAdminStatePath(dir, "parkedTaskMetadata");
    assert(metadataDir !== undefined);
    const recordPath = join(
      metadataDir,
      `${await sha256Hex("agent/resume-cleanup")}.json`,
    );
    await Deno.remove(recordPath);
    await Deno.mkdir(recordPath);
    await Deno.writeTextFile(join(recordPath, "blocker"), "keep directory\n");

    const error = await assertRejects(
      () => applyStartPlan(ctx, prepared),
      WorktreeGitError,
      "but its transferred Park record could not be removed",
    );
    assertStringIncludes(error.message, "The checkout and branch remain.");
    assertStringIncludes(error.message, "discern status --all");
    assert(await targetExists(prepared.plan.worktreePath));
  });
});
