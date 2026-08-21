/** Human task labels recovered from discern's minted worktree identities. */

import { basename } from "@std/path";
import type { StatusFleetEntry } from "../../shared/result_schemas.ts";

/** A task name plus the minted id's tail when duplicate names need it. */
export interface WorktreeTaskLabel {
  readonly name: string;
  readonly disambiguator?: string;
}

/** Turn a discern worktree id (`<name>-<hex>`) back into the task name a
 * person supplied. Git identity stays separate from this display label. */
export function taskLabel(
  entry: Pick<StatusFleetEntry, "id" | "path">,
): WorktreeTaskLabel {
  const id = entry.id?.trim() || basename(entry.path);
  const match = /^(.*)-([0-9a-f]{6})$/i.exec(id);
  const stem = match?.[1] ?? id;
  const words = stem.replaceAll("-", " ").trim();
  const name = words === ""
    ? "Unnamed task"
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  const disambiguator = match?.[2];
  return disambiguator === undefined ? { name } : { name, disambiguator };
}
