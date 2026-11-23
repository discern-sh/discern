/**
 * The invocation timing accumulator: every Git process and every window is
 * attributed to the invocation that ran it, and to no other.
 */

import { assertEquals } from "@std/assert";
import type { Clock } from "../src/shared/clock.ts";
import {
  beginInvocationTiming,
  commandStarted,
  gitCallStarted,
  noteStepTransition,
  takeInvocationTiming,
} from "../src/shared/invocation_timing.ts";
import { PLAN_STEP_STATES } from "../src/shared/result.ts";

/** A clock the test advances by hand. */
function manualClock(): Clock & { advance(ms: number): void } {
  let now = 1_000;
  return {
    wallNow: () => now,
    monotonicNow: () => now,
    advance(ms: number): void {
      now += ms;
    },
  };
}

/** Run one Git process that lasts `ms` on the manual clock. */
function gitFor(clock: { advance(ms: number): void }, ms: number): void {
  const finished = gitCallStarted();
  clock.advance(ms);
  finished();
}

Deno.test("an invocation with no Git process and no window records nothing", () => {
  beginInvocationTiming(manualClock());
  assertEquals(takeInvocationTiming(), undefined);
});

Deno.test("a window carries its offset, its length, and the Git activity before and inside it", () => {
  const clock = manualClock();
  beginInvocationTiming(clock);

  clock.advance(40);
  gitFor(clock, 10);

  noteStepTransition("refresh", "started");
  gitFor(clock, 25);
  clock.advance(75);
  noteStepTransition("refresh", "finished");

  gitFor(clock, 5);
  const commandFinished = commandStarted("build");
  clock.advance(60);
  commandFinished();

  assertEquals(takeInvocationTiming(), {
    git_calls: 3,
    git_ms: 40,
    spans: [
      {
        kind: "step",
        label: "refresh",
        start_ms: 50,
        ms: 100,
        git_calls_before: 1,
        git_ms_before: 10,
        git_calls: 1,
        git_ms: 25,
      },
      {
        kind: "command",
        label: "build",
        start_ms: 155,
        ms: 60,
        git_calls_before: 3,
        git_ms_before: 40,
        git_calls: 0,
        git_ms: 0,
      },
    ],
  });
  assertEquals(takeInvocationTiming(), undefined);
});

Deno.test("every settled state closes a step window, and an unstarted step is left out", () => {
  for (const settled of PLAN_STEP_STATES.filter((s) => s !== "started")) {
    const clock = manualClock();
    beginInvocationTiming(clock);
    noteStepTransition("with-start", "started");
    clock.advance(7);
    noteStepTransition("with-start", settled);
    noteStepTransition("without-start", settled);

    assertEquals(
      takeInvocationTiming()?.spans.map((span) => [span.label, span.ms]),
      [["with-start", 7]],
      settled,
    );
  }
});

Deno.test("windows that share a label close most recent first, and overlapping windows share Git time", () => {
  const clock = manualClock();
  beginInvocationTiming(clock);
  noteStepTransition("lint", "started");
  clock.advance(5);
  const commandFinished = commandStarted("lint");
  noteStepTransition("lint", "started");
  gitFor(clock, 10);
  noteStepTransition("lint", "finished");
  clock.advance(5);
  noteStepTransition("lint", "failed");
  commandFinished();

  assertEquals(
    takeInvocationTiming()?.spans.map((span) => [
      span.kind,
      span.start_ms,
      span.ms,
      span.git_calls,
      span.git_ms,
    ]),
    [
      ["step", 5, 10, 1, 10],
      ["step", 0, 20, 1, 10],
      ["command", 5, 15, 1, 10],
    ],
  );
});

Deno.test("a process that outlives its invocation belongs to no record", () => {
  const clock = manualClock();
  beginInvocationTiming(clock);
  const gitStraggler = gitCallStarted();
  const commandStraggler = commandStarted("slow");

  beginInvocationTiming(clock);
  clock.advance(30);
  gitStraggler();
  commandStraggler();

  assertEquals(takeInvocationTiming(), undefined);
});

Deno.test("a full record counts the windows it leaves out", () => {
  const clock = manualClock();
  beginInvocationTiming(clock);
  for (let index = 0; index < 260; index++) {
    noteStepTransition(`step-${index}`, "started");
    noteStepTransition(`step-${index}`, "finished");
  }
  const timing = takeInvocationTiming();
  assertEquals(timing?.spans.length, 256);
  assertEquals(timing?.dropped, 4);
});
