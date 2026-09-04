/** Shared read boundary for registered JSON documents in Git administration. */

import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  type OnDiskFormatKey,
} from "./on_disk_formats.ts";

export type OnDiskJsonRead<T> =
  | { readonly status: "recorded"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: "malformed" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "newer"; readonly reason: string };

/** Read, version-check, and decode one registered JSON file without allowing a
 * consumer to collapse forward skew into missing or malformed state. */
export async function inspectOnDiskJsonFile<T>(
  format: OnDiskFormatKey,
  path: string | undefined,
  decode: (raw: string) => T | undefined,
): Promise<OnDiskJsonRead<T>> {
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the registered state path",
    };
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    return error instanceof Deno.errors.NotFound ? { status: "missing" } : {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const version = inspectOnDiskJsonVersion(format, raw);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage(format, version.found),
    };
  }
  try {
    const value = decode(raw);
    return value === undefined
      ? { status: "malformed" }
      : { status: "recorded", value };
  } catch {
    return { status: "malformed" };
  }
}
