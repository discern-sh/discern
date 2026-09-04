/**
 * The sole reader and writer for one worktree's human task metadata record.
 *
 * The registry resolves this file inside Git's linked-worktree administration
 * directory. Git therefore carries it through a worktree move and removes it
 * with the worktree registration.
 */

import { dirname } from "@std/path";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  type StoredTaskMetadata,
  StoredTaskMetadataSchema,
} from "../../shared/task_metadata.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

/** A task metadata record that could not be resolved, read, or validated. */
export class TaskMetadataStoreError extends Error {
  override readonly name = "TaskMetadataStoreError";
}

/** Result of a status-safe record inspection. */
export type TaskMetadataInspection =
  | { readonly kind: "recorded"; readonly metadata: StoredTaskMetadata }
  | { readonly kind: "missing" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Resolve the registered task metadata file for one linked worktree. */
export async function taskMetadataPath(
  cwd: string,
): Promise<string | undefined> {
  return await gitAdminStatePath(cwd, "taskMetadata");
}

/** Read and validate the record; an unrecorded task remains supported. */
export async function readStoredTaskMetadata(
  cwd: string,
): Promise<StoredTaskMetadata | undefined> {
  const path = await taskMetadataPath(cwd);
  if (path === undefined) {
    throw new TaskMetadataStoreError(
      "Task metadata is unavailable because Git could not resolve its worktree state path.",
    );
  }
  let text: string | undefined;
  try {
    text = await readTextIfExists(path);
  } catch (error) {
    throw new TaskMetadataStoreError(
      `Task metadata could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (text === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new TaskMetadataStoreError(
      "Task metadata is unavailable because its record is not valid JSON.",
      { cause: error },
    );
  }
  const version = inspectOnDiskRecordVersion("taskMetadata", decoded);
  if (version.status === "newer") {
    throw new TaskMetadataStoreError(
      newerOnDiskFormatMessage("taskMetadata", version.found),
    );
  }
  const parsed = StoredTaskMetadataSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TaskMetadataStoreError(
      "Task metadata is unavailable because its record does not match the supported schema.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

/** Inspect a record without letting local metadata prevent a status survey. */
export async function inspectTaskMetadata(
  cwd: string,
): Promise<TaskMetadataInspection> {
  try {
    const metadata = await readStoredTaskMetadata(cwd);
    return metadata === undefined
      ? { kind: "missing" }
      : { kind: "recorded", metadata };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Atomically replace one worktree's canonical task metadata record. */
export async function writeStoredTaskMetadata(
  cwd: string,
  metadata: StoredTaskMetadata,
): Promise<void> {
  const parsed = StoredTaskMetadataSchema.parse(metadata);
  const path = await taskMetadataPath(cwd);
  if (path === undefined) {
    throw new TaskMetadataStoreError(
      "Task metadata could not be saved because Git could not resolve its worktree state path.",
    );
  }
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
    const existing = await readTextIfExists(path);
    if (existing !== undefined) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(existing);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const version = inspectOnDiskRecordVersion("taskMetadata", decoded);
      if (version.status === "newer") {
        throw new TaskMetadataStoreError(
          newerOnDiskFormatMessage("taskMetadata", version.found),
        );
      }
    }
    await atomicReplaceJson(path, {
      ...parsed,
      schema_version: ON_DISK_FORMATS.taskMetadata.version,
    }, {
      mode: 0o600,
      sync: true,
      space: 2,
      trailingNewline: true,
    });
  } catch (error) {
    throw new TaskMetadataStoreError(
      `Task metadata could not be saved: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}
