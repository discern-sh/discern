/**
 * Review sheets and forms: every question the Desk asks before an effect.
 *
 * A review sheet paints at once from the last observation in its loading
 * state, then shows what its flow read: the plan's context and steps, the
 * registry's consequences, and the exact command, with the plan and command
 * one key away. It opens on its safe button and confirms only through its
 * confirm button. Forms collect a new task, a title, or a script's
 * arguments before their review. Pure.
 */

import type {
  ApplicationButton,
  ApplicationDetailBlock,
  ApplicationDisclosure,
  ApplicationForm,
  ApplicationFormField,
  ApplicationSheet,
} from "discern-design-system/cli/interactive";
import { renderPlan } from "../../shared/result.ts";
import type { EnginePlan } from "../../shared/result.ts";
import { commandEvidence } from "../../shared/command_evidence.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import {
  DESK_ACTION_LABELS,
  DESK_COMMAND_LABELS,
  labelName,
} from "../../shared/desk_vocabulary.ts";
import {
  DESK_ACTION_REGISTRY,
  type DeskAgentLaunch,
  type DeskConfirmationPolicy,
} from "./model.ts";
import { DESK_COMMAND_REGISTRY } from "./commands.ts";
import { CONSEQUENCE_GLYPHS } from "./glyphs.ts";
import { deskLine, deskLiteral } from "./text.ts";
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import { parseProjectScriptArguments } from "./literal_argv.ts";
import type {
  DeskIntent,
  DeskLayer,
  DeskLoad,
  DeskProductState,
} from "./desk_state.ts";
import {
  type DeskFlowStep,
  type DeskPrepared,
  type DeskReviewLine,
  untilChosen,
} from "./flow_types.ts";
import {
  branchTitle,
  goneSentence,
  layerId,
  parkedBranches,
  renameTitle,
  rowRef,
} from "./desk_transitions.ts";
import { glyph } from "./inspector_view.ts";

/** The buttons that create a task and run a script. */
const CREATE = "Create";
const RUN = "Run";

/** What forms read besides product state. */
export interface DeskSheetEnv {
  /** Agent launches configured for the main checkout. */
  readonly launches: readonly DeskAgentLaunch[];
}

/** A plan's exact shared rendering, as plain lines. */
export function planLines(plan: EnginePlan): string[] {
  const lines: string[] = [];
  renderPlan({
    heading: (heading) => lines.push(heading),
    line: (line) => lines.push(line),
    safeLine: (line) => deskLine(line),
    dim: (fragment) => fragment,
  }, plan);
  return lines.flatMap((line) => line.split("\n"));
}

/** Plain lines as one wrapped block, each line on its own row. */
function plainBlock(lines: readonly string[]): ApplicationDetailBlock {
  return {
    kind: "block",
    content: createCliBlock(renderMarkdownCli, {
      source: lines.map((line) => deskLiteral(line)).join("  \n"),
    }),
  };
}

/** Review lines as blocks: marked runs of lines, and plain runs between. */
function lineBlocks(
  lines: readonly DeskReviewLine[],
): ApplicationDetailBlock[] {
  const blocks: ApplicationDetailBlock[] = [];
  let plain: string[] = [];
  const flush = (): void => {
    if (plain.length > 0) blocks.push(plainBlock(plain));
    plain = [];
  };
  for (const line of lines) {
    if (line.mark === undefined) {
      plain.push(line.text);
      continue;
    }
    flush();
    const item = {
      mark: glyph(
        CONSEQUENCE_GLYPHS[line.mark],
        line.mark === "discards" || line.mark === "failure"
          ? "danger"
          : line.mark === "warning"
          ? "warning"
          : line.mark === "evidence"
          ? "success"
          : "muted",
      ),
      runs: [{
        text: line.text,
        ...(line.mark === "discards" ? { tone: "danger" as const } : {}),
      }],
    };
    const last = blocks.at(-1);
    if (last?.kind === "marks") {
      blocks[blocks.length - 1] = { ...last, items: [...last.items, item] };
    } else blocks.push({ kind: "marks", items: [item] });
  }
  flush();
  return blocks;
}

/** The registry policy a step's sheet asks with. */
function policy(step: DeskFlowStep): DeskConfirmationPolicy {
  return step.kind === "action"
    ? DESK_ACTION_REGISTRY[step.action].confirmation
    : DESK_COMMAND_REGISTRY[step.command].confirmation;
}

/** Why a step can no longer run: its task left the inbox while asked. */
function gone(
  state: DeskProductState,
  step: DeskFlowStep,
): string | undefined {
  if (step.kind !== "action") return undefined;
  if (rowRef(state, step.taskId)?.kind === "task") return undefined;
  return goneSentence(state.departed, step.taskId, state.trunk);
}

/** A form's confirm button, disabled with the first reason it can't run. */
function formConfirm(
  layer: string,
  label: string,
  ...reasons: readonly (string | undefined)[]
): ApplicationButton<DeskIntent> {
  const reason = reasons.find((candidate) => candidate !== undefined);
  return {
    id: "confirm",
    label,
    role: "confirm",
    action: { kind: "confirm", layer },
    ...(reason === undefined ? {} : { enabled: false, disabledReason: reason }),
  };
}

/** The question a sheet asks before its read finishes. */
function pendingTitle(state: DeskProductState, step: DeskFlowStep): string {
  if (step.kind === "command") {
    return `${labelName(DESK_COMMAND_LABELS[step.command])}?`;
  }
  const ref = rowRef(state, step.taskId);
  const offer = ref?.kind === "task"
    ? ref.row.decision.actions.find((candidate) =>
      candidate.action === step.action
    )
    : undefined;
  return offer?.reviewTitle ?? `${labelName(DESK_ACTION_LABELS[step.action])}?`;
}

/** The plan and command disclosures, each one key away from any focus. */
function disclosures(
  prepared: DeskPrepared | undefined,
): ApplicationDisclosure[] {
  const content = prepared?.content;
  if (content === undefined) return [];
  return [
    ...(content.plan === undefined ? [] : [{
      id: "plan",
      label: `Technical plan · ${plural(content.plan.steps.length, "step")}`,
      hint: "Plan",
      openHint: "Hide plan",
      key: "d",
      fieldKey: "ctrl-t",
      content: [{
        kind: "rows" as const,
        items: planLines(content.plan).map((line) => ({
          text: [{ text: line, role: "code" as const }],
        })),
      }],
    }]),
    ...(content.command === undefined ? [] : [{
      id: "command",
      label: "Command",
      key: "c",
      fieldKey: "ctrl-x",
      content: [{
        kind: "text" as const,
        runs: [{ text: content.command, role: "code" as const }],
      }],
    }]),
  ];
}

/** A review's confirm button: destructive when it removes work, and
 * disabled with its reason when the review found a blocker. */
function confirmButton(
  layer: string,
  label: string,
  destructive: boolean,
  challenged: boolean,
  blocked: string | undefined,
): ApplicationButton<DeskIntent> {
  const disabled = blocked === undefined
    ? {}
    : { enabled: false, disabledReason: blocked };
  return destructive
    ? {
      id: "confirm",
      label,
      role: "destructive",
      action: { kind: "confirm", layer },
      ...(challenged ? { requiresChallenge: true } : {}),
      ...disabled,
    }
    : {
      id: "confirm",
      label,
      role: "confirm",
      action: { kind: "confirm", layer },
      ...disabled,
    };
}

/** One review sheet, from its loading state to what its flow read. */
export function reviewSheet(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "review" }>,
): ApplicationSheet<DeskIntent> {
  const id = layerId(layer);
  const load: DeskLoad<DeskPrepared> = layer.load;
  const prepared = load.state === "ready" ? load.value : undefined;
  const content = prepared?.content;
  const confirmation = policy(layer.step);
  const vanished = gone(state, layer.step);
  const safeLabel = vanished !== undefined ? "Close" : content?.safeLabel ??
    (confirmation.kind === "none" ? "Close" : confirmation.noLabel);
  const confirmLabel = content?.confirmLabel ??
    (confirmation.kind === "none" ? "Open" : confirmation.yesLabel);
  const destructive = content?.destructive === true;
  const challenge = content?.challenge;
  const buttons: ApplicationButton<DeskIntent>[] = [
    ...(content?.alternatives ?? []).map((alternative) => ({
      id: alternative.id,
      label: alternative.label,
      role: "alternative" as const,
      action: { kind: "alternative" as const, layer: id, id: alternative.id },
      ...(alternative.key === undefined ? {} : { key: alternative.key }),
    })),
    { id: "safe", label: safeLabel, role: "safe" },
    ...(load.state === "ready" && prepared?.confirm === undefined ? [] : [
      confirmButton(
        id,
        confirmLabel,
        destructive,
        challenge !== undefined,
        content?.blocked,
      ),
    ]),
  ];
  return {
    kind: "sheet",
    id,
    scope: layer.step.kind === "action" ? "item" : "global",
    title: content?.title ?? pendingTitle(state, layer.step),
    state: vanished !== undefined
      ? "gone"
      : load.state === "loading"
      ? "loading"
      : load.state === "failed"
      ? "failed"
      : "ready",
    busy: "Checking current state…",
    ...(vanished !== undefined
      ? { banner: { tone: "warning" as const, runs: [{ text: vanished }] } }
      : load.state === "failed"
      ? { banner: { tone: "danger" as const, runs: [{ text: load.error }] } }
      : content?.blocked === undefined
      ? {}
      : {
        banner: { tone: "warning" as const, runs: [{ text: content.blocked }] },
      }),
    body: content === undefined ? [] : lineBlocks(content.lines),
    readHint: `to read before choosing ${confirmLabel}`,
    disclosures: disclosures(prepared),
    ...(challenge === undefined ? {} : {
      challenge: {
        fieldId: "challenge",
        label: [
          { text: "Type " },
          { text: challenge.mustEqual, role: "title" as const },
          { text: " to confirm" },
        ],
        mustEqual: challenge.mustEqual,
      },
    }),
    footnote: [{
      text: content?.footnote ??
        untilChosen("changes", confirmLabel),
    }],
    buttons,
  };
}

/** The "This will" preview of what Create does. */
function startPreview(
  base: string,
  agent: DeskAgentLaunch | undefined,
): ApplicationDetailBlock[] {
  const lines: DeskReviewLine[] = [
    { mark: "changes", text: `Creates a task branch from ${base}` },
    { mark: "changes", text: "Gives it its own checkout and runs setup" },
    ...(agent === undefined ? [] : [{
      mark: "changes" as const,
      text: `Opens ${agent.providerLabel} in it`,
    }]),
    { mark: "keeps", text: "Landing permission stays a separate decision" },
  ];
  return [{ kind: "section", title: "This will", blocks: lineBlocks(lines) }];
}

/** A new task's form: title, then base, brief and agent folded away. */
function startForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
  env: DeskSheetEnv,
): ApplicationForm<DeskIntent> {
  const id = layerId(layer);
  const step = layer.step;
  const fixed = step.kind === "action"
    ? (() => {
      const ref = rowRef(state, step.taskId);
      return ref?.kind === "task" ? ref.row.entry.branch : undefined;
    })()
    : step.command === "resume"
    ? step.ref
    : undefined;
  const parked = step.kind === "command" && step.command === "resume"
    ? state.data?.parked_tasks?.find((task) => task.branch === step.ref)
    : undefined;
  const launches = env.launches;
  const remembered = launches.find((launch) =>
    launch.agent === state.preferences.last_agent && launch.kind === "open" &&
    launch.availability !== "disabled"
  );
  const values = layer.values;
  const base = fixed ?? values.base ?? state.trunk;
  const agent = launches.find((launch) =>
    launch.id === (values.agent ?? remembered?.id ?? "none")
  );
  const bases = [
    state.trunk,
    ...state.rows.flatMap((row) =>
      row.entry.branch === "" ? [] : [row.entry.branch]
    ),
    ...parkedBranches(state.data),
  ];
  const title = values.title ?? parked?.task.title ?? "";
  const brief = values.brief ?? parked?.task.brief ?? "";
  const fields: ApplicationFormField<DeskIntent>[] = [
    {
      kind: "text",
      id: "title",
      label: "Title",
      initial: parked?.task.title ?? "",
      hint: [{
        text: "Leave it empty for a generated codename",
        tone: "faint",
      }],
    },
    {
      kind: "group",
      id: "options",
      label: "More options",
      summary: `from ${base} · ${
        brief.trim() === "" ? "no brief" : "brief"
      } · ${agent === undefined ? "no agent" : agent.providerLabel}`,
      fields: [
        ...(fixed === undefined
          ? [{
            kind: "choice" as const,
            id: "base",
            label: "Base",
            initial: state.trunk,
            options: [...new Set(bases)].map((branch) => ({
              id: branch,
              label: branch === state.trunk
                ? branch
                : branchTitle(branch, state.data),
            })),
          }]
          : []),
        {
          kind: "text" as const,
          id: "brief",
          label: "Brief",
          initial: parked?.task.brief ?? "",
          multiline: true,
        },
        {
          kind: "choice" as const,
          id: "agent",
          label: "Agent",
          initial: remembered?.id ?? "none",
          options: [
            { id: "none", label: "None" },
            ...launches.map((launch) => ({
              id: launch.id,
              label: `${launch.providerLabel}: ${launch.label}`,
              ...(launch.availability === "disabled"
                ? { disabledReason: launch.reason ?? "Unavailable" }
                : {}),
            })),
          ],
        },
      ],
    },
  ];
  const argv = [
    "discern",
    "start",
    ...(title.trim() === "" ? [] : ["--title", title.trim()]),
    ...(brief.trim() === "" ? [] : ["--brief", brief.trim()]),
    ...(base === state.trunk ? [] : ["--from", base]),
  ];
  return {
    kind: "form",
    id,
    scope: step.kind === "action" ? "item" : "global",
    title: step.kind === "action"
      ? labelName(DESK_ACTION_LABELS.follow_up)
      : step.command === "resume"
      ? `Resume ${branchTitle(step.ref ?? "", state.data)}`
      : labelName(DESK_COMMAND_LABELS.new_task),
    ...(fixed === undefined
      ? {}
      : { aside: [{ text: `from ${fixed}`, tone: "faint" as const }] }),
    fields,
    preview: startPreview(base, agent),
    disclosures: [{
      id: "command",
      label: "Command",
      key: "c",
      fieldKey: "ctrl-x",
      content: [{
        kind: "text",
        runs: [{ text: commandEvidence(argv), role: "code" }],
      }],
    }],
    footnote: [{ text: untilChosen("is created", CREATE) }],
    buttons: [
      { id: "safe", label: "Cancel", role: "safe" },
      formConfirm(id, CREATE, gone(state, step)),
    ],
  };
}

/** A rename's form: the title, prefilled. */
function renameForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
): ApplicationForm<DeskIntent> {
  const id = layerId(layer);
  const step = layer.step;
  const ref = step.kind === "action" ? rowRef(state, step.taskId) : undefined;
  // The field starts from the task's title as the form opened; the values the
  // package reports never feed back into it.
  const initial = ref?.kind === "task"
    ? renameTitle(ref.row)
    : layer.values.title ?? "";
  return {
    kind: "form",
    id,
    scope: "item",
    title: labelName(DESK_ACTION_LABELS.rename),
    fields: [{
      kind: "text",
      id: "title",
      label: "Title",
      initial,
      required: true,
    }],
    preview: lineBlocks([{
      mark: "changes",
      text: "Changes the task title only; the branch and checkout stay",
    }]),
    disclosures: [],
    footnote: [{ text: "Nothing changes until you review the new title." }],
    buttons: [
      { id: "safe", label: "Keep", role: "safe" },
      formConfirm(id, "Rename", gone(state, layer.step)),
    ],
  };
}

/** A script's arguments, with what will run. */
function scriptForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
  root: string,
): ApplicationForm<DeskIntent> {
  const id = layerId(layer);
  const name = layer.values.script ?? "";
  const args = layer.values.args ?? "";
  const parsed = parseProjectScriptArguments(args);
  const step = layer.step;
  const ref = step.kind === "action" ? rowRef(state, step.taskId) : undefined;
  const where = ref?.kind === "task" ? ref.row.entry.path : root;
  const argv = ["discern", "scripts", name, ...(parsed.ok ? parsed.args : [])];
  return {
    kind: "form",
    id,
    scope: step.kind === "action" ? "item" : "global",
    title: `Run ${name}`,
    aside: [{
      text: ref?.kind === "task" ? ref.row.task.name : "main checkout",
      tone: "faint",
    }],
    fields: [{
      kind: "text",
      id: "args",
      label: "Arguments",
      initial: "",
      hint: [{
        text: "Quote spaces; nothing is expanded by a shell.",
        tone: "faint",
      }],
    }],
    preview: [
      {
        kind: "facts",
        rows: [
          { label: "Directory", value: [[{ text: where }]] },
          {
            label: "Arguments",
            value: [[
              parsed.ok
                ? {
                  text: parsed.args.length === 0
                    ? "None"
                    : JSON.stringify(parsed.args),
                }
                : { text: parsed.message, tone: "warning" },
            ]],
          },
        ],
      },
      ...lineBlocks([
        { mark: "changes", text: "It owns the terminal until it exits" },
        {
          mark: "warning",
          text: "This script hasn't declared what it changes",
        },
      ]),
    ],
    disclosures: [{
      id: "command",
      label: "Command",
      key: "c",
      fieldKey: "ctrl-x",
      content: [{
        kind: "text",
        runs: [{ text: commandEvidence(argv), role: "code" }],
      }],
    }],
    footnote: [{ text: untilChosen("runs", RUN) }],
    buttons: [
      { id: "safe", label: "Cancel", role: "safe" },
      formConfirm(
        id,
        RUN,
        gone(state, step),
        parsed.ok ? undefined : parsed.message,
      ),
    ],
  };
}

/** One form layer. */
export function deskForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
  env: DeskSheetEnv & { readonly root: string },
): ApplicationForm<DeskIntent> {
  const step = layer.step;
  if (step.kind === "action" && step.action === "rename") {
    return renameForm(state, layer);
  }
  if (
    (step.kind === "action" && step.action === "scripts") ||
    (step.kind === "command" && step.command === "main_scripts")
  ) return scriptForm(state, layer, env.root);
  return startForm(state, layer, env);
}
