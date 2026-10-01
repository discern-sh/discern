/**
 * Review sheets, result sheets and forms: every question the Desk asks
 * before an effect, and what it says when one fails.
 *
 * A review sheet paints at once in its loading state, then shows what its
 * flow read: consequence lines first, each from a declared fact, never
 * dropped for space; the changes, the exact shared plan, and the exact
 * command one key away (`v`, `d`/`^T`, `c`/`^X`). It opens on its safe
 * button or its challenge field and confirms only through its confirm
 * button, which waits until every line has been on screen. A subject that
 * changed since the review was read shows a banner and waits for `r`; a
 * subject that is gone leaves only Close. Forms carry the same review as
 * their live preview. A confirmed change then runs beside the screen, its
 * progress sheet working through the plan the review showed, and leaving
 * while one runs asks first. Pure.
 */

import type {
  ApplicationButton,
  ApplicationDetailBlock,
  ApplicationDetailMark,
  ApplicationDisclosure,
  ApplicationForm,
  ApplicationFormField,
  ApplicationSheet,
} from "discern-design-system/cli/interactive";
import { renderPlan } from "../../shared/result.ts";
import type { EnginePlan } from "../../shared/result.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import {
  DESK_ACTION_LABELS,
  DESK_COMMAND_LABELS,
  labelName,
} from "../../shared/desk_vocabulary.ts";
import {
  createCliBlock,
  renderCodeBlockCli,
  renderMarkdownCli,
} from "discern-design-system/cli";
import {
  DESK_ACTION_REGISTRY,
  type DeskAgentLaunch,
  type DeskConfirmationPolicy,
} from "./model.ts";
import { DESK_COMMAND_REGISTRY } from "./commands.ts";
import { CONSEQUENCE_GLYPHS } from "./glyphs.ts";
import { deskLine } from "./text.ts";
import type {
  DeskIntent,
  DeskLayer,
  DeskLoad,
  DeskProductState,
} from "./desk_state.ts";
import {
  type DeskFlowStep,
  type DeskResultSheet,
  type DeskReview,
  type DeskReviewLine,
  untilChosen,
} from "./flow_types.ts";
import {
  branchTitle,
  type DeskRowRef,
  goneSentence,
  layerId,
  parkedBranches,
  renameTitle,
  resultAlternatives,
  rowRef,
} from "./desk_transitions.ts";
import { diffRuns, fileRows, glyph } from "./inspector_view.ts";
import {
  cachedEvidence,
  evidenceKey,
  taskEvidenceSubject,
  trunkHead,
} from "./evidence.ts";
import { reviewDrift } from "./review.ts";
import { compactDuration } from "../output.ts";
import { canStop, progressActivity, stopPolicy } from "./operations.ts";
import { DESK_GLYPHS } from "./glyphs.ts";

/** The busy line while a sheet reads its subject again. */
const CHECKING = "Checking current state…";

/** The key that reads a changed review again. */
export const REVIEW_AGAIN_KEY = "r";

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

/** The tone a line's mark takes. */
function markTone(
  mark: DeskReviewLine["mark"],
): "danger" | "warning" | "success" | "muted" {
  return mark === "discards" || mark === "failure"
    ? "danger"
    : mark === "warning"
    ? "warning"
    : mark === "evidence"
    ? "success"
    : "muted";
}

/** One review line as a marked item: its words, its counts, its detail. */
function markItem(line: DeskReviewLine): ApplicationDetailMark {
  return {
    mark: glyph(CONSEQUENCE_GLYPHS[line.mark], markTone(line.mark)),
    runs: [
      {
        text: line.text,
        ...(line.mark === "discards" ? { tone: "danger" as const } : {}),
      },
      ...(line.diff === undefined ? [] : [
        { text: "  " },
        ...diffRuns(line.diff.insertions, line.diff.deletions),
      ]),
    ],
    ...(line.detail === undefined || line.detail.length === 0 ? {} : {
      lines: line.detail.map((text) => [{
        text,
        tone: "muted" as const,
      }]),
    }),
  };
}

/** A review's lines as one block of marked items, in order. */
export function reviewLineBlocks(
  lines: readonly DeskReviewLine[],
): ApplicationDetailBlock[] {
  return lines.length === 0 ? [] : [{
    kind: "marks",
    items: lines.map(markItem),
  }];
}

/** The registry policy a step's sheet asks with. */
function policy(step: DeskFlowStep): DeskConfirmationPolicy {
  return step.kind === "action"
    ? DESK_ACTION_REGISTRY[step.action].confirmation
    : DESK_COMMAND_REGISTRY[step.command].confirmation;
}

/** Why a step can't run: its task left the inbox while its sheet was open. */
function gone(
  state: DeskProductState,
  step: DeskFlowStep,
): string | undefined {
  if (step.kind !== "action") return undefined;
  if (rowRef(state, step.taskId)?.kind === "task") return undefined;
  return goneSentence(state.departed, step.taskId, state.trunk);
}

/** What moved since the review was read, while its task is still listed. */
function drift(
  state: DeskProductState,
  step: DeskFlowStep,
  review: DeskReview,
): string | undefined {
  if (step.kind !== "action") return undefined;
  const ref = rowRef(state, step.taskId);
  if (ref?.kind !== "task") return undefined;
  const head = trunkHead(state.data);
  return reviewDrift(review.expected, {
    row: ref.row,
    ...(head === undefined ? {} : { trunkHead: head }),
  });
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

/** The changes a landing lands: its totals, and its files once read. */
function changesContent(
  state: DeskProductState,
  changes: NonNullable<DeskReview["disclosures"]["changes"]>,
): ApplicationDetailBlock[] {
  const totals: ApplicationDetailBlock = {
    kind: "text",
    runs: [
      { text: `${plural(changes.files, "file")}  ` },
      ...diffRuns(changes.insertions, changes.deletions),
    ],
  };
  const ref = rowRef(state, changes.taskId);
  const files = ref?.kind === "task"
    ? cachedEvidence(
      state.evidence,
      evidenceKey(taskEvidenceSubject(ref.row, state.data, state.trunk)),
    )?.files
    : undefined;
  return [
    totals,
    files?.state === "ready"
      ? fileRows(files.value)
      : files?.state === "failed"
      ? { kind: "text", runs: [{ text: files.error, tone: "warning" }] }
      : { kind: "pending", label: "Reading changes…" },
  ];
}

/** The plan disclosure: the exact shared rendering, line for line. */
function planDisclosure(plan: EnginePlan): ApplicationDisclosure {
  return {
    id: "plan",
    label: `Technical plan · ${plural(plan.steps.length, "step")}`,
    hint: "Plan",
    openHint: "Hide plan",
    key: "d",
    fieldKey: "ctrl-t",
    // A code block wraps every line losslessly, so the plan reads exactly.
    content: [{
      kind: "block",
      content: createCliBlock(renderCodeBlockCli, {
        code: planLines(plan).join("\n"),
      }),
    }],
  };
}

/** The command disclosure: the exact CLI equivalent with its flags. */
function commandDisclosure(
  command: string,
  open: boolean,
): ApplicationDisclosure {
  return {
    id: "command",
    label: "Command",
    key: "c",
    fieldKey: "ctrl-x",
    content: [{ kind: "text", runs: [{ text: command, role: "code" }] }],
    ...(open ? { initiallyOpen: true } : {}),
  };
}

/** A review's disclosures: changes, the plan, and the command. */
function disclosures(
  state: DeskProductState,
  review: DeskReview | undefined,
): ApplicationDisclosure[] {
  if (review === undefined) return [];
  const { changes, plan, command, open } = review.disclosures;
  return [
    ...(changes === undefined ? [] : [{
      id: "changes",
      label: `Changes · ${plural(changes.files, "file")}`,
      hint: "Changes",
      key: "v",
      fieldKey: "ctrl-g",
      content: changesContent(state, changes),
    }]),
    ...(plan === undefined ? [] : [planDisclosure(plan)]),
    commandDisclosure(command, open === "command"),
  ];
}

/** The confirm or destructive button, disabled with its first blocker. */
function confirmButton(
  layer: string,
  label: string,
  review: DeskReview | undefined,
): ApplicationButton<DeskIntent> {
  const blocker = review?.blockers[0];
  const disabled = blocker === undefined
    ? {}
    : { enabled: false, disabledReason: blocker };
  return review?.destructive === true
    ? {
      id: "confirm",
      label,
      role: "destructive",
      action: { kind: "confirm", layer },
      ...(review.challenge === undefined ? {} : { requiresChallenge: true }),
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

/**
 * A review's alternative buttons, each one key away on the button row. A
 * key one of the sheet's disclosures already answers stays the
 * disclosure's: the button is still there, without a key.
 */
function alternativeButtons(
  layer: string,
  review: Pick<DeskReview, "alternatives"> | undefined,
  disclosed: readonly ApplicationDisclosure[],
): ApplicationButton<DeskIntent>[] {
  const taken = new Set(disclosed.map((disclosure) => disclosure.key));
  return (review?.alternatives ?? []).map((alternative) => ({
    id: alternative.id,
    label: alternative.label,
    role: "alternative" as const,
    action: { kind: "alternative" as const, layer, id: alternative.id },
    ...(alternative.key === undefined || taken.has(alternative.key)
      ? {}
      : { key: alternative.key }),
  }));
}

/** The sheet's lifecycle state and the banner that explains it. */
function sheetState(
  state: DeskProductState,
  step: DeskFlowStep,
  load: DeskLoad<DeskReview>,
): Pick<ApplicationSheet<DeskIntent>, "state" | "banner"> {
  const vanished = gone(state, step);
  if (vanished !== undefined) {
    return {
      state: "gone",
      banner: { tone: "warning", runs: [{ text: vanished }] },
    };
  }
  if (load.state === "loading") return { state: "loading" };
  if (load.state === "failed") {
    return {
      state: "failed",
      banner: { tone: "danger", runs: [{ text: load.error }] },
    };
  }
  const moved = drift(state, step, load.value);
  if (moved !== undefined) {
    return {
      state: "changed",
      banner: {
        tone: "warning",
        runs: [{
          text:
            `Changed since you opened this: ${moved} · ${REVIEW_AGAIN_KEY} to review again`,
        }],
      },
    };
  }
  return load.value.blockers.length === 0 ? { state: "ready" } : {
    state: "ready",
    banner: {
      tone: "warning",
      runs: [{ text: load.value.blockers.join(" · ") }],
    },
  };
}

/** One review sheet, from its loading state to what its flow read. */
export function reviewSheet(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "review" }>,
): ApplicationSheet<DeskIntent> {
  const id = layerId(layer);
  const review = layer.load.state === "ready" ? layer.load.value : undefined;
  const labels = policy(layer.step);
  const status = sheetState(state, layer.step, layer.load);
  const safeLabel = status.state === "gone" ? "Close" : review?.safeLabel ??
    (labels.kind === "none" ? "Close" : labels.noLabel);
  const confirmLabel = review === undefined
    ? (labels.kind === "none" || layer.load.state === "failed"
      ? undefined
      : labels.yesLabel)
    : review.confirmLabel;
  const disclosed = disclosures(state, review);
  const challenge = review?.challenge?.mustEqual;
  return {
    kind: "sheet",
    id,
    scope: layer.step.kind === "action" ? "item" : "global",
    title: review?.question ?? pendingTitle(state, layer.step),
    ...status,
    busy: CHECKING,
    body: review === undefined ? [] : reviewLineBlocks(review.lines),
    readHint: `to read before choosing ${confirmLabel ?? safeLabel}`,
    disclosures: disclosed,
    ...(challenge === undefined ? {} : {
      challenge: {
        fieldId: "challenge",
        label: [
          { text: "Type " },
          { text: challenge, role: "title" as const },
          {
            text: ` to ${(confirmLabel ?? "confirm").toLowerCase()} it`,
          },
        ],
        mustEqual: challenge,
      },
    }),
    footnote: [{
      text: review?.footnote ??
        untilChosen("changes", confirmLabel ?? safeLabel),
    }],
    buttons: [
      ...alternativeButtons(id, review, disclosed),
      { id: "safe", label: safeLabel, role: "safe" },
      ...(confirmLabel === undefined || status.state === "gone"
        ? []
        : [confirmButton(id, confirmLabel, review)]),
    ],
    ...(status.state === "changed"
      ? { hints: [{ key: REVIEW_AGAIN_KEY, label: "Review again" }] }
      : {}),
  };
}

/** A failed effect's result sheet: what stopped, what is unchanged, and
 * the task's next steps as it now stands. */
export function resultSheetView(
  state: DeskProductState,
  sheet: DeskResultSheet,
): ApplicationSheet<DeskIntent> {
  const id = "result";
  const disclosed: ApplicationDisclosure[] = [
    ...(sheet.output === undefined ? [] : [{
      id: "output",
      label: "Full output",
      key: "o",
      content: [{
        kind: "block" as const,
        content: createCliBlock(renderMarkdownCli, { source: sheet.output }),
      }],
    }]),
    commandDisclosure(sheet.command, false),
  ];
  return {
    kind: "sheet",
    id,
    scope: sheet.taskId === undefined ? "global" : "item",
    title: sheet.title,
    state: "ready",
    body: reviewLineBlocks(sheet.lines),
    requireFullRead: false,
    disclosures: disclosed,
    buttons: [
      { id: "safe", label: "Close", role: "safe" },
      ...alternativeButtons(
        id,
        { alternatives: resultAlternatives(state, sheet) },
        disclosed,
      ),
    ],
  };
}

/** The key that reads a running operation's output. */
export const FULL_OUTPUT_KEY = "o";

/**
 * A running operation's progress sheet: the plan its review showed, each
 * step marked as the executor reports it, its running time against the
 * usual, and what lands after it. Escape hides it while the operation runs
 * on; Stop appears only while stopping leaves nothing half done.
 */
export function progressSheet(
  state: DeskProductState,
  operationId: string,
): ApplicationSheet<DeskIntent> {
  const operation = state.operations.get(operationId);
  if (operation === undefined) {
    return {
      kind: "sheet",
      id: "progress",
      scope: "global",
      title: "It has ended",
      state: "ready",
      body: [],
      buttons: [{ id: "safe", label: "Close", role: "safe" }],
    };
  }
  const ref = operation.taskId === undefined
    ? undefined
    : rowRef(state, operation.taskId);
  const typical = ref?.kind === "task"
    ? ref.row.entry.running?.typical_duration_ms
    : undefined;
  const stoppable = operation.stopping !== true &&
    canStop(stopPolicy(operation.step), operation.progress);
  return {
    kind: "sheet",
    id: "progress",
    scope: operation.taskId === undefined ? "global" : "item",
    title: operation.title,
    state: "working",
    body: [],
    requireFullRead: false,
    activity: {
      ...progressActivity(operation.progress),
      ...(typical === undefined || typical <= 0 ? {} : {
        typicalMs: typical,
        typicalLabel: `usually about ${compactDuration(typical)}`,
      }),
    },
    ...(operation.stopping === true
      ? {
        banner: {
          tone: "warning" as const,
          runs: [{ text: "Stopping · its journal records where it stops" }],
        },
      }
      : {}),
    disclosures: [
      ...(operation.plan === undefined ? [] : [planDisclosure(operation.plan)]),
      commandDisclosure(operation.command, false),
    ],
    buttons: [
      { id: "safe", label: "Hide", role: "safe" },
      ...(stoppable
        ? [{
          id: "stop",
          label: "Stop",
          role: "destructive" as const,
          action: { kind: "stop" as const },
        }]
        : []),
    ],
    buttonRow: stoppable,
    hints: [{ key: FULL_OUTPUT_KEY, label: "Full output" }],
  };
}

/**
 * Leaving while operations run: each stops through its journal, which
 * recovery reads, so the sheet says so first and keeps waiting by default;
 * like every sheet that confirms, Quit anyway waits until the owner has read
 * it all. When the last one ends while the sheet is open, the sheet says
 * nothing runs now and offers a plain Quit.
 */
export function quitSheet(
  state: DeskProductState,
): ApplicationSheet<DeskIntent> {
  const running = [...state.operations.values()];
  if (running.length === 0) {
    return {
      kind: "sheet",
      id: "quit",
      scope: "global",
      title: "Nothing is running now",
      state: "ready",
      body: [{
        kind: "marks",
        items: [{
          mark: glyph(DESK_GLYPHS.done, "success"),
          runs: [{
            text: "What was running has ended; quitting stops nothing",
          }],
        }],
      }],
      buttons: [
        { id: "safe", label: "Keep working", role: "safe" },
        {
          id: "quit",
          label: "Quit",
          role: "confirm",
          action: { kind: "quit-anyway" },
        },
      ],
    };
  }
  const one = running.length === 1;
  return {
    kind: "sheet",
    id: "quit",
    scope: "global",
    title: one
      ? "Quit while this runs?"
      : `Quit while ${running.length} operations run?`,
    state: "ready",
    readHint: "to read before choosing Quit anyway",
    body: [{
      kind: "marks",
      items: [
        {
          mark: glyph(DESK_GLYPHS.changes, "muted"),
          runs: [{
            text: one
              ? "Quitting stops it; its journal records where it stopped, and recovery picks it up"
              : "Quitting stops each one; its journal records where it stopped, and recovery picks it up",
          }],
        },
        ...running.map((operation): ApplicationDetailMark => ({
          mark: glyph(DESK_GLYPHS.running, "accent"),
          runs: [{ text: operation.title }],
        })),
      ],
    }],
    buttons: [
      { id: "safe", label: "Keep waiting", role: "safe" },
      {
        id: "quit",
        label: "Quit anyway",
        role: "destructive",
        action: { kind: "quit-anyway" },
      },
    ],
  };
}

/** A form's confirm button, disabled with the first reason it can't run. */
function formConfirm(
  layer: string,
  label: string,
  open: string | undefined,
  role: "confirm" | "alternative",
  ...reasons: readonly (string | undefined)[]
): ApplicationButton<DeskIntent> {
  const reason = reasons.find((candidate) => candidate !== undefined);
  const action: DeskIntent = {
    kind: "confirm",
    layer,
    ...(open === undefined ? {} : { open }),
  };
  return {
    id: open === undefined ? "confirm" : "confirm-open",
    label,
    role,
    action,
    ...(reason === undefined ? {} : { enabled: false, disabledReason: reason }),
  };
}

/** Why a form's preview can't be confirmed yet, if it can't. */
function previewReason(
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
): string | undefined {
  if (layer.load.state === "loading") return CHECKING;
  if (layer.load.state === "failed") return layer.load.error;
  return layer.load.value.blockers[0];
}

/** A form's preview: its review's lines, or why there are none yet. */
function previewBlocks(
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
): ApplicationDetailBlock[] {
  switch (layer.load.state) {
    case "loading":
      return [{ kind: "pending", label: CHECKING }];
    case "failed":
      return [{
        kind: "text",
        runs: [{ text: layer.load.error, tone: "warning" }],
      }];
    case "ready":
      return [
        ...reviewLineBlocks(layer.load.value.lines),
        ...layer.load.value.blockers.map((blocker): ApplicationDetailBlock => ({
          kind: "text",
          runs: [{ text: blocker, tone: "warning" }],
        })),
      ];
  }
}

/** A form's disclosures: the plan and command of its current preview. */
function formDisclosures(
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
): ApplicationDisclosure[] {
  if (layer.load.state !== "ready") {
    return [commandDisclosure("Checking…", false)];
  }
  const { plan, command } = layer.load.value.disclosures;
  return [
    ...(plan === undefined ? [] : [planDisclosure(plan)]),
    commandDisclosure(command, false),
  ];
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
    launch.id === (values.agent ?? remembered?.id ?? "none") &&
    launch.availability !== "disabled"
  );
  const bases = [
    state.trunk,
    ...state.rows.flatMap((row) =>
      row.entry.branch === "" ? [] : [row.entry.branch]
    ),
    ...parkedBranches(state.data),
  ];
  const brief = values.brief ?? parked?.task.brief ?? "";
  const branch = layer.load.state === "ready"
    ? layer.load.value.expected.facts["branch-name"]
    : undefined;
  const fields: ApplicationFormField<DeskIntent>[] = [
    {
      kind: "text",
      id: "title",
      label: "Title",
      initial: parked?.task.title ?? "",
      hint: branch === undefined
        ? [{ text: "Leave it empty for a generated codename", tone: "faint" }]
        : [{ text: "Branch ", tone: "faint" }, { text: branch }],
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
            options: [...new Set(bases)].map((choice) => ({
              id: choice,
              label: choice === state.trunk
                ? choice
                : branchTitle(choice, state.data),
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
            ...launches.filter((launch) => launch.kind === "open").map((
              launch,
            ) => ({
              id: launch.id,
              label: launch.providerLabel,
              ...(launch.availability === "disabled"
                ? { disabledReason: launch.reason ?? "Unavailable" }
                : {}),
            })),
          ],
        },
      ],
    },
  ];
  const vanished = gone(state, step);
  const reason = previewReason(layer);
  return {
    kind: "form",
    id,
    scope: step.kind === "action" ? "item" : "global",
    title: step.kind === "action"
      ? labelName(DESK_ACTION_LABELS.follow_up)
      : step.command === "resume"
      ? `Resume ${branchTitle(step.ref ?? "", state.data)}`
      : labelName(DESK_COMMAND_LABELS.new_task),
    aside: [{ text: `from ${base}`, tone: "faint" }],
    fields,
    preview: [{
      kind: "section",
      title: "This will",
      blocks: previewBlocks(layer),
    }],
    disclosures: formDisclosures(layer),
    footnote: [{ text: untilChosen("is created", "Create") }],
    buttons: [
      { id: "safe", label: "Cancel", role: "safe" },
      formConfirm(id, "Create", undefined, "confirm", vanished, reason),
      ...(agent === undefined ? [] : [
        formConfirm(
          id,
          `Create and open ${agent.providerLabel}`,
          agent.id,
          "alternative",
          vanished,
          reason,
        ),
      ]),
    ],
  };
}

/** What a one-field form asks; the rest follows from its layer. */
interface DeskFieldForm {
  readonly scope: ApplicationForm<DeskIntent>["scope"];
  readonly title: string;
  readonly aside?: ApplicationForm<DeskIntent>["aside"];
  readonly field: ApplicationForm<DeskIntent>["fields"][number];
  readonly safeLabel: string;
  readonly confirmLabel: string;
  /** What stays unchanged until the confirm, for the footnote. */
  readonly nothing: string;
}

/** A form with one field whose live preview is the step's review. */
function fieldForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
  ask: (ref: DeskRowRef | undefined) => DeskFieldForm,
): ApplicationForm<DeskIntent> {
  const id = layerId(layer);
  const step = layer.step;
  const form = ask(
    step.kind === "action" ? rowRef(state, step.taskId) : undefined,
  );
  return {
    kind: "form",
    id,
    scope: form.scope,
    title: form.title,
    ...(form.aside === undefined ? {} : { aside: form.aside }),
    fields: [form.field],
    preview: previewBlocks(layer),
    disclosures: formDisclosures(layer),
    footnote: [{ text: untilChosen(form.nothing, form.confirmLabel) }],
    buttons: [
      { id: "safe", label: form.safeLabel, role: "safe" },
      formConfirm(
        id,
        form.confirmLabel,
        undefined,
        "confirm",
        gone(state, step),
        previewReason(layer),
      ),
    ],
  };
}

/** A rename's form: the title, prefilled, and what renaming changes. */
function renameForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
): ApplicationForm<DeskIntent> {
  // The field starts from the task's title as the form opened; the values the
  // package reports never feed back into it.
  return fieldForm(state, layer, (ref) => ({
    scope: "item",
    title: ref?.kind === "task"
      ? `Rename ${ref.row.task.name}?`
      : labelName(DESK_ACTION_LABELS.rename),
    field: {
      kind: "text",
      id: "title",
      label: "Title",
      initial: ref?.kind === "task"
        ? renameTitle(ref.row)
        : layer.values.title ?? "",
      required: true,
    },
    safeLabel: "Keep",
    confirmLabel: "Rename",
    nothing: "changes",
  }));
}

/** A script's arguments, with what will run. */
function scriptForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
): ApplicationForm<DeskIntent> {
  const name = layer.values.script ?? layer.step.values?.script ?? "";
  return fieldForm(state, layer, (ref) => ({
    scope: layer.step.kind === "action" ? "item" : "global",
    title: layer.load.state === "ready"
      ? layer.load.value.question
      : `Run ${name}?`,
    aside: [{
      text: ref?.kind === "task" ? ref.row.task.name : "main checkout",
      tone: "faint",
    }],
    field: {
      kind: "text",
      id: "args",
      label: "Arguments",
      initial: "",
      hint: [{
        text: "Quote spaces; nothing is expanded by a shell.",
        tone: "faint",
      }],
    },
    safeLabel: "Cancel",
    confirmLabel: "Run",
    nothing: "runs",
  }));
}

/** One form layer. */
export function deskForm(
  state: DeskProductState,
  layer: Extract<DeskLayer, { readonly kind: "form" }>,
  env: DeskSheetEnv,
): ApplicationForm<DeskIntent> {
  const step = layer.step;
  if (step.kind === "action" && step.action === "rename") {
    return renameForm(state, layer);
  }
  if (
    (step.kind === "action" && step.action === "scripts") ||
    (step.kind === "command" && step.command === "main_scripts")
  ) return scriptForm(state, layer);
  return startForm(state, layer, env);
}
