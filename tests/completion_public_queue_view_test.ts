/** Status and the acceptance preview present the same ordered queue, and a
 * stale entry whose work is already on the trunk offers its own withdrawal or
 * reconciliation in its row. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { queueEntryReadiness } from "../src/engine/landing_queue/queue_projection.ts";
import type { QueueEntry } from "../src/engine/landing_queue/model.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, runAgent } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    source: {
      effort_id: "sample",
      branch: "refs/heads/agent/sample",
      head: "a".repeat(40),
      tree: "b".repeat(40),
    },
    provisional_order: 0,
    eligible_order: null,
    approval_batch: null,
    candidate_id: null,
    authority_id: null,
    dependencies: [],
    state: "provisional",
    invalidation: null,
    ...overrides,
  };
}

const offTrunk = { onTrunk: false, reconcilable: false, trunk: "main" };

Deno.test("queue readiness derives one plain sentence per waiting cause", () => {
  const cases: Array<[
    QueueEntry,
    Parameters<typeof queueEntryReadiness>[1],
    ReturnType<typeof queueEntryReadiness>,
  ]> = [
    [entry({ state: "active" }), offTrunk, { readiness: "landing" }],
    [entry(), { onTrunk: true, reconcilable: true, trunk: "main" }, {
      readiness: "waiting",
      reason:
        "Its work is already on main; record the outside integration with discern accept --reconcile --target sample.",
    }],
    [entry(), { onTrunk: true, reconcilable: false, trunk: "main" }, {
      readiness: "waiting",
      reason:
        "Its work is already on main; withdraw the entry with discern accept withdraw --target sample.",
    }],
    [entry({ held: true }), offTrunk, {
      readiness: "waiting",
      reason:
        "The owner put it on hold; discern accept resume --target sample resumes it.",
    }],
    [entry({ state: "failed" }), offTrunk, {
      readiness: "waiting",
      reason: "Its checks failed; rerun discern done from its worktree.",
    }],
    [entry({ invalidation: "source-replaced" }), offTrunk, {
      readiness: "waiting",
      reason:
        "Its source changed after its checks passed; rerun discern done from its worktree.",
    }],
    [entry({ invalidation: "external-trunk" }), offTrunk, {
      readiness: "waiting",
      reason:
        "The trunk moved; run discern update in its worktree, then discern done.",
    }],
    [entry({ invalidation: "authority-revoked" }), offTrunk, {
      readiness: "waiting",
      reason: "The owner revoked its approval; a fresh approval re-enrols it.",
    }],
    [entry({ invalidation: "toolchain-changed" }), offTrunk, {
      readiness: "waiting",
      reason:
        "Its evidence is stale; rerun discern done from its worktree, then retry acceptance.",
    }],
    [entry(), offTrunk, {
      readiness: "waiting",
      reason:
        "It has no Proof yet; run discern done from its clean committed worktree.",
    }],
    [
      entry({ candidate_id: "11111111-1111-4111-8111-111111111111" }),
      offTrunk,
      {
        readiness: "waiting",
        reason: "Waiting for the owner's approval.",
      },
    ],
    [
      entry({
        state: "eligible",
        eligible_order: 0,
        candidate_id: "11111111-1111-4111-8111-111111111111",
        authority_id: "22222222-2222-4222-8222-222222222222",
      }),
      offTrunk,
      { readiness: "ready" },
    ],
  ];
  for (const [subject, facts, expected] of cases) {
    assertEquals(queueEntryReadiness(subject, facts), expected);
  }
});

Deno.test("status and the acceptance preview list the same ordered queue, and an integrated entry offers reconciliation", async () => {
  await withTempDir(async (root) => {
    const first = await project(root, ["local"]);
    const second = await addWorktree(root, "second");
    await Deno.writeTextFile(`${second}/second-source`, "second author\n");
    await git(second, "add", "second-source");
    await git(second, "commit", "-m", "Author second source");
    for (const path of [first, second]) {
      const done = await runAgent(path, ["done", "--json"]);
      assertEquals(done.code, 0, done.output);
    }
    await grantEffort(
      first,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    // Hold the second effort so the shared list carries a held row in place.
    const preview = await runAgent(root, [
      "accept",
      "hold",
      "--target",
      "second",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    const planned = decodeCliResult(preview.stdout, "accept");
    const expected = planned.data !== undefined &&
        "queue_control" in planned.data
      ? planned.data.queue_control?.expected_state
      : undefined;
    assert(expected !== undefined, preview.output);
    const held = await runAgent(root, [
      "accept",
      "hold",
      "--target",
      "second",
      "--confirmed",
      "--expected",
      expected,
      "--json",
    ]);
    assertEquals(held.code, 0, held.output);

    const queueOf = async (): Promise<
      Array<{ effort: string; reason?: string; on_trunk?: boolean }>
    > => {
      const status = await runAgent(root, ["status", "--json"]);
      assertEquals(status.code, 0, status.output);
      const decoded = decodeCliResult(status.stdout, "status");
      const data = decoded.data;
      assert(data !== undefined && "queue" in data, status.output);
      const rows = data.queue ?? [];
      return rows.map((row) => ({
        effort: row.effort,
        ...(row.reason === undefined ? {} : { reason: row.reason }),
        ...(row.on_trunk === undefined ? {} : { on_trunk: row.on_trunk }),
      }));
    };
    const before = observedRecords(await observeQueue(root, "main"));
    const statusRows = await queueOf();
    assertEquals(
      statusRows.map((row) => row.effort),
      ["public-done", "second"],
    );
    assertEquals(
      observedRecords(await observeQueue(root, "main")),
      before,
      "the status queue view is read-only: no record advances or repairs",
    );
    assertStringIncludes(
      statusRows[1]?.reason ?? "",
      "discern accept resume --target second",
    );

    const previewed = await runAgent(root, [
      "accept",
      "--target",
      "public-done",
      "--dry-run",
      "--json",
    ]);
    assertEquals(previewed.code, 0, previewed.output);
    const plan = decodeCliResult(previewed.stdout, "accept");
    assert(plan.data !== undefined && "queue" in plan.data, previewed.output);
    assertEquals(
      plan.data.queue?.map((row) => row.effort),
      statusRows.map((row) => row.effort),
      "accept --dry-run and status must list the same ordered queue",
    );
    const heldRow = plan.data.queue?.find((row) => row.effort === "second");
    assertStringIncludes(
      heldRow?.pending[0]?.reason ?? "",
      "discern accept resume --target second",
    );
    assert(
      plan.message?.startsWith("Selected effort `agent/public-done`:"),
      plan.message,
    );
    assertStringIncludes(plan.message ?? "", "Behind it in the queue:");

    // The owner integrates the approved effort outside discern. Its stale
    // entry now offers its own reconciliation on both surfaces.
    await git(root, "merge", "--ff-only", "agent/public-done");
    const stale = await queueOf();
    const staleRow = stale.find((row) => row.effort === "public-done");
    assertEquals(staleRow?.on_trunk, true);
    assertStringIncludes(
      staleRow?.reason ?? "",
      "discern accept --reconcile --target public-done",
    );
    const stalePreview = await runAgent(root, [
      "accept",
      "--target",
      "public-done",
      "--dry-run",
      "--json",
    ]);
    assertEquals(stalePreview.code, 0, stalePreview.output);
    const staleData = decodeCliResult(stalePreview.stdout, "accept");
    assert(
      staleData.data !== undefined && "queue" in staleData.data,
      stalePreview.output,
    );
    const stalePlanRow = staleData.data.queue?.find((row) =>
      row.effort === "public-done"
    );
    assertStringIncludes(
      stalePlanRow?.pending[0]?.reason ?? "",
      "discern accept --reconcile --target public-done",
      stalePreview.output,
    );
  });
});
