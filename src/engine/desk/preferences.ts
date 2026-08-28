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

/** Current repository-local preference record format. */
export const DESK_PREFERENCES_SCHEMA_VERSION = 1 as const;

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
  | { readonly status: "unavailable"; readonly reason: string };

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

/** Read preferences; missing, foreign, or torn state falls back to no defaults. */
export async function readDeskPreferences(
  root: string,
): Promise<DeskPreferences> {
  try {
    const path = await deskPreferencesPath(root);
    if (path === undefined) return freshDeskPreferences();
    const text = await readTextIfExists(path);
    if (text === undefined) return freshDeskPreferences();
    const parsed = DeskPreferencesSchema.safeParse(
      JSON.parse(text),
    );
    return parsed.success
      ? {
        schema_version: parsed.data.schema_version,
        ...(parsed.data.last_agent === undefined
          ? {}
          : { last_agent: parsed.data.last_agent }),
        ...(parsed.data.creation_path === undefined
          ? {}
          : { creation_path: parsed.data.creation_path }),
      }
      : freshDeskPreferences();
  } catch {
    return freshDeskPreferences();
  }
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
    await atomicReplaceJson(path, parsed, {
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
