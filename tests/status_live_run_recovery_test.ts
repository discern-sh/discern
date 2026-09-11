/**
 * A checkout's own live run is never presented as a return needing recovery
 * or as an environment whose activity cannot be verified.
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

const activity = {
  environment_id: "env-1",
  attempt_id: "a1",
  candidate_id: "c1",
  phase: "install",
  lease_expires_at: 1,
  reason:
    "A native operation holds the checkout; its recorded claim does not identify the lock owner.",
};

Deno.test("an environment's activity reading yields to the checkout's own running operation", () => {
  const presented = completionStatusPresentation(
    { data: { execution_activity: [activity] }, hints: [] },
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
  assert(!presented.hints.some((hint) => hint.id === "completion-pending"));
  const unowned = completionStatusPresentation(
    { data: { execution_activity: [activity] }, hints: [] },
    [],
    undefined,
    undefined,
  );
  assert(
    unowned.message?.startsWith(
      "Environment env-1 records attempt a1 in phase install.",
    ),
    unowned.message,
  );
  assert(unowned.hints.some((hint) => hint.id === "completion-pending"));
});
