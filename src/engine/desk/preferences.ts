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
import { inspectOnDiskJsonFile } from "../../shared/on_disk_json.ts";

/** Current repository-local preference record format. */
export const DESK_PREFERENCES_SCHEMA_VERSION =
  ON_DISK_FORMATS.deskPreferences.version;

/** Whether the selected task's details sit beside the list. */
export const DESK_DETAILS_MODES = ["shown", "hidden"] as const;
export type DeskDetailsMode = (typeof DESK_DETAILS_MODES)[number];

/** How the inbox orders tasks: by who moves next, or by title alone. */
export const DESK_SORT_MODES = ["decision", "title"] as const;
export type DeskSortMode = (typeof DESK_SORT_MODES)[number];

/** Every field a version-1 or a current record may carry. Version 1 also
 * remembered a creation path, which no form asks for any more; reading it
 * keeps an older record valid and writing drops it. */
const DeskPreferencesSchema = z.strictObject({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  last_agent: z.enum(AGENT_NAMES).optional(),
  creation_path: z.enum(["compact", "expanded"]).optional(),
  mouse: z.boolean().optional(),
  details: z.enum(DESK_DETAILS_MODES).optional(),
  sort: z.enum(DESK_SORT_MODES).optional(),
  folded_groups: z.array(z.string()).optional(),
});

/** Safe defaults retained per repository. */
export interface DeskPreferences {
  readonly schema_version: typeof DESK_PREFERENCES_SCHEMA_VERSION;
  readonly last_agent?: AgentName;
  /** Report clicks and the wheel; off unless the owner turns it on. */
  readonly mouse?: boolean;
  readonly details?: DeskDetailsMode;
  readonly sort?: DeskSortMode;
  /** Inbox groups the owner left folded, by group id. */
  readonly folded_groups?: readonly string[];
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
  const read = await inspectOnDiskJsonFile(
    "deskPreferences",
    await deskPreferencesPath(root),
    (text) => {
      const parsed = DeskPreferencesSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return undefined;
      const { last_agent, mouse, details, sort, folded_groups } = parsed.data;
      return {
        schema_version: DESK_PREFERENCES_SCHEMA_VERSION,
        ...(last_agent === undefined ? {} : { last_agent }),
        ...(mouse === undefined ? {} : { mouse }),
        ...(details === undefined ? {} : { details }),
        ...(sort === undefined ? {} : { sort }),
        ...(folded_groups === undefined ? {} : { folded_groups }),
      };
    },
  );
  if (read.status === "recorded") {
    return { status: "recorded", preferences: read.value };
  }
  return read;
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
