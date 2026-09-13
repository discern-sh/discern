/**
 * A checkout's own live run leads status: a resumed session is told to read
 * the run back, never to start another command, and routine next-step hints
 * stand down while it runs. Outstanding emergency validation still surfaces.
 */
import { assert, assertEquals } from "@std/assert";
import { completionStatusPresentation } from "../src/engine/status/completion_recovery.ts";
import { fire, HINTS } from "../src/shared/hints.ts";

const running = {
  verb: "done",
  branch: "refs/heads/agent/mine",
  handle: "R1-live",
  latest: "`done` on agent/mine is running test.",
};

Deno.test("status leads with the running operation and reconnects through its handle", () => {
  const presented = completionStatusPresentation(
    { data: {}, hints: [] },
    [],
    running,
  );
  const message = presented.message;
  assert(message !== undefined);
  assert(
    message.startsWith(
      running.latest,
    ),
    message,
  );
  assert(message.includes("discern progress R1-live"), message);
  const unobserved = completionStatusPresentation({ data: {}, hints: [] }, [], {
    verb: running.verb,
    branch: running.branch,
    handle: running.handle,
  });
  assert(unobserved.message?.includes("no current activity was recorded"));
  assertEquals(
    completionStatusPresentation({ data: {}, hints: [] }, [], undefined)
      .message,
    undefined,
  );
});

Deno.test("next-step hints stand down while a run is live; emergency hints always surface", () => {
  const nextStep = fire(HINTS["missing-trunk-branch"], { branch: "main" });
  const emergency = {
    data: {},
    hints: [
      fire(HINTS["emergency-outstanding"], { commit: "0123abcd4567" }),
    ],
  };
  const live = completionStatusPresentation(emergency, [nextStep], running);
  assert(!live.hints.some((hint) => hint.id === "missing-trunk-branch"));
  assert(live.hints.some((hint) => hint.id === "emergency-outstanding"));
  const idle = completionStatusPresentation(emergency, [nextStep], undefined);
  assert(idle.hints.some((hint) => hint.id === "missing-trunk-branch"));
  assert(idle.hints.some((hint) => hint.id === "emergency-outstanding"));
  assertEquals(idle.message, undefined);
});
