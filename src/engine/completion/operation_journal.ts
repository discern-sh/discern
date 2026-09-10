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
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
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
/** An oversized final result is retained complete in a sibling file. */
const RESULT_SUFFIX = ".result.json";
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
  /** Where the complete envelope lives when the record holds a reduced one. */
  readonly result_path?: string;
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

/** Remove a store file, tolerating a concurrent removal. */
async function removeStoreFile(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Reap expired records and evict the oldest before allocating another. */
async function pruneForCreate(
  directory: string,
  now: number,
): Promise<void> {
  const live: { path: string; mtime: number; handle: string }[] = [];
  const siblings: { path: string; mtime: number; handle: string }[] = [];
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
    // Retained-result siblings share their record's lifetime; classify them
    // before the plain record suffix, which they also end with.
    const sibling = entry.name.endsWith(RESULT_SUFFIX)
      ? normalizeOperationHandle(entry.name.slice(0, -RESULT_SUFFIX.length))
      : undefined;
    const record = sibling === undefined && entry.name.endsWith(RECORD_SUFFIX)
      ? normalizeOperationHandle(entry.name.slice(0, -RECORD_SUFFIX.length))
      : undefined;
    if (sibling === undefined && record === undefined) continue;
    try {
      const mtime = (await Deno.stat(path)).mtime?.getTime() ?? now;
      if (now - mtime >= OPERATION_JOURNAL_TTL_MS) {
        await Deno.remove(path);
      } else if (sibling !== undefined) {
        siblings.push({ path, mtime, handle: sibling });
      } else if (record !== undefined) {
        live.push({ path, mtime, handle: record });
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
  const evicted = new Set<string>();
  for (const entry of live.slice(0, removeCount)) {
    evicted.add(entry.handle);
    await removeStoreFile(entry.path);
  }
  const surviving = new Set(
    live.slice(removeCount).map((entry) => entry.handle),
  );
  for (const entry of siblings) {
    if (evicted.has(entry.handle) || !surviving.has(entry.handle)) {
      await removeStoreFile(entry.path);
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
    async finish(outcome, result): Promise<void> {
      const operation = { ...current.operation, finished_at: clock.wallNow() };
      if (result === undefined) {
        current = { ...current, operation, outcome };
        return await persist();
      }
      const payload = new TextEncoder().encode(`${JSON.stringify(result)}\n`);
      if (payload.length <= RESULT_MAX_BYTES) {
        current = { ...current, operation, outcome, result };
        return await persist();
      }
      // An oversized envelope stays completely retrievable: the complete
      // bytes go to a sibling under the same retention, and the record keeps
      // a reduced account that points at them.
      const resultPath = `${
        opened.path.slice(0, -RECORD_SUFFIX.length)
      }${RESULT_SUFFIX}`;
      let retained: string | undefined;
      try {
        await atomicReplaceBytes(
          resultPath,
          payload,
          { mode: 0o600, sync: false },
          entropy,
        );
        retained = resultPath;
      } catch {
        // discern-best-effort: operation-journal-result-retain
        retained = undefined;
      }
      current = {
        ...current,
        operation,
        outcome,
        result: {
          ok: result.ok,
          verb: result.verb,
          ...(result.message === undefined ? {} : { message: result.message }),
        },
        result_truncated: true,
        ...(retained === undefined ? {} : { result_path: retained }),
      };
      return await persist();
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
  /** Nothing recorded for this checkout; the newest operation elsewhere in the repository. */
  | {
    readonly kind: "elsewhere";
    readonly newest: {
      readonly handle: string;
      readonly verb: string;
      readonly branch?: string;
      readonly path: string;
      readonly started_at: number;
    };
  }
  | { readonly kind: "corrupt" }
  | { readonly kind: "newer"; readonly reason: string }
  | { readonly kind: "unavailable" };

/** Resolve a checkout path for comparison; a removed checkout keeps its recorded spelling. */
async function comparablePath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    return path;
  }
}

/**
 * Whether a recorded executor pid is alive; a dead process proves nothing
 * else. POSIX signal 0 performs the existence check without delivering any
 * signal, so probing a stopped process leaves it stopped — reading must never
 * change the operation it reads. Deno's `Signal` type union omits 0 while the
 * runtime accepts it, hence the cast.
 */
function executorAlive(pid: number): boolean {
  try {
    Deno.kill(pid, 0 as unknown as Deno.Signal);
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
 * Read one journal by handle, or — with no handle — the most recently started
 * operation of the calling checkout. An operation elsewhere in the repository
 * is never substituted silently: the reading names the newest one so the
 * caller can ask for it by handle. Reading is observation only.
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
    if (handle !== undefined) {
      let text: string;
      try {
        text = await Deno.readTextFile(
          join(directory, `${handle}${RECORD_SUFFIX}`),
        );
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return { kind: "missing" } as const;
        }
        throw error;
      }
      const parsed = parseRecord(text);
      return parsed.status === "recorded"
        ? foundReading(parsed.record)
        : parsed.status === "newer"
        ? { kind: "newer", reason: parsed.reason } as const
        : { kind: "corrupt" } as const;
    }
    // No handle: the most recently STARTED operation of this checkout, by its
    // own recorded stamp. File modification times move on every progress
    // update, so an older run still reporting would otherwise displace a
    // newer one; and a fleet shares this store, so another checkout's
    // operation is only ever named, never returned in place of this one's.
    const here = await comparablePath(root);
    let newest: OperationJournalRecord | undefined;
    let newestAnywhere: OperationJournalRecord | undefined;
    let sawInvalid: OperationJournalReading | undefined;
    const startedLater = (
      candidate: OperationJournalRecord,
      current: OperationJournalRecord | undefined,
    ): boolean =>
      current === undefined ||
      candidate.operation.started_at > current.operation.started_at ||
      (candidate.operation.started_at === current.operation.started_at &&
        candidate.operation.handle.localeCompare(current.operation.handle) <
          0);
    for await (const entry of Deno.readDir(directory)) {
      if (!entry.isFile || !entry.name.endsWith(RECORD_SUFFIX)) continue;
      if (entry.name.endsWith(RESULT_SUFFIX)) continue;
      if (
        normalizeOperationHandle(
          entry.name.slice(0, -RECORD_SUFFIX.length),
        ) === undefined
      ) continue;
      let text: string;
      try {
        text = await Deno.readTextFile(join(directory, entry.name));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) continue;
        throw error;
      }
      const parsed = parseRecord(text);
      if (parsed.status !== "recorded") {
        sawInvalid = parsed.status === "newer"
          ? { kind: "newer", reason: parsed.reason }
          : sawInvalid ?? { kind: "corrupt" };
        continue;
      }
      if (startedLater(parsed.record, newestAnywhere)) {
        newestAnywhere = parsed.record;
      }
      if (
        await comparablePath(parsed.record.operation.path) === here &&
        startedLater(parsed.record, newest)
      ) {
        newest = parsed.record;
      }
    }
    if (newest !== undefined) return foundReading(newest);
    if (newestAnywhere !== undefined) {
      const { handle, verb, branch, path, started_at } =
        newestAnywhere.operation;
      return {
        kind: "elsewhere",
        newest: {
          handle,
          verb,
          ...(branch === undefined ? {} : { branch }),
          path,
          started_at,
        },
      } as const;
    }
    return sawInvalid ?? { kind: "none-recorded" } as const;
  });
  return reading ?? { kind: "unavailable" };
}

/** Project one parsed record into the found reading with a live executor probe. */
function foundReading(
  record: OperationJournalRecord,
): Extract<OperationJournalReading, { kind: "found" }> {
  return {
    kind: "found",
    handle: record.operation.handle,
    record,
    executor: record.operation.finished_at !== undefined
      ? "gone"
      : executorAlive(record.operation.pid)
      ? "running"
      : "gone",
  };
}

/** One journal covers one operation; a nested wrapped call joins its parent. */
const JOURNAL_SCOPE = new AsyncLocalStorage<true>();

/**
 * Journal one long operation. The wrapper announces the reconnect handle as a
 * progress fact, folds every observed fact into the durable record, and closes
 * it with the executor's own outcome: an observer losing its call never closes
 * anything. A store failure runs the operation without a journal, and a
 * wrapped call nested inside another journalled operation records into its
 * parent's journal instead of opening a second one.
 */
export async function withOperationJournal<T>(
  root: string,
  header: OperationJournalHeader,
  run: (handle: string | undefined) => Promise<T>,
  options: OperationJournalOptions & {
    readonly signal?: AbortSignal;
    /** Project the run's value onto the result envelope the journal retains. */
    readonly result: (value: T) => DiscernResult;
  },
): Promise<T> {
  if (JOURNAL_SCOPE.getStore() === true) return await run(undefined);
  let journal: OperationJournalWriter | undefined;
  try {
    journal = await openOperationJournal(root, header, options);
  } catch {
    // discern-best-effort: operation-journal-open-fallback
    journal = undefined;
  }
  if (journal === undefined) return await run(undefined);
  const open = journal;
  return await JOURNAL_SCOPE.run(true, async () => {
    try {
      const value = await withCompletionObserver(
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
      const result = options.result(value);
      // A cancelled run may still return an ordinary unsuccessful envelope;
      // the executor's own cancellation, not the envelope shape, decides.
      const cancelled = options.signal?.aborted === true;
      await open.finish(
        result.ok ? "completed" : cancelled ? "cancelled" : "failed",
        result,
      );
      return value;
    } catch (error) {
      const cancelled = options.signal?.aborted === true;
      await open.finish(cancelled ? "cancelled" : "failed");
      throw error;
    }
  });
}
