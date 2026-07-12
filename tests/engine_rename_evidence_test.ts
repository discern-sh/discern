/**
 * Architectural guard: git rename DETECTION must never eat change-set evidence.
 *
 * With detection on, `git diff --name-only`/`--name-status` collapses a rename
 * pair to a single record naming only the NEW path — the vacated (old) path
 * silently vanishes. Any consumer that decides work from "which paths changed"
 * (the scope classifier, update's delta/overlap reads) then sees LESS change
 * than a plain deletion of the same file and runs fewer gates, which the
 * classifier's fail-open doctrine forbids. So every name-listing `git diff`
 * under src/ must pass `--no-renames` in the same argument list.
 *
 * Rename-FOLLOWING is different and stays legal where it is the point — a
 * history miner that wants a renamed file's past to remain continuous. Those
 * sites are sanctioned by file below; extend the set only for a reader whose
 * job is history continuity, never for a change-set (evidence) read.
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

/** Files whose name-listing reads deliberately FOLLOW renames (history miners
 * that keep a renamed file's history continuous — `git log -M --name-only`). */
const RENAME_FOLLOWERS = new Set([
  join("src", "engine", "coupling", "coupling.ts"),
]);

/** A quoted name-listing diff flag inside an argument array. Quoted form only,
 * so prose mentions in comments don't count. */
const NAME_LISTING = /"--name-(?:only|status)"/g;

Deno.test("every name-listing git diff passes --no-renames (evidence reads must keep the vacated path)", async () => {
  const offenders: string[] = [];
  const staleSanctions = new Set(RENAME_FOLLOWERS);
  for await (const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })) {
    const rel = relative(REPO_ROOT, entry.path);
    const text = await Deno.readTextFile(entry.path);
    for (const match of text.matchAll(NAME_LISTING)) {
      if (RENAME_FOLLOWERS.has(rel)) {
        staleSanctions.delete(rel);
        continue;
      }
      // The enclosing flat string-array literal: the argument list this flag
      // belongs to, where --no-renames must also appear.
      const open = text.lastIndexOf("[", match.index);
      const close = text.indexOf("]", match.index);
      const args = open >= 0 && close > open ? text.slice(open, close) : "";
      if (!args.includes('"--no-renames"')) {
        offenders.push(`${rel} (…${match[0]}…)`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "a name-listing git diff without --no-renames drops a rename's vacated " +
      "(old) path from the change set — add the flag, or sanction the file " +
      "in RENAME_FOLLOWERS only if following renames is its documented job:\n  " +
      offenders.join("\n  "),
  );
  assertEquals(
    [...staleSanctions],
    [],
    "sanctioned rename-followers no longer contain a name-listing read — " +
      "prune them from RENAME_FOLLOWERS",
  );
});
