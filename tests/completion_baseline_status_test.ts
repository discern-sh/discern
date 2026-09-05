/** Status recovery distinguishes missing, ambiguous, and malformed local evidence. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import {
  fleetFilesystem,
  fleetSetupEvidence,
} from "../src/engine/status/recovery.ts";
import {
  parkedTaskEvidence,
  recentCompletedTasks,
} from "../src/engine/status/recent.ts";
import {
  listWorktreeFleet,
  readySentinelPath,
  resolveCommonGitDir,
} from "../src/engine/worktree/git.ts";
import { runJournaledSetupSteps } from "../src/engine/worktree/setup_step_journal.ts";
import { writeParkedTaskMetadata } from "../src/engine/worktree/parked_task_metadata.ts";
import { worktreeParkPlan } from "../src/engine/worktree/park.ts";
import { lifecycleContext } from "../src/engine/worktree/lifecycle.ts";
import { Logger } from "../src/lib/log.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import { appendEvent } from "../src/engine/logbook/store.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import { addWorktree, gitInit, gitOut, writeConfig } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("fleet recovery offers manual action for ambiguous setup and preserves malformed journals", async () => {
  await withTempDir(async (root) => {
    const toml =
      '[project]\nslug = "sample"\n[repository]\ntrunk = "main"\n[worktree.setup]\nsteps = ["prepare external state"]\n';
    await writeConfig(root, toml);
    await gitInit(root);
    const path = await addWorktree(root, "recovery");
    const row = (await listWorktreeFleet(root)).find((entry) =>
      entry.branch === "agent/recovery"
    );
    assert(row !== undefined);
    const settings = { slug: "sample", branchPrefix: "agent/", envFiles: [] };
    assertEquals(
      (await fleetSetupEvidence(row, root, undefined, true)).state,
      "unavailable",
    );
    assertEquals(
      (await fleetSetupEvidence(
        { ...row, path: join(root, "absent") },
        root,
        settings,
        true,
      )).state,
      "unavailable",
    );
    const absent = await fleetSetupEvidence(row, root, settings, false);
    assertStringIncludes(
      JSON.stringify(absent),
      "does not contain discern.toml",
    );
    const configPath = join(path, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    await Deno.writeTextFile(configPath, "invalid = [");
    assertStringIncludes(
      JSON.stringify(await fleetSetupEvidence(row, root, settings, true)),
      "could not be read",
    );
    await Deno.writeTextFile(configPath, config);
    const missing = await fleetSetupEvidence(row, root, settings, true);
    assertEquals(missing.journal?.status, "missing");
    assertStringIncludes(
      JSON.stringify(missing.repair),
      "prior one-shot effects cannot be verified",
    );
    await writeConfig(path, toml.replace('["prepare external state"]', "[]"));
    assertEquals(
      (await fleetSetupEvidence(row, root, settings, true)).repair?.kind,
      "retry",
    );
    await Deno.writeTextFile(configPath, config);
    await assertRejects(
      () =>
        runJournaledSetupSteps(
          path,
          ["prepare external state"],
          () => Promise.resolve(1),
        ),
      Error,
      "recorded",
    );
    const running = await fleetSetupEvidence(row, root, settings, true);
    assertEquals(running.journal?.steps[0]?.state, "running");
    assertStringIncludes(JSON.stringify(running.repair), "--retry-step");
    const journal = await gitAdminStatePath(path, "worktreeSetupSteps");
    assert(journal !== undefined);
    await Deno.writeTextFile(journal, '{"broken":true}');
    const malformed = await fleetSetupEvidence(row, root, settings, true);
    assertEquals(malformed.journal?.status, "unavailable");
    assertEquals(malformed.repair?.kind, "manual");
    assertEquals(await Deno.readTextFile(journal), '{"broken":true}');
    const marker = await readySentinelPath(path);
    assert(marker !== undefined);
    await Deno.mkdir(dirname(marker), { recursive: true });
    await Deno.writeTextFile(marker, "");
    assertEquals(await fleetSetupEvidence(row, root, settings, true), {
      state: "ready",
      marker: "present",
    });
    assertEquals(await fleetFilesystem(path), { state: "directory" });
    assertEquals(await fleetFilesystem(configPath), { state: "other" });
    assertEquals(await fleetFilesystem(join(path, "missing")), {
      state: "missing",
    });
  });
});

Deno.test("recent completions bound successful real landings and surface unreadable Park metadata", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "seed"), "base");
    await gitInit(root);
    const common = await resolveCommonGitDir(root);
    assert(common !== undefined);
    const event: VerbEvent = {
      schema: LOGBOOK_SCHEMA_VERSION,
      kind: "verb",
      at: "2026-09-05T00:00:00Z",
      verb: "accept",
      surface: "cli",
      branch: "agent/base",
      head: null,
      clean: true,
      outcome: "ok",
      duration_ms: 1,
      epoch: null,
    };
    for (let i = 0; i < 10; i++) {
      await appendEvent(common, {
        ...event,
        at: `2026-09-05T00:00:${String(i).padStart(2, "0")}Z`,
        branch: `agent/task-${i}`,
        head: i === 9 ? null : String(i).repeat(9),
      });
    }
    for (
      const patch of [{ dry_run: true }, { outcome: "failed" as const }, {
        verb: "done",
      }, { branch: null }]
    ) await appendEvent(common, { ...event, ...patch });
    const recent = await recentCompletedTasks(root, true, undefined);
    assertEquals(recent.length, 8);
    assertEquals(
      recent.map((task) => task.branch),
      [9, 8, 7, 6, 5, 4, 3, 2].map((i) => `agent/task-${i}`),
    );
    assertEquals(recent[0]?.head, undefined);
    assertEquals(await recentCompletedTasks(root, false, undefined), []);
    const branch = "agent/parked";
    await writeParkedTaskMetadata(root, {
      schema_version: ON_DISK_FORMATS.parkedTaskMetadata.version,
      id: "parked",
      branch,
      head: await gitOut(root, "rev-parse", "HEAD"),
      parked_at: event.at,
      task: {
        schema_version: ON_DISK_FORMATS.taskMetadata.version,
        title: "Resume this work",
      },
    });
    assertEquals(
      (await parkedTaskEvidence(root, [branch])).parked_tasks?.[0]?.id,
      "parked",
    );
    assertEquals(await parkedTaskEvidence(root, []), {});
    const directory = await gitAdminStatePath(root, "parkedTaskMetadata");
    assert(directory !== undefined);
    const path = join(directory, `${await sha256Hex(branch)}.json`);
    await Deno.writeTextFile(path, "malformed");
    assertEquals(
      (await parkedTaskEvidence(root, [branch])).parked_tasks_unavailable
        ?.next_command,
      "discern doctor",
    );
    assertEquals(await Deno.readTextFile(path), "malformed");
  });
});

Deno.test("Park refuses unreadable task metadata before removing a ready checkout", async () => {
  await withTempDir(async (root) => {
    await writeConfig(
      root,
      '[project]\nslug = "sample"\n[repository]\ntrunk = "main"\n',
    );
    await gitInit(root);
    const path = await addWorktree(root, "broken-metadata");
    const marker = await readySentinelPath(path);
    const metadata = await gitAdminStatePath(path, "taskMetadata");
    assert(marker !== undefined && metadata !== undefined);
    await Deno.mkdir(dirname(marker), { recursive: true });
    await Deno.writeTextFile(marker, "");
    await Deno.writeTextFile(metadata, "unreadable metadata");
    const ctx = await lifecycleContext(
      root,
      new Logger({ json: true, noColor: true }),
    );
    await assertRejects(
      () => worktreeParkPlan(ctx, path),
      Error,
      "could not preserve task metadata",
    );
    assertEquals(await Deno.readTextFile(metadata), "unreadable metadata");
    assertEquals(
      await gitOut(path, "branch", "--show-current"),
      "agent/broken-metadata",
    );
  });
});
