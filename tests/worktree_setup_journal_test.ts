/** Interruption and recovery protocol for one-shot worktree setup commands. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname } from "@std/path";
import {
  configuredSetupSteps,
  preflightSetupStepJournal,
  readSetupStepJournal,
  recoverSetupStep,
  runJournaledSetupSteps,
  SetupStepJournalError,
} from "../src/engine/worktree/setup_step_journal.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** Initialize a repository with one commit for Git-admin state. */
async function initializeRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(`${dir}/seed.txt`, "seed\n");
  await gitInit(dir);
}

Deno.test("a completed step is not replayed after a later interruption", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const calls: string[] = [];
    await assertRejects(
      () =>
        runJournaledSetupSteps(
          dir,
          ["first-command", "second-command"],
          (step) => {
            calls.push(step.command);
            return Promise.resolve(0);
          },
          {
            afterCompleted: (step) => {
              if (step.command === "first-command") {
                throw new Error("simulated interruption after completion");
              }
            },
          },
        ),
      Error,
      "simulated interruption",
    );
    assertEquals(calls, ["first-command"]);

    const observed = await readSetupStepJournal(dir);
    assertEquals(observed.status, "recorded");
    if (observed.status !== "recorded") return;
    assertEquals(observed.journal.steps.map((step) => step.state), [
      "completed",
      "not_started",
    ]);

    await runJournaledSetupSteps(
      dir,
      ["first-command", "second-command"],
      (step) => {
        calls.push(step.command);
        return Promise.resolve(0);
      },
    );
    assertEquals(calls, ["first-command", "second-command"]);
  });
});

Deno.test("a running step refuses automatic replay with two recovery routes", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const [step] = await configuredSetupSteps(["ambiguous-command"]);
    assert(step !== undefined);
    let calls = 0;
    await assertRejects(
      () =>
        runJournaledSetupSteps(dir, ["ambiguous-command"], () => {
          calls++;
          throw new Error("simulated interruption while running");
        }),
      Error,
      "simulated interruption",
    );

    const refusal = await assertRejects(
      () =>
        runJournaledSetupSteps(dir, ["ambiguous-command"], () => {
          calls++;
          return Promise.resolve(0);
        }),
      SetupStepJournalError,
    );
    assertEquals(calls, 1);
    assertStringIncludes(
      refusal.message,
      `--mark-step-complete ${step.id} --confirmed`,
    );
    assertStringIncludes(
      refusal.message,
      `--retry-step ${step.id} --confirmed`,
    );
  });
});

Deno.test("success interrupted before the completed write remains ambiguous", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    let calls = 0;
    await assertRejects(
      () =>
        runJournaledSetupSteps(
          dir,
          ["externally-successful-command"],
          () => {
            calls++;
            return Promise.resolve(0);
          },
          {
            afterCommand: () => {
              throw new Error("interrupted before completed write");
            },
          },
        ),
      Error,
      "interrupted before completed write",
    );

    const standing = await readSetupStepJournal(dir);
    assertEquals(standing.status, "recorded");
    if (standing.status !== "recorded") return;
    assertEquals(standing.journal.steps[0]?.state, "running");
    await assertRejects(
      () =>
        runJournaledSetupSteps(dir, ["externally-successful-command"], () => {
          calls++;
          return Promise.resolve(0);
        }),
      SetupStepJournalError,
      "cannot prove",
    );
    assertEquals(calls, 1, "automatic recovery must not replay the command");
  });
});

Deno.test("an invalid journal is preserved and no command runs", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const path = await gitAdminStatePath(dir, "worktreeSetupSteps");
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });
    const invalid = '{"version":1,"steps":"not-an-array"}\n';
    await Deno.writeTextFile(path, invalid);
    let calls = 0;
    await assertRejects(
      () =>
        runJournaledSetupSteps(dir, ["must-not-run"], () => {
          calls++;
          return Promise.resolve(0);
        }),
      SetupStepJournalError,
      "rejected",
    );
    assertEquals(calls, 0);
    assertEquals(await Deno.readTextFile(path), invalid);
  });
});

Deno.test("a legacy ready worktree enrolls missing journal entries as completed", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    await preflightSetupStepJournal(dir, ["legacy-command"], true);
    const standing = await readSetupStepJournal(dir);
    assertEquals(standing.status, "recorded");
    if (standing.status !== "recorded") return;
    assertEquals(standing.journal.steps[0]?.state, "completed");

    let calls = 0;
    await runJournaledSetupSteps(dir, ["legacy-command"], () => {
      calls++;
      return Promise.resolve(0);
    });
    assertEquals(calls, 0);
  });
});

Deno.test("mark-complete recovery is confirmed and idempotent", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const [step] = await configuredSetupSteps(["observed-command"]);
    assert(step !== undefined);
    await assertRejects(
      () =>
        runJournaledSetupSteps(
          dir,
          ["observed-command"],
          () => Promise.reject(new Error("interrupted")),
        ),
      Error,
    );
    await assertRejects(
      () =>
        recoverSetupStep(
          dir,
          ["observed-command"],
          step.id,
          "mark-complete",
          false,
        ),
      SetupStepJournalError,
      "--confirmed",
    );

    const changed = await recoverSetupStep(
      dir,
      ["observed-command"],
      step.id,
      "mark-complete",
      true,
    );
    assertEquals(changed.kind, "changed");
    const replay = await recoverSetupStep(
      dir,
      ["observed-command"],
      step.id,
      "mark-complete",
      true,
    );
    assertEquals(replay.kind, "already-completed");

    let calls = 0;
    await runJournaledSetupSteps(dir, ["observed-command"], () => {
      calls++;
      return Promise.resolve(0);
    });
    assertEquals(calls, 0);
  });
});

Deno.test("retry recovery reruns once and later repeats are harmless", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const [step] = await configuredSetupSteps(["retry-command"]);
    assert(step !== undefined);
    await assertRejects(
      () =>
        runJournaledSetupSteps(
          dir,
          ["retry-command"],
          () => Promise.reject(new Error("interrupted")),
        ),
      Error,
    );
    const reset = await recoverSetupStep(
      dir,
      ["retry-command"],
      step.id,
      "retry",
      true,
    );
    assertEquals(reset.kind, "changed");

    let calls = 0;
    await runJournaledSetupSteps(dir, ["retry-command"], () => {
      calls++;
      return Promise.resolve(0);
    });
    assertEquals(calls, 1);
    const repeated = await recoverSetupStep(
      dir,
      ["retry-command"],
      step.id,
      "retry",
      true,
    );
    assertEquals(repeated.kind, "already-completed");
    await runJournaledSetupSteps(dir, ["retry-command"], () => {
      calls++;
      return Promise.resolve(0);
    });
    assertEquals(calls, 1);
  });
});

Deno.test("step identity survives unrelated reordering and distinguishes duplicates", async () => {
  const original = await configuredSetupSteps(["alpha", "repeat", "repeat"]);
  const reordered = await configuredSetupSteps(["repeat", "alpha", "repeat"]);
  const originalAlpha = original.find((step) => step.command === "alpha");
  const reorderedAlpha = reordered.find((step) => step.command === "alpha");
  assertEquals(originalAlpha?.id, reorderedAlpha?.id);
  assertEquals(
    original.filter((step) => step.command === "repeat").map((step) => step.id),
    reordered.filter((step) => step.command === "repeat").map((step) =>
      step.id
    ),
  );
  assert(
    original[1]?.id !== original[2]?.id,
    "duplicate commands need distinct occurrence identities",
  );
});
