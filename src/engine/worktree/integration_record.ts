/**
 * The durable record of one integration worktree: which landing owns it and
 * the exact submission snapshot it composes.
 *
 * A landing that must compose a moved trunk writes the record's `intent`
 * phase BEFORE any worktree or resource exists, advances it to `ready` once
 * setup completed, and removes it after the integration worktree, resources,
 * and branch are gone — the resource-ledger discipline, so an interruption at
 * any point leaves recorded cleanup intent rather than an anonymous checkout.
 * Status and the fleet label the copy discern-owned from this record; the
 * landing queue names the submission being checked from it; and
 * `discern worktree prune` reclaims a dead owner's integration worktree while
 * a live owner's is never touched. Nothing here is reconstructed from the
 * branch name.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import {
  atomicReplaceJson,
  removeIfExists,
} from "../../shared/atomic_write.ts";
import { CompletionProofPointerSchema } from "../../shared/completion_proof.ts";
import { readDirIfExists, readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import {
  type ExecutorLiveness,
  executorLiveness,
  readOperationJournal,
} from "../completion/operation_journal.ts";
import {
  NameSchema,
  ObjectIdSchema,
  RecordIdSchema,
} from "../completion/identity.ts";

/** The exact submission snapshot one integration composes, frozen at entry. */
export const IntegrationLandingInputSchema = z.strictObject({
  effort_id: NameSchema,
  /** The authoring branch whose submission is being landed. */
  branch: z.string().min(1),
  /** The authoring worktree the submission was read from. */
  worktree_path: z.string().min(1),
  submission_id: RecordIdSchema,
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
  proof: CompletionProofPointerSchema,
  trunk: z.string().min(1),
  /** The trunk tip this composition brings in. */
  expected_trunk: ObjectIdSchema,
});

/** The retained-composition facts an awaiting-judgment record carries: the
 * exact composed commit the served questions are about, which decision the
 * continuation waits for, and the checkpoint ids awaiting it. */
export const IntegrationContinuationSchema = z.strictObject({
  /** The composed commit at the retained copy's HEAD — the judged subject's
   * revision; a copy found at any other commit is stale and discarded. */
  composed_head: ObjectIdSchema,
  /** `declaration`: served questions await the agent's conclusions
   * (`accept --met` / `--unmet`). `variance`: declared-unmet conclusions
   * await the owner's decision (`accept --confirmed --variance`). */
  decision: z.enum(["declaration", "variance"]),
  /** The checkpoint ids the continuation waits on. */
  awaiting: z.array(z.string().min(1)).min(1),
  retained_at: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "integration continuation time must be ISO-8601",
  ),
});
export type IntegrationContinuation = z.infer<
  typeof IntegrationContinuationSchema
>;

export const IntegrationLandingRecordSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.integrationLanding.version),
  id: RecordIdSchema,
  /** `intent` precedes every setup effect; `ready` follows completed setup;
   * `awaiting-judgment` retains the composed copy, with no live owner, until
   * its served checkpoint decision is answered through `accept` — the next
   * acceptance for the same submission adopts it, and anything that
   * invalidates the composition (a moved trunk, a replacement submission)
   * discards it. */
  phase: z.enum(["intent", "ready", "awaiting-judgment"]),
  created_at: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "integration record time must be ISO-8601",
  ),
  operation: z.strictObject({
    pid: z.number().int().positive(),
    /** The owning landing's reconnect handle, once announced. */
    operation_handle: z.string().optional(),
  }),
  landing: IntegrationLandingInputSchema,
  worktree: z.strictObject({
    id: z.string().min(1),
    branch: z.string().min(1),
    path: z.string().min(1),
  }),
  /** Present exactly while `phase` is `awaiting-judgment`. */
  continuation: IntegrationContinuationSchema.optional(),
}).refine(
  (record) =>
    (record.phase === "awaiting-judgment") ===
      (record.continuation !== undefined),
  "an awaiting-judgment record carries its continuation, and no other phase does",
);
export type IntegrationLandingRecord = z.infer<
  typeof IntegrationLandingRecordSchema
>;

/** The predecessor stored version this reader lifts in memory: the shape
 * before judgment retention existed. */
const LIFTED_INTEGRATION_LANDING_VERSION =
  ON_DISK_FORMATS.integrationLanding.version - 1;

/** The predecessor stored shape: no judgment retention. Read for
 * compatibility with records an earlier engine left behind (an interrupted
 * landing), lifted to the current in-memory envelope only — bytes on disk
 * stay untouched. */
const IntegrationLandingRecordV1Schema = z.strictObject({
  version: z.literal(LIFTED_INTEGRATION_LANDING_VERSION),
  id: RecordIdSchema,
  phase: z.enum(["intent", "ready"]),
  created_at: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "integration record time must be ISO-8601",
  ),
  operation: z.strictObject({
    pid: z.number().int().positive(),
    operation_handle: z.string().optional(),
  }),
  landing: IntegrationLandingInputSchema,
  worktree: z.strictObject({
    id: z.string().min(1),
    branch: z.string().min(1),
    path: z.string().min(1),
  }),
});

export type IntegrationLandingRead =
  | { readonly status: "recorded"; readonly record: IntegrationLandingRecord }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "newer"; readonly reason: string };

/** Parse one stored record without accepting absence as version 1. */
export function parseIntegrationLandingRecord(
  raw: string,
): IntegrationLandingRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      status: "invalid",
      reason: "the integration-landing record is not valid JSON",
    };
  }
  const version = inspectOnDiskRecordVersion("integrationLanding", value);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("integrationLanding", version.found),
    };
  }
  // Version 1 records (no judgment retention) stay readable: the envelope is
  // lifted in memory only, so an earlier engine's interrupted landing remains
  // recoverable and prunable after an upgrade.
  if (
    version.status === "older" &&
    version.found === LIFTED_INTEGRATION_LANDING_VERSION
  ) {
    const v1 = IntegrationLandingRecordV1Schema.safeParse(value);
    if (v1.success) {
      const lifted = IntegrationLandingRecordSchema.safeParse({
        ...v1.data,
        version: ON_DISK_FORMATS.integrationLanding.version,
      });
      if (lifted.success) return { status: "recorded", record: lifted.data };
    }
  }
  const parsed = IntegrationLandingRecordSchema.safeParse(value);
  if (version.status !== "current" || !parsed.success) {
    return {
      status: "invalid",
      reason:
        "the integration-landing record does not name a supported owner, submission snapshot, and integration worktree",
    };
  }
  return { status: "recorded", record: parsed.data };
}

/** Resolve one record's path under the common store; undefined outside Git. */
async function recordPath(
  root: string,
  worktreeId: string,
): Promise<string | undefined> {
  const directory = await gitAdminStatePath(root, "integrationLandings");
  return directory === undefined
    ? undefined
    : join(directory, `${worktreeId}.json`);
}

/** Persist the record (intent before effects; ready after setup). */
export async function writeIntegrationLandingRecord(
  root: string,
  record: IntegrationLandingRecord,
): Promise<void> {
  const path = await recordPath(root, record.worktree.id);
  if (path === undefined) {
    throw new Error(
      "Git could not resolve the integration-landing store, so the landing cannot record its cleanup intent.",
    );
  }
  IntegrationLandingRecordSchema.parse(record);
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(path, record, {
    mode: 0o600,
    sync: true,
    trailingNewline: true,
  });
}

/** Remove one settled record; absence already is the settled state. */
export async function removeIntegrationLandingRecord(
  root: string,
  worktreeId: string,
): Promise<void> {
  const path = await recordPath(root, worktreeId);
  if (path === undefined) return;
  await removeIfExists(path);
}

/** One stored record beside its read verdict, for inventories. */
export interface IntegrationLandingEntry {
  readonly worktreeId: string;
  readonly reading: IntegrationLandingRead;
}

/** Every stored integration-landing record, unreadable ones included. */
export async function listIntegrationLandingRecords(
  root: string,
): Promise<IntegrationLandingEntry[]> {
  const directory = await gitAdminStatePath(root, "integrationLandings");
  if (directory === undefined) return [];
  const entries: IntegrationLandingEntry[] = [];
  const names = await readDirIfExists(directory);
  if (names === undefined) return [];
  for (const entry of names) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const raw = await readTextIfExists(join(directory, entry.name));
    if (raw === undefined) continue;
    entries.push({
      worktreeId: entry.name.slice(0, -".json".length),
      reading: parseIntegrationLandingRecord(raw),
    });
  }
  return entries.sort((a, b) => a.worktreeId.localeCompare(b.worktreeId));
}

/** Whether the record's owning landing is still executing. A surviving host
 * process is not enough: a persistent server outlives every operation it
 * ran, so when the record carries a reconnect handle the operation journal
 * decides — a finished or evicted operation releases the copy for prune even
 * while its process lives, and a running journal keeps it protected. An
 * unreadable journal stays protective; a record without a handle falls back
 * to the process alone. */
export async function integrationOwnerLiveness(
  mainRepo: string,
  record: IntegrationLandingRecord,
): Promise<ExecutorLiveness> {
  const process = executorLiveness(record.operation.pid).state;
  if (process === "gone") return "gone";
  const handle = record.operation.operation_handle;
  if (handle === undefined) return process;
  const reading = await readOperationJournal(mainRepo, handle);
  if (reading.kind === "found") {
    const finished = reading.record.outcome !== undefined ||
      reading.record.operation.finished_at !== undefined;
    return finished ? "gone" : process;
  }
  // The journal keeps every running operation and evicts finished ones
  // first, so a missing record means the landing is over. Anything less
  // certain — corrupt, newer, invalid — keeps the copy protected.
  if (reading.kind === "missing") return "gone";
  return process;
}

/** The retained awaiting-judgment composition for one author worktree, when
 * one exists. Adoption is the caller's decision: it re-validates the
 * submission identity, the expected trunk, and the copy's exact state before
 * reusing anything. Paths compare canonically so a symlinked temp root and
 * its physical spelling name the same worktree. */
export async function retainedIntegrationJudgment(
  root: string,
  authorWorktreePath: string,
): Promise<IntegrationLandingRecord | undefined> {
  const canonical = async (path: string): Promise<string> => {
    try {
      return await Deno.realPath(path);
    } catch {
      return path;
    }
  };
  const author = await canonical(authorWorktreePath);
  for (const entry of await listIntegrationLandingRecords(root)) {
    if (entry.reading.status !== "recorded") continue;
    const record = entry.reading.record;
    if (
      record.phase === "awaiting-judgment" &&
      (record.landing.worktree_path === authorWorktreePath ||
        await canonical(record.landing.worktree_path) === author)
    ) {
      return record;
    }
  }
  return undefined;
}

/** The recorded integration landing that owns `path`, when one is recorded. */
export function integrationRecordForPath(
  entries: readonly IntegrationLandingEntry[],
  path: string,
): IntegrationLandingRecord | undefined {
  for (const entry of entries) {
    if (
      entry.reading.status === "recorded" &&
      entry.reading.record.worktree.path === path
    ) {
      return entry.reading.record;
    }
  }
  return undefined;
}
