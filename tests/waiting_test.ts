import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import type { Clock } from "../src/shared/clock.ts";
import type {
  IntervalHandle,
  Scheduler,
  TimeoutHandle,
} from "../src/shared/scheduler.ts";
import {
  realDelay,
  settlePending,
  TEST_PROCESS_TIMEOUT_MS,
  waitForPendingCondition,
  waitUntil,
} from "./waiting.ts";

interface ControlledTiming {
  readonly clock: Clock;
  readonly scheduler: StepScheduler;
  jumpWall(deltaMs: number): void;
}

/** Deterministic scheduler for pure wait-bound calculations. */
class StepScheduler implements Scheduler {
  #nextHandle = 0;
  readonly #advance: (delayMs: number) => void;
  readonly #timeouts = new Map<
    TimeoutHandle,
    { readonly callback: () => void; readonly delayMs: number }
  >();

  constructor(advance: (delayMs: number) => void) {
    this.#advance = advance;
  }

  scheduleTimeout(callback: () => void, delayMs: number): TimeoutHandle {
    const handle = ++this.#nextHandle;
    this.#timeouts.set(handle, { callback, delayMs });
    return handle;
  }

  cancelTimeout(handle: TimeoutHandle): void {
    this.#timeouts.delete(handle);
  }

  scheduleInterval(_callback: () => void, _intervalMs: number): IntervalHandle {
    throw new Error("StepScheduler intervals are outside this wait test");
  }

  cancelInterval(_handle: IntervalHandle): void {}

  fireNextTimeout(): void {
    const next = this.#timeouts.entries().next().value;
    if (next === undefined) throw new Error("no scheduled wait turn");
    const [handle, scheduled] = next;
    this.#timeouts.delete(handle);
    this.#advance(scheduled.delayMs);
    scheduled.callback();
  }
}

/** Let one resolved condition and its following schedule turn settle. */
async function flushWaitTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Advance an injected monotonic source only when a scheduled turn fires. */
function controlledTiming(initialWallMs: number): ControlledTiming {
  let wallMs = initialWallMs;
  let monotonicMs = 0;
  const scheduler = new StepScheduler((delayMs) => {
    monotonicMs += delayMs;
  });
  return {
    clock: {
      wallNow: () => wallMs,
      monotonicNow: () => monotonicMs,
    },
    scheduler,
    jumpWall(deltaMs: number): void {
      wallMs += deltaMs;
    },
  };
}

Deno.test("waitUntil succeeds without scheduling when the condition is immediate", async () => {
  let calls = 0;
  await waitUntil(() => {
    calls++;
    return true;
  }, "the immediate condition");
  assertEquals(calls, 1);
});

Deno.test("waitUntil progresses through deterministic scheduler time", async () => {
  const timing = controlledTiming(1_000);
  const pending = waitUntil(
    () => timing.clock.monotonicNow() >= 25,
    "the fake-time condition",
    {
      timeoutMs: 100,
      intervalMs: 10,
      clock: timing.clock,
      scheduler: timing.scheduler,
    },
  );
  await flushWaitTurn();
  for (let turn = 0; turn < 3; turn++) {
    timing.scheduler.fireNextTimeout();
    await flushWaitTurn();
  }
  await pending;
});

Deno.test("waitUntil follows monotonic time across wall-clock jumps", async () => {
  const timing = controlledTiming(50_000);
  let attempts = 0;
  const pending = waitUntil(
    () => ++attempts >= 4,
    "the monotonic condition",
    {
      timeoutMs: 50,
      intervalMs: 10,
      clock: timing.clock,
      scheduler: timing.scheduler,
    },
  );
  await flushWaitTurn();
  timing.jumpWall(-40_000);
  timing.scheduler.fireNextTimeout();
  await flushWaitTurn();
  timing.jumpWall(90_000);
  timing.scheduler.fireNextTimeout();
  await flushWaitTurn();
  timing.jumpWall(-120_000);
  timing.scheduler.fireNextTimeout();
  await flushWaitTurn();
  await pending;
  assertEquals(attempts, 4);
});

Deno.test("waitUntil timeout names the condition and bounded timing evidence", async () => {
  const timing = controlledTiming(2_000);
  const pending = assertRejects(
    () =>
      waitUntil(() => false, "the missing marker", {
        timeoutMs: 25,
        intervalMs: 10,
        clock: timing.clock,
        scheduler: timing.scheduler,
      }),
    Error,
  );
  await flushWaitTurn();
  for (let turn = 0; turn < 3; turn++) {
    timing.scheduler.fireNextTimeout();
    await flushWaitTurn();
  }
  const error = await pending;
  assertStringIncludes(error.message, "the missing marker");
  assertStringIncludes(error.message, "budget 25ms");
  assertStringIncludes(error.message, "interval 10ms");
  assertStringIncludes(error.message, "attempts)");
});

Deno.test("waitUntil reports a thrown condition with its original cause", async () => {
  const cause = new Error("probe failed");
  const error = await assertRejects(
    () =>
      waitUntil(
        () => {
          throw cause;
        },
        "the fallible probe",
        {
          clock: {
            wallNow: () => 100,
            monotonicNow: () => 0,
          },
        },
      ),
    Error,
    "condition 'the fallible probe' threw on attempt 1 after 0ms",
  );
  assertEquals(error.cause, cause);
});

Deno.test("pending-condition readiness keeps one load-safe infrastructure budget", async () => {
  const timing = controlledTiming(2_000);
  const never = new Promise<never>(() => {});
  const pending = assertRejects(
    () =>
      waitForPendingCondition(
        never,
        () => false,
        "the delayed process marker",
        {
          intervalMs: TEST_PROCESS_TIMEOUT_MS,
          clock: timing.clock,
          scheduler: timing.scheduler,
        },
      ),
    Error,
  );
  await flushWaitTurn();
  timing.scheduler.fireNextTimeout();
  await flushWaitTurn();
  const error = await pending;
  assertStringIncludes(error.message, "the delayed process marker");
  assertStringIncludes(error.message, `budget ${TEST_PROCESS_TIMEOUT_MS}ms`);
});

Deno.test("pending-condition readiness reports early operation settlement", async () => {
  const error = await assertRejects(
    () =>
      waitForPendingCondition(
        Promise.resolve({ kind: "finished" }),
        () => false,
        "the planted marker",
      ),
    Error,
  );
  assertStringIncludes(
    error.message,
    "was not observed before the pending operation settled",
  );
});

Deno.test("settlePending keeps post-readiness behavior budgets explicit", async () => {
  assertEquals(
    await settlePending(Promise.resolve("complete"), "the ready operation", {
      timeoutMs: 25,
    }),
    "complete",
  );
});

Deno.test("realDelay follows the test scheduler without spending wall time", async () => {
  using time = new FakeTime(3_000);
  let settled = false;
  const pending = realDelay("waiting-real-delay-fake-time", 25).then(() => {
    settled = true;
  });
  await time.tickAsync(24);
  assertEquals(settled, false);
  await time.tickAsync(1);
  await pending;
  assertEquals(settled, true);
});
