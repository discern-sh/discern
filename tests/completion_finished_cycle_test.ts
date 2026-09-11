/**
 * A finished cycle re-enters completion, and the trunk checkout checking
 * itself never takes a place in the landing queue.
 *
 * The class: an entry that holds no place in the plan — landed, withdrawn, or
 * authored at the trunk head itself — must neither lock its unchanged source
 * out of `done` nor sit in the queue waiting to be withdrawn. Every pending
 * cause reaches the owner as a sentence, never as a record shape.
 */
import { assert, assertEquals } from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import {
  finishedCycle,
  orderedEntries,
  selectSource,
} from "../src/engine/landing_queue/model.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import { completionBlockerAccount } from "../src/engine/completion/progress_prose.ts";
import { acceptancePending } from "../src/engine/landing_queue/public_result.ts";
import { QUEUE_DECISION_REASONS } from "../src/engine/landing_queue/queue_decision_subjects.ts";

const TRUNK_REF = "refs/heads/main";

/** The status queue as `effort: sentence` lines, or nothing when it is empty. */
async function queueRows(cwd: string): Promise<string[]> {
  const status = await runAgent(cwd, ["status", "--json"]);
  assertEquals(status.code, 0, status.output);
  const decoded = decodeCliResult(status.stdout, "status");
  const data = decoded.data;
  assert(data !== undefined, status.output);
  if (!("queue" in data) || data.queue === undefined) return [];
  return data.queue.map((row) =>
    `${row.effort}: ${row.reason ?? row.readiness}`
  );
}

/** Author one committed file so the effort has work of its own. */
async function commitFile(
  path: string,
  name: string,
): Promise<void> {
  await Deno.writeTextFile(`${path}/${name}`, `${name}\n`);
  await git(path, "add", name);
  await git(path, "commit", "-q", "-m", `Author ${name}`);
}

/** Record a desk grant for the branch as of now. */
function grantNow(path: string, branch: string): Promise<unknown> {
  return grantEffort(path, branch, wallTimeIso(SYSTEM_CLOCK.wallNow()));
}

Deno.test("a finished cycle re-enters selection with a fresh place, whatever its source", () => {
  for (const state of ["landed", "withdrawn"] as const) {
    const { queue } = queueExample(2);
    const [first, second] = queue.entries;
    assert(first !== undefined && second !== undefined);
    const history = { ...first, state };
    assert(finishedCycle(history));
    const settled = { ...queue, entries: [history, second] };
    const same = selectSource(settled, first.source, []);
    assertEquals(same.kind, "changed");
    if (same.kind !== "changed") return;
    const fresh = same.queue.entries.find((entry) =>
      entry.source.effort_id === first.source.effort_id
    );
    assertEquals(fresh?.state, "provisional");
    assertEquals(
      fresh?.candidate_id,
      first.candidate_id,
      "an unchanged source keeps its candidate identity",
    );
    assert(
      fresh !== undefined &&
        fresh.provisional_order > second.provisional_order,
      "a fresh place never reuses an earlier rank",
    );
    assertEquals(same.queue.entries.length, 2, "the history entry is replaced");
    const changed = selectSource(
      settled,
      { ...first.source, head: "c".repeat(40), tree: "d".repeat(40) },
      [],
    );
    assertEquals(changed.kind, "changed");
    if (changed.kind !== "changed") return;
    assertEquals(
      changed.queue.entries.find((entry) =>
        entry.source.effort_id === first.source.effort_id
      )?.candidate_id,
      null,
      "a new source starts without a candidate",
    );
  }
  const { queue } = queueExample(1);
  const live = queue.entries[0];
  assert(live !== undefined && !finishedCycle(live));
  const unchanged = selectSource(queue, live.source, []);
  assertEquals(unchanged.kind, "changed");
  if (unchanged.kind === "changed") assertEquals(unchanged.queue, queue);
});

Deno.test("the trunk checkout checking itself takes no place in the landing queue", async () => {
  await withTempDir(async (root) => {
    const first = await project(root, ["local"]);
    const trunkDone = await runAgent(root, ["done", "--json"]);
    assertEquals(trunkDone.code, 0, trunkDone.output);
    assertEquals(await queueRows(root), []);
    const preview = await runAgent(root, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assert(!preview.output.includes("withdraw"), preview.output);
    const queue = observedRecords(await observeQueue(root, "main")).find((
      record,
    ) => record.kind === "queue");
    assert(queue?.kind === "queue");
    const trunkEntry = queue.data.entries.find((entry) =>
      entry.source.branch === TRUNK_REF
    );
    assertEquals(trunkEntry?.state, "landed");
    assert(
      orderedEntries(queue.data).every((entry) =>
        entry.source.branch !== TRUNK_REF
      ),
    );
    // A worktree with no commits of its own sits at the trunk head too: its
    // checks record Proof, and the owner hears that there is nothing to land.
    const empty = await addWorktree(root, "empty");
    const emptyDone = await runAgent(empty, ["done", "--json"]);
    assertEquals(emptyDone.code, 0, emptyDone.output);
    assertEquals(await queueRows(root), []);
    const nothing = await runAgent(empty, ["accept", "--dry-run", "--json"]);
    assertEquals(nothing.code, 0, nothing.output);
    assertTerminalTextIncludes(
      decodeCliResult(nothing.stdout, "accept").message ?? "",
      "Selected effort `agent/empty`: nothing to land. Its source is already on main.",
    );
    // The same trunk commit can be checked again: the route that settles an
    // emergency landing's outstanding validation.
    const again = await runAgent(root, ["done", "--rerun", "--json"]);
    assertEquals(again.code, 0, again.output);
    assertEquals(await queueRows(root), []);
    // An entry an older engine left provisional for the trunk branch settles
    // on the next trunk movement instead of asking to be withdrawn.
    const current = await requireQueue(root);
    const legacy = await replaceQueue(root, current, {
      ...current.record.data,
      entries: current.record.data.entries.map((entry) =>
        entry.source.branch === TRUNK_REF
          ? { ...entry, state: "provisional" as const }
          : entry
      ),
    });
    assertEquals(legacy.kind, "written");
    assertEquals(await queueRows(root), [
      "main: Its work is already on main; withdraw the entry with discern accept withdraw --target main.",
    ]);
    await commitFile(first, "first-source");
    const done = await runAgent(first, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    await grantNow(first, "agent/public-done");
    const accepted = await runAgent(first, ["accept", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const later = await addWorktree(root, "later");
    await commitFile(later, "later-source");
    const moved = await runAgent(later, ["done", "--json"]);
    assertEquals(moved.code, 0, moved.output);
    assertEquals(await queueRows(root), [
      "later: Waiting for the owner's approval.",
    ]);
  });
});

Deno.test("a withdrawn effort and a landed retained checkout re-validate their unchanged source", async () => {
  await withTempDir(async (root) => {
    await project(root, ["local"]);
    const withdrawn = await addWorktree(root, "withdrawn");
    await commitFile(withdrawn, "withdrawn-source");
    const done = await runAgent(withdrawn, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const planned = await runAgent(root, [
      "accept",
      "withdraw",
      "--target",
      "withdrawn",
      "--dry-run",
      "--json",
    ]);
    assertEquals(planned.code, 0, planned.output);
    const plan = decodeCliResult(planned.stdout, "accept");
    const token = plan.data !== undefined && "queue_control" in plan.data
      ? plan.data.queue_control?.expected_state
      : undefined;
    assert(token !== undefined, planned.output);
    const applied = await runAgent(root, [
      "accept",
      "withdraw",
      "--target",
      "withdrawn",
      "--confirmed",
      "--expected",
      token,
      "--json",
    ]);
    assertEquals(applied.code, 0, applied.output);
    assertEquals(await queueRows(root), []);
    const back = await runAgent(withdrawn, ["done", "--rerun", "--json"]);
    assertEquals(back.code, 0, back.output);
    assertEquals(await queueRows(root), [
      "withdrawn: Waiting for the owner's approval.",
    ]);

    const kept = await addWorktree(root, "kept");
    await commitFile(kept, "kept-source");
    const retained = await runAgent(kept, [
      "done",
      "--retain-checkout",
      "--json",
    ]);
    assertEquals(retained.code, 0, retained.output);
    await grantNow(kept, "agent/kept");
    const landed = await runAgent(root, [
      "accept",
      "--target",
      "kept",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const rerun = await runAgent(kept, ["done", "--rerun", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    // The landing moved the trunk under the withdrawn effort's fresh entry;
    // without a proved environment the author brings it forward.
    assertEquals(await queueRows(root), [
      "withdrawn: Work ahead of it changed; run discern update in its worktree, then discern done.",
    ]);
    const answer = await runAgent(kept, ["accept", "--dry-run", "--json"]);
    assertEquals(answer.code, 0, answer.output);
    assertTerminalTextIncludes(
      decodeCliResult(answer.stdout, "accept").message ?? "",
      "Selected effort `agent/kept`: landed. Its checkout stayed.",
    );
  });
});

Deno.test("a queue decision reads as its table sentence, never as a token or a record shape", async () => {
  const account = completionBlockerAccount({
    kind: "missing-judgment",
    subjects: ["effort-not-selected"],
  });
  assertEquals(account.reason, QUEUE_DECISION_REASONS["effort-not-selected"]);
  assertEquals(account.owner_must_act, false);
  const served = completionBlockerAccount({
    kind: "missing-judgment",
    subjects: ["checkpoint:map-focus"],
  });
  assertEquals(served.owner_must_act, true);
  // A composition conflict names the files and the author's next command,
  // never a checkpoint decision the owner would look for.
  const conflict = acceptancePending({
    kind: "missing-judgment",
    subjects: ["conflict:shared.txt", "authored:notes.md"],
  });
  assertEquals(
    conflict.reason,
    "Its changes conflict with work already on the trunk in shared.txt; composing it changed authored files no generator owns (notes.md). Run discern update in its worktree, resolve what it reports, then discern done.",
  );
  assertEquals(
    conflict.reason,
    completionBlockerAccount({
      kind: "missing-judgment",
      subjects: ["conflict:shared.txt", "authored:notes.md"],
    }).reason,
  );
  const source = await Deno.readTextFile("src/engine/gate/complete_gate.ts");
  assert(
    !/JSON\.stringify\((completed|blocker)\)/.test(source),
    "a pending completion must compose its sentence from the blocker account",
  );
});
