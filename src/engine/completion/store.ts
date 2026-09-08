import { invalidateCompletionPublication } from "./publication_witness.ts";
/** Common-admin record IO. Observation has no effects; publication is a short CAS. */
import { completionRecordVersionSupported } from "./version.ts";
import { dirname, join } from "@std/path";
import {
  atomicReplaceJson,
  atomicReplaceText,
} from "../../shared/atomic_write.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  GIT_ADMIN_STATE,
  gitAdminStatePath,
} from "../../shared/git_admin_state.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import {
  inspectOnDiskJsonVersion,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import {
  OperationLockError,
  withCompletionPublication,
} from "../operation_lock.ts";
import { RecordIdSchema } from "./identity.ts";
import { applicabilitySubject } from "./evidence.ts";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
  CompletionRecordSchema,
  type RecordSelector,
  recordTransitionAllowed,
} from "./records.ts";

export type CompletionRecordReading =
  | {
    readonly kind: "recorded";
    readonly record: CompletionRecord;
    readonly stamp: string;
  }
  | { readonly kind: "missing" }
  | { readonly kind: "newer" | "older"; readonly version: number }
  | { readonly kind: "invalid" | "unavailable"; readonly reason: string };

/** A version is inspected before shape validation, including unknown families. */
export async function parseCompletionRecord(
  raw: string,
  selector: RecordSelector,
): Promise<CompletionRecordReading> {
  const version = inspectOnDiskJsonVersion("completionRecord", raw);
  const supportedOlder = version.status === "older" &&
    completionRecordVersionSupported(version);
  if (
    version.status === "newer" ||
    (version.status === "older" && !supportedOlder)
  ) {
    return { kind: version.status, version: version.found };
  }
  if (version.status !== "current" && !supportedOlder) {
    return {
      kind: "invalid",
      reason: "completion record needs its registered version",
    };
  }
  // Reviewed older envelopes omit only optional fields. Normalize the envelope;
  // retain the byte stamp so a later CAS archives the exact original document.
  const decoded = JSON.parse(raw);
  const parsed = CompletionRecordSchema.safeParse(
    supportedOlder
      ? { ...decoded, version: ON_DISK_FORMATS.completionRecord.version }
      : decoded,
  );
  if (!parsed.success) return { kind: "invalid", reason: parsed.error.message };
  if (parsed.data.kind !== selector.kind || parsed.data.id !== selector.id) {
    return {
      kind: "invalid",
      reason: "completion record does not match its coordinate",
    };
  }
  return { kind: "recorded", record: parsed.data, stamp: await sha256Hex(raw) };
}

/** Read fresh records through a directory resolved for one operation. */
export interface CompletionRecordStore {
  readonly directory: string;
  readonly publicationPath: string;
  readonly path: (selector: RecordSelector, revision?: number) => string;
  readonly read: (
    selector: RecordSelector,
    revision?: number,
  ) => Promise<CompletionRecordReading>;
}

/** Validate coordinates before they can contribute any path segment. */
function recordRelativePath(
  selector: RecordSelector,
  revision?: number,
): string {
  RecordIdSchema.parse(selector.id);
  if (!Object.hasOwn(COMPLETION_FAMILIES, selector.kind)) {
    throw new TypeError("unknown completion family");
  }
  if (
    revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)
  ) {
    throw new TypeError("record revision must be a positive integer");
  }
  return revision === undefined
    ? join(selector.kind, `${selector.id}.json`)
    : join(selector.kind, selector.id, `${revision}.json`);
}

/** Resolve the common lifetime once per inventory or lock-held publication.
 * Only the directory is retained; every read observes current bytes. Callers
 * open another store after a lifecycle transition or for another operation. */
export async function openCompletionRecordStore(
  root: string,
): Promise<CompletionRecordStore | undefined> {
  const directory = await gitAdminStatePath(
    await Deno.realPath(root),
    "completionRecords",
  );
  return directory === undefined ? undefined : completionStoreAt(directory);
}

/** Use one resolved directory while validating each coordinate and reading fresh bytes. */
function completionStoreAt(directory: string): CompletionRecordStore {
  const path = (selector: RecordSelector, revision?: number): string =>
    join(directory, recordRelativePath(selector, revision));
  return {
    directory,
    publicationPath: join(
      GIT_ADMIN_STATE.completionRecords.path.split("/").reduce(
        (parent) => dirname(parent),
        directory,
      ),
      GIT_ADMIN_STATE.completionPublication.path,
    ),
    path,
    read: (selector, revision) => readStoredRecord(path, selector, revision),
  };
}

/** Resolve family and UUID under the registered common lifetime. */
export async function completionRecordPath(
  root: string,
  selector: RecordSelector,
  revision?: number,
): Promise<string | undefined> {
  const relative = recordRelativePath(selector, revision);
  const store = await openCompletionRecordStore(root);
  return store === undefined ? undefined : join(store.directory, relative);
}

/** Read bytes and validate their coordinate on each observation. */
async function readStoredRecord(
  path: CompletionRecordStore["path"],
  selector: RecordSelector,
  revision?: number,
): Promise<CompletionRecordReading> {
  try {
    const raw = await readTextIfExists(path(selector, revision));
    if (raw === undefined) return { kind: "missing" };
    const reading = await parseCompletionRecord(raw, selector);
    return revision !== undefined && reading.kind === "recorded" &&
        reading.record.revision !== revision
      ? {
        kind: "invalid",
        reason: "record does not match its historical revision",
      }
      : reading;
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Observe the record without repairing state or creating storage. */
export async function readCompletionRecord(
  root: string,
  selector: RecordSelector,
  revision?: number,
): Promise<CompletionRecordReading> {
  try {
    const store = await openCompletionRecordStore(root);
    if (store === undefined) {
      return {
        kind: "unavailable",
        reason: "common Git administration is unavailable",
      };
    }
    return await store.read(selector, revision);
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface PublicationFence {
  readonly attempt_id: string;
  readonly token: string;
}
export type CompletionWriteOutcome =
  | { readonly kind: "written"; readonly stamp: string }
  | {
    readonly kind: "conflict" | "claim-lost" | "transition-refused" | "busy";
    readonly reason: string;
  }
  | Exclude<CompletionRecordReading, { readonly kind: "recorded" | "missing" }>;

/** Retain the exact previous document before replacing its current snapshot. */
async function preserveRevision(
  store: CompletionRecordStore,
  record: CompletionRecord,
  stamp: string,
): Promise<string | undefined> {
  const path = store.path(record);
  const archive = store.path(record, record.revision);
  const raw = await readTextIfExists(path);
  if (raw === undefined || await sha256Hex(raw) !== stamp) {
    return "record changed before history capture";
  }
  const existing = await readTextIfExists(archive);
  if (existing !== undefined) {
    return existing === raw
      ? undefined
      : "historical revision already contains different bytes";
  }
  await Deno.mkdir(dirname(archive), { recursive: true });
  await atomicReplaceText(archive, raw, { mode: 0o600, sync: true });
  return undefined;
}

/** Evidence publication must belong to the live attempt, including its candidate. */
async function checkFence(
  store: CompletionRecordStore,
  record: CompletionRecord,
  fence: PublicationFence | undefined,
  now: number,
): Promise<string | undefined> {
  const publishes = record.kind === "candidate" || record.kind === "evidence" ||
    record.kind === "proof";
  if (fence === undefined) {
    return publishes
      ? "candidate and evidence publication require a current attempt claim"
      : undefined;
  }
  const reading = await store.read({
    kind: "attempt",
    id: fence.attempt_id,
  });
  if (reading.kind !== "recorded" || reading.record.kind !== "attempt") {
    return "attempt is missing or unreadable";
  }
  const attempt = reading.record.data;
  if (
    (attempt.state.kind !== "claimed" && attempt.state.kind !== "composing") ||
    attempt.state.claim.token !== fence.token ||
    attempt.state.claim.expires_at <= now
  ) return "attempt claim was lost, expired, or superseded";
  if (
    (record.kind === "proof" || record.kind === "evidence") &&
    attempt.state.kind !== "claimed"
  ) {
    return "Composition cannot publish validation evidence or Proof before demand is bound.";
  }
  if (
    record.kind === "landing" && (record.data.attempt_id !== fence.attempt_id ||
      record.data.candidate_id !== attempt.identity.candidate_id ||
      JSON.stringify(record.data.executor) !==
        JSON.stringify(attempt.identity.executor) ||
      attempt.mode !== "strict" || attempt.purpose !== "completion")
  ) {
    return "landing publication must match its current strict completion actor";
  }
  if (publishes) {
    if (record.data.attempt_id !== fence.attempt_id) {
      return "publisher does not own the producing attempt";
    }
    const candidateId = record.kind === "candidate"
      ? record.id
      : record.data.candidate_id;
    if (candidateId !== attempt.identity.candidate_id) {
      return "publisher names another candidate";
    }
    if (
      record.kind === "evidence" &&
      record.data.sequence !== attempt.identity.sequence
    ) return "evidence sequence does not match its attempt";
    if (
      record.kind === "evidence" &&
      (!attempt.subjects.includes(
        await applicabilitySubject(record.data.applicability),
      ) || record.data.mode !== attempt.mode ||
        record.data.purpose !== attempt.purpose)
    ) {
      return "evidence applicability, mode, or purpose does not match its attempt";
    }
    if (
      record.kind === "proof" &&
      (record.data.mode !== attempt.mode || attempt.purpose !== "completion")
    ) {
      return "Proof publication requires a completion attempt with the same mode";
    }
  }
  return undefined;
}

/**
 * The existing acceptance lock supplies common-before-checkout ordering. This
 * boundary encloses only record IO, never project commands. 4A moves the public
 * accept lock to individual queue transitions before invoking this capability.
 */
export async function writeCompletionRecord(
  root: string,
  record: CompletionRecord,
  expected: string | null,
  fence?: PublicationFence,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionWriteOutcome> {
  const parsed = CompletionRecordSchema.safeParse(record);
  if (!parsed.success) return { kind: "invalid", reason: parsed.error.message };
  try {
    const canonicalRoot = await Deno.realPath(root);
    return await withCompletionPublication(
      canonicalRoot,
      async (commonGitDirectory) => {
        const store = commonGitDirectory === undefined
          ? await openCompletionRecordStore(canonicalRoot)
          : completionStoreAt(
            join(commonGitDirectory, GIT_ADMIN_STATE.completionRecords.path),
          );
        if (store === undefined) {
          return {
            kind: "unavailable",
            reason: "common Git administration is unavailable",
          };
        }
        const current = await store.read(record);
        if (current.kind !== "missing" && current.kind !== "recorded") {
          return current;
        }
        if ((current.kind === "missing" ? null : current.stamp) !== expected) {
          return {
            kind: "conflict",
            reason: "record changed; observe and replan",
          };
        }
        if (
          current.kind === "recorded"
            ? !recordTransitionAllowed(current.record, parsed.data)
            : record.revision !== 1
        ) {
          return {
            kind: "transition-refused",
            reason:
              "record identity or lifetime does not permit this transition",
          };
        }
        const lost = await checkFence(
          store,
          parsed.data,
          fence,
          clock.wallNow(),
        );
        if (lost !== undefined) return { kind: "claim-lost", reason: lost };
        await invalidateCompletionPublication(store.publicationPath);
        if (current.kind === "recorded") {
          const blocked = await preserveRevision(
            store,
            current.record,
            current.stamp,
          );
          if (blocked !== undefined) {
            return { kind: "transition-refused", reason: blocked };
          }
        }
        const path = store.path(record);
        await Deno.mkdir(dirname(path), { recursive: true });
        const durable = {
          ...parsed.data,
          version: ON_DISK_FORMATS.completionRecord.version,
        };
        await atomicReplaceJson(path, durable, {
          mode: 0o600,
          sync: true,
          trailingNewline: true,
        });
        return {
          kind: "written",
          stamp: await sha256Hex(`${JSON.stringify(durable)}\n`),
        };
      },
    );
  } catch (error) {
    return {
      kind: error instanceof OperationLockError ? "busy" : "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
