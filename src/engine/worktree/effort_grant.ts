/**
 * Read the worktree-scoped landing grant. Mutation capabilities live in
 * separately enrolled modules: the interactive desk owns grant creation, while
 * desk revocation and successful acceptance share the cleanup capability.
 *
 * The grant binds to the effort, not to one revision: any later green `done`
 * on the granted branch is covered until a landing consumes it. The marker
 * resolves through GIT_ADMIN_STATE, so it lives under this linked worktree's
 * Git administrative directory and disappears when Git removes the worktree.
 */

import { z } from "@zod/zod";
import { RecordIdSchema } from "../completion/identity.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import { inspectOnDiskJsonFile } from "../../shared/on_disk_json.ts";

export const EffortGrantSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.effortGrant.version),
  id: RecordIdSchema,
  branch: z.string().min(1),
  granted_at: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "grant time must be ISO-8601",
  ),
});
export type EffortGrant = z.infer<typeof EffortGrantSchema>;

export type EffortGrantRead =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "newer"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

/** Preserve an Error message while giving non-Error failures stable text. */
export function effortGrantFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Validate the persisted branch-bound grant and its ISO-8601 grant time. */
export function parseEffortGrant(raw: string): EffortGrantRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      status: "invalid",
      reason: "the effort-grant record is not valid JSON",
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "invalid",
      reason: "the effort-grant record is not a JSON object",
    };
  }
  const record = value as Record<string, unknown>;
  const version = inspectOnDiskRecordVersion("effortGrant", record);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("effortGrant", version.found),
    };
  }
  const parsed = EffortGrantSchema.safeParse(record);
  if (version.status !== "current" || !parsed.success) {
    return {
      status: "invalid",
      reason:
        "The effort-grant record does not bind a supported branch. Reconcile any old acceptance claim first; record landing authority again from the desk.",
    };
  }
  return { status: "granted", grant: parsed.data };
}

/** Read this worktree's effort grant. Unreadable or malformed state fails closed. */
export async function readEffortGrant(cwd: string): Promise<EffortGrantRead> {
  const read = await inspectOnDiskJsonFile(
    "effortGrant",
    await gitAdminStatePath(cwd, "effortGrant"),
    parseEffortGrant,
  );
  return read.status === "recorded"
    ? read.value
    : read.status === "malformed"
    ? { status: "invalid", reason: "the effort-grant record is malformed" }
    : read;
}
