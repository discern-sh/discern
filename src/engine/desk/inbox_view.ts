/**
 * The inbox: the Desk's one application view.
 *
 * A header with the project, its chips, how many tasks need the owner, and
 * how fresh the observation is; one grouped list led by the Commands row,
 * then the tasks ordered by who moves next, with a following inspector that
 * is the home panel while the Commands row is selected; a message line; and
 * a footer whose left half is the selected row's next step and keyed
 * alternatives. Layers come from their own views. Pure: `deskView` reads
 * product state, the package's read-only state, and the clock, and returns
 * an immutable view.
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
  waitsForOwner,
} from "../../shared/fleet_row_vocabulary.ts";
import {
  FLEET_ROW_GROUP_TITLES,
  FLEET_ROW_STATES,
} from "../status/row_states.ts";
import { compareTaskTitles } from "../status/fleet_rows.ts";
import { positiveCount } from "../status/row_facts.ts";
import { type DeskRow, deskRowId } from "./model.ts";
import { DESK_COMMAND_REGISTRY } from "./commands.ts";
import {
  COMMANDS_LABEL,
  DESK_KEYS,
  DESK_ROW_LAYERS,
  PACKAGE_RESERVED_KEYS,
  ZOOM_HINT_LABELS,
} from "./keys.ts";
import { DESK_GLYPHS } from "./glyphs.ts";
import type {
  DeskIntent,
  DeskMessage,
  DeskProductState,
  DeskUi,
} from "./desk_state.ts";
import {
  branchTitle,
  COMMANDS_ROW_ID,
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
  taskEvidenceSubject,
} from "./evidence.ts";
import { type DeskLayerEnv, deskLayers } from "./layer_view.ts";
import { FULL_OUTPUT_KEY, REVIEW_AGAIN_KEY } from "./sheet_view.ts";
import { deskChips } from "./header_view.ts";
import {
  COMMANDS_GROUP_ID,
  commandsGroup,
  homeBlocks,
  homeStrip,
  noTasks,
} from "./home_view.ts";
import { inertView } from "./text.ts";

/** What the view reads besides product and package state. */
export interface DeskViewEnv extends DeskLayerEnv {
  /** The main checkout. */
  readonly root: string;
  /** The running discern version, which the home panel names. */
  readonly version: string;
  /**
   * The application's clock as the view is built. A running time counts
   * on from it as a clock the package paints; without it, it shows as
   * words.
   */
  readonly clock?: number;
}

/**
 * Where the age column stops showing a running time as a clock. From ten
 * minutes it reads `12m`, since a clock's `10:00` would outgrow its four
 * cells; stopping one tick short turns the cell to words before a clock
 * painted between rebuilds could reach `10:00`.
 */
const CLOCK_SHOWN_BELOW_MS = 600_000 - 1_000;

/** How often running times count on while no running task is selected. */
const DESK_TICK_MS = 1_000;

/** How long a refresh runs before the header says so. */
const BUSY_AFTER_MS = 1_500;

/** The group shown in title order when the owner sorts by title. */
const TITLE_GROUP = { id: "tasks", title: "Tasks" } as const;

/** What a branch group holds, said beside its fold while there are no tasks. */
const BRANCH_GROUP_GLOSS: Readonly<Record<string, string>> = {
  parked: "branches without a checkout",
  landed: "landed recently",
};

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
    root: env.root,
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
  return state.rows.filter((row) => waitsForOwner(row.decision.group)).length;
}

/** Cells a four-cell meter fills for `elapsed` of a `typical` run. */
export function meterCells(elapsed: number, typical: number): number {
  return Math.min(4, Math.floor((elapsed / typical) * 4));
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
  const elapsed = runningElapsed(row, inspection(state, env));
  if (typical !== undefined && typical > 0 && elapsed !== undefined) {
    // Full only once the usual time has passed; faint once surveys stop
    // and the time it shows is frozen.
    const filled = meterCells(elapsed, typical);
    runs.push(
      { text: " " },
      {
        text: DESK_GLYPHS.meterFill.unicode.repeat(filled),
        ascii: "",
        tone: frozen(state) ? "faint" : "accent",
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
  const elapsed = runningElapsed(row, inspection(state, env));
  if (elapsed !== undefined) {
    const since = clockSince(row, state, env, elapsed);
    return [{
      text: elapsedLabel(elapsed, frozen(state)),
      tone: frozen(state) ? "faint" : "muted",
      ...(since === undefined ? {} : { clock: { since } }),
    }];
  }
  return [{
    text: ageText(row.entry.last_activity, env.now),
    tone: "faint",
  }];
}

/**
 * When a running time began on the application's clock, so the package
 * paints it from the same moment as every other clock on screen: this
 * Desk's own run counts from when its progress began, as its progress
 * sheet does; another run counts back from the view's clock. Frozen or
 * long times stay words.
 */
function clockSince(
  row: DeskRow,
  state: DeskProductState,
  env: DeskViewEnv,
  elapsed: number,
): number | undefined {
  if (frozen(state) || elapsed >= CLOCK_SHOWN_BELOW_MS) return undefined;
  const operation = taskOperation(state, deskRowId(row));
  if (operation !== undefined) return operation.progress.startedAt;
  return env.clock === undefined ? undefined : env.clock - elapsed;
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

/**
 * The inbox list: the Commands row, then the decision groups (or one
 * title-ordered group), then branches.
 */
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
  // With no task to compare against, a branch group says what it holds
  // beside its fold.
  const glossed = noTasks(state)
    ? branchGroups.map((group) => {
      const gloss = BRANCH_GROUP_GLOSS[group.id];
      return gloss === undefined || group.aside !== undefined
        ? group
        : { ...group, aside: [{ text: gloss, tone: "faint" as const }] };
    })
    : branchGroups;
  const groups = [commandsGroup(state), ...taskGroups, ...glossed];
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

/** Each row's detail blocks and strip, the Commands row's home panel first. */
function details(
  state: DeskProductState,
  env: DeskViewEnv,
): {
  content: Record<string, readonly ApplicationDetailBlock[]>;
  strip: Record<string, ApplicationDetailStrip>;
} {
  const base = inspection(state, env);
  const content: Record<string, readonly ApplicationDetailBlock[]> = {
    [COMMANDS_ROW_ID]: homeBlocks(state, env),
  };
  const strip: Record<string, ApplicationDetailStrip> = {
    [COMMANDS_ROW_ID]: homeStrip(state, env),
  };
  for (const row of state.rows) {
    const id = deskRowId(row);
    const evidence = cachedEvidence(
      state.evidence,
      taskEvidenceSubject(row, state.data, state.trunk),
    );
    const read = { ...base, evidence };
    content[id] = taskBlocks(row, read);
    strip[id] = taskStrip(row, read);
  }
  for (const branch of parkedBranches(state.data)) {
    const id = parkedRowId(branch);
    const title = branchTitle(branch, state.data);
    const evidence = cachedEvidence(
      state.evidence,
      branchEvidenceSubject(branch, env.root, state.data, state.trunk),
    );
    content[id] = parkedBlocks(branch, title, { ...base, evidence });
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

/**
 * The words of a message after its mark: muted, except an outcome (a
 * success or a failure), whose sentence reads in ink; a detail that names
 * what was found reads in ink after the text.
 */
function messageWords(message: DeskMessage): ApplicationRun[] {
  const outcome = message.tone === "success" || message.tone === "danger";
  return [
    { text: message.text, ...(outcome ? { tone: "ink" as const } : {}) },
    ...(message.detail === undefined ? [] : [
      { text: " · " },
      { text: message.detail, tone: "ink" as const },
    ]),
  ];
}

/**
 * The message row: a toast or a persistent warning. Only the leading mark
 * carries the message's tone; the line itself stays muted.
 */
export function messageLine(
  message: DeskMessage | undefined,
): ApplicationMessage | undefined {
  if (message === undefined) return undefined;
  const runs: ApplicationRun[] = [
    ...(message.mark === undefined ? [] : [{
      text: `${message.mark.unicode}  `,
      ascii: `${message.mark.ascii}  `,
      tone: message.tone === "muted" ? "faint" as const : message.tone,
    }]),
    ...messageWords(message),
  ];
  return {
    id: message.id,
    tone: "muted",
    runs,
    ...(message.key === undefined ? {} : {
      trailing: [
        { text: message.key.key, role: "key" as const },
        { text: ` ${message.key.label}`, tone: "muted" as const },
      ],
    }),
    ...(message.persistent === true
      ? {}
      : { dismiss: { afterMs: DESK_TOAST_MS, onKey: true } }),
  };
}

/**
 * The selected row's own hints: what Enter does (its next step, or its
 * actions when it has none it can run now), then its keyed alternatives.
 * The first hint is the footer's primary, so it is always Enter's.
 */
function rowHints(
  state: DeskProductState,
  ui: DeskUi,
  list: ApplicationList<DeskIntent>,
): KeyHint[] {
  const ref = rowRef(state, ui.selected);
  if (ref === undefined) return [];
  if (ref.kind === "commands") return commandsHints(state, list);
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
    {
      key: "enter",
      label: running
        ? DESK_COMMAND_LABELS.progress
        : decision.next?.availability === "enabled"
        ? decision.next.label
        : gestureLabel("."),
    },
    ...decision.also.flatMap((offer) =>
      offer.key === undefined ? [] : [{ key: offer.key, label: offer.label }]
    ),
  ];
}

/**
 * The Commands row's hints: Enter opens the palette, New task leads while
 * there are no tasks, and Down reaches the first group below, by its name.
 */
function commandsHints(
  state: DeskProductState,
  list: ApplicationList<DeskIntent>,
): KeyHint[] {
  const below = list.groups.find((group) =>
    group.id !== COMMANDS_GROUP_ID && group.items.length > 0
  );
  const newTask = DESK_COMMAND_REGISTRY.new_task.key;
  return [
    { key: "enter", label: COMMANDS_LABEL },
    ...(noTasks(state)
      ? [{ key: newTask, label: DESK_COMMAND_LABELS.new_task }]
      : []),
    ...(below === undefined ? [] : [{ key: "down", label: below.title }]),
  ];
}

/** The label a gesture key carries in the inbox key map. */
function gestureLabel(key: string): string {
  const binding = DESK_KEYS.inbox.find((candidate) => candidate.key === key);
  return binding?.meaning.kind === "gesture" ? binding.meaning.label : key;
}

/**
 * The inbox footer: the row's hints left, the pinned routes right. Actions
 * concern a task or a branch, so the Commands row leaves them out.
 */
function footer(
  state: DeskProductState,
  ui: DeskUi,
  list: ApplicationList<DeskIntent>,
): TerminalApplicationView<DeskIntent>["footer"] {
  const ref = rowRef(state, ui.selected);
  const left = rowHints(state, ui, list);
  // Enter already names Actions when the row has nothing else to run.
  const actions = (ref?.kind === "task" || ref?.kind === "parked") &&
    left[0]?.label !== gestureLabel(".");
  // Nor does New task need its key while the row's own hints name it.
  const creates = left.some((hint) =>
    hint.label === DESK_COMMAND_LABELS.new_task
  );
  // Nor Ctrl+K while Enter already opens Commands, the Commands row's own
  // cell showing its key.
  const commands = left[0]?.label === COMMANDS_LABEL;
  return {
    left,
    right: [
      ...(actions ? [{ key: ".", label: gestureLabel(".") }] : []),
      ...(commands ? [] : [{ key: "ctrl-k", label: gestureLabel("ctrl-k") }]),
    ],
    extra: [
      { key: "?", label: DESK_COMMAND_REGISTRY.keys.short },
      { key: "/", label: gestureLabel("/") },
      ...(creates ? [] : [{ key: "n", label: DESK_COMMAND_LABELS.new_task }]),
      { key: "q", label: DESK_COMMAND_LABELS.quit },
    ],
  };
}

/** The keys zoom gives its own meanings, which no row hint may claim there. */
const ZOOM_KEYS: readonly string[] = ["up", "down", "space", "left"];

/**
 * The footer while details are zoomed: the row's next step, then Up and
 * Down to the next task, then the row's own keys; on the right only Back
 * and Actions, so the task's keys keep the room.
 */
function zoomFooter(
  footer: TerminalApplicationView<DeskIntent>["footer"],
): TerminalApplicationView<DeskIntent>["footer"] {
  const free = (hint: KeyHint): boolean =>
    (typeof hint.key === "string" ? [hint.key] : hint.key).every((key) =>
      !ZOOM_KEYS.includes(key)
    );
  const [primary, ...rest] = footer.left;
  return {
    left: [
      ...(primary === undefined ? [] : [primary]),
      { key: ["up", "down"], label: ZOOM_HINT_LABELS.walk },
      ...rest.filter(free),
    ],
    right: [
      { key: "left", label: ZOOM_HINT_LABELS.back },
      ...(footer.right ?? []).filter((hint) => hint.key === "."),
    ],
  };
}

/** The base-layer bindings: every key the inbox key maps give a meaning that
 * the package does not already own. Static, so it is built once. */
export function deskKeymap(): ApplicationKeyBinding<DeskIntent>[] {
  const reserved: readonly string[] = PACKAGE_RESERVED_KEYS;
  const keys = new Set<string>();
  for (const layer of DESK_ROW_LAYERS) {
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

/** The key map every session runs with, built once. */
export const DESK_KEYMAP: readonly ApplicationKeyBinding<DeskIntent>[] =
  deskKeymap();

/** The Desk reads vi's movement keys too. */
export const DESK_VI_KEYS = true;

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
  const list = inboxList(state, env);
  const listed = body(state, env, list);
  const base = footer(state, ui, list);
  const shown = listed.kind === "master-detail"
    ? { ...listed, zoomFooter: zoomFooter(base) }
    : listed;
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
    footer: base,
    ...(layers.length === 0 ? {} : { layers }),
    windowTitle: needYou === 0 ? project : `${project} · ${needYou} need you`,
    ...(state.preferences.mouse === true ? { input: { mouse: true } } : {}),
    tooSmallHints: [{ key: "q", label: DESK_COMMAND_LABELS.quit }],
  };
  // Observed text reaches the view in many slots; one pass keeps every
  // single-line slot free of line breaks and control characters.
  inertView(view);
  return view;
}

/**
 * The body: the list and its inspector, or the list alone while details are
 * hidden. The Commands row leads either way, so a desk with no tasks is the
 * same inbox, its home panel saying what a task is. Hiding details hides a
 * task's facts, so until there is a task the home panel stays: it is where
 * the desk says it is loading, couldn't read the tasks, or has none yet.
 */
function body(
  state: DeskProductState,
  env: DeskViewEnv,
  list: ApplicationList<DeskIntent>,
): TerminalApplicationView<DeskIntent>["body"] {
  if (
    state.preferences.details === "hidden" && state.data !== undefined &&
    !noTasks(state)
  ) return { kind: "list", list };
  const { content, strip } = details(state, env);
  return {
    kind: "master-detail",
    list,
    detail: { follows: DESK_LIST_ID, content, strip, pending: "Reading…" },
  };
}

/**
 * How long until the view's running times next move, or `undefined` while
 * none do. A running task's details count in words, so with one selected
 * the view is rebuilt as its elapsed time reaches the next whole second,
 * the moment the list's clock beside it moves too.
 */
export function deskTickDelay(
  state: DeskProductState,
  ui: DeskUi,
  env: DeskViewEnv,
): number | undefined {
  if (frozen(state) || !state.rows.some((row) => isRunning(row))) {
    return undefined;
  }
  const ref = rowRef(state, ui.selected);
  const elapsed = ref?.kind === "task"
    ? runningElapsed(ref.row, inspection(state, env))
    : undefined;
  return elapsed === undefined ? DESK_TICK_MS : 1_000 - elapsed % 1_000;
}
