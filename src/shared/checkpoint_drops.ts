/**
 * Stable reasons a configured checkpoint could not be enforced. Every
 * fail-open site records one of these values so the Gate, Proof, acceptance,
 * and durable proof note can preserve the same account. The registry also
 * declares whether a reason applies before an entry is knowable or after an
 * entry is resolved.
 */

import type { CheckpointMode } from "./checkpoints.ts";

export const GATE_MODES = ["strict", "report"] as const;
export type GateMode = (typeof GATE_MODES)[number];

export const CHECKPOINT_DROP_REASON_REGISTRY = [
  { reason: "merge_base_unresolved", scopes: ["policy"] },
  { reason: "governing_config_unreadable", scopes: ["policy"] },
  { reason: "governing_config_invalid", scopes: ["policy"] },
  { reason: "checkpoint_missing_question", scopes: ["checkpoint"] },
  { reason: "checkpoint_selector_conflict", scopes: ["checkpoint"] },
  { reason: "checkpoint_unknown_scope", scopes: ["checkpoint"] },
  { reason: "effort_diff_unreadable", scopes: ["checkpoint"] },
  { reason: "when_spawn_failed", scopes: ["checkpoint"] },
  { reason: "when_timeout", scopes: ["checkpoint"] },
  { reason: "when_invalid_exit", scopes: ["checkpoint"] },
  { reason: "open_question_store_unreadable", scopes: ["policy"] },
  { reason: "open_question_store_corrupt", scopes: ["policy"] },
  { reason: "open_question_store_rebuilt", scopes: ["checkpoint"] },
  { reason: "subject_unavailable", scopes: ["checkpoint"] },
  { reason: "open_question_store_write_failed", scopes: ["checkpoint"] },
  { reason: "declaration_evidence_unavailable", scopes: ["policy"] },
] as const;

export type CheckpointDropReason =
  (typeof CHECKPOINT_DROP_REASON_REGISTRY)[number]["reason"];

export const CHECKPOINT_DROP_REASONS = CHECKPOINT_DROP_REASON_REGISTRY.map(
  (entry) => entry.reason,
) as [CheckpointDropReason, ...CheckpointDropReason[]];

type RegistryEntry = (typeof CHECKPOINT_DROP_REASON_REGISTRY)[number];
type ReasonForScope<Scope extends "policy" | "checkpoint"> =
  RegistryEntry extends infer Entry
    ? Entry extends { reason: infer Reason; scopes: readonly Scope[] } ? Reason
    : never
    : never;

export type PolicyCheckpointDropReason = Extract<
  ReasonForScope<"policy">,
  CheckpointDropReason
>;

export type EntryCheckpointDropReason = Extract<
  ReasonForScope<"checkpoint">,
  CheckpointDropReason
>;

export const POLICY_CHECKPOINT_DROP_REASONS = CHECKPOINT_DROP_REASON_REGISTRY
  .filter((entry) => entry.scopes.some((scope) => scope === "policy"))
  .map((entry) => entry.reason) as [
    PolicyCheckpointDropReason,
    ...PolicyCheckpointDropReason[],
  ];
export const ENTRY_CHECKPOINT_DROP_REASONS = CHECKPOINT_DROP_REASON_REGISTRY
  .filter((entry) => entry.scopes.some((scope) => scope === "checkpoint"))
  .map((entry) => entry.reason) as [
    EntryCheckpointDropReason,
    ...EntryCheckpointDropReason[],
  ];

export interface PolicyCheckpointDrop {
  scope: "policy";
  checkpoint: null;
  mode: null;
  policy_commit?: string | undefined;
  reason: PolicyCheckpointDropReason;
  account: string;
}

export interface EntryCheckpointDrop {
  scope: "checkpoint";
  checkpoint: string;
  mode: CheckpointMode;
  policy_commit: string;
  reason: EntryCheckpointDropReason;
  account: string;
}

export type CheckpointDrop = PolicyCheckpointDrop | EntryCheckpointDrop;

/** Public result schemas use the same account bound as constructors. */
export const CHECKPOINT_DROP_ACCOUNT_MAX = 500;

/** Keep environment-controlled errors one-line and inside the wire bound. */
export function boundedCheckpointDropAccount(account: string): string {
  const normalized = account.replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "checkpoint enforcement failed open without further detail";
  if (normalized.length <= CHECKPOINT_DROP_ACCOUNT_MAX) return normalized;
  return normalized.slice(0, CHECKPOINT_DROP_ACCOUNT_MAX - 3) + "...";
}

/** Construct uncertainty that exists before a checkpoint entry is knowable. */
export function policyCheckpointDrop(
  reason: PolicyCheckpointDropReason,
  account: string,
  policyCommit?: string,
): PolicyCheckpointDrop {
  return {
    scope: "policy",
    checkpoint: null,
    mode: null,
    ...(policyCommit === undefined ? {} : { policy_commit: policyCommit }),
    reason,
    account: boundedCheckpointDropAccount(account),
  };
}

/** Construct uncertainty for one resolved checkpoint entry. */
export function entryCheckpointDrop(
  checkpoint: string,
  mode: CheckpointMode,
  policyCommit: string,
  reason: EntryCheckpointDropReason,
  account: string,
): EntryCheckpointDrop {
  return {
    scope: "checkpoint",
    checkpoint,
    mode,
    policy_commit: policyCommit,
    reason,
    account: boundedCheckpointDropAccount(account),
  };
}

/** Stable de-duplication for drops joined from the Proof and live inspection. */
export function uniqueCheckpointDrops(
  drops: readonly CheckpointDrop[],
): CheckpointDrop[] {
  const seen = new Set<string>();
  return drops.filter((drop) => {
    const key = JSON.stringify(drop);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The existing advisory projection remains derived from structured evidence. */
export function checkpointDropAccounts(
  drops: readonly CheckpointDrop[],
): string[] {
  return drops.map((drop) => drop.account);
}
