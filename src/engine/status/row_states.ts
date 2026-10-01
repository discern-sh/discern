/**
 * Status's row-state vocabulary.
 *
 * One closed table names every state a fleet row can be in, the group it sorts
 * into, and the label, glyph, and tones every surface renders for it:
 * `discern status`, `discern enter`, and the Desk all read it. Status first
 * classifies a row into one of its closed kinds (`classifyRowKind`), then
 * `rowStateFor` refines that kind into exactly one state by a written
 * precedence. Each state's sentences live beside it in `row_sentences.ts`
 * and the facts they read in `row_facts.ts`. Pure: time, the trunk, and the
 * queue and integration facts are inputs, never reads.
 */

import type {
  Proof,
  StatusFleetEntry,
  SubmissionRowData,
} from "../../shared/result_schemas.ts";
import {
  FLEET_ROW_GROUPS,
  type FleetRowGroup,
  type FleetRowStateId,
} from "../../shared/fleet_row_vocabulary.ts";
import { isPositiveGitCount } from "../../shared/git_count.ts";
import { degradedFleetKind } from "./recovery_presentation.ts";
import {
  type FleetBranchRowFacts,
  type FleetRowIntegration,
  fleetRowProof,
  type FleetRowStatusKind,
  type FleetTaskRowFacts,
  hasExceptionFacts,
  hasLandableFacts,
  idleDaysOf,
  STALE_WORKTREE_DAYS,
} from "./row_facts.ts";
import {
  BRANCH_ROW_SENTENCES,
  type FleetBranchRowStateId,
  type FleetRowSentences,
  type FleetTaskRowStateId,
  TASK_ROW_SENTENCES,
} from "./row_sentences.ts";

/** Semantic colour roles; green (`success`) is reserved for landable rows. */
export type FleetRowTone =
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "faint";

/** The facts a one-line summary leads with, by name. */
export type FleetRowFactName =
  | "checks"
  | "main"
  | "landing"
  | "queue"
  | "changes"
  | "setup"
  | "error"
  | "exception"
  | "branch"
  | "parked";

/** The look every surface shares for one state. */
export interface FleetRowStateLook {
  readonly group: FleetRowGroup;
  /** At most 13 terminal cells; a queue place may follow (`Queued #2`). */
  readonly label: string;
  readonly glyph: string;
  /** Unique within the state column, so plain output keeps every state. */
  readonly ascii: string;
  readonly glyphTone: FleetRowTone;
  readonly labelTone: FleetRowTone;
  /** The two facts a one-line summary leads with. */
  readonly headline: readonly [FleetRowFactName, FleetRowFactName];
}

/** One complete state: its id, look, and sentences. */
export type FleetRowState<Facts> =
  & { readonly id: FleetRowStateId }
  & FleetRowStateLook
  & FleetRowSentences<Facts>;

/** Group titles, as every surface shows them. */
export const FLEET_ROW_GROUP_TITLES = {
  review: "Ready for review",
  attention: "Needs attention",
  working: "Working",
  approved: "Approved to land",
  idle: "Idle",
  parked: "Parked",
  landed: "Landed",
} as const satisfies Record<FleetRowGroup, string>;

/** Display rank of a group: decisions first, then branch groups. */
export function fleetRowGroupRank(group: FleetRowGroup): number {
  return FLEET_ROW_GROUPS.indexOf(group);
}

/** A look shared by one family of states. */
function look(
  group: FleetRowGroup,
  label: string,
  glyph: readonly [string, string],
  tones: readonly [FleetRowTone, FleetRowTone],
  headline: readonly [FleetRowFactName, FleetRowFactName],
): FleetRowStateLook {
  return {
    group,
    label,
    glyph: glyph[0],
    ascii: glyph[1],
    glyphTone: tones[0],
    labelTone: tones[1],
    headline,
  };
}

const FAILED = ["✕", "x"] as const;
const WARNED = ["!", "!"] as const;
const SPINNING = ["◐", "@"] as const;
const LANDABLE = ["✓", "v"] as const;
const APPROVED = ["▲", "^"] as const;
const WAITING = ["△", "."] as const;
const QUIET = ["○", "o"] as const;

const DANGER = ["danger", "danger"] as const;
const WARNING = ["warning", "warning"] as const;
const ACTIVE = ["accent", "muted"] as const;
const GREEN = ["success", "success"] as const;
const GREEN_GLYPH = ["success", "muted"] as const;
const MUTED = ["muted", "muted"] as const;
const FAINT = ["faint", "faint"] as const;

/** Every state's look, keyed by state. */
export const FLEET_ROW_STATES = {
  broken: look("attention", "Broken", FAILED, DANGER, ["setup", "error"]),
  unreadable: look("attention", "Unreadable", FAILED, DANGER, [
    "error",
    "main",
  ]),
  "setup-retry": look("attention", "Needs setup", WARNED, WARNING, [
    "setup",
    "error",
  ]),
  "setup-manual": look("attention", "Needs setup", WARNED, WARNING, [
    "setup",
    "error",
  ]),
  "setup-unknown": look("attention", "Setup unknown", WARNED, WARNING, [
    "setup",
    "changes",
  ]),
  landing: look("working", "Landing", SPINNING, ACTIVE, ["checks", "main"]),
  exception: look("review", "Exception", WARNED, WARNING, [
    "exception",
    "checks",
  ]),
  interrupted: look("attention", "Interrupted", WARNED, WARNING, [
    "landing",
    "main",
  ]),
  checking: look("working", "Checking", SPINNING, ACTIVE, [
    "checks",
    "changes",
  ]),
  updating: look("working", "Updating", SPINNING, ACTIVE, ["main", "changes"]),
  running: look("working", "Running", SPINNING, ACTIVE, ["checks", "changes"]),
  "checks-failed": look("attention", "Checks failed", FAILED, DANGER, [
    "checks",
    "main",
  ]),
  "land-failed": look("attention", "Didn't land", FAILED, DANGER, [
    "checks",
    "main",
  ]),
  failed: look("attention", "Failed", FAILED, DANGER, ["checks", "changes"]),
  "awaiting-owner": look("review", "Wants to land", LANDABLE, GREEN, [
    "checks",
    "landing",
  ]),
  refused: look("attention", "Refused", WARNED, WARNING, ["checks", "landing"]),
  "stale-proven": look("attention", "Stale", WARNED, WARNING, [
    "checks",
    "main",
  ]),
  stale: look("attention", "Stale", WARNED, WARNING, ["changes", "checks"]),
  editing: look("working", "Editing", ["●", "*"], ACTIVE, [
    "changes",
    "checks",
  ]),
  queued: look("approved", "Queued", APPROVED, GREEN_GLYPH, [
    "queue",
    "checks",
  ]),
  approved: look("approved", "Approved", APPROVED, GREEN_GLYPH, [
    "landing",
    "checks",
  ]),
  ready: look("review", "Ready", LANDABLE, GREEN, ["checks", "main"]),
  behind: look("idle", "Behind", WAITING, MUTED, ["main", "checks"]),
  "proof-error": look("attention", "Proof error", FAILED, DANGER, [
    "checks",
    "changes",
  ]),
  "proof-unknown": look("attention", "Proof unknown", WARNED, WARNING, [
    "checks",
    "changes",
  ]),
  recheck: look("idle", "Needs recheck", WAITING, MUTED, ["checks", "changes"]),
  "needs-checks": look("idle", "Needs checks", WAITING, MUTED, [
    "checks",
    "changes",
  ]),
  contained: look("idle", "Contained", QUIET, FAINT, ["branch", "changes"]),
  empty: look("idle", "Empty", QUIET, FAINT, ["changes", "checks"]),
  "idle-unknown": look("idle", "Idle", QUIET, FAINT, ["main", "changes"]),
  parked: look("parked", "Parked", ["◇", "~"], FAINT, ["branch", "parked"]),
  landed: look("landed", "Landed", LANDABLE, FAINT, ["branch", "checks"]),
} as const satisfies Record<FleetRowStateId, FleetRowStateLook>;

/** One live task state, complete. */
export function taskRowState(
  id: FleetTaskRowStateId,
): FleetRowState<FleetTaskRowFacts> {
  return { id, ...FLEET_ROW_STATES[id], ...TASK_ROW_SENTENCES[id] };
}

/** One branch state, complete. */
export function branchRowState(
  id: FleetBranchRowStateId,
): FleetRowState<FleetBranchRowFacts> {
  return { id, ...FLEET_ROW_STATES[id], ...BRANCH_ROW_SENTENCES[id] };
}

/** A state's label, with its queue place when it has one (`Queued #2`). */
export function rowStateLabel(
  state: FleetRowStateId,
  queueRow: Pick<SubmissionRowData, "position"> | undefined,
): string {
  const base = FLEET_ROW_STATES[state].label;
  return state === "queued" && queueRow !== undefined
    ? `${base} #${queueRow.position}`
    : base;
}

/**
 * Classify one row into its status kind; the first match wins. Successful
 * observation commands are absent on purpose: `status ok` is activity, never
 * health evidence.
 */
export function classifyRowKind(
  entry: StatusFleetEntry,
  nowMs: number,
): FleetRowStatusKind {
  const degraded = degradedFleetKind(entry);
  if (degraded !== undefined) return degraded;
  if (entry.running !== undefined) return "running";
  const outcome = entry.last_action?.outcome;
  if (outcome === "failed" || outcome === "partial") return "failed";
  if (outcome === "refused") return "blocked";
  const idleDays = idleDaysOf(entry.last_activity, nowMs);
  if (
    idleDays !== undefined && idleDays >= STALE_WORKTREE_DAYS &&
    (entry.clean === false ||
      (entry.ahead !== undefined && isPositiveGitCount(entry.ahead)))
  ) return "stale";
  if (entry.clean === false) return "in-progress";
  // Ready outranks behind: honored Proof covers the exact HEAD, and a moved
  // trunk is composed by acceptance itself — the row is landable, not owed
  // an author-side update.
  if (hasLandableFacts(entry)) return "ready";
  if (entry.behind !== undefined && isPositiveGitCount(entry.behind)) {
    return "behind";
  }
  const proof = fleetRowProof(entry).status;
  if (proof === "read_failed") return "proof-unreadable";
  if (proof === "unavailable") return "proof-unavailable";
  if (proof === "stale") return "proof-stale";
  if (
    entry.ahead !== undefined && isPositiveGitCount(entry.ahead) &&
    proof !== "honored"
  ) return "needs-gate";
  return "idle";
}

/** The facts beyond the row itself that can refine its state. */
export interface RowStateContext {
  readonly queueRow?: SubmissionRowData | undefined;
  readonly integration?: FleetRowIntegration | undefined;
  readonly proofData?: Proof | undefined;
}

/** P3: a running verb names what the task is doing. */
const RUNNING_STATES: Readonly<Record<string, FleetTaskRowStateId>> = {
  done: "checking",
  accept: "landing",
  update: "updating",
};

/** P4: a failed verb names what did not happen. */
const FAILED_STATES: Readonly<Record<string, FleetTaskRowStateId>> = {
  done: "checks-failed",
  accept: "land-failed",
};

/** P5: refusal slugs that wait on an owner decision rather than an agent. */
const REFUSAL_STATES: Readonly<Record<string, FleetTaskRowStateId>> = {
  awaiting_variance: "exception",
  awaiting_standard_approval: "exception",
  awaiting_consent: "awaiting-owner",
};

/** P7 and P9: editing, then the behind and Proof kinds, each name one state. */
const KIND_STATES: Readonly<
  Partial<Record<FleetRowStatusKind, FleetTaskRowStateId>>
> = {
  "in-progress": "editing",
  behind: "behind",
  "proof-unreadable": "proof-error",
  "proof-unavailable": "proof-unknown",
  "proof-stale": "recheck",
  "needs-gate": "needs-checks",
};

/** P1: a degraded kind resolves by its setup evidence. */
function degradedState(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
): FleetTaskRowStateId | undefined {
  if (kind === "broken" || kind === "unreadable") return kind;
  if (kind !== "setup-incomplete") return undefined;
  if (entry.setup?.state === "unavailable") return "setup-unknown";
  return entry.setup?.repair?.kind === "retry" ? "setup-retry" : "setup-manual";
}

/** P2: a landing's integration copy speaks for the task it lands. A live
 * owner outranks a retained decision, which outranks a dead owner. A copy
 * retained for the agent's checkpoint answers is the agent's move, so it
 * reads Refused; any other retained decision is the owner's exception. */
function integrationState(
  integration: FleetRowIntegration | undefined,
): FleetTaskRowStateId | undefined {
  if (integration === undefined) return undefined;
  if (integration.owner === "live") return "landing";
  if (integration.awaiting_judgment === true) {
    return integration.judgment?.decision === "declaration"
      ? "refused"
      : "exception";
  }
  return integration.owner === "interrupted" ? "interrupted" : undefined;
}

/** P8: ready work resolves by its exceptions, queue row, and authority. */
function readyState(
  entry: StatusFleetEntry,
  context: RowStateContext,
): FleetTaskRowStateId {
  if (hasExceptionFacts(context.proofData)) return "exception";
  if (context.queueRow?.authority === "awaiting-owner") return "awaiting-owner";
  const authorized = entry.landing_authority?.kind === "authorized" ||
    context.queueRow?.authority === "pre-authorized";
  if (!authorized) return "ready";
  return context.queueRow === undefined ? "approved" : "queued";
}

/** P3–P8: the kinds whose state depends on what the task last did. */
function activityState(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  context: RowStateContext,
): FleetTaskRowStateId | undefined {
  switch (kind) {
    case "running":
      return RUNNING_STATES[entry.running?.verb ?? ""] ?? "running";
    case "failed":
      return FAILED_STATES[entry.last_action?.verb ?? ""] ?? "failed";
    case "blocked": {
      // A refusal that waits on the owner holds only while the work it
      // refused is still landable; otherwise the row is an ordinary refusal.
      const waiting = REFUSAL_STATES[entry.last_action?.error ?? ""];
      return waiting !== undefined && hasLandableFacts(entry)
        ? waiting
        : "refused";
    }
    case "stale":
      // A contained branch idles by design: its commits travel on in a
      // later task, so its age never makes it abandoned work.
      if (entry.contained_in !== undefined && entry.clean === true) {
        return "contained";
      }
      return fleetRowProof(entry).status === "honored"
        ? "stale-proven"
        : "stale";
    case "ready":
      return readyState(entry, context);
    default:
      return undefined;
  }
}

/**
 * Refine a status kind into exactly one state. The written precedence; the
 * first match wins: P1 degraded kinds; P2 integration facts for the task; P3
 * running, by verb; P4 failed, by verb; P5 refused, by slug; P6 stale, where
 * a clean contained branch stays Contained; P7 editing; P8 ready, by
 * exception, queue, and authority; then containment, which outranks the
 * behind and Proof kinds (P9) and idle (P10) because a contained branch's
 * commits travel in a later task. Behind needs commits of its own.
 */
export function rowStateFor(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  context: RowStateContext = {},
): FleetTaskRowStateId {
  return degradedState(kind, entry) ??
    integrationState(context.integration) ??
    activityState(kind, entry, context) ??
    restingState(kind, entry);
}

/** P9 and P10: containment, then the behind and Proof kinds, then idle. A
 * clean task with nothing of its own reads Empty however far the trunk has
 * moved, because there is no work to update or check yet. */
function restingState(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
): FleetTaskRowStateId {
  if (entry.contained_in !== undefined && kind !== "in-progress") {
    return "contained";
  }
  const empty = entry.clean === true && entry.ahead === 0;
  if (kind === "behind" && empty) return "empty";
  return KIND_STATES[kind] ?? (empty ? "empty" : "idle-unknown");
}
