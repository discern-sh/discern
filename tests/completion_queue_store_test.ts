import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_EXECUTOR,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import {
  initializeQueue,
  observeQueue,
  replaceQueue,
  requireQueue,
  reserveQueueAttempt,
} from "../src/engine/landing_queue/repository.ts";
import {
  checkQueueClaim,
  claimQueueWork,
} from "../src/engine/landing_queue/claims.ts";
import { mutateQueue } from "../src/engine/landing_queue/mutations.ts";
import { CompletionPolicySchema } from "../src/engine/completion/configuration.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import { join } from "@std/path";
import { reconcileQueueWork } from "../src/engine/landing_queue/recovery.ts";

/** A configured committed file makes every storage fixture a real project. */
async function initializeRepository(root: string): Promise<void> {
  await Deno.writeTextFile(
    join(root, "discern.toml"),
    '[project]\nslug = "queue-test"\n',
  );
  await gitInit(root);
}

Deno.test("queue Q06: CAS sequence reservations never repeat across concurrent actors or revision history", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const trunk = await gitOut(root, "rev-parse", "HEAD");
    assertEquals((await initializeQueue(root, trunk)).kind, "written");
    const first = await requireQueue(root);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        reserveQueueAttempt(
          root,
          { candidate_id: completionId(100) },
          COMPLETION_EXECUTOR,
          null,
          COMPLETION_CLOCK,
        )),
    );
    const sequences = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.sequence] : []
    );
    assert(sequences.length > 0);
    assertEquals(new Set(sequences).size, sequences.length);
    assertEquals(
      (await replaceQueue(root, first, first.record.data)).kind,
      "conflict",
    );
    const history = await readCompletionRecord(root, first.record, 1);
    assertEquals(history.kind, "recorded");
    const next = await reserveQueueAttempt(
      root,
      { candidate_id: completionId(101) },
      COMPLETION_EXECUTOR,
      null,
      COMPLETION_CLOCK,
    );
    assert(next.sequence > Math.max(...sequences));
  });
});

Deno.test("queue Q06/Q08: short claims reserve capacity and superseded publishers lose exact ownership", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const { queue, candidates } = queueExample(3);
    const trunk = await gitOut(root, "rev-parse", "HEAD");
    await initializeQueue(root, trunk);
    const initial = await requireQueue(root);
    await replaceQueue(root, initial, { ...queue, trunk });
    const before = await requireQueue(root);
    const claim = await claimQueueWork({
      root,
      expected_stamp: before.stamp,
      effort: "effort-0",
      candidate_id: completionId(100),
      environment_id: completionId(50),
      executor: COMPLETION_EXECUTOR,
      policy: CompletionPolicySchema.parse({ concurrency: 1 }),
      lease_ms: 50,
      rerun_of: null,
      clock: COMPLETION_CLOCK,
    });
    assert("fence" in claim);
    const candidate = candidates.get(completionId(100));
    assert(candidate !== undefined);
    assert(await checkQueueClaim(root, claim, candidate, COMPLETION_CLOCK));
    assertEquals(
      await checkQueueClaim(root, claim, candidate, {
        ...COMPLETION_CLOCK,
        wallNow: () => 151,
      }),
      false,
    );
    const observed = await requireQueue(root);
    await mutateQueue({
      root,
      trunk: "main",
      expected_stamp: observed.stamp,
      mutation: { kind: "withdrawn", effort: "effort-0" },
      clock: COMPLETION_CLOCK,
    });
    assertEquals(
      await checkQueueClaim(root, claim, candidate, COMPLETION_CLOCK),
      false,
    );
    const attempt = await readCompletionRecord(root, {
      kind: "attempt",
      id: claim.fence.attempt_id,
    });
    assert(attempt.kind === "recorded" && attempt.record.kind === "attempt");
    assertEquals(attempt.record.data.state.kind, "recovery");
    const observation = await observeQueue(root, "main", COMPLETION_CLOCK);
    assertEquals(observation.trunk, trunk);
  });
});

Deno.test("queue Q06: a crash between reservation and claim retains an explicit occupied gap", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const { queue } = queueExample(2);
    await initializeQueue(root, queue.trunk);
    await replaceQueue(root, await requireQueue(root), queue);
    const before = await requireQueue(root);
    await assertRejects(
      () =>
        claimQueueWork({
          root,
          expected_stamp: before.stamp,
          effort: "effort-0",
          candidate_id: completionId(100),
          environment_id: completionId(50),
          executor: COMPLETION_EXECUTOR,
          policy: CompletionPolicySchema.parse({}),
          lease_ms: 50,
          rerun_of: null,
          clock: COMPLETION_CLOCK,
          afterReservation: () => Promise.reject(new Error("controlled crash")),
        }),
      Error,
      "controlled crash",
    );
    const after = await requireQueue(root);
    assertEquals(after.record.data.entries[0]?.state, "active");
    assert(after.record.revision > before.record.revision);
    const retry = await claimQueueWork({
      root,
      expected_stamp: after.stamp,
      effort: "effort-0",
      candidate_id: completionId(101),
      environment_id: completionId(50),
      executor: COMPLETION_EXECUTOR,
      policy: CompletionPolicySchema.parse({}),
      lease_ms: 50,
      rerun_of: null,
      clock: COMPLETION_CLOCK,
    });
    assertEquals(
      "kind" in retry ? retry.kind : "claimed",
      "environment-unavailable",
    );
    assertEquals(
      (await reconcileQueueWork({
        root,
        trunk: "main",
        effort: "effort-0",
        expected_stamp: after.stamp,
        clock: COMPLETION_CLOCK,
      })).kind,
      "released",
    );
    assertEquals(
      (await requireQueue(root)).record.data.entries[0]?.state,
      "provisional",
    );
  });
});

Deno.test("queue recovery retains red history without restoring an older verdict over a newer attempt", async () => {
  for (const outcome of ["passed", "failed"] as const) {
    await withTempDir(async (root) => {
      await initializeRepository(root);
      const { queue } = queueExample(1);
      await initializeQueue(root, queue.trunk);
      await replaceQueue(root, await requireQueue(root), {
        ...queue,
        entries: queue.entries.map((entry) => ({ ...entry, state: "active" })),
      });
      const template = COMPLETION_FAMILIES.attempt.schema.parse(
        completionFixtures().attempt,
      );
      for (const sequence of [1, 2]) {
        const id = completionId(700 + sequence);
        assertEquals(
          (await writeCompletionRecord(
            root,
            {
              ...template,
              id,
              data: {
                ...template.data,
                identity: {
                  ...template.data.identity,
                  id,
                  sequence,
                  candidate_id: completionId(100),
                },
                subjects: [],
                state: {
                  kind: "finished",
                  outcome: sequence === 1 ? "failed" : outcome,
                  finished_at: 90,
                },
              },
            },
            null,
            undefined,
            COMPLETION_CLOCK,
          )).kind,
          "written",
        );
      }
      const current = await requireQueue(root);
      assertEquals(
        (await reconcileQueueWork({
          root,
          trunk: "main",
          effort: "effort-0",
          expected_stamp: current.stamp,
          clock: COMPLETION_CLOCK,
        })).kind,
        "released",
      );
      assertEquals(
        (await requireQueue(root)).record.data.entries[0]?.state,
        outcome === "failed" ? "failed" : "provisional",
      );
      assertEquals(
        (await readCompletionRecord(root, {
          kind: "attempt",
          id: completionId(701),
        })).kind,
        "recorded",
      );
    });
  }
});
