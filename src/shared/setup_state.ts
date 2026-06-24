/**
 * One-time-setup state: the skeleton-marker detector and the canonical
 * "setup is not finished" advisory.
 *
 * `discern setup` lays scaffold files carrying placeholder markers, then hands the
 * agent a brief to fill them and `discern setup done` to lock it in. Three surfaces
 * need to know whether that work is still outstanding — `setup done` (the gate that
 * refuses while markers remain), `status` (the orientation banner), and the
 * session-start hook (the resume reminder) — so the detection and the wording live
 * here, once, rather than drifting across three call sites.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";

/**
 * Markers a scaffolded skeleton carries until the agent fills it: the
 * `<!-- setup fills this -->` sentinels and the placeholder EXAMPLE principle
 * heading (`_(EXAMPLE — replace during ...)_`). Both are specific to the shipped
 * skeleton, so a project's own prose won't trip them. `setup done` refuses to mark
 * setup complete while any remain.
 */
export const SKELETON_MARKERS: readonly string[] = [
  "setup fills this",
  "(EXAMPLE — replace",
];

/** True when a path exists (any type, symlinks not followed). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk the scaffolded surface for files that still carry a skeleton marker —
 * every `.md` under `docs/`, plus the `guidance.md` source. Returns repo-relative
 * paths, sorted. Cheap (a handful of small files) but still worth gating on
 * `!bootstrapped` at the call site so a finished project pays nothing. The
 * `guidance.md` check is narrowed to the `setup fills this` sentinel (its stub
 * never carries an EXAMPLE principle), matching what `setup done` has always
 * asserted.
 */
export async function findSkeletonMarkers(root: string): Promise<string[]> {
  const leftover: string[] = [];

  const docsDir = join(root, "docs");
  if (await pathExists(docsDir)) {
    for await (
      const entry of walk(docsDir, { includeDirs: false, exts: [".md"] })
    ) {
      try {
        const text = await Deno.readTextFile(entry.path);
        if (SKELETON_MARKERS.some((m) => text.includes(m))) {
          leftover.push(relative(root, entry.path));
        }
      } catch {
        // unreadable — skip; it cannot be asserted as a leftover marker.
      }
    }
  }

  const guidance = join(root, "guidance.md");
  if (await pathExists(guidance)) {
    try {
      if ((await Deno.readTextFile(guidance)).includes("setup fills this")) {
        leftover.push("guidance.md");
      }
    } catch {
      // unreadable — skip.
    }
  }

  leftover.sort();
  return leftover;
}

/**
 * The canonical one-line advisory shown when setup is still outstanding — the
 * `status` lead hint and the session-start reminder both render this, so the
 * "you, the agent, must finish it" framing never drifts between them. `pending`
 * is the {@link findSkeletonMarkers} result; an empty list still warrants the
 * reminder (markers all cleared, but `setup done` not yet run).
 */
export function setupUnfinishedHint(pending: readonly string[]): string {
  const tail = pending.length > 0
    ? ` ${pending.length} file(s) still carry skeleton markers.`
    : "";
  return (
    "Setup is NOT finished — completing it is your job as the agent in this " +
    "session, not a report to hand back. Work the brief `discern setup` prints " +
    "(re-run `discern setup` to reprint it — it won't touch your work), then run " +
    "`discern setup done`; don't tell the user setup is complete until it passes." +
    tail
  );
}
