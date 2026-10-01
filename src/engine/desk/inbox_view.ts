/**
 * The inbox: the Desk's one application view.
 *
 * A header with the project, its chips, how many tasks need the owner, and
 * how fresh the observation is; one grouped list ordered by who moves next,
 * with a following inspector; a message line; and a footer whose left half
 * is the selected row's next step and keyed alternatives. Layers come from
 * their own views. Pure: `deskView` reads product state, the package's
 * read-only state, and the clock, and returns an immutable view.
 */

import type {
  ApplicationDetailBlock,
  ApplicationDetailStrip,
  ApplicationKeyBinding,
  ApplicationList,
  ApplicationListGroup,
  ApplicationListItem,
  ApplicationMessage,
  ApplicationRun,
  TerminalApplicationView,
} from "discern-design-system/cli/interactive";
import type { KeyHint } from "discern-design-system/cli";
import type { StatusData } from "../../shared/result_schemas.ts";
import type { DeskPreferences } from "./preferences.ts";
import { DESK_COMMAND_LABELS } from "../../shared/desk_vocabulary.ts";
import {
  FLEET_BRANCH_GROUPS,
  FLEET_ROW_DECISIONS,
  type FleetRowGroup,
} from "../../shared/fleet_row_vocabulary.ts";
import {
  FLEET_ROW_GROUP_TITLES,
  FLEET_ROW_STATES,
} from "../status/row_states.ts";
import { compareTaskTitles } from "../status/fleet_rows.ts";
import { positiveCount } from "../status/row_facts.ts";
import { type DeskRow, deskRowId } from "./model.ts";
import { DESK_COMMAND_REGISTRY } from "./commands.ts";
import { DESK_KEYS, PACKAGE_RESERVED_KEYS } from "./keys.ts";
import { DESK_GLYPHS } from "./glyphs.ts";
import type {
  DeskIntent,
  DeskMessage,
  DeskProductState,
  DeskUi,
} from "./desk_state.ts";
import {
  branchTitle,
  DESK_LIST_ID,
  DESK_TOAST_MS,
  landedRowId,
  parkedBranches,
  parkedRowId,
  reviewLayerIds,
  rowRef,
  taskOperation,
} from "./desk_transitions.ts";
import {
  ageText,
  type DeskInspection,
  elapsedLabel,
  isRunning,
  landedBlocks,
  parkedBlocks,
  parkedStrip,
  runningElapsed,
  stateGlyph,
  taskBlocks,
  taskStrip,
  tone,
} from "./inspector_view.ts";
import { DESK_OFFLINE_FAILURES } from "./desk_state.ts";
import {
  branchEvidenceSubject,
  cachedEvidence,
  evidenceKey,
  taskEvidenceSubject,
} from "./evidence.ts";
import { type DeskLayerEnv, deskLayers } from "./layer_view.ts";
import { FULL_OUTPUT_KEY, REVIEW_AGAIN_KEY } from "./sheet_view.ts";
import { codeRuns, deskChips } from "./header_view.ts";
import { inertView } from "./text.ts";

/** What the view reads besides product and package state. */
export interface DeskViewEnv extends DeskLayerEnv {
  /** The main checkout. */
  readonly root: string;
}

/** How long a refresh runs before the header says so. */
const BUSY_AFTER_MS = 1_500;

/** The group shown in title order when the owner sorts by title. */
const TITLE_GROUP = { id: "tasks", title: "Tasks" } as const;

/** Short group names for the summary row on short terminals. */
const SHORT_TITLES: Partial<Record<FleetRowGroup, string>> = {
  review: "Review",
  attention: "Attention",
  approved: "Approved",
};

/** Whether surveys are failing enough that running rows stop counting. */
function frozen(state: DeskProductState): boolean {
  return state.survey.failures >= DESK_OFFLINE_FAILURES;
}

/** The detail builder's inputs for one view. */
function inspection(
  state: DeskProductState,
  env: DeskViewEnv,
): Omit<DeskInspection, "evidence"> {
  return {
    rows: state.rows,
    ...(state.data === undefined ? {} : { data: state.data }),
    trunk: state.trunk,
    now: env.now,
    ...(state.survey.observedAt === undefined
      ? {}
      : { observedAt: state.survey.observedAt }),
    frozen: frozen(state),
  };
}

/** Rows that need the owner: Ready for review and Needs attention. */
export function needYouCount(state: DeskProductState): number {
  return state.rows.filter((row) =>
    row.decision.group === "review" || row.decision.group === "attention"
  ).length;
}

/** The label cell: the state's word, then its behind count or running meter. */
function labelCell(
  row: DeskRow,
  state: DeskProductState,
  env: DeskViewEnv,
): ApplicationRun[] {
  const runs: ApplicationRun[] = [{
    text: row.decision.label,
    tone: tone(row.decision.tones.label),
  }];
  const behind = positiveCount(row.entry.behind);
  if (
    behind !== undefined &&
    ["ready", "stale", "stale-proven", "behind"].includes(row.decision.state)
  ) {
    runs.push({ text: " " }, { text: `↓${behind}`, ascii: "", tone: "faint" });
  }
  const typical = row.entry.running?.typical_duration_ms;
  const elapsed = runningElapsed(row, {
    now: env.now,
    frozen: frozen(state),
    ...(state.survey.observedAt === undefined
      ? {}
      : { observedAt: state.survey.observedAt }),
  });
  if (typical !== undefined && typical > 0 && elapsed !== undefined) {
    const filled = Math.min(4, Math.round((elapsed / typical) * 4));
    runs.push(
      { text: " " },
      {
        text: DESK_GLYPHS.meterFill.unicode.repeat(filled),
        ascii: "",
        tone: "accent",
      },
      {
        text: DESK_GLYPHS.meterTrack.unicode.repeat(4 - filled),
        ascii: "",
        tone: "faint",
      },
    );
  }
  return runs;
}

/** The age cell: activity, or a running verb's elapsed time. */
function ageCell(
  row: DeskRow,
  state: DeskProductState,
  env: DeskViewEnv,
): ApplicationRun[] {
  const elapsed = runningElapsed(row, {
    now: env.now,
    frozen: frozen(state),
    ...(state.survey.observedAt === undefined
      ? {}
      : { observedAt: state.survey.observedAt }),
  });
  if (elapsed !== undefined) {
    return [{
      text: elapsedLabel(elapsed, frozen(state)),
      tone: frozen(state) ? "faint" : "muted",
    }];
  }
  return [{
    text: ageText(row.entry.last_activity, env.now),
    tone: "faint",
  }];
}

/** One task row. */
function taskItem(
  row: DeskRow,
  state: DeskProductState,
  env: DeskViewEnv,
  duplicate: boolean,
): ApplicationListItem<DeskIntent> {
  const id = deskRowId(row);
  return {
    id,
    title: row.task.name,
    ...(duplicate ? { titleSuffix: ` · ${row.task.disambiguator ?? id}` } : {}),
    marker: stateGlyph(row, frozen(state)),
    cells: {
      ...(row.decision.collisions.some((collision) =>
          collision.kind === "changed_files"
        )
        ? {
          flag: [{
            text: DESK_GLYPHS.overlap.unicode,
            ascii: DESK_GLYPHS.overlap.ascii,
            tone: "faint" as const,
          }],
        }
        : {}),
      label: labelCell(row, state, env),
      age: ageCell(row, state, env),
    },
    primary: { kind: "next", id },
    keywords: `${row.entry.branch} ${row.decision.label}`,
  };
}

/** Rows of a branch without a checkout. */
function parkedItems(
  data: StatusData | undefined,
  env: DeskViewEnv,
): ApplicationListItem<DeskIntent>[] {
  const look = FLEET_ROW_STATES.parked;
  return parkedBranches(data).map((branch) => {
    const parked = data?.parked_tasks?.find((task) => task.branch === branch);
    const id = parkedRowId(branch);
    return {
      id,
      title: branchTitle(branch, data),
      marker: {
        unicode: look.glyph,
        ascii: look.ascii,
        tone: tone(look.glyphTone),
      },
      cells: {
        label: [{ text: look.label, tone: tone(look.labelTone) }],
        age: [{
          text: parked === undefined ? "" : ageText(parked.parked_at, env.now),
          tone: "faint",
        }],
      },
      primary: { kind: "next", id },
      keywords: `${branch} ${look.label}`,
    };
  });
}

/** Rows of recent landings. */
function landedItems(
  data: StatusData | undefined,
  env: DeskViewEnv,
): ApplicationListItem<DeskIntent>[] {
  const look = FLEET_ROW_STATES.landed;
  return (data?.recent_completed_tasks ?? []).map((task) => {
    const id = landedRowId(task.branch, task.completed_at);
    return {
      id,
      title: branchTitle(task.branch, data),
      marker: {
        unicode: look.glyph,
        ascii: look.ascii,
        tone: tone(look.glyphTone),
      },
      cells: {
        label: [{ text: look.label, tone: tone(look.labelTone) }],
        age: [{ text: ageText(task.completed_at, env.now), tone: "faint" }],
      },
      primary: { kind: "next", id },
      keywords: `${task.branch} ${look.label}`,
    };
  });
}

/** The groups a session starts folded: the owner's remembered folds, else
 * the branch groups. */
export function foldedGroups(preferences: DeskPreferences): readonly string[] {
  return preferences.folded_groups ?? FLEET_BRANCH_GROUPS;
}

/** Whether a group starts folded. */
function initiallyFolded(state: DeskProductState, group: string): boolean {
  return foldedGroups(state.preferences).includes(group);
}

/** The inbox list: decision groups (or one title-ordered group), then branches. */
function inboxList(
  state: DeskProductState,
  env: DeskViewEnv,
): ApplicationList<DeskIntent> {
  const names = state.rows.map((row) => row.task.name);
  const items = (rows: readonly DeskRow[]) =>
    rows.map((row) =>
      taskItem(
        row,
        state,
        env,
        names.indexOf(row.task.name) !== names.lastIndexOf(row.task.name),
      )
    );
  const taskGroups: ApplicationListGroup<DeskIntent>[] =
    state.preferences.sort === "title"
      ? [{
        ...TITLE_GROUP,
        items: items(
          [...state.rows].sort((left, right) =>
            compareTaskTitles(left.task.name, right.task.name)
          ),
        ),
      }]
      : FLEET_ROW_DECISIONS.map((group) => ({
        id: group,
        title: FLEET_ROW_GROUP_TITLES[group],
        ...(SHORT_TITLES[group] === undefined
          ? {}
          : { shortTitle: SHORT_TITLES[group] }),
        items: items(state.rows.filter((row) => row.decision.group === group)),
      }));
  const branchGroups: ApplicationListGroup<DeskIntent>[] = [
    {
      id: "parked",
      title: FLEET_ROW_GROUP_TITLES.parked,
      foldable: true,
      initiallyFolded: initiallyFolded(state, "parked"),
      ...(state.data?.parked_tasks_unavailable === undefined
        ? {}
        : { aside: [{ text: "titles unavailable", tone: "faint" as const }] }),
      items: parkedItems(state.data, env),
    },
    {
      id: "landed",
      title: FLEET_ROW_GROUP_TITLES.landed,
      foldable: true,
      initiallyFolded: initiallyFolded(state, "landed"),
      items: landedItems(state.data, env),
    },
  ];
  const groups = [...taskGroups, ...branchGroups];
  return {
    id: DESK_LIST_ID,
    groups,
    columns: [
      { id: "flag", width: 1, priority: 1 },
      { id: "label", width: 13, align: "end" },
      { id: "age", width: 4, align: "end", priority: 2 },
    ],
    filter: { label: "Filter" },
    density: {
      foldOrder: ["landed", "parked", "idle", "approved", "working"],
      neverFold: ["review", "attention", TITLE_GROUP.id],
    },
  };
}

/** Each row's detail blocks and strip. */
function details(
  state: DeskProductState,
  env: DeskViewEnv,
): {
  content: Record<string, readonly ApplicationDetailBlock[]>;
  strip: Record<string, ApplicationDetailStrip>;
} {
  const base = inspection(state, env);
  const content: Record<string, readonly ApplicationDetailBlock[]> = {};
  const strip: Record<string, ApplicationDetailStrip> = {};
  for (const row of state.rows) {
    const id = deskRowId(row);
    const evidence = cachedEvidence(
      state.evidence,
      evidenceKey(taskEvidenceSubject(row, state.data, state.trunk)),
    );
    const read = { ...base, ...(evidence === undefined ? {} : { evidence }) };
    content[id] = taskBlocks(row, read);
    strip[id] = taskStrip(row, read);
  }
  for (const branch of parkedBranches(state.data)) {
    const id = parkedRowId(branch);
    const title = branchTitle(branch, state.data);
    const evidence = cachedEvidence(
      state.evidence,
      evidenceKey(
        branchEvidenceSubject(branch, env.root, state.data, state.trunk),
      ),
    );
    content[id] = parkedBlocks(branch, title, {
      ...base,
      ...(evidence === undefined ? {} : { evidence }),
    });
    strip[id] = parkedStrip(branch, title);
  }
  for (const task of state.data?.recent_completed_tasks ?? []) {
    const id = landedRowId(task.branch, task.completed_at);
    content[id] = landedBlocks(
      task,
      branchTitle(task.branch, state.data),
      base,
    );
  }
  return { content, strip };
}

/** The header's liveness: Live, Refreshing, Retrying, or Offline. */
function liveness(
  state: DeskProductState,
): "idle" | "busy" | "retrying" | "stale" {
  if (state.survey.failures >= DESK_OFFLINE_FAILURES) return "stale";
  if (state.survey.failures > 0) return "retrying";
  return state.survey.inFlight ? "busy" : "idle";
}

/** The message row: a toast, the tip, or a persistent warning. */
function messageLine(
  message: DeskMessage | undefined,
): ApplicationMessage | undefined {
  if (message === undefined) return undefined;
  const runs: ApplicationRun[] = [
    ...(message.mark === undefined ? [] : [{
      text: `${message.mark.unicode}  `,
      ascii: `${message.mark.ascii}  `,
      tone: message.tone === "muted" ? "faint" as const : message.tone,
    }]),
    ...(message.tip === true
      ? [
        { text: "Tip", tone: "faint" as const },
        { text: "   " },
        ...codeRuns(message.text),
      ]
      : [{ text: message.text }]),
  ];
  return {
    id: message.id,
    tone: message.tone === "accent" ? "muted" : message.tone,
    runs,
    ...(message.key === undefined ? {} : {
      trailing: [
        { text: message.key.key, role: "key" as const },
        { text: ` ${message.key.label}`, tone: "muted" as const },
      ],
    }),
    ...(message.persistent === true ? {} : {
      dismiss: message.tip === true
        ? { onKey: true }
        : { afterMs: DESK_TOAST_MS, onKey: true },
    }),
  };
}

/** The selected row's own hints: its next step, then its keyed alternatives. */
function rowHints(state: DeskProductState, ui: DeskUi): KeyHint[] {
  const ref = rowRef(state, ui.selected);
  if (ref === undefined) return [];
  if (ref.kind === "parked") {
    return [
      { key: "enter", label: DESK_COMMAND_LABELS.resume },
      { key: "v", label: DESK_COMMAND_LABELS.branch_commits },
    ];
  }
  if (ref.kind === "landed") {
    return [{ key: "enter", label: DESK_COMMAND_LABELS.landed_proof }];
  }
  const { decision } = ref.row;
  const running = taskOperation(state, deskRowId(ref.row)) !== undefined;
  return [
    ...(running
      ? [{ key: "enter", label: DESK_COMMAND_LABELS.progress }]
      : decision.next?.availability === "enabled"
      ? [{ key: "enter", label: decision.next.label }]
      : []),
    ...decision.also.flatMap((offer) =>
      offer.key === undefined ? [] : [{ key: offer.key, label: offer.label }]
    ),
  ];
}

/** The label a gesture key carries in the inbox key map. */
function gestureLabel(key: string): string {
  const binding = DESK_KEYS.inbox.find((candidate) => candidate.key === key);
  return binding?.meaning.kind === "gesture" ? binding.meaning.label : key;
}

/**
 * The inbox footer: the row's hints left, the pinned routes right. Filter is
 * offered only while a list is on screen to filter.
 */
function footer(
  state: DeskProductState,
  ui: DeskUi,
  shown: TerminalApplicationView<DeskIntent>["body"],
): TerminalApplicationView<DeskIntent>["footer"] {
  const ref = rowRef(state, ui.selected);
  const actions = ref?.kind === "task" || ref?.kind === "parked";
  const filterable = shown.kind !== "empty" || shown.list !== undefined;
  return {
    left: rowHints(state, ui),
    right: [
      ...(actions ? [{ key: ".", label: gestureLabel(".") }] : []),
      { key: "ctrl-k", label: gestureLabel("ctrl-k") },
    ],
    extra: [
      { key: "?", label: DESK_COMMAND_REGISTRY.keys.short },
      ...(filterable ? [{ key: "/", label: gestureLabel("/") }] : []),
      { key: "n", label: DESK_COMMAND_LABELS.new_task },
      { key: "q", label: DESK_COMMAND_LABELS.quit },
    ],
  };
}

/** The base-layer bindings: every key the inbox key maps give a meaning that
 * the package does not already own. Static, so it is built once. */
export function deskKeymap(): ApplicationKeyBinding<DeskIntent>[] {
  const reserved: readonly string[] = PACKAGE_RESERVED_KEYS;
  const keys = new Set<string>();
  for (const layer of ["inbox", "branch", "landed"] as const) {
    for (const binding of DESK_KEYS[layer]) {
      if (!reserved.includes(binding.key)) keys.add(binding.key);
    }
  }
  return [
    ...[...keys].map((key): ApplicationKeyBinding<DeskIntent> => ({
      key,
      action: { kind: "key", key },
    })),
    // A review whose subject changed reads again on its own key.
    ...reviewLayerIds().map((layer): ApplicationKeyBinding<DeskIntent> => ({
      key: REVIEW_AGAIN_KEY,
      action: { kind: "review-again", layer },
      scope: { layer },
    })),
    // A running operation's progress reads its output on its own key.
    {
      key: FULL_OUTPUT_KEY,
      action: { kind: "output" },
      scope: { layer: "progress" },
    },
  ];
}

/** The whole view for one moment. */
export function deskView(
  state: DeskProductState,
  ui: DeskUi,
  env: DeskViewEnv,
): TerminalApplicationView<DeskIntent> {
  const project = state.data?.project ?? env.root.split("/").at(-1) ??
    "discern";
  const needYou = needYouCount(state);
  const message = messageLine(state.message ?? state.warning);
  const layers = deskLayers(state, env);
  const shown = body(state, env);
  const view: TerminalApplicationView<DeskIntent> = {
    header: {
      leading: [
        { text: `${DESK_GLYPHS.brand.unicode} `, ascii: "", tone: "accent" },
        { text: project, role: "title" },
        { text: "  ·  ", ascii: " - ", tone: "faint" },
        { text: state.trunk, tone: "muted" },
      ],
      chips: deskChips(state.data),
      ...(needYou === 0 ? {} : {
        trailing: [
          { text: String(needYou), role: "title" as const },
          { text: " need you", tone: "muted" as const },
        ],
      }),
      liveness: {
        state: liveness(state),
        labels: {
          idle: "Live",
          busy: "Refreshing",
          retrying: "Retrying",
          stale: "Offline",
        },
        busyAfterMs: BUSY_AFTER_MS,
      },
    },
    body: shown,
    ...(message === undefined ? {} : { message }),
    footer: footer(state, ui, shown),
    ...(layers.length === 0 ? {} : { layers }),
    windowTitle: needYou === 0 ? project : `${project} · ${needYou} need you`,
    ...(state.preferences.mouse === true ? { input: { mouse: true } } : {}),
    tooSmallHints: [{ key: "q", label: DESK_COMMAND_LABELS.quit }],
    ...(state.data === undefined
      ? {
        copy: {
          noItems: state.survey.failures > 0
            ? "Couldn't read tasks"
            : "Loading tasks…",
        },
      }
      : {}),
  };
  // Observed text reaches the view in many slots; one pass keeps every
  // single-line slot free of line breaks and control characters.
  inertView(view);
  return view;
}

/** The body: the inbox, the empty state, or the list alone. */
function body(
  state: DeskProductState,
  env: DeskViewEnv,
): TerminalApplicationView<DeskIntent>["body"] {
  const list = inboxList(state, env);
  if (state.data !== undefined && state.rows.length === 0) {
    const branches = list.groups.filter((group) =>
      group.id === "parked" || group.id === "landed"
    );
    const hasBranches = branches.some((group) => group.items.length > 0);
    return {
      kind: "empty",
      title: "No tasks yet",
      body: [
        {
          text:
            `A task is its own checkout and branch for one change. Hand it to an agent; land it on ${state.trunk} once its checks pass.`,
        },
      ],
      primary: {
        key: "enter",
        label: DESK_COMMAND_LABELS.new_task,
        action: { kind: "command", command: "new_task" },
      },
      secondary: [{ key: "ctrl-k", label: gestureLabel("ctrl-k") }],
      ...(hasBranches ? { list: { ...list, groups: branches } } : {}),
    };
  }
  if (state.preferences.details === "hidden" || state.data === undefined) {
    return { kind: "list", list };
  }
  const { content, strip } = details(state, env);
  return {
    kind: "master-detail",
    list,
    detail: { follows: DESK_LIST_ID, content, strip, pending: "Reading…" },
  };
}

/** Whether any visible row's time moves by the clock alone. */
export function deskTicks(state: DeskProductState): boolean {
  return !frozen(state) && state.rows.some((row) => isRunning(row));
}
