import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname } from "@std/path";
import {
  ATTEMPT_CLAIM_RENEW_INTERVAL_MS,
  claimLossIsProven,
  recoverAbandonedAttempts,
  renewAttemptClaim,
  reserveAttempt,
  type ReservedAttempt,
  settleAttempt,
  withAttemptClaim,
} from "../src/engine/completion/attempt_lifecycle.ts";
import {
  ATTEMPT_CLAIM_LEASE_MS,
  AttemptClaimLost,
  cancellationReason,
  type CompletionAttempt,
} from "../src/engine/completion/attempt.ts";
import type { Clock } from "../src/shared/clock.ts";
import {
  completionRecordPath,
  type CompletionWriteOutcome,
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { openOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { runGit } from "../src/shared/subprocess.ts";
import type {
  IntervalHandle,
  Scheduler,
  TimeoutHandle,
} from "../src/shared/scheduler.ts";
import { withTempDir } from "./helpers.ts";
import { TEST_PROCESS_TIMEOUT_MS, waitUntil } from "./waiting.ts";
import { fakeSecureEntropy } from "./fake_secure_entropy.ts";
import { git } from "./engine_helpers.ts";
import {
  COMPLETION_CLOCK,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

Deno.test("completion ownership uses one bounded renewable lease", () => {
  assertEquals(ATTEMPT_CLAIM_LEASE_MS, 60_000);
  assertEquals(ATTEMPT_CLAIM_RENEW_INTERVAL_MS, 20_000);
});

/** Initialize one committed repository whose common Git state can hold records. */
async function initializeRepository(root: string): Promise<void> {
  const result = await runGit(["init", "-b", "main"], { cwd: root });
  assert(result.success, result.stderr);
  await git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Initialize",
  );
}

Deno.test("an expired completion claim is cancelled atomically and its old fence stays closed", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const attempt = completionFixtures().attempt;
    assert(attempt.kind === "attempt");
    const written = await writeCompletionRecord(
      root,
      attempt,
      null,
    );
    assert(written.kind === "written", JSON.stringify(written));

    const recovered = await recoverAbandonedAttempts(root, {
      clock: { ...COMPLETION_CLOCK, wallNow: () => 100_000 },
      ownerState: () => Promise.resolve("unknown"),
    });
    assertEquals(recovered, [attempt.id]);
    const current = await readCompletionRecord(root, attempt);
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state, {
      kind: "finished",
      outcome: "cancelled",
      finished_at: 100_000,
    });

    const fixture = completionFixtures().evidence;
    assertEquals(
      (await writeCompletionRecord(
        root,
        fixture,
        null,
        {
          attempt_id: attempt.id,
          token: attempt.data.state.kind === "claimed"
            ? attempt.data.state.claim.token
            : "unreachable",
        },
      )).kind,
      "claim-lost",
    );
  });
});

Deno.test("a live claim renews independently of project timeout budgets", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    let now = 1_000;
    const clock = {
      wallNow: (): number => now,
      monotonicNow: (): number => now,
    };
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(40),
        executor: {
          operation_id: completionId(41),
          originating_effort: "effort-a",
          started_at: now,
          operation_handle: "R1-AAAA-AAAA-AA",
        },
        rerun_of: null,
        mode: "strict",
      },
      clock,
      fakeSecureEntropy({
        uuids: [completionId(42), completionId(43)],
      }),
    );
    assert(reserved.attempt.state.kind === "planning");
    assertEquals(
      reserved.attempt.state.claim.expires_at,
      now + ATTEMPT_CLAIM_LEASE_MS,
    );

    now += 10_000;
    const renewed = await renewAttemptClaim(root, reserved.fence, clock);
    assertEquals(renewed.kind, "written");
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(current.kind === "recorded");
    assert(current.record.kind === "attempt");
    assert(current.record.data.state.kind === "planning");
    assertEquals(current.record.data.state.claim.renewed_at, now);
    assertEquals(
      current.record.data.state.claim.expires_at,
      now + ATTEMPT_CLAIM_LEASE_MS,
    );
    const archivedHeartbeat = await completionRecordPath(
      root,
      current.record,
      1,
    );
    assert(archivedHeartbeat !== undefined);
    let heartbeatArchived = true;
    try {
      await Deno.stat(archivedHeartbeat);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      heartbeatArchived = false;
    }
    assertEquals(heartbeatArchived, false);

    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock,
        ownerState: () => Promise.resolve("running"),
      }),
      [],
    );
    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock,
        ownerState: () => Promise.resolve("gone"),
      }),
      [reserved.attempt.identity.id],
    );
  });
});

Deno.test("a claim linked to a gone journal executor is recovered before lease expiry", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const journal = await openOperationJournal(
      root,
      { verb: "done", path: root },
      { pid: 2_000_000_000 },
    );
    assert(journal !== undefined);
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(50),
        executor: {
          operation_id: completionId(51),
          originating_effort: "effort-a",
          started_at: COMPLETION_CLOCK.wallNow(),
          operation_handle: journal.handle,
        },
        rerun_of: null,
        mode: "strict",
      },
      COMPLETION_CLOCK,
      fakeSecureEntropy({
        uuids: [completionId(52), completionId(53)],
      }),
    );

    assertEquals(
      await recoverAbandonedAttempts(root, { clock: COMPLETION_CLOCK }),
      [reserved.attempt.identity.id],
    );
  });
});

Deno.test("a graceful executor failure settles its claim before returning", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(60),
        executor: {
          operation_id: completionId(61),
          originating_effort: "effort-a",
          started_at: COMPLETION_CLOCK.wallNow(),
        },
        rerun_of: null,
        mode: "strict",
      },
      COMPLETION_CLOCK,
      fakeSecureEntropy({
        uuids: [completionId(62), completionId(63)],
      }),
    );
    await assertRejects(() =>
      withAttemptClaim(
        root,
        reserved.fence,
        new AbortController().signal,
        () => Promise.reject(new Error("fixture failure")),
        { clock: COMPLETION_CLOCK },
      )
    );
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state, {
      kind: "finished",
      outcome: "failed",
      finished_at: COMPLETION_CLOCK.wallNow(),
    });
  });
});

Deno.test("the live coordinator renews before settlement and retains only the semantic revision", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    let now = 1_000;
    const clock = {
      wallNow: (): number => now,
      monotonicNow: (): number => now,
    };
    let heartbeat: (() => void) | undefined;
    const scheduler: Scheduler = {
      scheduleInterval(callback): IntervalHandle {
        heartbeat = callback;
        return 1;
      },
      cancelInterval(): void {},
      scheduleTimeout(): TimeoutHandle {
        throw new Error("unexpected timeout");
      },
      cancelTimeout(): void {},
    };
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(70),
        executor: {
          operation_id: completionId(71),
          originating_effort: "effort-a",
          started_at: now,
        },
        rerun_of: null,
        mode: "strict",
      },
      clock,
      fakeSecureEntropy({
        uuids: [completionId(72), completionId(73)],
      }),
    );

    await withAttemptClaim(
      root,
      reserved.fence,
      new AbortController().signal,
      async (_signal, settle) => {
        now += 10_000;
        assert(heartbeat !== undefined);
        heartbeat();
        await settle("passed");
      },
      { clock, scheduler },
    );
    const renewed = await readCompletionRecord(
      root,
      { kind: "attempt", id: reserved.attempt.identity.id },
      2,
    );
    assert(renewed.kind === "recorded" && renewed.record.kind === "attempt");
    assert(renewed.record.data.state.kind === "planning");
    assertEquals(renewed.record.data.state.claim.renewed_at, now);
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state, {
      kind: "finished",
      outcome: "passed",
      finished_at: now,
    });
  });
});

Deno.test("only the attempt record itself proves a lost claim", () => {
  // Every write outcome a renewal can observe, classified once. A new member
  // of the union fails `deno check` here until it is placed deliberately.
  const classification = {
    "written": false,
    "claim-lost": true,
    "conflict": false,
    "transition-refused": false,
    "busy": false,
    "newer": false,
    "older": false,
    "invalid": false,
    "unavailable": false,
  } satisfies Record<CompletionWriteOutcome["kind"], boolean>;
  const sample = (
    kind: Exclude<CompletionWriteOutcome["kind"], "written">,
  ): Exclude<CompletionWriteOutcome, { kind: "written" }> =>
    kind === "newer" || kind === "older"
      ? { kind, version: 99 }
      : { kind, reason: "fixture" };
  for (const [kind, proven] of Object.entries(classification)) {
    if (kind === "written") continue;
    assertEquals(
      claimLossIsProven(
        sample(kind as Exclude<CompletionWriteOutcome["kind"], "written">),
      ),
      proven,
      kind,
    );
  }
});

/** A wall clock only the test moves. */
function handClock(start: number): {
  readonly clock: Clock;
  readonly now: () => number;
  readonly advance: (ms: number) => void;
} {
  let now = start;
  return {
    clock: { wallNow: (): number => now, monotonicNow: (): number => now },
    now: (): number => now,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

/**
 * The coordinator's heartbeat, fired only by the test. A stalled event loop
 * fires an overdue interval once it resumes; firing it after advancing the
 * clock past the lease is that stall, without spending real time.
 */
function handHeartbeat(): {
  readonly scheduler: Scheduler;
  readonly fire: () => void;
} {
  let heartbeat: (() => void) | undefined;
  return {
    scheduler: {
      scheduleInterval(callback): IntervalHandle {
        heartbeat = callback;
        return 1;
      },
      cancelInterval(): void {},
      scheduleTimeout(): TimeoutHandle {
        throw new Error("unexpected timeout");
      },
      cancelTimeout(): void {},
    },
    fire: (): void => {
      assert(heartbeat !== undefined, "the coordinator schedules renewal");
      heartbeat();
    },
  };
}

/** Reserve one attempt whose identifiers start at `seed`. */
async function reserveAt(
  root: string,
  seed: number,
  clock: Clock,
): Promise<ReservedAttempt> {
  return await reserveAttempt(
    root,
    {
      candidate_id: completionId(seed),
      executor: {
        operation_id: completionId(seed + 1),
        originating_effort: "effort-a",
        started_at: clock.wallNow(),
      },
      rerun_of: null,
      mode: "strict",
    },
    clock,
    fakeSecureEntropy({
      uuids: [completionId(seed + 2), completionId(seed + 3)],
    }),
  );
}

/** The attempt's candidate, published under its own fence. */
async function publishCandidate(
  root: string,
  reserved: ReservedAttempt,
): Promise<CompletionWriteOutcome> {
  const fixture = completionFixtures().candidate;
  assert(fixture.kind === "candidate");
  return await writeCompletionRecord(
    root,
    {
      ...fixture,
      id: reserved.attempt.identity.candidate_id,
      data: { ...fixture.data, attempt_id: reserved.attempt.identity.id },
    },
    null,
    reserved.fence,
  );
}

/** The attempt record as it stands now. */
async function attemptState(
  root: string,
  reserved: ReservedAttempt,
): Promise<CompletionAttempt["state"]> {
  const current = await readCompletionRecord(root, {
    kind: "attempt",
    id: reserved.attempt.identity.id,
  });
  assert(current.kind === "recorded" && current.record.kind === "attempt");
  return current.record.data.state;
}

/** Longer than the lease, as when a terminal stops reading for minutes. */
const STALL_MS = 150_000;

Deno.test("an owner whose lease lapsed while nobody retired it still renews, publishes, and settles", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    const reserved = await reserveAt(root, 100, time.clock);
    time.advance(STALL_MS);

    const renewed = await renewAttemptClaim(root, reserved.fence, time.clock);
    assertEquals(renewed.kind, "written");
    const state = await attemptState(root, reserved);
    assert(state.kind === "planning");
    assertEquals(state.claim.renewed_at, time.now());
    assertEquals(state.claim.expires_at, time.now() + ATTEMPT_CLAIM_LEASE_MS);

    time.advance(STALL_MS);
    assertEquals((await publishCandidate(root, reserved)).kind, "written");
    assertEquals(
      (await settleAttempt(root, reserved.fence, "passed", time.clock)).kind,
      "written",
    );
    assertEquals(await attemptState(root, reserved), {
      kind: "finished",
      outcome: "passed",
      finished_at: time.now(),
    });
  });
});

Deno.test("a retirement during the stall is refused at every claim-dependent step", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    const reserved = await reserveAt(root, 110, time.clock);
    time.advance(STALL_MS);
    // The lapsed lease permits the retirement even of an owner that looks
    // alive; the retirement, not the lapse, ends the claim.
    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock: time.clock,
        ownerState: () => Promise.resolve("running"),
      }),
      [reserved.attempt.identity.id],
    );
    const retired = await attemptState(root, reserved);

    for (
      const step of [
        () => renewAttemptClaim(root, reserved.fence, time.clock),
        () => publishCandidate(root, reserved),
        () => settleAttempt(root, reserved.fence, "cancelled", time.clock),
      ]
    ) assertEquals((await step()).kind, "claim-lost");
    assertEquals(await attemptState(root, reserved), retired);
  });
});

Deno.test("a renewal landing before a retirement is written keeps the claim", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    const reserved = await reserveAt(root, 120, time.clock);
    time.advance(STALL_MS);
    // Recovery observed the lapsed lease; the resumed owner renews before
    // recovery re-reads the record for its compare-and-swap.
    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock: time.clock,
        ownerState: async () => {
          assertEquals(
            (await renewAttemptClaim(root, reserved.fence, time.clock)).kind,
            "written",
          );
          return "unknown";
        },
      }),
      [],
    );
    assertEquals((await attemptState(root, reserved)).kind, "planning");
  });
});

Deno.test("the coordinator resumes after a stall and settles when nobody retired it", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    const heartbeat = handHeartbeat();
    const reserved = await reserveAt(root, 130, time.clock);

    const ended = await withAttemptClaim(
      root,
      reserved.fence,
      new AbortController().signal,
      async (signal, settle) => {
        time.advance(STALL_MS);
        heartbeat.fire();
        // Settlement drains the overdue renewal before it writes.
        await settle("passed");
        return signal.aborted;
      },
      { clock: time.clock, scheduler: heartbeat.scheduler },
    );
    assertEquals(ended, { kind: "settled", value: false });
    const renewed = await readCompletionRecord(
      root,
      { kind: "attempt", id: reserved.attempt.identity.id },
      2,
    );
    assert(renewed.kind === "recorded" && renewed.record.kind === "attempt");
    assert(renewed.record.data.state.kind === "planning");
    assertEquals(renewed.record.data.state.claim.renewed_at, time.now());
    assertEquals(await attemptState(root, reserved), {
      kind: "finished",
      outcome: "passed",
      finished_at: time.now(),
    });
  });
});

Deno.test("the coordinator learns of a retirement during its stall and ends as cancelled", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    const heartbeat = handHeartbeat();
    const reserved = await reserveAt(root, 140, time.clock);

    const ended = await withAttemptClaim(
      root,
      reserved.fence,
      new AbortController().signal,
      async (signal, settle) => {
        time.advance(STALL_MS);
        assertEquals(
          await recoverAbandonedAttempts(root, {
            clock: time.clock,
            ownerState: () => Promise.resolve("unknown"),
          }),
          [reserved.attempt.identity.id],
        );
        heartbeat.fire();
        await waitUntil(
          () => signal.aborted,
          "the resumed renewal to read the retirement",
          { timeoutMs: TEST_PROCESS_TIMEOUT_MS },
        );
        // The retirement already closed the attempt; settling a cancelled
        // run records nothing and raises nothing.
        await settle("cancelled");
        return cancellationReason(signal, "an unexplained cancellation");
      },
      { clock: time.clock, scheduler: heartbeat.scheduler },
    );
    // The run ends retired, and every cancellation it reported on the way
    // names the retirement as its reason.
    assertEquals(ended, {
      kind: "retired",
      value: new AttemptClaimLost().message,
    });
    const interrupted = new AbortController();
    interrupted.abort();
    assertEquals(
      cancellationReason(interrupted.signal, "an interruption"),
      "an interruption",
    );
    assertEquals(await attemptState(root, reserved), {
      kind: "finished",
      outcome: "cancelled",
      finished_at: time.now(),
    });
  });
});

/** The settlement a claimed run receives. */
type Settle = (outcome: "passed" | "failed" | "cancelled") => Promise<void>;

Deno.test("a run another run retired ends retired, whatever it returned or raised", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    // A pass, a failure, and a raised error all find the retirement at
    // settlement and end the same way, recording nothing.
    const endings = [
      async (settle: Settle): Promise<string> => {
        await settle("passed");
        return "passed";
      },
      async (settle: Settle): Promise<string> => {
        await settle("failed");
        return "failed";
      },
      (): Promise<string> => Promise.reject(new Error("a raised failure")),
    ];
    for (const [index, ending] of endings.entries()) {
      const reserved = await reserveAt(root, 150 + index * 4, time.clock);
      const claimed = await withAttemptClaim(
        root,
        reserved.fence,
        new AbortController().signal,
        async (_signal, settle) => {
          time.advance(STALL_MS);
          await recoverAbandonedAttempts(root, {
            clock: time.clock,
            ownerState: () => Promise.resolve("unknown"),
          });
          return await ending(settle);
        },
        { clock: time.clock, scheduler: handHeartbeat().scheduler },
      );
      assertEquals(claimed.kind, "retired", String(index));
      assertEquals(await attemptState(root, reserved), {
        kind: "finished",
        outcome: "cancelled",
        finished_at: time.now(),
      });
    }
  });
});

Deno.test("a renewal that cannot reach its record never ends the run", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const time = handClock(1_000);
    const heartbeat = handHeartbeat();
    const reserved = await reserveAt(root, 80, time.clock);
    // An unreadable record is a condition that can clear, not proof of loss.
    const record = await completionRecordPath(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(record !== undefined);
    await Deno.remove(record);
    assertEquals((await publishCandidate(root, reserved)).kind, "unavailable");

    const observed: boolean[] = [];
    await assertRejects(
      () =>
        withAttemptClaim(
          root,
          reserved.fence,
          new AbortController().signal,
          async (signal, settle) => {
            for (
              const interval of [ATTEMPT_CLAIM_RENEW_INTERVAL_MS, STALL_MS]
            ) {
              time.advance(interval);
              heartbeat.fire();
            }
            // Settlement drains every pending renewal before it writes.
            await assertRejects(() => settle("passed"));
            observed.push(signal.aborted);
          },
          { clock: time.clock, scheduler: heartbeat.scheduler },
        ),
      Error,
      "Completion attempt settlement unavailable",
    );
    assertEquals(observed, [false]);
  });
});

Deno.test("a failed settlement never replaces the reason the run ended", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const reserved = await reserveAt(root, 90, COMPLETION_CLOCK);
    // An unreadable attempt record fails the closing settlement.
    const record = await completionRecordPath(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(record !== undefined);
    await Deno.remove(record);
    const failure = new Error("fixture failure");
    const raised = await assertRejects(() =>
      withAttemptClaim(
        root,
        reserved.fence,
        new AbortController().signal,
        () => Promise.reject(failure),
        { clock: COMPLETION_CLOCK },
      )
    );
    assert(raised instanceof AggregateError);
    assertStringIncludes(raised.message, "fixture failure");
    assertStringIncludes(raised.message, "failed to settle");
    // The run's own failure leads and survives as an object, beside the
    // settlement failure it must never be replaced by.
    assertEquals(raised.errors[0], failure);
    assertEquals(raised.errors.length, 2);

    // A run that ended on its own failed settlement has one failure.
    const once = await assertRejects(() =>
      withAttemptClaim(
        root,
        reserved.fence,
        new AbortController().signal,
        (_signal, settle) => settle("failed"),
        { clock: COMPLETION_CLOCK },
      )
    );
    assert(!(once instanceof AggregateError));
    assertStringIncludes(
      String(once),
      "Completion attempt settlement unavailable",
    );
  });
});

Deno.test("recovery leaves a claim it cannot retire instead of throwing past the envelope", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const attempt = completionFixtures().attempt;
    assert(attempt.kind === "attempt");
    assert(
      (await writeCompletionRecord(
        root,
        attempt,
        null,
      ))
        .kind === "written",
    );
    // Occupy this revision's history slot with other bytes, so the cancelling
    // write is refused exactly as a busy lock or unwritable store refuses it.
    const archive = await completionRecordPath(root, attempt, attempt.revision);
    assert(archive !== undefined);
    await Deno.mkdir(dirname(archive), { recursive: true });
    await Deno.writeTextFile(archive, "{}\n");

    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock: { ...COMPLETION_CLOCK, wallNow: () => 100_000 },
        ownerState: () => Promise.resolve("gone"),
      }),
      [],
    );
    const current = await readCompletionRecord(root, attempt);
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state.kind, "claimed");
  });
});
