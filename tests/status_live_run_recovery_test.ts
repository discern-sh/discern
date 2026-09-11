/**
 * A checkout's own live run is never presented as a return needing recovery.
 * Between its queue claim and its environment enrollment, and again between
 * return and admission, the environment record reads idle while the queue
 * entry is active; status must lead with the run, not with a phantom
 * recovery. A real recovery phase still leads while a run is live.
 */
import { assert, assertEquals } from "@std/assert";
import {
  completionStatusPresentation,
  liveRecoveryRows,
} from "../src/engine/status/completion_recovery.ts";

const running = {
  verb: "done",
  branch: "refs/heads/agent/mine",
  handle: "R1-live",
  latest: "Running the test stage.",
};
const reservation = {
  environment_id: "env-1",
  phase: "reservation",
  reason: "The checkout is idle but its queue reservation remains recorded.",
  retained_paths: ["/checkout"],
  next_action: "discern recover env-1",
};
const capture = { ...reservation, attempt_id: "a1", phase: "capture" };

Deno.test("a reservation row yields to the checkout's own running operation", () => {
  assertEquals(liveRecoveryRows([reservation], running), []);
  assertEquals(liveRecoveryRows([reservation], undefined), [reservation]);
  assertEquals(liveRecoveryRows([capture], running), [capture]);
  assertEquals(liveRecoveryRows(undefined, running), []);
});

Deno.test("status leads with the running operation, not a phantom recovery", () => {
  const recovery = liveRecoveryRows([reservation], running);
  const presented = completionStatusPresentation(
    {
      data: recovery.length ? { execution_recovery: recovery } : {},
      hints: [],
    },
    [],
    undefined,
    running,
  );
  assert(
    presented.message?.startsWith(
      "`done` on agent/mine is still running: Running the test stage.",
    ),
    presented.message,
  );
  assert(!presented.hints.some((hint) => hint.id === "execution-recovery"));
  const real = completionStatusPresentation(
    { data: { execution_recovery: [capture] }, hints: [] },
    [],
    undefined,
    running,
  );
  assert(
    real.message?.startsWith("Checkout return requires recovery"),
    real.message,
  );
});
