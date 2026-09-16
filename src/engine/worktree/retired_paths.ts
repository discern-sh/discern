/**
 * Repository-local bounded evidence the worktree lifecycle leaves behind.
 *
 * Two record families share one store directory, lock, and retention policy.
 * Path records: external programs can keep a removed checkout open and later
 * write new files at its old path. Git has no registration left by then, so a
 * bounded record in the common Git directory lets status observe that
 * reappearance and lets an explicitly confirmed prune remove it. Paths discern
 * never removed are absent from the store and remain outside this deletion
 * boundary. Branch records (under `branches/`): a landing can remove the
 * worktree and then fail only the final owned-branch deletion, which strands
 * the branch with no registration left to prove ownership. The record written
 * at that verified seam is the ownership evidence `worktree prune` consumes to
 * finish — or safely abandon — the deletion, and it is cleared once settled.
 */

import { FileLock } from "../../shared/file_lock.ts";
import { isAbsolute, join, relative, resolve } from "@std/path";
import type { Logger } from "../../lib/log.ts";
import {
  atomicReplaceText,
  isAtomicReplaceTempName,
} from "../../shared/atomic_write.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  lstatIfExists,
  readDirIfExists,
  readTextIfExists,
  statIfExists,
} from "../../shared/fs_presence.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import {
  RETIRED_WORKTREE_PATH_MAX_ENTRIES,
  RETIRED_WORKTREE_PATH_RETENTION_DAYS,
} from "../../shared/git_conventions.ts";

export const RETIRED_WORKTREE_PATH_TTL_MS =
  RETIRED_WORKTREE_PATH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export { RETIRED_WORKTREE_PATH_MAX_ENTRIES };
export const REAPPEARED_WORKTREE_CONTENTS_CAP = 20;
export const REAPPEARED_WORKTREE_INSPECTION_CAP = 1_000;

const RECORD_SUFFIX = ".json";
const RECORD_NAME = /^[0-9a-f]{64}\.json$/u;
const LOCK_FILE = ".lock";
const TEMP_PREFIX = ".retired-path-write-";
const TEMP_SUFFIX = ".tmp";
const RECORD_MAX_BYTES = 8_192;
const BRANCH_RECORD_SUBDIRECTORY = "branches";

interface RetiredWorktreePathRecord {
  readonly schema_version: typeof ON_DISK_FORMATS.retiredWorktreePath.version;
  readonly path: string;
  readonly removed_at: string;
}

/** One landed branch whose verified final ref deletion is still outstanding. */
export interface RetiredWorktreeBranchRecord {
  readonly schema_version: typeof ON_DISK_FORMATS.retiredWorktreeBranch.version;
  readonly branch: string;
  readonly expected_commit: string;
  readonly merged_into: string;
  readonly recorded_at: string;
}

export type ReappearedWorktreePathKind =
  | "directory"
  | "file"
  | "symlink"
  | "other";

/** One removed worktree path that currently exists again. */
export interface ReappearedWorktreePath {
  readonly path: string;
  readonly removed_at: string;
  readonly kind: ReappearedWorktreePathKind;
  /** Bounded, relative names found beneath a recreated directory. */
  readonly contents: readonly string[];
  readonly contents_truncated: boolean;
  readonly entries: number;
  /** Present when prune must preserve the path despite its removal record. */
  readonly cleanup_blocked_reason?: string;
}

export interface ReappearedWorktreePathCandidate
  extends ReappearedWorktreePath {
  readonly fingerprint: string;
}

/** The read-only candidate set held across prune confirmation. */
export interface ReappearedWorktreePathScan {
  readonly repoRoot: string;
  readonly removable: readonly ReappearedWorktreePathCandidate[];
  readonly kept: readonly ReappearedWorktreePath[];
}

/** The outcome of applying a confirmed reappeared-path scan. */
export interface ReappearedWorktreePathPruneResult {
  readonly removed: readonly string[];
  readonly skipped: readonly {
    fact: ReappearedWorktreePath;
    reason: string;
  }[];
  readonly failed: boolean;
}

interface PathInspection {
  readonly kind: ReappearedWorktreePathKind;
  readonly contents: readonly string[];
  readonly contents_truncated: boolean;
  readonly entries: number;
  readonly fingerprint: string;
  readonly cleanup_blocked_reason?: string;
}

interface FingerprintEntry {
  readonly path: string;
  readonly kind: ReappearedWorktreePathKind;
  readonly size: number;
  readonly modified: number | null;
  readonly target?: string;
}

type CandidateRevalidation =
  | { readonly state: "absent" }
  | { readonly state: "changed"; readonly reason: string }
  | { readonly state: "current"; readonly inspection: PathInspection };

/** Render bytes as lowercase SHA-256 hex for stable record names and snapshots. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stable.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Name one record without exposing or lengthening its absolute path. */
async function recordName(path: string): Promise<string> {
  return `${await sha256Hex(new TextEncoder().encode(path))}${RECORD_SUFFIX}`;
}

export type RetiredWorktreePathRecordRead =
  | { readonly status: "recorded"; readonly record: RetiredWorktreePathRecord }
  | { readonly status: "missing" | "malformed" }
  | { readonly status: "newer"; readonly reason: string };

/** Decode one evidence text as an unvalidated value; nothing when it is not JSON. */
function decodeEvidenceJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: retired-path-record-decode-fallback
    return undefined;
  }
}

/** Parse the small versioned record and reject foreign or malformed fields. */
function parseRecord(text: string): RetiredWorktreePathRecordRead {
  const parsed = decodeEvidenceJson(text);
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    return { status: "malformed" };
  }
  const version = inspectOnDiskJsonVersion("retiredWorktreePath", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("retiredWorktreePath", version.found),
    };
  }
  const fields = ["schema_version", "path", "removed_at"];
  if (
    Object.keys(parsed).some((key) => !fields.includes(key)) ||
    !("schema_version" in parsed) || !("path" in parsed) ||
    !("removed_at" in parsed)
  ) {
    return { status: "malformed" };
  }
  const { schema_version, path, removed_at } = parsed;
  if (
    schema_version !== ON_DISK_FORMATS.retiredWorktreePath.version ||
    typeof path !== "string" || !isAbsolute(path) ||
    typeof removed_at !== "string" ||
    Number.isNaN(Date.parse(removed_at))
  ) {
    return { status: "malformed" };
  }
  return {
    status: "recorded",
    record: {
      schema_version: ON_DISK_FORMATS.retiredWorktreePath.version,
      path,
      removed_at,
    },
  };
}

export type RetiredWorktreeBranchRecordRead =
  | {
    readonly status: "recorded";
    readonly record: RetiredWorktreeBranchRecord;
  }
  | { readonly status: "missing" | "malformed" }
  | { readonly status: "newer"; readonly reason: string };

/** Parse the small versioned branch record and reject foreign or malformed fields. */
function parseBranchRecord(text: string): RetiredWorktreeBranchRecordRead {
  const parsed = decodeEvidenceJson(text);
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    return { status: "malformed" };
  }
  const version = inspectOnDiskJsonVersion("retiredWorktreeBranch", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("retiredWorktreeBranch", version.found),
    };
  }
  const fields = [
    "schema_version",
    "branch",
    "expected_commit",
    "merged_into",
    "recorded_at",
  ];
  if (
    Object.keys(parsed).some((key) => !fields.includes(key)) ||
    !("schema_version" in parsed) || !("branch" in parsed) ||
    !("expected_commit" in parsed) || !("merged_into" in parsed) ||
    !("recorded_at" in parsed)
  ) {
    return { status: "malformed" };
  }
  const { schema_version, branch, expected_commit, merged_into, recorded_at } =
    parsed;
  if (
    schema_version !== ON_DISK_FORMATS.retiredWorktreeBranch.version ||
    typeof branch !== "string" || branch === "" ||
    typeof expected_commit !== "string" ||
    !/^[0-9a-f]{40,64}$/u.test(expected_commit) ||
    typeof merged_into !== "string" || merged_into === "" ||
    typeof recorded_at !== "string" || Number.isNaN(Date.parse(recorded_at))
  ) {
    return { status: "malformed" };
  }
  return {
    status: "recorded",
    record: {
      schema_version: ON_DISK_FORMATS.retiredWorktreeBranch.version,
      branch,
      expected_commit,
      merged_into,
      recorded_at,
    },
  };
}

/** Read one bounded record without following names outside the owned store. */
export async function inspectRetiredWorktreePathRecord(
  path: string,
): Promise<RetiredWorktreePathRecordRead> {
  const stat = await statIfExists(path);
  if (stat === undefined) return { status: "missing" };
  if (!stat.isFile || stat.size <= 0 || stat.size > RECORD_MAX_BYTES) {
    return { status: "malformed" };
  }
  const text = await readTextIfExists(path);
  return text === undefined ? { status: "missing" } : parseRecord(text);
}

/** Read one bounded branch record without following names outside the owned store. */
export async function inspectRetiredWorktreeBranchRecord(
  path: string,
): Promise<RetiredWorktreeBranchRecordRead> {
  const stat = await statIfExists(path);
  if (stat === undefined) return { status: "missing" };
  if (!stat.isFile || stat.size <= 0 || stat.size > RECORD_MAX_BYTES) {
    return { status: "malformed" };
  }
  const text = await readTextIfExists(path);
  return text === undefined ? { status: "missing" } : parseBranchRecord(text);
}

/** Resolve the repository-shared evidence directory. */
async function storeDirectory(root: string): Promise<string | undefined> {
  return await gitAdminStatePath(root, "retiredWorktreePaths");
}

/** Serialize store mutation across CLI and MCP processes. */
async function withStoreLock<T>(
  root: string,
  run: (directory: string) => Promise<T>,
): Promise<T | undefined> {
  const directory = await storeDirectory(root);
  if (directory === undefined) {
    return undefined;
  }
  let lock: FileLock | undefined;
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    lock = await FileLock.open(join(directory, LOCK_FILE), {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    await lock.acquire();
    return await run(directory);
  } catch {
    // discern-best-effort: retired-path-store-operation-fallback
    return undefined;
  } finally {
    lock?.close();
  }
}

/** Serialize, bound, and atomically place one evidence record of either family. */
async function writeEvidenceRecord(
  target: string,
  record: RetiredWorktreePathRecord | RetiredWorktreeBranchRecord,
): Promise<void> {
  const text = `${JSON.stringify(record)}\n`;
  if (new TextEncoder().encode(text).byteLength > RECORD_MAX_BYTES) {
    throw new Error("retired worktree evidence record exceeds its byte limit");
  }
  await atomicReplaceText(target, text, { mode: 0o600, sync: false });
}

/** Atomically replace one path record through a target-adjacent temp file. */
async function replaceRecord(
  directory: string,
  record: RetiredWorktreePathRecord,
): Promise<boolean> {
  const target = join(directory, await recordName(record.path));
  const existing = await inspectRetiredWorktreePathRecord(target);
  if (existing.status === "newer") return false;
  await writeEvidenceRecord(target, record);
  return true;
}

/** The retention timestamp of one live record, `"newer"` to leave the bytes
 * untouched, or `undefined` for a malformed record the sweep may remove. */
type EvidenceTimestampRead = number | "newer" | undefined;

/** Retention reader for path records, feeding the shared bounded sweep. */
async function pathRecordTimestamp(
  path: string,
): Promise<EvidenceTimestampRead> {
  const read = await inspectRetiredWorktreePathRecord(path);
  if (read.status === "newer") return "newer";
  return read.status === "recorded"
    ? Date.parse(read.record.removed_at)
    : undefined;
}

/** Retention reader for branch records, feeding the shared bounded sweep. */
async function branchRecordTimestamp(
  path: string,
): Promise<EvidenceTimestampRead> {
  const read = await inspectRetiredWorktreeBranchRecord(path);
  if (read.status === "newer") return "newer";
  return read.status === "recorded"
    ? Date.parse(read.record.recorded_at)
    : undefined;
}

/** Remove expired and excess owned records after a successful write. */
async function pruneStore(
  directory: string,
  now: number,
  ttlMs: number,
  maxEntries: number,
  timestampOf: (path: string) => Promise<EvidenceTimestampRead>,
): Promise<void> {
  const live: Array<{
    path: string;
    recordedAt: number;
  }> = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (
      entry.isFile &&
      ((entry.name.startsWith(TEMP_PREFIX) &&
        entry.name.endsWith(TEMP_SUFFIX)) ||
        isAtomicReplaceTempName(entry.name))
    ) {
      const modified = (await Deno.stat(path)).mtime?.getTime() ?? now;
      if (now - modified >= ttlMs) {
        await bestEffort("retired-path-stale-temp-remove", async () => {
          await Deno.remove(path);
        });
      }
      continue;
    }
    if (!entry.isFile || !RECORD_NAME.test(entry.name)) {
      continue;
    }
    const recordedAt = await timestampOf(path);
    if (recordedAt === "newer") continue;
    if (recordedAt === undefined || now - recordedAt >= ttlMs) {
      await bestEffort("retired-path-expired-record-remove", async () => {
        await Deno.remove(path);
      });
      continue;
    }
    live.push({ path, recordedAt });
  }
  live.sort((left, right) =>
    right.recordedAt - left.recordedAt || left.path.localeCompare(right.path)
  );
  for (const entry of live.slice(Math.max(0, maxEntries))) {
    await bestEffort("retired-path-excess-record-remove", async () => {
      await Deno.remove(entry.path);
    });
  }
}

/**
 * Record a path after discern has removed it. This is advisory evidence: a
 * store failure cannot roll the filesystem removal back, so callers receive a
 * boolean and keep the completed cleanup successful.
 */
export async function recordRetiredWorktreePath(
  root: string,
  path: string,
  opts: {
    readonly now?: number;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
  } = {},
): Promise<boolean> {
  if (!isAbsolute(path)) {
    return false;
  }
  const now = opts.now ?? SYSTEM_CLOCK.wallNow();
  const saved = await withStoreLock(root, async (directory) => {
    const replaced = await replaceRecord(directory, {
      schema_version: ON_DISK_FORMATS.retiredWorktreePath.version,
      path,
      removed_at: new Date(now).toISOString(),
    });
    if (!replaced) return false;
    await pruneStore(
      directory,
      now,
      opts.ttlMs ?? RETIRED_WORKTREE_PATH_TTL_MS,
      opts.maxEntries ?? RETIRED_WORKTREE_PATH_MAX_ENTRIES,
      pathRecordTimestamp,
    );
    return true;
  });
  return saved ?? false;
}

/** Retention and bounding knobs shared by both evidence families. */
interface EvidenceStoreBounds {
  readonly now?: number;
  readonly ttlMs?: number;
  readonly maxEntries?: number;
}

/**
 * Record a landed branch whose fully verified deletion failed at the final ref
 * update. This is advisory ownership evidence for a later `worktree prune`: a
 * store failure cannot change the deletion refusal the caller reports, so
 * callers receive a boolean and keep their own outcome.
 */
export async function recordRetiredWorktreeBranch(
  root: string,
  evidence: {
    readonly branch: string;
    readonly expectedCommit: string;
    readonly mergedInto: string;
  },
  opts: EvidenceStoreBounds = {},
): Promise<boolean> {
  if (evidence.branch === "" || evidence.mergedInto === "") {
    return false;
  }
  const now = opts.now ?? SYSTEM_CLOCK.wallNow();
  const saved = await withStoreLock(root, async (directory) => {
    const branchDirectory = join(directory, BRANCH_RECORD_SUBDIRECTORY);
    await Deno.mkdir(branchDirectory, { recursive: true, mode: 0o700 });
    const target = join(branchDirectory, await recordName(evidence.branch));
    const existing = await inspectRetiredWorktreeBranchRecord(target);
    if (existing.status === "newer") return false;
    await writeEvidenceRecord(target, {
      schema_version: ON_DISK_FORMATS.retiredWorktreeBranch.version,
      branch: evidence.branch,
      expected_commit: evidence.expectedCommit,
      merged_into: evidence.mergedInto,
      recorded_at: new Date(now).toISOString(),
    });
    await pruneStore(
      branchDirectory,
      now,
      opts.ttlMs ?? RETIRED_WORKTREE_PATH_TTL_MS,
      opts.maxEntries ?? RETIRED_WORKTREE_PATH_MAX_ENTRIES,
      branchRecordTimestamp,
    );
    return true;
  });
  return saved ?? false;
}

/** Read the live bounded branch-record population without creating or pruning state. */
export async function readRetiredWorktreeBranchRecords(
  root: string,
  opts: EvidenceStoreBounds = {},
): Promise<readonly RetiredWorktreeBranchRecord[]> {
  const directory = await storeDirectory(root);
  if (directory === undefined) {
    return [];
  }
  const branchDirectory = join(directory, BRANCH_RECORD_SUBDIRECTORY);
  const now = opts.now ?? SYSTEM_CLOCK.wallNow();
  const ttlMs = opts.ttlMs ?? RETIRED_WORKTREE_PATH_TTL_MS;
  const records: RetiredWorktreeBranchRecord[] = [];
  const entries = await readDirIfExists(branchDirectory);
  if (entries === undefined) return [];
  for (const entry of entries) {
    if (!entry.isFile || !RECORD_NAME.test(entry.name)) {
      continue;
    }
    const read = await inspectRetiredWorktreeBranchRecord(
      join(branchDirectory, entry.name),
    );
    if (
      read.status === "recorded" &&
      now - Date.parse(read.record.recorded_at) < ttlMs
    ) {
      records.push(read.record);
    }
  }
  records.sort((left, right) =>
    Date.parse(right.recorded_at) - Date.parse(left.recorded_at) ||
    left.branch.localeCompare(right.branch)
  );
  return records.slice(0, opts.maxEntries ?? RETIRED_WORKTREE_PATH_MAX_ENTRIES);
}

/**
 * Clear one branch record once its outstanding deletion is settled — deleted,
 * proven absent, or superseded by live state. Advisory like the write: a store
 * failure never changes the settled outcome, so the boolean only reports
 * whether a record was actually removed.
 */
export async function clearRetiredWorktreeBranch(
  root: string,
  branch: string,
): Promise<boolean> {
  if (branch === "") return false;
  const cleared = await withStoreLock(root, async (directory) => {
    const target = join(
      directory,
      BRANCH_RECORD_SUBDIRECTORY,
      await recordName(branch),
    );
    if ((await statIfExists(target)) === undefined) return false;
    await Deno.remove(target);
    return true;
  });
  return cleared ?? false;
}

/** Read the live bounded record population without creating or pruning state. */
export async function readRetiredWorktreePathRecords(
  root: string,
  opts: {
    readonly now?: number;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
  } = {},
): Promise<readonly RetiredWorktreePathRecord[]> {
  const directory = await storeDirectory(root);
  if (directory === undefined) {
    return [];
  }
  const now = opts.now ?? SYSTEM_CLOCK.wallNow();
  const ttlMs = opts.ttlMs ?? RETIRED_WORKTREE_PATH_TTL_MS;
  const records: RetiredWorktreePathRecord[] = [];
  const entries = await readDirIfExists(directory);
  if (entries === undefined) return [];
  for (const entry of entries) {
    if (!entry.isFile || !RECORD_NAME.test(entry.name)) {
      continue;
    }
    const read = await inspectRetiredWorktreePathRecord(
      join(directory, entry.name),
    );
    if (
      read.status === "recorded" &&
      now - Date.parse(read.record.removed_at) < ttlMs
    ) {
      records.push(read.record);
    }
  }
  records.sort((left, right) =>
    Date.parse(right.removed_at) - Date.parse(left.removed_at) ||
    left.path.localeCompare(right.path)
  );
  return records.slice(0, opts.maxEntries ?? RETIRED_WORKTREE_PATH_MAX_ENTRIES);
}

/** Canonicalize an existing path while retaining an absolute missing path. */
async function canonicalizeMaybeMissing(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return resolve(path);
  }
}

/** Current worktree registrations, used as a fail-safe exclusion. */
async function registeredPaths(root: string): Promise<Set<string> | undefined> {
  const listed = await runGit(["worktree", "list", "--porcelain"], {
    cwd: root,
  });
  if (!listed.success) {
    return undefined;
  }
  const paths = new Set<string>();
  for (const line of listed.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.add(await canonicalizeMaybeMissing(line.slice("worktree ".length)));
    }
  }
  return paths;
}

/** Classify one lstat result without following symlinks. */
function pathKind(stat: Deno.FileInfo): ReappearedWorktreePathKind {
  if (stat.isSymlink) return "symlink";
  if (stat.isDirectory) return "directory";
  if (stat.isFile) return "file";
  return "other";
}

/** Build one metadata fingerprint entry, including a symlink's own target. */
async function fingerprintEntry(
  root: string,
  path: string,
  stat: Deno.FileInfo,
): Promise<FingerprintEntry> {
  const kind = pathKind(stat);
  return {
    path: relative(root, path),
    kind,
    size: stat.size,
    modified: stat.mtime?.getTime() ?? null,
    ...(kind === "symlink" ? { target: await Deno.readLink(path) } : {}),
  };
}

/**
 * Inspect a recreated path without following symlinks. Large or unreadable
 * populations stay visible but cannot enter prune's removable set.
 */
async function inspectPath(path: string): Promise<PathInspection | undefined> {
  let rootStat: Deno.FileInfo | undefined;
  try {
    rootStat = await lstatIfExists(path);
  } catch {
    return {
      kind: "other",
      contents: [],
      contents_truncated: false,
      entries: 0,
      fingerprint: "unreadable",
      cleanup_blocked_reason: "the path could not be read",
    };
  }
  if (rootStat === undefined) return undefined;
  const kind = pathKind(rootStat);
  const fingerprints: FingerprintEntry[] = [
    await fingerprintEntry(path, path, rootStat),
  ];
  if (kind !== "directory") {
    return {
      kind,
      contents: [],
      contents_truncated: false,
      entries: 0,
      fingerprint: await sha256Hex(
        new TextEncoder().encode(JSON.stringify(fingerprints)),
      ),
    };
  }

  const queue = [path];
  const contents: string[] = [];
  let contentEntries = 0;
  let entries = 0;
  let cleanupBlockedReason: string | undefined;
  try {
    while (queue.length > 0 && cleanupBlockedReason === undefined) {
      const directory = queue.shift();
      if (directory === undefined) break;
      const children: Deno.DirEntry[] = [];
      for await (const child of Deno.readDir(directory)) {
        children.push(child);
      }
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        const childPath = join(directory, child.name);
        const childRelative = relative(path, childPath);
        const stat = await Deno.lstat(childPath);
        entries += 1;
        if (!stat.isDirectory) {
          contentEntries += 1;
          if (contents.length < REAPPEARED_WORKTREE_CONTENTS_CAP) {
            contents.push(childRelative);
          }
        }
        fingerprints.push(await fingerprintEntry(path, childPath, stat));
        if (child.name === ".git") {
          cleanupBlockedReason = "the path contains Git metadata";
          break;
        }
        if (entries > REAPPEARED_WORKTREE_INSPECTION_CAP) {
          cleanupBlockedReason =
            `the path contains more than ${REAPPEARED_WORKTREE_INSPECTION_CAP} entries`;
          break;
        }
        if (stat.isDirectory && !stat.isSymlink) {
          queue.push(childPath);
        }
      }
    }
  } catch {
    // discern-best-effort: retired-path-inspection-read-outcome
    cleanupBlockedReason = "the path contents could not be read";
  }
  return {
    kind,
    contents,
    contents_truncated: contentEntries > contents.length,
    entries,
    fingerprint: await sha256Hex(
      new TextEncoder().encode(JSON.stringify(fingerprints)),
    ),
    ...(cleanupBlockedReason === undefined
      ? {}
      : { cleanup_blocked_reason: cleanupBlockedReason }),
  };
}

/** Merge a durable removal record with the path's current filesystem facts. */
function reappearedFact(
  record: RetiredWorktreePathRecord,
  inspection: PathInspection,
): ReappearedWorktreePathCandidate {
  return {
    path: record.path,
    removed_at: record.removed_at,
    kind: inspection.kind,
    contents: inspection.contents,
    contents_truncated: inspection.contents_truncated,
    entries: inspection.entries,
    fingerprint: inspection.fingerprint,
    ...(inspection.cleanup_blocked_reason === undefined
      ? {}
      : { cleanup_blocked_reason: inspection.cleanup_blocked_reason }),
  };
}

/** Strip the apply-only fingerprint before placing a fact on public surfaces. */
function publicFact(
  candidate: ReappearedWorktreePathCandidate,
): ReappearedWorktreePath {
  const { fingerprint: _fingerprint, ...fact } = candidate;
  return fact;
}

/** Find removed paths that currently exist and are not live worktrees. */
export async function scanReappearedWorktreePaths(
  root: string,
): Promise<ReappearedWorktreePathScan> {
  const repoRoot = await canonicalizeMaybeMissing(root);
  const registered = await registeredPaths(root);
  if (registered === undefined) {
    return { repoRoot, removable: [], kept: [] };
  }
  const removable: ReappearedWorktreePathCandidate[] = [];
  const kept: ReappearedWorktreePath[] = [];
  for (const record of await readRetiredWorktreePathRecords(root)) {
    const canonical = await canonicalizeMaybeMissing(record.path);
    if (registered.has(canonical)) {
      continue;
    }
    const inspection = await inspectPath(record.path);
    if (inspection === undefined) {
      continue;
    }
    const fact = reappearedFact(record, inspection);
    if (fact.cleanup_blocked_reason === undefined) {
      removable.push(fact);
    } else {
      kept.push(publicFact(fact));
    }
  }
  removable.sort((left, right) => left.path.localeCompare(right.path));
  kept.sort((left, right) => left.path.localeCompare(right.path));
  return { repoRoot, removable, kept };
}

/** Public status projection of every currently reappeared path. */
export async function reappearedWorktreePaths(
  root: string,
): Promise<readonly ReappearedWorktreePath[]> {
  const scan = await scanReappearedWorktreePaths(root);
  return [
    ...scan.removable.map(publicFact),
    ...scan.kept,
  ].sort((left, right) => left.path.localeCompare(right.path));
}

/** Revalidate one held candidate against registration, record, and contents. */
async function revalidateCandidate(
  scan: ReappearedWorktreePathScan,
  candidate: ReappearedWorktreePathCandidate,
): Promise<CandidateRevalidation> {
  const registered = await registeredPaths(scan.repoRoot);
  if (registered === undefined) {
    return {
      state: "changed",
      reason: "worktree registrations could not be read",
    };
  }
  if (
    registered.has(await canonicalizeMaybeMissing(candidate.path))
  ) {
    return {
      state: "changed",
      reason: "the path is registered as a worktree again",
    };
  }
  const record = (await readRetiredWorktreePathRecords(scan.repoRoot)).find(
    (entry) => entry.path === candidate.path,
  );
  if (record === undefined || record.removed_at !== candidate.removed_at) {
    return {
      state: "changed",
      reason: "the removal record changed since the plan was built",
    };
  }
  const current = await inspectPath(candidate.path);
  if (current === undefined) {
    return { state: "absent" };
  }
  if (current.cleanup_blocked_reason !== undefined) {
    return {
      state: "changed",
      reason: current.cleanup_blocked_reason,
    };
  }
  return current.fingerprint === candidate.fingerprint
    ? { state: "current", inspection: current }
    : {
      state: "changed",
      reason: "the path contents changed since the plan was built",
    };
}

/** Apply a confirmed scan, revalidating each candidate immediately before removal. */
export async function pruneReappearedWorktreePaths(
  scan: ReappearedWorktreePathScan,
  log: Logger,
): Promise<ReappearedWorktreePathPruneResult> {
  const removed: string[] = [];
  const skipped: Array<{
    fact: ReappearedWorktreePath;
    reason: string;
  }> = [];
  let failed = false;
  if (scan.removable.length === 0 && scan.kept.length === 0) {
    log.line("No removed worktree paths have reappeared.");
    return { removed, skipped, failed };
  }
  for (const fact of scan.kept) {
    const reason = fact.cleanup_blocked_reason ?? "cleanup is blocked";
    log.line(`KEEP   ${fact.path} (${reason})`);
    skipped.push({ fact, reason });
  }
  for (const candidate of scan.removable) {
    const live = await revalidateCandidate(scan, candidate);
    if (live.state === "absent") {
      continue;
    }
    if (live.state === "changed") {
      log.warn(`Skipped ${candidate.path}: ${live.reason}.`);
      skipped.push({ fact: publicFact(candidate), reason: live.reason });
      continue;
    }
    log.line(`Removing files from ${candidate.path}...`);
    try {
      await Deno.remove(candidate.path, {
        recursive: live.inspection.kind === "directory",
      });
      if ((await inspectPath(candidate.path)) !== undefined) {
        failed = true;
        log.error(
          `${candidate.path} reappeared while prune was removing it. Close the ` +
            "program writing into this path, then run `discern worktree prune` again.",
        );
      } else {
        removed.push(candidate.path);
      }
    } catch (error) {
      failed = true;
      const reason = error instanceof Error ? error.message : String(error);
      log.error(`Could not remove ${candidate.path}: ${reason}`);
    }
  }
  return { removed, skipped, failed };
}
