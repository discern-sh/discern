/**
 * Bounded local recovery refs for branches removed by `worktree drop`.
 *
 * Deleting a branch also deletes its branch reflog. Before drop removes that
 * ref, discern keeps the branch tip under its registered recovery namespace. Git owns the
 * ref storage (including reftable repositories); this module never edits files
 * beneath `.git/refs`.
 */

import { FileLock } from "../../shared/file_lock.ts";
import { dirname } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import {
  DROP_RECOVERY_REF_LIMIT,
  DROP_RECOVERY_REF_PREFIX,
} from "../../shared/git_conventions.ts";

export { DROP_RECOVERY_REF_LIMIT, DROP_RECOVERY_REF_PREFIX };

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** One successfully retained branch tip. */
export interface DropRecoveryRef {
  readonly ref: string;
  readonly commit: string;
  readonly evicted: number;
}

interface ExistingRecoveryRef {
  readonly ref: string;
  readonly commit: string;
}

/** Prefer Git's diagnostic stream and retain an exit-code fallback. */
function gitReason(result: {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}): string {
  return result.stderr.trim() || result.stdout.trim() ||
    `git exited with status ${result.code}`;
}

/** A ref-safe, bounded identifier for the dropped worktree. */
function recoverySlug(id: string): string {
  const slug = id.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug === "" ? "worktree" : slug;
}

/** UTC timestamp whose lexical order is chronological. */
function recoveryTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, "");
}

/** Read the owned recovery namespace in newest-name-first order. */
async function existingRecoveryRefs(
  root: string,
): Promise<ExistingRecoveryRef[]> {
  const result = await runGit([
    "for-each-ref",
    "--sort=-refname",
    "--format=%(refname) %(objectname)",
    `${DROP_RECOVERY_REF_PREFIX}/`,
  ], { cwd: root });
  if (!result.success) {
    throw new Error(
      `Git could not list ${DROP_RECOVERY_REF_PREFIX}/: ${gitReason(result)}`,
    );
  }
  const refs: ExistingRecoveryRef[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line === "") continue;
    const separator = line.indexOf(" ");
    const ref = separator === -1 ? "" : line.slice(0, separator);
    const commit = separator === -1 ? "" : line.slice(separator + 1);
    if (
      !ref.startsWith(`${DROP_RECOVERY_REF_PREFIX}/`) ||
      !OBJECT_ID.test(commit)
    ) {
      throw new Error(
        `Git returned an invalid recovery ref record: ${JSON.stringify(line)}`,
      );
    }
    refs.push({ ref, commit });
  }
  return refs;
}

/** Run one recovery-ref mutation under the repository-shared advisory lock. */
async function withRecoveryRefLock<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  const path = await gitAdminStatePath(root, "dropRecoveryLock");
  if (path === undefined) {
    throw new Error("Git could not resolve discern's drop-recovery lock");
  }
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await FileLock.open(path, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  });
  try {
    await lock.acquire();
    return await operation();
  } finally {
    lock.close();
  }
}

/**
 * Retain one local branch tip, atomically evicting refs beyond the cap.
 *
 * The caller runs this before any destructive drop effect. A failure throws so
 * the branch and worktree remain in place. Creation and eviction share one
 * `git update-ref --stdin` transaction; a failed compare-and-swap changes none
 * of the refs.
 */
export async function preserveDropRecoveryRef(
  root: string,
  branch: string,
  worktreeId: string,
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<DropRecoveryRef> {
  const branchRef = `refs/heads/${branch}`;
  const resolved = await runGit([
    "rev-parse",
    "--verify",
    `${branchRef}^{commit}`,
  ], { cwd: root });
  const commit = resolved.stdout.trim();
  if (!resolved.success || !OBJECT_ID.test(commit)) {
    throw new Error(
      `Git could not resolve ${branchRef} before deletion: ${
        gitReason(resolved)
      }`,
    );
  }

  return await preserveResolvedDropCommit(
    root,
    commit,
    worktreeId,
    branchRef,
    clock,
    entropy,
  );
}

/** Retain an exact detached commit before its worktree is discarded. */
export async function preserveDropRecoveryCommit(
  root: string,
  commit: string,
  worktreeId: string,
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<DropRecoveryRef> {
  const resolved = await runGit([
    "rev-parse",
    "--verify",
    `${commit}^{commit}`,
  ], { cwd: root });
  if (!resolved.success || resolved.stdout.trim() !== commit) {
    throw new Error(
      `Git could not resolve detached commit ${commit}: ${gitReason(resolved)}`,
    );
  }
  return await preserveResolvedDropCommit(
    root,
    commit,
    worktreeId,
    undefined,
    clock,
    entropy,
  );
}

/** Write one bounded recovery ref, optionally verifying its source branch. */
async function preserveResolvedDropCommit(
  root: string,
  commit: string,
  worktreeId: string,
  sourceRef: string | undefined,
  clock: Clock,
  entropy: SecureEntropy,
): Promise<DropRecoveryRef> {
  return await withRecoveryRefLock(root, async () => {
    const existing = await existingRecoveryRefs(root);
    const ref = `${DROP_RECOVERY_REF_PREFIX}/${
      recoveryTimestamp(new Date(clock.wallNow()))
    }-${recoverySlug(worktreeId)}-${entropy.uuid().slice(0, 8)}`;
    const evicted = existing.slice(DROP_RECOVERY_REF_LIMIT - 1);
    const commands = [
      ...(sourceRef === undefined ? [] : [`verify ${sourceRef} ${commit}`]),
      `create ${ref} ${commit}`,
      ...evicted.map((entry) => `delete ${entry.ref} ${entry.commit}`),
    ];
    const updated = await runGit(["update-ref", "--stdin"], {
      cwd: root,
      stdin: `${commands.join("\n")}\n`,
    });
    if (!updated.success) {
      throw new Error(
        `Git could not write ${ref}: ${gitReason(updated)}`,
      );
    }
    return { ref, commit, evicted: evicted.length };
  });
}
