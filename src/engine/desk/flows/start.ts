/**
 * New task, Start follow-up, and Resume: one form collects the title, base,
 * brief and agent, and its live "This will" preview is the start core's own
 * dry run for the values typed so far. Create starts exactly the reviewed
 * plan; Create and open <agent> also opens the chosen agent in the new
 * checkout and remembers it.
 */

import { taskTextValidationError } from "../../../shared/task_metadata.ts";
import { resolveWorktreeRoot } from "../../../lib/paths.ts";
import { startPlanToEngine } from "../../worktree/plan.ts";
import type { StartRequestOptions } from "../../worktree/lifecycle.ts";
import {
  agentLaunchArgs,
  buildAgentLaunches,
  type DeskAgentLaunch,
} from "../model.ts";
import { DISCERN_VERSION } from "../../../lib/version.ts";
import { deskSessionEnv } from "../session.ts";
import { echoDeskCommand } from "../presentation.ts";
import type { Out } from "../../output.ts";
import type { DiscernConfig } from "../../../shared/config_schema.ts";
import type { DeskRuntime } from "../desk.ts";
import { commandEvidence } from "../../../shared/command_evidence.ts";
import {
  type DeskFlowStep,
  type DeskOutcome,
  untilChosen,
} from "../flow_types.ts";
import { type DeskReviewRead, reviewFor } from "../review.ts";
import {
  actionTarget,
  type DeskFlow,
  type DeskFlowContext,
  offerFor,
  rebound,
  stepRow,
} from "./context.ts";

/** The button that creates the task. */
export const CREATE = "Create";

/** The configured launches the main checkout can open in a new task. */
export async function startLaunches(
  config: DiscernConfig,
  runtime: Pick<DeskRuntime, "detectAgents">,
): Promise<DeskAgentLaunch[]> {
  return buildAgentLaunches(config, await runtime.detectAgents());
}

/** The branch a step starts from when the form does not choose it. */
function fixedBase(
  context: DeskFlowContext,
  step: DeskFlowStep,
): string | undefined {
  if (step.kind === "action") return stepRow(context, step).entry.branch;
  return step.command === "resume" ? step.ref : undefined;
}

/** The form's values as the start core reads them, and the exact command. */
function startRequest(
  context: DeskFlowContext,
  step: DeskFlowStep,
): {
  readonly request: StartRequestOptions;
  readonly argv: string[];
  readonly from: string;
  readonly invalid?: string;
} {
  const values = step.values ?? {};
  const title = (values.title ?? "").trim();
  const brief = (values.brief ?? "").trim();
  const trunk = context.config.repository.trunk;
  const from = fixedBase(context, step) ?? values.base ?? trunk;
  const invalid = ([[title, "title"], [brief, "brief"]] as const).flatMap((
    [text, kind],
  ) => {
    const reason = text === ""
      ? undefined
      : taskTextValidationError(text, kind);
    return reason === undefined ? [] : [reason];
  })[0];
  return {
    from,
    request: {
      worktreeRoot: resolveWorktreeRoot(context.root, context.config),
      ...(title === "" || invalid !== undefined ? {} : { title }),
      ...(brief === "" || invalid !== undefined ? {} : { brief }),
      ...(from === trunk ? {} : { from }),
    },
    argv: [
      "discern",
      "start",
      ...(title === "" ? [] : ["--title", title]),
      ...(brief === "" ? [] : ["--brief", brief]),
      ...(from === trunk ? [] : ["--from", from]),
    ],
    ...(invalid === undefined ? {} : { invalid }),
  };
}

/** Open the chosen agent in a created task, with its brief where it can go. */
async function openCreated(
  context: DeskFlowContext,
  out: Out,
  path: string,
  brief: string | undefined,
  launch: DeskAgentLaunch,
): Promise<void> {
  const invocation = agentLaunchArgs(launch, brief);
  if (brief !== undefined && !invocation.briefPassed) {
    out.info(
      `${launch.providerLabel} takes no prompt option. Copy the task's brief into the session:`,
    );
    out.raw(`${brief}\n`);
  }
  out.info(`${launch.providerLabel} opens in ${path}. Exit it to come back.`);
  const code = await context.runtime.interactive(
    launch.binary,
    invocation.args,
    path,
    deskSessionEnv(),
    "desk agent",
  );
  if (code !== 0) {
    out.warn(`${launch.label} exited with status ${code}.`);
    await context.runtime.pause(out);
  }
}

/** The start core's plan for the form's values, as a review. */
async function startReview(
  context: DeskFlowContext,
  step: DeskFlowStep,
): ReturnType<DeskFlow["review"]> {
  const { request, argv, from, invalid } = startRequest(context, step);
  const ctx = await context.runtime.lifecycle(context.root);
  const prepared = await context.runtime.startPlan(ctx, request);
  const plan = startPlanToEngine(prepared.plan);
  const read: DeskReviewRead = {
    plan,
    facts: {
      creates: {
        branch: prepared.plan.branch,
        base: from,
        commit: prepared.plan.fromCommit,
        resources: prepared.plan.resources.length,
      },
    },
    argv,
    core: {
      kind: "start",
      prepared,
      ...(step.values?.agent === undefined || step.values.agent === "none"
        ? {}
        : { launch: step.values.agent }),
    },
    bound: {
      "base-commit": prepared.plan.fromCommit,
      "base-head": prepared.plan.fromCommit,
      "branch-name": prepared.plan.branch,
      ...(step.kind === "command" && step.command === "resume"
        ? {
          "parked-record": step.ref ?? "",
          "parked-head": prepared.plan.fromCommit,
        }
        : {}),
    },
    ...(invalid === undefined ? {} : { blockers: [invalid] }),
    footnote: untilChosen("is created", CREATE),
    running: `Creating ${prepared.plan.title}`,
  };
  if (step.kind === "action") {
    const row = stepRow(context, step);
    return reviewFor(
      actionTarget(context, row, offerFor(row, "follow_up")),
      read,
    );
  }
  return reviewFor({
    kind: "command",
    command: step.command,
    facts: {
      version: DISCERN_VERSION,
      trunk: context.config.repository.trunk,
      ...(context.state.data === undefined ? {} : { data: context.state.data }),
    },
  }, read);
}

/** Create the reviewed task, then open the chosen agent in it. */
async function startApply(
  context: DeskFlowContext,
  step: DeskFlowStep,
  expected: Parameters<DeskFlow["apply"]>[2],
  progress: Parameters<DeskFlow["apply"]>[3],
): Promise<DeskOutcome> {
  if (step.kind === "action") {
    const changed = await rebound(context, step, expected, "follow_up");
    if (changed !== undefined) return changed;
  }
  if (expected.core?.kind !== "start") {
    throw new TypeError("A start applies only its reviewed plan.");
  }
  const { prepared } = expected.core;
  const command = commandEvidence(
    startRequest(context, step).argv,
  );
  const { out } = progress;
  echoDeskCommand(out, command);
  const ctx = await context.runtime.lifecycle(context.root);
  const started = await context.runtime.start(ctx, prepared);
  const launchId = progress.open;
  const launch = launchId === undefined
    ? undefined
    : (await startLaunches(context.config, context.runtime)).find(
      (candidate) =>
        candidate.id === launchId && candidate.availability !== "disabled",
    );
  if (launch !== undefined) {
    const saved = await context.runtime.writePreferences(context.root, {
      ...await context.runtime.readPreferences(context.root),
      last_agent: launch.agent,
    });
    if (saved.status !== "saved") {
      out.warn(`Desk preferences were not saved: ${saved.reason}`);
    }
    await openCreated(context, out, started.path, started.task.brief, launch);
  }
  return {
    command,
    ok: true,
    message: { tone: "success", text: `Created ${started.task.title}` },
    select: started.path,
    ...(launch === undefined ? {} : { lastAgent: launch.agent }),
  };
}

/** One start form, for whichever route opened it. */
const START_FLOW: DeskFlow = { review: startReview, apply: startApply };

/** The start family's flows, by registry action or command. */
export const START_FLOWS = {
  follow_up: START_FLOW,
  new_task: START_FLOW,
  resume: START_FLOW,
} as const satisfies Readonly<Record<string, DeskFlow>>;
