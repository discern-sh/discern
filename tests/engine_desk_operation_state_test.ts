/**
 * The Desk's product state machine around operations that run beside the
 * screen, driven without a terminal: confirming a change opens its progress
 * and shows its row running, one task runs one operation at a time, its
 * end leaves a message or a result, Stop and Quit ask what they should,
 * and the exit log names every command with how it ended.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type DeskEvent,
  deskProduct,
  type DeskProductState,
  layerId,
} from "../src/engine/desk/desk_state.ts";
import { open } from "../src/engine/desk/desk_transitions.ts";
import type {
  DeskFlowStep,
  DeskOutcome,
  DeskReview,
} from "../src/engine/desk/flow_types.ts";
import { deskEpilogue } from "../src/engine/desk/live.ts";
import { deskView } from "../src/engine/desk/inbox_view.ts";
import { progressAfter } from "../src/engine/desk/operations.ts";
import { BUILT_IN_STEP_LABELS, type EnginePlan } from "../src/shared/result.ts";
import {
  deskIntent,
  editingTask,
  observedDesk,
  PRODUCT_CLOCK,
  PRODUCT_NOW,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
  readyReview,
} from "./fixtures/desk_product.ts";

const PLAN: EnginePlan = {
  title: "Acceptance plan",
  details: [],
  steps: [
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
      disposition: "run",
    },
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.deleteBranch,
      disposition: "run",
    },
  ],
};

/** A step that reviews `action` on the task `alpha`. */
function actionStep(action: "accept" | "done" | "scripts"): DeskFlowStep {
  return { kind: "action", action, taskId: "alpha", stage: "review" };
}

/** A ready review of `step` whose confirm runs it. */
function reviewed(
  state: DeskProductState,
  step: DeskFlowStep,
  patch: Partial<DeskReview> = {},
): DeskProductState {
  return open(state, {
    kind: "review",
    step,
    load: {
      state: "ready",
      value: readyReview("Land Alpha?", {
        confirm: { kind: "apply", running: "Landing Alpha" },
        disclosures: {
          command: "discern accept --target agent/alpha --confirmed",
          plan: PLAN,
        },
        follows: [{ branch: "agent/beta", title: "Beta" }],
        ...patch,
      }),
    },
  }).state;
}

/** The layer ids that exist, bottom to top. */
function layers(state: DeskProductState): string[] {
  return state.layers.map((layer) => layerId(layer));
}

/** Confirm the open review of `step`. */
function confirmed(
  state: DeskProductState,
  step: DeskFlowStep,
): ReturnType<typeof deskIntent> {
  const id = `review-${
    step.kind === "action" ? step.action : step.command
  }-review`;
  return deskIntent(state, { kind: "confirm", layer: id });
}

/** A Desk with one task and a Land review open on it. */
function landing(): DeskProductState {
  return reviewed(
    observedDesk(productSurvey([editingTask("alpha")])),
    actionStep("accept"),
  );
}

/** The one operation running, which a test expects there to be. */
function onlyOperation(state: DeskProductState): string {
  const [id] = [...state.operations.keys()];
  assert(id !== undefined, "an operation runs");
  return id;
}

/** The operation ends with `outcome`. */
function settle(
  state: DeskProductState,
  outcome: DeskOutcome,
  ended: "ran" | "stopped" = "ran",
  output = "",
): ReturnType<typeof deskProduct> {
  const event: DeskEvent = {
    kind: "operation-settled",
    operationId: onlyOperation(state),
    ended,
    outcome,
    output,
    now: PRODUCT_NOW + 60_000,
  };
  return deskProduct(state, event);
}

Deno.test("confirming a change runs it beside the screen and shows its row running", () => {
  const started = confirmed(landing(), actionStep("accept"));
  const id = onlyOperation(started.state);
  assertEquals(layers(started.state), ["progress"]);
  assertEquals(started.effects, [{ kind: "operate", operationId: id }]);
  const operation = started.state.operations.get(id);
  assertEquals(operation?.title, "Landing Alpha");
  assertEquals(operation?.verb, "accept");
  assertEquals(operation?.taskId, "alpha");
  assertEquals(operation?.progress.startedAt, PRODUCT_CLOCK);
  assertEquals(operation?.progress.followers.map((task) => task.title), [
    "Beta",
  ]);
  const row = started.state.rows.find((candidate) =>
    candidate.entry.id === "alpha"
  );
  assertEquals(row?.entry.running?.verb, "accept");
  assertEquals(row?.decision.state, "landing", "the row says it is landing");

  const hidden = deskProduct(started.state, {
    kind: "dismissed",
    target: { layer: "progress" },
  });
  assertEquals(layers(hidden.state), [], "Escape hides the progress");
  assert(hidden.state.operations.has(id), "and the operation runs on");
  const view = deskView(hidden.state, { ...PRODUCT_UI, selected: "alpha" }, {
    ...PRODUCT_VIEW_ENV,
    root: "/project",
  });
  assertEquals(view.footer.left[0], { key: "enter", label: "Show progress" });
  const reopened = deskIntent(
    hidden.state,
    { kind: "next", id: "alpha" },
    { ...PRODUCT_UI, selected: "alpha" },
  );
  assertEquals(layers(reopened.state), ["progress"], "Enter shows it again");
});

Deno.test("a task runs one operation at a time; launches still take the terminal", () => {
  const started = confirmed(landing(), actionStep("accept"));
  const again = confirmed(
    reviewed(started.state, actionStep("done")),
    actionStep("done"),
  );
  assertEquals(again.state.operations.size, 1);
  assertEquals(again.effects, []);
  assertStringIncludes(again.state.message?.text ?? "", "still running");

  const script = confirmed(
    reviewed(
      observedDesk(productSurvey([editingTask("alpha")])),
      actionStep("scripts"),
    ),
    actionStep("scripts"),
  );
  assertEquals(script.state.operations.size, 0);
  assertEquals(script.effects.map((effect) => effect.kind), ["apply"]);
});

Deno.test("an operation's progress and output follow its reports", () => {
  const started = confirmed(landing(), actionStep("accept")).state;
  const id = onlyOperation(started);
  const operation = started.operations.get(id);
  assert(operation !== undefined);
  const moving = progressAfter(operation.progress, {
    kind: "step",
    step: {
      label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
      state: "started",
      at: 0,
    },
  }, PRODUCT_CLOCK + 5);
  const reported = deskProduct(started, {
    kind: "operation-progress",
    operationId: id,
    progress: moving,
    output: "Fast-forwarding main…\n",
  });
  const after = reported.state.operations.get(id);
  assertEquals(after?.progress.steps[0]?.state, "active");
  assertEquals(after?.output, "Fast-forwarding main…\n");
  assertEquals(
    deskProduct(reported.state, {
      kind: "operation-progress",
      operationId: "gone",
      progress: moving,
      output: "",
    }).state,
    reported.state,
    "a report for an operation that ended changes nothing",
  );
  const reading = deskIntent(reported.state, { kind: "output" });
  assertEquals(layers(reading.state), ["progress", "reader-output"]);
});

Deno.test("a success closes the progress with its message and records the run", () => {
  const started = confirmed(landing(), actionStep("accept")).state;
  const done = settle(started, {
    command: "discern accept --target agent/alpha --confirmed",
    ok: true,
    message: {
      tone: "success",
      text: "Landed Alpha on main · Beta landed too",
    },
  });
  assertEquals(done.state.operations.size, 0);
  assertEquals(layers(done.state), []);
  assertEquals(
    done.state.message?.text,
    "Landed Alpha on main · Beta landed too",
  );
  assertEquals(done.state.activity.at(-1)?.ended, "done");
  assert(
    done.effects.some((effect) => effect.kind === "survey"),
    "one survey reconciles the rows",
  );
  assertEquals(
    done.state.rows.find((row) => row.entry.id === "alpha")?.entry.running,
    undefined,
    "the row stops showing the run",
  );
});

Deno.test("a row its own operation moves keeps the operation's message", () => {
  const started = confirmed(landing(), actionStep("accept")).state;
  const regrouped = deskProduct(started, {
    kind: "selection-moved",
    itemId: "alpha",
    move: { kind: "regrouped", from: "attention", to: "working" },
  });
  assertEquals(
    regrouped.state.message,
    started.message,
    "starting says nothing",
  );
  const done = settle(started, {
    command: "discern accept --target agent/alpha --confirmed",
    ok: true,
    message: { tone: "success", text: "Landed Alpha on main" },
  }).state;
  const left = deskProduct(done, {
    kind: "selection-moved",
    itemId: "alpha",
    move: { kind: "removed" },
  });
  assertEquals(left.state.message?.text, "Landed Alpha on main");
});

Deno.test("a failure becomes a result sheet while its progress shows, and a message while hidden", () => {
  const failure: DeskOutcome = {
    command: "discern accept --target agent/alpha --confirmed",
    ok: false,
    message: { tone: "danger", text: "Alpha didn't land" },
    result: {
      title: "Alpha didn't land",
      lines: [{
        mark: "failure",
        text: "Combining it with main stopped: 2 files conflict",
        source: { kind: "result", field: "message" },
      }],
      command: "discern accept --target agent/alpha --confirmed",
      output: "**accept** stopped",
      taskId: "alpha",
    },
  };
  const started = confirmed(landing(), actionStep("accept")).state;
  const shown = settle(started, failure, "ran", "merging…\nconflict in a.ts\n");
  assertEquals(layers(shown.state), ["result"]);
  const sheet = shown.state.layers[0];
  assert(sheet?.kind === "result");
  assertStringIncludes(sheet.sheet.output ?? "", "a.ts");
  assertStringIncludes(sheet.sheet.output ?? "", "**accept**");
  assertEquals(shown.state.activity.at(-1)?.ended, "failed");
  assertStringIncludes(shown.state.activity.at(-1)?.output ?? "", "conflict");

  const hidden = deskProduct(
    open(started, { kind: "palette" }).state,
    { kind: "dismissed", target: { layer: "progress" } },
  ).state;
  const away = settle(hidden, failure);
  assertEquals(layers(away.state), ["palette"], "nothing opens over the owner");
  assertEquals(away.state.message?.text, "Alpha didn't land");
});

Deno.test("Stop is offered only where stopping is clean, and stops through the signal", () => {
  const started = confirmed(landing(), actionStep("accept")).state;
  const id = onlyOperation(started);
  const stopped = deskIntent(started, { kind: "stop" });
  assertEquals(stopped.effects, [{ kind: "abort", operationId: id }]);
  assertEquals(stopped.state.operations.get(id)?.stopping, true);
  assertEquals(
    deskIntent(stopped.state, { kind: "stop" }).effects,
    [],
    "asking twice stops once",
  );
  const operation = started.operations.get(id);
  assert(operation !== undefined);
  const moved = deskProduct(started, {
    kind: "operation-progress",
    operationId: id,
    progress: progressAfter(operation.progress, {
      kind: "step",
      step: {
        label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
        state: "started",
        at: 0,
      },
    }, PRODUCT_CLOCK + 1),
    output: "",
  }).state;
  assertEquals(
    deskIntent(moved, { kind: "stop" }).effects,
    [],
    "a landing that moved the trunk cannot stop",
  );
  const ended = settle(
    stopped.state,
    { command: operation.command, ok: false },
    "stopped",
  );
  assertStringIncludes(
    ended.state.message?.text ?? "",
    "Stopped: Landing Alpha",
  );
  assertEquals(ended.state.activity.at(-1)?.ended, "stopped");
});

Deno.test("quitting while an operation runs asks first; Quit anyway leaves", () => {
  const idle = observedDesk(productSurvey([editingTask("alpha")]));
  assertEquals(
    deskIntent(idle, { kind: "command", command: "quit" }).effects,
    [{ kind: "exit" }],
  );
  const started = confirmed(landing(), actionStep("accept")).state;
  const asked = deskIntent(started, { kind: "command", command: "quit" });
  assertEquals(asked.effects, []);
  assertEquals(layers(asked.state).at(-1), "quit");
  const kept = deskProduct(asked.state, {
    kind: "dismissed",
    target: { layer: "quit" },
  });
  assertEquals(kept.state.operations.size, 1, "Keep waiting keeps it");
  const left = deskIntent(asked.state, { kind: "quit-anyway" });
  assertEquals(left.effects, [{ kind: "exit" }]);
  assertEquals(
    deskEpilogue(left.state).map((line) =>
      typeof line === "string" ? line : line.map((run) => run.text).join("")
    ),
    ["discern desk ran: discern accept --target agent/alpha --confirmed · stopped"],
    "what still ran when the Desk left stops, and says so",
  );
});

Deno.test("the exit log names each command in full with how it ended", () => {
  const started = confirmed(landing(), actionStep("accept")).state;
  const done = settle(started, {
    command: "discern accept --target agent/alpha --confirmed",
    ok: true,
  }).state;
  const lines = deskEpilogue(done);
  assertEquals(lines.length, 1);
  const [line] = lines;
  assert(line !== undefined && typeof line !== "string");
  assertEquals(line.map((run) => run.text), [
    "discern desk ran: ",
    "discern accept --target agent/alpha --confirmed",
    " · done",
  ]);
  assertEquals(line[1]?.role, "code", "the command stays one line to copy");
});
