/**
 * Repository-local continuation state behind short agent-relay handles.
 *
 * One common Git-admin directory serves the main checkout and every linked
 * worktree. Handles point at versioned JSON records there; the payload never
 * crosses the agent boundary. A short-held directory lock serializes create,
 * read, update, expiry, and capacity pruning across CLI and MCP processes.
 */

import { FileLock } from "../../shared/file_lock.ts";
import { join } from "@std/path";
import { bestEffort, bestEffortSync } from "../../shared/best_effort.ts";
import { statIfExists } from "../../shared/fs_presence.ts";
import {
  createContinuationHandle,
  normalizeContinuationHandle,
} from "../../shared/continuation_handle.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import {
  atomicReplaceBytes,
  isAtomicReplaceTempName,
} from "../../shared/atomic_write.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

export const CONTINUATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CONTINUATION_MAX_ENTRIES = 512;
const CONTINUATION_RECORD_MAX_BYTES = 16_384;
const HANDLE_CREATE_ATTEMPTS = 32;
const RECORD_SUFFIX = ".json";
const LOCK_FILE = ".lock";
const TEMP_PREFIX = ".continuation-write-";
const TEMP_SUFFIX = ".tmp";

export interface ContinuationRecord {
  readonly schema_version: typeof ON_DISK_FORMATS.continuationRecord.version;
  readonly kind: string;
  readonly payload: unknown;
}

export interface ContinuationStoreOptions {
  readonly now?: number;
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly entropy?: SecureEntropy;
}

export type ReadContinuationResult =
  | {
    readonly kind: "found";
    readonly handle: string;
    readonly record: ContinuationRecord;
  }
  | { readonly kind: "invalid-handle" }
  | { readonly kind: "missing" }
  | { readonly kind: "corrupt" }
  | { readonly kind: "newer"; readonly reason: string }
  | { readonly kind: "unavailable" };

export type SaveContinuationResult =
  | { readonly kind: "saved"; readonly handle: string }
  | { readonly kind: "unavailable" };

interface LiveEntry {
  readonly path: string;
  readonly mtime: number;
}

/** Place one opaque continuation handle inside the repository-local store. */
function recordPath(directory: string, handle: string): string {
  return join(directory, `${handle}${RECORD_SUFFIX}`);
}

/** Advance through partial filesystem writes until the entire continuation record is persisted. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    offset += await file.write(bytes.subarray(offset));
  }
}

/** Encode a bounded continuation record as compact JSON with a final newline. */
function serializeRecord(record: ContinuationRecord): Uint8Array | undefined {
  let json: string;
  try {
    json = `${JSON.stringify(record)}\n`;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
  const bytes = new TextEncoder().encode(json);
  return bytes.length <= CONTINUATION_RECORD_MAX_BYTES ? bytes : undefined;
}

type ParsedContinuationRecord =
  | { readonly status: "recorded"; readonly record: ContinuationRecord }
  | { readonly status: "corrupt" }
  | { readonly status: "newer"; readonly reason: string };

/** Validate a stored record's version, kind, and payload structure. */
function parseRecord(text: string): ParsedContinuationRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { status: "corrupt" };
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    return { status: "corrupt" };
  }
  const value = parsed as Record<string, unknown>;
  const version = inspectOnDiskJsonVersion("continuationRecord", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("continuationRecord", version.found),
    };
  }
  if (
    Object.keys(value).some((key) =>
      key !== "schema_version" && key !== "kind" && key !== "payload"
    ) ||
    value.schema_version !== ON_DISK_FORMATS.continuationRecord.version ||
    typeof value.kind !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/u.test(value.kind) ||
    !("payload" in value)
  ) {
    return { status: "corrupt" };
  }
  return {
    status: "recorded",
    record: {
      schema_version: ON_DISK_FORMATS.continuationRecord.version,
      kind: value.kind,
      payload: value.payload,
    },
  };
}

/** Reject non-files and records outside the store's byte limit before parsing. */
async function readRecord(
  path: string,
): Promise<ParsedContinuationRecord> {
  const stat = await Deno.stat(path);
  if (
    !stat.isFile || stat.size <= 0 || stat.size > CONTINUATION_RECORD_MAX_BYTES
  ) {
    return { status: "corrupt" };
  }
  return parseRecord(await Deno.readTextFile(path));
}

/** Serialize store mutations through an exclusive repository-local lock file. */
async function withStoreLock<T>(
  root: string,
  run: (directory: string) => Promise<T>,
): Promise<T | undefined> {
  const directory = await gitAdminStatePath(root, "continuations");
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
    // discern-best-effort: continuation-store-lock-fallback
    return undefined;
  } finally {
    lock?.close();
  }
}

/** Delete a record only when its filesystem age exceeds the configured TTL. */
async function removeIfExpired(
  path: string,
  now: number,
  ttlMs: number,
): Promise<"live" | "missing" | "newer"> {
  try {
    const mtime = (await Deno.stat(path)).mtime?.getTime();
    if (mtime !== undefined && now - mtime >= ttlMs) {
      const parsed = await readRecord(path);
      if (parsed.status === "newer") return "newer";
      await Deno.remove(path);
      return "missing";
    }
    return "live";
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return "missing";
    }
    throw error;
  }
}

/** Reap expired records and evict the oldest before allocating another. */
async function pruneForCreate(
  directory: string,
  now: number,
  ttlMs: number,
  maxEntries: number,
): Promise<void> {
  const live: LiveEntry[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (
      entry.isFile &&
      ((entry.name.startsWith(TEMP_PREFIX) &&
        entry.name.endsWith(TEMP_SUFFIX)) ||
        isAtomicReplaceTempName(entry.name))
    ) {
      const tempPath = join(directory, entry.name);
      try {
        const mtime = (await Deno.stat(tempPath)).mtime?.getTime() ?? now;
        if (now - mtime >= ttlMs) {
          await Deno.remove(tempPath);
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
      continue;
    }
    if (!entry.isFile || !entry.name.endsWith(RECORD_SUFFIX)) {
      continue;
    }
    const rawHandle = entry.name.slice(0, -RECORD_SUFFIX.length);
    const handle = normalizeContinuationHandle(rawHandle);
    if (handle === undefined || handle !== rawHandle) {
      continue;
    }
    const path = join(directory, entry.name);
    const info = await statIfExists(path);
    if (info === undefined) continue;
    const mtime = info.mtime?.getTime() ?? now;
    const parsed = await readRecord(path);
    if (parsed.status === "newer") continue;
    if (now - mtime >= ttlMs) {
      await Deno.remove(path);
    } else {
      live.push({ path, mtime });
    }
  }
  live.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
  const removeCount = Math.max(0, live.length - maxEntries + 1);
  for (const entry of live.slice(0, removeCount)) {
    try {
      await Deno.remove(entry.path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}

/** Atomically replace a continuation while preserving its private file mode. */
async function replaceRecord(
  directory: string,
  handle: string,
  bytes: Uint8Array,
  entropy: SecureEntropy,
): Promise<void> {
  const path = recordPath(directory, handle);
  await atomicReplaceBytes(
    path,
    bytes,
    { mode: 0o600, sync: false },
    entropy,
  );
}

/** Allocate a collision-checked handle and persist its bytes with create-new semantics. */
async function createRecord(
  directory: string,
  bytes: Uint8Array,
  entropy: SecureEntropy,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < HANDLE_CREATE_ATTEMPTS; attempt++) {
    const handle = createContinuationHandle(entropy);
    const path = recordPath(directory, handle);
    let file: Deno.FsFile;
    try {
      file = await Deno.open(path, {
        createNew: true,
        write: true,
        mode: 0o600,
      });
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        continue;
      }
      throw error;
    }
    try {
      await writeAll(file, bytes);
      await file.sync();
      return handle;
    } catch (error) {
      bestEffortSync("continuation-record-error-close", () => {
        file.close();
      });
      await bestEffort("continuation-record-error-remove", async () => {
        await Deno.remove(path);
      });
      throw error;
    } finally {
      bestEffortSync("continuation-record-final-close", () => {
        file.close();
      });
    }
  }
  return undefined;
}

/** Read one valid, live continuation record from this repository. */
export async function readContinuation(
  root: string,
  candidate: string,
  opts: ContinuationStoreOptions = {},
): Promise<ReadContinuationResult> {
  const handle = normalizeContinuationHandle(candidate);
  if (handle === undefined) {
    return { kind: "invalid-handle" };
  }
  const now = opts.now ?? SYSTEM_CLOCK.wallNow();
  const ttlMs = opts.ttlMs ?? CONTINUATION_TTL_MS;
  const result = await withStoreLock(root, async (directory) => {
    const path = recordPath(directory, handle);
    const expiry = await removeIfExpired(path, now, ttlMs);
    if (expiry === "missing") {
      return { kind: "missing" } as const;
    }
    if (expiry === "newer") {
      const parsed = await readRecord(path);
      return parsed.status === "newer"
        ? { kind: "newer", reason: parsed.reason } as const
        : { kind: "corrupt" } as const;
    }
    try {
      const parsed = await readRecord(path);
      return parsed.status === "recorded"
        ? { kind: "found", handle, record: parsed.record } as const
        : parsed.status === "newer"
        ? { kind: "newer", reason: parsed.reason } as const
        : { kind: "corrupt" } as const;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { kind: "missing" } as const;
      }
      throw error;
    }
  });
  return result ?? { kind: "unavailable" };
}

/**
 * Persist a continuation, updating `preferredHandle` when it still exists or
 * allocating a collision-checked replacement. The returned handle always
 * names the bytes committed before this call returns.
 */
export async function saveContinuation(
  root: string,
  kind: string,
  payload: unknown,
  preferredHandle?: string,
  opts: ContinuationStoreOptions = {},
): Promise<SaveContinuationResult> {
  const record: ContinuationRecord = {
    schema_version: ON_DISK_FORMATS.continuationRecord.version,
    kind,
    payload,
  };
  const bytes = serializeRecord(record);
  if (bytes === undefined || !/^[a-z][a-z0-9-]{0,63}$/u.test(kind)) {
    return { kind: "unavailable" };
  }
  const now = opts.now ?? SYSTEM_CLOCK.wallNow();
  const ttlMs = opts.ttlMs ?? CONTINUATION_TTL_MS;
  const maxEntries = opts.maxEntries ?? CONTINUATION_MAX_ENTRIES;
  const entropy = opts.entropy ?? SYSTEM_SECURE_ENTROPY;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    return { kind: "unavailable" };
  }
  const saved = await withStoreLock(root, async (directory) => {
    const preferred = preferredHandle === undefined
      ? undefined
      : normalizeContinuationHandle(preferredHandle);
    if (preferred !== undefined) {
      const path = recordPath(directory, preferred);
      const expiry = await removeIfExpired(path, now, ttlMs);
      if (expiry === "live") {
        const standing = await readRecord(path);
        if (standing.status !== "newer") {
          await replaceRecord(directory, preferred, bytes, entropy);
          return preferred;
        }
      }
    }
    await pruneForCreate(directory, now, ttlMs, maxEntries);
    return await createRecord(directory, bytes, entropy);
  });
  return saved === undefined
    ? { kind: "unavailable" }
    : { kind: "saved", handle: saved };
}

/** Remove a terminal continuation. Failure is bounded local hygiene. */
export async function removeContinuation(
  root: string,
  candidate: string,
): Promise<void> {
  const handle = normalizeContinuationHandle(candidate);
  if (handle === undefined) {
    return;
  }
  await withStoreLock(root, async (directory) => {
    await bestEffort("continuation-terminal-remove", async () => {
      const path = recordPath(directory, handle);
      const standing = await readRecord(path);
      if (standing.status !== "newer") {
        await Deno.remove(path);
      }
    });
  });
}
