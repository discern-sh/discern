/**
 * A live Desk runs every confirmed change beside its screen: the progress
 * sheet works through the plan the review showed as the effect reports its
 * steps, Escape hides it while the row keeps running, the effect's output
 * is captured for its reader, a failure becomes its result sheet, Stop and
 * Quit stop it through its signal, a launch can take the terminal while it
 * runs, and the Desk's own termination stops it before the process ends.
 */

import { assert, assertEquals } from "@std/assert";
import { deskEffectSignal } from "../src/engine/desk/execution.ts";
import { writeStderr, writeStdout } from "../src/engine/output.ts";
import { recordSteps, stepStarted } from "../src/engine/plan_steps.ts";
import {
  BUILT_IN_STEP_LABELS,
  type EnginePlan,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import type { GateData } from "../src/shared/result_schemas.ts";
import type { DeskRuntime } from "../src/engine/desk/desk.ts";
import {
  deskSession,
  deskSurvey,
  deskTaskEntry,
  landable,
  LANDABLE_HEAD,
  landing,
  scriptedTermination,
  withDeskSession,
} from "./fixtures/desk_session.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { assertTerminalTextIncludes } from "./helpers.ts";

const LAND = "review-accept-review";
const CHECK = "review-done-review";

/** The landing plan the review shows and the progress works through. */
const PLAN: EnginePlan = {
  title: "Acceptance plan",
  details: ["Branch: agent/alpha"],
  steps: [
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
      disposition: "run",
    },
    {
      kind: "repository-ensure",
      label: verbatimStepLabel("deno install --frozen"),
      disposition: "run",
    },
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.deleteBranch,
      disposition: "run",
    },
  ],
};

/** A promise the test resolves when the effect may go on. */
function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open = (): void => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** Resolve once `signal` aborts. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
  assert(signal !== undefined, "an in-session effect has its signal");
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** A task whose final checks can run: committed, current, unproven. */
function checkable(): ReturnType<typeof deskTaskEntry> {
  return deskTaskEntry("agent/beta", "/worktrees/beta", {
    id: "beta",
    ahead: 2,
    behind: 0,
    clean: true,
    registration: { head: LANDABLE_HEAD, locked: false, prunable: false },
  });
}

/** A check that runs until its signal stops it. */
function stoppableCheck(stopped: string[]): Partial<DeskRuntime> {
  return {
    donePlan: () => ({
      ok: true,
      verb: "done",
      dry_run: true,
      plan: { title: "Gate plan", details: [], steps: [] },
    }),
    done: async (): Promise<DiscernResult<GateData>> => {
      await aborted(deskEffectSignal());
      stopped.push("done");
      return { ok: false, verb: "done", error: "gate_failed" };
    },
  };
}

Deno.test("a landing runs beside the screen, working through its plan, and lands", async () => {
  const landed: unknown[] = [];
  const move = gate();
  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([landable()]) }),
      ...landing(landed, {}, PLAN),
      accept: async (_ctx, options) => {
        writeStdout("Fast-forwarding main to agent/alpha\n");
        stepStarted(BUILT_IN_STEP_LABELS.fastForwardTrunk);
        await move.wait;
        recordSteps([], {
          step: {
            kind: "git",
            label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
            disposition: "run",
          },
          outcome: "ok",
        });
        landed.push(options);
      },
    },
  }, async (desk) => {
    // Every byte the process writes to its own streams, to prove the
    // landing's narration reached its capture and never the terminal.
    const leaked: string[] = [];
    const out = Deno.stdout.writeSync;
    Deno.stdout.writeSync = (bytes) => {
      leaked.push(new TextDecoder().decode(bytes));
      return out.call(Deno.stdout, bytes);
    };
    // A failed assertion still lets the landing end, so the session can.
    try {
      await landsInSession(desk, move.open);
    } finally {
      Deno.stdout.writeSync = out;
      move.open();
    }
    assertEquals(landed.length, 1);
    assert(
      leaked.every((text) => !text.includes("Fast-forwarding main")),
      "the landing's narration never reached the process streams",
    );
  });
});

/** Drive one landing from its review to its message. */
async function landsInSession(
  desk: Awaited<ReturnType<typeof deskSession>>,
  release: () => void,
): Promise<void> {
  await desk.select("alpha");
  await desk.press("l");
  await desk.opened(LAND);
  await desk.confirm();
  await desk.opened("progress");
  await desk.shows("Landing Alpha");
  await desk.shows("Move main to this branch");
  await desk.shows("deno install --frozen");
  await desk.press("o");
  await desk.opened("reader-output");
  await desk.shows("Fast-forwarding main to agent/alpha");
  await desk.escape(() => desk.top() === "progress", "the reader to close");
  await desk.escape(() => desk.top() === undefined, "Escape to hide it");
  await desk.shows("Landing");
  await desk.shows("Show progress");
  await desk.press("enter");
  await desk.opened("progress");
  release();
  await desk.operated();
  await desk.shows("Landed Alpha on main");
}

Deno.test("a failed landing turns its progress into a result sheet with its output", async () => {
  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([landable()]) }),
      ...landing([], {}, PLAN),
      accept: () => {
        writeStderr("CONFLICT (content): Merge conflict in a.ts\n");
        return {
          ok: false,
          verb: "accept",
          error: "precondition_failed",
          message: "Combining it with main stopped: 2 files conflict",
        };
      },
    },
  }, async (desk) => {
    await desk.select("alpha");
    await desk.press("l");
    await desk.opened(LAND);
    await desk.confirm();
    await desk.opened("result");
    await desk.shows("Alpha didn't land");
    await desk.shows("Combining it with main stopped: 2 files conflict");
    await desk.press("o");
    await desk.shows("Merge conflict in a.ts");
  });
});

Deno.test("Stop ends a check through its signal and says where it stopped", async () => {
  const stopped: string[] = [];
  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([checkable()]) }),
      ...stoppableCheck(stopped),
    },
  }, async (desk) => {
    await desk.select("beta");
    await desk.press("c");
    await desk.opened(CHECK);
    await desk.confirm();
    await desk.opened("progress");
    await desk.shows("Running checks on Beta");
    await desk.confirm("stop");
    await desk.operated();
    await desk.shows("Stopped: Running checks on Beta");
    assertEquals(stopped, ["done"]);
  });
});

Deno.test("quitting while a check runs asks first, and Quit anyway stops it", async () => {
  const stopped: string[] = [];
  const desk = await deskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([checkable()]) }),
      ...stoppableCheck(stopped),
    },
  });
  await desk.select("beta");
  await desk.press("c");
  await desk.opened(CHECK);
  await desk.confirm();
  await desk.opened("progress");
  await desk.press("ctrl-c");
  await desk.opened("quit");
  await desk.shows("Quit while this runs?");
  await desk.shows("Running checks on Beta");
  assertEquals(desk.state().layers.quit?.focusedControlId, "button:safe");
  await desk.press("right");
  assertEquals(desk.state().layers.quit?.focusedControlId, "button:quit");
  // Quit anyway ends the session, so nothing waits for the Desk to read it.
  desk.io.enqueueKeys("enter");
  assertEquals(await desk.exit, 0);
  assertEquals(stopped, ["done"], "the check stopped through its signal");
  assertTerminalTextIncludes(
    desk.io.output(),
    "discern desk ran: discern done · stopped",
  );
});

Deno.test("a launch takes the terminal while a landing runs beside it", async () => {
  const landed: unknown[] = [];
  const move = gate();
  const ran: string[] = [];
  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([landable()]) }),
      ...landing(landed, {}, PLAN),
      accept: async (_ctx, options) => {
        await move.wait;
        landed.push(options);
      },
      interactive: (command) => {
        ran.push(command);
        return 0;
      },
    },
  }, async (desk) => {
    await desk.select("alpha");
    await desk.press("l");
    await desk.opened(LAND);
    await desk.confirm();
    await desk.opened("progress");
    try {
      await desk.escape(() => desk.top() === undefined, "Escape to hide it");
      await desk.press("s");
      await desk.until(() => ran.length === 1, "the shell to run and return");
      assertEquals(
        landed,
        [],
        "the landing runs on while the shell has the terminal",
      );
    } finally {
      move.open();
    }
    await desk.shows("Landed Alpha on main");
  });
});

Deno.test("the Desk's own termination stops what runs and ends with its signal", async () => {
  const stopped: string[] = [];
  const termination = scriptedTermination();
  const raised: Deno.Signal[] = [];
  const desk = await deskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([checkable()]) }),
      ...stoppableCheck(stopped),
      terminations: () => termination,
      raise: (signal) => {
        raised.push(signal);
      },
    },
  });
  await desk.select("beta");
  await desk.press("c");
  await desk.opened(CHECK);
  await desk.confirm();
  await desk.opened("progress");
  termination.end("SIGTERM");
  assertEquals(await desk.exit, 0);
  desk.io.close();
  assertEquals(stopped, ["done"], "the running check stopped first");
  assertEquals(raised, ["SIGTERM"], "then the Desk ends with its signal");
});
