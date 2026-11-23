/**
 * The invocation timing record: every Git process and every window is
 * attributed to the invocation that ran it, and to no other, however the
 * invocations of one process overlap.
 */

import { assertEquals } from "@std/assert";
import type { Clock } from "../src/shared/clock.ts";
import {
  beginInvocationTiming,
  commandStarted,
  gitCallStarted,
  type InvocationTiming,
  invocationWindowsRequested,
  noteStepTransition,
} from "../src/shared/invocation_timing.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { PLAN_STEP_STATES } from "../src/shared/result.ts";

/** A clock the test advances by hand. */
type ManualClock = Clock & { advance(ms: number): void };

/** A clock that starts at an arbitrary instant and moves only when told to. */
function manualClock(): ManualClock {
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
function gitFor(clock: ManualClock, ms: number): void {
  const finished = gitCallStarted();
  clock.advance(ms);
  finished();
}

/** Run `work` inside one fresh record and drain it. */
async function recorded(
  windows: boolean,
  work: (clock: ManualClock) => void | Promise<void>,
): Promise<InvocationTiming | undefined> {
  const clock = manualClock();
  const record = beginInvocationTiming(clock, windows);
  await record.run(async () => {
    await work(clock);
  });
  return record.take();
}

Deno.test("an invocation with no Git process and no window records nothing", async () => {
  assertEquals(await recorded(true, () => {}), undefined);
});

Deno.test("an invocation that did not ask for windows records only its Git totals", async () => {
  const timing = await recorded(false, (clock) => {
    noteStepTransition("refresh", "started");
    const commandFinished = commandStarted("build");
    gitFor(clock, 12);
    commandFinished();
    noteStepTransition("refresh", "finished");
  });
  assertEquals(timing, { git_calls: 1, git_ms: 12 });
});

Deno.test("only the exact value 1 in the engine-timing switch asks for windows", () => {
  const withValue = (value: string | undefined) => ({
    get: (name: string) =>
      name === DISCERN_ENVIRONMENT_VARIABLES.engineTiming ? value : undefined,
  });
  assertEquals(invocationWindowsRequested(withValue("1")), true);
  for (const value of [undefined, "", "0", "true", "yes", " 1"]) {
    assertEquals(invocationWindowsRequested(withValue(value)), false, value);
  }
});

Deno.test("a window carries its offset, its length, and the Git activity before and inside it", async () => {
  const timing = await recorded(true, (clock) => {
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
  });

  assertEquals(timing, {
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
});

Deno.test("every settled state closes a step window, and an unstarted step is left out", async () => {
  for (const settled of PLAN_STEP_STATES.filter((s) => s !== "started")) {
    const timing = await recorded(true, (clock) => {
      noteStepTransition("with-start", "started");
      clock.advance(7);
      noteStepTransition("with-start", settled);
      noteStepTransition("without-start", settled);
    });
    assertEquals(
      timing?.spans?.map((span) => [span.label, span.ms]),
      [["with-start", 7]],
      settled,
    );
  }
});

Deno.test("windows that share a label close most recent first, and overlapping windows share Git time", async () => {
  const timing = await recorded(true, (clock) => {
    noteStepTransition("lint", "started");
    clock.advance(5);
    const commandFinished = commandStarted("lint");
    noteStepTransition("lint", "started");
    gitFor(clock, 10);
    noteStepTransition("lint", "finished");
    clock.advance(5);
    noteStepTransition("lint", "failed");
    commandFinished();
  });

  assertEquals(
    timing?.spans?.map((span) => [
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

Deno.test("overlapping invocations keep their own Git processes and windows, whichever drains first", async () => {
  const clock = manualClock();
  const first = beginInvocationTiming(clock, true);
  const second = beginInvocationTiming(clock, true);
  const firstMayContinue = Promise.withResolvers<void>();

  // The first invocation starts, then waits while the second runs to its end.
  const firstRun = first.run(async () => {
    gitFor(clock, 5);
    await firstMayContinue.promise;
    noteStepTransition("only-first", "started");
    clock.advance(3);
    noteStepTransition("only-first", "finished");
  });
  await second.run(() => {
    noteStepTransition("only-second", "started");
    gitFor(clock, 7);
    const commandFinished = commandStarted("only-second");
    gitFor(clock, 1);
    commandFinished();
    noteStepTransition("only-second", "finished");
    return Promise.resolve();
  });
  firstMayContinue.resolve();
  await firstRun;

  // The first drains before the second, though the second finished first.
  const firstTiming = first.take();
  const secondTiming = second.take();
  assertEquals(firstTiming?.git_calls, 1);
  assertEquals(firstTiming?.git_ms, 5);
  assertEquals(firstTiming?.spans?.map((span) => span.label), ["only-first"]);
  assertEquals(secondTiming?.git_calls, 2);
  assertEquals(secondTiming?.git_ms, 8);
  assertEquals(
    secondTiming?.spans?.map((span) => [span.kind, span.label]),
    [["command", "only-second"], ["step", "only-second"]],
  );
});

Deno.test("activity outside every record, or after its record is drained, is recorded nowhere", async () => {
  const clock = manualClock();
  // Outside any record: the funnels have nothing to report to.
  gitFor(clock, 9);
  noteStepTransition("stray", "started");
  noteStepTransition("stray", "finished");
  commandStarted("stray")();

  const record = beginInvocationTiming(clock, true);
  let gitStraggler = (): void => {};
  let commandStraggler = (): void => {};
  await record.run(() => {
    gitStraggler = gitCallStarted();
    commandStraggler = commandStarted("slow");
    noteStepTransition("slow-step", "started");
    return Promise.resolve();
  });
  assertEquals(record.take(), undefined);

  // The record is drained; what was still open belongs to no record.
  clock.advance(30);
  gitStraggler();
  commandStraggler();
  await record.run(() => {
    gitFor(clock, 4);
    noteStepTransition("slow-step", "finished");
    return Promise.resolve();
  });
  assertEquals(record.take(), undefined);
});

Deno.test("a full record counts the windows it leaves out", async () => {
  const timing = await recorded(true, () => {
    for (let index = 0; index < 260; index++) {
      noteStepTransition(`step-${index}`, "started");
      noteStepTransition(`step-${index}`, "finished");
    }
  });
  assertEquals(timing?.spans?.length, 256);
  assertEquals(timing?.dropped, 4);
});
