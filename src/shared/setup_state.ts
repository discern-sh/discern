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
 * Work verbs that refuse until the project records `[meta].bootstrapped`
 * (ADR 0036, revised by ADR 0065): running them before setup would mislead — an
 * unconfigured doc tree is empty, and there is no branch work to hand off yet. Both
 * the CLI router (`main.ts`) and the MCP server (`engine/mcp/server.ts`) gate on
 * this ONE set so the two surfaces can never disagree on what is reachable pre-setup.
 *
 * Deliberately EXCLUDES, besides the knowledge/orientation verbs (`help` —
 * discern's own documentation, the thing you consult at exactly this moment;
 * `status`/`doctor` — orient and debug a broken install) and the plumbing the
 * hooks and `setup` itself drive (`refresh`, `worktree`, `changed-scopes`,
 * `config`, …):
 *
 *   - the GATE PROOF verbs `finish` / `prepare` / `test` / `ratchets`. The agent
 *     needs them to iterate while wiring capabilities — and to test a ratchet it
 *     wires — during setup, so ADR 0065 un-gates them. Pre-setup they carry
 *     {@link SETUP_IN_PROGRESS_HINT}, so their output can't be mistaken for a
 *     finished project — the "false all-green" ADR 0036 feared is now covered by
 *     ADR 0037's incompleteness signaling, and `discern setup done` runs the gate
 *     itself as the structural completion proof.
 *
 * `docs` IS gated: it browses the project's own tree, which has nothing in it
 * until setup seeds and fills it (`help` is the pre-setup documentation surface).
 */
export const BOOTSTRAP_GATED_VERBS: ReadonlySet<string> = new Set<string>([
  "graduate",
  "integrate",
  "docs",
]);

/** True when `verb` refuses until the project is set up (see {@link BOOTSTRAP_GATED_VERBS}). */
export function verbNeedsBootstrap(verb: string): boolean {
  return BOOTSTRAP_GATED_VERBS.has(verb);
}

/**
 * The canonical refusal shown when a {@link BOOTSTRAP_GATED_VERBS} verb runs
 * before setup — the same sentence in the CLI's `not_set_up` error and the MCP
 * tool's, so the funnel toward `discern setup` reads identically on both surfaces.
 */
export const NOT_SET_UP_MESSAGE =
  "this project isn't set up yet. Run `discern` (or `discern setup`) to set it " +
  "up — your coding agent does it for you.";

/**
 * The advisory a `finish` / `prepare` / `test` / `ratchets` result carries while
 * setup is still outstanding (ADR 0065). Those verbs run pre-setup so the agent can
 * iterate while wiring capabilities — but their output must not read as a finished
 * project, so each prepends this line until `[meta].bootstrapped` is recorded by
 * `discern setup done`.
 */
export const SETUP_IN_PROGRESS_HINT =
  "Setup is not finished — this gate output is indicative while you complete setup. " +
  "Run `discern setup done` to validate the gate and record completion.";

/**
 * {@link SETUP_IN_PROGRESS_HINT} when setup is still outstanding, else `undefined`
 * — so a gate core can prepend it to its result's `hints` only pre-setup, from the
 * `[meta].bootstrapped` it already has in hand.
 */
export function setupInProgressHint(bootstrapped: boolean): string | undefined {
  return bootstrapped ? undefined : SETUP_IN_PROGRESS_HINT;
}

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
