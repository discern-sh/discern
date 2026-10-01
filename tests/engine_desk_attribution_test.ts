/**
 * Desk effects are attributed to their task: the effect records a begin
 * event while it runs and a verb event when it ends, through the recorder
 * the CLI and MCP use, so `discern status` and a second Desk see a
 * Desk-started gate running and then its outcome. Previews record nothing,
 * so they never count as activity or as duration samples; an agent, shell
 * or editor session is activity while it lasts, never a running verb, and
 * ends as ended whatever its exit status.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  executeDeskOperation,
  runDeskInteractiveChild,
} from "../src/engine/desk/desk.ts";
import { statusResult } from "../src/engine/status/status.ts";
import type { StatusFleetEntry } from "../src/shared/result_schemas.ts";
import {
  addWorktree,
  gitInit,
  readLogbookEvents,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { waitForPendingCondition, waitUntil } from "./waiting.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { verbatimStepLabel } from "../src/shared/result.ts";

/** The fleet row status reports for one checkout. */
async function row(
  root: string,
  path: string,
): Promise<StatusFleetEntry | undefined> {
  const status = await statusResult(root, { all: true });
  return status.data?.fleet?.find((entry) => entry.path === path);
}

/** A project with one task checkout. */
async function project(root: string): Promise<string> {
  await scaffoldEngine(root, { agents: [] });
  await gitInit(root);
  return await Deno.realPath(await addWorktree(root, "attributed"));
}

Deno.test("a Desk-started gate runs on its task's row, then leaves its outcome", async () => {
  await withTempDir(async (directory) => {
    const root = await Deno.realPath(directory);
    const task = await project(root);
    let seenRunning: string | undefined;
    const result = await executeDeskOperation(
      task,
      { command: "done" },
      async () => {
        await waitUntil(
          async () => (await row(root, task))?.running !== undefined,
          "status to see the Desk's gate running",
        );
        seenRunning = (await row(root, task))?.running?.verb;
        return { ok: true as const, verb: "done" };
      },
    );
    assertEquals(result.ok, true);
    assertEquals(seenRunning, "done", "status names the gate the Desk runs");
    const after = await row(root, task);
    assertEquals(after?.running, undefined, "it ran, and has ended");
    assertEquals(after?.last_action?.verb, "done");
    assertEquals(after?.last_action?.outcome, "ok");
    const events = await readLogbookEvents(root);
    const begin = events.find((event) => event.kind === "begin");
    const verb = events.find((event) =>
      event.kind === "verb" && event.verb === "done"
    );
    assert(begin?.kind === "begin" && verb?.kind === "verb");
    assertEquals(begin.invocation, verb.invocation, "one invocation");
    assertEquals(verb.surface, "cli");
    assertEquals(verb.driver?.session, "desk");
    assertEquals(verb.branch, begin.branch);
  });
});

Deno.test("a Desk effect that fails is attributed as the CLI attributes it", async () => {
  await withTempDir(async (directory) => {
    const root = await Deno.realPath(directory);
    const task = await project(root);
    await executeDeskOperation(
      task,
      { command: "done" },
      () =>
        Promise.resolve({
          ok: false as const,
          verb: "done",
          error: "gate_failed" as const,
          failed_stage: "test",
          steps: [{
            step: {
              kind: "job" as const,
              label: verbatimStepLabel("test"),
              disposition: "run" as const,
            },
            outcome: "failed" as const,
          }],
        }),
    );
    const action = (await row(root, task))?.last_action;
    assertEquals(action?.verb, "done");
    assertEquals(action?.outcome, "failed");
  });
});

Deno.test("a preview records nothing, so it is neither activity nor a duration sample", async () => {
  await withTempDir(async (directory) => {
    const root = await Deno.realPath(directory);
    const task = await project(root);
    const before = await readLogbookEvents(root);
    await executeDeskOperation(
      task,
      { command: "accept", action: "queue", dryRun: true },
      () => Promise.resolve({ ok: true as const, verb: "accept" }),
    );
    assertEquals(await readLogbookEvents(root), before);
    assertEquals((await row(root, task))?.last_action, undefined);
  });
});

Deno.test("an open shell is activity, not a running verb, and ends as ended", async () => {
  await withTempDir(async (directory) => {
    const root = await Deno.realPath(directory);
    const task = await project(root);
    const started = join(directory, "started");
    const release = join(directory, "release");
    const session = runDeskInteractiveChild(
      "sh",
      [
        "-c",
        `touch '${started}'; while [ ! -e '${release}' ]; do sleep 0.02; done; exit 3`,
      ],
      task,
      {},
      "desk shell",
    );
    try {
      await waitForPendingCondition(
        session,
        () => targetExists(started),
        "the shell to start",
      );
      await waitForPendingCondition(
        session,
        async () =>
          (await readLogbookEvents(root)).some((event) =>
            event.kind === "begin" && event.verb === "desk shell"
          ),
        "the shell's begin event",
      );
      assertEquals(
        (await row(root, task))?.running,
        undefined,
        "an open shell is not a verb anyone waits for",
      );
    } finally {
      await Deno.writeTextFile(release, "");
    }
    assertEquals(await session, 3);
    const ended = (await readLogbookEvents(root)).find((event) =>
      event.kind === "verb" && event.verb === "desk shell"
    );
    assert(ended?.kind === "verb");
    assertEquals(
      ended.outcome,
      "ok",
      "its exit status says nothing of the task",
    );
  });
});
