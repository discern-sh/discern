/**
 * The **audit vocabulary** — the types `discern audit` is built on. An audit is a
 * checklist of best-practice **rules** grouped into **categories**, scored and
 * ranked weakest-first so a project can see where it is thinnest and an agent can
 * act on it.
 *
 * Two rule kinds, mirroring discern's split of labour (the binary is deterministic;
 * the agent is the intelligence):
 *   - a **deterministic** rule is decided in-process now — it reads the gathered
 *     {@link AuditContext} and returns a {@link RuleStatus}, a finding, a fix, and a
 *     teach. discern owns it end to end.
 *   - a **subjective** rule cannot be mechanically decided (does the guidance
 *     actually capture what an agent couldn't infer? do the docs still match the
 *     code?). discern can't run a model, so it does the next best thing: it surfaces
 *     the *question* plus the project material to judge it **against** ({@link
 *     AuditEvidence}), and the agent in the loop renders the verdict. This is how a
 *     deterministic binary "analyses subjective rules against guidance".
 *
 * The catalog (categories + rules) lives in `rules.ts`; the runner that evaluates
 * it into a {@link AuditReport} and the renderings live in `audit.ts`. This module
 * is pure data + interfaces, so both depend on it without a cycle.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Feature } from "../../shared/features.ts";

// ── the gathered facts a rule reads ─────────────────────────────────────────

/**
 * The project facts an audit rule reasons over, gathered ONCE (config + a handful
 * of filesystem probes) so every rule's `evaluate`/`against` stays a pure, sync
 * function of this context. Built by `buildContext` in `rules.ts`.
 */
export interface AuditContext {
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

/** How a deterministic rule turned out: fully met, partially met, or not met. */
export type RuleStatus = "pass" | "partial" | "fail";

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
  evaluate(ctx: AuditContext): Verdict;
}

/** A pointer to the project material a subjective rule is judged against — what
 * the agent should actually read before answering. */
export interface AuditEvidence {
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
  against(ctx: AuditContext): AuditEvidence | undefined;
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
  /** Gate the whole category on a feature; omit for a core (always-audited) area. */
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
  against?: AuditEvidence;
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

/** The whole audit, ranked weakest-first. */
export interface AuditReport {
  /** 0–100, weighted over every applicable deterministic rule (100 when none apply). */
  score: number;
  /** Total deterministic rules that did not fully pass. */
  weak: number;
  /** Total open subjective review items. */
  reviews: number;
  /** Categories, weakest score first. */
  categories: CategoryResult[];
}
