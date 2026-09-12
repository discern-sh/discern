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
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import {
  type ExecutorLiveness,
  executorLiveness,
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

export const IntegrationLandingRecordSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.integrationLanding.version),
  id: RecordIdSchema,
  /** `intent` precedes every setup effect; `ready` follows completed setup. */
  phase: z.enum(["intent", "ready"]),
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
});
export type IntegrationLandingRecord = z.infer<
  typeof IntegrationLandingRecordSchema
>;

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
  let names: Deno.DirEntry[];
  try {
    names = [];
    for await (const entry of Deno.readDir(directory)) {
      names.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
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

/** Whether the record's owning landing process still runs. */
export function integrationOwnerLiveness(
  record: IntegrationLandingRecord,
): ExecutorLiveness {
  return executorLiveness(record.operation.pid).state;
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
