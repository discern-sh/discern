/**
 * The logbook **store** — where the events live on disk and the only module in
 * the logbook subsystem that writes the filesystem (it is a sanctioned
 * write-site in `tests/paths_write_surface_test.ts`: everything here lands
 * inside `.git`, outside the project tree).
 *
 * Layout, beside the resource ledger the worktree lifecycle already keeps:
 *
 *     <git-common-dir>/discern/logbook/
 *       2026-07.jsonl   — one month of events, one JSON line each
 *       2026-06.jsonl
 *       epoch.json      — per-branch config-epoch state (see `epoch.ts`)
 *
 * The common dir is shared by every linked worktree, so all fleet activity
 * converges into one logbook with zero unification logic, and nothing under the
 * git admin area ever lands in a commit or needs a gitignore entry. Events
 * attribute by branch name, so history survives a worktree's removal.
 *
 * The append bet (see the substrate decision record): one `write()` of one
 * whole line to an `O_APPEND` handle — atomic in practice on local filesystems
 * for lines this small, across concurrent worktrees. The backstop is the
 * torn-line-tolerant reader (`schema.ts`); a hard crash between verb completion
 * and the append loses that run's single event, accepted for v1.
 *
 * Rotation is by age: month-stamped files, the newest {@link MAX_MONTH_FILES}
 * kept. The prune pass runs only when a new month file is first created (the
 * one moment the file count can grow), removes oldest-first, and is LOUD — the
 * removals are themselves recorded as a `prune` event that carries a compact
 * digest of each removed month (event totals by outcome and verb), so coarse
 * long-horizon trends outlive the raw lines they came from.
 */

import { dirname, join } from "@std/path";
import { bestEffort } from "../../shared/best_effort.ts";
import { ensureDir } from "@std/fs";
import { z } from "@zod/zod";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { GIT_ADMIN_STATE } from "../../shared/git_admin_state.ts";
import {
  pathExists,
  readDirIfExists,
  readTextIfExists,
} from "../../shared/fs_presence.ts";
import {
  type LogbookEvent,
  parseLogbookLine,
  type PruneDigest,
  type PruneEvent,
} from "./schema.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

/** The logbook directory for a repo: `<common-git-dir>/discern/logbook/`. */
export function logbookDir(commonGitDir: string): string {
  return join(commonGitDir, GIT_ADMIN_STATE.logbook.path);
}

/** The common directory holding sealed, read-only Logbook archives. */
export function logbookArchiveDir(commonGitDir: string): string {
  return join(commonGitDir, GIT_ADMIN_STATE.logbookArchives.path);
}

/** The common directory holding recoverable detached lifecycle snapshots. */
export function logbookRecoveryDir(commonGitDir: string): string {
  return join(commonGitDir, GIT_ADMIN_STATE.logbookRecovery.path);
}

/** The common advisory-lock path serializing Logbook lifecycle actions. */
export function logbookLifecycleLockPath(commonGitDir: string): string {
  return join(commonGitDir, GIT_ADMIN_STATE.logbookLifecycleLock.path);
}

/** The month files kept after rotation (about two years of history — a month
 * of heavy use is a few hundred kilobytes, so retention is bounded by
 * usefulness, not disk; the prune digest preserves coarser trends beyond it). */
export const MAX_MONTH_FILES = 24;

/** A month-stamped event file name (`2026-07.jsonl`) from an ISO timestamp. */
export function monthFileName(atIso: string): string {
  return `${atIso.slice(0, 7)}.jsonl`;
}

/** The shape of a month-file name — what rotation may count and remove, and
 * what the stream reader (`read.ts`) recognizes as event storage. */
export const MONTH_FILE_RE = /^\d{4}-\d{2}\.jsonl$/;

/** A sealed archive basename; selectors accept exactly this portable shape. */
export const LOGBOOK_ARCHIVE_FILE_RE = /^logbook-\d{8}T\d{6}Z(?:-\d+)?\.jsonl$/;

/** Whether `name` has the canonical sealed-archive basename shape. */
export function isLogbookArchiveFileName(name: string): boolean {
  return LOGBOOK_ARCHIVE_FILE_RE.test(name);
}

/** Format one collision ordinal into a portable UTC archive basename. */
export function logbookArchiveFileName(
  now: Date,
  ordinal = 1,
): string {
  const timestamp = now.toISOString().replaceAll(/[-:]/g, "").slice(0, 15) +
    "Z";
  return `logbook-${timestamp}${ordinal === 1 ? "" : `-${ordinal}`}.jsonl`;
}

/** Choose the first unused archive basename for one UTC second. */
export async function nextLogbookArchiveFileName(
  commonGitDir: string,
  now: Date,
): Promise<string> {
  const dir = logbookArchiveDir(commonGitDir);
  for (let ordinal = 1; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const name = logbookArchiveFileName(now, ordinal);
    try {
      await Deno.lstat(join(dir, name));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return name;
      }
      throw error;
    }
  }
  throw new Error("could not allocate a collision-safe logbook archive name");
}

/** Set once this process intentionally removed the store (uninstall taking
 * the whole Git-admin namespace with it): the removing verb's own trailing
 * completion event must not resurrect what it just removed. */
let storeRemovedByThisProcess = false;

/** Mark the store as removed by this process; every later write in this
 * process becomes a silent no-op. */
export function suppressLogbookWrites(): void {
  storeRemovedByThisProcess = true;
}

/**
 * Stop advisory recording for the remainder of this process after a real write
 * probe was denied. A CLI invocation is one process, so this prevents its
 * trailing completion append from repeating a provider refusal while leaving
 * every later invocation free to prove authority again.
 */
export function disableLogbookWritesForSession(): void {
  storeRemovedByThisProcess = true;
}

/** Serialize one event as its single logbook line (trailing newline included). */
function eventLine(event: LogbookEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Append one line in a single `O_APPEND` write — the atomicity bet. */
async function appendLine(path: string, line: string): Promise<void> {
  await Deno.writeTextFile(path, line, { append: true });
}

/**
 * Append one event to the logbook under `commonGitDir`, creating the directory
 * and month file as needed. When the append CREATES a new month file, the
 * rotation pass runs afterwards. Throws on any write failure — the recorder
 * (`record.ts`) is the layer that degrades to silence, so the verb's own result
 * is never touched.
 */
export async function appendEvent(
  commonGitDir: string,
  event: LogbookEvent,
): Promise<void> {
  if (storeRemovedByThisProcess) {
    return;
  }
  const dir = logbookDir(commonGitDir);
  await ensureDir(dir);
  const path = join(dir, monthFileName(event.at));
  const isNewMonth = !(await pathExists(path));
  await appendLine(path, eventLine(event));
  if (isNewMonth) {
    await rotate(dir, path, event.at);
  }
}

/** Digest one month file before its removal: line totals, verb-event counts by
 * outcome and by verb. Best-effort — an unreadable file digests to its name
 * and zero, and torn/foreign lines count as `unparsed` rather than vanishing. */
async function digestMonthFile(
  path: string,
  name: string,
): Promise<PruneDigest> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return { file: name, events: 0 };
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let ok = 0;
  let failed = 0;
  let partial = 0;
  let refused = 0;
  let unparsed = 0;
  const byVerb: Record<string, number> = {};
  for (const line of lines) {
    const parsed = parseLogbookLine(line);
    if (parsed.kind !== "event") {
      unparsed += 1;
      continue;
    }
    if (parsed.event.kind !== "verb") {
      continue;
    }
    byVerb[parsed.event.verb] = (byVerb[parsed.event.verb] ?? 0) + 1;
    if (parsed.event.outcome === "ok") {
      ok += 1;
    } else if (parsed.event.outcome === "partial") {
      partial += 1;
    } else if (parsed.event.outcome === "refused") {
      refused += 1;
    } else {
      failed += 1;
    }
  }
  return {
    file: name,
    events: lines.length,
    ...(ok > 0 ? { ok } : {}),
    ...(failed > 0 ? { failed } : {}),
    ...(partial > 0 ? { partial } : {}),
    ...(refused > 0 ? { refused } : {}),
    ...(Object.keys(byVerb).length > 0 ? { by_verb: byVerb } : {}),
    ...(unparsed > 0 ? { unparsed } : {}),
  };
}

/**
 * The rotation pass: list the month files, keep the newest
 * {@link MAX_MONTH_FILES} (the YYYY-MM names sort chronologically), digest and
 * remove the rest oldest-first, and record the removals as a `prune` event in
 * the current month file — pruning is loud, never silent, and each removed
 * month leaves its digest behind.
 */
async function rotate(
  dir: string,
  currentPath: string,
  atIso: string,
): Promise<void> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
      names.push(entry.name);
    }
  }
  const excess = names.sort().reverse().slice(MAX_MONTH_FILES).sort();
  if (excess.length === 0) {
    return;
  }
  const removed: PruneDigest[] = [];
  for (const name of excess) {
    const path = join(dir, name);
    removed.push(await digestMonthFile(path, name));
    await Deno.remove(path);
  }
  const prune: PruneEvent = {
    schema: ON_DISK_FORMATS.logbookEvent.version,
    at: atIso,
    writer: DISCERN_VERSION,
    kind: "prune",
    removed,
  };
  await appendLine(currentPath, eventLine(prune));
}

// ── the epoch sidecar ───────────────────────────────────────────────────────

/** The per-branch epoch state the recorder compares consecutive events against.
 * Kept OUTSIDE the event stream (a sidecar file) because naming which sections
 * moved needs the previous per-section hashes, and events carry only the
 * combined fingerprint. Per BRANCH, not global: parallel worktrees legitimately
 * hold different configs, and a shared last-fingerprint would record a phantom
 * `config-change` on every interleaving. A branch entry simply lingers after
 * its worktree lands — a few stale lines of state, accepted for v1. */
const epochStateSchema = z.object({
  schema: z.literal(ON_DISK_FORMATS.logbookEpoch.version),
  branches: z.record(
    z.string(),
    z.object({
      fingerprint: z.string(),
      sections: z.record(z.string(), z.string()),
    }),
  ),
});

type ValidatedEpochState = z.infer<typeof epochStateSchema>;

/** The branch-epoch state writers construct before read-time schema validation. */
export type EpochState = Omit<ValidatedEpochState, "schema"> & {
  schema: number;
};

/** The epoch sidecar path for a repo. */
export function epochStatePath(commonGitDir: string): string {
  return join(logbookDir(commonGitDir), "epoch.json");
}

export type EpochStateRead =
  | { readonly status: "recorded"; readonly state: EpochState }
  | { readonly status: "missing" | "malformed" }
  | { readonly status: "newer"; readonly reason: string };

/** Inspect the epoch sidecar without collapsing a newer writer into corruption. */
export async function inspectEpochState(
  commonGitDir: string,
): Promise<EpochStateRead> {
  const text = await readTextIfExists(epochStatePath(commonGitDir));
  if (text === undefined) return { status: "missing" };
  const version = inspectOnDiskJsonVersion("logbookEpoch", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("logbookEpoch", version.found),
    };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const result = epochStateSchema.safeParse(parsed);
    return result.success
      ? { status: "recorded", state: result.data }
      : { status: "malformed" };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: logbook-epoch-state-decode-fallback
    return { status: "malformed" };
  }
}

/** Read only the current epoch state; callers that need diagnostics inspect it. */
export async function readEpochState(
  commonGitDir: string,
): Promise<EpochState | undefined> {
  const read = await inspectEpochState(commonGitDir);
  return read.status === "recorded" ? read.state : undefined;
}

/** Write the epoch sidecar atomically (temp-in-dir + rename). */
export async function writeEpochState(
  commonGitDir: string,
  state: EpochState,
): Promise<void> {
  if (storeRemovedByThisProcess) {
    return;
  }
  const dir = logbookDir(commonGitDir);
  await ensureDir(dir);
  const path = epochStatePath(commonGitDir);
  const standing = await inspectEpochState(commonGitDir);
  if (standing.status === "newer") return;
  await atomicReplaceJson(path, {
    ...state,
    schema: ON_DISK_FORMATS.logbookEpoch.version,
  }, {
    mode: 0o666,
    sync: false,
    space: 2,
    trailingNewline: true,
  });
}

// ── the reset ───────────────────────────────────────────────────────────────

/** One logbook file's name and size — the reset plan's unit. */
export interface LogbookFile {
  file: string;
  bytes: number;
}

/** Every regular file directly under the logbook directory (month files, the
 * epoch sidecar, anything a future writer adds), sorted by name — what a reset
 * plan lists and its executor removes. A missing directory is an empty list. */
export async function listLogbookFiles(
  commonGitDir: string,
): Promise<LogbookFile[]> {
  const dir = logbookDir(commonGitDir);
  const files: LogbookFile[] = [];
  const entries = await readDirIfExists(dir);
  if (entries === undefined) return [];
  for (const entry of entries) {
    if (!entry.isFile) {
      continue;
    }
    const info = await Deno.stat(join(dir, entry.name));
    files.push({ file: entry.name, bytes: info.size });
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

/** A lifecycle apply failure that may leave a recoverable detached snapshot. */
export class LogbookLifecycleError extends Error {
  readonly detachedPath: string | undefined;
  readonly archivePath: string | undefined;

  /** Build an error carrying every durable artifact the failed apply left. */
  constructor(
    message: string,
    detachedPath?: string,
    archivePath?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LogbookLifecycleError";
    this.detachedPath = detachedPath;
    this.archivePath = archivePath;
  }
}

/** A concurrent reset or archive already owns the lifecycle boundary. */
export class LogbookLifecycleBusyError extends Error {
  /** Build the stable busy-lock refusal. */
  constructor() {
    super(
      "Another Logbook lifecycle action is already running. Wait for it to finish, then retry this command.",
    );
    this.name = "LogbookLifecycleBusyError";
  }
}

/** Run one apply while holding the repository-common lifecycle lock. */
export async function withLogbookLifecycleLock<T>(
  commonGitDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const path = logbookLifecycleLockPath(commonGitDir);
  await ensureDir(dirname(path));
  const lock = await Deno.open(path, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  });
  let acquired = false;
  try {
    acquired = await lock.tryLock(true);
    if (!acquired) {
      throw new LogbookLifecycleBusyError();
    }
    return await operation();
  } finally {
    lock.close();
  }
}

/** Atomically detach the active directory into the registered recovery area. */
async function detachLogbook(
  commonGitDir: string,
  action: "reset" | "archive",
  entropy: SecureEntropy,
): Promise<string | undefined> {
  const source = logbookDir(commonGitDir);
  const recovery = logbookRecoveryDir(commonGitDir);
  await ensureDir(recovery);
  const detached = join(recovery, `${action}-${entropy.uuid()}`);
  try {
    await Deno.rename(source, detached);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
  return detached;
}

/** Delete only the active Logbook after atomically detaching it for cleanup. */
export async function removeLogbook(
  commonGitDir: string,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<void> {
  const detached = await detachLogbook(commonGitDir, "reset", entropy);
  if (detached === undefined) {
    return;
  }
  try {
    await Deno.remove(detached, { recursive: true });
  } catch (error) {
    throw new LogbookLifecycleError(
      `could not remove the detached logbook; the source remains recoverable at ${detached}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      detached,
      undefined,
      { cause: error },
    );
  }
}

const NEWLINE = new Uint8Array([0x0a]);

/** Write every byte even when an operating-system write is partial. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    offset += await file.write(bytes.subarray(offset));
  }
}

/** Seal raw month bytes from one detached snapshot into a synced temp file. */
async function sealDetachedLogbook(
  detached: string,
  tempPath: string,
): Promise<number> {
  const months: string[] = [];
  for await (const entry of Deno.readDir(detached)) {
    if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
      months.push(entry.name);
    }
  }
  months.sort();
  const output = await Deno.open(tempPath, {
    createNew: true,
    write: true,
    mode: 0o600,
  });
  let bytesWritten = 0;
  let wroteContent = false;
  let previousEndedWithNewline = true;
  try {
    for (const month of months) {
      const bytes = await Deno.readFile(join(detached, month));
      if (bytes.length === 0) {
        continue;
      }
      if (wroteContent && !previousEndedWithNewline) {
        await writeAll(output, NEWLINE);
        bytesWritten += NEWLINE.length;
      }
      await writeAll(output, bytes);
      bytesWritten += bytes.length;
      wroteContent = true;
      previousEndedWithNewline = bytes[bytes.length - 1] === 0x0a;
    }
    await output.sync();
  } finally {
    output.close();
  }
  return bytesWritten;
}

/** Injectable sealing seam for recovery tests after a post-detach failure. */
export interface ArchiveLogbookOptions {
  readonly seal?: (
    detachedPath: string,
    tempPath: string,
  ) => Promise<number>;
  /** Cryptographic identity source for detached and staging paths. */
  readonly entropy?: SecureEntropy;
}

/** The durable artifact created by one successful archive transaction. */
export interface ArchivedLogbook {
  readonly file: string;
  readonly path: string;
  readonly bytes: number;
}

/**
 * Detach the active Logbook, seal its raw month lines, atomically publish the
 * chosen archive, then remove the recovery snapshot. A post-detach failure
 * reports and retains that snapshot.
 */
export async function archiveLogbook(
  commonGitDir: string,
  filename: string,
  options: ArchiveLogbookOptions = {},
): Promise<ArchivedLogbook> {
  if (!isLogbookArchiveFileName(filename)) {
    throw new Error(`invalid logbook archive filename: ${filename}`);
  }
  const archives = logbookArchiveDir(commonGitDir);
  await ensureDir(archives);
  await ensureDir(logbookRecoveryDir(commonGitDir));
  const finalPath = join(archives, filename);
  try {
    await Deno.lstat(finalPath);
    throw new Error(`Logbook archive already exists: ${filename}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  const entropy = options.entropy ?? SYSTEM_SECURE_ENTROPY;
  const detached = await detachLogbook(commonGitDir, "archive", entropy);
  if (detached === undefined) {
    throw new Error(
      "the active logbook disappeared before it could be archived",
    );
  }
  const tempPath = join(
    archives,
    `.${filename}.${entropy.uuid()}.tmp`,
  );
  let published = false;
  try {
    const bytes = await (options.seal ?? sealDetachedLogbook)(
      detached,
      tempPath,
    );
    try {
      await Deno.lstat(finalPath);
      throw new Error(`Logbook archive appeared during apply: ${filename}`);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    // Same-directory hard-link publication is atomic and, unlike rename on
    // POSIX, can never overwrite an archive that appeared after planning.
    await Deno.link(tempPath, finalPath);
    published = true;
    await Deno.remove(tempPath);
    try {
      await Deno.remove(detached, { recursive: true });
    } catch (error) {
      throw new LogbookLifecycleError(
        `the archive is durable at ${finalPath}, but its detached recovery snapshot remains at ${detached}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        detached,
        finalPath,
        { cause: error },
      );
    }
    return { file: filename, path: finalPath, bytes };
  } catch (error) {
    if (!published) {
      await bestEffort(
        "logbook-snapshot-temp-remove",
        async () => await Deno.remove(tempPath),
      );
    }
    if (error instanceof LogbookLifecycleError) {
      throw error;
    }
    throw new LogbookLifecycleError(
      `could not seal the active logbook; its source remains recoverable at ${detached}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      detached,
      published ? finalPath : undefined,
      { cause: error },
    );
  }
}
