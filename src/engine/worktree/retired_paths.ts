/**
 * Repository-local evidence for worktree paths discern removed.
 *
 * External programs can keep a removed checkout open and later write new files
 * at its old path. Git has no registration left by then, so a bounded record in
 * the common Git directory lets status observe that reappearance and lets an
 * explicitly confirmed prune remove it. Paths discern never removed are absent
 * from the store and remain outside this deletion boundary.
 */

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

export const RETIRED_WORKTREE_PATH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const RETIRED_WORKTREE_PATH_MAX_ENTRIES = 256;
export const REAPPEARED_WORKTREE_CONTENTS_CAP = 20;
export const REAPPEARED_WORKTREE_INSPECTION_CAP = 1_000;

const RECORD_SUFFIX = ".json";
const RECORD_NAME = /^[0-9a-f]{64}\.json$/u;
const LOCK_FILE = ".lock";
const TEMP_PREFIX = ".retired-path-write-";
const TEMP_SUFFIX = ".tmp";
const RECORD_MAX_BYTES = 8_192;

interface RetiredWorktreePathRecord {
  readonly schema_version: typeof ON_DISK_FORMATS.retiredWorktreePath.version;
  readonly path: string;
  readonly removed_at: string;
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

/** Parse the small versioned record and reject foreign or malformed fields. */
function parseRecord(text: string): RetiredWorktreePathRecordRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: retired-path-record-decode-fallback
    return { status: "malformed" };
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    return { status: "malformed" };
  }
  const value = parsed as Record<string, unknown>;
  const version = inspectOnDiskJsonVersion("retiredWorktreePath", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("retiredWorktreePath", version.found),
    };
  }
  if (
    Object.keys(value).some((key) =>
      key !== "schema_version" && key !== "path" && key !== "removed_at"
    ) ||
    value.schema_version !== ON_DISK_FORMATS.retiredWorktreePath.version ||
    typeof value.path !== "string" || !isAbsolute(value.path) ||
    typeof value.removed_at !== "string" ||
    Number.isNaN(Date.parse(value.removed_at))
  ) {
    return { status: "malformed" };
  }
  return {
    status: "recorded",
    record: {
      schema_version: ON_DISK_FORMATS.retiredWorktreePath.version,
      path: value.path,
      removed_at: value.removed_at,
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
  let lock: Deno.FsFile | undefined;
  try {
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    lock = await Deno.open(join(directory, LOCK_FILE), {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    await lock.lock(true);
    return await run(directory);
  } catch {
    // discern-best-effort: retired-path-store-operation-fallback
    return undefined;
  } finally {
    lock?.close();
  }
}

/** Atomically replace one path record through a target-adjacent temp file. */
async function replaceRecord(
  directory: string,
  record: RetiredWorktreePathRecord,
): Promise<boolean> {
  const target = join(directory, await recordName(record.path));
  const existing = await inspectRetiredWorktreePathRecord(target);
  if (existing.status === "newer") return false;
  const text = `${JSON.stringify(record)}\n`;
  if (new TextEncoder().encode(text).byteLength > RECORD_MAX_BYTES) {
    throw new Error("retired worktree path record exceeds its byte limit");
  }
  await atomicReplaceText(target, text, { mode: 0o600, sync: false });
  return true;
}

/** Remove expired and excess owned records after a successful write. */
async function pruneStore(
  directory: string,
  now: number,
  ttlMs: number,
  maxEntries: number,
): Promise<void> {
  const live: Array<{
    path: string;
    removedAt: number;
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
    const read = await inspectRetiredWorktreePathRecord(path);
    if (read.status === "newer") continue;
    const record = read.status === "recorded" ? read.record : undefined;
    const removedAt = record === undefined
      ? Number.NEGATIVE_INFINITY
      : Date.parse(record.removed_at);
    if (record === undefined || now - removedAt >= ttlMs) {
      await bestEffort("retired-path-expired-record-remove", async () => {
        await Deno.remove(path);
      });
      continue;
    }
    live.push({ path, removedAt });
  }
  live.sort((left, right) =>
    right.removedAt - left.removedAt || left.path.localeCompare(right.path)
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
    );
    return true;
  });
  return saved ?? false;
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
