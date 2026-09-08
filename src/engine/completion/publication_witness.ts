/** Invalidate an observed reference graph before a common-storage mutation begins. */
import { z } from "@zod/zod";
import { dirname, join } from "@std/path";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { readBoundedText } from "../../shared/bounded_file.ts";
import {
  GIT_ADMIN_STATE,
  gitAdminStatePath,
} from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { RecordIdSchema } from "./identity.ts";

export const CompletionPublicationSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.completionPublication.version),
  token: RecordIdSchema,
});

/** Resolve once per observation; supplied common administration is owned by the publication lock. */
export async function completionPublicationPath(
  root: string,
  common?: string,
): Promise<string> {
  const path = common === undefined
    ? await gitAdminStatePath(root, "completionPublication")
    : join(common, GIT_ADMIN_STATE.completionPublication.path);
  if (path === undefined) {
    throw new Error(
      "Completion publication storage is unavailable; preserve all artifacts.",
    );
  }
  return path;
}

/** Absence identifies a store without a publication witness; unknown or corrupt witnesses never authorize deletion. */
export async function readCompletionPublication(
  path: string,
): Promise<string | null> {
  try {
    const raw = await readBoundedText(path, 1024);
    const version = inspectOnDiskJsonVersion("completionPublication", raw);
    if (version.status === "newer") {
      throw new Error(
        newerOnDiskFormatMessage("completionPublication", version.found),
      );
    }
    if (version.status !== "current") {
      throw new Error(
        "Completion publication witness is unsupported or corrupt; preserve all artifacts for reconciliation.",
      );
    }
    return CompletionPublicationSchema.parse(JSON.parse(raw)).token;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Caller holds the common publication lock. Change the witness before any referenced bytes or revisions.
 * The token invalidates in-memory plans, so atomic visibility suffices: process
 * death preserves the kernel's writes; machine restart destroys every plan.
 * Recovery records and artifacts retain their own durability barriers. A lost or
 * corrupt token refuses reclamation; it never supplies recovery authority.
 */
export async function invalidateCompletionPublication(
  path: string,
): Promise<void> {
  await readCompletionPublication(path);
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(path, {
    version: ON_DISK_FORMATS.completionPublication.version,
    token: SYSTEM_SECURE_ENTROPY.uuid(),
  }, { mode: 0o600, sync: false, trailingNewline: true });
}
