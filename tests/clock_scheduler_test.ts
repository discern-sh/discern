/** Focused contracts for wall/monotonic clocks, timers, and scheduling jitter. */

import { assertEquals, assertThrows } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { type Clock, wallTimeIso } from "../src/shared/clock.ts";
import {
  schedulingJitterDelay,
  SYSTEM_SCHEDULER,
} from "../src/shared/scheduler.ts";

Deno.test("fixed wall and monotonic clocks retain distinct meanings", () => {
  const clock: Clock = {
    wallNow: () => Date.parse("2026-08-27T12:34:56.789Z"),
    monotonicNow: () => 42.5,
  };

  assertEquals(wallTimeIso(clock.wallNow()), "2026-08-27T12:34:56.789Z");
  assertEquals(clock.monotonicNow(), 42.5);
});

Deno.test("system scheduler preserves order and interval cancellation", async () => {
  using time = new FakeTime(0);
  const events: string[] = [];
  const cancelled = SYSTEM_SCHEDULER.scheduleTimeout(
    () => events.push("cancelled timeout"),
    5,
  );
  SYSTEM_SCHEDULER.cancelTimeout(cancelled);
  const interval = SYSTEM_SCHEDULER.scheduleInterval(
    () => events.push("interval"),
    10,
  );
  SYSTEM_SCHEDULER.scheduleTimeout(() => events.push("timeout"), 15);

  await time.tickAsync(25);
  SYSTEM_SCHEDULER.cancelInterval(interval);
  await time.tickAsync(25);

  assertEquals(events, ["interval", "timeout", "interval"]);
});

Deno.test("scheduling jitter is bounded and rejects invalid inputs", () => {
  assertEquals(schedulingJitterDelay(1_000, 0), 750);
  assertEquals(schedulingJitterDelay(1_000, 0.5), 1_000);
  assertEquals(schedulingJitterDelay(1_000, 1), 1_250);
  assertThrows(() => schedulingJitterDelay(-1, 0.5), RangeError);
  assertThrows(() => schedulingJitterDelay(1, -0.01), RangeError);
  assertThrows(() => schedulingJitterDelay(1, 1.01), RangeError);
});
