/**
 * The tip registry — the single module defining every tip the Desk can show
 * (ADR 0234). A hint advises an agent inside a result envelope; a tip teaches
 * a human one thing discern can do, ambient at the Desk. The two concepts
 * keep separate registries, separate registers, and separate delivery.
 *
 * Data only, on the hint registry's pattern (ADR 0172): entries are typed
 * templates over compiler-checked parameters, runnable commands are
 * interpolated as {@link CommandRef} tokens (never spelled as prose), and the
 * guards validate every quoted command against the live registry. No engine
 * imports — the Desk's selection engine consumes this module, never the other
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
  prepare: discernCommand("prepare"),
  test: discernCommand("test"),
  tidy: discernCommand("tidy"),
  doneDryRun: discernCommand("done", flag("dry-run")),
  worktreeDrop: discernCommand(
    "worktree drop",
    positional("target", "<worktree>"),
  ),
  worktreePruneContained: discernCommand(
    "worktree prune",
    flag("contained"),
  ),
  patterns: discernCommand("patterns"),
  patternsStats: discernCommand("patterns", flag("stats")),
  improvement: discernCommand("improvement"),
  checkpoints: discernCommand("checkpoints"),
  doctor: discernCommand("doctor"),
  done: discernCommand("done"),
  standards: discernCommand("standards"),
  standardsPin: discernCommand("standards", flag("pin")),
  update: discernCommand("update"),
  impact: discernCommand("impact"),
  awaitGreen: discernCommand("await", flag("green", "<branch>")),
  couplingFile: discernCommand("coupling", positional("file", "<file>")),
  mapSearch: discernCommand("map", flag("search", "<query>")),
  docsSearch: discernCommand("docs", flag("search", "<query>")),
  skillsList: discernCommand("skills list"),
  identityPort: discernCommand("identity", flag("port")),
  configSet: discernCommand(
    "config set",
    positional("key", "<key>"),
    positional("value", "<value>"),
  ),
  refresh: discernCommand("refresh"),
  preset: discernCommand("preset", positional("name", "<name>")),
  upgradeCheck: discernCommand("upgrade", flag("check")),
  scripts: discernCommand("scripts"),
} as const;

/**
 * When a tip is contextually relevant, as data — a closed vocabulary the
 * Desk's pure evaluator interprets over the status survey plus the loaded
 * config it already holds. No predicate performs I/O. The evaluator's
 * exhaustive `switch` makes a new kind a compile error until it is handled.
 */
export type TipPredicate =
  /** No quality standards are configured. */
  | Readonly<{ kind: "standards-empty" }>
  /** At least one quality standard is configured. */
  | Readonly<{ kind: "standards-present" }>
  /** Two or more efforts are in flight and none carries landing authority. */
  | Readonly<{ kind: "no-landing-authority" }>
  /** Some effort's branch is behind the trunk. */
  | Readonly<{ kind: "branch-behind-trunk" }>
  /** Some effort holds clean, current Proof ready for human review. */
  | Readonly<{ kind: "ready-to-review" }>
  /** Some effort's work is already contained in another live branch. */
  | Readonly<{ kind: "contained-worktree" }>
  /** At least `min` efforts are in flight. */
  | Readonly<{ kind: "fleet-min-size"; min: number }>;

/**
 * A data-only declaration of what observable action a shown tip invites,
 * mirroring `HintFollowThroughRule`'s pattern: the Logbook reader interprets
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
  /** Stable kebab-case identifier — the Logbook, seen-state, and tests key on it. */
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
  /** Optional observable-adoption declaration for the advisory Logbook reader. */
  readonly followThrough?: TipFollowThroughRule;
  /** Realistic placeholder parameters for validation and generated inventory. */
  readonly example: P;
  /** Renders the tip from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
}

/**
 * Maximum CLI-rendered tip length. At the Desk's ordinary 60–80-column
 * widths, 160 characters wraps to two or three lines; anything longer is two
 * lessons or belongs in the Map.
 */
export const TIP_RENDERED_LENGTH_LIMIT = 160;

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
 * authority for the Desk and the generated inventory, so what the guards
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
  // ── Basics: find the Desk, read the state, start isolated work. ──────────

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
      "Bare `discern` opens the human view over work in progress (the Desk). " +
      "Start tasks, supervise them, and read one short tip there.",
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
      `${CMD.startNamed} gives one task an isolated workspace (a Git ` +
      "worktree) and branch, separate from other tasks and the main copy.",
  }),

  // ── Daily loop: get fast feedback before the final Proof. ───────────────

  defineTip({
    id: "prepare-fast-feedback",
    when: "Evergreen — the daily loop opener.",
    features: ["prepare"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["prepare"],
    },
    example: undefined,
    template: (): string =>
      `Use ${CMD.prepare} while editing a change. It runs fixers and ` +
      "read-only checks; builds and tests stay for later.",
  }),

  defineTip({
    id: "test-runs-alone",
    when: "Evergreen — a daily loop lesson.",
    features: ["test-verb"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["test"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.test} runs the project's configured tests and quick readiness ` +
      "check, separate from the final quality check.",
  }),

  defineTip({
    id: "tidy-discern-files",
    when: "Evergreen — a daily loop lesson.",
    features: ["tidy"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["tidy"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.tidy} formats discern's Markdown sources and ` +
      "`discern.toml`; add `--dry-run` to list changes without writing.",
  }),

  // ── Supervision: inspect, authorize, clean up, and update. ───────────────

  defineTip({
    id: "inspect-before-accepting",
    when: "A task has passing Proof ready for review.",
    predicate: { kind: "ready-to-review" },
    features: ["accept", "proof"],
    example: undefined,
    template: (): string =>
      'Before accepting, choose "Inspect commits and changes" in the Desk. ' +
      "It shows saved and unsaved work, size, and Proof that the exact " +
      "version passed its checks.",
  }),

  defineTip({
    id: "grant-once-green",
    when: "Two or more tasks are in flight and none is pre-authorized.",
    predicate: { kind: "no-landing-authority" },
    features: ["consent-attestations"],
    example: undefined,
    template: (): string =>
      '"Pre-authorize landing once green" records permission for one task to ' +
      "land after every check passes. It applies only to that task.",
  }),

  defineTip({
    id: "drop-protects-work",
    when: "At least one task is in flight.",
    predicate: { kind: "fleet-min-size", min: 1 },
    features: ["worktrees", "drop-recovery"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["worktree"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.worktreeDrop} keeps a local recovery ref for committed work ` +
      "before removing a branch. Force can still destroy every unsaved byte.",
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

  defineTip({
    id: "dry-run-previews-writes",
    when: "Evergreen — the final supervision lesson.",
    features: ["plan-apply"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["done"],
    },
    example: undefined,
    template: (): string =>
      `Commands such as ${CMD.doneDryRun} show their plan without changing ` +
      "the project. Look for `--dry-run` before an unfamiliar write.",
  }),

  // ── Practice health: read the record, then choose the next improvement. ──

  defineTip({
    id: "patterns-practice-report",
    when: "Evergreen — the practice-health opener.",
    features: ["insight", "logbook", "patterns", "local-evidence"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["patterns"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.patterns} reads the project's local activity record for ` +
      "repeated habits, slow checks, and tasks that stall. It suggests one " +
      "next step.",
  }),

  defineTip({
    id: "patterns-practice-stats",
    when: "Evergreen — the second practice-health lesson.",
    features: ["patterns"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["patterns"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.patternsStats} counts finished changes, passing streaks, time ` +
      "from start to landing, and quality gains from the same local record.",
  }),

  defineTip({
    id: "improvement-next-action",
    when: "Evergreen — the third practice-health lesson.",
    features: ["improvement"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["improvement"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.improvement} ranks one next improvement across checks, setup, ` +
      "guides, task copies, quality rules, and reusable playbooks.",
  }),

  defineTip({
    id: "doctor-first-diagnostic",
    when: "Evergreen — the final practice-health lesson.",
    features: ["doctor"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["doctor"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.doctor} checks whether the install is wired correctly and ` +
      "names the fix for each problem. Start there when a discern command " +
      "behaves oddly.",
  }),

  // ── Quality: prove the work, then learn the rules that hold gains. ───────

  defineTip({
    id: "done-records-proof",
    when: "Evergreen — the quality opener.",
    features: ["gate", "proof"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["done"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.done} runs the project's final quality check. On clean saved ` +
      "work, a pass records Proof for the exact version and declared results.",
  }),

  defineTip({
    id: "checkpoints-read-surface",
    when: "Evergreen — the second quality lesson.",
    features: ["checkpoints"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["checkpoints"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.checkpoints} shows which judgment stops govern this task, each ` +
      "recorded answer, and what the change in hand would set off. Read-only.",
  }),

  defineTip({
    id: "standards-first-rule",
    when: "No quality rules are configured.",
    predicate: { kind: "standards-empty" },
    features: ["standards", "standards-direction", "skill-set-the-standard"],
    example: undefined,
    template: (): string =>
      "A Standard is a quality measure that can only improve. " +
      "`discern-set-the-standard` helps a coding agent set its floor or ceiling.",
  }),

  defineTip({
    id: "standards-on-demand",
    when: "Evergreen — the third quality lesson.",
    features: ["standards-on-demand"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["standards"],
    },
    example: undefined,
    template: (): string =>
      'Rules marked `measure = "on-demand"` skip routine measurement; ' +
      `${CMD.standards} measures them when you ask.`,
  }),

  defineTip({
    id: "standards-pin-gain",
    when: "At least one quality rule is configured.",
    predicate: { kind: "standards-present" },
    features: ["standards-pin", "standards-margin"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["standards"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.standardsPin} saves a measured gain by tightening the limit. ` +
      "A `margin` leaves room for small future changes.",
  }),

  // ── Project upkeep: edit settings, rebuild outputs, and leave safely. ────

  defineTip({
    id: "config-validates-edits",
    when: "Evergreen — the project-upkeep opener.",
    features: ["config-command"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["config"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.configSet} edits ` +
      "`discern.toml` without losing comments and validates the full file " +
      "before writing.",
  }),

  defineTip({
    id: "refresh-publishes-instructions",
    when: "Evergreen — a project-upkeep lesson.",
    features: [
      "instructions",
      "instructions-compile",
      "skills-materialization",
    ],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["refresh"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.refresh} compiles shared instructions into every configured coding ` +
      "agent's instruction file and republishes reusable guides from their " +
      "sources.",
  }),

  defineTip({
    id: "preset-keeps-project-values",
    when: "Evergreen — a project-upkeep lesson.",
    features: ["presets"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["preset"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.preset} adds a reusable set of starter files and settings. ` +
      "Values already present in the project stay unchanged.",
  }),

  defineTip({
    id: "upgrade-check-only",
    when: "Evergreen — a project-upkeep lesson.",
    features: ["upgrade"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["upgrade"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.upgradeCheck} reports whether this project has pending settings ` +
      "updates. It changes nothing.",
  }),

  defineTip({
    id: "one-file-settings",
    when: "Evergreen — a project-structure lesson.",
    features: ["one-file-footprint"],
    example: undefined,
    template: (): string =>
      "`discern.toml` holds all project-specific discern settings. Everything " +
      "else is bundled, placed through those settings, or generated from " +
      "text you can review.",
  }),

  defineTip({
    id: "no-model-any-language",
    when: "Evergreen — a project-structure lesson.",
    features: ["no-model-inside", "stack-neutral"],
    example: undefined,
    template: (): string =>
      "discern contains no language model and requires no model-service " +
      "credentials. It runs the commands your project declares, in any language.",
  }),

  // ── Power tools: explore wider surfaces after the core loop is familiar. ─

  defineTip({
    id: "coupling-missing-partners",
    when: "Evergreen — a power-tool lesson.",
    features: ["coupling"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["coupling"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.couplingFile} spots files that usually change with the named ` +
      "file but are missing from the current work. It reads only this " +
      "project's history.",
  }),

  defineTip({
    id: "impact-extra-checks",
    when: "Evergreen — a power-tool lesson.",
    features: ["impact", "scope-gates"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["impact"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.impact} shows which named project areas and extra checks the ` +
      "current change activates.",
  }),

  defineTip({
    id: "await-other-work",
    when: "Evergreen — a power-tool lesson.",
    features: ["await", "compose-below-trunk"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["await"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.awaitGreen} waits for another task's passing Proof and returns ` +
      "the right next step, so a coding agent does not need to keep checking.",
  }),

  defineTip({
    id: "map-and-docs-search",
    when: "Evergreen — a power-tool lesson.",
    features: ["map", "map-browser", "discovery-funnel", "bundled-docs"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["map", "docs"],
    },
    example: undefined,
    template: (): string =>
      `Use ${CMD.mapSearch} to search this project's guide. Use ` +
      `${CMD.docsSearch} for discern's own manual.`,
  }),

  defineTip({
    id: "skills-effective-set",
    when: "Evergreen — a power-tool lesson.",
    features: ["skills", "skills-curation"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["skills"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.skillsList} shows the reusable guides available to coding ` +
      "agents, including project replacements and hidden guides.",
  }),

  // ── Reusable guides: give specialized work its full procedure. ─────────

  defineTip({
    id: "cure-the-bug-class",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-cure-a-bug"],
    example: undefined,
    template: (): string =>
      "`discern-cure-a-bug` guides a coding agent to prove the cause, fix " +
      "every occurrence, and add a check that catches the defect if it " +
      "returns.",
  }),

  defineTip({
    id: "clear-agent-leftovers",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-clear-the-decks"],
    example: undefined,
    template: (): string =>
      "`discern-clear-the-decks` guides a coding agent to remove unused code, " +
      "repeated helpers, and leftovers from abandoned approaches in small " +
      "safe commits.",
  }),

  defineTip({
    id: "write-a-fact-once",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-write-it-once"],
    example: undefined,
    template: (): string =>
      "`discern-write-it-once` helps a coding agent store each fact once, " +
      "include future additions automatically, and preview changes before " +
      "running them.",
  }),

  defineTip({
    id: "document-from-the-code",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-document-subsystem"],
    example: undefined,
    template: (): string =>
      "`discern-document-subsystem` has a coding agent rebuild one part of " +
      "the project guide from the code and verify every claim.",
  }),

  defineTip({
    id: "teach-the-next-agent",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-teach-the-project"],
    example: undefined,
    template: (): string =>
      "`discern-teach-the-project` records a durable lesson in project " +
      "instructions, a reusable guide, a script, documentation, or a decision " +
      "record.",
  }),

  defineTip({
    id: "record-a-decision",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-write-adr"],
    example: undefined,
    template: (): string =>
      "`discern-write-adr` records a significant choice, its reasons, and its " +
      "trade-offs where future coding agents can find it.",
  }),

  defineTip({
    id: "delegate-with-a-complete-brief",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-delegate-work"],
    example: undefined,
    template: (): string =>
      "`discern-delegate-work` turns a discussed task into a complete brief " +
      "for a fresh coding agent, then reviews the resulting change.",
  }),

  defineTip({
    id: "await-with-one-call",
    when: "Evergreen — a reusable guide lesson.",
    features: ["skill-await-the-fleet"],
    example: undefined,
    template: (): string =>
      "`discern-await-the-fleet` guides a coding agent to wait for another " +
      "task with one bounded call, then build on what arrives.",
  }),

  defineTip({
    id: "place-a-checkpoint",
    when: "Evergreen — the final reusable guide lesson.",
    features: ["skill-place-a-checkpoint"],
    example: undefined,
    template: (): string =>
      "`discern-place-a-checkpoint` turns a point a reviewer keeps raising " +
      "into a change-triggered judgment the final quality check serves " +
      "and records.",
  }),

  defineTip({
    id: "identity-stable-values",
    when: "Evergreen — a power-tool lesson.",
    features: ["worktree-identity"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["identity"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.identityPort} prints the stable network number used by that ` +
      "task's preview server. Other choices show its branch and service names.",
  }),

  defineTip({
    id: "resources-follow-the-copy",
    when: "Evergreen — a power-tool lesson.",
    features: ["worktree-resources"],
    example: undefined,
    template: (): string =>
      "A project can give every worktree its own information store, emulator, or " +
      "container. discern provisions and removes them with the worktree.",
  }),

  defineTip({
    id: "scripts-from-desk",
    when: "Evergreen — the curriculum closer.",
    features: ["project-scripts"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["scripts"],
    },
    example: undefined,
    template: (): string =>
      'When a task has a project-owned tool, the Desk offers "Run a Project ' +
      `Script". ${CMD.scripts} lists the same tools from a shell.`,
  }),
];

/**
 * Canon and verb members with no Desk tip by design.
 *
 * Keys share one namespace with the enrolment guard: `feature:<node-id>` for
 * every feature-canon node and `verb:<verb>` for the live CLI vocabulary.
 * The reason is part of the contract. A member may stay dark only when a
 * maintainer has recorded where it is taught instead or why it is not a
 * beginner-facing capability.
 */
export const TIP_COVERAGE_DELIBERATELY_ABSENT: Readonly<
  Record<string, string>
> = {
  "feature:jobs-table":
    "The Gate guide documents project-specific job setup; the `done` tip teaches the final check those jobs serve.",
  "feature:job-format":
    "Projects author this Gate job in config; the `done` tip teaches the combined final check.",
  "feature:job-build":
    "Projects author this Gate job in config; the `done` tip teaches the combined final check.",
  "feature:job-lint":
    "Projects author this Gate job in config; the `done` tip teaches the combined final check.",
  "feature:job-typecheck":
    "Projects author this Gate job in config; the `done` tip teaches the combined final check.",
  "feature:job-test":
    "Projects author this Gate job in config; the `done` tip teaches the combined final check.",
  "feature:job-smoke":
    "Projects author this Gate job in config; the `done` tip teaches the combined final check.",
  "feature:staged-pipeline":
    "The `done` tip teaches the human-visible result of this Gate execution sequence.",
  "feature:fail-fast":
    "Gate failures explain this execution rule at the point it matters.",
  "feature:job-timeouts":
    "Timeout diagnostics explain this Gate safety rule when it fires.",
  "feature:capture-environment":
    "This internal diagnostic record preserves failure context; diagnostics provide the human action.",
  "feature:gate-streaming":
    "This output behavior keeps long Gate checks visible; it adds no separate Desk action.",
  "feature:strand-detection":
    "Its diagnostic teaches recovery when this Gate safety check fires.",
  "feature:gate-preconditions":
    "Each precondition diagnostic supplies the required remedy when it fails.",
  "feature:write-preflight":
    "This internal safety check supplies its action only when it detects a problem.",
  "feature:fail-open-classification":
    "This internal rule treats unmatched paths as real changes; the Gate guide documents scope configuration.",
  "feature:generated-artifact-declarations":
    "The config reference teaches this advanced generated-artifact authoring choice.",
  "feature:diagnostics":
    "Each diagnostic supplies its action at failure time, when it is relevant.",
  "feature:gotchas-pointer":
    "The failure that needs the troubleshooting pointer supplies it directly.",
  "feature:proof-notes":
    "Acceptance writes the durable note automatically and `status` surfaces the landed evidence; no separate Desk action exists to teach.",
  "feature:unchanged-tree-rerun":
    "The Proof tip covers the review result; reuse remains an internal optimization.",
  "feature:checkpoint-ci-report":
    "The checkpoint reference documents this report-only continuous-integration mode; it adds no Desk action.",
  "feature:checkpoint-drops":
    "This internal evidence record preserves an unenforced judgment rule; the Proof and status surfaces provide the human account.",
  "feature:checkpoint-question-files":
    "The checkpoint Skill and reference teach this advanced project-authoring choice; it adds no Desk action.",
  "feature:standards-metric-protocol":
    "The standard-setting Skill teaches this advanced metric-authoring path.",
  "feature:standards-rates":
    "The standard-setting Skill teaches rate-based quality-rule authoring.",
  "feature:standards-replay":
    "This measurement optimization reuses recorded values; the Standard tip covers the user-visible rule.",
  "feature:standards-escalation":
    "A fired Standard names the owner decision at the point it is required.",
  "feature:crash-safe-provisioning":
    "Provisioning failures carry the recovery action for this Worktree safety mechanism.",
  "feature:env-inheritance":
    "Setup configures private-setting inheritance; routine Desk use requires no separate action.",
  "feature:ignored-drift":
    "A Worktree check teaches this advanced diagnostic when it detects ignored-file drift.",
  "feature:instructions-conditionals":
    "The Map documents this advanced instruction-authoring feature.",
  "feature:providers":
    "The agent-integration reference documents provider support; the Desk exposes actions for active tasks.",
  "feature:provider-claude-code":
    "The agent-integration reference documents this provider; its integration adds no Desk action.",
  "feature:provider-codex":
    "The agent-integration reference documents this provider; its integration adds no Desk action.",
  "feature:provider-gemini":
    "The agent-integration reference documents this provider; its integration adds no Desk action.",
  "feature:provider-cursor":
    "The agent-integration reference documents this provider; its integration adds no Desk action.",
  "feature:provider-copilot":
    "The agent-integration reference documents this provider; its integration adds no Desk action.",
  "feature:session-hooks":
    "Setup documentation owns session-hook integration and reactivation steps.",
  "feature:agent-autodetect":
    "Setup selects the provider automatically and reports the choice; routine Desk use requires no action.",
  "feature:docs-integrity":
    "A failed Map validation names the page and repair.",
  "feature:map-freshness":
    "The Gate enforces this maintainer rule and names stale Map pages.",
  "feature:publish-predicate":
    "The Map documentation owns publication boundaries and their maintainer action.",
  "feature:adr-discipline":
    "The `discern-write-adr` Skill teaches decision-record authoring.",
  "feature:cli-help":
    "Each command displays its own built-in help, making a rotating lesson redundant.",
  "feature:glossary-canon":
    "The glossary and generated references own canonical vocabulary.",
  "feature:hints": "Each hint appears with the action that makes it relevant.",
  "feature:install":
    "The installer teaches installation before the Desk becomes available.",
  "feature:setup":
    "The installer teaches setup before the Desk becomes available.",
  "feature:setup-observability":
    "Setup displays these operational reports while it runs.",
  "feature:relay-messages":
    "Relay messages coordinate coding agents; human actions arrive through the Desk.",
  "feature:ownership-buckets":
    "Upgrade explains ownership buckets when a migration needs them.",
  "feature:placement-consent":
    "Initial setup asks for script-placement consent when the choice is required.",
  "feature:uninstall":
    "Explicit command help documents uninstall; the onboarding curriculum covers continued use.",
  "feature:licenses":
    "The legal reference and command help own license output.",
  "feature:interfaces":
    "Machine interfaces serve integrations and coding agents; the Desk owns human actions.",
  "feature:result-envelope":
    "The integration reference documents the result envelope for machine consumers.",
  "feature:idempotent-verbs":
    "This Engine guarantee makes safe retries possible; each command describes its own rerun behavior.",
  "feature:mcp-surface":
    "The Model Context Protocol (MCP) is an agent integration surface; the Desk owns human actions.",
  "feature:published-contracts":
    "The reference documents published schemas for integrations.",
  "feature:authored-markdown-results":
    "This result projection serves coding-agent and command-line consumers; the Desk renders its own human-facing dashboard.",
  "feature:failure-recovery-contract":
    "Each failure supplies its truthful recovery when it occurs; the contract itself adds no separate Desk action.",
  "feature:forgiving-cli":
    "This command-line parser behavior normalizes input; each command tip teaches the resulting action.",
  "feature:output-discipline":
    "This Engine contract governs result rendering; individual tips teach human actions.",
  "feature:foundations":
    "Product principles explain discern's design; concrete actions appear with their features.",
  "feature:agent-is-user":
    "This design principle governs coding-agent interfaces; the agent reference documents it.",
  "feature:context-budget":
    "This design principle governs coding-agent context; the agent reference documents it.",
  "feature:single-binary":
    "The install and architecture references document this packaging property.",
  "feature:all-subsystems-core":
    "This product-shape decision defines the shipped subsystem set; concrete actions appear with each subsystem.",
  "feature:forcing-functions":
    "Guards enforce this engineering principle; their diagnostics provide the action.",
  "feature:canonical-sets":
    "The contributor reference documents this maintainer infrastructure for closed sets.",
  "feature:dogfooding":
    "Running discern on itself supplies product evidence; user actions appear with their concrete features.",
  "feature:interruption-safety":
    "The Engine applies this cleanup guarantee when a command stops and reports any recovery action.",
  "feature:bounded-status-projection":
    "The status tip teaches the human current-state action; bounding is a structured-consumer context guarantee.",
  "feature:owner-attention":
    "Status and the Desk present owner attention when it exists, so it needs no separate rotating lesson.",
  "feature:patterns-investigations":
    "The patterns tip teaches the human action; investigation synthesis is part of that result rather than a separate Desk control.",
  "verb:help":
    "Each command displays its own help, making a rotating lesson redundant.",
  "verb:licenses": "The legal reference and command help own license output.",
  "verb:mcp":
    "MCP hosts the agent integration surface; the Desk owns human actions.",
  "verb:setup":
    "The installer teaches setup before the Desk becomes available.",
  "verb:triangle":
    "The command is intentionally enigmatic and omitted from the curriculum.",
  "verb:uninstall":
    "Explicit command help documents uninstall; the onboarding curriculum covers continued use.",
};
