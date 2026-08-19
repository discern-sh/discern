/**
 * The **improvement vocabulary** — the types `discern improvement` is built on. An
 * improvement report combines a scored baseline of best-practice **rules** with
 * qualitative **reviews**, then points at the single highest-value next action.
 *
 * Two rule kinds, mirroring discern's split of labour (the binary is deterministic;
 * the agent is the intelligence):
 *   - a **deterministic** rule is decided in-process now — it reads the gathered
 *     {@link ImprovementContext} and returns a {@link RuleStatus}, a finding, a fix,
 *     and a teach. discern owns it end to end.
 *   - a **subjective** rule cannot be mechanically decided (do the instructions
 *     actually capture what an agent couldn't infer? do the docs still match the
 *     code?). discern can't run a model, so it does the next best thing: it surfaces
 *     the *question* plus the project material to judge it **against** ({@link
 *     ReviewEvidence}), and the agent in the loop renders the verdict. This is how a
 *     deterministic binary "analyses subjective rules against instructions".
 *
 * The catalog (categories + rules) lives in `rules.ts`; the runner that evaluates
 * it into an {@link ImprovementReport} and the renderings live in `improve.ts`.
 * This module is pure data + interfaces, so both depend on it without a cycle.
 */

import type { CheckpointMode } from "../../shared/checkpoints.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { PatternsFinding } from "../../shared/patterns_vocabulary.ts";
import type { CheckpointVarianceSummary } from "../logbook/checkpoint_economics.ts";

// ── the gathered facts a rule reads ─────────────────────────────────────────

/**
 * The project facts an improvement rule reasons over, gathered ONCE (config + a handful
 * of filesystem probes) so every rule's `evaluate`/`against` stays a pure, sync
 * function of this context. Built by `buildContext` in `rules.ts`.
 */
export interface ImprovementContext {
  /** The project root (the directory holding discern.toml). */
  root: string;
  /** The fully-typed, fully-defaulted config. */
  config: DiscernConfig;
  /** Whether at least one `[instructions].sources` file resolved on disk. */
  instructionPresent: boolean;
  /** The concatenated text of every resolved instruction source ("" when none). */
  instructionText: string;
  /** Non-whitespace character count of {@link instructionText} — a proxy for substance. */
  instructionChars: number;
  /** Whether the instructions still carries the bootstrap skeleton's "fills this" marker. */
  instructionPlaceholder: boolean;
  /** Whether `[project].gotchas_doc` is set to a non-empty path. */
  gotchasDocSet: boolean;
  /** Whether the configured `[project].gotchas_doc` resolves to a real file. */
  gotchasDocExists: boolean;
  /** Whether the configured map tree has a `README.md`. */
  mapTree: boolean;
  /** Configured project-relative documentation root. */
  mapDir: string;
  /** Count of real ADRs under the configured map root's `_adr`. */
  adrCount: number;
  /** Whether at least one agent file (any configured provider's) exists. */
  agentFilePresent: boolean;
  /** Count of authored skill directories under `[skills].dir`. */
  authoredSkills: number;
  /** Ranked project-scope logbook findings. Advisory context: catalog rules
   * and scores never read them; the checkpoint graduation loop may cite one
   * as a recommendation's evidence, and a recommendation may lead the next
   * action — advice, never a gate. */
  historicalFindings?: PatternsFinding[];
  /** Checkpoints clearing the frequently-varied bar (the shared economics
   * predicate) — the evidence behind a checkpoint-review recommendation.
   * Advisory in exactly the {@link historicalFindings} sense. */
  variedCheckpoints?: CheckpointVarianceSummary[];
}

// ── the rule catalog shapes ─────────────────────────────────────────────────

/** How a deterministic rule turned out: fully met, partially met, or not met. A const
 * tuple so it is enumerable: the improve wire schema's `status` enum (`result_schemas.ts`,
 * a shared module that can't import this engine type) is tied back to it by a guard in
 * `improve_catalog_test.ts`, so the two can't drift. */
export const RULE_STATUSES = ["pass", "partial", "fail"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** A deterministic rule's verdict: a status and the finding behind it. */
export interface Verdict {
  status: RuleStatus;
  /** What was found, phrased for a human reading it next to their project. */
  detail: string;
}

/**
 * A best-practice rule discern decides itself. `weight` is its mass in the
 * weighted score; `fix` is the concrete remedy (a command or an edit); `teach`
 * explains why it matters and what "good" looks like.
 */
export interface DeterministicRule {
  kind: "deterministic";
  /** Stable slug, namespaced by category (e.g. `gate.test`). */
  id: string;
  title: string;
  weight: number;
  fix: string;
  teach: string;
  /** Decide the verdict from the gathered facts. Pure and synchronous. */
  evaluate(ctx: ImprovementContext): Verdict;
}

/** A pointer to the project material a subjective rule is judged against — what
 * the agent should actually read before answering. */
export interface ReviewEvidence {
  /** The file or config section to read (e.g. `instructions.md`, `[worktree.resources]`). */
  source: string;
  /** A short excerpt of it, or a note that it is absent/empty. */
  excerpt: string;
}

/**
 * A rule discern cannot decide mechanically: it surfaces the `ask` (the question)
 * and `against` (the material to weigh it against) for the agent to judge, with a
 * `teach` describing what good looks like and how to close the gap.
 */
export interface SubjectiveRule {
  kind: "subjective";
  id: string;
  title: string;
  ask: string;
  teach: string;
  /** Resolve the evidence to judge against, or undefined when there is none to cite. */
  against(ctx: ImprovementContext): ReviewEvidence | undefined;
}

/** A best-practice rule — decided by discern, or surfaced for the agent. */
export type Rule = DeterministicRule | SubjectiveRule;

/** A group of related rules. Every category is always reviewed — the subsystems
 * are all core (ADR 0101). */
export interface Category {
  /** Stable slug, used by `--category` (e.g. `gate`, `instructions`). */
  name: string;
  title: string;
  rules: Rule[];
  /** Extra review items derived from configuration at evaluation time — the
   * checkpoint estate audit builds its rows here. The static rules stay the
   * catalog's single source; a builder only projects config the owner wrote. */
  dynamicReviews?: (ctx: ImprovementContext) => ReviewResult[];
}

// ── the evaluated report (the JSON-friendly result payload) ─────────────────

/** One deterministic rule's evaluated result. */
export interface RuleResult {
  id: string;
  title: string;
  status: RuleStatus;
  weight: number;
  detail: string;
  /** Present only when the rule did not fully pass. */
  fix?: string;
  teach: string;
}

/** One boundary guard on a question: an active checkpoint serving it. */
export interface BoundaryGuard {
  /** The configured checkpoint id (`[checkpoints.<id>]`). */
  checkpoint: string;
  mode: CheckpointMode;
}

/** One open subjective review item for the agent to judge. A review whose
 * question an active configured checkpoint also serves carries that
 * `boundary` — the flow is guarded at the gate; the review audits the estate
 * (the stock of existing violations the boundary tolerates). */
export interface ReviewResult {
  id: string;
  title: string;
  ask: string;
  teach: string;
  against?: ReviewEvidence;
  boundary?: BoundaryGuard[];
}

/** A category's evaluated result. */
export interface CategoryResult {
  name: string;
  title: string;
  /** 0–100, weighted over this category's deterministic rules (100 when it has none). */
  score: number;
  /** Sum of this category's deterministic rule weights — its mass in the overall score. */
  weight: number;
  /** Count of deterministic rules that did not fully pass (fail or partial). */
  weak: number;
  rules: RuleResult[];
  reviews: ReviewResult[];
}

/** The next-action kinds. A const tuple so it is enumerable: the improve wire
 * schema's enum is tied back to it by a guard in `improve_catalog_test.ts`. */
export const NEXT_ACTION_KINDS = ["fix", "review", "decide"] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

/** The coach's one prioritized action. */
export interface NextAction {
  /** Fix an objective baseline gap, perform a qualitative review, or make an
   * evidence-backed owner decision (a checkpoint recommendation). */
  kind: NextActionKind;
  category: string;
  id: string;
  title: string;
  /** The concrete fix, question, or decision to act on now. */
  action: string;
  /** Why this practice matters and what good looks like. */
  why: string;
  /** The cited material travels with a qualitative review on every surface. */
  against?: ReviewEvidence;
}

/** The checkpoint recommendation kinds. A const tuple tied to the wire enum by
 * a guard in `improve_catalog_test.ts`. */
export const CHECKPOINT_RECOMMENDATION_IDS = [
  "checkpoints.review",
  "checkpoints.graduate",
] as const;
export type CheckpointRecommendationId =
  (typeof CHECKPOINT_RECOMMENDATION_IDS)[number];

/**
 * One evidence-backed owner decision the coach recommends — reviewing a
 * frequently-varied checkpoint, or graduating a recurring finding class into
 * one. `evidence` is REQUIRED: a recommendation without project-local counts
 * behind it is a generic exhortation, which the coach never issues. Advisory
 * by charter: the owner decides; nothing here gates a verb.
 */
export interface CheckpointRecommendation {
  id: CheckpointRecommendationId;
  /** What the decision is about: a checkpoint id, or a question id. */
  subject: string;
  title: string;
  /** The decision to make, phrased as the owner's. */
  action: string;
  /** The placement teaching behind it. */
  why: string;
  /** The project-local observation the recommendation stands on. */
  evidence: ReviewEvidence;
}

/** The whole improvement report, ranked weakest-first. */
export interface ImprovementReport {
  /** 0–100, weighted over every applicable deterministic rule (100 when none apply). */
  score: number;
  /** Total deterministic rules that did not fully pass. */
  weak: number;
  /** Total open subjective review items. */
  reviews: number;
  /** The highest-value improvement to make now. */
  nextAction: NextAction;
  /** Evidence-backed owner decisions from the checkpoint loop (may be empty). */
  recommendations: CheckpointRecommendation[];
  /** Categories, weakest score first. */
  categories: CategoryResult[];
}
