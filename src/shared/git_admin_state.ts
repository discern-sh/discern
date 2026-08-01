/**
 * Discern-owned state inside Git's administrative directories.
 *
 * The registry is the single source of truth for each artifact's path and
 * lifetime. Worktree-scoped entries resolve through `git rev-parse --git-path`
 * so linked-worktree state follows Git's own lifecycle. Common entries resolve
 * beneath `git rev-parse --git-common-dir` so every worktree shares them.
 */

import { isAbsolute, join } from "@std/path";
import { runGit } from "./subprocess.ts";

export const GIT_ADMIN_STATE_NAMESPACE = "discern";

interface GitAdminStateEntry {
  readonly path: string;
  readonly scope: "common" | "worktree";
  readonly kind: "directory" | "file";
  /** Whether slow validation may write this entry after it completes. */
  readonly validation: boolean;
}

export const GIT_ADMIN_STATE = {
  resources: {
    path: "discern/resources",
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
  deskTips: {
    path: "discern/desk/tips.json",
    scope: "common",
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
  gateReceipt: {
    path: "discern/gate-receipt",
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
  ignoredBaseline: {
    path: "discern/ignored-baseline",
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
  acceptanceTransaction: {
    path: "discern/acceptance-transaction.json",
    scope: "worktree",
    kind: "file",
    validation: false,
  },
  acceptanceTransactionLock: {
    path: "discern/acceptance-transaction.lock",
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
  worktreeReady: {
    path: "discern/worktree-ready",
    scope: "worktree",
    kind: "file",
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

async function gitPath(
  cwd: string,
  args: string[],
): Promise<string | undefined> {
  const result = await runGit(args, { cwd });
  if (!result.success) {
    return undefined;
  }
  const raw = result.stdout.trim();
  if (raw === "") {
    return undefined;
  }
  return isAbsolute(raw) ? raw : join(cwd, raw);
}

/** Resolve one registered admin-state entry for the repository at `cwd`. */
export async function gitAdminStatePath(
  cwd: string,
  key: GitAdminStateKey,
): Promise<string | undefined> {
  const entry = GIT_ADMIN_STATE[key];
  if (entry.scope === "worktree") {
    return await gitPath(cwd, ["rev-parse", "--git-path", entry.path]);
  }
  const commonDir = await gitPath(cwd, ["rev-parse", "--git-common-dir"]);
  return commonDir === undefined ? undefined : join(commonDir, entry.path);
}
