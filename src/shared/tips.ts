/**
 * The tip registry — the single module defining every tip the desk can show
 * (ADR 0234). A hint advises an agent inside a result envelope; a tip teaches
 * a human one thing discern can do, ambient at the desk. The two concepts
 * keep separate registries, separate registers, and separate delivery.
 *
 * Data only, on the hint registry's pattern (ADR 0172): entries are typed
 * templates over compiler-checked parameters, runnable commands are
 * interpolated as {@link CommandRef} tokens (never spelled as prose), and the
 * guards validate every quoted command against the live registry. No engine
 * imports — the desk's selection engine consumes this module, never the other
 * way around.
 *
 * {@link TIPS} array order is the curriculum: the authored order is a designed
 * onboarding sequence, not incidental file order. The selection engine walks
 * unseen tips in this order, so reordering entries reorders the teaching.
 *
 * The register addresses a beginner: command names stay in code spans, and
 * each concept takes a plain-language translation on first use. Tip strings
 * are shipped engine output — domain-neutral, self-contained, no internal
 * decision numbers.
 */

import {
  discernCommand,
  flag,
  positional,
  renderCommandRefsCli,
} from "./command_reference.ts";

/** Shared references for the commands tips cite. Each is one token rendered
 * per surface at delivery; a template interpolates it instead of spelling the
 * command as prose. */
const CMD = {
  status: discernCommand("status"),
  startNamed: discernCommand("start", flag("name", '"<task>"')),
  worktreeDrop: discernCommand(
    "worktree drop",
    positional("target", "<worktree>"),
  ),
  worktreePruneContained: discernCommand(
    "worktree prune",
    flag("contained"),
  ),
  patterns: discernCommand("patterns"),
  standards: discernCommand("standards"),
  update: discernCommand("update"),
  awaitGreen: discernCommand("await", flag("green", "<branch>")),
  couplingFile: discernCommand("coupling", positional("file", "<file>")),
} as const;

/**
 * When a tip is contextually relevant, as data — a closed vocabulary the
 * desk's pure evaluator interprets over the status survey plus the loaded
 * config it already holds. No predicate performs I/O. The evaluator's
 * exhaustive `switch` makes a new kind a compile error until it is handled.
 */
export type TipPredicate =
  /** No quality standards are configured. */
  | Readonly<{ kind: "standards-empty" }>
  /** Two or more efforts are in flight and none carries landing authority. */
  | Readonly<{ kind: "no-landing-authority" }>
  /** Some effort's branch is behind the trunk. */
  | Readonly<{ kind: "branch-behind-trunk" }>
  /** Some effort holds a clean, current proof ready for human review. */
  | Readonly<{ kind: "ready-to-review" }>
  /** Some effort's work is already contained in another live branch. */
  | Readonly<{ kind: "contained-worktree" }>
  /** At least `min` efforts are in flight. */
  | Readonly<{ kind: "fleet-min-size"; min: number }>;

/**
 * A data-only declaration of what observable action a shown tip invites,
 * mirroring `HintFollowThroughRule`'s pattern: the logbook reader interprets
 * these shapes, and no detector function or engine import lives here. The
 * reader measuring tip adoption lands separately; carrying the declaration on
 * entries now means it reads declarations, never a hand-kept table.
 */
export type TipFollowThroughRule = Readonly<{
  family: string;
  kind: "verb-run-after-tip";
  /** Verbs (display form) whose later run counts as adoption, any surface. */
  verbs: readonly string[];
}>;

/** One registered tip: a stable id, its relevance data, and a typed template. */
export interface TipDef<P = undefined> {
  /** Stable kebab-case identifier — the logbook, seen-state, and tests key on it. */
  readonly id: string;
  /** One-line relevance description shown in the generated inventory. */
  readonly when: string;
  /** Optional contextual-relevance declaration ({@link TipPredicate}). */
  readonly predicate?: TipPredicate;
  /**
   * The release whose upgrade should surface this tip. Entries newer than the
   * seen-state baseline render with a "New in \<version\>" prefix and rank
   * first among unseen tips. Must not exceed the current kit version: a fresh
   * install baselines at the current version, and a future-dated entry would
   * wrongly render as new there (the closed-set guard enforces this).
   */
  readonly since?: string;
  /**
   * Feature-canon node ids this tip teaches — the enrolment claim the canon's
   * discoverability guard consumes. Every id must resolve to a live node.
   */
  readonly features: readonly string[];
  /** Optional observable-adoption declaration for the advisory logbook reader. */
  readonly followThrough?: TipFollowThroughRule;
  /** Realistic placeholder parameters for validation and generated inventory. */
  readonly example: P;
  /** Renders the tip from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
}

/**
 * One registered tip with its parameter type erased — the registry's storage
 * shape. {@link defineTip} is the only constructor, so `example` always
 * matches the template's parameter type and {@link renderTipCli} can render
 * the self-consistent pair without re-proving it.
 */
export interface RegisteredTip {
  readonly id: string;
  readonly when: string;
  readonly predicate?: TipPredicate;
  readonly since?: string;
  readonly features: readonly string[];
  readonly followThrough?: TipFollowThroughRule;
  readonly example: unknown;
  readonly template: (params: never) => string;
}

/** Identity helper so an entry's parameter type is inferred at the definition. */
export function defineTip<P = undefined>(def: TipDef<P>): RegisteredTip {
  // The cast erases P for heterogeneous storage; the def itself was
  // compiler-checked as a matching template/example pair above.
  return def as unknown as RegisteredTip;
}

/** A tip's authored template text, reference tokens intact — what the
 * completeness guards scan around. `defineTip` is the only constructor, so
 * the example always matches the template's parameter type. */
export function authoredTipText(tip: RegisteredTip): string {
  return (tip.template as (params: unknown) => string)(tip.example);
}

/**
 * A tip's delivered text: the template rendered with its registered example
 * parameters, command references resolved to their CLI spelling. One render
 * authority for the desk and the generated inventory, so what the guards
 * validate is exactly what a person reads. Current entries are parameterless;
 * a live-context parameter source is a future extension, and until it exists
 * the example parameters are the only rendering.
 */
export function renderTipCli(tip: RegisteredTip): string {
  return renderCommandRefsCli(authoredTipText(tip));
}

/**
 * The registry, in curriculum order. Tips educate about capability and never
 * alarm about state: no entry may read as a warning about the current
 * project, and context makes a tip timely, not urgent. A tip is never the
 * only route to an action.
 */
export const TIPS: readonly RegisteredTip[] = [
  // ── Basics: find the desk, read the state, start isolated work. ──────────

  defineTip({
    id: "desk-is-home",
    when: "Evergreen — the curriculum opener.",
    features: ["desk", "tips"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["desk"],
    },
    example: undefined,
    template: (): string =>
      "Bare `discern` opens the desk, where you start tasks and supervise " +
      "their separate working copies. This line teaches one capability per " +
      "session.",
  }),

  defineTip({
    id: "status-orients-anywhere",
    when: "Evergreen — the second basics lesson.",
    features: ["status", "fleet"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["status"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.status} is a quick, read-only check of where you are, what ` +
      "changed, which checks would run, and every task in flight from the " +
      "main copy.",
  }),

  defineTip({
    id: "start-isolates-a-task",
    when: "Evergreen — the final basics lesson.",
    features: ["worktrees", "start"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["start"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.startNamed} gives one change its own working copy and line of ` +
      "saved work, keeping it away from other tasks and the main copy.",
  }),

  // ── Supervision: inspect, authorize, clean up, and update. ───────────────

  defineTip({
    id: "inspect-before-accepting",
    when: "A task has a passing proof ready for review.",
    predicate: { kind: "ready-to-review" },
    features: ["accept", "receipt"],
    example: undefined,
    template: (): string =>
      'Before accepting a task, choose "Inspect commits and changes" in the ' +
      "desk. It shows saved work, unsaved edits, the change size, and any " +
      "passing proof.",
  }),

  defineTip({
    id: "grant-once-green",
    when: "Two or more tasks are in flight and none is pre-authorized.",
    predicate: { kind: "no-landing-authority" },
    features: ["consent-attestations"],
    example: undefined,
    template: (): string =>
      'For a task you trust, "Pre-authorize landing once green" lets it land ' +
      "after every check passes. The permission belongs only to that task.",
  }),

  defineTip({
    id: "drop-protects-work",
    when: "At least one task is in flight.",
    predicate: { kind: "fleet-min-size", min: 1 },
    features: ["worktrees"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["worktree"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.worktreeDrop} refuses to discard unsaved or unshared work ` +
      "without force. The desk asks you to type the branch name before that " +
      "loss.",
  }),

  defineTip({
    id: "reclaim-keeps-recovery",
    when: "A working copy's saved work is contained in another live task.",
    predicate: { kind: "contained-worktree" },
    features: ["worktree-prune", "compose-below-trunk"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["worktree"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.worktreePruneContained} removes a working copy whose saved ` +
      "work already lives inside another task. Its branch stays for recovery.",
  }),

  defineTip({
    id: "update-before-review",
    when: "A task is behind the main shared version.",
    predicate: { kind: "branch-behind-trunk" },
    features: ["update"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["update"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.update} brings the main shared version into a task and names ` +
      "files both sides changed, so you know what to recheck before review.",
  }),

  // Seed lessons retained until their curriculum tranches expand below.

  defineTip({
    id: "patterns-practice-report",
    when: "Evergreen — the practice-health opener.",
    features: ["patterns"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["patterns"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.patterns} reads discern's local activity records and reports ` +
      `how the practice is going: which checks fail most often, how tasks ` +
      `move from start to landing, and how each quality number is trending. ` +
      `The report is read-only.`,
  }),

  defineTip({
    id: "standards-first-limit",
    when: "No quality standards are configured.",
    predicate: { kind: "standards-empty" },
    features: ["standards", "skill-set-the-standard"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["standards"],
    },
    example: undefined,
    template: (): string =>
      `A standard holds one number, like test coverage or bundle size, at a ` +
      `limit that can only improve. The bundled \`discern-set-the-standard\` ` +
      `skill walks a coding agent through choosing and setting the first one.`,
  }),

  defineTip({
    id: "coupling-cochange-history",
    when: "Evergreen — a power-tool lesson.",
    features: ["coupling"],
    example: undefined,
    template: (): string =>
      `Run ${CMD.couplingFile} to see which files usually change together ` +
      `with that one, learned from this project's own recent history.`,
  }),

  defineTip({
    id: "await-other-work",
    when: "Evergreen — a power-tool lesson.",
    features: ["await"],
    example: undefined,
    template: (): string =>
      `${CMD.awaitGreen} waits for another task's passing proof and returns ` +
      "the right next step, so a coding agent does not need to keep checking.",
  }),
];
