/**
 * One status fixture per row of the written row-state table, in its order,
 * with the small builders it is made of. The row-state precedence test proves
 * each row resolves to its state; Desk guards walk the same rows so every
 * state's next steps are checked against a real decision.
 */

import type {
  GateProofCheckData,
  Proof,
  StatusFleetEntry,
  SubmissionRowData,
} from "../../src/shared/result_schemas.ts";
import type { FleetRowStateId } from "../../src/shared/fleet_row_vocabulary.ts";
import type { DeskAction } from "../../src/shared/desk_vocabulary.ts";
import type { RowStateContext } from "../../src/engine/status/row_states.ts";
import type { FleetRowIntegration } from "../../src/engine/status/row_facts.ts";
import { exceptionProof as proofData, fleetEntry } from "./status_fleet.ts";

export const NOW = Date.parse("2026-09-30T12:00:00.000Z");
export const minutesAgo = (minutes: number): string =>
  new Date(NOW - minutes * 60_000).toISOString();
export const daysAgo = (days: number): string =>
  new Date(NOW - days * 86_400_000).toISOString();

/** A honored Proof inspection, optionally with owner decisions. */
export function honored(data?: Proof): GateProofCheckData {
  return {
    status: "honored",
    ...(data === undefined ? {} : { proof_data: data }),
  };
}

/** One landing-queue row for the task. */
export function queueRow(
  authority: "pre-authorized" | "awaiting-owner",
  patch: Partial<SubmissionRowData> = {},
): SubmissionRowData {
  return {
    effort: "task",
    branch: "agent/task",
    path: "/worktrees/agent/task",
    head: "abc1234",
    submitted_at: minutesAgo(10),
    authority,
    position: 1,
    readiness: "ready",
    ...patch,
  };
}

/** A clean task with one commit ahead and a honored Proof. */
export function landable(
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return task({ ahead: 1, gate_proof: honored(), ...patch });
}

/** A fresh, clean task row. */
export function task(patch: Partial<StatusFleetEntry> = {}): StatusFleetEntry {
  return fleetEntry({
    id: "task",
    last_activity: minutesAgo(5),
    gate_proof: { status: "missing" },
    ...patch,
  });
}

export const RUNNING = (verb: string): Partial<StatusFleetEntry> => ({
  running: {
    verb,
    started: minutesAgo(1),
    elapsed_ms: 72_000,
    typical_duration_ms: 180_000,
  },
});

export const LAST = (
  verb: string,
  outcome: "ok" | "failed" | "partial" | "refused",
  error?: NonNullable<StatusFleetEntry["last_action"]>["error"],
): Partial<StatusFleetEntry> => ({
  last_action: {
    verb,
    outcome,
    at: minutesAgo(120),
    ...(outcome === "failed" ? { failed_stage: "test" } : {}),
    ...(error === undefined ? {} : { error }),
  },
});

/** The receipt a retained fixture composition serves. */
export const RECEIPT = "R1-retained-composition";

export const INTEGRATION = (
  owner: "live" | "interrupted",
  awaiting = false,
  decision?: "declaration" | "variance",
): FleetRowIntegration => ({
  owner,
  for_branch: "agent/task",
  ...(awaiting ? { awaiting_judgment: true } : {}),
  ...(decision === undefined ? {} : {
    judgment: { composition: RECEIPT, decision, awaiting: ["exactness"] },
  }),
});

export const SETUP = (
  state: "incomplete" | "unavailable",
  repair?: "retry" | "manual",
): Partial<StatusFleetEntry> => ({
  setup: {
    state,
    marker: state === "incomplete" ? "missing" : "unavailable",
    journal: {
      status: "recorded",
      steps: [
        { id: "a", command: "one", state: "completed" },
        { id: "b", command: "two", state: "completed" },
        { id: "c", command: "three", state: "running" },
        { id: "d", command: "four", state: "not_started" },
      ],
    },
    ...(repair === undefined ? {} : {
      repair: { kind: repair, command: "discern worktree setup", reason: "x" },
    }),
  },
});

export interface TableRow {
  /** The row number in the written state table. */
  readonly row: number;
  readonly entry: StatusFleetEntry;
  readonly context?: RowStateContext;
  readonly state: FleetRowStateId;
  /** The table's Next column: the action Enter runs for this state. */
  readonly next: DeskAction;
}

/** One fixture per row of the written state table, in its order. */
export const TABLE_ROWS: readonly TableRow[] = [
  { row: 1, entry: task({ broken: true }), state: "broken", next: "recovery" },
  {
    row: 2,
    entry: task({ git_unavailable: true }),
    state: "unreadable",
    next: "recovery",
  },
  {
    row: 3,
    entry: task(SETUP("incomplete", "retry")),
    state: "setup-retry",
    next: "retry_setup",
  },
  {
    row: 4,
    entry: task(SETUP("incomplete", "manual")),
    state: "setup-manual",
    next: "recovery",
  },
  {
    row: 4,
    entry: task(SETUP("incomplete")),
    state: "setup-manual",
    next: "recovery",
  },
  {
    row: 5,
    entry: task(SETUP("unavailable")),
    state: "setup-unknown",
    next: "recovery",
  },
  {
    row: 6,
    entry: landable(),
    context: { integration: INTEGRATION("live") },
    state: "landing",
    next: "inspect",
  },
  {
    row: 7,
    entry: landable(),
    context: { integration: INTEGRATION("interrupted", true) },
    state: "exception",
    next: "inspect",
  },
  {
    row: 7,
    entry: landable(),
    context: { integration: INTEGRATION("interrupted", true, "variance") },
    state: "exception",
    next: "inspect",
  },
  {
    row: 7,
    entry: landable(),
    context: { integration: INTEGRATION("interrupted", true, "declaration") },
    state: "refused",
    next: "agent",
  },
  {
    row: 8,
    entry: landable(),
    context: { integration: INTEGRATION("interrupted") },
    state: "interrupted",
    next: "recovery",
  },
  { row: 9, entry: task(RUNNING("done")), state: "checking", next: "inspect" },
  {
    row: 10,
    entry: task(RUNNING("accept")),
    state: "landing",
    next: "inspect",
  },
  {
    row: 11,
    entry: task(RUNNING("update")),
    state: "updating",
    next: "inspect",
  },
  {
    row: 12,
    entry: task(RUNNING("refresh")),
    state: "running",
    next: "inspect",
  },
  {
    row: 13,
    entry: task(LAST("done", "failed")),
    state: "checks-failed",
    next: "agent",
  },
  {
    row: 14,
    entry: task(LAST("accept", "failed")),
    state: "land-failed",
    next: "agent",
  },
  {
    row: 15,
    entry: task(LAST("refresh", "failed")),
    state: "failed",
    next: "agent",
  },
  {
    row: 15,
    entry: task(LAST("refresh", "partial")),
    state: "failed",
    next: "agent",
  },
  {
    row: 16,
    entry: landable(LAST("accept", "refused", "awaiting_variance")),
    state: "exception",
    next: "inspect",
  },
  {
    row: 16,
    entry: landable(LAST("accept", "refused", "awaiting_standard_approval")),
    state: "exception",
    next: "inspect",
  },
  {
    row: 17,
    entry: landable(LAST("accept", "refused", "awaiting_consent")),
    state: "awaiting-owner",
    next: "accept",
  },
  {
    row: 18,
    entry: landable(LAST("accept", "refused", "dirty_worktree")),
    state: "refused",
    next: "agent",
  },
  {
    row: 18,
    entry: task({
      ...LAST("accept", "refused", "awaiting_consent"),
      clean: false,
      changed_files: 1,
      ahead: 1,
      gate_proof: { status: "dirty" },
    }),
    state: "refused",
    next: "agent",
  },
  {
    row: 19,
    entry: landable({ behind: 361, last_activity: daysAgo(11) }),
    state: "stale-proven",
    next: "inspect",
  },
  {
    row: 20,
    entry: task({ ahead: 2, last_activity: daysAgo(11) }),
    state: "stale",
    next: "inspect",
  },
  {
    row: 21,
    entry: task({
      clean: false,
      changed_files: 5,
      gate_proof: { status: "dirty" },
    }),
    state: "editing",
    next: "agent",
  },
  {
    row: 22,
    entry: landable({ gate_proof: honored(proofData(["exactness"])) }),
    state: "exception",
    next: "inspect",
  },
  {
    row: 23,
    entry: landable(),
    context: { queueRow: queueRow("awaiting-owner") },
    state: "awaiting-owner",
    next: "accept",
  },
  {
    row: 24,
    entry: landable({
      landing_authority: { kind: "authorized", source: "effort-grant" },
    }),
    context: { queueRow: queueRow("pre-authorized") },
    state: "queued",
    next: "accept",
  },
  {
    row: 24,
    entry: landable(),
    context: {
      queueRow: queueRow("pre-authorized", {
        readiness: "waiting",
        reason: "Its branch moved on after the submission.",
      }),
    },
    state: "queued",
    next: "accept",
  },
  {
    row: 25,
    entry: landable({
      landing_authority: { kind: "authorized", source: "standing-grant" },
    }),
    state: "approved",
    next: "accept",
  },
  {
    row: 26,
    entry: landable({ landing_authority: { kind: "conversation-required" } }),
    state: "ready",
    next: "accept",
  },
  {
    row: 27,
    entry: task({ ahead: 2, behind: 3 }),
    state: "behind",
    next: "update",
  },
  {
    row: 28,
    entry: task({ ahead: 1, gate_proof: { status: "read_failed" } }),
    state: "proof-error",
    next: "done",
  },
  {
    row: 29,
    entry: task({ ahead: 1, gate_proof: { status: "unavailable" } }),
    state: "proof-unknown",
    next: "done",
  },
  {
    row: 30,
    entry: task({ ahead: 1, gate_proof: { status: "stale" } }),
    state: "recheck",
    next: "done",
  },
  { row: 31, entry: task({ ahead: 1 }), state: "needs-checks", next: "done" },
  {
    row: 32,
    entry: task({ ahead: 1, contained_in: "agent/later" }),
    state: "contained",
    next: "reclaim",
  },
  {
    row: 32,
    entry: task({
      ahead: 2,
      contained_in: "agent/later",
      last_activity: daysAgo(10),
    }),
    state: "contained",
    next: "reclaim",
  },
  { row: 33, entry: task(), state: "empty", next: "agent" },
  { row: 33, entry: task({ behind: 5 }), state: "empty", next: "agent" },
  {
    row: 34,
    entry: task({ ahead: "unknown", behind: "unknown" }),
    state: "idle-unknown",
    next: "inspect",
  },
];
