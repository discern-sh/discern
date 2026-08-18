/**
 * Checkpoint vocabulary shared by the config schema and the checkpoint engine:
 * the closed **mode** pair and the **built-in checkpoint membership**.
 *
 * A checkpoint is one configured rule — deterministic trigger + semantic
 * criterion + mode — evaluated by the engine in `src/engine/checkpoints/`. The
 * criterion prose lives in the canonical vocabulary (`shared/criteria.ts`); a
 * BUILT-IN checkpoint is the checkpoint MEMBERSHIP of one of those criteria: it
 * pairs the criterion with a shipped trigger, and a project enables it by
 * declaring `[checkpoints.<id>]` with that id (fields it sets override the
 * seed's). This module owns the id set so config validation can tell "a
 * reference to a shipped checkpoint" from "an authored checkpoint missing its
 * criterion" without reaching into the engine.
 *
 * The registry ships EMPTY until the built-in set lands; the parity guard
 * (`tests/criteria_registry_test.ts`) already walks it, so each future entry
 * must resolve to a canonical criterion from the moment it is added.
 */

/**
 * The two checkpoint modes:
 *   - `stop`: `discern done` refuses to run any gate job until the agent
 *     declares the criterion met or unmet (the default).
 *   - `advise`: the criterion and its evidence are delivered through the
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

/**
 * One shipped checkpoint seed: the criterion it serves plus the trigger and
 * mode defaults a bare `[checkpoints.<id>]` reference receives. Every field a
 * project sets on its entry overrides the seed's value; fields carry the same
 * meaning as the `[checkpoints.<id>]` config keys.
 */
export interface BuiltInCheckpointSeed {
  /** The canonical criterion id this checkpoint serves (`shared/criteria.ts`). */
  readonly criterion: string;
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
 * criterion vocabulary. Empty until the shipped set lands; the id set is the
 * single source config validation and policy resolution consult.
 */
export const BUILT_IN_CHECKPOINTS: Readonly<
  Record<string, BuiltInCheckpointSeed>
> = {};

/** Whether `id` names a shipped built-in checkpoint. */
export function isBuiltInCheckpoint(id: string): boolean {
  return Object.hasOwn(BUILT_IN_CHECKPOINTS, id);
}
