/**
 * Repository-local Desk convenience preferences.
 *
 * This common-Git-dir record may influence defaults only. Task identity,
 * lifecycle state, landing authority, and action availability remain owned by
 * their canonical stores and live observations.
 */

import { dirname } from "@std/path";
import { z } from "@zod/zod";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { AGENT_NAMES } from "../../shared/config_schema.ts";
import type { AgentName } from "../../lib/config.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

/** Current repository-local preference record format. */
export const DESK_PREFERENCES_SCHEMA_VERSION =
  ON_DISK_FORMATS.deskPreferences.version;

/** Creation routes whose default may be remembered. */
export const DESK_CREATION_PATHS = ["compact", "expanded"] as const;
export type DeskCreationPath = (typeof DESK_CREATION_PATHS)[number];

const DeskPreferencesSchema = z.strictObject({
  schema_version: z.literal(DESK_PREFERENCES_SCHEMA_VERSION),
  last_agent: z.enum(AGENT_NAMES).optional(),
  creation_path: z.enum(DESK_CREATION_PATHS).optional(),
});

/** Safe defaults retained per repository. */
export interface DeskPreferences {
  readonly schema_version: typeof DESK_PREFERENCES_SCHEMA_VERSION;
  readonly last_agent?: AgentName;
  readonly creation_path?: DeskCreationPath;
}

/** Observable outcome of persisting optional convenience defaults. */
export type DeskPreferencesWriteResult =
  | { readonly status: "saved" }
  | { readonly status: "newer"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

export type DeskPreferencesRead =
  | { readonly status: "recorded"; readonly preferences: DeskPreferences }
  | { readonly status: "missing" | "malformed" | "unavailable" }
  | { readonly status: "newer"; readonly reason: string };

/** A fresh record carries no default that could go stale. */
export function freshDeskPreferences(): DeskPreferences {
  return { schema_version: DESK_PREFERENCES_SCHEMA_VERSION };
}

/** Resolve the common-Git-dir preference record. */
export async function deskPreferencesPath(
  root: string,
): Promise<string | undefined> {
  return await gitAdminStatePath(root, "deskPreferences");
}

/** Inspect preferences while naming a record written by a newer binary. */
export async function inspectDeskPreferences(
  root: string,
): Promise<DeskPreferencesRead> {
  try {
    const path = await deskPreferencesPath(root);
    if (path === undefined) return { status: "unavailable" };
    const text = await readTextIfExists(path);
    if (text === undefined) return { status: "missing" };
    const version = inspectOnDiskJsonVersion("deskPreferences", text);
    if (version.status === "newer") {
      return {
        status: "newer",
        reason: newerOnDiskFormatMessage("deskPreferences", version.found),
      };
    }
    const parsed = DeskPreferencesSchema.safeParse(
      JSON.parse(text),
    );
    return parsed.success
      ? {
        status: "recorded",
        preferences: {
          schema_version: parsed.data.schema_version,
          ...(parsed.data.last_agent === undefined
            ? {}
            : { last_agent: parsed.data.last_agent }),
          ...(parsed.data.creation_path === undefined
            ? {}
            : { creation_path: parsed.data.creation_path }),
        },
      }
      : { status: "malformed" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Read preferences; non-current state contributes no defaults. */
export async function readDeskPreferences(
  root: string,
): Promise<DeskPreferences> {
  const read = await inspectDeskPreferences(root);
  return read.status === "recorded" ? read.preferences : freshDeskPreferences();
}

/** Persist convenience defaults atomically and expose any unavailable store. */
export async function writeDeskPreferences(
  root: string,
  preferences: DeskPreferences,
): Promise<DeskPreferencesWriteResult> {
  const parsed = DeskPreferencesSchema.parse(preferences);
  try {
    const path = await deskPreferencesPath(root);
    if (path === undefined) {
      return {
        status: "unavailable",
        reason:
          "Git could not resolve the repository's shared state directory.",
      };
    }
    await Deno.mkdir(dirname(path), { recursive: true });
    const existing = await readTextIfExists(path);
    if (existing !== undefined) {
      const version = inspectOnDiskJsonVersion("deskPreferences", existing);
      if (version.status === "newer") {
        return {
          status: "newer",
          reason: newerOnDiskFormatMessage("deskPreferences", version.found),
        };
      }
    }
    await atomicReplaceJson(path, {
      ...parsed,
      schema_version: ON_DISK_FORMATS.deskPreferences.version,
    }, {
      mode: 0o600,
      sync: false,
      space: 2,
      trailingNewline: true,
    });
    return { status: "saved" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
