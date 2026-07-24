/**
 * ADR record numbering — the single definition of what counts as a numbered
 * record file and how its number is read, shared by the gate's uniqueness
 * precondition and status's in-flight collision scan.
 *
 * A number identifies a decision forever: superseded records keep theirs (they
 * move to `_superseded/`, filename intact), so uniqueness spans the whole
 * `_adr/` tree, subdirectories included. Two records sharing a number are
 * different files with different slugs — they merge cleanly and no path-level
 * check ever intersects them — which is exactly why the number itself is the
 * key both consumers group by.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";

/** The `_adr/` subdirectory of the configured map — the record tree's one home. */
export const ADR_SUBDIR = "_adr";

/** A numbered record's basename: `NNNN-slug.md`. The README and the plain
 * `0000-template.md` both match or miss on this shape alone — the template IS
 * a record file (number 0000), which stays unique like any other number. */
const ADR_BASENAME = /^(\d{4})-.+\.md$/;

/** The record number a path carries, or undefined for a non-record file. */
export function adrNumberOf(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return ADR_BASENAME.exec(base)?.[1];
}

/** One duplicated number and every record path claiming it (root-relative,
 * sorted). */
export interface AdrNumberDuplicate {
  number: string;
  paths: string[];
}

/**
 * Numbers claimed by more than one record file under `<root>/<mapDir>/_adr/`,
 * `_superseded/` and any other subdirectory included. Empty when the tree has
 * no record directory — a project that hasn't adopted the ADR discipline pays
 * nothing. Read-only; unreadable entries are skipped rather than thrown.
 */
export async function duplicateAdrNumbers(
  root: string,
  mapDir: string,
): Promise<AdrNumberDuplicate[]> {
  const adrDir = join(root, mapDir, ADR_SUBDIR);
  const byNumber = new Map<string, string[]>();
  try {
    for await (const entry of walk(adrDir, { includeDirs: false })) {
      const number = adrNumberOf(entry.path);
      if (number === undefined) {
        continue;
      }
      const paths = byNumber.get(number) ?? [];
      paths.push(relative(root, entry.path));
      byNumber.set(number, paths);
    }
  } catch {
    return [];
  }
  return [...byNumber.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([number, paths]) => ({ number, paths: paths.sort() }));
}
