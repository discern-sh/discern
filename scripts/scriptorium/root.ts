/**
 * The repository root, derived from this module's own location so the
 * scriptorium works identically under `deno task`, the project script, and a
 * test importing it from anywhere.
 */

import { fromFileUrl, join } from "@std/path";

/** Absolute path of the repository this scriptorium edits. */
export const REPO_ROOT: string = join(
  fromFileUrl(import.meta.url),
  "..",
  "..",
  "..",
);
