/**
 * The fleet-row model every human fleet surface shares.
 *
 * `presentFleetRow` joins one surveyed row to status's row-state table
 * (`row_states.ts`) and its human fact wording, and `sortFleetRows` orders
 * rows the way every surface lists them. The status dashboard, `discern
 * enter`, and the Desk render this model; none of them reclassifies a row.
 * Pure: time, the trunk, the queue, and the fleet are inputs.
 */

import { basename } from "@std/path";
import type {
  GateProofCheckStatus,
  StatusFleetCollision,
  StatusFleetEntry,
  SubmissionRowData,
} from "../../shared/result_schemas.ts";
import type { FleetRowGroup } from "../../shared/fleet_row_vocabulary.ts";
import {
  type GitCount,
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import { compactDuration } from "../output.ts";
import { taskLabel } from "../worktree/task_label.ts";
import {
  classifyRowKind,
  fleetRowGroupRank,
  type FleetRowTone,
  rowStateFor,
  rowStateLabel,
  taskRowState,
} from "./row_states.ts";
import {
  authorityHuman,
  type FleetRowIntegration,
  fleetRowProof,
  type FleetRowStatusKind,
  type FleetTaskRowFacts,
  proofHuman,
  queueHuman,
  relativeAge,
} from "./row_facts.ts";
import type { FleetTaskRowStateId } from "./row_sentences.ts";

interface RowIdentity {
  primary: string;
  /** Exact worktree id used as Fleet's persona identity. */
  worktree: string;
  secondary?: string;
}

interface ProofPresentation {
  status: GateProofCheckStatus;
  /** The recorded checks in human words. */
  label: string;
  detail?: string;
}

interface RowCollision {
  branch: string;
  overlap: readonly string[];
  total: number;
}

/** One fleet row as every human surface presents it: status's closed kind,
 * the state it refines to, and that state's look and sentences. */
export interface FleetRowPresentation {
  entry: StatusFleetEntry;
  kind: FleetRowStatusKind;
  state: FleetTaskRowStateId;
  group: FleetRowGroup;
  /** The state's label, with the queue place when it has one. */
  label: string;
  glyph: string;
  ascii: string;
  tones: { readonly glyph: FleetRowTone; readonly label: FleetRowTone };
  /** The short phrase after the label on a state line. */
  qualifier?: string;
  /** Human register: what is true and who moves next. */
  explanation: string;
  /** CLI register: the next step with its command, when one is due. */
  attention?: string;
  identity: RowIdentity;
  git: string;
  proof: ProofPresentation;
  activity: string;
  /** Proof-backed landing readiness after the row's own state is classified. */
  landingReady: boolean;
  /** The landing-authority fact in human words, when it bears on landing. */
  authority?: string;
  /** The landing-queue fact, when the task is queued. */
  queue?: string;
  collisions: readonly RowCollision[];
}

export interface FleetRowPresentationOptions {
  trunk: string;
  nowMs: number;
  collisions?: readonly StatusFleetCollision[];
  /** The landing queue, so a queued task reads its place and authority. */
  queue?: readonly SubmissionRowData[];
  /** The whole fleet, so a landing's integration copy speaks for its task. */
  fleet?: readonly StatusFleetEntry[];
}

/** Human file-count phrase with a precise unit. */
export function fileCount(count: number): string {
  return `${count} file${count === 1 ? "" : "s"} changed`;
}

/** The recorded checks in human words, plus the stale commit pair. */
function proofPresentation(
  entry: StatusFleetEntry,
  nowMs: number,
): ProofPresentation {
  const proof = fleetRowProof(entry);
  const detail = proof.reason ?? (
    proof.status === "stale" && proof.recorded !== undefined &&
      proof.head !== undefined
      ? `recorded at ${proof.recorded.slice(0, 12)}; HEAD is ${
        proof.head.slice(0, 12)
      }`
      : undefined
  );
  return {
    status: proof.status,
    label: proofHuman(proof, nowMs),
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
export function divergence(
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

/** The integration copy that speaks for a row: the row's own record, or the
 * copy landing its branch. */
function integrationFor(
  entry: StatusFleetEntry,
  fleet: readonly StatusFleetEntry[],
): FleetRowIntegration | undefined {
  if (entry.integration !== undefined) return entry.integration;
  if (entry.branch === "") return undefined;
  return fleet.find((other) => other.integration?.for_branch === entry.branch)
    ?.integration;
}

/** Whether a row is a landing's integration copy whose task has its own row;
 * the task's row then carries the landing as its state. */
export function speaksForAnotherRow(
  entry: StatusFleetEntry,
  fleet: readonly StatusFleetEntry[],
): boolean {
  const landed = entry.integration?.for_branch;
  return landed !== undefined &&
    fleet.some((other) =>
      other.integration === undefined && other.branch === landed
    );
}

/** Derive one complete human row model from already-collected result facts. */
export function presentFleetRow(
  entry: StatusFleetEntry,
  options: FleetRowPresentationOptions,
): FleetRowPresentation {
  const nowMs = options.nowMs;
  const proof = proofPresentation(entry, nowMs);
  const kind = classifyRowKind(entry, nowMs);
  const queueRow = entry.branch === ""
    ? undefined
    : options.queue?.find((row) => row.branch === entry.branch);
  const integration = integrationFor(entry, options.fleet ?? []);
  const state = rowStateFor(kind, entry, {
    queueRow,
    integration,
    proofData: entry.gate_proof?.proof_data,
  });
  const definition = taskRowState(state);
  const facts: FleetTaskRowFacts = {
    entry,
    kind,
    trunk: options.trunk,
    nowMs,
    queueRow,
    integration,
  };
  const qualifier = definition.qualifier(facts);
  const attention = definition.attention(facts);
  const authority =
    proof.status === "honored" || entry.landing_authority?.kind === "authorized"
      ? authorityHuman(entry)
      : undefined;
  return {
    entry,
    kind,
    state,
    group: definition.group,
    label: rowStateLabel(state, queueRow),
    glyph: definition.glyph,
    ascii: definition.ascii,
    tones: { glyph: definition.glyphTone, label: definition.labelTone },
    ...(qualifier === undefined ? {} : { qualifier }),
    explanation: definition.explanation(facts),
    ...(attention === undefined ? {} : { attention }),
    identity: rowIdentity(entry),
    git: gitPresentation(entry),
    proof,
    activity: activityPresentation(entry, nowMs),
    landingReady: kind === "ready",
    ...(authority === undefined ? {} : { authority }),
    ...(queueRow === undefined ? {} : { queue: queueHuman(queueRow) }),
    collisions: rowCollisions(entry, options.collisions ?? []),
  };
}

const TITLE_ORDER = new Intl.Collator("en", { sensitivity: "base" });

/** Decision groups in display order; the current checkout leads its group;
 * then case-folded task titles, and the exact identity for ties. */
export function sortFleetRows(
  rows: readonly FleetRowPresentation[],
): FleetRowPresentation[] {
  return [...rows].sort((left, right) =>
    fleetRowGroupRank(left.group) - fleetRowGroupRank(right.group) ||
    Number(right.entry.is_current) - Number(left.entry.is_current) ||
    TITLE_ORDER.compare(
      taskLabel(left.entry).name,
      taskLabel(right.entry).name,
    ) ||
    left.identity.primary.localeCompare(right.identity.primary) ||
    left.entry.path.localeCompare(right.entry.path)
  );
}
