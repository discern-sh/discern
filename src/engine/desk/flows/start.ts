/**
 * New task, Start follow-up, and Resume: one form collects the title, base,
 * brief and agent, and its review shows the start core's own plan. Create
 * starts the task, records the chosen agent, and opens it in the new
 * checkout when one was chosen.
 */

import { commandEvidence } from "../../../shared/command_evidence.ts";
import { taskTextValidationError } from "../../../shared/task_metadata.ts";
import { resolveWorktreeRoot } from "../../../lib/paths.ts";
import { startPlanToEngine } from "../../worktree/plan.ts";
import {
  type StartRequestOptions,
  WorktreeGitError,
} from "../../worktree/lifecycle.ts";
import {
  agentLaunchArgs,
  buildAgentLaunches,
  type DeskAgentLaunch,
} from "../model.ts";
import { commandConsequenceLines } from "../commands.ts";
import { DISCERN_VERSION } from "../../../lib/version.ts";
import { deskSessionEnv } from "../session.ts";
import { echoDeskCommand } from "../presentation.ts";
import type { Out } from "../../output.ts";
import type { DiscernConfig } from "../../../shared/config_schema.ts";
import type { DeskRuntime } from "../desk.ts";
import {
  type DeskFlowStep,
  type DeskOutcome,
  type DeskPrepared,
  untilChosen,
} from "../flow_types.ts";

/** The button that creates the task. */
const CREATE = "Create";
import { type DeskFlowContext, stepRow } from "./context.ts";

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

/** The form's values, checked as the start core will check them. */
function startRequest(
  context: DeskFlowContext,
  step: DeskFlowStep,
): { request: StartRequestOptions; argv: string[]; from: string } {
  const values = step.values ?? {};
  const title = (values.title ?? "").trim();
  const brief = (values.brief ?? "").trim();
  const trunk = context.config.repository.trunk;
  const from = fixedBase(context, step) ?? values.base ?? trunk;
  for (const [text, kind] of [[title, "title"], [brief, "brief"]] as const) {
    const invalid = text === ""
      ? undefined
      : taskTextValidationError(text, kind);
    if (invalid !== undefined) throw new WorktreeGitError(invalid);
  }
  return {
    from,
    request: {
      worktreeRoot: resolveWorktreeRoot(context.root, context.config),
      ...(title === "" ? {} : { title }),
      ...(brief === "" ? {} : { brief }),
      ...(from === trunk ? {} : { from }),
    },
    argv: [
      "discern",
      "start",
      ...(title === "" ? [] : ["--title", title]),
      ...(brief === "" ? [] : ["--brief", brief]),
      ...(from === trunk ? [] : ["--from", from]),
    ],
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

/** Review a new task: the start core's plan, then Create. */
export async function prepareStart(
  context: DeskFlowContext,
  step: DeskFlowStep,
): Promise<DeskPrepared> {
  const { request, argv, from } = startRequest(context, step);
  const ctx = await context.runtime.lifecycle(context.root);
  const prepared = await context.runtime.startPlan(ctx, request);
  const plan = startPlanToEngine(prepared.plan);
  const launches = await startLaunches(context.config, context.runtime);
  const launch = launches.find((candidate) =>
    candidate.id === step.values?.agent &&
    candidate.availability !== "disabled"
  );
  const command = commandEvidence(argv);
  return {
    content: {
      title: launch === undefined
        ? `Create ${prepared.plan.title} from ${from}?`
        : `Create ${prepared.plan.title} from ${from} and open ${launch.providerLabel}?`,
      lines: [
        ...commandConsequenceLines("new_task", {
          version: DISCERN_VERSION,
          trunk: context.config.repository.trunk,
        }).map((line) => ({ mark: line.mark, text: line.text })),
        ...(launch === undefined ? [] : [{
          mark: "changes" as const,
          text: `Then opens ${launch.label} in the new checkout`,
        }]),
        ...plan.details.map((detail) => ({ text: detail })),
      ],
      plan,
      command,
      footnote: untilChosen("is created", CREATE),
      safeLabel: "Cancel",
      confirmLabel: CREATE,
    },
    confirm: {
      kind: "apply",
      handoff: `Creating ${prepared.plan.title} · output continues below`,
      apply: async ({ out }): Promise<DeskOutcome> => {
        echoDeskCommand(out, command);
        const started = await context.runtime.start(ctx, prepared);
        if (launch !== undefined) {
          const saved = await context.runtime.writePreferences(context.root, {
            ...await context.runtime.readPreferences(context.root),
            last_agent: launch.agent,
          });
          if (saved.status !== "saved") {
            out.warn(`Desk preferences were not saved: ${saved.reason}`);
          }
          await openCreated(
            context,
            out,
            started.path,
            started.task.brief,
            launch,
          );
        }
        return {
          command,
          ok: true,
          message: { tone: "success", text: `Created ${started.task.title}` },
          select: started.path,
        };
      },
    },
  };
}
