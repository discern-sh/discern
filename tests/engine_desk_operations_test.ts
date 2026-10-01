/**
 * The Desk's in-session operations, driven without a terminal: which
 * confirmed steps run beside the screen, when each can stop, and how the
 * completion facts an operation reports work through the plan its review
 * showed.
 */

import { assert, assertEquals } from "@std/assert";
import { DESK_ACTIONS, DESK_COMMANDS } from "../src/shared/desk_vocabulary.ts";
import { DESK_ACTION_REGISTRY } from "../src/engine/desk/model.ts";
import { DESK_COMMAND_REGISTRY } from "../src/engine/desk/commands.ts";
import {
  canStop,
  commandVerb,
  DESK_STOP_POLICIES,
  type DeskOperationProgress,
  operationProgress,
  progressActivity,
  progressAfter,
  runsInSession,
} from "../src/engine/desk/operations.ts";
import type { DeskFlowStep } from "../src/engine/desk/flow_types.ts";
import type { CompletionObservationFact } from "../src/engine/completion/events.ts";
import {
  BUILT_IN_STEP_LABELS,
  type EnginePlan,
  type PlanStepState,
  verbatimStepLabel,
} from "../src/shared/result.ts";

/** Every control's step, for the classification guards. */
const STEPS: readonly DeskFlowStep[] = [
  ...DESK_ACTIONS.map((action): DeskFlowStep => ({
    kind: "action",
    action,
    taskId: "task",
    stage: "review",
  })),
  ...DESK_COMMANDS.map((command): DeskFlowStep => ({
    kind: "command",
    command,
    stage: "review",
  })),
];

/** The registry effect of a step's control. */
function effectOf(step: DeskFlowStep): string {
  return step.kind === "action"
    ? DESK_ACTION_REGISTRY[step.action].effect
    : DESK_COMMAND_REGISTRY[step.command].effect;
}

/** A step's control name. */
function controlOf(step: DeskFlowStep): string {
  return step.kind === "action" ? step.action : step.command;
}

/** A landing's plan: a gate, the move, a project command and the cleanup. */
const LANDING: EnginePlan = {
  title: "Acceptance plan",
  details: [],
  steps: [
    {
      kind: "tracked-refresh-check",
      label: BUILT_IN_STEP_LABELS.trackedRefreshLandingBoundary,
      disposition: "gate",
    },
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
      kind: "resource-destroy",
      label: BUILT_IN_STEP_LABELS.teardownResources,
      disposition: "skip",
    },
    {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.deleteBranch,
      disposition: "run",
    },
  ],
};

/** One step fact. */
function step(
  label: string,
  state: PlanStepState,
  subject?: string,
): CompletionObservationFact {
  return {
    kind: "step",
    step: {
      label,
      state,
      at: 0,
      ...(subject === undefined ? {} : { subject }),
    },
  };
}

/** Fold facts in order, each at its own time on the application clock. */
function fold(
  progress: DeskOperationProgress,
  ...facts: readonly [CompletionObservationFact, number][]
): DeskOperationProgress {
  return facts.reduce(
    (current, [fact, at]) => progressAfter(current, fact, at),
    progress,
  );
}

Deno.test("Desk operations: every control that changes state runs beside the screen", () => {
  for (const candidate of STEPS) {
    assertEquals(
      runsInSession(candidate, undefined),
      effectOf(candidate) === "change",
      `${controlOf(candidate)} runs in session exactly when it changes state`,
    );
    assertEquals(
      runsInSession(candidate, "claude"),
      false,
      `${controlOf(candidate)} that opens an agent takes the terminal`,
    );
  }
});

Deno.test("Desk operations: every in-session control declares when it can stop", () => {
  const changing = STEPS.filter((candidate) =>
    runsInSession(candidate, undefined)
  )
    .map(controlOf).sort();
  assertEquals(Object.keys(DESK_STOP_POLICIES).sort(), changing);
});

Deno.test("Desk operations: a plan's steps read in human words, and skips start skipped", () => {
  const progress = operationProgress(LANDING, "develop", 100, [
    { branch: "agent/search", title: "Search index" },
  ]);
  assertEquals(progress.steps.map((entry) => [entry.words, entry.state]), [
    ["Check generated files before landing", "pending"],
    ["Move develop to this branch", "pending"],
    ["deno install --frozen", "pending"],
    ["Release its ports and services", "skipped"],
    ["Delete the branch", "pending"],
  ]);
  assertEquals(progress.followers, [{
    branch: "agent/search",
    title: "Search index",
    state: "queued",
  }]);
  assertEquals(operationProgress(undefined, "main", 0).steps, []);
});

Deno.test("Desk operations: reported facts work through the plan in order", () => {
  const start = operationProgress(LANDING, "main", 100, [
    { branch: "agent/search", title: "Search index" },
  ]);
  const moving = fold(start, [
    step(BUILT_IN_STEP_LABELS.fastForwardTrunk, "started"),
    110,
  ]);
  assertEquals(
    moving.steps.map((entry) => entry.state),
    ["done", "active", "pending", "skipped", "pending"],
    "a gate before a running step has passed",
  );
  assertEquals(
    moving.steps[0]?.startedAt,
    undefined,
    "an inferred pass has no time",
  );
  assertEquals(moving.steps[1]?.startedAt, 110);
  const settled = fold(
    moving,
    [step(BUILT_IN_STEP_LABELS.fastForwardTrunk, "finished"), 120],
    [step("deno install --frozen", "failed"), 150],
    [step(BUILT_IN_STEP_LABELS.deleteBranch, "finished"), 160],
  );
  assertEquals(
    settled.steps.map((entry) => [entry.state, entry.startedAt, entry.endedAt]),
    [
      ["done", undefined, undefined],
      ["done", 110, 120],
      ["failed", 120, 150],
      ["skipped", undefined, undefined],
      ["done", 150, 160],
    ],
    "a step that settles unannounced began when the one before it ended",
  );
  const unknown = fold(settled, [step("an unplanned label", "started"), 170]);
  assertEquals(unknown, settled, "a label the plan lacks changes nothing");
  const walking = fold(settled, [
    step(BUILT_IN_STEP_LABELS.fastForwardTrunk, "started", "agent/search"),
    180,
  ]);
  assertEquals(walking.followers, [{
    branch: "agent/search",
    title: "Search index",
    state: "landing",
    startedAt: 180,
  }]);
  assertEquals(walking.steps, settled.steps, "a follower's steps are its own");
});

Deno.test("Desk operations: waits show while they last", () => {
  const start = operationProgress(LANDING, "main", 0);
  const wait = (state: "waiting" | "resumed"): CompletionObservationFact => ({
    kind: "wait",
    wait: {
      id: "landing-turn",
      kind: "landing-turn",
      state,
      reason: "Waiting for its turn · Search index is landing",
      next: "It continues when that landing ends.",
      started_at: 0,
      updated_at: 0,
      elapsed_ms: 0,
    },
  });
  const waiting = progressAfter(start, wait("waiting"), 5);
  assertEquals(progressActivity(waiting).waits, [[{
    text: "Waiting for its turn · Search index is landing",
  }]]);
  assertEquals(progressAfter(waiting, wait("resumed"), 9).waits, []);
});

Deno.test("Desk operations: stopping is offered only while it leaves nothing half done", () => {
  const start = operationProgress(LANDING, "main", 0);
  assertEquals(canStop({ kind: "anytime" }, start), true);
  assertEquals(canStop({ kind: "never" }, start), false);
  assertEquals(canStop(undefined, start), false);
  const policy = DESK_STOP_POLICIES.accept;
  assert(policy !== undefined);
  assertEquals(canStop(policy, start), true, "before the trunk moves");
  assertEquals(
    canStop(
      policy,
      progressAfter(
        start,
        step(BUILT_IN_STEP_LABELS.fastForwardTrunk, "started"),
        1,
      ),
    ),
    false,
    "never once it moves",
  );
});

Deno.test("Desk operations: the progress sheet reads the steps, times and what follows", () => {
  const progress = fold(
    operationProgress(LANDING, "main", 100, [
      { branch: "agent/search", title: "Search index" },
    ]),
    [step(BUILT_IN_STEP_LABELS.fastForwardTrunk, "started"), 110],
  );
  const activity = progressActivity(progress);
  assertEquals(activity.startedAt, 100);
  assertEquals(activity.steps[1], {
    id: "step-1",
    label: "Move main to this branch",
    state: "active",
    startedAt: 110,
  });
  assertEquals(activity.then, [[
    { text: "Search index lands too" },
    { text: " · queued, pre-authorized", tone: "muted" },
  ]]);
  // A step the plan skips from the start is in the technical plan only.
  assertEquals(
    activity.steps.map((shown) => shown.id),
    ["step-0", "step-1", "step-2", "step-4"],
  );
  assertEquals(
    progressActivity(operationProgress(undefined, "main", 0)).then,
    undefined,
  );
});

Deno.test("Desk operations: a command's verb is what status names its run by", () => {
  assertEquals(
    commandVerb("discern accept --target agent/x --confirmed"),
    "accept",
  );
  assertEquals(
    commandVerb("discern worktree park /worktrees/x"),
    "worktree park",
  );
  assertEquals(commandVerb("discern worktree --json"), "worktree");
  assertEquals(commandVerb("discern done"), "done");
});
