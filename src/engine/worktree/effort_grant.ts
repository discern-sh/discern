/**
 * Read the worktree-scoped landing grant. Mutation capabilities live in
 * separately enrolled modules: the interactive desk owns grant creation, while
 * desk revocation and successful acceptance share the cleanup capability.
 *
 * The marker resolves through GIT_ADMIN_STATE, so it lives under this linked
 * worktree's Git administrative directory and disappears when Git removes the
 * worktree.
 */

import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import { inspectOnDiskJsonFile } from "../../shared/on_disk_json.ts";

export interface EffortGrant {
  readonly version: typeof ON_DISK_FORMATS.effortGrant.version;
  readonly branch: string;
  readonly granted_at: string;
}

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
  if (
    version.status !== "current" ||
    typeof record.branch !== "string" || record.branch.trim() === "" ||
    typeof record.granted_at !== "string" ||
    Number.isNaN(Date.parse(record.granted_at))
  ) {
    return {
      status: "invalid",
      reason:
        "the effort-grant record needs the registered version, a branch, and an ISO-8601 grant time",
    };
  }
  return {
    status: "granted",
    grant: {
      version: ON_DISK_FORMATS.effortGrant.version,
      branch: record.branch,
      granted_at: record.granted_at,
    },
  };
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
