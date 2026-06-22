/**
 * The engine's **plan/apply vocabulary** — the generalization of the installer's
 * `fs_plan.ts` pattern (a pure `Plan` built before any effect, applied by a thin
 * executor) across the engine seam (ADR 0027).
 *
 * The installer's ops are filesystem writes (`write`/`merge`/`append`); the
 * engine's are different — run a job, create/destroy a resource, perform a git
 * mutation, measure a ratchet. So this models the SHAPE of `fs_plan` (a pure data
 * description with a disposition + note, separate from the executor and the
 * renderer) but gives the engine its own op vocabulary.
 *
 * Each effectful verb builds its OWN typed plan (a `GatePlan` carries job groups
 * with commands; a worktree plan carries resource entries / git verbs) so its
 * executor stays type-safe. For PRESENTATION every plan projects to the common
 * {@link EnginePlan} here, which the one shared renderer (`./view.ts`) turns into
 * the `--dry-run` listing and the generic `--json`. A gate plan and a worktree
 * plan are different types sharing one renderer.
 */

/**
 * Whether a planned step will act when the plan is applied:
 *  - `run`  — the step will be performed (a job spawn, a git mutation, a destroy).
 *  - `skip` — the step is part of the plan but will NOT act (a configured-but-
 *             unchanged scope gate, a gc-opted-out resource). Listed for honesty.
 *  - `gate` — a read-only precondition that can BLOCK the plan but mutates nothing
 *             (the merge check). Rendered as "check".
 */
export type StepDisposition = "run" | "skip" | "gate";

/**
 * The engine's operation vocabulary — what a step DOES (never a filesystem write).
 * Deliberately coarse: the renderer groups by it and `--json` reports it.
 */
export type StepKind =
  | "job" // run a gate job (a capability or a check)
  | "scope-gate" // run a scope's self-contained gate
  | "merge-check" // assert the branch contains the integration branch
  | "resource-create" // create a per-worktree external resource
  | "resource-destroy" // destroy / reclaim a per-worktree external resource
  | "git" // a git mutation (branch, wip-commit, remove, checkout, reset, sweep)
  | "setup-step" // a [worktree.setup].steps command
  | "env" // record port / inherit env / resource handles
  | "refresh" // recompile agent guidance + skills
  | "ratchet"; // measure a metric and compare it to its limit

/**
 * One step in an engine plan — the unit the shared renderer prints and the generic
 * `--json` serializes. Pure data: it carries no closures, so a plan is inspectable
 * and serializable before anything runs.
 */
export interface PlanStep {
  kind: StepKind;
  /** Stable label (a job/resource/scope/ratchet name, or a git verb). */
  label: string;
  disposition: StepDisposition;
  /** Human one-liner: what the step does, or why it is skipped. */
  note?: string | undefined;
  /** Optional display grouping (a gate stage, "resources", "git", …). */
  group?: string | undefined;
}

/**
 * A complete, renderable engine plan: a titled, optionally-prefaced step list. The
 * common projection every verb's typed plan reduces to for presentation.
 */
export interface EnginePlan {
  /** Imperative heading (e.g. "Graduation plan", "Gate plan"). */
  title: string;
  /** Context lines shown above the steps (e.g. branch / from / into). */
  details: string[];
  steps: PlanStep[];
}

/** A step's outcome after execution, for the generic results serialization. */
export type StepOutcome = "ok" | "failed" | "skipped";

/** One executed step: the planned step plus how it turned out. */
export interface StepResult {
  step: PlanStep;
  outcome: StepOutcome;
  /** Whole-second wall-clock duration when measured (jobs / ratchets). */
  durationS?: number | undefined;
}
