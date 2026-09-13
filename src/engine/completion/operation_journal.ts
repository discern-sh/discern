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
import { z } from "@zod/zod";
import { decodeJson } from "../../shared/runtime_decode.ts";
import {
  AwaitDataSchema,
  ProgressFactSchema,
  ProgressFailureSchema,
  ProgressTimingSchema,
  ProgressWaitSchema,
  ProgressWorkSchema,
} from "../../shared/result_schemas.ts";
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
import {
  atomicReplaceBytes,
  isAtomicReplaceTempName,
} from "../../shared/atomic_write.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import {
  readTextIfExists,
  realPathIfExists,
  statIfExists,
} from "../../shared/fs_presence.ts";
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
  type CompletionObservationFact,
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

/**
 * One journalled operation as it lives on disk. The schema is the authority a
 * reader validates every record against before trusting a field: the header
 * (verb, checkout, branch, process, stamps), the latest progress fact exactly
 * as live observers received it, the per-producer accounts merged the way
 * live surfaces merge, each established failure, named timing intervals, the
 * executor's outcome, and the retained result — complete, or reduced with the
 * complete envelope's path or the reason it could not be kept.
 */
const OperationJournalRecordSchema = z.object({
  schema_version: z.literal(ON_DISK_FORMATS.operationJournal.version),
  operation: z.object({
    handle: z.string(),
    verb: z.string(),
    path: z.string(),
    branch: z.string().optional(),
    pid: z.number().int(),
    started_at: z.number(),
    finished_at: z.number().optional(),
  }),
  progress: ProgressFactSchema.optional(),
  waits: z.record(z.string(), ProgressWaitSchema).optional(),
  last_activity_at: z.number().optional(),
  producers: z.record(z.string(), ProgressWorkSchema).optional(),
  failures: z.array(ProgressFailureSchema).optional(),
  timings: z.array(ProgressTimingSchema).optional(),
  outcome: z.enum(["completed", "failed", "cancelled"]).optional(),
  result: z.unknown().optional(),
  result_truncated: z.boolean().optional(),
  result_path: z.string().optional(),
  result_retention_error: z.string().optional(),
});

export type OperationJournalRecord = z.infer<
  typeof OperationJournalRecordSchema
>;
/** The retained shapes a reader receives, as the schema earned them. */
export type JournalledProgressFact = z.infer<typeof ProgressFactSchema>;
export type JournalledProducerWork = z.infer<typeof ProgressWorkSchema>;
export type JournalledFailure = z.infer<typeof ProgressFailureSchema>;

/** Validate a caller-supplied handle without touching the store. */
export function normalizeOperationHandle(
  candidate: string,
): string | undefined {
  return normalizeShortHandle(OPERATION_FAMILY, candidate);
}

/**
 * Why the store could not be used. No repository and a store that exists but
 * failed are different facts, and a reader must not blame the wrong one.
 */
type StoreAccess<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "no-repository" }
  | { readonly status: "inaccessible"; readonly reason: string };

/** One line naming a failure, for a reading that reports instead of guessing. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Serialize store access through an exclusive repository-local lock file.
 * Every failure is classified and carried to the caller: the writer degrades
 * to running without a journal, the reader reports the exact condition.
 * Running unlocked is never an option — it would corrupt the shared store.
 */
async function withStoreLock<T>(
  root: string,
  run: (directory: string) => Promise<T>,
): Promise<StoreAccess<T>> {
  let store: { readonly directory: string; readonly lock: Deno.FsFile };
  try {
    const directory = await gitAdminStatePath(root, "operations");
    if (directory === undefined) return { status: "no-repository" };
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = await Deno.open(join(directory, LOCK_FILE), {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    store = { directory, lock };
  } catch (error) {
    return { status: "inaccessible", reason: describeError(error) };
  }
  try {
    await store.lock.lock(true);
    return { status: "ok", value: await run(store.directory) };
  } catch (error) {
    return { status: "inaccessible", reason: describeError(error) };
  } finally {
    store.lock.close();
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

/**
 * Verbs whose finished journals leave first under capacity pressure. A wait's
 * resume continuation already survives a lost call on its own store, so its
 * journal is the least valuable record here — and the most frequent, since a
 * watching fleet opens one per call.
 */
const EVICT_FIRST_VERBS: ReadonlySet<string> = new Set(["await"]);

/**
 * Capacity eviction order, lowest first: an unreadable record, a finished
 * evict-first verb, any other finished operation, an unfinished operation
 * whose recorded executor is gone, and last an operation still running — a
 * reader reconnecting to a live run must find it.
 */
function evictionRank(record: OperationJournalRecord | undefined): number {
  if (record === undefined) return 0;
  const finished = record.outcome !== undefined ||
    record.operation.finished_at !== undefined;
  if (finished) return EVICT_FIRST_VERBS.has(record.operation.verb) ? 1 : 2;
  return executorLiveness(record.operation.pid).state === "gone" ? 3 : 4;
}

/** Reap expired records, then evict by rank and age before allocating another. */
async function pruneForCreate(
  directory: string,
  now: number,
  maxEntries: number,
): Promise<void> {
  const live: {
    path: string;
    mtime: number;
    handle: string;
    record: OperationJournalRecord | undefined;
  }[] = [];
  const siblings: { path: string; mtime: number; handle: string }[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile) continue;
    const path = join(directory, entry.name);
    if (isAtomicReplaceTempName(entry.name)) {
      const stat = await statIfExists(path);
      const mtime = stat?.mtime?.getTime() ?? now;
      if (stat !== undefined && now - mtime >= OPERATION_JOURNAL_TTL_MS) {
        await removeStoreFile(path);
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
    const stat = await statIfExists(path);
    if (stat === undefined) continue;
    const mtime = stat.mtime?.getTime() ?? now;
    if (now - mtime >= OPERATION_JOURNAL_TTL_MS) {
      await removeStoreFile(path);
    } else if (sibling !== undefined) {
      siblings.push({ path, mtime, handle: sibling });
    } else if (record !== undefined) {
      const text = await readTextIfExists(path);
      if (text === undefined) continue;
      const parsed = parseRecord(text);
      live.push({
        path,
        mtime,
        handle: record,
        record: parsed.status === "recorded" ? parsed.record : undefined,
      });
    }
  }
  // Within a rank the oldest start leaves first; an unreadable record has no
  // start and falls back to its file time.
  const ranked = live.map((entry) => ({
    ...entry,
    rank: evictionRank(entry.record),
    started: entry.record?.operation.started_at ?? entry.mtime,
  }));
  ranked.sort((a, b) =>
    a.rank - b.rank || a.started - b.started || a.path.localeCompare(b.path)
  );
  const removeCount = Math.max(0, ranked.length - maxEntries + 1);
  const evicted = new Set<string>();
  for (const entry of ranked.slice(0, removeCount)) {
    evicted.add(entry.handle);
    await removeStoreFile(entry.path);
  }
  const surviving = new Set(
    ranked.slice(removeCount).map((entry) => entry.handle),
  );
  for (const entry of siblings) {
    if (evicted.has(entry.handle) || !surviving.has(entry.handle)) {
      await removeStoreFile(entry.path);
    }
  }
}

/** Merge one work report the way live surfaces do: fields persist until replaced. */
function mergeWork(
  previous: JournalledProducerWork | undefined,
  work: ProducerWork,
): JournalledProducerWork {
  const retained = work.state === "running" && previous?.state !== "running"
    ? undefined
    : previous;
  return {
    ...retained,
    ...work,
    ...(work.state !== undefined && work.state !== "running"
      ? { active: [] }
      : {}),
    ...(work.partial === true || retained?.partial === true
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
  /** The bounded store's capacity; injected by tests, otherwise the shipped bound. */
  readonly maxEntries?: number;
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
    await pruneForCreate(
      directory,
      clock.wallNow(),
      options.maxEntries ?? OPERATION_JOURNAL_MAX_ENTRIES,
    );
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
          file.close();
        }
        return { handle, path };
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) continue;
        throw error;
      }
    }
    return undefined;
  });
  if (
    opened.status !== "ok" || opened.value === undefined ||
    record === undefined
  ) return undefined;
  const store = opened.value;
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
          store.path,
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
    handle: store.handle,
    observe(fact): Promise<void> {
      current = { ...current, last_activity_at: clock.wallNow() };
      if (fact.kind === "wait") {
        const waits = { ...current.waits, [fact.wait.id]: fact.wait };
        // Evict finished history first; an active wait cannot disappear under load.
        for (const wait of Object.values(waits)) {
          if (Object.keys(waits).length <= TIMINGS_LIMIT) break;
          if (wait.state !== "waiting") delete waits[wait.id];
        }
        current = { ...current, waits };
      } else if (fact.kind === "progress") {
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
        store.path.slice(0, -RECORD_SUFFIX.length)
      }${RESULT_SUFFIX}`;
      // A sibling that cannot be written is reported on the record, so a
      // reader learns why only the reduced account is available.
      let retained: string | undefined;
      let retention: string | undefined;
      try {
        await atomicReplaceBytes(
          resultPath,
          payload,
          { mode: 0o600, sync: false },
          entropy,
        );
        retained = resultPath;
      } catch (error) {
        retention = describeError(error);
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
        ...(retention === undefined
          ? {}
          : { result_retention_error: retention }),
      };
      return await persist();
    },
  };
}

/**
 * What a liveness probe of the recorded executor established. `running` means
 * a process with the recorded id exists right now — not proof it is the same
 * executor, since a host can reuse an id after that process ends; `gone`
 * means no such process exists; `unknown` means the probe itself could not
 * run, and the reading says so rather than guessing.
 */
export type ExecutorLiveness = "running" | "gone" | "unknown";

export type OperationJournalReading =
  | {
    readonly kind: "found";
    readonly record_path: string;
    readonly handle: string;
    readonly record: OperationJournalRecord;
    readonly executor: ExecutorLiveness;
    /** Why the liveness probe could not run, when `executor` is unknown. */
    readonly executor_reason?: string;
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
  | { readonly kind: "corrupt"; readonly reason: string }
  | { readonly kind: "newer"; readonly reason: string }
  /** No repository is reachable from the given root. */
  | { readonly kind: "unavailable" }
  /** The repository's store exists but could not be used; the reason is exact. */
  | { readonly kind: "inaccessible"; readonly reason: string };

/** Resolve a checkout path for comparison; a removed checkout keeps its recorded spelling. */
async function comparablePath(path: string): Promise<string> {
  return (await realPathIfExists(path)) ?? path;
}

/**
 * Probe a recorded executor pid. POSIX signal 0 performs the existence check
 * without delivering any signal, so probing a stopped process leaves it
 * stopped — reading must never change the operation it reads. Deno's `Signal`
 * type union omits 0 while the runtime accepts it, hence the cast. A process
 * the reader is not permitted to signal still exists; only "no such process"
 * means gone, and any other failure is reported as unknown, never guessed.
 */
function executorLiveness(
  pid: number,
): { readonly state: ExecutorLiveness; readonly reason?: string } {
  try {
    Deno.kill(pid, 0 as unknown as Deno.Signal);
    return { state: "running" };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { state: "gone" };
    if (error instanceof Deno.errors.PermissionDenied) {
      return { state: "running" };
    }
    return { state: "unknown", reason: describeError(error) };
  }
}

/**
 * Parse one stored record: refuse a newer format without interpreting it,
 * and validate everything else against the schema before any field is read.
 */
function parseRecord(
  text: string,
):
  | { readonly status: "recorded"; readonly record: OperationJournalRecord }
  | { readonly status: "corrupt"; readonly reason: string }
  | { readonly status: "newer"; readonly reason: string } {
  const version = inspectOnDiskJsonVersion("operationJournal", text);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("operationJournal", version.found),
    };
  }
  try {
    return {
      status: "recorded",
      record: decodeJson(
        OperationJournalRecordSchema,
        text,
        "operation journal record",
      ),
    };
  } catch (error) {
    return { status: "corrupt", reason: describeError(error) };
  }
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
      const text = await readTextIfExists(
        join(directory, `${handle}${RECORD_SUFFIX}`),
      );
      if (text === undefined) return { kind: "missing" } as const;
      const parsed = parseRecord(text);
      return parsed.status === "recorded"
        ? foundReading(parsed.record, directory)
        : parsed.status === "newer"
        ? { kind: "newer", reason: parsed.reason } as const
        : { kind: "corrupt", reason: parsed.reason } as const;
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
      const text = await readTextIfExists(join(directory, entry.name));
      if (text === undefined) continue;
      const parsed = parseRecord(text);
      if (parsed.status !== "recorded") {
        sawInvalid = parsed.status === "newer"
          ? { kind: "newer", reason: parsed.reason }
          : sawInvalid ?? { kind: "corrupt", reason: parsed.reason };
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
    if (newest !== undefined) return foundReading(newest, directory);
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
  if (reading.status === "no-repository") return { kind: "unavailable" };
  if (reading.status === "inaccessible") {
    return { kind: "inaccessible", reason: reading.reason };
  }
  return reading.value;
}

/** Project one parsed record into the found reading with a live executor probe. */
function foundReading(
  record: OperationJournalRecord,
  directory: string,
): Extract<OperationJournalReading, { kind: "found" }> {
  const probe = record.operation.finished_at !== undefined
    ? { state: "gone" as const }
    : executorLiveness(record.operation.pid);
  return {
    kind: "found",
    record_path: join(directory, `${record.operation.handle}${RECORD_SUFFIX}`),
    handle: record.operation.handle,
    record,
    executor: probe.state,
    ...(probe.reason === undefined ? {} : { executor_reason: probe.reason }),
  };
}

/** One journal covers one operation; a nested wrapped call joins its parent. */
const JOURNAL_SCOPE = new AsyncLocalStorage<true>();

/** Whether the current call runs inside a journalled operation already. */
export function insideOperationJournal(): boolean {
  return JOURNAL_SCOPE.getStore() === true;
}

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
  if (insideOperationJournal()) return await run(undefined);
  // Every store failure is classified inside the store lock, so an open that
  // cannot proceed returns no journal rather than throwing.
  const open = await openOperationJournal(root, header, options);
  if (open === undefined) return await run(undefined);
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
              `${header.verb} is running. If this call is lost, \`discern progress ${open.handle}\` reads it back.`,
            operation_handle: open.handle,
          });
          return await run(open.handle);
        },
      );
      const result = options.result(value);
      // A cancelled run may still return an ordinary unsuccessful envelope;
      // the executor's own cancellation, not the envelope shape, decides.
      const cancelled = options.signal?.aborted === true;
      const awaited = header.verb === "await"
        ? AwaitDataSchema.safeParse(result.data)
        : undefined;
      const completed = result.ok &&
        !(cancelled && awaited?.success === true && !awaited.data.met);
      await open.finish(
        completed ? "completed" : cancelled ? "cancelled" : "failed",
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
