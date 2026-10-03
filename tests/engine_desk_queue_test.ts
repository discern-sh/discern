/** The idle-owner landing choice uses production Desk effects and public submission. */
import { assert, assertEquals } from "@std/assert";
import {
  DESK_ACTION_REGISTRY,
  type DeskAction,
  type DeskActionMetadata,
} from "../src/engine/desk/model.ts";
import { statusResult as rawStatusResult } from "../src/engine/status/status.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { readProofNoteAt } from "../src/engine/gate/proof_notes.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { readLandedProof } from "../src/engine/desk/flows/reading.ts";
import { initialDeskProduct } from "../src/engine/desk/desk_state.ts";
import { landedRowId } from "../src/engine/desk/desk_transitions.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import {
  deskSession,
  deskTranscript,
  scriptedDeskRuntime,
} from "./fixtures/desk_session.ts";
import { project } from "./completion_public_fixture.ts";
import { withTempDir } from "./helpers.ts";
import { shellAwaitFile } from "./shell_hold.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { countedCalls } from "./counted_calls.ts";

const statusCalls = countedCalls(rawStatusResult);
const statusResult = statusCalls.run;

/**
 * Replace only the terminal and its keys; the survey, plans, grants and all
 * effects are production. Ctrl+C typed after the confirm lands once the
 * effect returns the screen, so the session ends after the effect.
 */
async function action(
  root: string,
  path: string,
  action: DeskAction,
  confirm = true,
): Promise<void> {
  let requestedSurveys = 0;
  await statusCalls.expectCalls(() => requestedSurveys, async () => {
    const desk = await deskSession({
      production: true,
      cliModel: TEST_CLI_MODEL,
      runtime: {
        canInteract: () => true,
        inDeskSession: () => false,
        findRoot: () => root,
        status: async (where) => {
          requestedSurveys++;
          return await statusResult(where, { all: true });
        },
        makeOut: () => deskTranscript().out,
        pause: () => {},
      },
    });
    const row = desk.state().lists.inbox?.selectedId;
    assert(row !== undefined, "the Desk lists the task");
    const entry = (await rawStatusResult(root, { all: true })).data?.fleet
      ?.find((candidate) => candidate.path === path);
    assert(entry !== undefined, `${path} is surveyed`);
    await desk.select(entry.id ?? entry.branch);
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    const key = metadata.key;
    if (key === undefined) {
      await desk.press(".");
      await desk.opened("actions");
      await desk.choose(action);
    } else {
      await desk.press(key);
    }
    await desk.opened(`review-${action}-review`);
    if (confirm) {
      await desk.confirm();
      await desk.operated();
    } else {
      await desk.escape(() => desk.top() === undefined, "the review to close");
    }
    assertEquals(await desk.quit(), 0);
  });
}

Deno.test("Desk queues idle proven efforts, preserves grants and producer counts, and Accept walks them", async () => {
  await withTempDir(async (directory) => {
    const root = await Deno.realPath(directory);
    const first = await project(root);
    const paths = [
      first,
      await addWorktree(root, "queued-second"),
      await addWorktree(root, "queued-third"),
    ];
    const branches: string[] = [];
    const trunk = await gitOut(root, "rev-parse", "main");
    for (const [index, path] of paths.entries()) {
      const branch = await gitOut(path, "branch", "--show-current");
      branches.push(branch);
      if (index > 0) {
        await Deno.writeTextFile(`${path}/work-${index}`, `task ${index}\n`);
        await git(path, "add", `work-${index}`);
        await git(path, "commit", "-m", `Author task ${index}`);
      }
      const setup = await runAgent(path, ["worktree", "setup", "--json"]);
      assertEquals(setup.code, 0, setup.output);
      // Exercise both grant-before-green and the stopped-agent, grant-after-green case.
      if (index === 0) await action(root, path, "grant");
      const green = await runAgent(path, ["done", "--json"]);
      assertEquals(green.code, 0, green.output);
      if (index > 0) await action(root, path, "grant");
      const grant = await readEffortGrant(path);
      assertEquals(grant.status, "granted");
      assertEquals(
        (await readSubmission(path)).status,
        "missing",
        "permission alone does not queue",
      );
      if (index === 0) {
        await action(root, path, "submit", false);
        assertEquals((await readSubmission(path)).status, "missing");
      }
      await action(root, path, "submit");
      const queued = await readSubmission(path);
      assertEquals(queued.status, "submitted");
      if (index === 0) await action(root, path, "submit");
      assertEquals(
        await readSubmission(path),
        queued,
        "same revision preserves queue identity and order",
      );
      assertEquals(
        await readEffortGrant(path),
        grant,
        "queueing does not consume permission",
      );
      assertEquals(await gitOut(root, "rev-parse", "main"), trunk);
      assertEquals(
        await Deno.readTextFile(`${path}/executions`),
        "t",
        "queueing adds no producer run",
      );
    }
    const queued = await statusResult(root, { all: true });
    assertEquals(queued.data?.queue?.map((row) => row.branch), branches);
    // Revocation changes authority, not the submitted source.
    const last = paths[2];
    assert(last !== undefined);
    const record = await readSubmission(last);
    await action(root, last, "revoke_grant");
    assertEquals(await readSubmission(last), record);
    const revoked = await statusResult(root, { all: true });
    assertEquals(
      revoked.data?.queue?.find((row) => row.branch === branches[2])?.authority,
      "awaiting-owner",
    );
    await action(root, last, "grant");
    await Deno.writeTextFile(`${last}/later-work`, "newer proven work\n");
    await git(last, "add", "later-work");
    await git(
      last,
      "commit",
      "-m",
      "Prove newer author work without resubmitting",
    );
    const newer = await runAgent(last, ["done", "--json"]);
    assertEquals(newer.code, 0, newer.output);
    const newerHead = await gitOut(last, "rev-parse", "HEAD");
    assertEquals(
      await readSubmission(last),
      record,
      "done does not replace a submission",
    );
    const beforeWalk = await statusResult(root, { all: true });
    const oldRow = beforeWalk.data?.queue?.find((row) => row.path === last);
    assert(oldRow?.head !== newerHead);
    assertEquals(oldRow?.readiness, "waiting");
    await action(root, first, "accept");
    assertEquals(
      await readSubmission(last),
      record,
      "a walk never silently selects a newer proven tip",
    );
    const producers = await Deno.readTextFile(`${last}/executions`);
    await action(root, last, "submit");
    const replacement = await readSubmission(last);
    assert(replacement.status === "submitted");
    assertEquals(replacement.submission.head, newerHead);
    assertEquals(
      await Deno.readTextFile(`${last}/executions`),
      producers,
      "resubmitting current Proof needs no author gate",
    );
    await action(root, last, "accept");
    const after = await statusResult(root, { all: true });
    assertEquals(after.data?.queue ?? [], []);
    for (const branch of branches) {
      assertEquals(await gitOut(root, "branch", "--list", branch), "");
    }
    assertEquals(await Deno.readTextFile(`${root}/source`), "authored\n");
    assertEquals(await Deno.readTextFile(`${root}/work-1`), "task 1\n");
    assertEquals(await Deno.readTextFile(`${root}/work-2`), "task 2\n");
  });
});

Deno.test("Desk replaces a submission while another effort's acceptance checks are running", async () => {
  await withTempDir(async (directory) => {
    const root = join(await Deno.realPath(directory), "project");
    await Deno.mkdir(root);
    const pause = join(directory, "pause");
    const ready = join(directory, "ready");
    const release = join(directory, "release");
    const lint =
      `printf t >> executions; if [ -e '${pause}' ]; then touch '${ready}'; ${
        shellAwaitFile(`'${release}'`)
      }; fi`;
    await scaffoldEngine(root, { agents: [] });
    await writeConfig(
      root,
      `[meta]\nbootstrapped = true\n[project]\nslug = "queue-race"\nagents = []\n[repository]\ntrunk = "main"\n[jobs]\nlint = ${
        JSON.stringify(lint)
      }\n`,
    );
    await Deno.writeTextFile(join(root, ".gitignore"), "executions\n");
    await gitInit(root);
    const first = await addWorktree(root, "walking-first");
    const next = await addWorktree(root, "replacing-next");
    for (const [index, path] of [first, next].entries()) {
      await Deno.writeTextFile(
        join(path, `work-${index}`),
        `authored ${index}\n`,
      );
      await git(path, "add", `work-${index}`);
      await git(path, "commit", "-m", `Author work ${index}`);
      const setup = await runAgent(path, ["worktree", "setup", "--json"]);
      assertEquals(setup.code, 0, setup.output);
      const proven = await runAgent(path, ["done", "--json"]);
      assertEquals(proven.code, 0, proven.output);
      await action(root, path, "grant");
      await action(root, path, "submit");
    }
    const old = await readSubmission(next);
    assert(old.status === "submitted");
    await Deno.writeTextFile(
      join(next, "later"),
      "explicitly resubmitted work\n",
    );
    await git(next, "add", "later");
    await git(next, "commit", "-m", "Advance the second effort");
    const renewed = await runAgent(next, ["done", "--json"]);
    assertEquals(renewed.code, 0, renewed.output);
    await Deno.writeTextFile(join(root, "shared"), "moved trunk\n");
    await git(root, "add", "shared");
    await git(root, "commit", "-m", "Move the shared branch");
    await Deno.writeTextFile(pause, "");
    const walking = action(root, first, "accept");
    try {
      await waitForPendingCondition(
        walking,
        () => targetExists(ready),
        "the first acceptance's integration check to pause",
      );
      const producers = await Deno.readTextFile(join(next, "executions"));
      const grant = await readEffortGrant(next);
      await action(root, next, "submit");
      const replacement = await readSubmission(next);
      assert(replacement.status === "submitted");
      assert(replacement.submission.id !== old.submission.id);
      assertEquals(
        replacement.submission.head,
        await gitOut(next, "rev-parse", "HEAD"),
      );
      assertEquals(await readEffortGrant(next), grant);
      assertEquals(
        await Deno.readTextFile(join(next, "executions")),
        producers,
      );
      assertEquals(
        await targetExists(first),
        true,
        "queueing does not complete the active landing",
      );
    } finally {
      await Deno.writeTextFile(release, "");
      await walking;
    }
    const after = await statusResult(root, { all: true });
    assertEquals(after.data?.queue ?? [], []);
    assertEquals(
      await Deno.readTextFile(join(root, "later")),
      "explicitly resubmitted work\n",
    );
    assertEquals(await targetExists(first), false);
    assertEquals(await targetExists(next), false);
    assert(after.ok && after.data !== undefined);
    const context = {
      root,
      config: configSchema.parse({
        project: { slug: "queue-race" },
        repository: { trunk: "main" },
      }),
      runtime: scriptedDeskRuntime(deskTranscript(), {
        git: (args, cwd) => runGit(args, { cwd }),
        landedProof: readProofNoteAt,
      }),
      state: {
        ...initialDeskProduct({
          trunk: "main",
          preferences: { schema_version: 2 },
        }),
        data: after.data,
      },
    };
    const pages = await Promise.all(
      (after.data.recent_completed_tasks ?? []).map(async (task) =>
        (await readLandedProof(
          context,
          landedRowId(task.branch, task.completed_at),
        )).markdown
      ),
    );
    assert(
      pages.some((page) => page.includes("## Landing evidence")),
      "a removed checkout retains readable full Proof and landing evidence",
    );
  });
});
