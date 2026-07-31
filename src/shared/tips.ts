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
  positional,
  renderCommandRefsCli,
} from "./command_reference.ts";

/** Shared references for the commands tips cite. Each is one token rendered
 * per surface at delivery; a template interpolates it instead of spelling the
 * command as prose. */
const CMD = {
  patterns: discernCommand("patterns"),
  update: discernCommand("update"),
  await: discernCommand("await"),
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

/**
 * A tip's delivered text: the template rendered with its registered example
 * parameters, command references resolved to their CLI spelling. One render
 * authority for the desk and the generated inventory, so what the guards
 * validate is exactly what a person reads. Current entries are parameterless;
 * a live-context parameter source is a future extension, and until it exists
 * the example parameters are the only rendering.
 */
export function renderTipCli(tip: RegisteredTip): string {
  return renderCommandRefsCli(
    (tip.template as (params: unknown) => string)(tip.example),
  );
}

/**
 * The registry, in curriculum order. Tips educate about capability and never
 * alarm about state: no entry may read as a warning about the current
 * project, and context makes a tip timely, not urgent. A tip is never the
 * only route to an action.
 */
export const TIPS: readonly RegisteredTip[] = [
  /** The curriculum opener: the practice mirror is the desk reader's own
   * next surface, and adoption is observable as a later `patterns` run. */
  defineTip({
    id: "patterns-practice-report",
    when: "Always applicable — the curriculum opener.",
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

  /** Contextual: the moment a project has no standards is the moment the
   * mechanism is worth one line. */
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
      `This project has no quality limits yet. A standard holds one number, ` +
      `like test coverage or bundle size, at a limit that can only improve. ` +
      `The bundled \`discern-set-the-standard\` skill walks an agent through ` +
      `choosing and setting the first one.`,
  }),

  /** Contextual: a fleet with nothing pre-authorized is the grant action's
   * teaching moment. */
  defineTip({
    id: "desk-grant-once-green",
    when: "Two or more efforts are in flight and none is pre-authorized.",
    predicate: { kind: "no-landing-authority" },
    features: ["desk"],
    example: undefined,
    template: (): string =>
      `The desk can let one task land on its own once every check passes: ` +
      `choose the task, then "Pre-authorize landing once green". Without a ` +
      `pre-authorization, a landing waits for your go-ahead.`,
  }),

  /** Contextual: a branch behind the trunk is the composition-verbs moment. */
  defineTip({
    id: "update-await-compose",
    when: "Some effort's branch is behind the trunk.",
    predicate: { kind: "branch-behind-trunk" },
    features: ["update", "await"],
    example: undefined,
    template: (): string =>
      `Each task works on its own copy of the project. ${CMD.update} brings ` +
      `the shared trunk's latest into a task, and ${CMD.await} lets an agent ` +
      `wait for another task's work instead of checking by hand.`,
  }),

  /** Tagged to the release that introduced history-mined coupling, so an
   * upgrade surfaces it with the "New in" prefix. */
  defineTip({
    id: "coupling-cochange-history",
    when: "Evergreen; tagged to the release that introduced coupling.",
    since: "1.0.0",
    features: ["coupling"],
    example: undefined,
    template: (): string =>
      `Run ${CMD.couplingFile} to see which files usually change together ` +
      `with that one, learned from this project's own recent history.`,
  }),
];
