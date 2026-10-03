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

/**
 * How the fleet change probe sees an entry between status surveys:
 *
 * - `contents`: every file and directory under it, by modification time and
 *   size, for state written in place.
 * - `entries`: the entry and its immediate subdirectories, for record stores
 *   written only by creating, renaming over, or removing a file, each of
 *   which moves its directory's modification time.
 * - `addressed`: immutable documents status reads only through a digest that
 *   a watched record carries.
 * - `unread`: status never reads it, so no change to it changes a survey.
 */
export type GitAdminChangeProbe =
  | "contents"
  | "entries"
  | "addressed"
  | "unread";

interface GitAdminStateEntry {
  readonly path: string;
  readonly scope: "common" | "worktree";
  readonly kind: "directory" | "file";
  /** Whether slow validation may write this entry after it completes. */
  readonly validation: boolean;
  /** How the fleet change probe sees it ({@link GitAdminChangeProbe}). */
  readonly changeProbe: GitAdminChangeProbe;
}

export const GIT_ADMIN_STATE = {
  completionRecords: {
    path: "discern/completion/records",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "entries",
  },
  completionArtifacts: {
    path: "discern/completion/artifacts",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "addressed",
  },
  resources: {
    path: "discern/resources",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  integrationLandings: {
    path: "discern/integration-landings",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  logbook: {
    path: "discern/logbook",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  logbookArchives: {
    path: "discern/logbook-archives",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "unread",
  },
  logbookRecovery: {
    path: "discern/logbook-recovery",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "unread",
  },
  logbookLifecycleLock: {
    path: "discern/logbook-lifecycle.lock",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  validationHmacKey: {
    path: "discern/validation-hmac-key",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  crash: {
    path: "discern/crash",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "unread",
  },
  testSlots: {
    path: "discern/test-slots",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "unread",
  },
  releaseCheck: {
    path: "discern/release-check.json",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  deskTips: {
    path: "discern/desk/tips.json",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  deskPreferences: {
    path: "discern/desk/preferences.json",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  parkedTaskMetadata: {
    path: "discern/parked-tasks",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  taskMetadata: {
    path: "discern/task-metadata.json",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  tempArtifactSweep: {
    path: "discern/temp-artifact-sweep",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  continuations: {
    path: "discern/continuations",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  operations: {
    path: "discern/operations",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  retiredWorktreePaths: {
    path: "discern/retired-worktree-paths",
    scope: "common",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  dropRecoveryLock: {
    path: "discern/drop-recovery.lock",
    scope: "common",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  gateProof: {
    path: "discern/gate-proof",
    scope: "worktree",
    kind: "file",
    validation: true,
    changeProbe: "contents",
  },
  lastGateRun: {
    path: "discern/last-gate-run",
    scope: "worktree",
    kind: "file",
    validation: true,
    changeProbe: "contents",
  },
  standardMeasurements: {
    path: "discern/standard-measurements",
    scope: "worktree",
    kind: "file",
    validation: true,
    changeProbe: "contents",
  },
  standardMeasurementEvidence: {
    path: "discern/standard-measurement-evidence.json",
    scope: "worktree",
    kind: "file",
    validation: true,
    changeProbe: "contents",
  },
  standardLimitProposals: {
    path: "discern/standard-limit-proposals.json",
    scope: "worktree",
    kind: "file",
    validation: true,
    changeProbe: "contents",
  },
  standardLimitProposalTransaction: {
    path: "discern/standard-limit-proposal-transaction.json",
    scope: "worktree",
    kind: "file",
    validation: true,
    changeProbe: "contents",
  },
  ignoredBaseline: {
    path: "discern/ignored-baseline",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "unread",
  },
  checkpointOpenQuestions: {
    path: "discern/checkpoint-open-questions",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  effortGrant: {
    path: "discern/effort-grant",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  effortGrantClaims: {
    path: "discern/effort-grant-claims",
    scope: "worktree",
    kind: "directory",
    validation: false,
    changeProbe: "contents",
  },
  submission: {
    path: "discern/submission",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  acceptanceTransaction: {
    path: "discern/acceptance-transaction.json",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  setupMachineryCommitEvidence: {
    path: "discern/setup-machinery-commit-evidence.json",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  worktreeSetupSteps: {
    path: "discern/worktree-setup-steps.json",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  worktreeReady: {
    path: "discern/worktree-ready",
    scope: "worktree",
    kind: "file",
    validation: false,
    changeProbe: "contents",
  },
  selfShim: {
    path: "discern/shim",
    scope: "worktree",
    kind: "directory",
    validation: false,
    changeProbe: "unread",
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
