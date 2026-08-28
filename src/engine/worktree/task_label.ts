/** Human task labels recovered from discern's minted worktree identities. */

import { basename } from "@std/path";
import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import { sanitizeSlug } from "./identity.ts";

/** A task name plus the minted id's tail when duplicate names need it. */
export interface WorktreeTaskLabel {
  readonly name: string;
  readonly disambiguator?: string;
}

/** Turn a discern worktree id (`<name>-<hex>`) back into the task name a
 * person supplied. Git identity stays separate from this display label. */
export function taskLabel(
  entry: Pick<StatusFleetEntry, "id" | "path" | "task">,
): WorktreeTaskLabel {
  const canonical = entry.id?.trim();
  const pathIdentity = basename(entry.path).trim();
  const id = canonical !== undefined && canonical !== ""
    ? pathIdentity !== "" && sanitizeSlug(pathIdentity) === canonical
      ? pathIdentity
      : canonical
    : pathIdentity;
  const match = /^(.*)-([0-9a-f]{6})$/i.exec(id);
  const stem = match?.[1] ?? id;
  const words = stem.replaceAll("-", " ").trim();
  const fallbackName = words === ""
    ? "Unnamed task"
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  const name = entry.task?.title ?? fallbackName;
  const disambiguator = match?.[2];
  return disambiguator === undefined ? { name } : { name, disambiguator };
}
