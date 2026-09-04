/**
 * One-time-setup state: the skeleton-marker detector and the canonical
 * "setup is not finished" advisory.
 *
 * `discern setup begin` lays scaffold files carrying placeholder markers, then hands the
 * agent a brief to fill them and `discern setup done` to lock it in. Three surfaces
 * need to know whether that work is still outstanding — `setup done` (the gate that
 * refuses while markers remain), `status` (the orientation banner), and the
 * session-start hook (the resume reminder) — so the detection and the wording live
 * here, once, rather than drifting across three call sites.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { KNOWN_JOBS } from "./capabilities.ts";
import { type DiscernConfig, loadConfig } from "./config_schema.ts";
import { fire, type FiredHint, HINTS } from "./hints.ts";
import { normalizeMapDir } from "./map_path.ts";
import { instructionSeedRel, SOURCE_PATHS } from "./paths_registry.ts";
import {
  assessSetupAssurance,
  type SetupAssurance,
} from "./setup_assurance.ts";
import { runGit } from "./subprocess.ts";
import { pathExists, readTextIfExists } from "./fs_presence.ts";

/** The branch a fresh `discern setup begin` isolates its work on, so its several
 * commits never land on — or pollute — the user's current branch (ADR 0065). */
export const SETUP_BRANCH = "discern-setup";

/**
 * True when a setup branch exists in `dir`'s repository. From a branch WITHOUT
 * `discern.toml` (the config lives only in commits on {@link SETUP_BRANCH}),
 * this is the signal that setup is half-finished, not fresh — the first-contact
 * surfaces route to the resume path (check the branch out) instead of the fresh
 * funnel, whose re-scaffold would fold discern's own compiled output back into
 * the instruction source.
 */
export async function setupBranchExists(dir: string): Promise<boolean> {
  return (await runGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${SETUP_BRANCH}`],
    { cwd: dir },
  )).success;
}

/**
 * Work verbs that refuse until the project records `[meta].bootstrapped`
 * (ADR 0036, revised by ADR 0065): running them before setup would mislead — an
 * unconfigured doc tree is empty, and there is no branch work to hand off yet. Both
 * the CLI router (`main.ts`) and the MCP server (`engine/mcp/server.ts`) gate on
 * this ONE set so the two surfaces can never disagree on what is reachable pre-setup.
 *
 * Deliberately EXCLUDES, besides the knowledge/orientation verbs (`docs` —
 * discern's own documentation, the thing you consult at exactly this moment;
 * `help` — the CLI reference;
 * `status`/`doctor` — orient and debug a broken install) and the plumbing the
 * hooks and `setup` itself drive (`refresh`, `worktree`, `scopes`,
 * `config`, …):
 *
 *   - the GATE PROOF verbs `done` / `prepare` / `test` / `standards`. The agent
 *     needs them to iterate while wiring jobs — and to test a standard it
 *     wires — during setup, so ADR 0065 un-gates them. Pre-setup they carry
 *     {@link setupInProgressHint}, so their output can't be mistaken for a
 *     finished project — the "false all-green" ADR 0036 feared is now covered by
 *     ADR 0037's incompleteness signaling, and `discern setup done` runs the gate
 *     itself as the structural completion proof.
 *
 * `map` IS gated: it browses the project's own tree, which has nothing in it
 * until setup seeds and fills it (`docs` is the pre-setup documentation surface).
 */
export const SETUP_GATED_VERBS: ReadonlySet<string> = new Set<string>([
  "accept",
  "update",
  "map",
  // The desk supervises the worktree fleet, which doesn't exist until setup
  // completes; pre-setup, bare `discern` shows the welcome instead (ADR 0119).
  "desk",
  "enter",
]);

/** True when `verb` refuses until the project is set up (see {@link SETUP_GATED_VERBS}). */
export function verbNeedsSetup(verb: string): boolean {
  return SETUP_GATED_VERBS.has(verb);
}

/**
 * The staged-setup sub-verbs (ADR 0075), in lifecycle order — the single source the
 * CLI router registers under `setup` and the welcome's `next_action` walks. `verify`
 * and `begin` are the handshake; `done` is the terminal proof; `step` is the
 * read-only re-serve of one brief step (off to the side, tracks nothing); `accept`
 * hands the finished setup branch onto the integration branch (off to the side of the
 * handshake, run after `done`). The `engine_setup_phase_parity` test ties the
 * registered command tree back to this set (ADR 0051), so a sub-verb can't be added to
 * one without the other.
 */
export const SETUP_SUBVERBS = [
  "verify",
  "begin",
  "step",
  "done",
  "accept",
] as const;
/** One staged-setup sub-verb ({@link SETUP_SUBVERBS}). */
export type SetupSubverb = (typeof SETUP_SUBVERBS)[number];

/**
 * The setup lifecycle state the welcome renders and `--json` reports: `fresh` (no
 * `discern.toml` yet — nothing written), `in_progress` (`begin` scaffolded, but
 * `[meta].bootstrapped` is still unset), and `done` (bootstrapped). The read-only
 * welcome shows the first two; `done` falls through to normal help.
 */
export type SetupPhase = "fresh" | "in_progress" | "done";

/** Derive the lifecycle {@link SetupPhase} from config presence + the setup completion marker,
 * in ONE place so the welcome, the router, and `status` can't classify it differently. */
export function setupPhaseOf(
  opts: { hasConfig: boolean; bootstrapped: boolean },
): SetupPhase {
  if (!opts.hasConfig) {
    return "fresh";
  }
  return opts.bootstrapped ? "done" : "in_progress";
}

/** The single next command to run from a given {@link SetupPhase} — the funnel the
 * welcome prints and `--json` carries as `next_action`. Soft (advisory), per ADR 0075. */
export function setupNextAction(phase: SetupPhase): string {
  switch (phase) {
    case "fresh":
      return "discern setup verify";
    case "in_progress":
      return "discern setup begin";
    case "done":
      return "discern status";
  }
}

/**
 * The canonical refusal shown when a {@link SETUP_GATED_VERBS} verb runs
 * before setup — the same sentence in the CLI's `not_set_up` error and the MCP
 * tool's, so the funnel toward `discern setup` reads identically on both surfaces.
 */
export const NOT_SET_UP_MESSAGE =
  "this project isn't set up yet. Run `discern` (or `discern setup`) to start " +
  "setup — your coding agent does it for you.";

/**
 * The registered gate advisory when setup is still outstanding, else `undefined`
 * — so a gate core can prepend it to its result's `hints` only pre-setup, from the
 * `[meta].bootstrapped` it already has in hand.
 */
export function setupInProgressHint(
  bootstrapped: boolean,
): FiredHint | undefined {
  return bootstrapped ? undefined : fire(HINTS["setup-unfinished-gate"]);
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

/**
 * Walk the scaffolded surface for files that still carry a skeleton marker —
 * every `.md` under the configured map tree, plus the instructions seed. Returns
 * repo-relative paths, sorted. Cheap (a handful of small files) but still worth
 * gating on `!bootstrapped` at the call site so a finished project pays nothing.
 * The instruction-seed check is narrowed to the `setup fills this` sentinel (its
 * stub never carries an EXAMPLE principle), matching what `setup done` has
 * always asserted.
 */
export async function findSkeletonMarkers(
  root: string,
  config?: DiscernConfig,
): Promise<string[]> {
  const leftover: string[] = [];

  let docsRel = SOURCE_PATHS.map.defaultPath;
  let instructionRel = SOURCE_PATHS.instructions.defaultPath;
  let resolved = config;
  if (resolved === undefined) {
    try {
      resolved = await loadConfig(root);
    } catch {
      // discern-best-effort: setup-skeleton-marker-config-fallback
      // A missing/broken config is diagnosed elsewhere; inspect the default tree.
    }
  }
  if (resolved !== undefined) {
    docsRel = normalizeMapDir(resolved.map.dir);
    instructionRel = instructionSeedRel(resolved.instructions.sources);
  }
  const docsDir = join(root, docsRel);
  if (await pathExists(docsDir)) {
    for await (
      const entry of walk(docsDir, { includeDirs: false, exts: [".md"] })
    ) {
      const text = await readTextIfExists(entry.path);
      if (
        text !== undefined && SKELETON_MARKERS.some((m) => text.includes(m))
      ) {
        leftover.push(relative(root, entry.path));
      }
    }
  }

  const instructions = join(root, instructionRel);
  if (await pathExists(instructions)) {
    const text = await readTextIfExists(instructions);
    if (text?.includes("setup fills this")) {
      leftover.push(instructionRel);
    }
  }

  leftover.sort();
  return leftover;
}

/** One known job and its command/applicability facts from `discern.toml`. */
export interface KnownJobProgress {
  name: string;
  wired: boolean;
  /** Present only when the absent lifecycle is excluded from setup assurance. */
  not_applicable?: true;
}

/**
 * Setup progress, DERIVED from the tree rather than self-reported (ADR 0075): which
 * scaffolded files still carry a skeleton marker (the doc/instructions authoring left to
 * do — the same predicate `setup done` gates on), and which known jobs have a
 * command wired versus left unset. Unfakeable — a file either still carries its marker
 * or it doesn't — and free of any "mark step N done" round-trip. Rendered by the
 * welcome's in-progress state and by `status`.
 */
export interface SetupProgress {
  /** Scaffolded files still carrying a `<!-- setup fills this -->` / EXAMPLE marker. */
  pendingMarkers: string[];
  /** Each known job, in {@link KNOWN_JOBS} order, with wiring/applicability. */
  knownJobs: KnownJobProgress[];
  /** Coverage over the same known-job facts, including the applicable denominator. */
  assurance: SetupAssurance;
  /** True once every skeleton marker is cleared (the authoring is structurally done). */
  markersCleared: boolean;
  /** True once `[meta].bootstrapped` is recorded (`setup done` passed). */
  bootstrapped: boolean;
}

/**
 * Compute {@link SetupProgress} for `root`. Takes the already-loaded `config` (the
 * caller has it) so this stays a pure derivation — markers from the filesystem,
 * known-job wiring and applicability from the config, both read-only. The
 * `wired` predicate mirrors `doctor`'s (`value !== undefined`), so the two
 * surfaces agree on what "wired" means.
 */
export async function setupProgress(
  root: string,
  config: DiscernConfig,
): Promise<SetupProgress> {
  const pendingMarkers = await findSkeletonMarkers(root, config);
  const knownJobs: KnownJobProgress[] = Object.keys(KNOWN_JOBS)
    .map(
      (name) => ({
        name,
        wired: config.jobs[name as keyof typeof KNOWN_JOBS] !==
          undefined,
        ...(config.setup.not_applicable.includes(
            name as keyof typeof KNOWN_JOBS,
          )
          ? { not_applicable: true as const }
          : {}),
      }),
    );
  return {
    pendingMarkers,
    knownJobs,
    assurance: assessSetupAssurance(config),
    markersCleared: pendingMarkers.length === 0,
    bootstrapped: config.meta.bootstrapped,
  };
}

/**
 * The canonical one-line advisory shown when setup is still outstanding — the
 * `status` lead hint and the session-start reminder both render this, so the
 * "you, the agent, must finish it" framing never drifts between them. `pending`
 * is the {@link findSkeletonMarkers} result; an empty list still warrants the
 * reminder (markers all cleared, but `setup done` not yet run).
 */
export function setupUnfinishedHint(pending: readonly string[]): FiredHint {
  return fire(HINTS["setup-unfinished-status"], {
    pendingCount: pending.length,
  });
}
