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
  uninstallDryRun: discernCommand("uninstall", flag("dry-run")),
  scripts: discernCommand("scripts"),
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
  /** At least one quality standard is configured. */
  | Readonly<{ kind: "standards-present" }>
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
 * Maximum CLI-rendered tip length. At the desk's ordinary 60–80-column
 * widths, 160 characters wraps to two or three lines; anything longer is two
 * lessons or belongs in the map.
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

  // ── Daily loop: get fast feedback before the final proof. ───────────────

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
      `Use ${CMD.prepare} while a change is moving. It runs fixers and ` +
      "read-only checks, skipping builds and tests.",
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
      "check outside the full final check.",
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
    features: ["gate", "receipt"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["done"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.done} runs the project's final quality check. On clean saved ` +
      "work, a pass records the exact version and results for review.",
  }),

  defineTip({
    id: "standards-first-rule",
    when: "No quality standards are configured.",
    predicate: { kind: "standards-empty" },
    features: ["standards", "standards-direction", "skill-set-the-standard"],
    example: undefined,
    template: (): string =>
      "A quality rule holds one number at a floor or ceiling that can only " +
      "improve. The `discern-set-the-standard` guide helps a coding agent " +
      "add one.",
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
    when: "At least one quality standard is configured.",
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
    id: "refresh-publishes-guidance",
    when: "Evergreen — a project-upkeep lesson.",
    features: ["guidance", "guidance-compile", "skills-materialization"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["refresh"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.refresh} compiles shared guidance into every configured coding ` +
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
    id: "uninstall-preserves-sources",
    when: "Evergreen — a project-upkeep lesson.",
    features: ["uninstall"],
    followThrough: {
      family: "tip-adoption",
      kind: "verb-run-after-tip",
      verbs: ["uninstall"],
    },
    example: undefined,
    template: (): string =>
      `${CMD.uninstallDryRun} previews what discern would remove and keep. ` +
      "Applying it keeps `discern.toml`, project guidance, and the project " +
      "guide.",
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
      "discern contains no AI model and needs no API key. It runs the commands " +
      "your project declares, in any language.",
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
      "current change wakes.",
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
      `${CMD.awaitGreen} waits for another task's passing proof and returns ` +
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
      "`discern-teach-the-project` records a hard-won lesson in project " +
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
    when: "Evergreen — the final reusable guide lesson.",
    features: ["skill-delegate-work"],
    example: undefined,
    template: (): string =>
      "`discern-delegate-work` turns a discussed task into a complete brief " +
      "for a fresh coding agent, then reviews what comes back.",
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
      `${CMD.identityPort} prints a task's stable preview-server network ` +
      "number. Other choices expose its branch and service names.",
  }),

  defineTip({
    id: "resources-follow-the-copy",
    when: "Evergreen — a power-tool lesson.",
    features: ["worktree-resources"],
    example: undefined,
    template: (): string =>
      "A project can give every working copy its own information store, " +
      "emulator, or container. discern creates and removes them with the copy.",
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
      'When a task has a project-owned tool, the desk offers "Run a Project ' +
      `Script". ${CMD.scripts} lists the same tools from a shell.`,
  }),
];

/**
 * Canon and verb members that deliberately receive no desk tip.
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
    "Project-specific job setup belongs in the gate guide; the tip teaches the final check those jobs serve.",
  "feature:job-format":
    "A project authors this gate job; it is not a separate discern capability for a beginner to adopt.",
  "feature:job-build":
    "A project authors this gate job; it is not a separate discern capability for a beginner to adopt.",
  "feature:job-lint":
    "A project authors this gate job; it is not a separate discern capability for a beginner to adopt.",
  "feature:job-typecheck":
    "A project authors this gate job; it is not a separate discern capability for a beginner to adopt.",
  "feature:job-test":
    "A project authors this gate job; it is not a separate discern capability for a beginner to adopt.",
  "feature:job-smoke":
    "A project authors this gate job; it is not a separate discern capability for a beginner to adopt.",
  "feature:staged-pipeline":
    "This is gate execution plumbing; the `done` tip teaches its human-visible outcome.",
  "feature:fail-fast":
    "This is gate execution plumbing; a failure explains the behavior at the point it matters.",
  "feature:job-timeouts":
    "This is gate safety plumbing; timeout diagnostics teach it at the point it matters.",
  "feature:capture-environment":
    "This preserves diagnostic context internally and offers no separate human action.",
  "feature:gate-streaming":
    "This is output plumbing for long checks, not a separate capability to adopt.",
  "feature:strand-detection":
    "This is gate safety plumbing; its diagnostic teaches the recovery when it fires.",
  "feature:gate-preconditions":
    "These are safety checks; their diagnostics teach the required remedy when they fail.",
  "feature:write-preflight":
    "This is an internal safety check with no separate beginner action.",
  "feature:fail-open-classification":
    "This is internal scope-classification safety with no separate human action.",
  "feature:diagnostics":
    "Diagnostics teach themselves at the point of failure instead of occupying a rotating tip.",
  "feature:gotchas-pointer":
    "The pointer appears in the failure that needs it, so a rotating tip would be less timely.",
  "feature:unchanged-tree-rerun":
    "This is receipt-reuse plumbing; the proof tip covers the human-visible result.",
  "feature:standards-metric-protocol":
    "Metric authoring is an advanced path taught by the standard-setting guide.",
  "feature:standards-rates":
    "Rate-based quality rules are an advanced authoring choice taught by the standard-setting guide.",
  "feature:standards-replay":
    "Replay is measurement plumbing with no separate beginner action.",
  "feature:standards-escalation":
    "A fired rule explains owner escalation at the point a decision is required.",
  "feature:crash-safe-provisioning":
    "This is worktree safety plumbing; recovery guidance appears when provisioning fails.",
  "feature:env-inheritance":
    "Private-setting inheritance is setup plumbing with no routine human action.",
  "feature:ignored-drift":
    "Ignored-file drift is an advanced diagnostic taught when a worktree check finds it.",
  "feature:guidance-conditionals":
    "Provider conditions are an advanced guidance-authoring feature documented in the map.",
  "feature:providers":
    "Provider support is an integration surface for coding agents, not a desk capability.",
  "feature:provider-claude-code":
    "This is an agent-provider integration, not a human desk capability.",
  "feature:provider-codex":
    "This is an agent-provider integration, not a human desk capability.",
  "feature:provider-gemini":
    "This is an agent-provider integration, not a human desk capability.",
  "feature:provider-cursor":
    "This is an agent-provider integration, not a human desk capability.",
  "feature:provider-copilot":
    "This is an agent-provider integration, not a human desk capability.",
  "feature:session-hooks":
    "Session hooks are agent-integration plumbing and are documented with setup.",
  "feature:agent-autodetect":
    "Automatic provider choice is agent-integration plumbing with no human action.",
  "feature:docs-integrity":
    "This is map validation plumbing; a failure names the page and repair.",
  "feature:map-freshness":
    "This is a maintainer rule enforced by the gate, not a beginner desk action.",
  "feature:publish-predicate":
    "Map publication boundaries are maintainer-facing and documented with the map.",
  "feature:adr-discipline":
    "Decision-record authoring is a maintainer practice taught by its specialist guide.",
  "feature:cli-help":
    "Built-in command help is already present beside every command and needs no rotating lesson.",
  "feature:glossary-canon":
    "Canonical vocabulary is documentation infrastructure, not a capability to adopt.",
  "feature:hints":
    "Advice notes surface at their relevant action; a generic rotating tip would be less timely.",
  "feature:install":
    "Installation is complete before the desk can show tips and is taught by the installer.",
  "feature:setup":
    "Setup is complete before the desk can show tips and is taught by the installer.",
  "feature:setup-observability":
    "This is installer reporting plumbing, visible during setup rather than later on the desk.",
  "feature:relay-messages":
    "Relay messages coordinate coding agents and do not expose a human action.",
  "feature:ownership-buckets":
    "Upgrade ownership is migration plumbing, explained only when an upgrade needs it.",
  "feature:placement-consent":
    "Script placement consent belongs to initial setup and appears when the choice is required.",
  "feature:licenses":
    "License output is a legal reference surface, not an onboarding capability.",
  "feature:interfaces":
    "Machine interfaces serve integrations and coding agents, not the human desk.",
  "feature:result-envelope":
    "The result shape is an integration contract, not a human action.",
  "feature:idempotent-verbs":
    "Safe replay is an engine guarantee, not a separate action to adopt.",
  "feature:mcp-surface":
    "MCP is an agent-only protocol surface and stays out of human tips.",
  "feature:published-contracts":
    "Published schemas serve integrations and are documented in the reference.",
  "feature:forgiving-cli":
    "Input normalization is command-line plumbing with no separate capability.",
  "feature:output-discipline":
    "Output discipline is an engine contract, not a beginner action.",
  "feature:foundations":
    "The product principles explain why discern works this way; they are not individual actions.",
  "feature:agent-is-user":
    "This is a design principle about coding agents, not a human capability.",
  "feature:context-budget":
    "This is a design principle about agent attention, not a human capability.",
  "feature:single-binary":
    "Packaging is an implementation property, not a capability to adopt.",
  "feature:all-subsystems-core":
    "This is a product-shape decision, not a separate beginner action.",
  "feature:forcing-functions":
    "This is an engineering principle enforced by guards, not a desk action.",
  "feature:canonical-sets":
    "This is maintainer infrastructure for closed sets, not a user capability.",
  "feature:dogfooding":
    "Running discern on itself is evidence about the product, not an action for a user.",
  "feature:interruption-safety":
    "Interruption cleanup is an engine guarantee; it teaches itself only if a stop occurs.",
  "verb:help":
    "Help is already present beside every command and needs no rotating lesson.",
  "verb:licenses":
    "License output is a legal reference surface, not an onboarding capability.",
  "verb:mcp":
    "MCP hosts an agent-only protocol surface and stays out of human tips.",
  "verb:setup":
    "Setup is complete before the desk can show tips and is taught by the installer.",
};
