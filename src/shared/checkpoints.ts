/**
 * Checkpoint vocabulary shared by the config schema and the checkpoint engine:
 * the closed **mode** pair and the **built-in checkpoint membership**.
 *
 * A checkpoint is one configured rule — deterministic trigger + semantic
 * question + mode — evaluated by the engine in `src/engine/checkpoints/`. The
 * question prose lives in the canonical vocabulary (`shared/questions.ts`); a
 * BUILT-IN checkpoint is the checkpoint MEMBERSHIP of one of those questions: it
 * pairs the question with a shipped trigger, and a project enables it by
 * declaring `[checkpoints.<id>]` with that id (fields it sets override the
 * seed's). This module owns the id set so config validation can tell "a
 * reference to a shipped checkpoint" from "an authored checkpoint missing its
 * question" without reaching into the engine.
 *
 * The parity guards (`tests/questions_registry_test.ts`) walk the registry:
 * every entry must resolve to a canonical question whose violations are
 * diff-introduced (the conversion rule), so an accrued pairing can never ship.
 */

/**
 * The two checkpoint modes:
 *   - `stop`: `discern done` refuses to run any gate job until the agent
 *     declares the question met or unmet (the default).
 *   - `advise`: the question and its evidence are delivered through the
 *     advisory channel; nothing blocks.
 */
export const CHECKPOINT_MODES = ["stop", "advise"] as const;

/** One checkpoint mode ({@link CHECKPOINT_MODES}). */
export type CheckpointMode = (typeof CHECKPOINT_MODES)[number];

/** The mode an entry that names none receives. */
export const DEFAULT_CHECKPOINT_MODE: CheckpointMode = "stop";

/** Why a structural trigger did not hold — the closed veto vocabulary, named
 * so previews can explain and wire schemas can enumerate. */
export const TRIGGER_VETOES = [
  "empty_matched_set",
  "unless_changed",
  "min_changed_files",
  "deletion_dominant",
  "similar_new_file",
] as const;

/** One structural-trigger veto ({@link TRIGGER_VETOES}). */
export type TriggerVeto = (typeof TRIGGER_VETOES)[number];

/** The strict checkpoint obligation one canonical inspection can project for
 * every governing checkpoint. These are decision states, not trigger states:
 * a persisted open question can therefore remain awaiting while its current
 * structural trigger is idle. */
export const CHECKPOINT_OBLIGATION_STATES = [
  "none",
  "will_open",
  "awaiting_declaration",
  "reopened",
  "declared_met",
  "declared_unmet",
  "unknown",
] as const;

/** One checkpoint's projected strict-gate obligation. */
export type CheckpointObligationState =
  (typeof CHECKPOINT_OBLIGATION_STATES)[number];

/**
 * One shipped checkpoint seed: the question it serves plus the trigger and
 * mode defaults a bare `[checkpoints.<id>]` reference receives. Every field a
 * project sets on its entry overrides the seed's value; fields carry the same
 * meaning as the `[checkpoints.<id>]` config keys.
 */
export interface BuiltInCheckpointSeed {
  /** The canonical question id this checkpoint serves (`shared/questions.ts`). */
  readonly question: string;
  /** Default mode; absent means {@link DEFAULT_CHECKPOINT_MODE}. */
  readonly mode?: CheckpointMode;
  /** Default selector: a configured scope name the trigger matches. */
  readonly scope?: string;
  /** Default selector: the globs the trigger matches. */
  readonly paths?: readonly string[];
  /** Default inverted-conjunction condition (globs or scope names). */
  readonly unless_changed?: readonly string[];
  /** Default matched-set size threshold. */
  readonly min_changed_files?: number;
  /** Default deletion-dominant delta-shape predicate. */
  readonly deletion_dominant?: boolean;
  /** Default new-file name-similarity predicate. */
  readonly similar_new_file?: boolean;
}

/**
 * The built-in checkpoints, by id — the checkpoint membership of the canonical
 * question vocabulary, and the single source config validation and policy
 * resolution consult. A project enables one by declaring `[checkpoints.<id>]`;
 * every field the entry sets overrides the seed's.
 *
 * Selectors use live path references, never scope names, wherever a reference
 * exists: a reference resolves in every project, while a scope name governs
 * only where the project defines that scope. `instruction-economy` accepts
 * that trade — the instruction surface is a glob list with no single-value
 * config key to reference, and the instructions scope is the project's own
 * declaration of it. `gotchas-playbook` tracks `[project].gotchas_doc`:
 * unset, the reference expands to the empty pattern, which matches nothing,
 * so the checkpoint stays quiet until the owner names a doc.
 *
 * The four `stop` members fire on the knowledge surfaces — map, instructions,
 * skills, gotchas — where a weak entry quietly misleads every later session.
 * Code-facing members are all `advise`: no shipped default ever interlocks a
 * code change.
 */
export const BUILT_IN_CHECKPOINTS: Readonly<
  Record<string, BuiltInCheckpointSeed>
> = {
  // ── stop: the knowledge surfaces ─────────────────────────────────────────────
  "map-focus": {
    question: "map.focus",
    paths: ["${map.dir}**"],
    // A one-page touch-up is routine; a documentation change this broad is
    // where unfocused, code-derivable prose usually arrives.
    min_changed_files: 3,
  },
  "instruction-economy": {
    question: "instructions.economy",
    scope: "instructions",
  },
  "skills-playbook": {
    question: "skills.executable",
    paths: ["${skills.dir}/"],
  },
  "gotchas-playbook": {
    question: "setup.failure-memory",
    paths: ["${project.gotchas_doc}"],
  },
  // ── advise: the shape of the change ────────────────────────────────────────
  "deletion-heavy-change": {
    question: "change.deletion-safety",
    mode: "advise",
    deletion_dominant: true,
  },
  "parallel-implementation": {
    question: "change.parallel-implementation",
    mode: "advise",
    similar_new_file: true,
  },
  "effort-sprawl": {
    question: "change.effort-scope",
    mode: "advise",
    // Whole-diff breadth: an ordinary single effort rarely spans this many
    // files.
    min_changed_files: 25,
  },
  "docs-drift": {
    question: "map.current",
    mode: "advise",
    // Fires when a substantial change moved nothing in the map. Any map edit
    // vetoes; the threshold keeps small fixes — and regenerated artifacts
    // alone — from asking for documentation they do not need.
    unless_changed: ["${map.dir}**"],
    min_changed_files: 5,
  },
  "commit-story": {
    question: "change.commit-story",
    mode: "advise",
    // The closed menu counts matched files, not commits; breadth is the
    // deterministic stand-in — a change this wide carries a history worth
    // telling however it was committed.
    min_changed_files: 15,
  },
};

/** Whether `id` names a shipped built-in checkpoint. */
export function isBuiltInCheckpoint(id: string): boolean {
  return Object.hasOwn(BUILT_IN_CHECKPOINTS, id);
}
