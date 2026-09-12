/**
 * The one registry of versioned formats discern persists in Git administration
 * state or a Git note. A format's version belongs here; writers and readers
 * import it instead of declaring local numeric schema constants.
 *
 * `refuse` formats carry authority or effect-replay evidence, so forward skew
 * stops the consuming operation. `observe` formats are advisory caches or
 * histories: an older reader may continue without their contents, but it must
 * surface the skew and must never replace the newer bytes.
 */

import type { GitAdminStateKey } from "./git_admin_paths.ts";
import { PROOF_NOTES_REF } from "./git_conventions.ts";

export type OnDiskNewerVersionPolicy = "refuse" | "observe";
export type OnDiskVersionField =
  | "schema"
  | "schema_version"
  | "version"
  | "payloadType"
  | "header";

export type OnDiskFormatLocation =
  | {
    readonly kind: "git-admin";
    readonly keys: readonly GitAdminStateKey[];
  }
  | { readonly kind: "git-note"; readonly ref: string };

export interface OnDiskFormatDefinition {
  readonly id: string;
  readonly location: OnDiskFormatLocation;
  readonly version: number;
  readonly versionField: OnDiskVersionField;
  readonly schemaContract?: {
    readonly module: string;
    readonly export: string;
    readonly sha256: string;
  };
  readonly reader: string;
  readonly writers: readonly string[];
  readonly newerVersionPolicy: OnDiskNewerVersionPolicy;
}

/** Every versioned record discern persists locally. */
export const ON_DISK_FORMATS = {
  completionRecord: {
    id: "completion-record",
    location: { kind: "git-admin", keys: ["completionRecords"] },
    version: 1,
    // Reviewed 2026-09-12: the candidate gained its composition-input list
    // (`sources` plus the optional `integration` procedure) and dropped the
    // singular `source`. The store's reader migrates a stored singular-source
    // candidate to the list shape in memory, so version 1 stands and no other
    // family changed shape.
    schemaContract: {
      module: "src/engine/completion/records.ts",
      export: "CompletionRecordSchema",
      sha256:
        "d9ffaed759ba5ae3adba855d9d099ad9af6466f19ac845970cecfe506ae44111",
    },
    versionField: "version",
    reader: "src/engine/completion/store.ts#readCompletionRecord",
    writers: ["src/engine/completion/store.ts"],
    newerVersionPolicy: "refuse",
  },
  candidateReview: {
    id: "candidate-review",
    location: { kind: "git-admin", keys: ["completionArtifacts"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/candidate_review.ts#readCandidateReview",
    writers: [
      "src/engine/completion/documents.ts",
      "src/engine/gate/candidate_review.ts",
    ],
    newerVersionPolicy: "refuse",
  },
  emergencyResolution: {
    id: "emergency-resolution",
    location: { kind: "git-admin", keys: ["completionArtifacts"] },
    version: 1,
    versionField: "version",
    schemaContract: {
      module: "src/engine/completion/documents.ts",
      export: "EmergencyResolutionSchema",
      sha256:
        "b670b8285f27489eed6e801314bc90b7c2ebed8a6b73d8984b0f81f8013fec39",
    },
    reader: "src/engine/emergency/obligations.ts#resolution",
    writers: [
      "src/engine/completion/documents.ts",
      "src/engine/emergency/obligations.ts",
    ],
    newerVersionPolicy: "refuse",
  },
  acceptanceTransaction: {
    id: "acceptance-transaction",
    location: { kind: "git-admin", keys: ["acceptanceTransaction"] },
    version: 1,
    versionField: "version",
    reader:
      "src/engine/worktree/acceptance_transaction.ts#readAcceptanceTransaction",
    writers: ["src/engine/worktree/acceptance_transaction.ts"],
    newerVersionPolicy: "refuse",
  },
  awaitContinuation: {
    id: "await-continuation",
    location: { kind: "git-admin", keys: ["continuations"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/await/await.ts#parseContinuation",
    writers: ["src/engine/await/await.ts"],
    newerVersionPolicy: "refuse",
  },
  checkpointOpenQuestions: {
    id: "checkpoint-open-questions",
    location: { kind: "git-admin", keys: ["checkpointOpenQuestions"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/checkpoints/open_questions.ts#readOpenQuestions",
    writers: ["src/engine/checkpoints/open_questions.ts"],
    newerVersionPolicy: "refuse",
  },
  continuationRecord: {
    id: "continuation-record",
    location: { kind: "git-admin", keys: ["continuations"] },
    version: 1,
    versionField: "schema_version",
    reader: "src/engine/continuations/store.ts#readContinuation",
    writers: ["src/engine/continuations/store.ts"],
    newerVersionPolicy: "refuse",
  },
  operationJournal: {
    id: "operation-journal",
    location: { kind: "git-admin", keys: ["operations"] },
    version: 1,
    versionField: "schema_version",
    reader: "src/engine/completion/operation_journal.ts#readOperationJournal",
    writers: ["src/engine/completion/operation_journal.ts"],
    newerVersionPolicy: "refuse",
  },
  crashReport: {
    id: "crash-report",
    location: { kind: "git-admin", keys: ["crash"] },
    version: 1,
    versionField: "header",
    reader: "person attaching the report to an issue",
    writers: ["src/engine/crash.ts"],
    newerVersionPolicy: "observe",
  },
  deskPreferences: {
    id: "desk-preferences",
    location: { kind: "git-admin", keys: ["deskPreferences"] },
    version: 1,
    versionField: "schema_version",
    reader: "src/engine/desk/preferences.ts#inspectDeskPreferences",
    writers: ["src/engine/desk/preferences.ts"],
    newerVersionPolicy: "observe",
  },
  deskTipState: {
    id: "desk-tip-state",
    location: { kind: "git-admin", keys: ["deskTips"] },
    version: 1,
    versionField: "schema_version",
    reader: "src/engine/desk/tip_state.ts#inspectTipSeenState",
    writers: ["src/engine/desk/tip_state.ts", "src/engine/desk/tips.ts"],
    newerVersionPolicy: "observe",
  },
  effortGrant: {
    id: "effort-grant",
    location: {
      kind: "git-admin",
      keys: ["effortGrant", "effortGrantClaims"],
    },
    version: 1,
    versionField: "version",
    reader: "src/engine/worktree/effort_grant.ts#readEffortGrant",
    writers: ["src/engine/worktree/effort_grant_writer.ts"],
    newerVersionPolicy: "refuse",
  },
  submission: {
    id: "submission",
    location: { kind: "git-admin", keys: ["submission"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/worktree/submission.ts#readSubmission",
    writers: ["src/engine/worktree/submission_writer.ts"],
    newerVersionPolicy: "refuse",
  },
  freshStandardMeasurementEvidence: {
    id: "fresh-standard-measurement-evidence",
    location: {
      kind: "git-admin",
      keys: ["standardMeasurementEvidence"],
    },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/proof.ts#inspectFreshStandardMeasurementEvidence",
    writers: ["src/engine/gate/proof.ts"],
    newerVersionPolicy: "observe",
  },
  gateProof: {
    id: "gate-proof",
    location: { kind: "git-admin", keys: ["gateProof"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/proof.ts#inspectGateProof",
    writers: ["src/engine/gate/proof.ts"],
    newerVersionPolicy: "refuse",
  },
  ignoredBaseline: {
    id: "ignored-baseline",
    location: { kind: "git-admin", keys: ["ignoredBaseline"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/worktree/ignored.ts#inspectIgnoredFileChanges",
    writers: ["src/engine/worktree/ignored.ts"],
    newerVersionPolicy: "observe",
  },
  lastGateRun: {
    id: "last-gate-run",
    location: { kind: "git-admin", keys: ["lastGateRun"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/proof.ts#inspectLastGateRunRecord",
    writers: ["src/engine/gate/proof.ts"],
    newerVersionPolicy: "observe",
  },
  logbookEpoch: {
    id: "logbook-epoch",
    location: {
      kind: "git-admin",
      keys: ["logbook", "logbookRecovery"],
    },
    version: 1,
    versionField: "schema",
    reader: "src/engine/logbook/store.ts#inspectEpochState",
    writers: ["src/engine/logbook/store.ts", "src/engine/logbook/record.ts"],
    newerVersionPolicy: "observe",
  },
  logbookEvent: {
    id: "logbook-event",
    location: {
      kind: "git-admin",
      keys: ["logbook", "logbookArchives", "logbookRecovery"],
    },
    version: 1,
    versionField: "schema",
    reader: "src/engine/logbook/schema.ts#parseEventLine",
    writers: ["src/engine/logbook/store.ts", "src/engine/logbook/record.ts"],
    newerVersionPolicy: "observe",
  },
  logbookValidationEvidence: {
    id: "logbook-validation-evidence",
    location: {
      kind: "git-admin",
      keys: ["logbook", "logbookArchives", "logbookRecovery"],
    },
    version: 1,
    versionField: "version",
    reader: "src/engine/logbook/schema.ts#parseLogbookLine",
    writers: [
      "src/engine/logbook/validation.ts",
      "src/engine/logbook/validation_state.ts",
    ],
    newerVersionPolicy: "observe",
  },
  proofNote: {
    id: "proof-note",
    location: { kind: "git-note", ref: PROOF_NOTES_REF },
    version: 1,
    versionField: "payloadType",
    reader: "src/engine/gate/proof_notes.ts#parseProofNote",
    writers: [
      "src/shared/public_schemas.ts",
      "src/engine/gate/proof_notes.ts",
      "src/engine/emergency/note.ts",
    ],
    newerVersionPolicy: "refuse",
  },
  resourceLedger: {
    id: "resource-ledger",
    location: { kind: "git-admin", keys: ["resources"] },
    version: 1,
    versionField: "schema",
    reader: "src/engine/worktree/resources.ts#inspectResourceEntry",
    writers: ["src/engine/worktree/resources.ts"],
    newerVersionPolicy: "refuse",
  },
  retiredWorktreeBranch: {
    id: "retired-worktree-branch",
    location: { kind: "git-admin", keys: ["retiredWorktreePaths"] },
    version: 1,
    versionField: "schema_version",
    reader:
      "src/engine/worktree/retired_paths.ts#inspectRetiredWorktreeBranchRecord",
    writers: ["src/engine/worktree/retired_paths.ts"],
    newerVersionPolicy: "observe",
  },
  retiredWorktreePath: {
    id: "retired-worktree-path",
    location: { kind: "git-admin", keys: ["retiredWorktreePaths"] },
    version: 1,
    versionField: "schema_version",
    reader:
      "src/engine/worktree/retired_paths.ts#inspectRetiredWorktreePathRecord",
    writers: ["src/engine/worktree/retired_paths.ts"],
    newerVersionPolicy: "observe",
  },
  setupMachineryCommitEvidence: {
    id: "setup-machinery-commit-evidence",
    location: {
      kind: "git-admin",
      keys: ["setupMachineryCommitEvidence"],
    },
    version: 1,
    versionField: "version",
    reader:
      "src/shared/setup_machinery_evidence.ts#readSetupMachineryCommitEvidence",
    writers: ["src/shared/setup_machinery_evidence.ts"],
    newerVersionPolicy: "refuse",
  },
  setupStepJournal: {
    id: "setup-step-journal",
    location: { kind: "git-admin", keys: ["worktreeSetupSteps"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/worktree/setup_step_journal.ts#readJournal",
    writers: ["src/engine/worktree/setup_step_journal.ts"],
    newerVersionPolicy: "refuse",
  },
  standardLimitProposalStore: {
    id: "standard-limit-proposal-store",
    location: { kind: "git-admin", keys: ["standardLimitProposals"] },
    version: 2,
    versionField: "version",
    reader: "src/engine/gate/standard_proposal_state.ts#readProposalStore",
    writers: [
      "src/engine/gate/standard_proposal_state.ts",
      "src/engine/gate/standard_proposals.ts",
    ],
    newerVersionPolicy: "refuse",
  },
  standardLimitProposalTransaction: {
    id: "standard-limit-proposal-transaction",
    location: {
      kind: "git-admin",
      keys: ["standardLimitProposalTransaction"],
    },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/standard_proposals.ts#recoverProposalTransaction",
    writers: ["src/engine/gate/standard_proposals.ts"],
    newerVersionPolicy: "refuse",
  },
  standardMeasurements: {
    id: "standard-measurements",
    location: { kind: "git-admin", keys: ["standardMeasurements"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/proof.ts#inspectStandardMeasurements",
    writers: ["src/engine/gate/proof.ts"],
    newerVersionPolicy: "observe",
  },
  taskMetadata: {
    id: "task-metadata",
    location: { kind: "git-admin", keys: ["taskMetadata"] },
    version: 1,
    versionField: "schema_version",
    reader: "src/engine/worktree/task_metadata.ts#inspectTaskMetadata",
    writers: [
      "src/shared/task_metadata.ts",
      "src/engine/worktree/task_metadata.ts",
      "src/engine/worktree/lifecycle.ts",
    ],
    newerVersionPolicy: "observe",
  },
  parkedTaskMetadata: {
    id: "parked-task-metadata",
    location: { kind: "git-admin", keys: ["parkedTaskMetadata"] },
    version: 1,
    versionField: "schema_version",
    reader:
      "src/engine/worktree/parked_task_metadata.ts#readParkedTaskMetadata",
    writers: [
      "src/shared/task_metadata.ts",
      "src/engine/worktree/parked_task_metadata.ts",
      "src/engine/worktree/park.ts",
    ],
    newerVersionPolicy: "observe",
  },
  tempArtifactSweep: {
    id: "temp-artifact-sweep",
    location: { kind: "git-admin", keys: ["tempArtifactSweep"] },
    version: 1,
    versionField: "version",
    reader: "src/engine/gate/temp_artifact_sweep.ts#readState",
    writers: ["src/engine/gate/temp_artifact_sweep.ts"],
    newerVersionPolicy: "observe",
  },
} as const satisfies Record<string, OnDiskFormatDefinition>;

export type OnDiskFormatKey = keyof typeof ON_DISK_FORMATS;

/** Git-admin coordinates that hold capabilities or presence sentinels rather
 * than a versioned document. The coverage guard requires every location not
 * claimed by a format to carry one precise reason here. */
export const UNVERSIONED_GIT_ADMIN_STATE = {
  logbookLifecycleLock: "an operating-system lock with no persisted payload",
  validationHmacKey: "an opaque fixed-length secret key",
  testSlots: "short-lived locked lease files owned by live processes",
  dropRecoveryLock: "an operating-system lock with no persisted payload",
  worktreeReady: "a presence-only setup sentinel",
  selfShim: "a directory of generated executables rather than a record",
} as const satisfies Partial<Record<GitAdminStateKey, string>>;

export type OnDiskVersionInspection =
  | { readonly status: "current" }
  | { readonly status: "older"; readonly found: number }
  | { readonly status: "newer"; readonly found: number }
  | { readonly status: "missing" | "invalid" };

/** Classify a numeric in-band version without accepting absence as version 1. */
export function inspectOnDiskVersion(
  format: OnDiskFormatKey,
  value: unknown,
): OnDiskVersionInspection {
  if (value === undefined) return { status: "missing" };
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { status: "invalid" };
  }
  const current = ON_DISK_FORMATS[format].version;
  if (value === current) return { status: "current" };
  return value > current
    ? { status: "newer", found: value }
    : { status: "older", found: value };
}

/** Read a registered in-band version from a decoded record. Text protocols
 * expose their version through the same helper so policy tests do not invent a
 * second interpretation of their headers. */
export function inspectOnDiskRecordVersion(
  format: OnDiskFormatKey,
  value: unknown,
): OnDiskVersionInspection {
  const definition = ON_DISK_FORMATS[format];
  if (definition.versionField === "header") {
    if (typeof value !== "string") return { status: "invalid" };
    const match = /^discern crash report format ([0-9]+)$/u.exec(
      value.split("\n", 1)[0] ?? "",
    );
    return inspectOnDiskVersion(
      format,
      match === null ? undefined : Number(match[1]),
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { status: "invalid" };
  }
  const field = definition.versionField;
  const raw = (value as Record<string, unknown>)[field];
  if (field === "payloadType") {
    if (typeof raw !== "string") return { status: "missing" };
    const match = /\/schema\/v([0-9]+)\/discern-proof-note\.schema\.json#/u
      .exec(raw);
    return inspectOnDiskVersion(
      format,
      match === null ? undefined : Number(match[1]),
    );
  }
  return inspectOnDiskVersion(format, raw);
}

/** Classify the registered version in a JSON record without trusting its
 * remaining shape. */
export function inspectOnDiskJsonVersion(
  format: OnDiskFormatKey,
  raw: string,
): OnDiskVersionInspection {
  try {
    return inspectOnDiskRecordVersion(format, JSON.parse(raw));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { status: "invalid" };
  }
}

/** Stable recovery text shared by every forward-skew reader. */
export function newerOnDiskFormatMessage(
  format: OnDiskFormatKey,
  found: number,
): string {
  const definition = ON_DISK_FORMATS[format];
  return `${definition.id} was written by a newer discern (version ${found}; ` +
    `this binary reads version ${definition.version}). Update discern before ` +
    "using or replacing this record.";
}
