/**
 * Durable progress journals behind short operation handles.
 *
 * Every long operation records what it is doing under
 * `<git-common-dir>/discern/operations/`, so an observer that lost its call —
 * a closed terminal, a timed-out MCP call, a killed process — reconnects and
 * reads the same operation: its phase, the counts and failures known so far,
 * named timing boundaries, and the retained final result when one exists.
 * The journal is advisory presentation state: a write failure degrades to no
 * journal, the recorded facts carry no validation or landing authority, and
 * reading one never starts, repairs, or cancels the operation it describes.
 * An observer's own timeout or death changes nothing here; only the executor
 * finishing or cancelling closes the record.
 */

import { join } from "@std/path";
import { bestEffortSync } from "../../shared/best_effort.ts";
import {
  atomicReplaceBytes,
  isAtomicReplaceTempName,
} from "../../shared/atomic_write.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import {
  createShortHandle,
  normalizeShortHandle,
  shortHandleFamily,
} from "../../shared/short_handle.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  type CompletionFailure,
  type CompletionObservationFact,
  type CompletionProgress,
  emitCompletionProgress,
  type ProducerWork,
  withCompletionObserver,
} from "./events.ts";

const OPERATION_FAMILY = shortHandleFamily("R1");

export const OPERATION_JOURNAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OPERATION_JOURNAL_MAX_ENTRIES = 128;
/** Bound the retained final result; larger envelopes keep a reduced account. */
const RESULT_MAX_BYTES = 256 * 1024;
const FAILURES_LIMIT = 64;
const TIMINGS_LIMIT = 128;
const PRODUCERS_LIMIT = 64;
const RECORD_SUFFIX = ".json";
const LOCK_FILE = ".lock";
const HANDLE_CREATE_ATTEMPTS = 32;

/** One named timing boundary; each category is its own fact, never inferred. */
export interface OperationTiming {
  readonly category: string;
  readonly interval_id: string;
  readonly started_at: number;
  readonly finished_at: number;
}

/** How the executor closed the operation; absent while it has not. */
export type OperationOutcome = "completed" | "failed" | "cancelled";

export interface OperationJournalRecord {
  readonly schema_version: typeof ON_DISK_FORMATS.operationJournal.version;
  readonly operation: {
    readonly handle: string;
    readonly verb: string;
    readonly path: string;
    readonly branch?: string;
    readonly pid: number;
    readonly started_at: number;
    readonly finished_at?: number;
  };
  /** The latest progress fact, exactly as live observers received it. */
  readonly progress?: CompletionProgress;
  /** The latest known account per producer, merged the way live surfaces merge. */
  readonly producers?: Readonly<Record<string, ProducerWork>>;
  readonly failures?: readonly CompletionFailure[];
  readonly timings?: readonly OperationTiming[];
  readonly outcome?: OperationOutcome;
  /** The retained final result envelope, when one exists and fits the bound. */
  readonly result?: unknown;
  readonly result_truncated?: boolean;
}

/** Validate a caller-supplied handle without touching the store. */
export function normalizeOperationHandle(
  candidate: string,
): string | undefined {
  return normalizeShortHandle(OPERATION_FAMILY, candidate);
}

/** Serialize store mutations through an exclusive repository-local lock file. */
async function withStoreLock<T>(
  root: string,
  run: (directory: string) => Promise<T>,
): Promise<T | undefined> {
  const directory = await gitAdminStatePath(root, "operations");
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
    // discern-best-effort: operation-journal-lock-fallback
    return undefined;
  } finally {
    lock?.close();
  }
}

/** Reap expired records and evict the oldest before allocating another. */
async function pruneForCreate(
  directory: string,
  now: number,
): Promise<void> {
  const live: { path: string; mtime: number }[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile) continue;
    const path = join(directory, entry.name);
    if (isAtomicReplaceTempName(entry.name)) {
      try {
        const mtime = (await Deno.stat(path)).mtime?.getTime() ?? now;
        if (now - mtime >= OPERATION_JOURNAL_TTL_MS) await Deno.remove(path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      continue;
    }
    if (!entry.name.endsWith(RECORD_SUFFIX)) continue;
    const handle = normalizeOperationHandle(
      entry.name.slice(0, -RECORD_SUFFIX.length),
    );
    if (handle === undefined) continue;
    try {
      const mtime = (await Deno.stat(path)).mtime?.getTime() ?? now;
      if (now - mtime >= OPERATION_JOURNAL_TTL_MS) {
        await Deno.remove(path);
      } else {
        live.push({ path, mtime });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  live.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
  const removeCount = Math.max(
    0,
    live.length - OPERATION_JOURNAL_MAX_ENTRIES + 1,
  );
  for (const entry of live.slice(0, removeCount)) {
    try {
      await Deno.remove(entry.path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

/** Merge one work report the way live surfaces do: fields persist until replaced. */
function mergeWork(
  previous: ProducerWork | undefined,
  work: ProducerWork,
): ProducerWork {
  return {
    ...previous,
    ...work,
    ...(work.partial === true || previous?.partial === true
      ? { partial: true }
      : {}),
  };
}

/** The retained result, reduced to a bounded account when it is oversized. */
function boundedResult(
  result: DiscernResult,
): { readonly result: unknown; readonly result_truncated?: boolean } {
  const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
  if (bytes <= RESULT_MAX_BYTES) return { result };
  return {
    result: {
      ok: result.ok,
      verb: result.verb,
      ...(result.message === undefined ? {} : { message: result.message }),
    },
    result_truncated: true,
  };
}

export interface OperationJournalHeader {
  readonly verb: string;
  readonly path: string;
  readonly branch?: string;
}

export interface OperationJournalOptions {
  readonly clock?: { wallNow(): number };
  readonly entropy?: SecureEntropy;
  readonly pid?: number;
}

/** The open journal for one running operation; its owner is the only writer. */
export interface OperationJournalWriter {
  readonly handle: string;
  /** Fold one observed fact in and persist; failures degrade to no journal. */
  observe(fact: CompletionObservationFact): Promise<void>;
  /** Close the record with the executor's own outcome and retained result. */
  finish(outcome: OperationOutcome, result?: DiscernResult): Promise<void>;
}

/** Open a journal, allocating its collision-checked handle. */
export async function openOperationJournal(
  root: string,
  header: OperationJournalHeader,
  options: OperationJournalOptions = {},
): Promise<OperationJournalWriter | undefined> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const entropy = options.entropy ?? SYSTEM_SECURE_ENTROPY;
  let record: OperationJournalRecord | undefined;
  const opened = await withStoreLock(root, async (directory) => {
    await pruneForCreate(directory, clock.wallNow());
    for (let attempt = 0; attempt < HANDLE_CREATE_ATTEMPTS; attempt++) {
      const handle = createShortHandle(OPERATION_FAMILY, entropy);
      const path = join(directory, `${handle}${RECORD_SUFFIX}`);
      record = {
        schema_version: ON_DISK_FORMATS.operationJournal.version,
        operation: {
          handle,
          verb: header.verb,
          path: header.path,
          ...(header.branch === undefined ? {} : { branch: header.branch }),
          pid: options.pid ?? Deno.pid,
          started_at: clock.wallNow(),
        },
      };
      try {
        const file = await Deno.open(path, {
          createNew: true,
          write: true,
          mode: 0o600,
        });
        try {
          const bytes = new TextEncoder().encode(
            `${JSON.stringify(record)}\n`,
          );
          let offset = 0;
          while (offset < bytes.length) {
            offset += await file.write(bytes.subarray(offset));
          }
          await file.sync();
        } finally {
          bestEffortSync("operation-journal-create-close", () => {
            file.close();
          });
        }
        return { handle, path };
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) continue;
        throw error;
      }
    }
    return undefined;
  });
  if (opened === undefined || record === undefined) return undefined;
  let current = record;
  // Writes chain so replaces land in order; one failed write ends the journal.
  let pending: Promise<void> = Promise.resolve();
  let broken = false;
  const persist = (): Promise<void> => {
    const snapshot = current;
    pending = pending.then(async () => {
      if (broken) return;
      try {
        await atomicReplaceBytes(
          opened.path,
          new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`),
          { mode: 0o600, sync: false },
          entropy,
        );
      } catch {
        // discern-best-effort: operation-journal-write-fallback
        broken = true;
      }
    });
    return pending;
  };
  return {
    handle: opened.handle,
    observe(fact): Promise<void> {
      if (fact.kind === "progress") {
        const work = fact.progress.work;
        const producers = work === undefined ? current.producers : {
          ...current.producers,
          [work.producer]: mergeWork(current.producers?.[work.producer], work),
        };
        current = {
          ...current,
          progress: fact.progress,
          ...(producers === undefined ||
              Object.keys(producers).length > PRODUCERS_LIMIT
            ? {}
            : { producers }),
        };
      } else if (fact.kind === "failure") {
        const failures = current.failures ?? [];
        if (failures.length >= FAILURES_LIMIT) return Promise.resolve();
        current = { ...current, failures: [...failures, fact.failure] };
      } else if (fact.event.fact.kind === "timing") {
        const timings = current.timings ?? [];
        if (timings.length >= TIMINGS_LIMIT) return Promise.resolve();
        current = {
          ...current,
          timings: [...timings, {
            category: fact.event.fact.category,
            interval_id: fact.event.fact.interval_id,
            started_at: fact.event.fact.started_at,
            finished_at: fact.event.fact.finished_at,
          }],
        };
      } else {
        return Promise.resolve();
      }
      return persist();
    },
    finish(outcome, result): Promise<void> {
      current = {
        ...current,
        operation: { ...current.operation, finished_at: clock.wallNow() },
        outcome,
        ...(result === undefined ? {} : boundedResult(result)),
      };
      return persist();
    },
  };
}

export type OperationJournalReading =
  | {
    readonly kind: "found";
    readonly handle: string;
    readonly record: OperationJournalRecord;
    /** Whether the recorded executor process is still alive right now. */
    readonly executor: "running" | "gone";
  }
  | { readonly kind: "invalid-handle" }
  | { readonly kind: "missing" }
  | { readonly kind: "none-recorded" }
  | { readonly kind: "corrupt" }
  | { readonly kind: "newer"; readonly reason: string }
  | { readonly kind: "unavailable" };

/** Whether a recorded executor pid is alive; a dead observer proves nothing else. */
function executorAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    // discern-best-effort: operation-executor-liveness-probe
    return false;
  }
}

/** Parse one stored record, refusing newer formats without interpreting them. */
function parseRecord(
  text: string,
):
  | { readonly status: "recorded"; readonly record: OperationJournalRecord }
  | { readonly status: "corrupt" }
  | { readonly status: "newer"; readonly reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { status: "corrupt" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "corrupt" };
  }
  const version = inspectOnDiskJsonVersion("operationJournal", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("operationJournal", version.found),
    };
  }
  const value = parsed as Record<string, unknown>;
  const operation = value.operation as Record<string, unknown> | undefined;
  if (
    value.schema_version !== ON_DISK_FORMATS.operationJournal.version ||
    typeof operation !== "object" || operation === null ||
    typeof operation.handle !== "string" ||
    typeof operation.verb !== "string" ||
    typeof operation.path !== "string" ||
    typeof operation.pid !== "number" ||
    typeof operation.started_at !== "number"
  ) {
    return { status: "corrupt" };
  }
  return {
    status: "recorded",
    record: value as unknown as OperationJournalRecord,
  };
}

/**
 * Read one journal by handle, or the most recently started one when no handle
 * is given. Reading is observation only.
 */
export async function readOperationJournal(
  root: string,
  candidate?: string,
): Promise<OperationJournalReading> {
  const handle = candidate === undefined
    ? undefined
    : normalizeOperationHandle(candidate);
  if (candidate !== undefined && handle === undefined) {
    return { kind: "invalid-handle" };
  }
  const reading = await withStoreLock(root, async (directory) => {
    const paths: string[] = [];
    if (handle !== undefined) {
      paths.push(join(directory, `${handle}${RECORD_SUFFIX}`));
    } else {
      const entries: { path: string; mtime: number }[] = [];
      for await (const entry of Deno.readDir(directory)) {
        if (!entry.isFile || !entry.name.endsWith(RECORD_SUFFIX)) continue;
        if (
          normalizeOperationHandle(
            entry.name.slice(0, -RECORD_SUFFIX.length),
          ) === undefined
        ) continue;
        const path = join(directory, entry.name);
        try {
          entries.push({
            path,
            mtime: (await Deno.stat(path)).mtime?.getTime() ?? 0,
          });
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
      entries.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
      paths.push(...entries.map((entry) => entry.path));
      if (paths.length === 0) return { kind: "none-recorded" } as const;
    }
    let sawInvalid: OperationJournalReading | undefined;
    for (const path of paths) {
      let text: string;
      try {
        text = await Deno.readTextFile(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return handle === undefined
            ? { kind: "none-recorded" } as const
            : { kind: "missing" } as const;
        }
        throw error;
      }
      const parsed = parseRecord(text);
      if (parsed.status === "recorded") {
        return {
          kind: "found",
          handle: parsed.record.operation.handle,
          record: parsed.record,
          executor: parsed.record.operation.finished_at !== undefined
            ? "gone"
            : executorAlive(parsed.record.operation.pid)
            ? "running"
            : "gone",
        } as const;
      }
      sawInvalid = parsed.status === "newer"
        ? { kind: "newer", reason: parsed.reason }
        : { kind: "corrupt" };
      if (handle !== undefined) return sawInvalid;
    }
    return sawInvalid ?? { kind: "none-recorded" } as const;
  });
  return reading ?? { kind: "unavailable" };
}

/**
 * Journal one long operation. The wrapper announces the reconnect handle as a
 * progress fact, folds every observed fact into the durable record, and closes
 * it with the executor's own outcome: an observer losing its call never closes
 * anything. A store failure runs the operation without a journal.
 */
export async function withOperationJournal<T extends DiscernResult>(
  root: string,
  header: OperationJournalHeader,
  run: (handle: string | undefined) => Promise<T>,
  options: OperationJournalOptions & { readonly signal?: AbortSignal } = {},
): Promise<T> {
  let journal: OperationJournalWriter | undefined;
  try {
    journal = await openOperationJournal(root, header, options);
  } catch {
    // discern-best-effort: operation-journal-open-fallback
    journal = undefined;
  }
  if (journal === undefined) return await run(undefined);
  const open = journal;
  try {
    const result = await withCompletionObserver(
      (fact) => open.observe(fact),
      async () => {
        emitCompletionProgress({
          phase: "operation",
          state: "started",
          candidate_id: null,
          reason:
            `${header.verb} is running; progress handle ${open.handle} reconnects to it.`,
          operation_handle: open.handle,
        });
        return await run(open.handle);
      },
    );
    await open.finish(result.ok ? "completed" : "failed", result);
    return result;
  } catch (error) {
    const cancelled = options.signal?.aborted === true;
    await open.finish(cancelled ? "cancelled" : "failed");
    throw error;
  }
}
