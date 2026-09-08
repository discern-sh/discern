/**
 * Static human dashboard for `discern status`.
 *
 * The result core owns every observed fact. This module owns only their pure
 * presentation: row classification, importance ordering, responsive layout,
 * semantic color, and wrapped prose. Width, color, and time are injected so a
 * test can exercise every layout without a terminal or filesystem.
 */

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
  GateProofCheckData,
  GateProofCheckStatus,
  StatusData,
  StatusFleetCollision,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import {
  type TerminalContext,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import { compactDuration } from "../output.ts";
import { isScopeMarker } from "../scopes/scopes.ts";
import { taskLabel } from "../worktree/task_label.ts";
import { isReadyToLand } from "../worktree/readiness.ts";
import {
  type GitCount,
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import {
  degradedFleetAttention,
  degradedFleetKind,
} from "./recovery_presentation.ts";
import { renderSetupStatus } from "./setup_presentation.ts";

/** Very wide terminals still get a report whose related fields stay together. */
export const STATUS_REPORT_MAX_WIDTH = 104;

/** Fleet activity older than this is stale when unlanded work remains. */
export const STALE_WORKTREE_DAYS = 7;

/** The closed human-status vocabulary. Renderer tests key their state matrix to
 * this tuple, so a new semantic state cannot bypass the width and text guards. */
export const FLEET_ROW_STATUS_KINDS = [
  "broken",
  "setup-incomplete",
  "unreadable",
  "failed",
  "blocked",
  "behind",
  "ready",
  "running",
  "stale",
  "in-progress",
  "proof-unreadable",
  "proof-unavailable",
  "proof-stale",
  "needs-gate",
  "idle",
] as const;

export type FleetRowStatusKind = (typeof FLEET_ROW_STATUS_KINDS)[number];
export type FleetRowTone = "red" | "cyan" | "yellow" | "green" | "dim";

interface StatusMeta {
  label: string;
  glyph: string;
  tone: FleetRowTone;
  priority: number;
}

const STATUS_META = {
  broken: { label: "Broken", glyph: "✗", tone: "red", priority: 0 },
  "setup-incomplete": {
    label: "Setup incomplete",
    glyph: "!",
    tone: "yellow",
    priority: 0,
  },
  unreadable: { label: "Unreadable", glyph: "✗", tone: "red", priority: 0 },
  failed: { label: "Failed", glyph: "✗", tone: "red", priority: 0 },
  blocked: { label: "Blocked", glyph: "!", tone: "yellow", priority: 1 },
  behind: { label: "Behind", glyph: "!", tone: "yellow", priority: 2 },
  ready: { label: "Ready", glyph: "✓", tone: "green", priority: 3 },
  running: { label: "Running", glyph: "●", tone: "cyan", priority: 4 },
  stale: { label: "Stale", glyph: "!", tone: "yellow", priority: 5 },
  "in-progress": {
    label: "In progress",
    glyph: "●",
    tone: "cyan",
    priority: 6,
  },
  "proof-unreadable": {
    label: "Proof unreadable",
    glyph: "✗",
    tone: "red",
    priority: 7,
  },
  "proof-unavailable": {
    label: "Proof unavailable",
    glyph: "!",
    tone: "yellow",
    priority: 8,
  },
  "proof-stale": {
    label: "Proof stale",
    glyph: "!",
    tone: "yellow",
    priority: 9,
  },
  "needs-gate": {
    label: "Needs gate",
    glyph: "!",
    tone: "yellow",
    priority: 10,
  },
  idle: { label: "Idle", glyph: "·", tone: "dim", priority: 11 },
} as const satisfies Record<FleetRowStatusKind, StatusMeta>;

interface RowIdentity {
  primary: string;
  /** Exact worktree id used as Fleet's persona identity. */
  worktree: string;
  secondary?: string;
}

interface ProofPresentation {
  status: GateProofCheckStatus;
  label: string;
  tone: FleetRowTone;
  detail?: string;
}

interface AuthorityPresentation {
  label: "granted" | "needs approval" | "scope-limited";
  tone: "green" | "yellow";
  detail?: string;
}

interface RowCollision {
  branch: string;
  overlap: readonly string[];
  total: number;
}

export interface FleetRowPresentation {
  entry: StatusFleetEntry;
  kind: FleetRowStatusKind;
  label: string;
  glyph: string;
  tone: FleetRowTone;
  priority: number;
  identity: RowIdentity;
  git: string;
  gitTone: FleetRowTone;
  proof: ProofPresentation;
  activity: string;
  /** Proof-backed landing readiness after the row's own state is classified. */
  landingReady: boolean;
  authority?: AuthorityPresentation;
  collisions: readonly RowCollision[];
  attention?: string;
}

export interface FleetRowPresentationOptions {
  trunk: string;
  nowMs: number;
  collisions?: readonly StatusFleetCollision[];
}

export interface StatusDashboardOptions {
  terminal: TerminalContext;
  width: number;
  verbose?: boolean;
  nowMs: number;
  /** The result core's current-source landing and checkout explanation. */
  message?: string;
}

/** Whole days since an ISO timestamp, or undefined when absent/unparseable. */
export function idleDaysOf(
  iso: string | undefined,
  nowMs: number,
): number | undefined {
  if (iso === undefined) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

/** A compact relative age for row activity. */
export function relativeAge(
  iso: string | undefined,
  nowMs: number,
): string {
  if (iso === undefined) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Human file-count phrase with a precise unit. */
function fileCount(count: number): string {
  return `${count} file${count === 1 ? "" : "s"} changed`;
}

/** Resolve the new full inspection field with compatibility fallbacks. */
function proofFromEntry(entry: StatusFleetEntry): GateProofCheckData {
  if (entry.gate_proof !== undefined) return entry.gate_proof;
  if (entry.proof_honored === true) {
    return {
      status: "honored",
      ...(entry.proof === undefined ? {} : { proof: entry.proof }),
      ...(entry.proof_line === undefined
        ? {}
        : { proof_line: entry.proof_line }),
    };
  }
  if (entry.clean === false) return { status: "dirty" };
  return {
    status: "unavailable",
    reason: "Proof state was not inspected",
  };
}

/** Project the proof-check vocabulary into a labelled, toned fact. */
function proofPresentation(entry: StatusFleetEntry): ProofPresentation {
  const proof = proofFromEntry(entry);
  const detail = proof.reason ?? (
    proof.status === "stale" && proof.recorded !== undefined &&
      proof.head !== undefined
      ? `recorded at ${proof.recorded.slice(0, 12)}; HEAD is ${
        proof.head.slice(0, 12)
      }`
      : undefined
  );
  const base = ((): Omit<ProofPresentation, "status" | "detail"> => {
    switch (proof.status) {
      case "honored":
        return { label: "honored", tone: "green" };
      case "report_only":
        return { label: "report only", tone: "yellow" };
      case "missing":
        return { label: "missing", tone: "dim" };
      case "stale":
        return { label: "stale", tone: "yellow" };
      case "dirty":
        return { label: "dirty worktree", tone: "dim" };
      case "unavailable":
        return { label: "unavailable", tone: "yellow" };
      case "read_failed":
        return { label: "unreadable", tone: "red" };
    }
  })();
  return {
    status: proof.status,
    ...base,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** Merge the ordinary id/branch pair while retaining a genuinely different id. */
function rowIdentity(entry: StatusFleetEntry): RowIdentity {
  const id = entry.id ?? basename(entry.path);
  const primary = entry.branch === "" ? "(detached)" : entry.branch;
  const equivalent = entry.branch !== "" &&
    (entry.branch === id || entry.branch === `agent/${id}`);
  return {
    primary,
    worktree: id,
    ...(!equivalent && id !== "" ? { secondary: id } : {}),
  };
}

/** Render nonzero ahead/behind dimensions as directional counts. */
function divergence(
  ahead: GitCount | undefined,
  behind: GitCount | undefined,
): string {
  return [
    ...(ahead === UNKNOWN_GIT_COUNT
      ? ["↑?"]
      : ahead !== undefined && isPositiveGitCount(ahead)
      ? [`↑${ahead}`]
      : []),
    ...(behind === UNKNOWN_GIT_COUNT
      ? ["↓?"]
      : behind !== undefined && isPositiveGitCount(behind)
      ? [`↓${behind}`]
      : []),
  ].join(" ");
}

/** Render Git state as one subordinate row fact. */
function gitPresentation(entry: StatusFleetEntry): string {
  if (entry.broken === true) return "unknown";
  if (entry.git_unavailable === true) return "unreadable";
  const state = entry.clean === true
    ? "clean"
    : entry.clean === false
    ? fileCount(entry.changed_files ?? 0)
    : "unknown";
  const counts = divergence(entry.ahead, entry.behind);
  return counts === "" ? state : `${state} · ${counts}`;
}

/** Semantic tone for the subordinate Git fact. */
function gitTone(entry: StatusFleetEntry): FleetRowTone {
  if (entry.broken === true || entry.git_unavailable === true) return "red";
  if (
    entry.clean === false || entry.behind === UNKNOWN_GIT_COUNT ||
    (entry.behind !== undefined && isPositiveGitCount(entry.behind))
  ) return "yellow";
  return "dim";
}

/** Combine running, last-command, and winning-activity clocks. */
function activityPresentation(entry: StatusFleetEntry, nowMs: number): string {
  if (entry.running !== undefined) {
    const typical = entry.running.typical_duration_ms === undefined
      ? ""
      : ` · usually ${compactDuration(entry.running.typical_duration_ms)}`;
    return `just now${typical}`;
  }
  const activityAge = relativeAge(entry.last_activity, nowMs);
  if (entry.last_action === undefined) {
    return activityAge === "—" ? "no activity recorded" : activityAge;
  }
  const failedStage = entry.last_action.failed_stage === undefined
    ? ""
    : ` at ${entry.last_action.failed_stage}`;
  const action =
    `last action ${entry.last_action.verb} ${entry.last_action.outcome}${failedStage}`;
  if (activityAge === "—") {
    return `${action} · ${relativeAge(entry.last_action.at, nowMs)}`;
  }
  return `${activityAge} · ${action}`;
}

/** Select collision facts that affect one branch. */
function rowCollisions(
  entry: StatusFleetEntry,
  collisions: readonly StatusFleetCollision[],
): RowCollision[] {
  if (entry.branch === "") return [];
  return collisions.flatMap((collision) => {
    const [left, right] = collision.branches;
    if (entry.branch === left) {
      return [{
        branch: right,
        overlap: collision.overlap,
        total: collision.total,
      }];
    }
    if (entry.branch === right) {
      return [{
        branch: left,
        overlap: collision.overlap,
        total: collision.total,
      }];
    }
    return [];
  });
}

/** Short landing-authority state plus optional wrapped detail. */
function authorityPresentation(
  entry: StatusFleetEntry,
  ready: boolean,
): AuthorityPresentation | undefined {
  if (!ready) return undefined;
  const authority = entry.landing_authority;
  if (authority?.kind === "authorized") {
    const detail = authority.source === "standing-grant"
      ? `standing grant${
        (authority.scopes?.length ?? 0) > 0
          ? ` for ${authority.scopes?.join(", ")}`
          : ""
      }`
      : authority.source === "effort-grant"
      ? "effort grant"
      : "conversation approval";
    return { label: "granted", tone: "green", detail };
  }
  if (authority?.kind === "conversation-required") {
    const standing = authority.standing_scopes?.length
      ? `standing grant for ${authority.standing_scopes.join(", ")}`
      : undefined;
    const uncovered = authority.uncovered?.map((item) =>
      `${item.path}${
        item.scopes.length > 0 ? ` (${item.scopes.join(", ")})` : ""
      }`
    );
    const warnings = authority.warnings ?? [];
    const details = [
      ...(standing === undefined ? [] : [standing]),
      ...((uncovered?.length ?? 0) === 0
        ? []
        : [`approval needed for ${uncovered?.join(", ")}`]),
      ...warnings,
    ];
    const scoped = standing !== undefined || (uncovered?.length ?? 0) > 0;
    return {
      label: scoped ? "scope-limited" : "needs approval",
      tone: "yellow",
      ...(details.length === 0 ? {} : { detail: details.join(" · ") }),
    };
  }
  return { label: "needs approval", tone: "yellow" };
}

/** One precedence point for all row status. Successful observation commands are
 * intentionally absent: `status ok` is activity, never overall health evidence. */
function classifyKind(
  entry: StatusFleetEntry,
  proof: ProofPresentation,
  ready: boolean,
  nowMs: number,
): FleetRowStatusKind {
  const degraded = degradedFleetKind(entry);
  if (degraded !== undefined) return degraded;
  if (
    entry.running === undefined &&
    (entry.last_action?.outcome === "failed" ||
      entry.last_action?.outcome === "partial")
  ) return "failed";
  if (
    entry.running === undefined && entry.last_action?.outcome === "refused"
  ) return "blocked";
  if (entry.running !== undefined) return "running";
  const idleDays = idleDaysOf(entry.last_activity, nowMs);
  if (
    idleDays !== undefined && idleDays >= STALE_WORKTREE_DAYS &&
    (entry.clean === false ||
      (entry.ahead !== undefined && isPositiveGitCount(entry.ahead)))
  ) return "stale";
  if (entry.clean === false) return "in-progress";
  if (entry.behind !== undefined && isPositiveGitCount(entry.behind)) {
    return "behind";
  }
  if (ready) return "ready";
  if (proof.status === "read_failed") return "proof-unreadable";
  if (proof.status === "unavailable") return "proof-unavailable";
  if (proof.status === "stale") return "proof-stale";
  if (
    entry.ahead !== undefined && isPositiveGitCount(entry.ahead) &&
    proof.status !== "honored"
  ) {
    return "needs-gate";
  }
  return "idle";
}

/** Derive the concrete action attached to one classified status. */
function attentionFor(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  proof: ProofPresentation,
  authority: AuthorityPresentation | undefined,
  trunk: string,
  nowMs: number,
): string | undefined {
  const degraded = degradedFleetAttention(kind);
  if (degraded !== undefined) return degraded;
  switch (kind) {
    case "failed": {
      const action = entry.last_action;
      const stage = action?.failed_stage === undefined
        ? ""
        : ` at ${action.failed_stage}`;
      return `${action?.verb ?? "The last command"} ${
        action?.outcome ?? "failed"
      }${stage} ${
        relativeAge(action?.at, nowMs)
      }. Fix the failure before rerunning the final check.`;
    }
    case "blocked":
      return `${entry.last_action?.verb ?? "The last command"} was refused ${
        relativeAge(entry.last_action?.at, nowMs)
      }. Read its refusal and complete the named prerequisite.`;
    case "behind": {
      const count = typeof entry.behind === "number" ? entry.behind : 0;
      return `Run \`discern update\` in this worktree. Its branch is ${count} commit${
        count === 1 ? "" : "s"
      } behind ${trunk}.`;
    }
    case "ready":
      return authority?.label === "granted"
        ? undefined
        : authority?.label === "scope-limited"
        ? "The clean branch has a valid Proof. Its recorded grant does not cover every changed path."
        : "The clean branch has a valid Proof and is ready for owner review; landing needs approval.";
    case "running":
      return undefined;
    case "stale": {
      const days = idleDaysOf(entry.last_activity, nowMs);
      return `This worktree has unlanded work and no recorded activity for ${
        days ?? STALE_WORKTREE_DAYS
      } days. Resume it, Park its clean checkout, or review Drop before discarding work.`;
    }
    case "in-progress":
      return undefined;
    case "proof-unreadable":
      return `The clean branch's Proof is unreadable${
        proof.detail === undefined ? "" : `: ${proof.detail}`
      }. Repair the Proof state or run \`discern done\` again.`;
    case "proof-unavailable":
      return `The clean branch's Proof is unavailable${
        proof.detail === undefined ? "" : `: ${proof.detail}`
      }. Run \`discern done\` before review.`;
    case "proof-stale":
      return "The recorded Proof names another commit. Run `discern done` on the current clean HEAD before review.";
    case "needs-gate":
      return "This clean branch has committed work and no valid Proof. Run `discern done` before review.";
    case "idle":
      return undefined;
  }
  return undefined;
}

/** Derive one complete human row model from already-collected result facts. */
export function presentFleetRow(
  entry: StatusFleetEntry,
  options: FleetRowPresentationOptions,
): FleetRowPresentation {
  const nowMs = options.nowMs;
  const proof = proofPresentation(entry);
  const collisions = rowCollisions(entry, options.collisions ?? []);
  const proofReady = isReadyToLand(entry, proof.status === "honored");
  const kind = classifyKind(entry, proof, proofReady, nowMs);
  const meta = STATUS_META[kind];
  const landingReady = proofReady && kind === "ready";
  const authority = authorityPresentation(entry, landingReady);
  const attention = attentionFor(
    kind,
    entry,
    proof,
    authority,
    options.trunk,
    nowMs,
  );
  return {
    entry,
    kind,
    ...meta,
    identity: rowIdentity(entry),
    git: gitPresentation(entry),
    gitTone: gitTone(entry),
    proof,
    activity: activityPresentation(entry, nowMs),
    landingReady,
    ...(authority === undefined ? {} : { authority }),
    collisions,
    ...(attention === undefined ? {} : { attention }),
  };
}

/** Comparable activity timestamp with unknown values ordered last. */
function activityMillis(entry: StatusFleetEntry): number {
  const parsed = Date.parse(entry.last_activity ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Importance first; current first inside a class; then recent activity and a
 * lexical identity make ties stable across Git worktree enumeration order. */
export function sortFleetRows(
  rows: readonly FleetRowPresentation[],
): FleetRowPresentation[] {
  return [...rows].sort((left, right) =>
    left.priority - right.priority ||
    Number(right.entry.is_current) - Number(left.entry.is_current) ||
    activityMillis(right.entry) - activityMillis(left.entry) ||
    left.identity.primary.localeCompare(right.identity.primary) ||
    left.entry.path.localeCompare(right.entry.path)
  );
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
  "setup-incomplete": "blocked",
  unreadable: "failed",
  failed: "failed",
  blocked: "blocked",
  behind: "blocked",
  ready: "passed",
  running: "changed",
  stale: "blocked",
  "in-progress": "changed",
  "proof-unreadable": "failed",
  "proof-unavailable": "blocked",
  "proof-stale": "blocked",
  "needs-gate": "blocked",
  idle: "unchanged",
} as const satisfies Readonly<
  Record<
    FleetRowStatusKind,
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

/** State label for Fleet, including the operation and elapsed time when live. */
function fleetStatusLabel(row: FleetRowPresentation): string {
  const running = row.entry.running;
  if (row.kind !== "running" || running === undefined) {
    return `${row.label}${row.entry.is_current ? " · current" : ""}`;
  }
  const operation = running.verb === "done"
    ? "Gate"
    : `${running.verb.slice(0, 1).toUpperCase()}${running.verb.slice(1)}`;
  return `${operation} running · ${compactDuration(running.elapsed_ms)}${
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

/** Pair every non-idle state with a repertoire-safe glyph and complete label. */
function rowStateCue(
  row: FleetRowPresentation,
  unicode: boolean,
): string {
  const label = fleetStatusLabel(row);
  if (row.kind === "idle") return label;
  const asciiGlyph = row.tone === "red"
    ? "x"
    : row.tone === "green"
    ? "+"
    : row.tone === "cyan"
    ? "*"
    : "!";
  return `${unicode ? row.glyph : asciiGlyph} ${label}`;
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

/** Task labels lead the human list; exact Git identities remain in expanded
 * evidence where they are actionable. */
function renderWorktrees(
  rows: readonly FleetRowPresentation[],
  width: number,
  terminal: TerminalContext,
  ownershipCaption: boolean,
  expanded: boolean,
): StatusComponent[] {
  const displayNames = displayTaskNames(rows);
  const list = terminal.presenter.present(renderListCli, {
    kind: "unordered",
    spacing: "tight",
    items: rows.map((row, index) => ({
      content: terminalLine(
        `${displayNames[index] ?? row.identity.worktree} · ${
          rowStateCue(row, terminal.capabilities.unicode)
        } · DRIFT ${
          rowDivergence(row, terminal.capabilities.unicode)
        } · Activity: ${row.activity}`,
      ),
    })),
    maxWidth: width,
  });
  const components: StatusComponent[] = [styledDriftArrows(list, terminal)];
  for (const [index, row] of (expanded ? rows : []).entries()) {
    const displayName = displayNames[index] ?? row.identity.worktree;
    const proofValue = row.proof.detail === undefined
      ? row.proof.label
      : `${row.proof.label} · ${row.proof.detail}`;
    const summary = terminal.presenter.present(renderResultSummaryCli, {
      state: FLEET_ROW_RESULT_STATE[row.kind],
      fact: terminalLine(
        `${displayName}${
          row.entry.is_current ? " is the current worktree. " : ". "
        }${fleetStatusLabel(row)}.`,
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
    const meta = [
      {
        label: terminalLine("Worktree"),
        value: terminalLine(row.identity.worktree),
      },
      {
        label: terminalLine("Branch"),
        value: terminalLine(row.identity.primary),
      },
      ...(row.authority === undefined ? [] : [{
        label: terminalLine("Landing"),
        value: terminalLine(
          `${row.authority.label}${
            row.authority.detail === undefined
              ? ""
              : ` · ${row.authority.detail}`
          }`,
        ),
      }]),
      ...(row.entry.contained_in === undefined ? [] : [{
        label: terminalLine("Contained in"),
        value: terminalLine(row.entry.contained_in),
      }]),
      ...row.collisions.map((collision) => ({
        label: terminalLine("Shares files with"),
        value: terminalLine(
          `${collision.branch} · ${collision.total} shared file${
            collision.total === 1 ? "" : "s"
          }`,
        ),
      })),
    ];
    const proofReport = terminal.presenter.present(renderReportCli, {
      title: terminalLine(`${displayName} Proof`),
      checks: [{
        label: terminalLine("Proof"),
        state: STATUS_PROOF_STATE[row.proof.status],
        stateLabel: terminalLine(row.proof.label),
        ...(row.proof.detail === undefined
          ? {}
          : { value: terminalLine(proofValue) }),
      }],
      ...(meta.length === 0 ? {} : {
        meta: meta.map((item) => ({
          label: terminalLine(item.label),
          value: terminalLine(item.value),
        })),
      }),
      maxWidth: width,
    });
    components.push(
      styledDiscernCommands(summary, terminal),
      proofReport,
    );
  }
  if (ownershipCaption) {
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

/** Lead fleet views with counts that answer what needs attention. */
function renderFleetSummary(
  rows: readonly FleetRowPresentation[],
  width: number,
  c: TerminalContext,
): StatusComponent {
  const ready = rows.filter((row) => row.landingReady).length;
  const active =
    rows.filter((row) => row.kind === "running" || row.kind === "in-progress")
      .length;
  const attention = rows.filter((row) => row.attention !== undefined).length;
  const summary = [
    `${rows.length} active worktree${rows.length === 1 ? "" : "s"}`,
    ...(attention === 0
      ? []
      : [`${attention} ${attention === 1 ? "needs" : "need"} attention`]),
    ...(ready === 0 ? [] : [`${ready} ready`]),
    ...(active === 0 ? [] : [`${active} in progress`]),
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
    if (row.attention === undefined) continue;
    const diagnostic = c.presenter.present(renderDiagnosticCli, {
      title: terminalLine(
        `${row.identity.primary}: ${row.label}${
          row.entry.is_current ? " (current)" : ""
        }`,
      ),
      impact: terminalLine(
        `Git ${row.git}; Proof ${row.proof.label}; ${row.activity}.`,
      ),
      correction: terminalMultiline(row.attention),
      severity: row.tone === "red" ? "failure" : "attention",
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
  return c.presenter.present(renderResultSummaryCli, {
    state: git.clean ? "unchanged" : "changed",
    fact: terminalLine(
      git.clean
        ? `Main checkout ${branch} is clean and current.`
        : `Main checkout ${branch} has ${fileCount(git.changed_files)}.`,
    ),
    counts: [
      ...(counts === ""
        ? []
        : [{ label: terminalLine("Drift"), value: terminalLine(counts) }]),
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
    state: entry.git_unavailable === true
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
    return [c.presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: terminalLine(
        data.location === "main"
          ? `${data.worktree.id} is the trunk checkout identity.`
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
  const fleetRows = sortFleetRows(
    (data.fleet ?? [])
      .filter((entry) => !entry.is_main)
      .map((entry) =>
        presentFleetRow(entry, {
          trunk,
          nowMs,
          ...(data.fleet_collisions === undefined
            ? {}
            : { collisions: data.fleet_collisions }),
        })
      ),
  );
  const local = data.fleet === undefined ? localEntry(data) : undefined;
  const localRows = local === undefined
    ? []
    : [presentFleetRow(local, { trunk, nowMs })];
  const shownRows = fleetRows.length > 0 ? fleetRows : localRows;
  const hintGroups = groupStatusHints(hints);
  const fleetTaskNames = displayTaskNames(fleetRows);

  if (data.fleet !== undefined) {
    blocks.push(renderFleetSummary(fleetRows, width, c));
    blocks.push(
      fleetRows.length > 0
        ? section(
          "Worktrees",
          renderWorktrees(
            fleetRows,
            width,
            c,
            data.location === "worktree" &&
              fleetRows.some((row) => !row.entry.is_current),
            !compactFleet,
          ),
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
        renderWorktrees(localRows, width, c, false, true),
        c,
        width,
      ),
    );
  }

  if (compactFleet) {
    const laggingOwners = fleetRows.flatMap((row, index) =>
      row.kind === "behind" && row.attention !== undefined
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
