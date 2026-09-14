import { showRecentCompleted } from "../src/engine/desk/main_checkout.ts";
import { readProofNoteAt } from "../src/engine/gate/proof_notes.ts";
import { runGit } from "../src/shared/subprocess.ts";
/** The idle-owner landing choice uses production Desk effects and public submission. */
import { assert, assertEquals } from "@std/assert";
import { runDesk } from "../src/engine/desk/desk.ts";
import type { DeskAction } from "../src/engine/desk/model.ts";
import { readDeskScreen } from "../src/engine/desk/reading.ts";
import {
  encodeTerminalKeys,
  FakeTerminalIO,
} from "discern-design-system/cli/interactive/testing";
import type { DeskReading } from "../src/engine/desk/reading.ts";
import { statusResult } from "../src/engine/status/status.ts";
import type { StatusData } from "../src/shared/result_schemas.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { scriptedDeskEffects } from "./fixtures/desk_scripted_application.ts";
import { project } from "./completion_public_fixture.ts";
import { withTempDir } from "./helpers.ts";
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

/** Replace only human input; the survey, plans, grants and all effects are production. */
async function action(
  root: string,
  path: string,
  action: DeskAction,
  review?: (request: DeskReading) => Promise<boolean>,
): Promise<void> {
  const initial = await statusResult(root, { all: true });
  assert(initial.data !== undefined);
  let data: StatusData = initial.data;
  const choices = [path, action, "\x00back", "\x00quit"];
  const select = (): string => choices.shift() ?? "\x00quit";
  const code = await runDesk({ cliModel: TEST_CLI_MODEL }, {
    canInteract: () => true,
    inDeskSession: () => false,
    findRoot: () => root,
    status: async (path) => {
      const result = await statusResult(path, { all: true });
      if (result.data) data = result.data;
      return result;
    },
    application: (options) =>
      scriptedDeskEffects(options, select, () => data, () => {}),
    select,
    screen: async (request) => {
      const apply = request.confirmation !== undefined &&
        (await review?.(request) ?? true);
      const keys = request.confirmation === undefined
        ? encodeTerminalKeys("escape")
        : apply
        ? encodeTerminalKeys("tab", "down", "enter")
        : encodeTerminalKeys("tab", "enter");
      const io = new FakeTerminalIO([keys], { columns: 80, rows: 24 });
      return await readDeskScreen(request, { io, interactive: () => true });
    },
    pause: () => {},
  });
  assertEquals(code, 0);
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
        await action(root, path, "submit", () => Promise.resolve(false));
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
      `printf t >> executions; if [ -e '${pause}' ]; then touch '${ready}'; while [ ! -e '${release}' ]; do sleep 0.01; done; fi`;
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
    const pages: string[] = [];
    const choices = ["0", "back", "back"];
    await showRecentCompleted(root, after.data, {
      git: (args, cwd) => runGit(args, { cwd }),
      landedProof: readProofNoteAt,
      screen: (request) => {
        pages.push(request.source);
        return choices.shift() ?? "back";
      },
    });
    assert(
      pages.some((page) => page.includes("## Landing evidence")),
      "a removed checkout retains readable full Proof and landing evidence",
    );
  });
});
