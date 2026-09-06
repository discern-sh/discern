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
  renderAgentHandoffCli,
  renderBadgeCli,
  renderClusterCli,
  renderCommandCli,
  renderDestructiveActionNoticeCli,
  renderDiagnosticCli,
  renderDiffstatCli,
  renderExpectedResultCli,
  renderFileChangeCli,
  renderHeadingCli,
  renderProcedureCli,
  renderProcedureStepCli,
  renderRawOutputCli,
  renderResultSummaryCli,
  renderRetryNoticeCli,
  renderStandardMeterCli,
  renderTableCli,
  renderTaskMetadataCli,
  renderVerificationReportCli as renderProofCli,
  wrapInlineCluster,
} from "discern-design-system/cli";
import { DISCERN_WORDMARK } from "../../shared/brand.ts";
import { commandEvidence } from "../../shared/command_evidence.ts";
import type { EnginePlan } from "../../shared/result.ts";
import type {
  GateProofCheckData,
  StartData,
  StatusData,
} from "../../shared/result_schemas.ts";
import type { StartPlan } from "../worktree/plan.ts";
import { renderMarkdown } from "../../lib/markdown.ts";
import type { DeskProjectScript } from "../project_scripts.ts";
import type {
  SelectionGroup,
  SelectionOption,
} from "../../lib/terminal_interaction.ts";
import {
  type TerminalContext,
  terminalLine,
  terminalMultiline,
  type TerminalSize,
} from "../../lib/terminal.ts";
import { truncateText } from "../../lib/text.ts";
import { renderProofLineCli } from "../gate/presentation.ts";
import {
  DESK_STATES,
  type DeskAction,
  type DeskActionGroupId,
  type DeskActionOffer,
  type DeskAgentLaunch,
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
  mainCheckout: "\x00main-checkout",
  recentCompleted: "\x00recent-completed",
} as const;

/** Route prefix for one exact status-reported branch without a worktree. */
export const DESK_UNLANDED_ROUTE_PREFIX = "\x00unlanded:";

/** Preserve an unlanded branch ref as a root-picker route. */
export function deskUnlandedRoute(branch: string): string {
  return `${DESK_UNLANDED_ROUTE_PREFIX}${branch}`;
}

/** Recover an exact branch ref from a root-picker route. */
export function deskUnlandedBranch(route: string): string | undefined {
  return route.startsWith(DESK_UNLANDED_ROUTE_PREFIX)
    ? route.slice(DESK_UNLANDED_ROUTE_PREFIX.length)
    : undefined;
}

/** Routes available inside the Proof-first review drill-down. */
export const DESK_REVIEW_ROUTES = {
  diff: "\x00review-diff",
  editor: "\x00review-editor",
  back: "\x00review-back",
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

/** Render one exact applied command without writing through the viewport. */
export function renderDeskCommandEvidence(
  command: string,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const text = terminal.presenter.present(renderCommandCli, {
    command: terminalLine(command),
    maxWidth: viewportDimension(viewport.columns),
  });
  return { text, rows: frameRows(text) };
}

/** One path in the review's committed or uncommitted change set. */
export interface DeskReviewFile {
  readonly path: string;
  readonly disposition: "added" | "updated" | "removed";
  readonly added?: number;
  readonly removed?: number;
  readonly uncommitted: boolean;
}

/** A failed read that must remain a failure rather than an empty section. */
export interface DeskReviewFailure {
  readonly title: string;
  readonly command: string;
  readonly detail: string;
  readonly nextAction: string;
  readonly safeToRetry: boolean;
}

/** Configured editor evidence available to the review drill-down. */
export interface DeskEditorCommand {
  readonly command: string;
  readonly program: string;
  readonly args: readonly string[];
}

/** All observations used by the pure Proof-first review composition. */
export interface DeskReview {
  readonly trunk: string;
  readonly proof: GateProofCheckData;
  readonly commits: string;
  readonly files: readonly DeskReviewFile[];
  readonly insertions: number;
  readonly deletions: number;
  readonly failures: readonly DeskReviewFailure[];
  readonly diffCommand: string;
  readonly editor?: DeskEditorCommand;
  readonly editorUnavailableReason?: string;
}

/** Map the shared plan disposition onto the package's sequential-step state. */
function plannedStepStatus(
  disposition: EnginePlan["steps"][number]["disposition"],
): "pending" | "cancelled" {
  return disposition === "skip" ? "cancelled" : "pending";
}

/**
 * Compose one action's real core plan, command, and consequence account before
 * the dispatcher asks for authority.
 */
export function renderDeskActionPlan(
  row: DeskRow,
  offer: DeskActionOffer,
  plan: EnginePlan | undefined,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const workingDirectory = offer.command.workingDirectory === "task"
    ? row.entry.path
    : "main checkout";
  return renderActionPlan(
    offer,
    plan,
    workingDirectory,
    `${row.entry.branch}\n${row.entry.path}`,
    viewport,
    terminal,
  );
}

type ActionPlanOffer = Pick<
  DeskActionOffer,
  "action" | "group" | "label" | "command" | "consequence"
>;

/** Compose one command/plan/consequence account through package Components. */
function renderActionPlan(
  offer: ActionPlanOffer,
  plan: EnginePlan | undefined,
  workingDirectory: string,
  scope: string,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const presenter = terminal.presenter;
  const plannedSteps: readonly {
    readonly label: string;
    readonly disposition: EnginePlan["steps"][number]["disposition"];
  }[] = plan === undefined || plan.steps.length === 0
    ? [{
      label: offer.action,
      disposition: "run",
    }]
    : plan.steps;
  const command = presenter.present(renderCommandCli, {
    command: terminalLine(commandEvidence(offer.command.argv)),
    workingDirectory: terminalLine(workingDirectory),
    explanation: terminalMultiline(offer.label),
    expectedResult: terminalMultiline(
      offer.consequence.changes[0] ?? "The task state remains unchanged.",
    ),
    expectedResultLabel: terminalLine("Expected effect"),
    expectedResultVariant: "state",
    failureNote: terminalMultiline(
      "The lifecycle core revalidates the task after confirmation and refuses stale state.",
    ),
    maxWidth: width,
  });
  const procedure = presenter.present(renderProcedureCli, {
    title: terminalLine(plan?.title ?? `${offer.label} plan`),
    ...(plan === undefined || plan.details.length === 0
      ? {}
      : { description: terminalMultiline(plan.details.join("\n")) }),
    steps: plannedSteps.map((step) => ({
      title: terminalLine(String(step.label)),
      status: plannedStepStatus(step.disposition),
    })),
    completion: terminalMultiline(
      offer.consequence.changes.join("; ") || "No mutation is applied.",
    ),
    completionLabel: terminalLine("Complete when"),
    register: "brand",
    maxWidth: width,
  });
  const steps =
    plan?.steps.map((step) =>
      presenter.present(renderProcedureStepCli, {
        title: terminalLine(String(step.label)),
        status: plannedStepStatus(step.disposition),
        action: terminalMultiline(step.note ?? `Run the ${step.kind} step.`),
        expectedResult: {
          value: terminalMultiline(
            step.disposition === "skip"
              ? "This step remains unchanged."
              : "The step completes or the action stops before later effects.",
          ),
          variant: "state",
        },
        completionCriterion: terminalMultiline(
          step.disposition === "gate"
            ? "The precondition is satisfied."
            : "The lifecycle core reports the step outcome.",
        ),
        register: "brand",
        maxWidth: width,
      })
    ) ?? [];
  const consequence = presenter.present(renderTableCli, {
    caption: terminalLine("Consequence account"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Effect") },
      { header: terminalLine("Evidence") },
    ],
    rows: [
      ["Keeps", offer.consequence.keeps],
      ["Changes", offer.consequence.changes],
      ["Removes", offer.consequence.removes],
      ["Recoverable", offer.consequence.recoverable],
    ].map(([label, facts]) => [
      terminalLine(label as string),
      terminalMultiline(
        (facts as readonly string[]).length === 0
          ? "Nothing"
          : (facts as readonly string[]).join("; "),
      ),
    ]),
    width,
  });
  const expected = presenter.present(renderExpectedResultCli, {
    value: terminalMultiline(
      offer.consequence.changes.join("; ") || "The task remains unchanged.",
    ),
    label: terminalLine("Expected result"),
    variant: "state",
    maxWidth: width,
  });
  const notice = offer.consequence.removes.length === 0
    ? undefined
    : presenter.present(renderDestructiveActionNoticeCli, {
      label: terminalLine(offer.label),
      scope: terminalMultiline(scope),
      impact: terminalMultiline(offer.consequence.removes.join("; ")),
      recovery: terminalMultiline(
        offer.consequence.recoverable.join("; ") || "No automatic recovery.",
      ),
      authority: terminalLine("Human confirmation in the desk"),
      tone: offer.group === "danger" ? "danger" : "warning",
      maxWidth: width,
    });
  const text = composeFrames(
    [
      command,
      procedure,
      ...steps,
      consequence,
      expected,
      ...(notice === undefined ? [] : [notice]),
    ],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Render complete executable evidence for one project-authored script. */
export function renderDeskProjectScriptPlan(
  script: DeskProjectScript,
  args: readonly string[],
  fallbackWorkingDirectory: string,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const executable = script.path ?? script.name;
  const workingDirectory = script.workingDirectory ?? fallbackWorkingDirectory;
  const description = script.description ?? "No description declared";
  const offer: ActionPlanOffer = {
    action: "scripts",
    group: "danger",
    label: `Project Script ${script.name}`,
    command: { argv: [executable, ...args], workingDirectory: "task" },
    consequence: {
      keeps: ["Desk session"],
      changes: [
        `Run project-authored script ${script.name}`,
        `Description: ${description}`,
        `Executable: ${executable}`,
        `Working directory: ${workingDirectory}`,
        "Confirmation policy: required",
        "Destructive policy: undeclared",
      ],
      removes: [
        "The script may remove project state; no destructive policy is declared",
      ],
      recoverable: ["Recovery is project-defined and not declared"],
    },
  };
  return renderActionPlan(
    offer,
    undefined,
    workingDirectory,
    `${script.name}\n${workingDirectory}`,
    viewport,
    terminal,
  );
}

/** Render one lifecycle refusal inside the selected task's product frame. */
export function renderDeskActionFailure(
  row: DeskRow,
  offer: DeskActionOffer,
  message: string,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const presenter = terminal.presenter;
  const cwd = offer.command.workingDirectory === "task"
    ? row.entry.path
    : "main checkout";
  const diagnostic = presenter.present(renderDiagnosticCli, {
    title: terminalLine(`${offer.label} was refused`),
    impact: terminalMultiline("The selected action did not complete."),
    correction: terminalMultiline(message),
    reproductionCommand: terminalLine(commandEvidence(offer.command.argv)),
    workingDirectory: terminalLine(cwd),
    severity: "failure",
    maxWidth: width,
  });
  const retry = presenter.present(renderRetryNoticeCli, {
    safeToRetry: true,
    reason: terminalMultiline(
      "Retry only after the lifecycle result's next step succeeds.",
    ),
    label: terminalLine(offer.label),
    maxWidth: width,
  });
  const text = composeFrames(
    [diagnostic, retry],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Render a degraded task's observed failure and bounded recovery route. */
export function renderDeskRecovery(
  row: DeskRow,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const recovery = row.decision.recovery;
  if (recovery === undefined) {
    throw new Error("Recovery detail requires a degraded task decision.");
  }
  const width = viewportDimension(viewport.columns);
  const presenter = terminal.presenter;
  const diagnostic = presenter.present(renderDiagnosticCli, {
    title: terminalLine("Task recovery needed"),
    impact: terminalMultiline(recovery.failure),
    correction: terminalMultiline(recovery.nextStep),
    reproductionCommand: terminalLine(
      recovery.failedCommand ?? recovery.repairCommand,
    ),
    workingDirectory: terminalLine(row.entry.path),
    rawDetail: terminalMultiline(
      [
        ...recovery.verified.map((fact) => `Verified: ${fact}`),
        ...recovery.unavailable.map((fact) => `Unavailable: ${fact}`),
        ...(row.entry.last_action === undefined ? [] : [
          `Last lifecycle result: ${row.entry.last_action.verb} ${row.entry.last_action.outcome}`,
        ]),
        ...(row.entry.setup?.journal?.steps ?? []).map((step) =>
          `Setup step ${step.id}: ${step.state} · ${step.command}`
        ),
      ].join("\n"),
    ),
    rawLabel: terminalLine("Observed evidence"),
    severity: "failure",
    maxWidth: width,
  });
  const retry = presenter.present(renderRetryNoticeCli, {
    safeToRetry: recovery.repair === "retry",
    reason: terminalMultiline(
      recovery.repair === "retry"
        ? `Run ${recovery.repairCommand}; the setup journal prevents completed one-shot steps from running again.`
        : recovery.nextStep,
    ),
    label: terminalLine(
      recovery.repair === "retry" ? "Setup repair" : "Manual recovery",
    ),
    maxWidth: width,
  });
  const summary = presenter.present(renderResultSummaryCli, {
    state: "blocked",
    fact: terminalLine("The task remains intact while recovery is unresolved."),
    nextAction: terminalLine(recovery.repairCommand),
    maxWidth: width,
  });
  const text = composeFrames(
    [diagnostic, retry, summary],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
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
  readonly unlandedBranches?: readonly string[];
  readonly hasProjectScripts: boolean;
  readonly mainActionable?: boolean;
  readonly recentCompletedCount?: number;
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

const PROOF_STATE = {
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
  { id: "recommended", label: "Recommended" },
  { id: "work", label: "Work" },
  { id: "review", label: "Review" },
  { id: "manage", label: "Manage" },
  { id: "danger", label: "Danger" },
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
  const unlandedBranches = input.unlandedBranches ?? [];
  if (unlandedBranches.length > 0) {
    groups.push({
      id: "unlanded-branches",
      label: `Work without a worktree · ${unlandedBranches.length}`,
      description: "Committed branches available to resume in a new worktree.",
      items: unlandedBranches.map((branch) => ({
        name: branch,
        description: "Resume, inspect, or return to the desk.",
        value: deskUnlandedRoute(branch),
      })),
    });
  }
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
      ...(input.mainActionable === true
        ? [{
          name: "Inspect main checkout",
          description:
            "Review local changes or diagnose unavailable Git state on main.",
          value: DESK_ROUTES.mainCheckout,
        }]
        : []),
      ...((input.recentCompletedCount ?? 0) > 0
        ? [{
          name: `Recent completed tasks · ${input.recentCompletedCount}`,
          description: "Review bounded local landing evidence.",
          value: DESK_ROUTES.recentCompleted,
        }]
        : []),
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

/** Render main as a project boundary, never as an ordinary task. */
export function renderDeskMainCheckoutDetail(
  data: StatusData,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const main = (data.fleet ?? []).find((entry) => entry.is_main);
  const presenter = terminal.presenter;
  const state = main?.clean === false
    ? "changed"
    : main?.git_unavailable === true || main === undefined
    ? "failed"
    : "unchanged";
  const summary = presenter.present(renderResultSummaryCli, {
    state,
    fact: terminalLine(
      main === undefined
        ? "Main checkout evidence is unavailable."
        : main.clean === false
        ? `${main.branch} has ${
          main.changed_files ?? "unreadable"
        } local changes.`
        : `${main.branch} Git state is unavailable.`,
    ),
    nextAction: terminalLine(
      main?.git_failure?.command ?? "git status --short",
    ),
    maxWidth: width,
  });
  const facts = presenter.present(renderTableCli, {
    caption: terminalLine("Main checkout boundary"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Fact") },
      { header: terminalLine("Observed value") },
    ],
    rows: ([
      ["Path", main?.path ?? data.root],
      ["Branch", main?.branch ?? "Unavailable"],
      [
        "Fleet effects",
        main?.clean === false
          ? "Landing and cleanup that update main can be blocked until local changes are resolved."
          : "Git-dependent fleet operations remain blocked until main is readable.",
      ],
      [
        "Isolation",
        "Main stays a project boundary; agent work remains in linked worktrees.",
      ],
    ] satisfies Array<[string, string]>).map(([label, value]) => [
      terminalLine(label),
      terminalMultiline(value),
    ]),
    width,
  });
  const diagnostic = main?.git_failure === undefined
    ? []
    : [presenter.present(renderDiagnosticCli, {
      title: terminalLine("Main Git state is unavailable"),
      impact: terminalMultiline(main.git_failure.reason),
      correction: terminalMultiline(
        "Run the failed command at main, repair its Git state, then refresh the desk.",
      ),
      reproductionCommand: terminalLine(main.git_failure.command),
      workingDirectory: terminalLine(main.path),
      severity: "failure",
      maxWidth: width,
    })];
  const text = composeFrames(
    [summary, facts, ...diagnostic],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Render the bounded local landing tail without implying an archive. */
export function renderDeskRecentCompleted(
  data: StatusData,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const recent = data.recent_completed_tasks ?? [];
  const presenter = terminal.presenter;
  const summary = presenter.present(renderResultSummaryCli, {
    state: recent.length > 0 ? "passed" : "unchanged",
    fact: terminalLine(
      recent.length > 0
        ? `${recent.length} recent completed task${
          recent.length === 1 ? "" : "s"
        } found in local landing evidence.`
        : "No recent completed task evidence is available.",
    ),
    nextAction: terminalLine("Return to the desk"),
    maxWidth: width,
  });
  const table = recent.length === 0 ? [] : [presenter.present(renderTableCli, {
    caption: terminalLine("Recent completed tasks"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Branch") },
      { header: terminalLine("Completed") },
      { header: terminalLine("Evidence") },
    ],
    rows: recent.map((task) => [
      terminalLine(task.branch),
      terminalLine(task.completed_at),
      terminalLine(
        task.proof_line === undefined
          ? task.head ?? "Landing recorded"
          : "Proof recorded",
      ),
    ]),
    width,
  })];
  const proofLines = recent.flatMap((task) =>
    task.proof_line === undefined
      ? []
      : [renderProofLineCli(task.proof_line, terminal, width)]
  );
  const text = composeFrames(
    [summary, ...table, ...proofLines],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Root prompt that names both kinds of selectable entry. */
export function deskRootPrompt(taskTotal: number): string {
  return taskTotal === 0
    ? "Choose a desk command"
    : "Choose a task or desk command";
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
  const task = row.entry.task;
  const evidence: EvidenceRow[] = [
    ...(row.entry.id === undefined
      ? []
      : [{ group: "Identity", label: "Worktree id", value: row.entry.id }]),
    ...(task?.unavailable_reason === undefined ? [] : [{
      group: "Identity",
      label: "Task metadata",
      value: task.unavailable_reason,
    }]),
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
        [
          ...new Set(
            row.agentLaunches.map((launch) =>
              launch.availability === "disabled" && launch.reason !== undefined
                ? `${launch.providerLabel} unavailable: ${launch.reason}`
                : launch.label
            ),
          ),
        ],
      ),
    },
    {
      group: "Availability",
      label: "Project Scripts",
      value: availability(
        actionOffer(row, "scripts"),
        row.scripts.map((script) =>
          script.availability === "disabled" && script.reason !== undefined
            ? `${script.name} unavailable: ${script.reason}`
            : script.name
        ),
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
  const metadata = row.entry.task;
  const availableAgents = [
    ...new Set(
      row.agentLaunches
        .filter((launch) => launch.availability !== "disabled")
        .map((launch) => launch.providerLabel),
    ),
  ];
  const taskMetadata = presenter.present(renderTaskMetadataCli, {
    label: terminalLine("Task metadata"),
    outcome: terminalMultiline(metadata?.brief ?? row.task.name),
    audience: terminalLine(
      availableAgents.length === 0
        ? "Project contributors"
        : availableAgents.join(", "),
    ),
    prerequisites: terminalMultiline(
      metadata?.created_from !== undefined
        ? `${metadata.created_from.ref} at ${metadata.created_from.commit}`
        : metadata?.unavailable_reason ??
          "Creation source is unavailable for this older task",
    ),
    complexity: terminalLine(
      row.entry.id === undefined
        ? "One isolated worktree"
        : `One isolated worktree (${row.entry.id})`,
    ),
    fileEffects: "may-change",
    retrySafety: "check-first",
    expectedState: terminalMultiline(
      "Committed work is ready for final checks and review",
    ),
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
  const proof = presenter.present(renderProofCli, {
    title: terminalLine("Proof"),
    checks: [{
      label: terminalLine("Currency"),
      state: PROOF_STATE[row.decision.proof.status],
      stateLabel: terminalLine(row.decision.proof.summary),
      ...(row.decision.proof.detail === undefined
        ? {}
        : { value: terminalLine(row.decision.proof.detail) }),
    }],
    maxWidth: width,
  });
  const proofLine = row.decision.proof.line === undefined
    ? []
    : [renderProofLineCli(row.decision.proof.line, terminal, width)];
  const text = composeFrames(
    [heading, taskMetadata, decision, facts, proof, ...proofLine],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Inputs for the concrete start plan retained through confirmation. */
export interface DeskStartPreviewInput {
  readonly plan: StartPlan;
  readonly enginePlan: EnginePlan;
  readonly command: readonly string[];
  readonly launch?: DeskAgentLaunch;
  readonly preauthorizeLanding: boolean;
  readonly viewport: TerminalSize;
  readonly terminal: TerminalContext;
}

/** Render one concrete task creation plan before any effect runs. */
export function renderDeskStartPreview(
  input: DeskStartPreviewInput,
): DeskRenderedFrame {
  const width = viewportDimension(input.viewport.columns);
  const presenter = input.terminal.presenter;
  const plan = input.plan;
  const launch = input.launch;
  const metadata = presenter.present(renderTaskMetadataCli, {
    label: terminalLine("New task metadata"),
    outcome: terminalMultiline(plan.brief ?? plan.title),
    audience: terminalLine(launch?.providerLabel ?? "Project contributors"),
    prerequisites: terminalMultiline(`${plan.from} at ${plan.fromCommit}`),
    complexity: terminalLine(
      plan.resources.length === 0
        ? "One isolated worktree"
        : `One isolated worktree with ${plan.resources.length} resource${
          plan.resources.length === 1 ? "" : "s"
        }`,
    ),
    fileEffects: "changes-files",
    retrySafety: "check-first",
    expectedState: terminalMultiline(
      launch === undefined
        ? `Task is ready at ${plan.worktreePath}`
        : `Task is ready and ${launch.label} opens in its worktree`,
    ),
    maxWidth: width,
  });
  const command = presenter.present(renderCommandCli, {
    command: terminalLine(commandEvidence(input.command)),
    workingDirectory: terminalLine("main checkout"),
    explanation: terminalMultiline("Create the previewed task"),
    expectedResult: terminalMultiline(
      `${plan.branch} is ready at ${plan.worktreePath}`,
    ),
    expectedResultLabel: terminalLine("Expected effect"),
    expectedResultVariant: "state",
    failureNote: terminalMultiline(
      "The start core revalidates the base, id, branch, and path after confirmation.",
    ),
    maxWidth: width,
  });
  const procedure = presenter.present(renderProcedureCli, {
    title: terminalLine(input.enginePlan.title),
    description: terminalMultiline(input.enginePlan.details.join("\n")),
    steps: input.enginePlan.steps.map((step) => ({
      title: terminalLine(String(step.label)),
      status: plannedStepStatus(step.disposition),
    })),
    completion: terminalMultiline(
      launch === undefined
        ? "The created task returns to its desk detail."
        : `${launch.label} exits back to the created task's desk detail.`,
    ),
    completionLabel: terminalLine("Complete when"),
    register: "brand",
    maxWidth: width,
  });
  const resources = plan.resources.length === 0
    ? "None"
    : plan.resources.map((resource) => `${resource.name}=${resource.identity}`)
      .join(", ");
  const facts = presenter.present(renderTableCli, {
    caption: terminalLine("Creation facts"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Fact") },
      { header: terminalLine("Value") },
    ],
    rows: [
      ["Title", plan.title],
      ...(plan.brief === undefined ? [] : [["Brief", plan.brief]]),
      ["Worktree id", plan.id],
      ["Branch", plan.branch],
      ["Base", plan.from],
      ["Base commit", plan.fromCommit],
      ["Worktree", plan.worktreePath],
      ["Resources", resources],
      ["Agent", launch?.label ?? "No agent will open"],
      [
        "Landing authority",
        input.preauthorizeLanding
          ? "Approve this committed source after checks pass"
          : "A later conversation must authorize landing",
      ],
      ...(plan.note === undefined ? [] : [["Worktree name", plan.note]]),
    ].map(([label, value]) => [
      terminalLine(label ?? ""),
      terminalMultiline(value ?? ""),
    ]),
    width,
  });
  const text = composeFrames(
    [metadata, command, procedure, facts],
    viewportDimension(input.viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Render the task identity and created path after start completes. */
export function renderDeskCreatedTask(
  started: StartData,
  launch: DeskAgentLaunch | undefined,
  preauthorized: boolean,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const presenter = terminal.presenter;
  const metadata = presenter.present(renderTaskMetadataCli, {
    label: terminalLine("Created task"),
    outcome: terminalMultiline(started.task.brief ?? started.task.title),
    audience: terminalLine(launch?.providerLabel ?? "Project contributors"),
    prerequisites: terminalMultiline(
      started.task.created_from === undefined
        ? started.from
        : `${started.task.created_from.ref} at ${started.task.created_from.commit}`,
    ),
    complexity: terminalLine(`One isolated worktree (${started.id})`),
    fileEffects: "changes-files",
    retrySafety: "check-first",
    expectedState: terminalMultiline(
      launch === undefined
        ? "The task is ready in the desk"
        : `${launch.label} opens in the task worktree`,
    ),
    maxWidth: width,
  });
  const summary = presenter.present(renderResultSummaryCli, {
    state: "passed",
    fact: terminalLine(`Created ${started.task.title}`),
    nextAction: terminalLine(
      launch?.label ?? "Choose the next action from task detail",
    ),
    maxWidth: width,
  });
  const facts = presenter.present(renderTableCli, {
    caption: terminalLine("Created identity"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Fact") },
      { header: terminalLine("Value") },
    ],
    rows: [
      ["Worktree id", started.id],
      ["Branch", started.branch],
      ["Path", started.path],
      ["Base", started.from],
      [
        "Landing authority",
        preauthorized
          ? "Committed source approved after checks pass"
          : "A later conversation must authorize landing",
      ],
      ...(started.name_note === undefined
        ? []
        : [["Worktree name", started.name_note]]),
    ].map(([label, value]) => [
      terminalLine(label ?? ""),
      terminalMultiline(value ?? ""),
    ]),
    width,
  });
  const text = composeFrames(
    [metadata, summary, facts],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Render a stored brief at the last boundary before an agent process opens. */
export function renderDeskAgentHandoff(
  task: Pick<StartData["task"], "title" | "brief">,
  launch: DeskAgentLaunch,
  briefPassed: boolean,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame | undefined {
  const brief = task.brief;
  if (brief === undefined) return undefined;
  const handoff = terminal.presenter.present(renderAgentHandoffCli, {
    title: terminalLine(task.title),
    prompt: terminalMultiline(brief),
    description: terminalMultiline(
      briefPassed
        ? `discern passes this stored brief through ${launch.providerLabel}'s documented prompt option.`
        : `Copy this stored brief into the session. ${launch.providerLabel}'s configured command does not declare a prompt option.`,
    ),
    maxWidth: viewportDimension(viewport.columns),
  });
  return { text: handoff, rows: frameRows(handoff) };
}

/** Render one worktree-less branch before its read or resume actions. */
export function renderDeskUnlandedBranchDetail(
  branch: string,
  trunk: string,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const heading = terminal.presenter.present(renderHeadingCli, {
    text: terminalLine(branch),
    level: 1,
    leadingBlankLines: 0,
    overflow: "wrap",
    maxWidth: width,
  });
  const summary = terminal.presenter.present(renderResultSummaryCli, {
    state: "declared",
    fact: terminalLine("Committed branch has no worktree"),
    nextAction: terminalLine("Resume in a worktree or inspect its commits"),
    maxWidth: width,
  });
  const facts = terminal.presenter.present(renderTableCli, {
    caption: terminalLine("Branch facts"),
    layout: "responsive",
    columns: [
      { header: terminalLine("Fact") },
      { header: terminalLine("Value") },
    ],
    rows: [
      [terminalLine("Branch"), terminalLine(branch)],
      [terminalLine("Compared with"), terminalLine(trunk)],
      [terminalLine("Worktree"), terminalLine("None")],
    ],
    width,
  });
  const text = composeFrames(
    [heading, summary, facts],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Proof-first review composed only from package Components and stored evidence. */
export function renderDeskReview(
  row: DeskRow,
  review: DeskReview,
  viewport: TerminalSize,
  terminal: TerminalContext,
): DeskRenderedFrame {
  const width = viewportDimension(viewport.columns);
  const presenter = terminal.presenter;
  const proof = review.proof;
  const proofPage = proof.proof ?? proof.proof_data?.markdown;
  const proofLineSource = proof.proof_line ?? proof.proof_data?.line;
  const heading = presenter.present(renderHeadingCli, {
    text: terminalLine(`Review ${row.task.name}`),
    level: 1,
    leadingBlankLines: 0,
    overflow: "wrap",
    maxWidth: width,
  });
  const proofReport = presenter.present(renderProofCli, {
    title: terminalLine("Proof"),
    ...(proof.status === "honored" ? { stamp: "pass" as const } : {}),
    checks: [{
      label: terminalLine("Currency"),
      state: PROOF_STATE[proof.status],
      stateLabel: terminalLine(row.decision.proof.summary),
      ...(proof.reason === undefined
        ? {}
        : { value: terminalMultiline(proof.reason) }),
    }, {
      label: terminalLine("Stored page"),
      state: proofPage === undefined ? "skip" : "pass",
      stateLabel: terminalLine(
        proofPage === undefined ? "not recorded" : "available",
      ),
    }],
    meta: [
      ...(proof.head === undefined ? [] : [{
        label: terminalLine("Current commit"),
        value: terminalLine(proof.head),
      }]),
      ...(proof.recorded === undefined ? [] : [{
        label: terminalLine("Recorded commit"),
        value: terminalLine(proof.recorded),
      }]),
    ],
    maxWidth: width,
  });
  const proofLine = proofLineSource === undefined
    ? []
    : [renderProofLineCli(proofLineSource, terminal, width)];
  const diffstat = presenter.present(renderDiffstatCli, {
    added: review.insertions,
    removed: review.deletions,
    maxWidth: width,
  });
  const files = review.files.map((file) =>
    presenter.present(renderFileChangeCli, {
      path: terminalLine(file.path),
      disposition: file.disposition,
      ...(file.added === undefined || file.removed === undefined
        ? {}
        : { magnitude: { added: file.added, removed: file.removed } }),
      maxWidth: width,
    })
  );
  const uncommittedPaths = review.files.filter((file) => file.uncommitted);
  const uncommitted = uncommittedPaths.length === 0
    ? []
    : [presenter.present(renderRawOutputCli, {
      output: terminalMultiline(
        uncommittedPaths.map((file) => file.path).join("\n"),
      ),
      label: terminalLine("Uncommitted paths"),
      expanded: true,
      maxWidth: width,
    })];
  const commits = presenter.present(renderRawOutputCli, {
    output: terminalMultiline(
      review.commits === "" ? "(none)" : review.commits,
    ),
    label: terminalLine(`Commits not on ${review.trunk}`),
    expanded: true,
    maxWidth: width,
  });
  const authority = presenter.present(renderResultSummaryCli, {
    state: row.decision.authority.status === "granted"
      ? "passed"
      : row.decision.authority.status === "unknown"
      ? "blocked"
      : "declared",
    fact: terminalMultiline(row.decision.authority.summary),
    ...(row.decision.authority.uncoveredPaths.length === 0 ? {} : {
      nextAction: terminalMultiline(
        `Owner approval remains for ${
          row.decision.authority.uncoveredPaths.join(", ")
        }`,
      ),
    }),
    maxWidth: width,
  });
  const collisions = row.decision.collisions.length === 0
    ? []
    : [presenter.present(renderRawOutputCli, {
      output: terminalMultiline(
        row.decision.collisions.map((collision) =>
          collision.kind === "changed_files"
            ? `${collision.otherBranch}: ${
              collision.paths.join(", ") ||
              `${collision.total} overlapping files`
            }`
            : `ADR ${collision.number}: ${collision.otherBranches.join(", ")}`
        ).join("\n"),
      ),
      label: terminalLine("Collision context"),
      expanded: true,
      maxWidth: width,
    })];
  const meters = (proof.proof_data?.standard_proposals ?? []).map((proposal) =>
    presenter.present(renderStandardMeterCli, {
      label: terminalLine(`${proposal.standard} · proposal evidence`),
      value: proposal.measurement,
      limit: proposal.proposed_limit,
      direction: proposal.direction === "up" ? "floor" : "ceiling",
      trend: "drifting",
      register: "brand",
      maxWidth: width,
    })
  );
  const page = proofPage === undefined ? [] : [renderMarkdown(proofPage, {
    color: terminal.color,
    width,
    terminal,
  })];
  const failures = review.failures.flatMap((failure) => [
    presenter.present(renderDiagnosticCli, {
      title: terminalLine(failure.title),
      impact: terminalMultiline(
        "This review fact is unavailable; no empty-state claim was substituted.",
      ),
      correction: terminalMultiline(failure.nextAction),
      reproductionCommand: terminalLine(failure.command),
      workingDirectory: terminalLine(row.entry.path),
      rawDetail: terminalMultiline(failure.detail),
      rawLabel: terminalLine("Git output"),
      severity: "failure",
      maxWidth: width,
    }),
    presenter.present(renderRetryNoticeCli, {
      safeToRetry: failure.safeToRetry,
      reason: terminalMultiline("Retry after completing the next step above."),
      label: terminalLine(failure.title),
      maxWidth: width,
    }),
  ]);
  const text = composeFrames(
    [
      heading,
      proofReport,
      ...proofLine,
      ...page,
      diffstat,
      ...meters,
      commits,
      ...files,
      ...uncommitted,
      ...collisions,
      authority,
      ...failures,
    ],
    viewportDimension(viewport.rows),
  );
  return { text, rows: frameRows(text) };
}

/** Review routes retain unavailable editor evidence instead of hiding it. */
export function deskReviewGroups(
  review: DeskReview,
): SelectionGroup<string>[] {
  return [{
    id: "review-actions",
    label: "Review",
    items: [{
      name: "View actual diff",
      description: "Open the complete diff in the configured external pager.",
      value: DESK_REVIEW_ROUTES.diff,
    }, {
      name: "Open in editor",
      ...(review.editor === undefined
        ? {
          disabled: true,
          description: review.editorUnavailableReason ??
            "No available editor command is configured in $VISUAL or $EDITOR.",
        }
        : {
          description: `Run ${review.editor.command} in the task checkout.`,
        }),
      value: DESK_REVIEW_ROUTES.editor,
    }],
  }, {
    id: "review-navigation",
    label: "Task",
    items: [{ name: "Back", value: DESK_REVIEW_ROUTES.back }],
  }];
}

/** Map every action offer into its semantic picker group, including refusals. */
export function deskActionGroups(row: DeskRow): SelectionGroup<string>[] {
  return ACTION_GROUPS.flatMap((group) => {
    const offers = row.decision.actions.filter((offer) =>
      offer.group === group.id
    );
    if (offers.length === 0) return [];
    return [{
      id: `actions-${group.id}`,
      label: group.label,
      items: offers.map((offer) => ({
        name: offer.label,
        ...(offer.availability === "disabled"
          ? { description: offer.reason, disabled: true }
          : offer.recommended
          ? { description: "This action best fits the current task state." }
          : {}),
        value: offer.action as string,
      })),
    }];
  });
}
