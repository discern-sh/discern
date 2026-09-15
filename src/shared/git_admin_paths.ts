/**
 * Leaf registry and path computation for Discern-owned Git administration state.
 *
 * This module knows the artifact names and Git queries but owns no subprocess
 * capability. Callers inject the one Git runner, which lets low-level
 * facilities such as the self-shim resolve their state without importing the
 * generic subprocess façade that consumes them.
 */

import { isAbsolute, join } from "@std/path";
import type { GitDiscoveryQuery } from "./git_discovery.ts";

export const GIT_ADMIN_STATE_NAMESPACE = "discern";

interface GitAdminStateEntry {
  readonly path: string;
  readonly scope: "common" | "worktree";
  readonly kind: "directory" | "file";
  /** Whether slow validation may write this entry after it completes. */
  readonly validation: boolean;
}

export const GIT_ADMIN_STATE = {
  completionRecords: {
    path: "discern/completion/records",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  completionArtifacts: {
    path: "discern/completion/artifacts",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  resources: {
    path: "discern/resources",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  integrationLandings: {
    path: "discern/integration-landings",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  logbook: {
    path: "discern/logbook",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  logbookArchives: {
    path: "discern/logbook-archives",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  logbookRecovery: {
    path: "discern/logbook-recovery",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  logbookLifecycleLock: {
    path: "discern/logbook-lifecycle.lock",
    scope: "common",
    kind: "file",
    validation: false,
  },
  validationHmacKey: {
    path: "discern/validation-hmac-key",
    scope: "common",
    kind: "file",
    validation: false,
  },
  crash: {
    path: "discern/crash",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  testSlots: {
    path: "discern/test-slots",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  releaseCheck: {
    path: "discern/release-check.json",
    scope: "common",
    kind: "file",
    validation: false,
  },
  deskTips: {
    path: "discern/desk/tips.json",
    scope: "common",
    kind: "file",
    validation: false,
  },
  deskPreferences: {
    path: "discern/desk/preferences.json",
    scope: "common",
    kind: "file",
    validation: false,
  },
  parkedTaskMetadata: {
    path: "discern/parked-tasks",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  taskMetadata: {
    path: "discern/task-metadata.json",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  tempArtifactSweep: {
    path: "discern/temp-artifact-sweep",
    scope: "common",
    kind: "file",
    validation: false,
  },
  continuations: {
    path: "discern/continuations",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  operations: {
    path: "discern/operations",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  retiredWorktreePaths: {
    path: "discern/retired-worktree-paths",
    scope: "common",
    kind: "directory",
    validation: false,
  },
  dropRecoveryLock: {
    path: "discern/drop-recovery.lock",
    scope: "common",
    kind: "file",
    validation: false,
  },
  gateProof: {
    path: "discern/gate-proof",
    scope: "worktree",
    kind: "file",
    validation: true,
  },
  lastGateRun: {
    path: "discern/last-gate-run",
    scope: "worktree",
    kind: "file",
    validation: true,
  },
  standardMeasurements: {
    path: "discern/standard-measurements",
    scope: "worktree",
    kind: "file",
    validation: true,
  },
  standardMeasurementEvidence: {
    path: "discern/standard-measurement-evidence.json",
    scope: "worktree",
    kind: "file",
    validation: true,
  },
  standardLimitProposals: {
    path: "discern/standard-limit-proposals.json",
    scope: "worktree",
    kind: "file",
    validation: true,
  },
  standardLimitProposalTransaction: {
    path: "discern/standard-limit-proposal-transaction.json",
    scope: "worktree",
    kind: "file",
    validation: true,
  },
  ignoredBaseline: {
    path: "discern/ignored-baseline",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  checkpointOpenQuestions: {
    path: "discern/checkpoint-open-questions",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  effortGrant: {
    path: "discern/effort-grant",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  effortGrantClaims: {
    path: "discern/effort-grant-claims",
    scope: "worktree",
    kind: "directory",
    validation: false,
  },
  submission: {
    path: "discern/submission",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  acceptanceTransaction: {
    path: "discern/acceptance-transaction.json",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  setupMachineryCommitEvidence: {
    path: "discern/setup-machinery-commit-evidence.json",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  worktreeSetupSteps: {
    path: "discern/worktree-setup-steps.json",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  worktreeReady: {
    path: "discern/worktree-ready",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  selfShim: {
    path: "discern/shim",
    scope: "worktree",
    kind: "directory",
    validation: false,
  },
} as const satisfies Record<string, GitAdminStateEntry>;

export type GitAdminStateKey = keyof typeof GIT_ADMIN_STATE;
export type WorktreeAdminStateKey = {
  [Key in GitAdminStateKey]: typeof GIT_ADMIN_STATE[Key]["scope"] extends
    "worktree" ? Key : never;
}[GitAdminStateKey];
export type ValidationAdminStateKey = {
  [Key in GitAdminStateKey]: typeof GIT_ADMIN_STATE[Key]["validation"] extends
    true ? Key : never;
}[GitAdminStateKey];

export const GIT_ADMIN_STATE_KEYS = Object.keys(
  GIT_ADMIN_STATE,
) as GitAdminStateKey[];
export const WORKTREE_ADMIN_STATE_KEYS = GIT_ADMIN_STATE_KEYS.filter(
  (key) => GIT_ADMIN_STATE[key].scope === "worktree",
) as WorktreeAdminStateKey[];
export const VALIDATION_ADMIN_STATE_KEYS = GIT_ADMIN_STATE_KEYS.filter(
  (key) => GIT_ADMIN_STATE[key].validation,
) as ValidationAdminStateKey[];

/** The narrow Git result projection required by administrative path queries. */
export interface GitAdminPathResult {
  readonly success: boolean;
  readonly stdout: string;
}

/** Injectable Git boundary for callers that already own subprocess authority.
 * The declared query names the fact behind the argv, so a runner inside an
 * operation may answer it from retained discovery. */
export type GitAdminPathRunner = (
  cwd: string,
  args: string[],
  query: GitDiscoveryQuery,
) => Promise<GitAdminPathResult>;

/** Resolve a Git-reported administrative path to an absolute filesystem path. */
export async function gitReportedAdminPath(
  cwd: string,
  args: string[],
  runner: GitAdminPathRunner,
  query: GitDiscoveryQuery,
): Promise<string | undefined> {
  const result = await runner(cwd, args, query);
  if (!result.success) return undefined;
  const raw = result.stdout.trim();
  if (raw === "") return undefined;
  return isAbsolute(raw) ? raw : join(cwd, raw);
}

/** Resolve one Git-owned operation marker. These sequencer files are not
 * discern records, but their paths still pass through the sole administrative
 * path query boundary. */
export async function gitOperationMarkerPath(
  cwd: string,
  marker: string,
  runner: GitAdminPathRunner,
): Promise<string | undefined> {
  const args = ["rev-parse", "--git-path", marker];
  return await gitReportedAdminPath(cwd, args, runner, {
    kind: "admin-path",
    path: marker,
    args,
  });
}

/** Resolve one registry entry through an explicitly supplied Git boundary. */
export async function resolveGitAdminStatePath(
  cwd: string,
  key: GitAdminStateKey,
  runner: GitAdminPathRunner,
): Promise<string | undefined> {
  const entry = GIT_ADMIN_STATE[key];
  if (entry.scope === "worktree") {
    const args = ["rev-parse", "--git-path", entry.path];
    return await gitReportedAdminPath(cwd, args, runner, {
      kind: "admin-path",
      path: entry.path,
      args,
    });
  }
  const commonDir = await gitReportedAdminPath(
    cwd,
    ["rev-parse", "--git-common-dir"],
    runner,
    { kind: "common-dir" },
  );
  return commonDir === undefined ? undefined : join(commonDir, entry.path);
}
