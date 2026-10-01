/**
 * The Desk's in-session operations.
 *
 * A confirmed control whose registry effect changes project state runs
 * beside the live screen instead of taking the terminal: the reviewed plan
 * stays on screen and is worked through as the executor reports each of its
 * steps. This module says which confirmed steps run that way, when one can
 * stop cleanly, and how the facts an operation reports become the plan's
 * progress. Pure: time is always passed in, on the application's clock.
 */

import type { ApplicationActivity } from "discern-design-system/cli/interactive";
import type {
  EnginePlan,
  PlanStepState,
  StepDisposition,
} from "../../shared/result.ts";
import { BUILT_IN_STEP_LABELS } from "../../shared/result.ts";
import { humanStepLabel } from "../../shared/step_labels.ts";
import type { CompletionObservationFact } from "../completion/events.ts";
import { DESK_ACTION_REGISTRY, type DeskAction } from "./model.ts";
import { DESK_COMMAND_REGISTRY, type DeskCommand } from "./commands.ts";
import type { DeskFlowStep } from "./flow_types.ts";

/** The registry effect a step's control declares. */
function effectOf(step: DeskFlowStep): string {
  return step.kind === "action"
    ? DESK_ACTION_REGISTRY[step.action].effect
    : DESK_COMMAND_REGISTRY[step.command].effect;
}

/**
 * Whether a confirmed step runs beside the screen. A control that changes
 * project state through a lifecycle core does; one that hands the terminal
 * to a child does not, and neither does a creation that opens an agent
 * straight after it, since the agent takes the terminal anyway.
 */
export function runsInSession(
  step: DeskFlowStep,
  open: string | undefined,
): boolean {
  return effectOf(step) === "change" && open === undefined;
}

/**
 * Whether a confirmed step opens a page in the system browser: it runs
 * beside the screen with no progress to follow, and a reader shows what it
 * left.
 */
export function opensBeside(step: DeskFlowStep): boolean {
  return effectOf(step) === "open";
}

/**
 * The verb a command records, as status names a task running it:
 * `discern accept --target x` runs `accept`, and `discern worktree park x`
 * runs `worktree park`.
 */
export function commandVerb(command: string): string {
  const [, first = "", second = ""] = command.split(/\s+/u).filter((word) =>
    word !== ""
  );
  return first === "worktree" && second !== "" && !second.startsWith("-")
    ? `${first} ${second}`
    : first;
}

/**
 * When a running operation can stop without leaving work half done:
 * whenever, never, or until the named plan step starts.
 */
export type DeskStopPolicy =
  | { readonly kind: "anytime" }
  | { readonly kind: "never" }
  | { readonly kind: "before"; readonly step: string };

const ANYTIME: DeskStopPolicy = { kind: "anytime" };
const NEVER: DeskStopPolicy = { kind: "never" };

/**
 * Stop policies for every control that runs in session. Checks and setup
 * resume where they stopped, and a new task discards its partial checkout;
 * a landing is safe to stop until the trunk starts to move. The others
 * finish in moments and stop nowhere cleaner than their end.
 */
export const DESK_STOP_POLICIES: Readonly<
  Partial<Record<DeskAction | DeskCommand, DeskStopPolicy>>
> = {
  done: ANYTIME,
  retry_setup: ANYTIME,
  follow_up: ANYTIME,
  new_task: ANYTIME,
  resume: ANYTIME,
  accept: { kind: "before", step: BUILT_IN_STEP_LABELS.fastForwardTrunk },
  submit: NEVER,
  update: NEVER,
  rename: NEVER,
  grant: NEVER,
  revoke_grant: NEVER,
  reclaim: NEVER,
  park: NEVER,
  drop: NEVER,
};

/** When a step's control can stop. */
export function stopPolicy(step: DeskFlowStep): DeskStopPolicy | undefined {
  return DESK_STOP_POLICIES[
    step.kind === "action" ? step.action : step.command
  ];
}

/** One plan step as the progress shows it. */
export interface DeskStepProgress {
  /** The plan's label, which the executor's facts name. */
  readonly label: string;
  /** What the owner reads: the human words, or the configured spelling. */
  readonly words: string;
  readonly disposition: StepDisposition;
  readonly state: "pending" | "active" | "done" | "failed" | "skipped";
  readonly startedAt?: number;
  readonly endedAt?: number;
}

/** A queued task that lands after this one, as the progress names it. */
export interface DeskFollower {
  readonly branch: string;
  readonly title: string;
  readonly state: "queued" | "landing";
  readonly startedAt?: number;
}

/** One wait the operation is in, such as for its landing turn. */
export interface DeskOperationWait {
  readonly id: string;
  readonly reason: string;
}

/** An operation's progress: its plan's steps, its waits, and what follows. */
export interface DeskOperationProgress {
  readonly startedAt: number;
  readonly steps: readonly DeskStepProgress[];
  readonly waits: readonly DeskOperationWait[];
  readonly followers: readonly DeskFollower[];
}

/** The progress of an operation that has just started its plan. */
export function operationProgress(
  plan: EnginePlan | undefined,
  trunk: string,
  startedAt: number,
  followers: readonly { readonly branch: string; readonly title: string }[] =
    [],
): DeskOperationProgress {
  return {
    startedAt,
    steps: (plan?.steps ?? []).map((step): DeskStepProgress => ({
      label: step.label,
      words: humanStepLabel(step.label, trunk) ?? step.label,
      disposition: step.disposition,
      state: step.disposition === "skip" ? "skipped" : "pending",
    })),
    waits: [],
    followers: followers.map((follower) => ({
      ...follower,
      state: "queued",
    })),
  };
}

/** Whether a step has settled. */
function settled(step: DeskStepProgress): boolean {
  return step.state === "done" || step.state === "failed" ||
    step.state === "skipped";
}

/** The state a reported step transition puts a step in. */
const STEP_STATES = {
  started: "active",
  finished: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "failed",
} as const satisfies Record<PlanStepState, DeskStepProgress["state"]>;

/**
 * Mark steps the executor passed without reporting: a gate before a step
 * that runs has passed, and an unreported step before one has run. Only
 * pending steps change, and none gains a time it was not reported with.
 */
function passedBefore(
  steps: readonly DeskStepProgress[],
  index: number,
): DeskStepProgress[] {
  return steps.map((step, at) =>
    at < index && step.state === "pending" ? { ...step, state: "done" } : step
  );
}

/** The plan's own step's transition. */
function stepTransition(
  progress: DeskOperationProgress,
  label: string,
  transition: PlanStepState,
  now: number,
): DeskOperationProgress {
  const index = progress.steps.findIndex((step) =>
    step.label === label && !settled(step)
  );
  if (index < 0) return progress;
  const state = STEP_STATES[transition];
  const steps = passedBefore(progress.steps, index);
  const current = steps[index];
  if (current === undefined) return progress;
  // A step that settles without reporting its start began when the one
  // before it ended, or when the operation started.
  const previousEnd = steps.slice(0, index).reduce<number | undefined>(
    (latest, step) =>
      step.endedAt === undefined
        ? latest
        : Math.max(latest ?? step.endedAt, step.endedAt),
    undefined,
  );
  const next: DeskStepProgress = state === "active"
    ? { ...current, state, startedAt: now }
    : {
      ...current,
      state,
      startedAt: current.startedAt ?? previousEnd ?? progress.startedAt,
      endedAt: now,
    };
  return {
    ...progress,
    steps: steps.map((step, at) => at === index ? next : step),
  };
}

/** A follower's plan reported a step: it is landing now. */
function followerTransition(
  progress: DeskOperationProgress,
  subject: string,
  now: number,
): DeskOperationProgress {
  if (
    !progress.followers.some((follower) =>
      follower.branch === subject && follower.state === "queued"
    )
  ) return progress;
  return {
    ...progress,
    followers: progress.followers.map((follower) =>
      follower.branch === subject
        ? { ...follower, state: "landing", startedAt: now }
        : follower
    ),
  };
}

/** Fold one completion fact the operation reported into its progress. */
export function progressAfter(
  progress: DeskOperationProgress,
  fact: CompletionObservationFact,
  now: number,
): DeskOperationProgress {
  if (fact.kind === "step") {
    return fact.step.subject === undefined
      ? stepTransition(progress, fact.step.label, fact.step.state, now)
      : followerTransition(progress, fact.step.subject, now);
  }
  if (fact.kind === "wait") {
    const others = progress.waits.filter((wait) => wait.id !== fact.wait.id);
    return {
      ...progress,
      waits: fact.wait.state === "waiting"
        ? [...others, { id: fact.wait.id, reason: fact.wait.reason }]
        : others,
    };
  }
  return progress;
}

/** Whether the operation can stop cleanly now. */
export function canStop(
  policy: DeskStopPolicy | undefined,
  progress: DeskOperationProgress,
): boolean {
  if (policy === undefined || policy.kind === "never") return false;
  if (policy.kind === "anytime") return true;
  return progress.steps.some((step) =>
    step.label === policy.step && step.state === "pending"
  );
}

/**
 * The progress as the package's progress sheet shows it. A step the plan
 * skips from the start is not work the operation does, so only the technical
 * plan lists it.
 */
export function progressActivity(
  progress: DeskOperationProgress,
): ApplicationActivity {
  return {
    startedAt: progress.startedAt,
    steps: progress.steps.flatMap((step, index) =>
      step.disposition === "skip" ? [] : [{
        id: `step-${index}`,
        label: step.words,
        state: step.state,
        ...(step.startedAt === undefined ? {} : { startedAt: step.startedAt }),
        ...(step.endedAt === undefined ? {} : { endedAt: step.endedAt }),
      }]
    ),
    ...(progress.waits.length === 0 ? {} : {
      waits: progress.waits.map((wait) => [{ text: wait.reason }]),
    }),
    ...(progress.followers.length === 0 ? {} : {
      then: progress.followers.map((follower) => [
        { text: `${follower.title} lands too` },
        {
          text: follower.state === "landing"
            ? " · landing now"
            : " · queued, pre-authorized",
          tone: "muted" as const,
        },
      ]),
    }),
  };
}
