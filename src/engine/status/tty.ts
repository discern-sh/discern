/**
 * Static human dashboard for `discern status`.
 *
 * The result core owns every observed fact, and `row_states.ts` owns every
 * row's state, label, glyph, group, and sentences. This module owns only their
 * pure presentation: grouped ordering, responsive layout, semantic color, and
 * wrapped prose. Width, color, and time are injected so a test can exercise
 * every layout without a terminal or filesystem.
 */

import { landedExceptionSentence } from "./landed_exception.ts";
import { basename } from "@std/path";
import {
  renderDiagnosticCli,
  renderDiffstatCli,
  renderEmptyStateCli,
  renderHeadingCli,
  renderListCli,
  renderParagraphCli,
  renderRawOutputCli,
  renderResultSummaryCli,
  renderSectionCli,
  renderVerificationReportCli as renderReportCli,
} from "discern-design-system/cli";
import {
  firedHintsFromTexts,
  type HintCategory,
  HINTS,
  interactiveHints,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import type {
  GateProofCheckStatus,
  StatusData,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import {
  type TerminalContext,
  type TerminalLine,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import { compactDuration } from "../output.ts";
import { landingQueueLines } from "./queue_presentation.ts";
import { isScopeMarker } from "../scopes/scopes.ts";
import { taskLabel } from "../worktree/task_label.ts";
import {
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import { degradedFleetKind } from "./recovery_presentation.ts";
import { renderSetupStatus } from "./setup_presentation.ts";
import { FLEET_ROW_GROUP_TITLES } from "./row_states.ts";
import type { FleetTaskRowStateId } from "./row_sentences.ts";
import { relativeAge } from "./row_facts.ts";
import {
  divergence,
  fileCount,
  type FleetRowPresentation,
  presentFleetRow,
  sortFleetRows,
  speaksForAnotherRow,
} from "./fleet_rows.ts";
import {
  FLEET_ROW_GROUPS,
  type FleetRowGroup,
} from "../../shared/fleet_row_vocabulary.ts";

/** Very wide terminals still get a report whose related fields stay together. */
export const STATUS_REPORT_MAX_WIDTH = 104;

export interface StatusDashboardOptions {
  terminal: TerminalContext;
  width: number;
  verbose?: boolean;
  nowMs: number;
  /** The result core's current-source landing and checkout explanation. */
  message?: string;
}

const BACKTICKED_DISCERN_COMMAND = /`(discern(?:[ \t]+[^`\r\n]+)?)`/gu;

/** Highlight actionable discern commands while preserving their backticks and
 * exact copyable text. Styling each non-space token separately prevents a wrap
 * between command words from leaking color into the next terminal line. */
function styledDiscernCommands(
  text: string,
  terminal: TerminalContext,
): string {
  return text.replace(
    BACKTICKED_DISCERN_COMMAND,
    (_match: string, command: string): string =>
      `\`${
        command.split(/([ \t]+)/u).map((part) =>
          /^[ \t]+$/u.test(part) ? part : terminal.tone(part, "accent")
        ).join("")
      }\``,
  );
}

type StatusComponent = string;

/** Join complete package-rendered blocks. Stack cannot nest presenter output
 * because its control-free input contract rejects semantic ANSI styling. */
function componentStack(
  components: readonly StatusComponent[],
): string {
  return components.join("\n\n");
}

/** Compose one dashboard section through the package Section authority. */
function section(
  label: string,
  components: readonly StatusComponent[],
  terminal: TerminalContext,
  width: number,
): string {
  const heading = terminal.presenter.present(renderSectionCli, {
    title: terminalLine(label),
    body: terminalMultiline(""),
    treatment: "quiet-rule",
    register: "brand",
    width,
  });
  return componentStack([heading, ...components]);
}

/** Exhaustive adaptation into Result summary's outcome vocabulary. */
export const FLEET_ROW_RESULT_STATE = {
  broken: "failed",
  unreadable: "failed",
  "setup-retry": "blocked",
  "setup-manual": "blocked",
  "setup-unknown": "blocked",
  landing: "changed",
  exception: "blocked",
  interrupted: "blocked",
  checking: "changed",
  updating: "changed",
  running: "changed",
  "checks-failed": "failed",
  "land-failed": "failed",
  failed: "failed",
  "awaiting-owner": "passed",
  refused: "blocked",
  "stale-proven": "blocked",
  stale: "blocked",
  editing: "changed",
  queued: "passed",
  approved: "passed",
  ready: "passed",
  behind: "blocked",
  "proof-error": "failed",
  "proof-unknown": "blocked",
  recheck: "blocked",
  "needs-checks": "blocked",
  contained: "unchanged",
  empty: "unchanged",
  "idle-unknown": "unchanged",
} as const satisfies Readonly<
  Record<
    FleetTaskRowStateId,
    "passed" | "failed" | "blocked" | "changed" | "unchanged"
  >
>;

/** Exhaustive Proof-state adaptation into package check semantics. */
export const STATUS_PROOF_STATE = {
  honored: "pass",
  report_only: "fail",
  missing: "skip",
  stale: "fail",
  dirty: "skip",
  unavailable: "fail",
  read_failed: "fail",
} as const satisfies Readonly<
  Record<GateProofCheckStatus, "pass" | "fail" | "skip">
>;

/** State label for Fleet, with the elapsed time while a verb runs and, when
 * asked, the state's qualifier. */
function fleetStatusLabel(
  row: FleetRowPresentation,
  qualified = false,
): string {
  const running = row.entry.running;
  const elapsed = running === undefined || row.kind !== "running"
    ? ""
    : ` · ${compactDuration(running.elapsed_ms)}`;
  const qualifier = qualified && row.qualifier !== undefined
    ? ` · ${row.qualifier}`
    : "";
  return `${row.label}${elapsed}${qualifier}${
    row.entry.is_current ? " · current" : ""
  }`;
}

/** Render one row's nonzero divergence with the active terminal repertoire. */
function rowDivergence(
  row: FleetRowPresentation,
  unicode: boolean,
): string {
  const values = [
    ...(row.entry.ahead === UNKNOWN_GIT_COUNT
      ? [`${unicode ? "↑" : "+"}?`]
      : row.entry.ahead !== undefined &&
          isPositiveGitCount(row.entry.ahead)
      ? [`${unicode ? "↑" : "+"}${row.entry.ahead}`]
      : []),
    ...(row.entry.behind === UNKNOWN_GIT_COUNT
      ? [`${unicode ? "↓" : "-"}?`]
      : row.entry.behind !== undefined &&
          isPositiveGitCount(row.entry.behind)
      ? [`${unicode ? "↓" : "-"}${row.entry.behind}`]
      : []),
  ];
  return values.length === 0 ? unicode ? "—" : "-" : values.join(" ");
}

/** Apply design-system semantic tones to divergence without changing its
 * complete arrow-and-count text. */
function styledDriftArrows(
  text: string,
  terminal: TerminalContext,
): string {
  return text
    .replace(
      /(DRIFT (?:[↑+]\d+\s+)?)([↓-]\d+)/gu,
      (_match, prefix: string, behind: string) =>
        `${prefix}${terminal.tone(behind, "warning")}`,
    )
    .replace(
      /(DRIFT )([↑+]\d+)/gu,
      (_match, prefix: string, ahead: string) =>
        `${prefix}${terminal.tone(ahead, "accent")}`,
    );
}

/** Pair every state with its glyph, or its ASCII form, and complete label. */
function rowStateCue(
  row: FleetRowPresentation,
  unicode: boolean,
): string {
  return `${unicode ? row.glyph : row.ascii} ${fleetStatusLabel(row)}`;
}

/** Human task names, adding minted tails only when visible names collide. */
function displayTaskNames(
  rows: readonly FleetRowPresentation[],
): string[] {
  const labels = rows.map((row) => taskLabel(row.entry));
  const nameCounts = new Map<string, number>();
  for (const label of labels) {
    nameCounts.set(label.name, (nameCounts.get(label.name) ?? 0) + 1);
  }
  return labels.map((label) =>
    (nameCounts.get(label.name) ?? 0) > 1 &&
      label.disambiguator !== undefined
      ? `${label.name} · ${label.disambiguator}`
      : label.name
  );
}

/** The groups whose rows wait on the owner: what "need you" counts. */
const NEEDS_YOU: ReadonlySet<FleetRowGroup> = new Set(["review", "attention"]);

interface NamedRow {
  readonly row: FleetRowPresentation;
  readonly name: string;
}

/** One group's heading: its title, then its count. */
function groupHeading(
  group: FleetRowGroup,
  count: number,
  terminal: TerminalContext,
): string {
  return `${terminal.role(FLEET_ROW_GROUP_TITLES[group], "strong")}  ${
    terminal.role(String(count), "muted")
  }`;
}

/** One line per row: name, state, drift, and activity. */
function rowList(
  rows: readonly NamedRow[],
  width: number,
  terminal: TerminalContext,
): string {
  const list = terminal.presenter.present(renderListCli, {
    kind: "unordered",
    spacing: "tight",
    items: rows.map(({ row, name }) => ({
      content: terminalLine(
        `${name} · ${rowStateCue(row, terminal.capabilities.unicode)} · DRIFT ${
          rowDivergence(row, terminal.capabilities.unicode)
        } · Activity: ${row.activity}`,
      ),
    })),
    maxWidth: width,
  });
  return styledDriftArrows(list, terminal);
}

/** The expanded evidence for one row: its state and next step, then its
 * identity, landing, queue, and Proof facts. */
function rowDetails(
  { row, name }: NamedRow,
  width: number,
  terminal: TerminalContext,
): StatusComponent[] {
  const summary = terminal.presenter.present(renderResultSummaryCli, {
    state: FLEET_ROW_RESULT_STATE[row.state],
    fact: terminalLine(
      `${name} · ${fleetStatusLabel(row, true)}. ${row.explanation}`,
    ),
    counts: [
      { label: terminalLine("Git"), value: terminalLine(row.git) },
      { label: terminalLine("Activity"), value: terminalLine(row.activity) },
    ],
    ...(row.attention === undefined
      ? {}
      : { nextAction: terminalMultiline(row.attention) }),
    maxWidth: width,
  });
  const facts: ReadonlyArray<readonly [string, string | undefined]> = [
    ["Worktree", row.identity.worktree],
    ["Branch", row.identity.primary],
    ["Landing", row.authority],
    ["Queue", row.queue],
    ["Contained in", row.entry.contained_in],
    ...row.collisions.map((collision) =>
      [
        "Shares files with",
        `${collision.branch} · ${collision.total} shared file${
          collision.total === 1 ? "" : "s"
        }`,
      ] as const
    ),
  ];
  const proofReport = terminal.presenter.present(renderReportCli, {
    title: terminalLine(`${name} Proof`),
    checks: [{
      label: terminalLine("Proof"),
      state: STATUS_PROOF_STATE[row.proof.status],
      stateLabel: terminalLine(row.proof.label),
      ...(row.proof.status !== "stale" || row.proof.detail === undefined
        ? {}
        : { value: terminalLine(row.proof.detail) }),
    }],
    meta: facts.flatMap(([label, value]) =>
      value === undefined
        ? []
        : [{ label: terminalLine(label), value: terminalLine(value) }]
    ),
    maxWidth: width,
  });
  return [styledDiscernCommands(summary, terminal), proofReport];
}

/** Task labels lead the human list, grouped by who moves next; exact Git
 * identities remain in expanded evidence where they are actionable. */
function renderWorktrees(
  rows: readonly FleetRowPresentation[],
  width: number,
  terminal: TerminalContext,
  options: {
    readonly ownershipCaption: boolean;
    readonly expanded: boolean;
    readonly grouped: boolean;
  },
): StatusComponent[] {
  const displayNames = displayTaskNames(rows);
  const named = rows.map((row, index): NamedRow => ({
    row,
    name: displayNames[index] ?? row.identity.worktree,
  }));
  const groups = options.grouped
    ? FLEET_ROW_GROUPS.map((group) => ({
      group,
      members: named.filter(({ row }) => row.group === group),
    })).filter(({ members }) => members.length > 0)
    : [{ group: undefined, members: named }];
  const components = groups.flatMap(({ group, members }) => [
    group === undefined
      ? rowList(members, width, terminal)
      : `${groupHeading(group, members.length, terminal)}\n${
        rowList(members, width, terminal)
      }`,
    ...(options.expanded
      ? members.flatMap((member) => rowDetails(member, width, terminal))
      : []),
  ]);
  if (options.ownershipCaption) {
    components.push(
      terminal.presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine(
          "Worktrees stay with the effort that created them.",
        ),
        maxWidth: width,
      }),
    );
  }
  return components;
}

/** Lead fleet views with the count of tasks waiting on the owner. */
function renderFleetSummary(
  rows: readonly FleetRowPresentation[],
  width: number,
  c: TerminalContext,
): StatusComponent {
  const needYou = rows.filter((row) => NEEDS_YOU.has(row.group)).length;
  const summary = [
    `${rows.length} active worktree${rows.length === 1 ? "" : "s"}`,
    ...(needYou === 0
      ? []
      : [`${needYou} ${needYou === 1 ? "needs" : "need"} you`]),
  ].join(" · ");
  return c.presenter.present(renderParagraphCli, {
    content: terminalLine(`Fleet · ${summary}`),
    maxWidth: width,
  });
}

/** Render prose items through the package List authority. */
function renderTextList(
  items: readonly string[],
  width: number,
  c: TerminalContext,
): StatusComponent {
  return styledDiscernCommands(
    c.presenter.present(renderListCli, {
      kind: "unordered",
      spacing: "loose",
      items: items.map((item) => ({ content: terminalLine(item) })),
      maxWidth: width,
    }),
    c,
  );
}

/** Pairwise conditions affect landing order; they never replace a worktree's
 * own state in the Fleet row. Complete paths remain in the expanded view. */
function renderLandingRiskBrief(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusComponent[] {
  const items = [
    ...(data.fleet_collisions ?? []).map((collision) =>
      `${collision.branches.join(" ↔ ")} · ${collision.total} shared file${
        collision.total === 1 ? "" : "s"
      }. Whoever lands second should run \`discern update\` and re-read the reported paths.`
    ),
    ...(data.adr_collisions ?? []).map((collision) =>
      `ADR ${collision.number} is claimed by ${
        collision.branches.join(" ↔ ")
      }. Whoever lands second takes the next free record number.`
    ),
    ...(data.git?.incoming_overlap?.length
      ? [
        "The worktree and incoming trunk commits change the same paths. Re-read them after updating the branch.",
      ]
      : []),
  ];
  return items.length === 0 ? [] : [renderTextList(items, width, c)];
}

const LANDING_RISK_HINT_IDS = new Set([
  "status-fleet-collisions",
  "status-adr-number-collisions",
]);

const HINT_CATEGORY_BY_ID = new Map<string, HintCategory>(
  Object.values(HINTS).map((definition) => [
    definition.id,
    definition.category,
  ]),
);

interface StatusHintGroups {
  ownerAttention: string[];
  landingRisks: string[];
  nextActions: string[];
  notices: string[];
}

/** Recover typed hint intent before the terminal projection erases it. */
function groupStatusHints(
  texts: readonly string[] | undefined,
): StatusHintGroups {
  const groups: StatusHintGroups = {
    ownerAttention: [],
    landingRisks: [],
    nextActions: [],
    notices: [],
  };
  const fired = firedHintsFromTexts(texts);
  const registeredTexts = new Set(fired.map((hint) => hint.text));
  for (const hint of interactiveHints(fired)) {
    if (LANDING_RISK_HINT_IDS.has(hint.id)) {
      groups.landingRisks.push(hint.text);
      continue;
    }
    const category = HINT_CATEGORY_BY_ID.get(hint.id);
    if (category === "owner-attention") {
      groups.ownerAttention.push(hint.text);
    } else if (category === "notice") {
      groups.notices.push(hint.text);
    } else {
      groups.nextActions.push(hint.text);
    }
  }
  const unknown = (texts ?? []).filter((text) => !registeredTexts.has(text));
  groups.nextActions.push(...interactiveHintTexts(unknown));
  return groups;
}

/** Render complete worktree evidence for the expanded dashboard. */
function renderWorktreeAttention(
  rows: readonly FleetRowPresentation[],
  data: StatusData,
  width: number,
  c: TerminalContext,
  nowMs: number,
): StatusComponent[] {
  const components: StatusComponent[] = [];
  for (const row of rows) {
    if (row.attention === undefined || !NEEDS_YOU.has(row.group)) continue;
    const diagnostic = c.presenter.present(renderDiagnosticCli, {
      title: terminalLine(
        `${row.identity.primary}: ${row.label}${
          row.entry.is_current ? " (current)" : ""
        }`,
      ),
      impact: terminalLine(
        `Git ${row.git}; Proof: ${row.proof.label}; ${row.activity}.`,
      ),
      correction: terminalMultiline(row.attention),
      severity: row.tones.glyph === "danger" ? "failure" : "attention",
      path: terminalLine(row.entry.path),
      maxWidth: width,
    });
    components.push(styledDiscernCommands(diagnostic, c));
  }
  for (const path of data.reappeared_worktree_paths ?? []) {
    const contents = path.contents.length === 0
      ? path.kind === "directory"
        ? path.entries === 0
          ? "empty directory"
          : `${path.entries} filesystem entr${path.entries === 1 ? "y" : "ies"}`
        : `path is a ${path.kind}`
      : `${path.contents.join(", ")}${
        path.contents_truncated ? " · more entries present" : ""
      }`;
    const correction = path.cleanup_blocked_reason === undefined
      ? "Inspect the current contents before removing the path."
      : `Kept: ${path.cleanup_blocked_reason}`;
    components.push(
      c.presenter.present(renderDiagnosticCli, {
        title: terminalLine(path.path),
        impact: terminalLine(
          `discern removed the worktree ${
            relativeAge(path.removed_at, nowMs)
          }; the path is present again. Contents: ${contents}.`,
        ),
        correction: terminalMultiline(correction),
        severity: "attention",
        path: terminalLine(path.path),
        maxWidth: width,
      }),
    );
  }
  return components;
}

/** Render complete collision paths for the expanded dashboard. */
function renderLandingRiskDetails(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusComponent[] {
  const components: StatusComponent[] = [];
  for (const collision of data.fleet_collisions ?? []) {
    const diagnostic = c.presenter.present(renderDiagnosticCli, {
      title: terminalLine("Fleet collision"),
      impact: terminalLine(
        `${collision.branches.join(" ↔ ")} change the same ${
          fileCount(collision.total)
        }.`,
      ),
      evidence: terminalMultiline(collision.overlap.join(", ")),
      correction: terminalMultiline(
        "Whoever lands second should run `discern update` and re-read these paths.",
      ),
      severity: "attention",
      maxWidth: width,
    });
    components.push(styledDiscernCommands(diagnostic, c));
  }
  for (const collision of data.adr_collisions ?? []) {
    components.push(
      c.presenter.present(renderDiagnosticCli, {
        title: terminalLine(
          `ADR ${collision.number} has multiple claims`,
        ),
        impact: terminalLine(
          `${collision.branches.join(", ")} claim the same record number.`,
        ),
        evidence: terminalMultiline(collision.paths.join(", ")),
        correction: terminalMultiline(
          "Whoever lands second takes the next free record number.",
        ),
        severity: "attention",
        maxWidth: width,
      }),
    );
  }
  if (data.git?.incoming_overlap?.length) {
    components.push(
      c.presenter.present(renderDiagnosticCli, {
        title: terminalLine("Incoming overlap"),
        impact: terminalLine(
          "The worktree and incoming trunk commits change the same paths.",
        ),
        evidence: terminalMultiline(data.git.incoming_overlap.join(", ")),
        correction: terminalMultiline(
          "Re-read the shared paths after updating the branch.",
        ),
        severity: "attention",
        maxWidth: width,
      }),
    );
  }
  return components;
}

/** Project local status facts through the same row classifier as the fleet. */
function localEntry(data: StatusData): StatusFleetEntry | undefined {
  if (data.location !== "worktree") return undefined;
  const fleetCurrent = data.fleet?.find((entry) =>
    !entry.is_main && entry.is_current
  );
  if (fleetCurrent !== undefined) return fleetCurrent;
  const git = data.git;
  return {
    path: data.root,
    is_main: false,
    is_current: true,
    branch: git?.branch ?? data.worktree?.branch ?? "",
    ...(git === null ? { git_unavailable: true } : {
      clean: git.clean,
      changed_files: git.changed_files,
      ...(git.ahead_trunk === null ? {} : { ahead: git.ahead_trunk }),
      ...(git.behind_trunk === null ? {} : { behind: git.behind_trunk }),
    }),
    ...(data.worktree?.id === undefined ? {} : { id: data.worktree.id }),
    ...(data.worktree?.port === undefined ? {} : { port: data.worktree.port }),
    ...(data.worktree?.read_failure === undefined
      ? {}
      : { read_failure: data.worktree.read_failure }),
    ...(data.gate_proof === undefined ? {} : { gate_proof: data.gate_proof }),
    ...(data.gate_proof?.status === "honored"
      ? {
        proof_honored: true,
        ...(data.gate_proof.proof === undefined
          ? {}
          : { proof: data.gate_proof.proof }),
        ...(data.gate_proof.proof_line === undefined
          ? {}
          : { proof_line: data.gate_proof.proof_line }),
      }
      : {}),
    ...(data.landing_authority === undefined
      ? {}
      : { landing_authority: data.landing_authority }),
  };
}

/** Configured trunk label available in every normal Git-backed result. */
function trunkOf(data: StatusData): string {
  return data.git?.trunk ?? "trunk";
}

/** The count naming what a checkout's own reads could not reach, if any. */
function unreadableCount(
  failure: StatusFleetEntry["read_failure"],
): Array<{ label: TerminalLine; value: TerminalLine }> {
  return failure === undefined ? [] : [{
    label: terminalLine("Unreadable"),
    value: terminalLine(failure.file ?? "checkout files"),
  }];
}

/** Show the main checkout once, directly under the report heading. */
function mainCheckoutLine(
  data: StatusData,
  width: number,
  c: TerminalContext,
): string {
  const git = data.git;
  if (git === null) {
    return c.presenter.present(renderResultSummaryCli, {
      state: "failed",
      fact: terminalLine("The main checkout is unreadable."),
      maxWidth: width,
    });
  }
  const counts = divergence(
    git.ahead_trunk === null ? undefined : git.ahead_trunk,
    git.behind_trunk === null ? undefined : git.behind_trunk,
  );
  const branch = git.branch === "" ? "(detached)" : git.branch;
  const readFailure = data.worktree?.read_failure;
  return c.presenter.present(renderResultSummaryCli, {
    state: readFailure !== undefined
      ? "failed"
      : git.clean
      ? "unchanged"
      : "changed",
    fact: terminalLine(
      git.clean
        ? `Main checkout ${branch} is clean and current.`
        : `Main checkout ${branch} has ${fileCount(git.changed_files)}.`,
    ),
    counts: [
      ...(counts === ""
        ? []
        : [{ label: terminalLine("Drift"), value: terminalLine(counts) }]),
      ...unreadableCount(readFailure),
    ],
    maxWidth: width,
  });
}

/** Render the main checkout outside the worktree list for `--all` worktree views. */
function surveyedMainCheckout(
  entry: StatusFleetEntry,
  width: number,
  nowMs: number,
  c: TerminalContext,
): StatusComponent[] {
  const state = entry.git_unavailable === true
    ? "unreadable"
    : entry.clean === true
    ? "clean"
    : fileCount(entry.changed_files ?? 0);
  const counts = divergence(entry.ahead, entry.behind);
  const activity = relativeAge(entry.last_activity, nowMs);
  return [c.presenter.present(renderResultSummaryCli, {
    state: degradedFleetKind(entry) !== undefined
      ? "failed"
      : entry.clean === true
      ? "unchanged"
      : "changed",
    fact: terminalLine("The main checkout is outside the active fleet."),
    counts: [
      { label: terminalLine("Git"), value: terminalLine(state) },
      ...(counts === ""
        ? []
        : [{ label: terminalLine("Drift"), value: terminalLine(counts) }]),
      ...unreadableCount(entry.read_failure),
      ...(activity === "—" ? [] : [{
        label: terminalLine("Activity"),
        value: terminalLine(activity),
      }]),
    ],
    maxWidth: width,
  })];
}

/** Lower-priority configured-scope, gate, and standards facts. */
function renderChecks(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusComponent[] {
  const counts: Array<{ label: string; value: string }> = [];
  const changedScopes = (data.scopes ?? []).filter((scope) =>
    !isScopeMarker(scope)
  );
  if (changedScopes.length > 0) {
    counts.push({ label: "Changed scopes", value: changedScopes.join(", ") });
  }
  for (const action of data.preview_actions ?? []) {
    counts.push({
      label: `Preview ${action.scope}`,
      value: `${action.command} (not run)`,
    });
  }
  if (data.gate !== undefined) {
    const jobs = data.gate.jobs.length === 0
      ? "no jobs configured"
      : data.gate.jobs.join(", ");
    const scopes = data.gate.scope_gates.length === 0
      ? ""
      : ` · scope gates: ${data.gate.scope_gates.join(", ")}`;
    counts.push({ label: "Gate", value: `${jobs}${scopes}` });
  }
  counts.push({
    label: "Standards",
    value: `${data.standards.length} configured`,
  });
  return [c.presenter.present(renderResultSummaryCli, {
    state: changedScopes.length > 0 ? "changed" : "unchanged",
    fact: terminalLine("Configured checks for this status result."),
    counts: counts.map((count) => ({
      label: terminalLine(count.label),
      value: terminalLine(count.value),
    })),
    maxWidth: width,
  })];
}

/** Checkout-local runtime coordinates, separate from quality checks. */
function renderLocalEnvironment(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusComponent[] {
  if (data.worktree !== null) {
    const resources = Object.entries(data.worktree.resources);
    const readFailure = data.worktree.read_failure;
    return [c.presenter.present(renderResultSummaryCli, {
      state: readFailure === undefined ? "unchanged" : "failed",
      fact: terminalLine(
        data.location === "main"
          ? `${data.worktree.id} is the trunk checkout identity.`
          : readFailure !== undefined
          ? `${data.worktree.id} is this worktree's derived identity.`
          : `${data.worktree.id} has a provisioned local environment.`,
      ),
      counts: [
        {
          label: terminalLine("Port"),
          value: terminalLine(String(data.worktree.port)),
        },
        {
          label: terminalLine("Test seed"),
          value: terminalLine(String(data.worktree.seed)),
        },
        ...(resources.length === 0 ? [] : [{
          label: terminalLine("Resources"),
          value: terminalLine(
            resources.map(([name, value]) => `${name}=${value}`).join(", "),
          ),
        }]),
        ...unreadableCount(readFailure),
      ],
      maxWidth: width,
    })];
  }
  return [];
}

/** Useful landed-proof facts without exposing Git-note storage plumbing. */
function renderLastLanding(
  data: StatusData,
  width: number,
  c: TerminalContext,
  nowMs: number,
): StatusComponent[] {
  if (data.landed_proof !== undefined) {
    const proof = data.landed_proof.proof;
    const age = relativeAge(data.landed_proof.commit_at, nowMs);
    const landingReport = c.presenter.present(renderReportCli, {
      title: terminalLine("Last landing"),
      stamp: "pass",
      meta: [
        { label: terminalLine("Branch"), value: terminalLine(proof.branch) },
        { label: terminalLine("Commit"), value: terminalLine(proof.head) },
        ...(age === "—"
          ? []
          : [{ label: terminalLine("Age"), value: terminalLine(age) }]),
      ],
      checks: [{
        label: terminalLine("Files"),
        state: "pass",
        value: terminalLine(fileCount(proof.files_total)),
      }],
      maxWidth: width,
    });
    const changedLines = proof.insertions + proof.deletions;
    return [
      landingReport,
      ...(changedLines === 0 ? [] : [
        c.presenter.present(renderDiffstatCli, {
          added: proof.insertions,
          removed: proof.deletions,
          maxWidth: width,
        }),
      ]),
    ];
  }
  if (data.landed_proof_stale !== undefined) {
    return [
      c.presenter.present(renderResultSummaryCli, {
        state: "blocked",
        fact: terminalLine(
          `Landed Proof is stale: ${data.landed_proof_stale.reason}`,
        ),
        maxWidth: width,
      }),
    ];
  }
  if (data.landed_proof_unsupported !== undefined) {
    return [c.presenter.present(renderResultSummaryCli, {
      state: "blocked",
      fact: terminalLine(
        `Proof unavailable in this discern version (${data.landed_proof_unsupported.format}). Commit: ${
          data.landed_proof_unsupported.commit.slice(0, 12)
        }.`,
      ),
      maxWidth: width,
    })];
  }
  if (data.landed_exception !== undefined) {
    return [c.presenter.present(renderResultSummaryCli, {
      state: data.landed_exception.validation === "outstanding"
        ? "blocked"
        : "changed",
      fact: terminalLine(landedExceptionSentence(data.landed_exception)),
      maxWidth: width,
    })];
  }
  return [];
}

/** Copyable stored Markdown pages shown only under `--verbose`. */
function renderVerboseProofs(
  data: StatusData,
  rows: readonly FleetRowPresentation[],
  c: TerminalContext,
): StatusComponent[] {
  const blocks: StatusComponent[] = [];
  const add = (label: string, page: string | undefined): void => {
    if (page === undefined) return;
    blocks.push(
      c.presenter.present(renderRawOutputCli, {
        label: terminalLine(label),
        output: terminalMultiline(page),
        expanded: true,
        maxWidth: STATUS_REPORT_MAX_WIDTH,
      }),
    );
  };
  add("Last landed Proof", data.landed_proof?.proof.markdown);
  add("Current worktree Proof", data.gate_proof?.proof);
  for (const row of rows) {
    add(`Proof · ${row.identity.primary}`, row.entry.proof);
  }
  return blocks;
}

/** Sanitize and cap the caller-measured terminal width. */
function reportWidth(width: number): number {
  const finite = Number.isFinite(width) ? Math.floor(width) : 80;
  return Math.max(1, Math.min(finite, STATUS_REPORT_MAX_WIDTH));
}

/** Render one complete static dashboard. Every fact comes from `data`; this
 * function performs no Git, proof, authority, collision, or logbook reads. */
export function renderStatusDashboard(
  data: StatusData,
  hints: readonly string[] | undefined,
  options: StatusDashboardOptions,
): string {
  const width = reportWidth(options.width);
  const nowMs = options.nowMs;
  const c = options.terminal;
  const compactFleet = data.location === "main" && data.fleet !== undefined &&
    options.verbose !== true;
  const project = terminalLine(
    data.project ?? (basename(data.root) || data.root),
  );
  const heading = c.presenter.present(renderHeadingCli, {
    text: terminalLine(`discern status · ${project}`),
    level: 1,
    leadingBlankLines: 0,
  });
  const blocks: StatusComponent[] = [heading];
  if (options.message !== undefined) {
    blocks.push(c.presenter.present(renderParagraphCli, {
      content: terminalMultiline(options.message),
      maxWidth: width,
    }));
  }

  if (data.location === "main") {
    blocks.push(mainCheckoutLine(data, width, c));
  }
  const setup = renderSetupStatus(data, width, c);
  if (setup.length > 0) blocks.push(section("Setup", setup, c, width));

  const trunk = trunkOf(data);
  const surveyed = (data.fleet ?? []).filter((entry) => !entry.is_main);
  const queue = data.queue === undefined ? {} : { queue: data.queue };
  const fleetRows = sortFleetRows(
    surveyed
      .filter((entry) => !speaksForAnotherRow(entry, surveyed))
      .map((entry) =>
        presentFleetRow(entry, {
          trunk,
          nowMs,
          fleet: surveyed,
          ...queue,
          ...(data.fleet_collisions === undefined
            ? {}
            : { collisions: data.fleet_collisions }),
        })
      ),
  );
  const local = data.fleet === undefined ? localEntry(data) : undefined;
  const localRows = local === undefined
    ? []
    : [presentFleetRow(local, { trunk, nowMs, ...queue })];
  const shownRows = fleetRows.length > 0 ? fleetRows : localRows;
  const hintGroups = groupStatusHints(hints);
  const fleetTaskNames = displayTaskNames(fleetRows);

  if (data.fleet !== undefined) {
    blocks.push(renderFleetSummary(fleetRows, width, c));
    blocks.push(
      fleetRows.length > 0
        ? section(
          "Worktrees",
          renderWorktrees(fleetRows, width, c, {
            ownershipCaption: data.location === "worktree" &&
              fleetRows.some((row) => !row.entry.is_current),
            expanded: !compactFleet,
            grouped: true,
          }),
          c,
          width,
        )
        : c.presenter.present(renderEmptyStateCli, {
          title: terminalLine("No active worktrees"),
          width,
        }),
    );
  } else if (localRows.length > 0) {
    blocks.push(
      section(
        "Current worktree",
        renderWorktrees(localRows, width, c, {
          ownershipCaption: false,
          expanded: true,
          grouped: false,
        }),
        c,
        width,
      ),
    );
  }

  // The landing queue, in order: the selected effort is marked, and each row
  // carries its readiness and the single reason it waits.
  const queueLines = landingQueueLines(data);
  if (queueLines.length > 0) {
    blocks.push(section(
      "Landing queue",
      [renderTextList(queueLines, width, c)],
      c,
      width,
    ));
  }

  if (compactFleet) {
    const laggingOwners = fleetRows.flatMap((row, index) =>
      row.state === "behind" && row.attention !== undefined
        ? [
          `${fleetTaskNames[index] ?? row.identity.worktree}: ${row.attention}`,
        ]
        : []
    );
    const ownerAttention = [
      ...hintGroups.ownerAttention,
      ...laggingOwners,
    ];
    if (ownerAttention.length > 0) {
      blocks.push(section(
        "Owner attention",
        [renderTextList(ownerAttention, width, c)],
        c,
        width,
      ));
    }
    const landingRisks = renderLandingRiskBrief(data, width, c);
    if (landingRisks.length > 0 || hintGroups.landingRisks.length > 0) {
      blocks.push(section(
        "Landing risks",
        landingRisks.length > 0
          ? landingRisks
          : [renderTextList(hintGroups.landingRisks, width, c)],
        c,
        width,
      ));
    }
  } else {
    const attention = [
      ...renderWorktreeAttention(
        shownRows,
        data,
        width,
        c,
        nowMs,
      ),
      ...(hintGroups.ownerAttention.length === 0
        ? []
        : [renderTextList(hintGroups.ownerAttention, width, c)]),
    ];
    if (attention.length > 0) {
      blocks.push(section("Owner attention", attention, c, width));
    }
    const landingRisks = [
      ...renderLandingRiskDetails(data, width, c),
      ...((data.fleet_collisions?.length ?? 0) === 0 &&
          (data.adr_collisions?.length ?? 0) === 0 &&
          (data.git?.incoming_overlap?.length ?? 0) === 0 &&
          hintGroups.landingRisks.length > 0
        ? [renderTextList(hintGroups.landingRisks, width, c)]
        : []),
    ];
    if (landingRisks.length > 0) {
      blocks.push(section("Landing risks", landingRisks, c, width));
    }
  }

  const surveyedMain = data.location === "worktree"
    ? data.fleet?.find((entry) => entry.is_main)
    : undefined;
  if (surveyedMain !== undefined) {
    blocks.push(
      section(
        "Main checkout",
        surveyedMainCheckout(surveyedMain, width, nowMs, c),
        c,
        width,
      ),
    );
  }

  if (hintGroups.nextActions.length > 0) {
    blocks.push(section(
      hintGroups.nextActions.length === 1 ? "Next action" : "Next actions",
      [renderTextList(hintGroups.nextActions, width, c)],
      c,
      width,
    ));
  }
  if (hintGroups.notices.length > 0) {
    blocks.push(section(
      "Notes",
      [renderTextList(hintGroups.notices, width, c)],
      c,
      width,
    ));
  }

  if (!compactFleet) {
    const checks = renderChecks(data, width, c);
    if (checks.length > 0) blocks.push(section("Checks", checks, c, width));
    const environment = renderLocalEnvironment(data, width, c);
    if (environment.length > 0) {
      blocks.push(section("Local environment", environment, c, width));
    }
    const landing = renderLastLanding(data, width, c, nowMs);
    if (landing.length > 0) blocks.push(section("Landing", landing, c, width));
  }

  if (options.verbose === true) {
    const proofs = renderVerboseProofs(data, shownRows, c);
    if (proofs.length > 0) {
      blocks.push(section("Proofs", proofs, c, width));
    }
  }
  return `${componentStack(blocks)}\n`;
}
