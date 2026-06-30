/**
 * The **improvement vocabulary** — the types `discern improve` is built on. An
 * improvement report combines a scored baseline of best-practice **rules** with
 * qualitative **reviews**, then points at the single highest-value next action.
 *
 * Two rule kinds, mirroring discern's split of labour (the binary is deterministic;
 * the agent is the intelligence):
 *   - a **deterministic** rule is decided in-process now — it reads the gathered
 *     {@link ImprovementContext} and returns a {@link RuleStatus}, a finding, a fix,
 *     and a teach. discern owns it end to end.
 *   - a **subjective** rule cannot be mechanically decided (does the guidance
 *     actually capture what an agent couldn't infer? do the docs still match the
 *     code?). discern can't run a model, so it does the next best thing: it surfaces
 *     the *question* plus the project material to judge it **against** ({@link
 *     ReviewEvidence}), and the agent in the loop renders the verdict. This is how a
 *     deterministic binary "analyses subjective rules against guidance".
 *
 * The catalog (categories + rules) lives in `rules.ts`; the runner that evaluates
 * it into an {@link ImprovementReport} and the renderings live in `improve.ts`.
 * This module is pure data + interfaces, so both depend on it without a cycle.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Feature } from "../../shared/features.ts";

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
  /** Whether at least one `[guidance].sources` file resolved on disk. */
  guidancePresent: boolean;
  /** The concatenated text of every resolved guidance source ("" when none). */
  guidanceText: string;
  /** Non-whitespace character count of {@link guidanceText} — a proxy for substance. */
  guidanceChars: number;
  /** Whether the guidance still carries the bootstrap skeleton's "fills this" marker. */
  guidancePlaceholder: boolean;
  /** Whether `[project].gotchas_doc` is set to a non-empty path. */
  gotchasDocSet: boolean;
  /** Whether the configured `[project].gotchas_doc` resolves to a real file. */
  gotchasDocExists: boolean;
  /** Whether a `docs/` tree with a `README.md` exists. */
  docsTree: boolean;
  /** Count of real ADRs under `docs/_adr` (a `NNNN-*.md`, excluding `0000-template`). */
  adrCount: number;
  /** Whether at least one compiled agent file (any configured provider's) exists. */
  agentFilePresent: boolean;
  /** Count of authored skill directories under `[skills].dir`. */
  authoredSkills: number;
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
  /** The file or config section to read (e.g. `guidance.md`, `[worktree.resources]`). */
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

/**
 * A group of related rules. When `feature` is set and that feature is OFF, the
 * whole category is skipped — a disabled subsystem's best practices don't apply
 * (the same "a disabled feature vanishes coherently" rule the rest of discern
 * follows).
 */
export interface Category {
  /** Stable slug, used by `--category` (e.g. `gate`, `guidance`). */
  name: string;
  title: string;
  /** Gate the whole category on a feature; omit for a core (always-reviewed) area. */
  feature?: Feature;
  rules: Rule[];
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

/** One open subjective review item for the agent to judge. */
export interface ReviewResult {
  id: string;
  title: string;
  ask: string;
  teach: string;
  against?: ReviewEvidence;
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

/** The coach's one prioritized action. */
export interface NextAction {
  /** Fix an objective baseline gap, or perform a qualitative review. */
  kind: "fix" | "review";
  category: string;
  id: string;
  title: string;
  /** The concrete fix or question to act on now. */
  action: string;
  /** Why this practice matters and what good looks like. */
  why: string;
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
  /** Categories, weakest score first. */
  categories: CategoryResult[];
}
