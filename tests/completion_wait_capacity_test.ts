/** Cancellation and live capacity transitions use observable barriers and a manual clock. */
import { assert, assertEquals } from "@std/assert";
import { waitForCompletionCapacity } from "../src/engine/completion/capacity.ts";
import { completionRecordBlocker } from "../src/engine/completion/compatibility.ts";
import type { CompletionObservation } from "../src/engine/completion/protocol.ts";
import {
  queueCapacityBlocker,
  workCapacity,
} from "../src/engine/landing_queue/claims.ts";
import { CompletionPolicySchema } from "../src/shared/config_schema.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_RECOVERY,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { ManualScheduler } from "./manual_scheduler.ts";
import {
  type CompletionRecord,
  CompletionRecordSchema,
} from "../src/engine/completion/records.ts";

/** Wrap validated fixture records in the same read-only inventory as the store. */
function observation(
  records: readonly CompletionRecord[],
): CompletionObservation {
  return {
    trunk: "a".repeat(40),
    observed_at: 100,
    records: records.map((record) => ({
      selector: record,
      reading: { kind: "recorded", record, stamp: "fixture" },
    })),
  };
}

Deno.test("completion capacity names unequal limits, reservation, lookahead, live actors, and retained recovery", () => {
  const example = queueExample(2);
  const fixtures = completionFixtures();
  assert(
    fixtures.attempt.kind === "attempt" &&
      fixtures.environment.kind === "environment",
  );
  const [first, second] = example.queue.entries;
  assert(first !== undefined && second !== undefined);
  const active = {
    ...first,
    state: "active" as const,
    candidate_id: fixtures.attempt.data.identity.candidate_id,
  };
  const entries = [active, second];
  const policy = CompletionPolicySchema.parse({ concurrency: 1, lookahead: 3 });
  const blocked = workCapacity(entries, second.source.effort_id, policy, true);
  assert(blocked?.kind === "capacity-unavailable");
  assertEquals(blocked.capacity.setting, "completion.concurrency");
  assertEquals(blocked.capacity.limit, 1);
  assertEquals(blocked.capacity.occupied, 1);
  assertEquals(blocked.capacity.reserved, 0);
  const live = queueCapacityBlocker(
    blocked,
    entries,
    observation([fixtures.attempt]),
  );
  assert(live.kind === "capacity-unavailable" && live.transient);
  assertEquals(live.capacity.blockers, [fixtures.attempt.id]);
  assertEquals(
    workCapacity(
      entries,
      second.source.effort_id,
      CompletionPolicySchema.parse({ concurrency: 2 }),
      true,
    ),
    undefined,
  );
  assertEquals(
    queueCapacityBlocker(blocked, entries, observation([])).kind,
    "environment-unavailable",
  );
  const environment = {
    ...fixtures.environment,
    data: {
      ...fixtures.environment.data,
      state: {
        kind: "executing" as const,
        attempt_id: fixtures.attempt.id,
        candidate_id: fixtures.attempt.data.identity.candidate_id,
        release_id: completionId(22),
        phase: "validate" as const,
        claim: COMPLETION_CLAIM,
      },
    },
  };
  assertEquals(
    queueCapacityBlocker(
      blocked,
      entries,
      observation([fixtures.attempt, environment]),
    ).kind,
    "capacity-unavailable",
  );
  const expired = {
    ...environment,
    data: {
      ...environment.data,
      state: {
        ...environment.data.state,
        claim: { ...COMPLETION_CLAIM, expires_at: 100 },
      },
    },
  };
  assertEquals(
    queueCapacityBlocker(blocked, entries, observation([expired])).kind,
    "environment-unavailable",
  );
  const recovery = {
    ...environment,
    data: {
      ...environment.data,
      state: {
        kind: "recovery" as const,
        attempt_id: fixtures.attempt.id,
        recovery: COMPLETION_RECOVERY,
      },
    },
  };
  assertEquals(
    queueCapacityBlocker(
      blocked,
      entries,
      observation([CompletionRecordSchema.parse(recovery)]),
    ).kind,
    "recovery-incomplete",
  );
  const reserved = workCapacity(
    example.queue.entries,
    second.source.effort_id,
    policy,
    false,
  );
  assert(reserved?.kind === "capacity-unavailable");
  assertEquals(reserved.capacity.reserved, 1);
  assertEquals(
    queueCapacityBlocker(reserved, example.queue.entries, observation([])),
    reserved,
  );
  const depth = workCapacity(
    entries,
    second.source.effort_id,
    CompletionPolicySchema.parse({ concurrency: 4, lookahead: 0 }),
  );
  assert(depth?.kind === "capacity-unavailable");
  assertEquals(depth.capacity.setting, "completion.lookahead");
  const depthWait = queueCapacityBlocker(
    depth,
    entries,
    observation([fixtures.attempt]),
  );
  assert(depthWait.kind === "capacity-unavailable");
  assertEquals(depthWait.transient, false);
});

for (const terminal of ["passed", "failed", "cancelled"] as const) {
  Deno.test(`capacity wakes after ${terminal} returns its slot without waiting for lease expiry`, async () => {
    const scheduler = new ManualScheduler();
    const signal = new AbortController();
    const observed = Promise.withResolvers<void>();
    const fixtures = completionFixtures();
    assert(fixtures.attempt.kind === "attempt");
    const [first, second] = queueExample(2).queue.entries;
    assert(first !== undefined && second !== undefined);
    let entries = [{
      ...first,
      state: "active" as const,
      candidate_id: fixtures.attempt.data.identity.candidate_id,
    }, second];
    let records: CompletionRecord[] = [fixtures.attempt];
    let observations = 0;
    const running = waitForCompletionCapacity({
      signal: signal.signal,
      scheduler,
      observe: () => {
        observations++;
        const result = workCapacity(
          entries,
          second.source.effort_id,
          CompletionPolicySchema.parse({ concurrency: 1 }),
          true,
        );
        return Promise.resolve(
          result?.kind === "capacity-unavailable"
            ? queueCapacityBlocker(result, entries, observation(records))
            : result ?? null,
        );
      },
      waiting: (value) =>
        value?.kind === "capacity-unavailable" && value.transient,
      onWait: () => observed.resolve(),
    });
    await observed.promise;
    assertEquals(observations, 1);
    records = [
      CompletionRecordSchema.parse({
        ...fixtures.attempt,
        revision: 2,
        data: {
          ...fixtures.attempt.data,
          state: { kind: "finished", outcome: terminal, finished_at: 101 },
        },
      }),
    ];
    entries = [{
      ...first,
      state: terminal === "failed" ? "failed" : "provisional",
    }, second];
    scheduler.fire(100);
    assertEquals(await running, null);
    assertEquals(observations, 2);
    assertEquals(scheduler.pending.size, 0);
  });
}

Deno.test("capacity cancellation disposes its wake; recovery and impossible eligibility never wait", async () => {
  const scheduler = new ManualScheduler();
  const controller = new AbortController();
  const observed = Promise.withResolvers<void>();
  const running = waitForCompletionCapacity({
    signal: controller.signal,
    scheduler,
    observe: () =>
      Promise.resolve({
        kind: "waiting-for-operation" as const,
        attempt_id: completionId(2),
        expires_at: 1000,
      }),
    waiting: () => true,
    onWait: () => observed.resolve(),
  });
  await observed.promise;
  controller.abort();
  assertEquals((await running).kind, "cancelled");
  assertEquals(scheduler.pending.size, 0);
  let reads = 0;
  assertEquals(
    (await waitForCompletionCapacity({
      signal: controller.signal,
      scheduler,
      observe: () => {
        reads++;
        return Promise.resolve(null);
      },
      waiting: () => true,
    }))?.kind,
    "cancelled",
  );
  assertEquals(reads, 0);
  for (
    const blocker of [
      {
        kind: "recovery-incomplete" as const,
        record_id: completionId(1),
        recovery: COMPLETION_RECOVERY,
      },
      {
        kind: "environment-unavailable" as const,
        reason: "No eligible environment; update source before retrying.",
      },
    ]
  ) {
    assertEquals(
      await waitForCompletionCapacity({
        signal: new AbortController().signal,
        scheduler,
        observe: () => Promise.resolve(blocker),
        waiting: (value) => value.kind === "waiting-for-operation",
      }),
      blocker,
    );
    assertEquals(scheduler.pending.size, 0);
  }
});

Deno.test("compatibility diagnostics distinguish newer, unsupported older, corruption, and unavailable bytes", () => {
  const selector = { kind: "queue" as const, id: completionId(1) };
  for (
    const reading of [
      { kind: "missing" as const },
      { kind: "newer" as const, version: 999 },
      { kind: "older" as const, version: 1 },
      { kind: "invalid" as const, reason: "damaged JSON" },
      { kind: "unavailable" as const, reason: "unreadable" },
    ]
  ) {
    const blocker = completionRecordBlocker({
      records: [{ selector, reading }],
    });
    assertEquals(
      blocker?.kind,
      reading.kind === "missing"
        ? undefined
        : reading.kind === "invalid"
        ? "record-corrupt"
        : reading.kind === "unavailable"
        ? "environment-unavailable"
        : "record-incompatible",
    );
  }
  assertEquals(
    completionRecordBlocker(observation(Object.values(completionFixtures()))),
    undefined,
  );
});
