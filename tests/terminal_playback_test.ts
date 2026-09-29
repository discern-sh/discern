/** Plan/apply coverage for generic in-place terminal animation playback. */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  applyTerminalPlayback,
  planTerminalPlayback,
  type TerminalAnimationScene,
  type TerminalPlaybackPlan,
} from "../src/lib/terminal_playback.ts";

import {
  abortableWait,
  runTerminalPlayback,
  terminalPlaybackPort,
} from "../src/lib/terminal_animation.ts";
import { ManualScheduler } from "./manual_scheduler.ts";

const SCENES: readonly TerminalAnimationScene[] = [
  {
    label: "[one]",
    frames: ["A", "B"],
    frameMs: 10,
    finalHoldMs: 20,
  },
  {
    label: "[two]",
    frames: ["界\ne\u0301", "C"],
    frameMs: 30,
    finalHoldMs: 0,
  },
];
const STABLE_TERMINAL_SIZE = (): { columns: number; rows: number } => ({
  columns: 80,
  rows: 24,
});

/** Plan the shared fixture and fail the test immediately if its width cannot fit. */
function fixturePlan(): TerminalPlaybackPlan {
  const plan = planTerminalPlayback(SCENES, {
    terminalColumns: 80,
    terminalRows: 24,
    finalTranscript: "static",
  });
  if (plan === null) {
    throw new Error("fixture playback plan did not fit");
  }
  return plan;
}

Deno.test("terminal playback planning measures Unicode and keeps a wrap margin", () => {
  const plan = fixturePlan();
  assertEquals(plan.maxWidth, 5);
  assertEquals(plan.maxHeight, 3);
  assertEquals(
    planTerminalPlayback(SCENES, {
      terminalColumns: 5,
      terminalRows: 24,
      finalTranscript: "static",
    }),
    null,
  );

  const shortTerminal = {
    terminalColumns: 80,
    terminalRows: 3,
    finalTranscript: "static",
  };
  assertEquals(planTerminalPlayback(SCENES, shortTerminal), null);
});

Deno.test("terminal playback establishes a fresh row without persistent cursor modes", async () => {
  const writes = ["same-line prefix"];
  await applyTerminalPlayback(
    fixturePlan(),
    {
      write: (value) => writes.push(value),
      wait: () => Promise.resolve(),
      terminalSize: STABLE_TERMINAL_SIZE,
    },
    new AbortController().signal,
  );

  assertEquals(writes[1], "\n");
  assertEquals(
    writes.some((value) => value.includes("\x1b[?")),
    false,
  );
});

Deno.test("terminal playback planning rejects invalid scenes before effects", () => {
  assertThrows(
    () =>
      planTerminalPlayback([], {
        terminalColumns: 80,
        terminalRows: 24,
        finalTranscript: "static",
      }),
    TypeError,
    "at least one scene",
  );
  assertThrows(
    () =>
      planTerminalPlayback([{
        label: "[bad]",
        frames: ["ok\x1b[2J"],
        frameMs: 10,
        finalHoldMs: 0,
      }], {
        terminalColumns: 80,
        terminalRows: 24,
        finalTranscript: "static",
      }),
    TypeError,
    "terminal control",
  );
  assertThrows(
    () =>
      planTerminalPlayback([{
        label: "[bad]",
        frames: ["ok"],
        frameMs: Number.NaN,
        finalHoldMs: 0,
      }], {
        terminalColumns: 80,
        terminalRows: 24,
        finalTranscript: "static",
      }),
    TypeError,
    "frameMs",
  );
});

Deno.test("terminal playback applies the complete plan and settles on static output", async () => {
  const writes: string[] = [];
  const waits: number[] = [];
  await applyTerminalPlayback(
    fixturePlan(),
    {
      write: (value) => writes.push(value),
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      terminalSize: STABLE_TERMINAL_SIZE,
    },
    new AbortController().signal,
  );

  assertEquals(waits, [10, 20, 30]);
  assertEquals(writes, [
    "\n",
    "[one]\nA",
    "\x1b[1G\x1b[1A\x1b[J[one]\nB",
    "\x1b[1G\x1b[1A\x1b[J[two]\n界\né",
    "\x1b[1G\x1b[2A\x1b[J[two]\nC",
    "\x1b[1G\x1b[1A\x1b[J",
    "static\n",
  ]);
});

Deno.test("terminal playback settles immediately when the package refuses control", async () => {
  const writes: string[] = [];
  const waits: number[] = [];
  await applyTerminalPlayback(
    fixturePlan(),
    {
      write: (value) => writes.push(value),
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      terminalSize: STABLE_TERMINAL_SIZE,
      terminalCapabilities: () => ({
        ansiControl: false,
        colorDepth: "none",
        columns: 80,
        unicode: true,
      }),
    },
    new AbortController().signal,
  );

  assertEquals(writes, ["\n", "static\n"]);
  assertEquals(waits, []);
});

Deno.test("terminal playback abort clears the partial viewport without persistent cursor state", async () => {
  const writes: string[] = [];
  const controller = new AbortController();
  await assertRejects(
    () =>
      applyTerminalPlayback(
        fixturePlan(),
        {
          write: (value) => writes.push(value),
          wait: () => {
            controller.abort();
            return Promise.reject(
              new DOMException("interrupted", "AbortError"),
            );
          },
          terminalSize: STABLE_TERMINAL_SIZE,
        },
        controller.signal,
      ),
    DOMException,
    "interrupted",
  );
  assertEquals(writes, [
    "\n",
    "[one]\nA",
    "\x1b[1G\x1b[1A\x1b[J",
  ]);
});

Deno.test("a pre-aborted playback performs no terminal effects", async () => {
  const writes: string[] = [];
  const controller = new AbortController();
  controller.abort();
  await assertRejects(
    () =>
      applyTerminalPlayback(
        fixturePlan(),
        {
          write: (value) => writes.push(value),
          wait: () => Promise.resolve(),
          terminalSize: STABLE_TERMINAL_SIZE,
        },
        controller.signal,
      ),
    DOMException,
  );
  assertEquals(writes, []);
});

Deno.test("a first-frame write failure never leaves persistent cursor state", async () => {
  const writes: string[] = [];
  await assertRejects(
    () =>
      applyTerminalPlayback(
        fixturePlan(),
        {
          write: (value) => {
            writes.push(value);
            if (value === "[one]\nA") {
              throw new Error("closed stream");
            }
          },
          wait: () => Promise.resolve(),
          terminalSize: STABLE_TERMINAL_SIZE,
        },
        new AbortController().signal,
      ),
    Error,
    "closed stream",
  );
  assertEquals(writes, ["\n", "[one]\nA"]);
});

Deno.test("a redraw failure never moves above the cleared animation viewport", async () => {
  const writes: string[] = [];
  await assertRejects(
    () =>
      applyTerminalPlayback(
        fixturePlan(),
        {
          write: (value) => {
            writes.push(value);
            if (value.endsWith("[one]\nB")) {
              throw new Error("redraw failed");
            }
          },
          wait: () => Promise.resolve(),
          terminalSize: STABLE_TERMINAL_SIZE,
        },
        new AbortController().signal,
      ),
    Error,
    "redraw failed",
  );
  assertEquals(writes, [
    "\n",
    "[one]\nA",
    "\x1b[1G\x1b[1A\x1b[J[one]\nB",
  ]);
});

Deno.test("a partial clear failure is never retried above the reserved viewport", async () => {
  const writes: string[] = [];
  const clear = "\x1b[1G\x1b[1A\x1b[J";
  await assertRejects(
    () =>
      applyTerminalPlayback(
        fixturePlan(),
        {
          write: (value) => {
            writes.push(value);
            if (value === clear) {
              throw new Error("partial clear");
            }
          },
          wait: () => Promise.resolve(),
          terminalSize: STABLE_TERMINAL_SIZE,
        },
        new AbortController().signal,
      ),
    Error,
    "partial clear",
  );
  assertEquals(writes.filter((value) => value === clear).length, 1);
});

Deno.test("a terminal resize settles below the live viewport without cursor-up", async () => {
  const writes: string[] = [];
  let measurements = 0;
  const port = {
    write: (value: string): void => {
      writes.push(value);
    },
    wait: (): Promise<void> => Promise.resolve(),
    terminalSize: (): { columns: number; rows: number } => {
      measurements += 1;
      return measurements === 1
        ? { columns: 80, rows: 24 }
        : { columns: 5, rows: 24 };
    },
  };
  await applyTerminalPlayback(
    fixturePlan(),
    port,
    new AbortController().signal,
  );

  assertEquals(writes.filter((value) => value.includes("\x1b[")).length, 0);
  assertEquals(writes.slice(-2), ["\n", "static\n"]);
});

Deno.test("terminal animation waits settle or cancel without leaving scheduled work", async () => {
  const scheduler = new ManualScheduler();
  const controller = new AbortController();
  const wait = abortableWait(25, controller.signal, scheduler);
  assertEquals(scheduler.pending.size, 1);
  scheduler.fire(25);
  await wait;
  controller.abort();
  assertEquals(scheduler.pending.size, 0);

  const interrupted = new AbortController();
  const pending = abortableWait(50, interrupted.signal, scheduler);
  const rejected = assertRejects(() => pending, DOMException, "interrupted");
  interrupted.abort();
  await rejected;
  assertEquals(scheduler.pending.size, 0);
  await assertRejects(
    () => abortableWait(50, interrupted.signal, scheduler),
    DOMException,
    "interrupted",
  );
  assertEquals(scheduler.pending.size, 0);

  const writes: string[] = [];
  const port = terminalPlaybackPort((value) => writes.push(value), scheduler);
  port.write("frame");
  const portWait = port.wait(10, new AbortController().signal);
  scheduler.fire(10);
  await portWait;
  assertEquals(writes, ["frame"]);
  assert(port.terminalSize().columns > 0);
  assert(port.terminalCapabilities?.() !== undefined);
});

Deno.test("terminal animation owns signal listeners through success and output failure", async () => {
  const writes: string[] = [];
  await runTerminalPlayback(fixturePlan(), {
    write: (value) => writes.push(value),
    wait: () => Promise.resolve(),
    terminalSize: STABLE_TERMINAL_SIZE,
  });
  assert(writes.join("").includes("static"));
  const failure = new Error("output unavailable");
  const caught = await assertRejects(
    () =>
      runTerminalPlayback(fixturePlan(), {
        write: () => {
          throw failure;
        },
        wait: () => Promise.resolve(),
        terminalSize: STABLE_TERMINAL_SIZE,
      }),
    Error,
    "output unavailable",
  );
  assertEquals(caught, failure);
});
