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
  type FleetCliProps,
  renderDiagnosticCli,
  renderDiffstatCli,
  renderEmptyStateCli,
  renderFleetCli,
  renderRawOutputCli,
  renderReceiptCli,
  renderResultSummaryCli,
} from "discern-design-system/cli";
import { interactiveHintTexts } from "../../shared/hints.ts";
import type {
  GateProofCheckData,
  GateProofCheckStatus,
  StatusData,
  StatusFleetCollision,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import { wrapText } from "../../lib/text.ts";
import {
  type TerminalContext,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import { compactDuration } from "../output.ts";
import { isScopeMarker } from "../scopes/scopes.ts";
import { isReadyToLand } from "../worktree/readiness.ts";

type AgentStatus = NonNullable<FleetCliProps["rows"][number]["status"]>;

/** Very wide terminals still get a report whose related fields stay together. */
export const STATUS_REPORT_MAX_WIDTH = 104;

/** Package rules own section geometry; content retains one stable gutter. */
const SECTION_CONTENT_COLUMN = 2;
const SECTION_CONTENT_INDENT = " ".repeat(SECTION_CONTENT_COLUMN);

/** Fleet activity older than this is stale when unlanded work remains. */
export const STALE_WORKTREE_DAYS = 7;

/** The closed human-status vocabulary. Renderer tests key their state matrix to
 * this tuple, so a new semantic state cannot bypass the width and text guards. */
export const FLEET_ROW_STATUS_KINDS = [
  "broken",
  "unreadable",
  "failed",
  "blocked",
  "collision",
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

/**
 * Exhaustive adaptation from Discern's richer status vocabulary into Fleet's
 * generic agent-state vocabulary. The Discern label remains visible beside it;
 * this mapping never replaces status precedence or invents readiness.
 */
export const FLEET_ROW_AGENT_STATUS = {
  broken: "blocked",
  unreadable: "blocked",
  failed: "blocked",
  blocked: "blocked",
  collision: "waiting",
  behind: "waiting",
  ready: "done",
  running: "working",
  stale: "waiting",
  "in-progress": "working",
  "proof-unreadable": "blocked",
  "proof-unavailable": "waiting",
  "proof-stale": "waiting",
  "needs-gate": "waiting",
  idle: "idle",
} as const satisfies Readonly<Record<FleetRowStatusKind, AgentStatus>>;

const STATUS_META = {
  broken: { label: "Broken", glyph: "✗", tone: "red", priority: 0 },
  unreadable: { label: "Unreadable", glyph: "✗", tone: "red", priority: 0 },
  failed: { label: "Failed", glyph: "✗", tone: "red", priority: 0 },
  blocked: { label: "Blocked", glyph: "!", tone: "yellow", priority: 1 },
  collision: {
    label: "Collision",
    glyph: "!",
    tone: "yellow",
    priority: 2,
  },
  behind: { label: "Behind", glyph: "!", tone: "yellow", priority: 3 },
  ready: { label: "Ready", glyph: "✓", tone: "green", priority: 4 },
  running: { label: "Running", glyph: "●", tone: "cyan", priority: 5 },
  stale: { label: "Stale", glyph: "!", tone: "yellow", priority: 6 },
  "in-progress": {
    label: "In progress",
    glyph: "●",
    tone: "cyan",
    priority: 7,
  },
  "proof-unreadable": {
    label: "Proof unreadable",
    glyph: "✗",
    tone: "red",
    priority: 8,
  },
  "proof-unavailable": {
    label: "Proof unavailable",
    glyph: "!",
    tone: "yellow",
    priority: 9,
  },
  "proof-stale": {
    label: "Proof stale",
    glyph: "!",
    tone: "yellow",
    priority: 10,
  },
  "needs-gate": {
    label: "Needs gate",
    glyph: "!",
    tone: "yellow",
    priority: 11,
  },
  idle: { label: "Idle", glyph: "·", tone: "dim", priority: 12 },
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
  agentStatus: AgentStatus;
  identity: RowIdentity;
  git: string;
  gitTone: FleetRowTone;
  proof: ProofPresentation;
  activity: string;
  /** Proof-backed landing readiness that remains visible when a collision
   * takes precedence as the row's primary status. */
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
    reason: "proof state was not inspected",
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
  ahead: number | undefined,
  behind: number | undefined,
): string {
  return [
    ...((ahead ?? 0) > 0 ? [`↑${ahead}`] : []),
    ...((behind ?? 0) > 0 ? [`↓${behind}`] : []),
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
  if (entry.clean === false || (entry.behind ?? 0) > 0) return "yellow";
  return "dim";
}

/** Combine running, last-command, and winning-activity clocks. */
function activityPresentation(entry: StatusFleetEntry, nowMs: number): string {
  if (entry.running !== undefined) {
    const typical = entry.running.typical_duration_ms === undefined
      ? ""
      : ` · usually ${compactDuration(entry.running.typical_duration_ms)}`;
    return `running ${entry.running.verb} ${
      compactDuration(entry.running.elapsed_ms)
    }${typical}`;
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
  collisions: readonly RowCollision[],
  ready: boolean,
  nowMs: number,
): FleetRowStatusKind {
  if (entry.broken === true) return "broken";
  if (entry.git_unavailable === true) return "unreadable";
  if (
    entry.running === undefined &&
    (entry.last_action?.outcome === "failed" ||
      entry.last_action?.outcome === "partial")
  ) return "failed";
  if (
    entry.running === undefined && entry.last_action?.outcome === "refused"
  ) return "blocked";
  if (collisions.length > 0) return "collision";
  if ((entry.behind ?? 0) > 0) return "behind";
  if (entry.running !== undefined) return "running";
  if (ready) return "ready";
  const idleDays = idleDaysOf(entry.last_activity, nowMs);
  if (
    idleDays !== undefined && idleDays >= STALE_WORKTREE_DAYS &&
    (entry.clean === false || (entry.ahead ?? 0) > 0)
  ) return "stale";
  if (entry.clean === false) return "in-progress";
  if (proof.status === "read_failed") return "proof-unreadable";
  if (proof.status === "unavailable") return "proof-unavailable";
  if (proof.status === "stale") return "proof-stale";
  if ((entry.ahead ?? 0) > 0 && proof.status !== "honored") {
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
  switch (kind) {
    case "broken":
      return "Setup never completed. Inspect the checkout before discarding it with `discern worktree drop <name>`.";
    case "unreadable":
      return "Git could not read this checkout. Investigate the path before resuming or discarding it.";
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
    case "collision":
      return "This branch changes files another worktree also changes. Re-read the shared paths after the first branch lands.";
    case "behind": {
      const count = entry.behind ?? 0;
      return `Run \`discern update\` in this worktree. Its branch is ${count} commit${
        count === 1 ? "" : "s"
      } behind ${trunk}.`;
    }
    case "ready":
      return authority?.label === "granted"
        ? "The clean branch has a valid proof and granted landing authority."
        : authority?.label === "scope-limited"
        ? "The clean branch has a valid proof. Its recorded grant does not cover every changed path."
        : "The clean branch has a valid proof and is ready for owner review; landing needs approval.";
    case "running":
      return undefined;
    case "stale": {
      const days = idleDaysOf(entry.last_activity, nowMs);
      return `This worktree has unlanded work and no recorded activity for ${
        days ?? STALE_WORKTREE_DAYS
      } days. Resume it or discard it with \`discern worktree drop <name>\`.`;
    }
    case "in-progress":
      return undefined;
    case "proof-unreadable":
      return `The clean branch's proof is unreadable${
        proof.detail === undefined ? "" : `: ${proof.detail}`
      }. Repair the proof state or run \`discern done\` again.`;
    case "proof-unavailable":
      return `The clean branch's proof is unavailable${
        proof.detail === undefined ? "" : `: ${proof.detail}`
      }. Run \`discern done\` before review.`;
    case "proof-stale":
      return "The recorded proof names another commit. Run `discern done` on the current clean HEAD before review.";
    case "needs-gate":
      return "This clean branch has committed work and no valid proof. Run `discern done` before review.";
    case "idle":
      return undefined;
  }
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
  const kind = classifyKind(entry, proof, collisions, proofReady, nowMs);
  const meta = STATUS_META[kind];
  const landingReady = proofReady &&
    (kind === "ready" || kind === "collision");
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
    agentStatus: FLEET_ROW_AGENT_STATUS[kind],
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

interface VerbatimSectionLine {
  /** Stored proof Markdown bypasses dashboard indentation so it stays
   * copyable. */
  verbatim: string;
}

type StatusSectionLine = string | VerbatimSectionLine;

/** Place one typed line in the section's shared display columns. */
function renderSectionLine(line: StatusSectionLine): string {
  if (typeof line === "string") {
    return line === "" ? "" : `${SECTION_CONTENT_INDENT}${line}`;
  }
  return line.verbatim;
}

/** Join one populated dashboard section. This is the sole owner of ordinary
 * section indentation, so every present and future child shares the heading's
 * content column. */
function section(
  label: string,
  lines: readonly StatusSectionLine[],
  terminal: TerminalContext,
  width: number,
): string {
  return [
    terminal.presenter.motifSectionRule(terminalLine(label), {
      register: "brand",
      width,
    }),
    ...lines.map(renderSectionLine),
  ].join("\n");
}

/** Exhaustive adaptation into Result summary's outcome vocabulary. */
export const FLEET_ROW_RESULT_STATE = {
  broken: "failed",
  unreadable: "failed",
  failed: "failed",
  blocked: "blocked",
  collision: "blocked",
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

/** Exhaustive Proof-state adaptation into Receipt check semantics. */
export const STATUS_PROOF_RECEIPT_STATE = {
  honored: "pass",
  missing: "skip",
  stale: "fail",
  dirty: "skip",
  unavailable: "fail",
  read_failed: "fail",
} as const satisfies Readonly<
  Record<GateProofCheckStatus, "pass" | "fail" | "skip">
>;

/** Fleet owns identity, state, drift, and responsive layout. Discern composes
 * the product evidence Fleet cannot generically know beside each row. */
function renderWorktrees(
  rows: readonly FleetRowPresentation[],
  width: number,
  terminal: TerminalContext,
  ownershipCaption: boolean,
  expanded: boolean,
): StatusSectionLine[] {
  const fleet = terminal.presenter.present(renderFleetCli, {
    label: terminalLine("Active worktrees"),
    identityMode: "lossless",
    maxWidth: width,
    rows: rows.map((row) => ({
      persona: terminalLine(row.identity.worktree),
      branch: terminalLine(row.identity.primary),
      status: row.agentStatus,
      statusLabel: terminalLine(
        `${row.label}${row.entry.is_current ? " · current" : ""}`,
      ),
      ...(row.entry.ahead === undefined ? {} : { ahead: row.entry.ahead }),
      ...(row.entry.behind === undefined ? {} : { behind: row.entry.behind }),
      ...(row.kind === "running" ? { beaconPhase: 0 } : {}),
    })),
  });
  const lines: StatusSectionLine[] = [{ verbatim: fleet }];
  for (const row of expanded ? rows : []) {
    const proofValue = row.proof.detail === undefined
      ? row.proof.label
      : `${row.proof.label} · ${row.proof.detail}`;
    const summary = terminal.presenter.present(renderResultSummaryCli, {
      state: FLEET_ROW_RESULT_STATE[row.kind],
      fact: terminalLine(
        `${row.identity.primary}${
          row.entry.is_current ? " is the current worktree. " : ". "
        }${row.label}.`,
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
        label: terminalLine("Collision"),
        value: terminalLine(
          `${collision.branch} · ${fileCount(collision.total)}`,
        ),
      })),
    ];
    const receipt = terminal.presenter.present(renderReceiptCli, {
      title: terminalLine(`${row.identity.primary} Proof`),
      checks: [{
        label: terminalLine("Proof"),
        state: STATUS_PROOF_RECEIPT_STATE[row.proof.status],
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
    lines.push(
      "",
      { verbatim: styledDiscernCommands(summary, terminal) },
      { verbatim: receipt },
    );
  }
  if (ownershipCaption) {
    lines.push(
      "",
      {
        verbatim: terminal.presenter.present(renderResultSummaryCli, {
          state: "unchanged",
          fact: terminalLine(
            "Worktrees stay with the effort that created them.",
          ),
          maxWidth: width,
        }),
      },
    );
  }
  return lines;
}

/** Lead fleet views with counts that answer what needs attention. */
function renderFleetSummary(
  rows: readonly FleetRowPresentation[],
  width: number,
  c: TerminalContext,
): StatusSectionLine[] {
  const ready = rows.filter((row) => row.landingReady).length;
  const active =
    rows.filter((row) => row.kind === "running" || row.kind === "in-progress")
      .length;
  const attention = rows.filter((row) => row.attention !== undefined).length;
  const summary = [
    `${rows.length} worktree${rows.length === 1 ? "" : "s"}`,
    ...(attention === 0
      ? []
      : [`${attention} ${attention === 1 ? "needs" : "need"} attention`]),
    ...(ready === 0 ? [] : [`${ready} ready`]),
    ...(active === 0 ? [] : [`${active} in progress`]),
  ].join(" · ");
  return [{
    verbatim: c.presenter.present(renderResultSummaryCli, {
      state: attention > 0 ? "blocked" : active > 0 ? "changed" : "unchanged",
      fact: terminalLine(summary),
      maxWidth: width,
    }),
  }];
}

/** Render row actions and complete fleet/ADR collision evidence. */
function renderAttention(
  rows: readonly FleetRowPresentation[],
  data: StatusData,
  width: number,
  c: TerminalContext,
  nowMs: number,
): StatusSectionLine[] {
  const lines: StatusSectionLine[] = [];
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
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      {
        verbatim: styledDiscernCommands(diagnostic, c),
      },
    );
    if (
      row.landingReady && row.kind !== "ready" &&
      row.authority !== undefined
    ) {
      lines.push(
        {
          verbatim: c.presenter.present(renderResultSummaryCli, {
            state: "passed",
            fact: terminalLine(
              `The branch is ready; landing ${row.authority.label}.`,
            ),
            maxWidth: width,
          }),
        },
      );
    }
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
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      {
        verbatim: c.presenter.present(renderDiagnosticCli, {
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
      },
    );
  }
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
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      { verbatim: styledDiscernCommands(diagnostic, c) },
    );
  }
  for (const collision of data.adr_collisions ?? []) {
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      {
        verbatim: c.presenter.present(renderDiagnosticCli, {
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
      },
    );
  }
  if (data.git?.incoming_overlap?.length) {
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      {
        verbatim: c.presenter.present(renderDiagnosticCli, {
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
      },
    );
  }
  return lines;
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
  const state = git.clean ? "clean" : fileCount(git.changed_files);
  const counts = divergence(
    git.ahead_trunk === null ? undefined : git.ahead_trunk,
    git.behind_trunk === null ? undefined : git.behind_trunk,
  );
  const branch = git.branch === "" ? "(detached)" : git.branch;
  return c.presenter.present(renderResultSummaryCli, {
    state: git.clean ? "unchanged" : "changed",
    fact: terminalLine(`Main checkout ${branch} is current.`),
    counts: [
      { label: terminalLine("Git"), value: terminalLine(state) },
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
): StatusSectionLine[] {
  const state = entry.git_unavailable === true
    ? "unreadable"
    : entry.clean === true
    ? "clean"
    : fileCount(entry.changed_files ?? 0);
  const counts = divergence(entry.ahead, entry.behind);
  const activity = relativeAge(entry.last_activity, nowMs);
  return [{
    verbatim: c.presenter.present(renderResultSummaryCli, {
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
    }),
  }];
}

/** Lower-priority configured-scope, gate, and standards facts. */
function renderChecks(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusSectionLine[] {
  const counts: Array<{ label: string; value: string }> = [];
  const changedScopes = (data.scopes ?? []).filter((scope) =>
    !isScopeMarker(scope)
  );
  if (changedScopes.length > 0) {
    counts.push({ label: "Changed scopes", value: changedScopes.join(", ") });
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
  return [{
    verbatim: c.presenter.present(renderResultSummaryCli, {
      state: changedScopes.length > 0 ? "changed" : "unchanged",
      fact: terminalLine("Configured checks for this status result."),
      counts: counts.map((count) => ({
        label: terminalLine(count.label),
        value: terminalLine(count.value),
      })),
      maxWidth: width,
    }),
  }];
}

/** Worktree-local runtime coordinates, separate from quality checks. */
function renderLocalEnvironment(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusSectionLine[] {
  if (data.worktree !== null) {
    const resources = Object.entries(data.worktree.resources);
    return [{
      verbatim: c.presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine(
          `${data.worktree.id} has a provisioned local environment.`,
        ),
        counts: [
          {
            label: terminalLine("Port"),
            value: terminalLine(String(data.worktree.port)),
          },
          ...(resources.length === 0 ? [] : [{
            label: terminalLine("Resources"),
            value: terminalLine(
              resources.map(([name, value]) => `${name}=${value}`).join(", "),
            ),
          }]),
        ],
        maxWidth: width,
      }),
    }];
  }
  return [];
}

/** Useful landed-proof facts without exposing Git-note storage plumbing. */
function renderLastLanding(
  data: StatusData,
  width: number,
  c: TerminalContext,
  nowMs: number,
): StatusSectionLine[] {
  if (data.landed_proof !== undefined) {
    const proof = data.landed_proof.proof;
    const age = relativeAge(data.landed_proof.commit_at, nowMs);
    const receipt: StatusSectionLine = {
      verbatim: c.presenter.present(renderReceiptCli, {
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
      }),
    };
    const changedLines = proof.insertions + proof.deletions;
    return [
      receipt,
      ...(changedLines === 0 ? [] : [{
        verbatim: c.presenter.present(renderDiffstatCli, {
          added: proof.insertions,
          removed: proof.deletions,
          maxWidth: width,
        }),
      }]),
    ];
  }
  if (data.landed_proof_unsupported !== undefined) {
    return [{
      verbatim: c.presenter.present(renderResultSummaryCli, {
        state: "blocked",
        fact: terminalLine(
          `proof unavailable in this discern version (${data.landed_proof_unsupported.format}). Commit: ${
            data.landed_proof_unsupported.commit.slice(0, 12)
          }.`,
        ),
        maxWidth: width,
      }),
    }];
  }
  return [];
}

/** Setup-incomplete action block that still obeys the report width. */
function renderSetup(
  data: StatusData,
  width: number,
  c: TerminalContext,
): StatusSectionLine[] {
  const setup = data.setup_unfinished;
  if (setup === undefined) return [];
  const wired = setup.known_jobs.filter((job) => job.wired).map((job) =>
    job.name
  );
  const missing = setup.known_jobs.filter((job) => !job.wired).map((job) =>
    job.name
  );
  const impact = [
    ...(setup.pending_markers.length === 0
      ? []
      : [`Skeleton markers: ${setup.pending_markers.join(", ")}.`]),
    `Gate jobs: ${wired.length === 0 ? "none configured" : wired.join(", ")}${
      missing.length === 0 ? "" : `; still unset: ${missing.join(", ")}`
    }.`,
  ].join(" ");
  return [{
    verbatim: c.presenter.present(renderDiagnosticCli, {
      title: terminalLine("Setup is not finished"),
      impact: terminalLine(impact),
      correction: terminalMultiline(
        "Complete the setup brief before starting or landing work.",
      ),
      severity: "attention",
      maxWidth: width,
    }),
  }];
}

/** Copyable stored Markdown pages shown only under `--verbose`. */
function renderVerboseProofs(
  data: StatusData,
  rows: readonly FleetRowPresentation[],
  c: TerminalContext,
): StatusSectionLine[] {
  const blocks: StatusSectionLine[] = [];
  const add = (label: string, page: string | undefined): void => {
    if (page === undefined) return;
    blocks.push(
      ...(blocks.length === 0 ? [] : [""]),
      {
        verbatim: c.presenter.present(renderRawOutputCli, {
          label: terminalLine(label),
          output: terminalMultiline(page),
          expanded: true,
          maxWidth: STATUS_REPORT_MAX_WIDTH,
        }),
      },
    );
  };
  add("Last landed proof", data.landed_proof?.proof.markdown);
  add("Current worktree proof", data.gate_proof?.proof);
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

/** Width available after the section-owned content indent. */
function sectionContentWidth(width: number): number {
  return Math.max(1, width - SECTION_CONTENT_COLUMN);
}

/** Render one complete static dashboard. Every fact comes from `data`; this
 * function performs no Git, proof, authority, collision, or logbook reads. */
export function renderStatusDashboard(
  data: StatusData,
  hints: readonly string[] | undefined,
  options: StatusDashboardOptions,
): string {
  const width = reportWidth(options.width);
  const contentWidth = sectionContentWidth(width);
  const nowMs = options.nowMs;
  const c = options.terminal;
  const compactFleet = data.location === "main" && data.fleet !== undefined &&
    options.verbose !== true;
  const project = terminalLine(
    data.project ?? (basename(data.root) || data.root),
  );
  const heading = wrapText(
    `${c.role("discern status", "strong")} ${c.role(`· ${project}`, "muted")}`,
    width,
    SECTION_CONTENT_INDENT,
    { breakLongWords: true },
  ).join("\n");
  const blocks: string[] = [heading];

  const setup = renderSetup(data, contentWidth, c);
  if (setup.length > 0) blocks.push(section("Setup", setup, c, width));
  if (data.location === "main" && data.fleet === undefined) {
    blocks.push(mainCheckoutLine(data, width, c));
  }

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

  if (data.fleet !== undefined) {
    blocks.push(
      section(
        "Fleet",
        renderFleetSummary(fleetRows, contentWidth, c),
        c,
        width,
      ),
    );
  }
  if (!compactFleet) {
    const attention = renderAttention(shownRows, data, contentWidth, c, nowMs);
    if (attention.length > 0) {
      blocks.push(section("Attention", attention, c, width));
    }
  }
  if (fleetRows.length > 0) {
    blocks.push(
      section(
        "Worktrees",
        renderWorktrees(
          fleetRows,
          contentWidth,
          c,
          data.location === "worktree" &&
            fleetRows.some((row) => !row.entry.is_current),
          !compactFleet,
        ),
        c,
        width,
      ),
    );
  } else if (data.fleet !== undefined) {
    blocks.push(section(
      "Worktrees",
      [{
        verbatim: c.presenter.present(renderEmptyStateCli, {
          title: terminalLine("No active worktrees"),
          width: contentWidth,
        }),
      }],
      c,
      width,
    ));
  } else if (localRows.length > 0) {
    blocks.push(
      section(
        "Current worktree",
        renderWorktrees(localRows, contentWidth, c, false, true),
        c,
        width,
      ),
    );
  }
  if (data.location === "main" && data.fleet !== undefined) {
    blocks.push(mainCheckoutLine(data, width, c));
  }
  const surveyedMain = data.location === "worktree"
    ? data.fleet?.find((entry) => entry.is_main)
    : undefined;
  if (surveyedMain !== undefined) {
    blocks.push(
      section(
        "Main checkout",
        surveyedMainCheckout(surveyedMain, contentWidth, nowMs, c),
        c,
        width,
      ),
    );
  }

  const next = interactiveHintTexts(hints).flatMap((hint) => {
    const result = c.presenter.present(renderResultSummaryCli, {
      state: "blocked",
      fact: terminalLine("Status recommends an action."),
      nextAction: terminalMultiline(hint),
      maxWidth: contentWidth,
    });
    return [{ verbatim: styledDiscernCommands(result, c) }, ""];
  });
  if (next.at(-1) === "") next.pop();
  if (next.length > 0) blocks.push(section("Next steps", next, c, width));

  if (!compactFleet) {
    const checks = renderChecks(data, contentWidth, c);
    if (checks.length > 0) blocks.push(section("Checks", checks, c, width));
    const environment = renderLocalEnvironment(data, contentWidth, c);
    if (environment.length > 0) {
      blocks.push(section("Local environment", environment, c, width));
    }
    const landing = renderLastLanding(data, contentWidth, c, nowMs);
    if (landing.length > 0) blocks.push(section("Landing", landing, c, width));
  }

  if (options.verbose === true) {
    const proofs = renderVerboseProofs(data, shownRows, c);
    if (proofs.length > 0) {
      blocks.push(section("Proofs", proofs, c, width));
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
