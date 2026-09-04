/** Shared fixtures for forward-version Git-admin document tests. */

import { assert } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  type GitAdminStateKey,
  gitAdminStatePath,
} from "../src/shared/git_admin_state.ts";
import {
  ON_DISK_FORMATS,
  type OnDiskFormatKey,
} from "../src/shared/on_disk_formats.ts";
import { gitInit } from "./engine_helpers.ts";

/** Create a repository and resolve one writable registered admin-state file. */
export async function initializeGitAdminRecordFixture(
  dir: string,
  key: GitAdminStateKey,
): Promise<string> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
  const path = await gitAdminStatePath(dir, key);
  assert(path !== undefined);
  await Deno.mkdir(dirname(path), { recursive: true });
  return path;
}

/** Write the next numeric version using the registry-owned field and value. */
export async function writeNewerOnDiskJsonFixture(
  path: string,
  format: OnDiskFormatKey,
  fields: Readonly<Record<string, unknown>>,
): Promise<string> {
  const definition = ON_DISK_FORMATS[format];
  assert(
    definition.versionField !== "header" &&
      definition.versionField !== "payloadType",
  );
  const bytes = `${
    JSON.stringify({
      [definition.versionField]: definition.version + 1,
      ...fields,
    })
  }\n`;
  await Deno.writeTextFile(path, bytes);
  return bytes;
}
