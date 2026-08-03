/**
 * Static human dashboard for `discern status`.
 *
 * The result core owns every observed fact. This module owns only their pure
 * presentation: row classification, importance ordering, responsive layout,
 * semantic color, and wrapped prose. Width, color, and time are injected so a
 * test can exercise every layout without a terminal or filesystem.
 */

import { basename } from "@std/path";
import { dimBlock } from "../../shared/result.ts";
import { interactiveHintTexts } from "../../shared/hints.ts";
import type {
  GateReceiptCheckData,
  GateReceiptCheckStatus,
  StatusData,
  StatusFleetCollision,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import { displayWidth, padDisplayEnd, wrapText } from "../../lib/text.ts";
import { compactDuration, type Palette, palette } from "../output.ts";
import { isScopeMarker } from "../scopes/scopes.ts";
import { isReadyToLand } from "../worktree/readiness.ts";

/** Very wide terminals still get a report whose related fields stay together. */
export const STATUS_REPORT_MAX_WIDTH = 104;

/** One authority for the section rule and the column where its content begins. */
const SECTION_RULE = "──";
const SECTION_CONTENT_COLUMN = displayWidth(`${SECTION_RULE} `);
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
  "receipt-unreadable",
  "receipt-unavailable",
  "receipt-stale",
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
  "receipt-unreadable": {
    label: "Receipt unreadable",
    glyph: "✗",
    tone: "red",
    priority: 8,
  },
  "receipt-unavailable": {
    label: "Receipt unavailable",
    glyph: "!",
    tone: "yellow",
    priority: 9,
  },
  "receipt-stale": {
    label: "Receipt stale",
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
  secondary?: string;
}

interface ReceiptPresentation {
  status: GateReceiptCheckStatus;
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
  receipt: ReceiptPresentation;
  activity: string;
  /** Receipt-backed landing readiness that remains visible when a collision
   * takes precedence as the row's primary status. */
  landingReady: boolean;
  authority?: AuthorityPresentation;
  collisions: readonly RowCollision[];
  attention?: string;
}

export interface FleetRowPresentationOptions {
  trunk: string;
  nowMs?: number;
  collisions?: readonly StatusFleetCollision[];
}

export interface StatusDashboardOptions {
  width: number;
  color?: boolean;
  verbose?: boolean;
  nowMs?: number;
}

/** Whole days since an ISO timestamp, or undefined when absent/unparseable. */
export function idleDaysOf(
  iso: string | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (iso === undefined) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

/** A compact relative age for row activity. */
export function relativeAge(
  iso: string | undefined,
  nowMs: number = Date.now(),
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
function receiptFromEntry(entry: StatusFleetEntry): GateReceiptCheckData {
  if (entry.gate_receipt !== undefined) return entry.gate_receipt;
  if (entry.receipt_honored === true) {
    return {
      status: "honored",
      ...(entry.receipt === undefined ? {} : { receipt: entry.receipt }),
      ...(entry.receipt_line === undefined
        ? {}
        : { receipt_line: entry.receipt_line }),
    };
  }
  if (entry.clean === false) return { status: "dirty" };
  return {
    status: "unavailable",
    reason: "receipt state was not inspected",
  };
}

/** Project the receipt-check vocabulary into a labelled, toned fact. */
function receiptPresentation(entry: StatusFleetEntry): ReceiptPresentation {
  const receipt = receiptFromEntry(entry);
  const detail = receipt.reason ?? (
    receipt.status === "stale" && receipt.recorded !== undefined &&
      receipt.head !== undefined
      ? `recorded at ${receipt.recorded.slice(0, 12)}; HEAD is ${
        receipt.head.slice(0, 12)
      }`
      : undefined
  );
  const base = ((): Omit<ReceiptPresentation, "status" | "detail"> => {
    switch (receipt.status) {
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
    status: receipt.status,
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
  receipt: ReceiptPresentation,
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
  if (receipt.status === "read_failed") return "receipt-unreadable";
  if (receipt.status === "unavailable") return "receipt-unavailable";
  if (receipt.status === "stale") return "receipt-stale";
  if ((entry.ahead ?? 0) > 0 && receipt.status !== "honored") {
    return "needs-gate";
  }
  return "idle";
}

/** Derive the concrete action attached to one classified status. */
function attentionFor(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  receipt: ReceiptPresentation,
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
        ? "The clean branch has an honored receipt and granted landing authority."
        : authority?.label === "scope-limited"
        ? "The clean branch has an honored receipt. Its recorded grant does not cover every changed path."
        : "The clean branch has an honored receipt and is ready for owner review; landing needs approval.";
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
    case "receipt-unreadable":
      return `The clean branch's receipt is unreadable${
        receipt.detail === undefined ? "" : `: ${receipt.detail}`
      }. Repair the receipt state or run \`discern done\` again.`;
    case "receipt-unavailable":
      return `The clean branch's receipt is unavailable${
        receipt.detail === undefined ? "" : `: ${receipt.detail}`
      }. Run \`discern done\` before review.`;
    case "receipt-stale":
      return "The recorded receipt names another commit. Run `discern done` on the current clean HEAD before review.";
    case "needs-gate":
      return "This clean branch has committed work and no honored receipt. Run `discern done` before review.";
    case "idle":
      return undefined;
  }
}

/** Derive one complete human row model from already-collected result facts. */
export function presentFleetRow(
  entry: StatusFleetEntry,
  options: FleetRowPresentationOptions,
): FleetRowPresentation {
  const nowMs = options.nowMs ?? Date.now();
  const receipt = receiptPresentation(entry);
  const collisions = rowCollisions(entry, options.collisions ?? []);
  const receiptReady = isReadyToLand(entry, receipt.status === "honored");
  const kind = classifyKind(entry, receipt, collisions, receiptReady, nowMs);
  const meta = STATUS_META[kind];
  const landingReady = receiptReady &&
    (kind === "ready" || kind === "collision");
  const authority = authorityPresentation(entry, landingReady);
  const attention = attentionFor(
    kind,
    entry,
    receipt,
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
    receipt,
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

/** Apply one semantic palette color without changing the text. */
function tone(text: string, value: FleetRowTone, c: Palette): string {
  switch (value) {
    case "red":
      return `${c.red}${text}${c.reset}`;
    case "cyan":
      return `${c.cyan}${text}${c.reset}`;
    case "yellow":
      return `${c.yellow}${text}${c.reset}`;
    case "green":
      return `${c.green}${text}${c.reset}`;
    case "dim":
      return `${c.dim}${text}${c.reset}`;
  }
}

/** Style only mechanical identity fragments. ANSI changes appearance, never the
 * copied branch or worktree id. */
function styledIdentifier(value: string, c: Palette): string {
  if (value === "(detached)") return `${c.yellow}${value}${c.reset}`;
  const prefix = value.startsWith("agent/") ? "agent/" : "";
  const tail = value.slice(prefix.length);
  const match = tail.match(/^(.*)(-[0-9a-f]{6})$/u);
  const body = match?.[1] ?? tail;
  const suffix = match?.[2] ?? "";
  return `${prefix === "" ? "" : `${c.dim}${prefix}${c.reset}`}${body}${
    suffix === "" ? "" : `${c.dim}${suffix}${c.reset}`
  }`;
}

/** Current-location cue placed beside the identity. */
function currentMarker(current: boolean, c: Palette): string {
  return current ? ` ${c.cyan}← current${c.reset}` : "";
}

const BACKTICKED_DISCERN_COMMAND = /`(discern(?:[ \t]+[^`\r\n]+)?)`/gu;

/** Highlight actionable discern commands while preserving their backticks and
 * exact copyable text. Styling each non-space token separately prevents a wrap
 * between command words from leaking color into the next terminal line. */
function styledDiscernCommands(
  text: string,
  c: Palette,
  resumeStyle = "",
): string {
  return text.replace(
    BACKTICKED_DISCERN_COMMAND,
    (_match: string, command: string): string =>
      `\`${
        command.split(/([ \t]+)/u).map((part) =>
          /^[ \t]+$/u.test(part)
            ? part
            : `${c.cyan}${part}${c.reset}${resumeStyle}`
        ).join("")
      }\``,
  );
}

/** Wrap one section-relative labelled field with a hanging continuation. */
function wrappedField(
  label: string,
  text: string,
  width: number,
  indent = "",
): string[] {
  const prefix = `${label}:`;
  const available = Math.max(1, width - displayWidth(indent));
  return wrapText(
    `${prefix} ${text}`,
    available,
    " ".repeat(displayWidth(prefix) + 1),
    { breakLongWords: true },
  ).map((line) => `${indent}${line}`);
}

/** Wrap one section-relative glyph-led line with its continuation under the
 * text. */
function wrappedBullet(
  glyph: string,
  text: string,
  width: number,
  c: Palette,
  glyphTone: FleetRowTone = "cyan",
): string[] {
  const styled = tone(glyph, glyphTone, c);
  const styledText = styledDiscernCommands(text, c);
  const prefixWidth = displayWidth(glyph) + 1;
  return wrapText(
    `${styled} ${styledText}`,
    width,
    " ".repeat(prefixWidth),
    { breakLongWords: true },
  );
}

interface VerbatimSectionLine {
  /** Stored receipt Markdown bypasses dashboard indentation so it stays
   * copyable. */
  verbatim: string;
}

type StatusSectionLine = string | VerbatimSectionLine;

/** Join one populated dashboard section. This is the sole owner of ordinary
 * section indentation, so every present and future child shares the heading's
 * content column. */
function section(
  label: string,
  lines: readonly StatusSectionLine[],
  c: Palette,
): string {
  return [
    `${c.dim}${SECTION_RULE}${c.reset} ${c.bold}${label}${c.reset}`,
    ...lines.map((line) =>
      typeof line === "string"
        ? line === "" ? "" : `${SECTION_CONTENT_INDENT}${line}`
        : line.verbatim
    ),
  ].join("\n");
}

/** Multi-line row used at narrow widths and for detailed states. */
function renderStackedRow(
  row: FleetRowPresentation,
  width: number,
  c: Palette,
): string[] {
  const identity = `${tone(row.glyph, row.tone, c)} ${
    styledIdentifier(row.identity.primary, c)
  }${currentMarker(row.entry.is_current, c)}`;
  const lines = [identity];
  if (row.identity.secondary !== undefined) {
    lines.push(
      `  ${c.dim}Worktree id:${c.reset} ${
        styledIdentifier(row.identity.secondary, c)
      }`,
    );
  }
  lines.push(
    ...wrappedField(
      "Status",
      `${tone(row.label, row.tone, c)} · Git ${tone(row.git, row.gitTone, c)}`,
      width,
      "  ",
    ),
  );
  const receiptText = `${tone(row.receipt.label, row.receipt.tone, c)}${
    row.receipt.detail === undefined ? "" : ` · ${row.receipt.detail}`
  }`;
  lines.push(...wrappedField("Receipt", receiptText, width, "  "));
  lines.push(
    ...wrappedField(
      "Activity",
      row.entry.running !== undefined
        ? tone(row.activity, "cyan", c)
        : row.activity,
      width,
      "  ",
    ),
  );
  if (row.authority !== undefined) {
    lines.push(
      ...wrappedField(
        "Landing",
        `${tone(row.authority.label, row.authority.tone, c)}${
          row.authority.detail === undefined ? "" : ` · ${row.authority.detail}`
        }`,
        width,
        "  ",
      ),
    );
  }
  if (row.entry.contained_in !== undefined) {
    lines.push(
      ...wrappedField(
        "Contained in",
        styledIdentifier(row.entry.contained_in, c),
        width,
        "  ",
      ),
    );
  }
  for (const collision of row.collisions) {
    lines.push(
      ...wrappedField(
        "Collision",
        `${styledIdentifier(collision.branch, c)} · ${
          fileCount(collision.total)
        }`,
        width,
        "  ",
      ),
    );
  }
  return lines;
}

interface TableColumn {
  header: string;
  values: string[];
}

/** Bounded table when every natural column fits and no detail would be lost. */
function tableLines(
  rows: readonly FleetRowPresentation[],
  width: number,
  c: Palette,
): string[] | undefined {
  if (width < 92 - SECTION_CONTENT_COLUMN) return undefined;
  if (
    rows.some((row) =>
      row.identity.secondary !== undefined ||
      row.receipt.detail !== undefined ||
      row.authority?.detail !== undefined ||
      row.collisions.length > 0 ||
      row.entry.contained_in !== undefined
    )
  ) return undefined;
  const columns: TableColumn[] = [
    {
      header: "Worktree",
      values: rows.map((row) =>
        `${styledIdentifier(row.identity.primary, c)}${
          currentMarker(row.entry.is_current, c)
        }`
      ),
    },
    {
      header: "Status",
      values: rows.map((row) =>
        `${tone(row.glyph, row.tone, c)} ${tone(row.label, row.tone, c)}`
      ),
    },
    {
      header: "Git",
      values: rows.map((row) => tone(row.git, row.gitTone, c)),
    },
    {
      header: "Receipt",
      values: rows.map((row) => tone(row.receipt.label, row.receipt.tone, c)),
    },
    {
      header: "Activity",
      values: rows.map((row) =>
        row.entry.running !== undefined
          ? tone(row.activity, "cyan", c)
          : row.activity
      ),
    },
  ];
  if (rows.some((row) => row.authority !== undefined)) {
    columns.push({
      header: "Landing",
      values: rows.map((row) =>
        row.authority === undefined
          ? "—"
          : tone(row.authority.label, row.authority.tone, c)
      ),
    });
  }
  const widths = columns.map((column) =>
    Math.max(
      displayWidth(column.header),
      ...column.values.map(displayWidth),
    )
  );
  const total = widths.reduce((sum, value) => sum + value, 0) +
    (columns.length - 1) * 2;
  if (total > width) return undefined;
  const line = (values: readonly string[]): string =>
    values.map((value, index) =>
      index === values.length - 1
        ? value
        : padDisplayEnd(value, widths[index] ?? 0)
    ).join("  ");
  const header = line(columns.map((column) => column.header));
  return [
    `${c.dim}${header}${c.reset}`,
    ...rows.map((_, rowIndex) =>
      line(columns.map((column) => column.values[rowIndex] ?? ""))
    ),
  ];
}

/** Choose table or stacked rows, with the conditional ownership caption. */
function renderWorktrees(
  rows: readonly FleetRowPresentation[],
  width: number,
  c: Palette,
  ownershipCaption: boolean,
): string[] {
  const table = tableLines(rows, width, c);
  const lines = table ?? rows.flatMap((row, index) => [
    ...(index === 0 ? [] : [""]),
    ...renderStackedRow(row, width, c),
  ]);
  if (ownershipCaption) {
    lines.push(
      "",
      ...wrappedField(
        "Ownership",
        `${c.dim}Worktrees stay with the effort that created them.${c.reset}`,
        width,
      ),
    );
  }
  return lines;
}

/** Lead fleet views with counts that answer what needs attention. */
function renderFleetSummary(
  rows: readonly FleetRowPresentation[],
  width: number,
): string[] {
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
  return wrappedField("Summary", summary, width);
}

/** Render row actions and complete fleet/ADR collision evidence. */
function renderAttention(
  rows: readonly FleetRowPresentation[],
  data: StatusData,
  width: number,
  c: Palette,
): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.attention === undefined) continue;
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      `${tone(row.glyph, row.tone, c)} ${
        styledIdentifier(row.identity.primary, c)
      }${currentMarker(row.entry.is_current, c)}`,
      ...wrappedField(
        row.label,
        styledDiscernCommands(row.attention, c),
        width,
        "  ",
      ),
    );
    if (
      row.landingReady && row.kind !== "ready" &&
      row.authority !== undefined
    ) {
      lines.push(
        ...wrappedField(
          "Readiness",
          `${tone("ready", "green", c)} · landing ${
            tone(row.authority.label, row.authority.tone, c)
          }`,
          width,
          "  ",
        ),
      );
    }
  }
  for (const collision of data.fleet_collisions ?? []) {
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      ...wrappedBullet("!", "Fleet collision", width, c, "yellow"),
      ...wrappedField(
        "Branches",
        collision.branches.map((branch) => styledIdentifier(branch, c)).join(
          " ↔ ",
        ),
        width,
        "  ",
      ),
      ...wrappedField(
        "Paths",
        `${collision.overlap.join(", ")}${
          collision.total > collision.overlap.length
            ? ` · ${collision.total} files total`
            : ""
        }`,
        width,
        "  ",
      ),
      ...wrappedField(
        "Action",
        styledDiscernCommands(
          "Whoever lands second should run `discern update` and re-read these paths.",
          c,
        ),
        width,
        "  ",
      ),
    );
  }
  for (const collision of data.adr_collisions ?? []) {
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      ...wrappedBullet(
        "!",
        `ADR ${collision.number} has multiple claims`,
        width,
        c,
        "yellow",
      ),
      ...wrappedField(
        "Branches",
        collision.branches.map((branch) => styledIdentifier(branch, c)).join(
          ", ",
        ),
        width,
        "  ",
      ),
      ...wrappedField("Records", collision.paths.join(", "), width, "  "),
      ...wrappedField(
        "Action",
        "Whoever lands second takes the next free record number.",
        width,
        "  ",
      ),
    );
  }
  if (data.git?.incoming_overlap?.length) {
    lines.push(
      ...(lines.length === 0 ? [] : [""]),
      ...wrappedField(
        "Incoming overlap",
        data.git.incoming_overlap.join(", "),
        width,
      ),
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
    ...(data.gate_receipt === undefined
      ? {}
      : { gate_receipt: data.gate_receipt }),
    ...(data.gate_receipt?.status === "honored"
      ? {
        receipt_honored: true,
        ...(data.gate_receipt.receipt === undefined
          ? {}
          : { receipt: data.gate_receipt.receipt }),
        ...(data.gate_receipt.receipt_line === undefined
          ? {}
          : { receipt_line: data.gate_receipt.receipt_line }),
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
  c: Palette,
): string[] {
  const git = data.git;
  if (git === null) {
    return wrappedField(
      "Main checkout",
      `${tone("Git unreadable", "red", c)}`,
      width,
      "",
    );
  }
  const state = git.clean
    ? `${c.dim}Git clean${c.reset}`
    : tone(`Git ${fileCount(git.changed_files)}`, "yellow", c);
  const counts = divergence(
    git.ahead_trunk === null ? undefined : git.ahead_trunk,
    git.behind_trunk === null ? undefined : git.behind_trunk,
  );
  const branch = git.branch === "" ? "(detached)" : git.branch;
  return wrappedField(
    "Main checkout",
    `${styledIdentifier(branch, c)}${currentMarker(true, c)} · ${state}${
      counts === "" ? "" : ` · ${counts}`
    }`,
    width,
    "",
  );
}

/** Render the main checkout outside the worktree list for `--all` worktree views. */
function surveyedMainCheckout(
  entry: StatusFleetEntry,
  width: number,
  nowMs: number,
  c: Palette,
): string[] {
  const state = entry.git_unavailable === true
    ? "unreadable"
    : entry.clean === true
    ? "clean"
    : fileCount(entry.changed_files ?? 0);
  const stateTone = entry.git_unavailable === true
    ? "red"
    : entry.clean === true
    ? "dim"
    : "yellow";
  const counts = divergence(entry.ahead, entry.behind);
  const activity = relativeAge(entry.last_activity, nowMs);
  return [
    ...wrappedField(
      "Git",
      `${tone(state, stateTone, c)}${counts === "" ? "" : ` · ${counts}`}`,
      width,
    ),
    ...(activity === "—" ? [] : wrappedField("Activity", activity, width)),
  ];
}

/** Lower-priority configured-scope, gate, and standards facts. */
function renderChecks(data: StatusData, width: number): string[] {
  const lines: string[] = [];
  const changedScopes = (data.scopes ?? []).filter((scope) =>
    !isScopeMarker(scope)
  );
  if (changedScopes.length > 0) {
    lines.push(
      ...wrappedField(
        "Changed scopes",
        changedScopes.join(", "),
        width,
      ),
    );
  }
  if (data.gate !== undefined) {
    const jobs = data.gate.jobs.length === 0
      ? "no jobs configured"
      : data.gate.jobs.join(", ");
    const scopes = data.gate.scope_gates.length === 0
      ? ""
      : ` · scope gates: ${data.gate.scope_gates.join(", ")}`;
    lines.push(...wrappedField("Gate", `${jobs}${scopes}`, width));
  }
  lines.push(
    ...wrappedField(
      "Standards",
      `${data.standards.length} configured`,
      width,
    ),
  );
  return lines;
}

/** Worktree-local runtime coordinates, separate from quality checks. */
function renderLocalEnvironment(
  data: StatusData,
  width: number,
  c: Palette,
): string[] {
  if (data.worktree !== null) {
    const lines = wrappedField(
      "Port",
      `${c.dim}${data.worktree.port}${c.reset}`,
      width,
    );
    const resources = Object.entries(data.worktree.resources);
    if (resources.length > 0) {
      lines.push(
        ...wrappedField(
          "Resources",
          `${c.dim}${
            resources.map(([name, value]) => `${name}=${value}`).join(", ")
          }${c.reset}`,
          width,
        ),
      );
    }
    return lines;
  }
  return [];
}

/** Useful landed-receipt facts without exposing Git-note storage plumbing. */
function renderLastLanding(
  data: StatusData,
  width: number,
  c: Palette,
  nowMs: number,
): string[] {
  if (data.landed_receipt !== undefined) {
    const receipt = data.landed_receipt.receipt;
    const age = relativeAge(data.landed_receipt.commit_at, nowMs);
    return wrappedField(
      "Last landing",
      `${tone("passed", "green", c)} · ${
        styledIdentifier(receipt.branch, c)
      } · ${
        fileCount(receipt.files_total)
      } · +${receipt.insertions} −${receipt.deletions} · ${receipt.head}${
        age === "—" ? "" : ` · ${age}`
      }`,
      width,
    );
  }
  if (data.landed_receipt_unsupported !== undefined) {
    return wrappedField(
      "Last landing",
      `${
        data.landed_receipt_unsupported.commit.slice(0, 12)
      } · receipt unavailable in this discern version (${data.landed_receipt_unsupported.format})`,
      width,
    );
  }
  return [];
}

/** Setup-incomplete action block that still obeys the report width. */
function renderSetup(data: StatusData, width: number, c: Palette): string[] {
  const setup = data.setup_unfinished;
  if (setup === undefined) return [];
  const lines = wrappedBullet(
    "!",
    "Setup is not finished. Complete the setup brief before starting or landing work.",
    width,
    c,
    "yellow",
  );
  if (setup.pending_markers.length > 0) {
    lines.push(
      ...wrappedField(
        "Skeleton markers",
        setup.pending_markers.join(", "),
        width,
      ),
    );
  }
  const wired = setup.known_jobs.filter((job) => job.wired).map((job) =>
    job.name
  );
  const missing = setup.known_jobs.filter((job) => !job.wired).map((job) =>
    job.name
  );
  lines.push(
    ...wrappedField(
      "Gate jobs",
      `${wired.length === 0 ? "none configured" : wired.join(", ")}${
        missing.length === 0 ? "" : ` · still unset: ${missing.join(", ")}`
      }`,
      width,
    ),
  );
  return lines;
}

/** Copyable stored Markdown pages shown only under `--verbose`. */
function renderVerboseReceipts(
  data: StatusData,
  rows: readonly FleetRowPresentation[],
  c: Palette,
): StatusSectionLine[] {
  const blocks: StatusSectionLine[] = [];
  const add = (label: string, page: string | undefined): void => {
    if (page === undefined) return;
    const styledPage = styledDiscernCommands(page, c, c.dim);
    blocks.push(
      ...(blocks.length === 0 ? [] : [""]),
      `${c.dim}${label}${c.reset}`,
      {
        verbatim: dimBlock(
          styledPage,
          (line) => `${c.dim}${line}${c.reset}`,
        ),
      },
    );
  };
  add("Last landed receipt", data.landed_receipt?.receipt.markdown);
  add("Current worktree receipt", data.gate_receipt?.receipt);
  for (const row of rows) {
    add(`Receipt · ${row.identity.primary}`, row.entry.receipt);
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
 * function performs no Git, receipt, authority, collision, or logbook reads. */
export function renderStatusDashboard(
  data: StatusData,
  hints: readonly string[] | undefined,
  options: StatusDashboardOptions,
): string {
  const width = reportWidth(options.width);
  const contentWidth = sectionContentWidth(width);
  const nowMs = options.nowMs ?? Date.now();
  const c = palette(options.color ?? false);
  const project = data.project ?? (basename(data.root) || data.root);
  const heading = wrapText(
    `${c.bold}discern status${c.reset} ${c.dim}· ${project}${c.reset}`,
    width,
    SECTION_CONTENT_INDENT,
    { breakLongWords: true },
  ).join("\n");
  const blocks: string[] = [heading];

  const setup = renderSetup(data, contentWidth, c);
  if (setup.length > 0) blocks.push(section("Setup", setup, c));
  if (data.location === "main" && data.fleet === undefined) {
    blocks.push(mainCheckoutLine(data, width, c).join("\n"));
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
      section("Fleet", renderFleetSummary(fleetRows, contentWidth), c),
    );
  }
  const attention = renderAttention(shownRows, data, contentWidth, c);
  if (attention.length > 0) {
    blocks.push(section("Attention", attention, c));
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
        ),
        c,
      ),
    );
  } else if (data.fleet !== undefined) {
    blocks.push(section("Worktrees", ["No active worktrees."], c));
  } else if (localRows.length > 0) {
    blocks.push(
      section(
        "Current worktree",
        renderWorktrees(localRows, contentWidth, c, false),
        c,
      ),
    );
  }
  if (data.location === "main" && data.fleet !== undefined) {
    blocks.push(mainCheckoutLine(data, width, c).join("\n"));
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
      ),
    );
  }

  const next = interactiveHintTexts(hints).flatMap((hint) =>
    wrappedBullet("→", hint, contentWidth, c)
  );
  if (next.length > 0) blocks.push(section("Next steps", next, c));

  const checks = renderChecks(data, contentWidth);
  if (checks.length > 0) blocks.push(section("Checks", checks, c));
  const environment = renderLocalEnvironment(data, contentWidth, c);
  if (environment.length > 0) {
    blocks.push(section("Local environment", environment, c));
  }
  const landing = renderLastLanding(data, contentWidth, c, nowMs);
  if (landing.length > 0) blocks.push(section("Landing", landing, c));

  if (options.verbose === true) {
    const receipts = renderVerboseReceipts(data, shownRows, c);
    if (receipts.length > 0) {
      blocks.push(section("Receipts", receipts, c));
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
