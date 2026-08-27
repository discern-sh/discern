/**
 * Pure product presentation for the Desk.
 *
 * The decision model supplies meaning and action legality. This module maps
 * those decisions to design-system Components, responsive selection entries,
 * and complete frames. It performs no observation or effects.
 */

import {
  joinVertical,
  layoutColumns,
  renderBadgeCli,
  renderClusterCli,
  renderHeadingCli,
  renderReceiptCli,
  renderResultSummaryCli,
  renderTableCli,
  wrapInlineCluster,
} from "discern-design-system/cli";
import { DISCERN_WORDMARK } from "../../shared/brand.ts";
import type {
  SelectionGroup,
  SelectionOption,
} from "../../lib/terminal_interaction.ts";
import {
  type TerminalContext,
  terminalLine,
  type TerminalSize,
} from "../../lib/terminal.ts";
import { truncateText } from "../../lib/text.ts";
import {
  DESK_STATES,
  type DeskAction,
  type DeskActionGroupId,
  type DeskActionOffer,
  type DeskBoardDecision,
  type DeskDetail,
  type DeskProofFact,
  type DeskRow,
  type DeskState,
  stateTitle,
} from "./model.ts";

/** Sentinel selection values that route back into Desk orchestration. */
export const DESK_ROUTES = {
  refresh: "\x00refresh",
  quit: "\x00quit",
  back: "\x00back",
  startTask: "\x00start-task",
  runProjectScript: "\x00run-project-script",
  readDocs: "\x00read-docs",
} as const;

/** A short fleet is faster to scan directly; larger fleets gain filtering. */
export const DESK_FILTER_THRESHOLD = 8;

const WIDE_BOARD_COLUMNS = 96;
const MEDIUM_BOARD_COLUMNS = 56;
const SHORT_BOARD_ROWS = 30;
const SELECTION_FRAME_RESERVE = 8;

type DeskRowLayout = "wide" | "medium" | "narrow";
type ResultState =
  | "passed"
  | "failed"
  | "blocked"
  | "changed"
  | "declared"
  | "unchanged";

/** One complete frame plus the rows the following interaction must reserve. */
export interface DeskRenderedFrame {
  readonly text: string;
  readonly rows: number;
}

/** Inputs needed to compose the root board without observing project state. */
export interface DeskBoardViewInput {
  readonly board: DeskBoardDecision;
  readonly tip?: string;
  readonly viewport: TerminalSize;
  readonly terminal: TerminalContext;
}

/** Inputs needed to map the root commands into their separate menu groups. */
export interface DeskRootSelectionInput {
  readonly rows: readonly DeskRow[];
  readonly hasProjectScripts: boolean;
  readonly viewport: TerminalSize;
  readonly terminal: TerminalContext;
}

const DESK_STATE_RESULT = {
  needs_attention: "blocked",
  ready_to_review: "passed",
  working: "changed",
  paused: "declared",
  empty: "unchanged",
} as const satisfies Readonly<Record<DeskState, ResultState>>;

const PROOF_RECEIPT_STATE = {
  honored: "pass",
  report_only: "fail",
  missing: "skip",
  stale: "fail",
  dirty: "skip",
  unavailable: "fail",
  read_failed: "fail",
} as const satisfies Readonly<
  Record<DeskProofFact["status"], "pass" | "fail" | "skip">
>;

const STATE_GROUP_DESCRIPTIONS = {
  needs_attention: "A decision or repair needs you.",
  ready_to_review: "Evidence is ready for review.",
  working: "Work is running now.",
  paused: "The next condition is known; no work is running.",
  empty: "No work is ready to review.",
} as const satisfies Readonly<Record<DeskState, string>>;

const ACTION_GROUPS: readonly {
  readonly id: DeskActionGroupId;
  readonly label: string;
}[] = [
  { id: "landing", label: "Landing" },
  { id: "work", label: "Work in this task" },
  { id: "review", label: "Review" },
  { id: "worktree", label: "Worktree" },
];

/** Bound an explicit viewport dimension to a safe integer. */
function viewportDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/** Number of physical terminal rows in one clean rendered block. */
function frameRows(frame: string): number {
  return frame === "" ? 0 : frame.split("\n").length;
}

/** Use tighter vertical rhythm when a short viewport needs every row. */
function composeFrames(
  frames: readonly string[],
  viewportRows: number,
): string {
  return joinVertical(frames, {
    spacing: viewportRows < SHORT_BOARD_ROWS ? 0 : 1,
  });
}

/** Exhaustive root badge treatment for the main checkout decision. */
function mainTone(
  state: DeskBoardDecision["main"]["state"],
): "success" | "warning" | "danger" {
  switch (state) {
    case "clean":
      return "success";
    case "changed":
      return "warning";
    case "unknown":
      return "danger";
  }
}

/** Human count with no zero-shaped grammar surprises. */
function taskCount(count: number): string {
  return count === 0 ? "No tasks" : `${count} task${count === 1 ? "" : "s"}`;
}

/** Render the calm root composition above the interactive queue. */
export function renderDeskBoard(input: DeskBoardViewInput): DeskRenderedFrame {
  const width = viewportDimension(input.viewport.columns);
  const presenter = input.terminal.presenter;
  const heading = presenter.present(renderHeadingCli, {
    text: terminalLine(`${DISCERN_WORDMARK} · ${input.board.project}`),
    level: 1,
    leadingBlankLines: 0,
    overflow: "wrap",
    maxWidth: width,
  });
  const main = wrapInlineCluster([
    presenter.present(renderBadgeCli, {
      label: terminalLine("Main checkout"),
      tone: mainTone(input.board.main.state),
      maxWidth: Math.min(width, 24),
    }),
    terminalLine(input.board.main.headline),
  ], { columns: width, gap: 2 });
  const counts = presenter.present(renderClusterCli, {
    items: [
      terminalLine(taskCount(input.board.taskCount)),
      terminalLine(`${input.board.needsPersonCount} need you`),
      terminalLine(`${input.board.readyToReviewCount} ready to review`),
      terminalLine(`Refreshed ${input.board.refreshedAge}`),
    ],
    gap: 3,
    width,
  });
  const notices = input.board.notices.map((notice) =>
    presenter.present(renderResultSummaryCli, {
      state: notice.state === "attention" ? "blocked" : "unchanged",
      fact: terminalLine(
        notice.detail === undefined
          ? notice.headline
          : `${notice.headline}: ${notice.detail}`,
      ),
      ...(notice.nextAction === undefined
        ? {}
        : { nextAction: terminalLine(notice.nextAction) }),
      maxWidth: width,
    })
  );
  const tip = input.tip === undefined
    ? []
    : [presenter.note(terminalLine(`Tip: ${input.tip}`), { maxWidth: width })];
  const text = composeFrames(
    [heading, main, counts, ...notices, ...tip],
    viewportDimension(input.viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Select one responsive task-row posture from the live viewport. */
export function deskRowLayout(columns: number): DeskRowLayout {
  const width = viewportDimension(columns);
  if (width >= WIDE_BOARD_COLUMNS) return "wide";
  if (width >= MEDIUM_BOARD_COLUMNS) return "medium";
  return "narrow";
}

/** Keep every row label on one physical line; task detail retains the full text. */
function boundedText(
  value: string,
  width: number,
  unicode: boolean,
): string {
  return truncateText(value, Math.max(1, width), unicode ? "…" : "...");
}

/** One package-laid-out, single-line row with equal product columns. */
function columnRow(
  values: readonly string[],
  width: number,
  unicode: boolean,
): string {
  const gap = 2;
  const cellWidth = Math.max(
    1,
    Math.floor((width - gap * (values.length - 1)) / values.length),
  );
  const rendered = layoutColumns(
    values.map((value) => boundedText(value, cellWidth, unicode)),
    { columns: width, gap },
  );
  if (rendered.includes("\n")) {
    throw new TypeError("Desk row columns must resolve to one line");
  }
  return rendered;
}

/** The enabled action named by the model's recommendation, if any. */
function recommendedOffer(row: DeskRow): DeskActionOffer | undefined {
  const action = row.decision.recommendedAction;
  return action === undefined
    ? undefined
    : row.decision.actions.find((offer) =>
      offer.action === action && offer.availability === "enabled"
    );
}

/** The highest-value supporting fact that does not merely repeat the headline. */
function relevantDetail(row: DeskRow): DeskDetail | undefined {
  const order: readonly DeskDetail["kind"][] = [
    "next_condition",
    "collision",
    "proof",
    "authority",
    "git",
    "containment",
    "activity",
  ];
  return order.flatMap((kind) =>
    row.decision.details.find((detail) =>
      detail.kind === kind && !row.decision.headline.includes(detail.text)
    ) ?? []
  )[0];
}

/** Add only enough identity to distinguish duplicate human task names. */
function rowTitle(
  row: DeskRow,
  duplicate: boolean,
  unicode: boolean,
): string {
  if (!duplicate) return row.task.name;
  const identity = row.task.disambiguator ?? row.entry.id ?? row.entry.branch;
  return `${row.task.name}${unicode ? " · " : " - "}${identity}`;
}

/** Build one package selection entry without fleet-wide column coupling. */
function taskSelectionEntry(
  row: DeskRow,
  duplicate: boolean,
  viewport: TerminalSize,
  terminal: TerminalContext,
): SelectionOption<string> {
  const columns = viewportDimension(viewport.columns);
  const rowWidth = Math.max(12, columns - SELECTION_FRAME_RESERVE);
  const unicode = terminal.capabilities.unicode;
  const title = rowTitle(row, duplicate, unicode);
  const recommendation = recommendedOffer(row);
  const detail = relevantDetail(row)?.text;
  const next = recommendation === undefined
    ? undefined
    : `Next: ${recommendation.label}`;
  const layout = deskRowLayout(columns);
  if (layout === "wide") {
    return {
      name: columnRow(
        [
          title,
          row.decision.headline,
          next ?? row.decision.activity.summary,
        ],
        rowWidth,
        unicode,
      ),
      ...(detail === undefined ? {} : { description: detail }),
      value: row.entry.path,
    };
  }
  if (layout === "medium") {
    const description = [detail, next].filter((value): value is string =>
      value !== undefined
    ).join(" · ");
    return {
      name: columnRow([title, row.decision.headline], rowWidth, unicode),
      ...(description === "" ? {} : { description }),
      value: row.entry.path,
    };
  }
  const description = [
    `State: ${row.decision.headline}`,
    detail,
    next,
  ].filter((value): value is string => value !== undefined).join(" · ");
  return {
    name: boundedText(title, rowWidth, unicode),
    description,
    value: row.entry.path,
  };
}

/** Map the decision-sorted fleet and separate Desk commands into picker groups. */
export function deskRootSelectionGroups(
  input: DeskRootSelectionInput,
): SelectionGroup<string>[] {
  const nameCounts = new Map<string, number>();
  for (const row of input.rows) {
    nameCounts.set(row.task.name, (nameCounts.get(row.task.name) ?? 0) + 1);
  }
  const groups: SelectionGroup<string>[] = DESK_STATES.flatMap((state) => {
    const members = input.rows.filter((row) => row.decision.state === state);
    if (members.length === 0) return [];
    return [{
      id: `tasks-${state}`,
      label: `${stateTitle(state)} · ${members.length}`,
      description: STATE_GROUP_DESCRIPTIONS[state],
      items: members.map((row) =>
        taskSelectionEntry(
          row,
          (nameCounts.get(row.task.name) ?? 0) > 1,
          input.viewport,
          input.terminal,
        )
      ),
    }];
  });
  groups.push({
    id: "desk-commands",
    label: "Desk commands",
    description: "Actions for the project, separate from task decisions.",
    items: [
      {
        name: "Start a task",
        description: "Create an isolated worktree and branch.",
        value: DESK_ROUTES.startTask,
      },
      ...(input.hasProjectScripts
        ? [{
          name: "Run a Project Script",
          description:
            "Run a configured project command from the main checkout.",
          value: DESK_ROUTES.runProjectScript,
        }]
        : []),
      {
        name: "Read discern's docs",
        description: "Open the reference documentation in a browser.",
        value: DESK_ROUTES.readDocs,
      },
    ],
  });
  groups.push({
    id: "session-commands",
    label: "Session",
    items: [
      { name: "Refresh", value: DESK_ROUTES.refresh },
      { name: "Quit", value: DESK_ROUTES.quit },
    ],
  });
  return groups;
}

/** Root prompt that names both kinds of selectable entry. */
export function deskRootPrompt(taskTotal: number): string {
  return taskTotal === 0
    ? "Choose a Desk command"
    : "Choose a task or Desk command";
}

/** Whether the root picker benefits from type-to-filter. */
export function deskRootUsesSearch(taskTotal: number): boolean {
  return taskTotal > DESK_FILTER_THRESHOLD;
}

/**
 * Keep a static Desk composition visible without starving the package-owned
 * interaction frame. The package measures prompt, groups, choices, and help
 * in the remaining viewport; the Desk retains at most one third for its
 * preamble.
 */
export function deskCompositionReserveRows(
  compositionRows: number,
  viewportRows: number,
): number {
  const composition = Number.isFinite(compositionRows)
    ? Math.max(0, Math.floor(compositionRows))
    : 0;
  const viewport = viewportDimension(viewportRows);
  return Math.min(composition, Math.floor(viewport / 3));
}

interface EvidenceRow {
  readonly group: string;
  readonly label: string;
  readonly value: string;
}

/** Find one canonical action offer for detail-level availability evidence. */
function actionOffer(row: DeskRow, action: DeskAction): DeskActionOffer {
  const found = row.decision.actions.find((offer) => offer.action === action);
  if (found === undefined) {
    throw new TypeError(`Desk decision is missing the ${action} action`);
  }
  return found;
}

/** Present one enabled capability list or its model-owned unavailable reason. */
function availability(
  offer: DeskActionOffer,
  available: readonly string[],
): string {
  if (available.length === 0) {
    return offer.availability === "disabled" ? offer.reason : "Available";
  }
  const inventory = available.join(", ");
  return offer.availability === "disabled"
    ? `${inventory} · Unavailable now: ${offer.reason}`
    : inventory;
}

/** Every required task-detail fact, grouped without reclassifying state. */
function taskEvidence(row: DeskRow): EvidenceRow[] {
  const evidence: EvidenceRow[] = [
    { group: "Location", label: "Branch", value: row.entry.branch },
    { group: "Location", label: "Path", value: row.entry.path },
    {
      group: "Work",
      label: "Activity",
      value: row.decision.activity.detail === undefined
        ? row.decision.activity.summary
        : `${row.decision.activity.summary} · ${row.decision.activity.detail}`,
    },
    ...row.decision.details.filter((detail) => detail.kind === "git").map(
      (detail): EvidenceRow => ({
        group: "Work",
        label: "Git",
        value: detail.text,
      }),
    ),
    {
      group: "Landing",
      label: "Authority",
      value: row.decision.authority.summary,
    },
    ...row.decision.authority.scopes.map((scope): EvidenceRow => ({
      group: "Landing",
      label: "Covered scope",
      value: scope,
    })),
    ...row.decision.authority.uncoveredPaths.map((path): EvidenceRow => ({
      group: "Landing",
      label: "Outside grant",
      value: path,
    })),
    ...row.decision.authority.warnings.map((warning): EvidenceRow => ({
      group: "Landing",
      label: "Warning",
      value: warning,
    })),
    ...row.decision.collisions.flatMap((collision): EvidenceRow[] =>
      collision.kind === "changed_files"
        ? [
          {
            group: "Collisions",
            label: "Changed files",
            value: `${collision.total} overlap with ${collision.otherBranch}`,
          },
          ...(collision.paths.length === 0 ? [] : [{
            group: "Collisions",
            label: "Paths",
            value: collision.paths.join(", "),
          }]),
        ]
        : [
          {
            group: "Collisions",
            label: `ADR ${collision.number}`,
            value: collision.otherBranches.length === 0
              ? "Also claimed by another task"
              : `Also claimed by ${collision.otherBranches.join(", ")}`,
          },
          ...(collision.paths.length === 0 ? [] : [{
            group: "Collisions",
            label: "Paths",
            value: collision.paths.join(", "),
          }]),
        ]
    ),
    ...row.decision.details.filter((detail) => detail.kind === "containment")
      .map((detail): EvidenceRow => ({
        group: "Containment",
        label: "State",
        value: detail.text,
      })),
    {
      group: "Availability",
      label: "Agents",
      value: availability(
        actionOffer(row, "agent"),
        [...new Set(row.agentLaunches.map((launch) => launch.label))],
      ),
    },
    {
      group: "Availability",
      label: "Project Scripts",
      value: availability(
        actionOffer(row, "scripts"),
        row.scripts.map((script) => script.name),
      ),
    },
  ];
  return evidence.filter((item) => item.value !== "");
}

/** Full decision evidence shown before the selected task's action picker. */
export function renderDeskTaskDetail(
  row: DeskRow,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const presenter = terminal.presenter;
  const recommendation = recommendedOffer(row);
  const heading = presenter.present(renderHeadingCli, {
    text: terminalLine(row.task.name),
    level: 1,
    leadingBlankLines: 0,
    overflow: "wrap",
    maxWidth: width,
  });
  const decision = presenter.present(renderResultSummaryCli, {
    state: DESK_STATE_RESULT[row.decision.state],
    fact: terminalLine(row.decision.headline),
    ...(recommendation === undefined
      ? {}
      : { nextAction: terminalLine(recommendation.label) }),
    maxWidth: width,
  });
  const evidence = taskEvidence(row);
  const facts = presenter.present(renderTableCli, {
    caption: terminalLine("Task evidence"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Fact") },
      { header: terminalLine("Evidence") },
    ],
    rows: evidence.map((fact) => [
      terminalLine(`${fact.group} · ${fact.label}`),
      terminalLine(fact.value),
    ]),
    width,
  });
  const proof = presenter.present(renderReceiptCli, {
    title: terminalLine("Proof"),
    checks: [{
      label: terminalLine("Currency"),
      state: PROOF_RECEIPT_STATE[row.decision.proof.status],
      stateLabel: terminalLine(row.decision.proof.summary),
      ...(row.decision.proof.detail === undefined
        ? {}
        : { value: terminalLine(row.decision.proof.detail) }),
    }],
    ...(row.decision.proof.line === undefined ? {} : {
      meta: [{
        label: terminalLine("Proof line"),
        value: terminalLine(row.decision.proof.line),
      }],
    }),
    maxWidth: width,
  });
  const text = composeFrames(
    [heading, decision, facts, proof],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Map enabled action offers into their semantic picker groups. */
export function deskActionGroups(row: DeskRow): SelectionGroup<string>[] {
  return ACTION_GROUPS.map((group) => ({
    id: `actions-${group.id}`,
    label: group.label,
    items: row.decision.actions
      .filter((offer) =>
        offer.availability === "enabled" && offer.group === group.id
      )
      .map((offer) => ({
        name: offer.label,
        ...(offer.recommended
          ? { description: "Recommended for the current state." }
          : {}),
        value: offer.action as string,
      })),
  }));
}
