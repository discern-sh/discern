/** Common-Git store for task wording retained by Park after checkout removal. */

import { dirname, join } from "@std/path";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { readDirIfExists, readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import {
  type ParkedTaskMetadata,
  ParkedTaskMetadataSchema,
} from "../../shared/task_metadata.ts";

/** A parked metadata operation whose Git-admin boundary is unavailable. */
export class ParkedTaskMetadataError extends Error {
  override readonly name = "ParkedTaskMetadataError";
}

/** Resolve one branch-keyed Park record without trusting the branch as a path. */
async function parkedTaskPath(
  cwd: string,
  branch: string,
): Promise<string> {
  const directory = await gitAdminStatePath(cwd, "parkedTaskMetadata");
  if (directory === undefined) {
    throw new ParkedTaskMetadataError(
      "Git could not resolve the parked-task metadata directory.",
    );
  }
  return join(directory, `${await sha256Hex(branch)}.json`);
}

/** Persist branch-keyed metadata before the checkout registration is removed. */
export async function writeParkedTaskMetadata(
  cwd: string,
  record: ParkedTaskMetadata,
): Promise<void> {
  const parsed = ParkedTaskMetadataSchema.parse(record);
  const path = await parkedTaskPath(cwd, parsed.branch);
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(path, parsed, {
    mode: 0o600,
    sync: true,
    space: 2,
    trailingNewline: true,
  });
}

/** Read one parked record by branch; malformed evidence is an explicit error. */
export async function readParkedTaskMetadata(
  cwd: string,
  branch: string,
): Promise<ParkedTaskMetadata | undefined> {
  const path = await parkedTaskPath(cwd, branch);
  const text = await readTextIfExists(path);
  if (text === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new ParkedTaskMetadataError(
      `Parked task metadata for ${branch} is not valid JSON.`,
      { cause: error },
    );
  }
  const parsed = ParkedTaskMetadataSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ParkedTaskMetadataError(
      `Parked task metadata for ${branch} does not match the supported schema.`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

/** Remove metadata after a successful resume transferred it to a new task. */
export async function removeParkedTaskMetadata(
  cwd: string,
  branch: string,
): Promise<void> {
  const path = await parkedTaskPath(cwd, branch);
  await Deno.remove(path).catch((error) => {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  });
}

/** Read every valid local parked record, newest first. */
export async function listParkedTaskMetadata(
  cwd: string,
): Promise<ParkedTaskMetadata[]> {
  const directory = await gitAdminStatePath(cwd, "parkedTaskMetadata");
  if (directory === undefined) return [];
  const records: ParkedTaskMetadata[] = [];
  for (const entry of await readDirIfExists(directory) ?? []) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const text = await readTextIfExists(join(directory, entry.name));
    if (text === undefined) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch (error) {
      throw new ParkedTaskMetadataError(
        `Parked task metadata file ${entry.name} is not valid JSON.`,
        { cause: error },
      );
    }
    const parsed = ParkedTaskMetadataSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new ParkedTaskMetadataError(
        `Parked task metadata file ${entry.name} does not match the supported schema.`,
        { cause: parsed.error },
      );
    }
    records.push(parsed.data);
  }
  return records.sort((left, right) =>
    Date.parse(right.parked_at) - Date.parse(left.parked_at)
  );
}
