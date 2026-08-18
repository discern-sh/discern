/**
 * The hint registry — the single module defining every advisory hint the
 * engine and installer can emit into a result's `hints[]` channel (ADR 0172).
 *
 * A hint is an entry here, never an inline string at an emission site: the
 * closed set is what lets the gate validate quoted `discern` commands against
 * the live verb registry, lets renderers drop agent-only hints by id instead
 * of string equality, lets the logbook record which hints fired, and lets
 * tests assert a hint by rendering its entry rather than pinning prose.
 *
 * In process a fired hint is an id/text pair ({@link FiredHint}); on the wire
 * the envelope's `hints` stays `string[]`, so ids never reach a public
 * contract. Entry documentation carries rationale and provenance; rendered
 * template text stays self-contained (no internal decision numbers — the
 * ADR-citation guard holds for these strings like any other).
 */

import type { DiscernResult, ErrorSlug, FailedStage } from "./result.ts";
import { SOURCE_PATHS } from "./paths_registry.ts";
import type { LandingConsentSource } from "./consent.ts";
import { MET_FLAG, UNMET_FLAG, WHY_FLAG } from "./declarations.ts";
import { markdownCodeSpan } from "./markdown_code.ts";
import {
  type CommandRef,
  discernCommand,
  flag,
  ownerDiscernCommand,
  positional,
  renderCommandRefsCli,
} from "./command_reference.ts";
import { worktreeContinuityPolicy } from "./operating_policies.ts";

/**
 * Shared references for the commands hints cite most. Each is one token
 * rendered per surface at delivery; a template interpolates it instead of
 * spelling the command as prose.
 */
const CMD = {
  done: discernCommand("done"),
  prepare: discernCommand("prepare"),
  test: discernCommand("test"),
  update: discernCommand("update"),
  refresh: discernCommand("refresh"),
  accept: discernCommand("accept"),
  status: discernCommand("status"),
  start: discernCommand("start"),
  setupDone: discernCommand("setup done"),
} as const;

/** The owner's Proof retrieval command — CLI-spelled on every surface because
 * the executor is the human owner at a terminal, never the reading agent. */
const OWNER_STATUS_VERBOSE = ownerDiscernCommand("status", flag("verbose"));

/**
 * How an entry means to steer the caller. `next-step` names the action to
 * take from here; `guardrail` states a rule protecting shared state before
 * it is broken; `notice` discloses a condition the caller should weigh but
 * need not act on.
 */
export type HintCategory = "next-step" | "guardrail" | "notice";

/**
 * A suppression flag for the interactive terminal presentation, not a format
 * targeting field: every entry rides JSON, Markdown, and MCP results regardless
 * of audience. `all` also renders in the interactive terminal; `agent` marks
 * entries whose instruction only an agent can execute — relaying to an owner,
 * re-rooting a session — which the terminal renderer drops. The drop keys on
 * this field, not on reconstructing the rendered string.
 */
export type HintAudience = "all" | "agent";

/**
 * A data-only declaration of what observable action a delivered hint invites.
 * The logbook reader interprets these shapes; shared hint definitions carry no
 * detector functions or engine imports.
 */
export type HintFollowThroughRule =
  | Readonly<{
    family: string;
    kind: "branch-action-before-boundary";
    actionVerbs: readonly string[];
    boundaryVerb: string;
  }>
  | Readonly<{
    family: string;
    kind: "session-action-before-repeat";
    actionVerb: string;
  }>
  | Readonly<{
    family: string;
    kind: "main-session-start-before-dirty";
    actionVerb: string;
  }>;

/** One registered hint: a stable id, its classification, and a typed template. */
export interface HintDef<P = undefined> {
  /** Stable kebab-case identifier — the logbook, renderers, and tests key on it. */
  readonly id: string;
  readonly category: HintCategory;
  readonly audience: HintAudience;
  /**
   * The one surface this entry can be delivered on, when it has one. `mcp`
   * marks an entry only the MCP server fires; its prose may name MCP tools,
   * and the CLI-rendering guard exempts it. Absent means both surfaces.
   */
  readonly delivery?: "mcp";
  /** One-line emitting condition shown in the generated inventory. */
  readonly when?: string;
  /**
   * Groups variants of one underlying fact (the restart-session family, the
   * generated-file-drift family) so wording reviews see them side by side.
   */
  readonly family?: string;
  /** Optional observable-outcome declaration for the advisory logbook reader. */
  readonly followThrough?: HintFollowThroughRule;
  /** Realistic placeholder parameters for validation and generated inventory. */
  readonly example: P;
  /** Renders the hint from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
  /** Optional interactive-terminal wording for the same facts. Serialized
   * results keep the canonical template; terminal renderers use this projection
   * when structured field names would make the instruction less useful there. */
  readonly interactiveTemplate?: ((params: P) => string) | undefined;
}

/** Identity helper so an entry's parameter type is inferred at the definition. */
export function defineHint<P = undefined>(def: HintDef<P>): HintDef<P> {
  return def;
}

const STATUS_BRANCH_UPDATE_FOLLOW_THROUGH = Object.freeze(
  {
    family: "branch-update",
    kind: "session-action-before-repeat",
    actionVerb: "update",
  } as const satisfies HintFollowThroughRule,
);

const RED_GATE_FOLLOW_THROUGH = Object.freeze(
  {
    family: "red-gate-remedy",
    kind: "branch-action-before-boundary",
    actionVerbs: Object.freeze(["prepare", "test"] as const),
    boundaryVerb: "done",
  } as const satisfies HintFollowThroughRule,
);

const MAIN_WORKTREE_FOLLOW_THROUGH = Object.freeze(
  {
    family: "main-worktree-first",
    kind: "main-session-start-before-dirty",
    actionVerb: "start",
  } as const satisfies HintFollowThroughRule,
);

/**
 * A gate-failure remedy that prescribes the prepare/test inner loop carries the
 * family's declared outcome rule; a remedy prescribing another action (refresh,
 * update, a reproduce command) declares none, so the follow-through detector
 * never scores a hint against an action its text did not ask for. The parity
 * guard in `tests/patterns_test.ts` derives the split from each entry's own
 * rendered text, so a reworded remedy enrols or retires itself.
 */
function defineGateFailureRemedyHint<P = undefined>(
  def: HintDef<P> & { readonly family: "gate-failure-remedy" },
): HintDef<P> {
  return defineHint({ ...def, followThrough: RED_GATE_FOLLOW_THROUGH });
}

/** A hint fired at a call site: the in-process pair; only `text` reaches the wire. */
export interface FiredHint {
  readonly id: string;
  /** Canonical wire text; terminal renderers may use `interactiveText`. */
  readonly text: string;
  /**
   * The authored template text with its command-reference tokens intact,
   * retained only when it differs from `text` — the representation a
   * non-CLI surface re-renders from ({@link resolveHintTextsForSurface}).
   */
  readonly authored?: string;
  /** Human-terminal projection when it differs from the wire text. */
  readonly interactiveText?: string;
}

/**
 * The in-process identity carried by one projected `hints[]` array. A WeakMap
 * keeps the metadata off the public array and lets it disappear with the
 * result; serialization therefore remains `string[]` while the logbook can
 * recover the ids from the exact envelope it records.
 */
const firedHintsByTexts = new WeakMap<
  readonly string[],
  readonly FiredHint[]
>();

/**
 * Fire a registry entry. A parameterless entry (`HintDef<undefined>`) is fired with
 * no second argument; a parameterized one requires its params — the
 * conditional tuple makes the compiler enforce both.
 *
 * The template's command-reference tokens resolve to their CLI spelling here.
 * That canonical text reaches the wire; an optional terminal projection rides
 * beside it, while the authored token form remains available to MCP.
 */
export function fire<P>(
  def: HintDef<P>,
  ...params: P extends void ? [] : [params: P]
): FiredHint {
  const [p] = params;
  // The tuple type above guarantees `p` is `P` exactly when the template
  // needs it; the cast bridges what the conditional tuple cannot express.
  const authored = def.template(p as P);
  const text = renderCommandRefsCli(authored);
  const interactiveAuthored = def.interactiveTemplate?.(p as P);
  const interactiveText = interactiveAuthored === undefined
    ? undefined
    : renderCommandRefsCli(interactiveAuthored);
  return {
    id: def.id,
    text,
    ...(text === authored ? {} : { authored }),
    ...(interactiveText === undefined || interactiveText === text
      ? {}
      : { interactiveText }),
  };
}

/** Project fired hints onto the envelope's wire shape, order preserved. */
export function hintTexts(fired: readonly FiredHint[]): string[] {
  const texts = fired.map((f) => f.text);
  firedHintsByTexts.set(texts, [...fired]);
  return texts;
}

/** Recover the fired pairs associated with one projected wire array. */
export function firedHintsFromTexts(
  texts: readonly string[] | undefined,
): FiredHint[] {
  return texts === undefined ? [] : [...(firedHintsByTexts.get(texts) ?? [])];
}

/**
 * Combine projected hint arrays without dropping their in-process identities.
 * Unassociated strings stay on the wire but contribute no invented id.
 */
export function mergeHintTexts(
  ...groups: readonly (readonly string[])[]
): string[] {
  const texts = groups.flatMap((group) => [...group]);
  const fired = groups.flatMap((group) => firedHintsFromTexts(group));
  firedHintsByTexts.set(texts, fired);
  return texts;
}

/** Append fired hints to an existing wire array, preserving both identities. */
export function appendHintTexts(
  existing: readonly string[] | undefined,
  fired: readonly FiredHint[],
): string[] {
  return mergeHintTexts(existing ?? [], hintTexts(fired));
}

/**
 * Re-render a wire hints array for one delivery surface: each fired entry's
 * authored command references resolve through `resolveText`, identity moves
 * to the new array, and strings with no recovered identity pass through
 * unchanged (they carry no references — only registry templates author
 * tokens). Returns the same array when nothing resolves differently, so the
 * CLI path — whose spelling `fire` already produced — costs nothing.
 */
export function resolveHintTextsForSurface(
  texts: readonly string[] | undefined,
  resolveText: (authored: string) => string,
): string[] | undefined {
  if (texts === undefined) {
    return undefined;
  }
  const fired = firedHintsFromTexts(texts);
  const resolvedByText = new Map<string, string>();
  const resolvedFired = fired.map((hint) => {
    if (hint.authored === undefined) {
      return hint;
    }
    const text = resolveText(hint.authored);
    resolvedByText.set(hint.text, text);
    return { id: hint.id, text };
  });
  const resolvedTexts = texts.map((text) => resolvedByText.get(text) ?? text);
  if (resolvedFired.length > 0) {
    firedHintsByTexts.set(resolvedTexts, resolvedFired);
  }
  return resolvedTexts;
}

/**
 * Re-render a result's hints for one delivery surface — call it at the
 * surface boundary BEFORE the envelope is observed, recorded, and serialized,
 * so the logbook and the wire carry the same rendering (hint identity itself
 * is the registry id and never changes with the surface).
 */
export function resolveResultHintsForSurface<TData>(
  result: DiscernResult<TData>,
  resolveText: (authored: string) => string,
): DiscernResult<TData> {
  const hints = resolveHintTextsForSurface(result.hints, resolveText);
  return hints === undefined ? result : { ...result, hints };
}

/** Optional diagnostic reason rendered in the existing parenthesized form. */
function reasonSuffix(reason: string | undefined): string {
  return reason === undefined ? "" : ` (${reason})`;
}

/** Append full-list commands to an update summary without adding pagination hints. */
function updateOverflowAdvice(
  filesRange: string | undefined,
  commitsRange: { before: string; main: string } | undefined,
): string {
  const actions: string[] = [];
  if (filesRange !== undefined) {
    actions.push(
      `Use \`git diff --stat ${filesRange}\` for the full file list and ` +
        `\`git diff ${filesRange} -- <path>\` for one file.`,
    );
  }
  if (commitsRange !== undefined) {
    actions.push(
      `Use \`git log --oneline ${commitsRange.before}..${commitsRange.main}\` ` +
        `for the full commit list.`,
    );
  }
  return actions.length === 0 ? "" : ` ${actions.join(" ")}`;
}

/** Shared non-negotiable action for every unfinished-setup context. */
const SETUP_UNFINISHED_CORE =
  "Setup is incomplete. Stay in this agent session and finish the setup brief before reporting or stopping. " +
  `Run ${discernCommand("setup begin")} to print or ` +
  "reprint it without changing your work, complete every step, then run " +
  `${CMD.setupDone}. Report setup complete only after ${CMD.setupDone} ` +
  "passes.";

/** Append one context-specific reason to the canonical unfinished-setup action. */
function setupUnfinishedHint(context: string): string {
  return `${SETUP_UNFINISHED_CORE} ${context}`;
}

/** Shared remedy for every missing or stale discern-managed artifact. */
const GENERATED_DRIFT_CORE =
  `Run ${CMD.refresh} to restore discern-managed artifacts.`;

/** Add one artifact-specific context and optional source-ownership instruction. */
function generatedDriftHint(context: string, followUp?: string): string {
  return `${GENERATED_DRIFT_CORE} ${context}${
    followUp === undefined ? "" : ` ${followUp}`
  }`;
}

/** Shared lifecycle fact behind every restart-session action. */
const RESTART_SESSION_CORE =
  "An open agent session does not discover a newly registered or upgraded discern " +
  "MCP server automatically. Restarting the session or reloading its MCP servers " +
  "loads the current server, engine, and templates.";

/** Add one context-specific restart action to the canonical lifecycle fact. */
function restartSessionHint(leadIn: string): string {
  return `${leadIn} ${RESTART_SESSION_CORE}`;
}

/** The check-stage remedy: prepare re-runs the fixers and checks in seconds. */
const GATE_PREPARE_REMEDY_CORE =
  "Fix the problems in the diagnostics; each carries its reproduce command. " +
  `Iterate with ${CMD.prepare}, the fast fix-then-check ` +
  `loop. Re-run ${CMD.done} only once ${CMD.prepare} is green: every red ` +
  `${CMD.done} pays for the full gate, tests included.`;

/** The test-stage remedy: iterate on the tests alone, not the whole gate. */
const GATE_TEST_REMEDY_CORE =
  "Fix the failing tests in the diagnostics; each carries its reproduce command. " +
  `Iterate with ${CMD.test}, which runs the tests alone. ` +
  `Re-run ${CMD.done} only once ${CMD.test} is green: every red ${CMD.done} ` +
  `pays for the full gate.`;

/** The combined-stage remedy names the narrow loop for each half. */
const GATE_CHECK_TEST_REMEDY_CORE =
  `Fix the problems in the diagnostics, iterating narrow: ${CMD.prepare} ` +
  `re-runs the checks and ${CMD.test} the tests. Re-run ${CMD.done} only ` +
  `once both are green: every red ${CMD.done} pays for the full gate.`;

/** The remedy for stages no narrower loop re-checks (build, scope gates):
 * the diagnostic's own reproduce command is the iteration. */
const GATE_REPRODUCE_REMEDY_CORE =
  "Fix the problems in the diagnostics and confirm with each diagnostic's " +
  `reproduce command, then re-run ${CMD.done}.`;

/** Runtime facts needed to render a generated-artifact drift remedy. */
export interface GeneratedDriftRemedyParams {
  /** The `<name>` from the failed `[generated.<name>]` group. */
  readonly group: string;
  /** The resolved command declared by that group's `run`. */
  readonly run: string;
}

/** Runtime facts needed when generator output escaped every declared glob. */
export interface GeneratedUndercoverageRemedyParams {
  /** Candidate `<name>` values from the Build group, in declaration order. */
  readonly groups: readonly string[];
}

/** Maximum names rendered in one hint summary. */
const HINT_NAME_CAP = 3;

/** Render a bounded name sample while preserving the class's full count. */
function boundedNameSummary(total: number, names: readonly string[]): string {
  const shown = names.slice(0, HINT_NAME_CAP);
  const remaining = Math.max(0, total - shown.length);
  return `${shown.join(", ")}${
    remaining > 0 ? `, … (+${remaining} more)` : ""
  }`;
}

/**
 * The registry. Entries land site-by-site as the emission sites migrate off
 * inline strings; once the last site moves, the closed-set guard pins this
 * table as the only source `hints[]` accepts.
 */
export const HINTS = {
  /** Status context for the shared unfinished-setup action, including marker count. */
  "setup-unfinished-status": defineHint<{ pendingCount: number }>({
    id: "setup-unfinished-status",
    category: "next-step",
    audience: "all",
    when:
      "Status finds setup incomplete or finds skeleton markers still present.",
    family: "setup-unfinished",
    example: { pendingCount: 2 },
    template: ({ pendingCount }): string => {
      const context = pendingCount > 0
        ? `${pendingCount} ${
          pendingCount === 1 ? "file still carries" : "files still carry"
        } skeleton markers.`
        : "No skeleton markers remain, but setup completion has not been recorded.";
      return setupUnfinishedHint(context);
    },
  }),

  /** One-line warning when the configured trunk branch cannot be checked. */
  "missing-trunk-branch": defineHint<{ branch: string }>({
    id: "missing-trunk-branch",
    category: "next-step",
    audience: "all",
    when: "The configured trunk branch is unavailable for the merge check.",
    example: { branch: "main" },
    template: ({ branch }): string =>
      `Create the local trunk branch '${branch}', or set [repository].trunk to ` +
      `the branch this project uses, then re-run. The trunk branch '${branch}' ` +
      `is not available locally, so the merge check cannot run.`,
  }),

  /**
   * The pristine-worktree / dirty-main signature shared by status and done. It
   * catches edits landing on the trunk while discern's tools run in a worktree.
   * Agent-audience: the remedy is session mechanics — cd-prefixing shell
   * commands and passing `path` to MCP tools — that only an agent performs.
   */
  "silent-worktree-divergence": defineHint<{
    cwd: string;
    mainRepo: string;
    changedFiles: number;
  }>({
    id: "silent-worktree-divergence",
    category: "guardrail",
    audience: "agent",
    when:
      "A clean worktree coincides with uncommitted changes in the main checkout.",
    example: {
      cwd: "/workspace/project.worktrees/task",
      mainRepo: "/workspace/project",
      changedFiles: 2,
    },
    template: ({ cwd, mainRepo, changedFiles }): string =>
      `Stop before editing: the main checkout at ${mainRepo} has ${changedFiles} uncommitted change${
        changedFiles === 1 ? "" : "s"
      }, while this assigned worktree is clean. Confirm who owns the main-checkout changes. Continue this effort only in ${cwd}: prefix every shell command ` +
      `with \`cd ${cwd} && …\` and pass \`path="${cwd}"\` to every discern MCP ` +
      `tool. Working in ${mainRepo} would place new edits on the trunk while discern runs in ${cwd}.`,
  }),

  /**
   * discern-owned ignored artifacts are tracked despite the managed ignore
   * contract. The caller supplies the canonical path summary and repair command.
   */
  "tracked-ignored-artifacts": defineHint<{
    pathSummary: string;
    repairCommand: string;
  }>({
    id: "tracked-ignored-artifacts",
    category: "next-step",
    audience: "all",
    when: "Git tracks discern-managed ignored artifacts.",
    example: {
      pathSummary: ".claude/skills",
      repairCommand: "git rm -r --cached .claude/skills",
    },
    template: ({ pathSummary, repairCommand }): string =>
      `Run \`${repairCommand}\` to remove the discern-managed ignored artifacts ` +
      `from the Git index, then run ${CMD.refresh}. Affected paths: ${pathSummary}.`,
  }),

  /**
   * Compiled instruction files are present but untracked and not ignored. Committing
   * them puts the same instructions in reach of agents reading a fresh clone.
   */
  "untracked-agent-files": defineHint<{ paths: readonly string[] }>({
    id: "untracked-agent-files",
    category: "next-step",
    audience: "all",
    when: "Generated agent files are untracked and not ignored.",
    example: { paths: ["AGENTS.md", "CLAUDE.md"] },
    template: ({ paths }): string =>
      `Commit the untracked agent files (${
        paths.join(", ")
      }) so cloud and out-of-tool agents read the same instructions from a fresh clone.`,
  }),

  /** Missing agent-file context for the shared generated-drift remedy. */
  "generated-agent-files-missing": defineHint<{ paths: string }>({
    id: "generated-agent-files-missing",
    category: "next-step",
    audience: "all",
    when: "A generated agent file is missing.",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(`Agent files are missing (${paths}).`),
  }),

  /** Stale agent-file context plus its authored-source instruction. */
  "generated-agent-files-stale": defineHint<{ paths: string }>({
    id: "generated-agent-files-stale",
    category: "next-step",
    audience: "all",
    when: "A generated agent file differs from its authored sources.",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Agent files are out of date (${paths}).`,
        "Make intended instructions changes in [instructions].sources. Refresh overwrites agent files.",
      ),
  }),

  /** Missing materialized-skills context for the shared generated-drift remedy. */
  "materialized-skills-missing": defineHint<{ dirs: string }>({
    id: "materialized-skills-missing",
    category: "next-step",
    audience: "all",
    when: "A materialized skill directory is missing.",
    family: "generated-drift",
    example: { dirs: ".claude/skills" },
    template: ({ dirs }): string =>
      generatedDriftHint(`Materialized skills are missing (${dirs}).`),
  }),

  /** Stale materialized-skills context plus its authored-source instruction. */
  "materialized-skills-stale": defineHint<{ dirs: string }>({
    id: "materialized-skills-stale",
    category: "next-step",
    audience: "all",
    when: "A materialized skill differs from its authored source.",
    family: "generated-drift",
    example: { dirs: ".claude/skills" },
    template: ({ dirs }): string =>
      generatedDriftHint(
        `Materialized skills are out of date (${dirs}).`,
        "Make intended skill changes in [skills].dir. Refresh overwrites the materialized copies.",
      ),
  }),

  /** Missing provider-integration context for the shared generated-drift remedy. */
  "provider-integrations-missing": defineHint<{ paths: string }>({
    id: "provider-integrations-missing",
    category: "next-step",
    audience: "all",
    when: "A provider integration file is missing.",
    family: "generated-drift",
    example: { paths: ".codex/config.toml" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Provider integration files are missing (${paths}).`,
      ),
  }),

  /** Provider-integration drift context plus its malformed-file recovery. */
  "provider-integrations-stale": defineHint<{ paths: string }>({
    id: "provider-integrations-stale",
    category: "next-step",
    audience: "all",
    when: "A provider integration file is stale or malformed.",
    family: "generated-drift",
    example: { paths: ".codex/config.toml" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Provider integration files need attention (${paths}).`,
        `If refresh reports a malformed settings file, repair it and run ${CMD.refresh} again.`,
      ),
  }),

  /** Stale maintained-ADR-index context for the shared generated-drift remedy. */
  "adr-index-stale": defineHint<{ path: string }>({
    id: "adr-index-stale",
    category: "next-step",
    audience: "all",
    when:
      "The maintained ADR index no longer matches the record files on disk.",
    family: "generated-drift",
    example: { path: "docs/_adr/README.md" },
    template: ({ path }): string =>
      generatedDriftHint(
        `The ADR index is out of date (${path}).`,
        "Edit the ADR records that own these entries. Refresh rewrites the generated lists between the markers.",
      ),
  }),

  /** Tracked refresh effects not covered by one of the focused stale hints. */
  "tracked-refresh-pending": defineHint<{ paths: string }>({
    id: "tracked-refresh-pending",
    category: "next-step",
    audience: "all",
    when: "The read-only refresh plan would change tracked project files.",
    family: "generated-drift",
    example: { paths: ".gitattributes, .mcp.json" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Tracked refresh artifacts are out of date (${paths}).`,
      ),
  }),

  /** A read-only tracked refresh transformation could not be derived. */
  "tracked-refresh-plan-failed": defineHint<{ reason: string }>({
    id: "tracked-refresh-plan-failed",
    category: "next-step",
    audience: "all",
    when: "Status cannot derive the tracked refresh plan.",
    family: "generated-drift",
    example: { reason: "could not read .mcp.json" },
    template: ({ reason }): string =>
      `Tracked refresh convergence could not be checked: ${reason}. Repair the named input, run ${CMD.refresh}, then run ${CMD.status} again.`,
  }),

  /**
   * The on-the-trunk guardrail, agent-facing. It leads with the start-and-move
   * action, then preserves the ownership rule that prevents an agent from
   * adopting another effort's worktree. Interactive status omits it because a
   * person in the main checkout is monitoring the fleet.
   */
  "status-start-on-trunk": defineHint({
    id: "status-start-on-trunk",
    category: "guardrail",
    audience: "agent",
    when: "`status` runs in the main checkout while it is on the trunk.",
    family: "status-start-here",
    example: undefined,
    template: (): string =>
      `${worktreeContinuityPolicy(CMD.start)} For a new effort, run ${
        discernCommand("start", flag("name", '"<task>"'))
      } from this main checkout on the trunk, then move into the new worktree before editing. The name keeps the worktree identifiable.`,
  }),

  /**
   * The off-trunk sibling of `status-start-on-trunk`. It reports the actual
   * branch honestly and names the path back before acceptance can land. Like its
   * sibling, it is agent-only in status output.
   */
  "status-start-off-trunk": defineHint<{ branch: string; trunk: string }>({
    id: "status-start-off-trunk",
    category: "guardrail",
    audience: "agent",
    when: "`status` runs in the main checkout while it is off the trunk.",
    family: "status-start-here",
    example: { branch: "agent/hints", trunk: "main" },
    template: ({ branch, trunk }): string => {
      const label = branch === "" ? "(detached)" : `'${branch}'`;
      return `${worktreeContinuityPolicy(CMD.start)} Run ` +
        `\`git switch ${trunk}\` in the main checkout before ` +
        `${CMD.accept}. The checkout is parked on ${label}, while '${trunk}' ` +
        `is the trunk. A new effort can still run ${CMD.start}; its worktree ` +
        `forks from the trunk.`;
    },
  }),

  /**
   * The main-checkout variant for a configured trunk that does not exist. Unlike
   * the start-here guardrails this reaches humans because it is a misconfiguration.
   */
  "status-missing-trunk": defineHint<{ branch: string; trunk: string }>({
    id: "status-missing-trunk",
    category: "next-step",
    audience: "all",
    when: "`status` cannot find the configured trunk branch.",
    example: { branch: "develop", trunk: "main" },
    template: ({ branch, trunk }): string => {
      const label = branch === "" ? "(detached)" : `'${branch}'`;
      return `Set [repository].trunk to the branch this project uses, or create ` +
        `the configured trunk with \`git branch ${trunk}\`. The '${trunk}' branch ` +
        `does not exist, and the main checkout is on ${label}. Worktrees cannot ` +
        `fork and ${CMD.accept} cannot land until the configuration and ` +
        `repository agree.`;
    },
  }),

  "status-dirty-worktree-scoped": defineHint<{ scopes: readonly string[] }>({
    id: "status-dirty-worktree-scoped",
    category: "next-step",
    audience: "all",
    when: "`status` finds scoped, uncommitted changes in the current worktree.",
    family: "status-dirty-worktree",
    example: { scopes: ["code", "map"] },
    template: ({ scopes }): string =>
      `Use ${CMD.prepare} or targeted tests while iterating on changes in ${
        scopes.join(", ")
      }. Then commit the intended final tree and run ${CMD.done} on the ` +
      `clean HEAD before calling work done.`,
  }),

  "status-dirty-worktree": defineHint({
    id: "status-dirty-worktree",
    category: "next-step",
    audience: "all",
    when: "`status` finds uncommitted changes whose scopes are unavailable.",
    family: "status-dirty-worktree",
    example: undefined,
    template: (): string =>
      `Use ${CMD.prepare} or targeted tests while iterating on uncommitted changes. Then commit the intended final tree and run ${CMD.done} on the clean HEAD before calling work done.`,
  }),

  "status-branch-behind": defineHint<{
    behind: number;
    trunk: string;
    overlap: { total: number; paths: readonly string[] } | undefined;
  }>({
    id: "status-branch-behind",
    category: "next-step",
    audience: "all",
    when: "`status` finds the current branch behind the trunk.",
    followThrough: STATUS_BRANCH_UPDATE_FOLLOW_THROUGH,
    example: {
      behind: 2,
      trunk: "main",
      overlap: {
        total: 2,
        paths: ["src/main.ts", "tests/main_test.ts"],
      },
    },
    template: ({ behind, trunk, overlap }): string => {
      const overlapNote = overlap !== undefined && overlap.total > 0
        ? ` Re-check ${overlap.total} changed file${
          overlap.total === 1 ? "" : "s"
        } after updating. They also changed upstream (${
          overlap.paths.slice(0, 3).join(", ")
        }${overlap.total > 3 ? ", …" : ""}).`
        : "";
      return `Run ${CMD.update} directly. This branch is ${behind} commit${
        behind === 1 ? "" : "s"
      } behind ${trunk}, and the command is idempotent and checks its own git ` +
        `preconditions.${overlapNote} Run ${CMD.done} before handing off or a ` +
        `user-requested landing.`;
    },
  }),

  "status-main-checkout-dirty": defineHint<{ trunk: string }>({
    id: "status-main-checkout-dirty",
    category: "next-step",
    audience: "all",
    when:
      "Changes in the main checkout prevent an otherwise ready branch from landing.",
    family: "status-review-readiness",
    example: { trunk: "main" },
    template: ({ trunk }): string =>
      `Commit or stash the main checkout's tracked changes before a ` +
      `user-requested landing. This branch is committed and up to date with ${trunk}.`,
  }),

  /** Agent-audience: every fact here (clean HEAD, valid Proof, up to
   * date) already renders in the interactive summary lines, and the
   * instructions — report, close with the line, wait, land only on an explicit
   * ask — are the agent's consent workflow, not a person's. The composition
   * contract (account first, one-line Proof last, page stays with discern)
   * is ADR 0188's. */
  "status-ready-for-review": defineHint<{ trunk: string; branch: string }>({
    id: "status-ready-for-review",
    category: "next-step",
    audience: "agent",
    when: "A clean, current branch has honored Proof.",
    family: "status-review-readiness",
    example: { trunk: "main", branch: "agent/hints" },
    template: ({ trunk, branch }): string =>
      `Report this branch to your owner in your own words. End with ` +
      `the result's Proof line verbatim, then ` +
      `wait. This clean HEAD is ` +
      `committed and up to date with ${trunk}. Your owner can retrieve the ` +
      `full Proof with ${OWNER_STATUS_VERBOSE} and inspect the raw change with ` +
      `\`git diff ${trunk}...${branch}\`. Run ` +
      `${CMD.accept} only after the user explicitly asks you to land it.`,
  }),

  /** A ready Proof whose exact tree the authority resolver covered. */
  "status-land-under-verified-authority": defineHint<{
    source: LandingConsentSource;
    scopes: readonly string[];
  }>({
    id: "status-land-under-verified-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A clean, current branch has valid Proof and machine-verified landing authority.",
    family: "landing-authority",
    example: { source: "standing-grant", scopes: ["map"] },
    template: ({ source, scopes }): string =>
      source === "effort-grant"
        ? `The owner pre-authorized this landing at the desk, and the clean HEAD has valid Proof. Run ${CMD.accept} now to land it; the command rechecks the grant at the fast-forward boundary.`
        : `The clean HEAD is covered by the standing grant for ${
          scopes.join(", ")
        } and has valid Proof. Run ${CMD.accept} now to land it; the command rechecks every changed path at the fast-forward boundary.`,
  }),

  /** A ready Proof whose recorded standing grant does not cover every path. */
  "status-ready-uncovered-authority": defineHint<{
    trunk: string;
    branch: string;
  }>({
    id: "status-ready-uncovered-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A clean, current branch has valid Proof but recorded authority does not cover it.",
    family: "landing-authority",
    example: { trunk: "main", branch: "agent/hints" },
    template: ({ trunk, branch }): string =>
      `Report this branch to your owner in your own words, end with the ` +
      `result's Proof line verbatim, then stop: the recorded grant does not ` +
      `cover this landing. Inspect the raw change with \`git diff ${trunk}...${branch}\`.`,
  }),

  "status-missing-done-proof": defineHint<{ trunk: string }>({
    id: "status-missing-done-proof",
    category: "next-step",
    audience: "all",
    when: "A clean, current branch has no honored Proof.",
    family: "status-review-readiness",
    example: { trunk: "main" },
    template: ({ trunk }): string =>
      `Run ${CMD.done} before reporting the branch ready for review or a ` +
      `user-requested landing. This clean HEAD is committed and up to date with ` +
      `${trunk}, but it has no honored Proof.`,
  }),

  /**
   * The fleet ownership rule, agent-facing and action-first. It fires whenever a
   * survey includes a separate line of work. Interactive status uses the fleet
   * caption instead.
   */
  "fleet-ownership": defineHint({
    id: "fleet-ownership",
    category: "guardrail",
    audience: "agent",
    when: "A fleet survey includes a worktree other than the current checkout.",
    example: undefined,
    template: (): string =>
      "Continue a fleet worktree only if this effort created it. Review " +
      "feedback and resumed sessions keep that assignment. Never claim a " +
      "worktree from another effort because it is idle or clean.",
  }),

  "status-fleet-logbook-disabled": defineHint({
    id: "status-fleet-logbook-disabled",
    category: "notice",
    audience: "all",
    when:
      "A fleet survey cannot show per-worktree actions because logbook recording is disabled.",
    example: undefined,
    template: (): string =>
      "Per-worktree actions aren't available because `[project].logbook` is off.",
  }),

  "status-no-active-worktrees": defineHint({
    id: "status-no-active-worktrees",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds no active worktrees.",
    example: undefined,
    template: (): string =>
      `Run ${CMD.start} to begin work. There are no active worktrees.`,
  }),

  "status-reappeared-worktree-paths": defineHint<{ total: number }>({
    id: "status-reappeared-worktree-paths",
    category: "next-step",
    audience: "all",
    when:
      "Status finds a path discern removed with a worktree that exists again.",
    example: { total: 2 },
    template: ({ total }): string =>
      `${total} removed worktree path${total === 1 ? " is" : "s are"} ` +
      `present again. Review ${total === 1 ? "it" : "them"} with ` +
      `${
        discernCommand("worktree prune", flag("dry-run"))
      }. Close any program ` +
      `still writing into ${total === 1 ? "the path" : "those paths"} before ` +
      "confirming removal.",
  }),

  /** One bounded summary for every fleet member with uncommitted changes. */
  "status-dirty-fleet-members": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-dirty-fleet-members",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds worktrees with uncommitted changes.",
    example: {
      total: 5,
      names: ["hint-registry", "docs-refresh", "gate-copy", "cli-help"],
    },
    template: ({ total, names }): string =>
      `Review ${total} worktree${total === 1 ? "" : "s"} with uncommitted ` +
      `changes: ${boundedNameSummary(total, names)}.`,
    interactiveTemplate: ({ total, names }): string =>
      `${total} worktree${total === 1 ? " has" : "s have"} uncommitted ` +
      `changes: ${
        boundedNameSummary(total, names)
      }. Recent or running changes ` +
      `are normal work in progress.`,
  }),

  /** One bounded summary for every fleet member ready for owner review. */
  "status-fleet-member-ready": defineHint<{
    total: number;
    names: readonly string[];
    trunk: string;
  }>({
    id: "status-fleet-member-ready",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds worktrees ready for owner review.",
    example: {
      total: 5,
      names: ["hint-registry", "docs-refresh", "gate-copy", "cli-help"],
      trunk: "main",
    },
    template: ({ total, names, trunk }): string =>
      `Review ${total} worktree${total === 1 ? "" : "s"} with committed work ` +
      `ready for owner review: ${
        boundedNameSummary(total, names)
      }. Inspect a named branch with \`git diff ${trunk}...<branch>\`.`,
    interactiveTemplate: ({ total, names, trunk }): string =>
      `Review ${total} worktree${total === 1 ? "" : "s"} with committed work ` +
      `ready for owner review: ${
        boundedNameSummary(total, names)
      }. Inspect a ` +
      `branch with \`git diff ${trunk}...<branch>\`. The dashboard shows the ` +
      `complete branch beside each worktree.`,
  }),

  /** Ready fleet rows whose recorded authority has already been verified. */
  "status-fleet-authorized-landings": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-authorized-landings",
    category: "next-step",
    audience: "agent",
    when:
      "A fleet survey finds ready worktrees with machine-verified landing authority.",
    family: "landing-authority",
    example: {
      total: 2,
      names: ["docs-refresh", "release-notes"],
    },
    template: ({ total, names }): string =>
      `${total} ready worktree${
        total === 1 ? " has" : "s have"
      } machine-verified landing authority: ${
        boundedNameSummary(total, names)
      }. Open each worktree and run ${CMD.accept} now; acceptance rechecks its grant before landing.`,
  }),

  /** The fleet-wide collision check the survey-the-fleet skill once carried:
   * pairs of efforts whose fork diffs touch the same paths (ADR 0173). */
  "status-fleet-collisions": defineHint<{
    total: number;
    pairs: readonly string[];
  }>({
    id: "status-fleet-collisions",
    category: "notice",
    audience: "all",
    when:
      "A fleet survey finds worktree pairs whose changes touch the same files.",
    example: {
      total: 2,
      pairs: ["hint-registry ↔ docs-refresh", "gate-copy ↔ cli-help"],
    },
    template: ({ total, pairs }): string =>
      `Note ${total} worktree pair${
        total === 1 ? "" : "s"
      } changing the same files: ${
        boundedNameSummary(total, pairs)
      }. Both sides may merge cleanly and still conflict semantically. Whoever ` +
      `lands second should run ${CMD.update}; the update result names the shared ` +
      `paths to re-read.`,
    interactiveTemplate: ({ total, pairs }): string =>
      `${total} worktree pair${
        total === 1 ? " is" : "s are"
      } changing the same files: ${
        boundedNameSummary(total, pairs)
      }. ${OWNER_STATUS_VERBOSE} lists the shared paths. Whoever lands second ` +
      `should run ${CMD.update} and re-read them.`,
  }),

  /** In-flight ADR number collisions — number-keyed where the fleet-collision
   * scan is path-keyed: the records are different files that merge cleanly, so
   * this is the only warning before the gate refuses the landed duplicate. */
  "status-adr-number-collisions": defineHint<{
    total: number;
    claims: readonly string[];
  }>({
    id: "status-adr-number-collisions",
    category: "notice",
    audience: "all",
    when: "Two or more in-flight branches claim the same ADR record number.",
    example: {
      total: 2,
      claims: [
        "0007 (agent/one ↔ agent/two)",
        "0008 (agent/one ↔ agent/three)",
      ],
    },
    template: ({ total, claims }): string =>
      `Expect a renumber: ${total} ADR number${
        total === 1 ? " is" : "s are"
      } claimed by more than one in-flight branch: ${
        boundedNameSummary(total, claims)
      }. The records are different files that merge cleanly, so nothing collides ` +
      `until both sit in one tree and the gate refuses the duplicate. Whoever ` +
      `lands second takes the next free number; ${OWNER_STATUS_VERBOSE} lists ` +
      `the record paths.`,
    interactiveTemplate: ({ total, claims }): string =>
      `${total} ADR number${
        total === 1 ? " is" : "s are"
      } claimed by more than one in-flight branch: ${
        boundedNameSummary(total, claims)
      }. ${OWNER_STATUS_VERBOSE} lists the record paths. Whoever lands second ` +
      `takes the next free number.`,
  }),

  /** One bounded summary for every fleet member whose git state is unreadable. */
  "status-fleet-member-unreadable": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-unreadable",
    category: "next-step",
    audience: "all",
    when: "A fleet survey cannot read one or more worktree states.",
    example: {
      total: 5,
      names: ["damaged", "missing", "unreadable", "no-access"],
    },
    template: ({ total, names }): string => {
      const checkout = total === 1
        ? "Its checkout may be"
        : "Their checkouts may be";
      return `Investigate ${total} worktree${
        total === 1 ? "" : "s"
      } whose git state cannot be read: ${boundedNameSummary(total, names)}. ` +
        `${checkout} missing or damaged, so unsaved work is unverifiable. To ` +
        `discard one, run ${
          discernCommand("worktree drop", positional("name", "<name>"))
        }. It refuses without ` +
        "`--force` while the git state cannot be read.";
    },
  }),

  /** One bounded summary for every fleet member whose setup never completed. */
  "status-fleet-member-broken": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-broken",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds worktrees whose setup never completed.",
    example: {
      total: 5,
      names: ["incomplete", "crashed", "half-built", "no-config"],
    },
    template: ({ total, names }): string => {
      const checkout = total === 1
        ? "Its checkout may be"
        : "Their checkouts may be";
      return `Discard ${total} worktree${
        total === 1 ? "" : "s"
      } whose setup never completed: ${boundedNameSummary(total, names)}. ` +
        `${checkout} incomplete. Run ${
          discernCommand("worktree drop", positional("name", "<name>"))
        } for each.`;
    },
  }),

  /** One bounded summary for every fleet member that looks abandoned. */
  "status-fleet-member-stale": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-stale",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds worktrees that appear inactive.",
    example: {
      total: 5,
      names: ["stale-task", "old-fix", "paused-docs", "forgotten-test"],
    },
    template: ({ total, names }): string => {
      const subject = total === 1
        ? "worktree that looks"
        : "worktrees that look";
      const sessions = total === 1 ? "its session" : "their sessions";
      const discard = total === 1 ? "it" : "each";
      return `Review ${total} ${subject} stale: ${
        boundedNameSummary(total, names)
      }. ` +
        `Resume ${sessions} or discard ${discard} with ` +
        `${discernCommand("worktree drop", positional("name", "<name>"))}. ` +
        "Status has already accounted for last activity and unlanded work.";
    },
    interactiveTemplate: ({ total, names }): string => {
      const subject = total === 1 ? "worktree looks" : "worktrees look";
      const sessions = total === 1 ? "its session" : "their sessions";
      const discard = total === 1 ? "it" : "each";
      return `${total} ${subject} stale: ${
        boundedNameSummary(total, names)
      }. ` +
        `Resume ${sessions} or discard ${discard} with ` +
        `${discernCommand("worktree drop", positional("name", "<name>"))}. ` +
        `The dashboard shows last activity and Git state.`;
    },
  }),

  "status-unlanded-branches": defineHint<{ branches: readonly string[] }>({
    id: "status-unlanded-branches",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds unlanded branches with no worktree.",
    example: { branches: ["agent/old-task", "agent/paused-task"] },
    template: ({ branches }): string =>
      `Resume one with ${
        discernCommand("start", flag("from", "<branch>"))
      }, or use ` +
      `${
        discernCommand("update", flag("from", "<branch>"))
      } from an existing worktree. Delete an ` +
      `abandoned branch with \`git branch -D <branch>\`. ${branches.length} branch${
        branches.length === 1 ? "" : "es"
      } ${branches.length === 1 ? "holds" : "hold"} unlanded work with no ` +
      `worktree: ${boundedNameSummary(branches.length, branches)}.`,
  }),

  /** A reclaimed stage ref remains reachable through the named live branch
   * until the contained work lands; ordinary prune then removes the ref. */
  "status-contained-refs": defineHint<{
    refs: ReadonlyArray<{ branch: string; contained_in: string }>;
  }>({
    id: "status-contained-refs",
    category: "notice",
    audience: "all",
    when:
      "A fleet survey finds reclaimed-stage refs riding inside live branches.",
    example: {
      refs: [{
        branch: "agent/upload-retry",
        contained_in: "agent/upload-retry-stage-2",
      }],
    },
    template: ({ refs }): string => {
      const first = refs[0];
      const detail = refs.length === 1 && first !== undefined
        ? `The reclaimed stage ref \`${first.branch}\` remains reachable through \`${first.contained_in}\``
        : `${refs.length} reclaimed-stage refs remain reachable through live branches`;
      return `${detail} until the contained work lands. Ordinary prune then removes ${
        refs.length === 1 ? "the ref" : "those refs"
      }. No action is required.`;
    },
  }),

  /** Ownership notice for an explicit coupling input excluded from the model. */
  "coupling-generated-exclusion": defineHint<{
    path: string;
    group: string;
  }>({
    id: "coupling-generated-exclusion",
    category: "notice",
    audience: "all",
    when:
      "A coupling result excludes an input owned by a generated declaration.",
    family: "coupling-exclusion",
    example: { path: "build/reference.dat", group: "reference" },
    template: ({ path, group }): string =>
      `Coupling excluded \`${path}\` because \`[generated.${group}]\` owns it ` +
      "as a declared output. A declared output is a projection, so it is not an " +
      "independent change partner.",
  }),

  /** Pair evidence when the files have never co-changed in the mined window. */
  "coupling-evidence-none": defineHint<{
    a: string;
    b: string;
    ofA: number;
    ofB: number;
  }>({
    id: "coupling-evidence-none",
    category: "notice",
    audience: "all",
    when: "A coupling query finds no shared commit history for the pair.",
    family: "coupling-evidence",
    example: {
      a: "src/main.ts",
      b: "tests/main_test.ts",
      ofA: 6,
      ofB: 4,
    },
    template: ({ a, b, ofA, ofB }): string =>
      `\`${a}\` and \`${b}\` have not changed together in recent history. ` +
      `The history examined includes ${ofA} commit${ofA === 1 ? "" : "s"} ` +
      `touching \`${a}\` and ${ofB} commit${ofB === 1 ? "" : "s"} touching ` +
      `\`${b}\`.`,
  }),

  /** Pair evidence summary; the result carries the bounded commit rows. */
  "coupling-evidence-summary": defineHint<{
    a: string;
    b: string;
    together: number;
    ofA: number;
    ofB: number;
  }>({
    id: "coupling-evidence-summary",
    category: "next-step",
    audience: "all",
    when: "A coupling query finds shared commit history for the pair.",
    family: "coupling-evidence",
    example: {
      a: "src/main.ts",
      b: "tests/main_test.ts",
      together: 3,
      ofA: 6,
      ofB: 4,
    },
    template: ({ a, b, together, ofA, ofB }): string => {
      const shareA = ofA > 0 ? ` (${Math.round((together / ofA) * 100)}%)` : "";
      const shareB = ofB > 0 ? ` (${Math.round((together / ofB) * 100)}%)` : "";
      return `Review the shared commits in this result. \`${a}\` and \`${b}\` ` +
        `changed together in ${together} recent commits: ${together} of the ` +
        `${ofA}${shareA} that touched \`${a}\`, and ${together} of the ` +
        `${ofB}${shareB} that touched \`${b}\`.`;
    },
  }),

  /** Evidence overflow stays explicit after per-commit hint rows are removed. */
  "coupling-evidence-more": defineHint<{ more: number }>({
    id: "coupling-evidence-more",
    category: "next-step",
    audience: "all",
    when: "Shared coupling evidence exceeds the result cap.",
    family: "coupling-evidence",
    example: { more: 3 },
    template: ({ more }): string =>
      `Review the most recent shared commits in this result. ${more} older ` +
      `commit${more === 1 ? " is" : "s are"} outside the result cap.`,
  }),

  /** Diff-aware summary before the single strongest missing partner. */
  "coupling-diff-header": defineHint({
    id: "coupling-diff-header",
    category: "next-step",
    audience: "all",
    when:
      "Diff-aware coupling finds habitual partners missing from the change.",
    family: "coupling-partners",
    example: undefined,
    template: (): string =>
      "Review the strongest habitual partner missing from this branch's changes. " +
      "Coupling is advisory, based on recent git history, and not exhaustive.",
  }),

  /** The strongest diff-aware partner; all ranked partner rows stay in data. */
  "coupling-diff-partner": defineHint<{
    from: string;
    path: string;
    cochanges: number;
    of: number;
    confidence: number;
  }>({
    id: "coupling-diff-partner",
    category: "next-step",
    audience: "all",
    when: "Diff-aware coupling selects the strongest missing partner.",
    family: "coupling-partners",
    example: {
      from: "src/main.ts",
      path: "tests/main_test.ts",
      cochanges: 4,
      of: 5,
      confidence: 0.8,
    },
    template: ({ from, path, cochanges, of, confidence }): string =>
      `Start with \`${path}\`: it changed in ${cochanges} of the ${of} recent ` +
      `commits that touched \`${from}\` (${
        Math.round(confidence * 100)
      }%), and this branch changed \`${from}\` without it.`,
  }),

  /** Query summary before the single strongest co-change partner. */
  "coupling-query-header": defineHint<{ target: string }>({
    id: "coupling-query-header",
    category: "next-step",
    audience: "all",
    when: "A path coupling query finds one or more habitual partners.",
    family: "coupling-partners",
    example: { target: "src/main.ts" },
    template: ({ target }): string =>
      `Review the strongest file that usually changes with \`${target}\`. ` +
      "Coupling is advisory, based on recent git history, and not exhaustive.",
  }),

  /** The strongest query partner; all ranked partner rows stay in data. */
  "coupling-query-partner": defineHint<{
    path: string;
    target: string;
    cochanges: number;
    of: number;
    confidence: number;
  }>({
    id: "coupling-query-partner",
    category: "next-step",
    audience: "all",
    when: "A path coupling query selects the strongest partner.",
    family: "coupling-partners",
    example: {
      path: "tests/main_test.ts",
      target: "src/main.ts",
      cochanges: 4,
      of: 5,
      confidence: 0.8,
    },
    template: ({ path, target, cochanges, of, confidence }): string =>
      `Start with \`${path}\`: it changed in ${cochanges} of the ${of} recent ` +
      `commits that touched \`${target}\` (${Math.round(confidence * 100)}%).`,
  }),

  "coupling-more-partners": defineHint<{
    remaining: number;
    queryTarget: string | undefined;
  }>({
    id: "coupling-more-partners",
    category: "next-step",
    audience: "all",
    when: "A coupling result has more ranked partners than it displays.",
    family: "coupling-partners",
    example: { remaining: 3, queryTarget: "src/main.ts" },
    template: ({ remaining, queryTarget }): string => {
      const command = queryTarget === undefined
        ? discernCommand("coupling")
        : discernCommand("coupling", positional("file", queryTarget));
      return `Run ${command} to review ${remaining} more ranked ` +
        `partner${remaining === 1 ? "" : "s"}.`;
    },
  }),

  "coupling-strong-pair": defineHint<{ from: string; path: string }>({
    id: "coupling-strong-pair",
    category: "next-step",
    audience: "all",
    when:
      "A coupling pair changes together often enough to suggest an invariant.",
    family: "coupling-partners",
    example: { from: "src/main.ts", path: "tests/main_test.ts" },
    template: ({ from, path }): string =>
      `Add a forcing-function if \`${from}\` and \`${path}\` share an essential ` +
      "invariant. They change together almost every time. The `discern-cure-a-bug` " +
      "skill covers the pattern.",
  }),

  /** The composition move once a sibling proves green (the pull axis: build on
   * any ref below the trunk). */
  "await-green-met": defineHint<{
    branch: string;
    tip: string;
    callerHasWorktree: boolean;
  }>({
    id: "await-green-met",
    category: "next-step",
    audience: "all",
    when: "`await --green` finds honored Proof for the awaited branch.",
    family: "await-met",
    example: {
      branch: "agent/upload-retry",
      tip: "abc1234def567890",
      callerHasWorktree: true,
    },
    template: ({ branch, tip, callerHasWorktree }): string =>
      `\`${branch}\` is green — its worktree holds valid Proof. ` +
      (callerHasWorktree
        ? `Build on it with ${discernCommand("update", flag("from", tip))}. ` +
          "The immutable commit remains valid if acceptance deletes the branch."
        : `Create your worktree from it with ${
          discernCommand("start", flag("from", tip))
        }. The immutable commit remains valid if acceptance deletes the branch.`),
  }),

  /** The integration move once awaited work reaches the trunk. */
  "await-landed-met": defineHint<{
    branch: string;
    trunk: string;
    overlapTotal: number;
    callerHasWorktree: boolean;
  }>({
    id: "await-landed-met",
    category: "next-step",
    audience: "all",
    when: "`await` finds the awaited work reachable from the trunk.",
    family: "await-met",
    example: {
      branch: "agent/upload-retry",
      trunk: "main",
      overlapTotal: 2,
      callerHasWorktree: true,
    },
    template: (
      { branch, trunk, overlapTotal, callerHasWorktree },
    ): string =>
      `The work from \`${branch}\` landed on \`${trunk}\` — ` +
      (callerHasWorktree
        ? `run ${CMD.update} to bring it beneath this branch.` +
          (overlapTotal > 0
            ? ` ${overlapTotal} incoming file${
              overlapTotal === 1 ? " overlaps" : "s overlap"
            } your own changes — re-read them after updating.`
            : "")
        : `create your worktree from the current trunk with ${CMD.start}.`),
  }),

  "await-trunk-moved-met": defineHint<{
    trunk: string;
    overlapTotal: number;
    callerHasWorktree: boolean;
  }>({
    id: "await-trunk-moved-met",
    category: "next-step",
    audience: "all",
    when: "`await --trunk-moved` sees the trunk ref advance.",
    family: "await-met",
    example: { trunk: "main", overlapTotal: 0, callerHasWorktree: true },
    template: ({ trunk, overlapTotal, callerHasWorktree }): string =>
      `\`${trunk}\` moved while you waited — ` +
      (callerHasWorktree
        ? `run ${CMD.update} to bring the latest beneath this branch.` +
          (overlapTotal > 0
            ? ` ${overlapTotal} incoming file${
              overlapTotal === 1 ? " overlaps" : "s overlap"
            } your own changes — re-read them after updating.`
            : "")
        : `create your worktree from the current trunk with ${CMD.start}.`),
  }),

  /** The timeout answer: not a failure, one useful next wait bound. */
  "await-not-yet": defineHint<{
    summary: string;
    seconds: number;
    command: CommandRef;
  }>({
    id: "await-not-yet",
    category: "next-step",
    audience: "all",
    when: "`await` times out before its condition holds.",
    example: {
      summary: "`agent/upload-retry` has no valid Proof yet",
      seconds: 45,
      command: discernCommand(
        "await",
        flag("resume", "C1-7K3M-PQ9D-YM"),
        flag("timeout", "45"),
      ),
    },
    template: ({ summary, seconds, command }): string =>
      `Not yet: ${summary}. Continue this same watch once for up to ` +
      `${seconds}s: ${command}. It returns as soon as the condition holds. ` +
      "If it is still not met, use the next --resume command; do not restart " +
      "the condition or stop after a fixed number of retries.",
  }),

  /** The honest refusal when `--green` is asked about a branch no checkout
   * holds: the Proof lives in per-worktree state, destroyed with the
   * checkout (a reclaimed contained worktree is the usual shape), so the
   * condition can never become true — the pointer names the target that can
   * answer instead. */
  "await-green-no-worktree": defineHint<{
    branch: string;
    trunk: string;
    containing: string | undefined;
    reachable: boolean;
  }>({
    id: "await-green-no-worktree",
    category: "next-step",
    audience: "all",
    when:
      "`await --green` names a branch whose checkout is gone at call start.",
    example: {
      branch: "agent/upload-retry",
      trunk: "main",
      containing: "agent/upload-retry-stage-2",
      reachable: false,
    },
    template: ({ branch, trunk, containing, reachable }): string => {
      if (containing !== undefined) {
        return `\`${branch}\`'s committed work is contained in ` +
          `\`${containing}\` — await that stage instead: ${
            discernCommand("await", flag("green", containing))
          }. For the literal arrival question, ${
            discernCommand("await", flag("landed", branch))
          } answers against \`${trunk}\`.`;
      }
      if (reachable) {
        return `\`${branch}\`'s tip is already reachable from \`${trunk}\` — ` +
          `${
            discernCommand("await", flag("landed", branch))
          } answers immediately and chooses the right next step for your location.`;
      }
      return `Check ${CMD.status} from the main checkout; to wait for the ` +
        `work to reach \`${trunk}\` use ${
          discernCommand("await", flag("landed", branch))
        }.`;
    },
  }),

  /** The honest refusal when the awaited branch does not resolve at call
   * start — there is no tip left to pin and watch. */
  "await-branch-missing": defineHint<{ branch: string; trunk: string }>({
    id: "await-branch-missing",
    category: "next-step",
    audience: "all",
    when: "`await` is asked to watch a branch that does not exist.",
    example: { branch: "agent/upload-retry", trunk: "main" },
    template: ({ branch, trunk }): string =>
      `Branch \`${branch}\` was not found, and no landing Proof identifies ` +
      `it on \`${trunk}\`. It may not have started yet. Check ${CMD.status} ` +
      "and use the exact branch returned when it starts; never guess " +
      "a generated suffix.",
  }),

  /** A watch cannot choose how a repository should acquire its missing trunk. */
  "await-trunk-missing": defineHint<{ trunk: string }>({
    id: "await-trunk-missing",
    category: "next-step",
    audience: "all",
    when: "`await` cannot resolve the configured trunk branch locally.",
    family: "await-missing-target",
    example: { trunk: "main" },
    template: ({ trunk }): string =>
      `Fetch or create the configured trunk branch \`${trunk}\`, or correct ` +
      "`[repository].trunk`, then restart the watch with its condition.",
  }),

  "patterns-logbook-empty": defineHint({
    id: "patterns-logbook-empty",
    category: "notice",
    audience: "all",
    when: "`patterns` finds no recorded logbook events.",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("patterns")
      } after the logbook records more verb runs. ` +
      "The logbook currently has no events; discern stores one local event per verb run under the repository's git directory.",
  }),

  "patterns-insufficient-evidence": defineHint<{
    young: number;
    total: number;
  }>({
    id: "patterns-insufficient-evidence",
    category: "notice",
    audience: "all",
    when: "One or more pattern detectors lack their minimum evidence.",
    example: { young: 4, total: 10 },
    template: ({ young, total }): string =>
      `${young} of ${total} detectors do not yet have their minimum evidence. ` +
      `Each reports insufficient evidence and makes no finding.`,
  }),

  "patterns-advisory-findings": defineHint({
    id: "patterns-advisory-findings",
    category: "next-step",
    audience: "all",
    when: "`patterns` reports one or more advisory findings.",
    example: undefined,
    template: (): string =>
      "Use each finding's next step to investigate or improve the practice.",
  }),

  "patterns-findings-capped": defineHint<{
    shown: number;
    total: number;
  }>({
    id: "patterns-findings-capped",
    category: "notice",
    audience: "all",
    when: "`patterns` elides findings beyond each detector's per-report bound.",
    example: { shown: 42, total: 93 },
    template: ({ shown, total }): string =>
      `The report keeps each detector's strongest findings — ${shown} of ` +
      `${total} shown, and every detector row still counts everything it ` +
      `found. ${
        discernCommand("patterns", flag("all"))
      } reports the complete list.`,
  }),

  "patterns-recording-off": defineHint({
    id: "patterns-recording-off",
    category: "notice",
    audience: "all",
    when: "`patterns` runs while logbook recording is off.",
    example: undefined,
    template: (): string =>
      "Recording is off ([project].logbook = false), so new runs aren't " +
      "recorded. This report reads the history that already exists.",
  }),

  "patterns-archive-selection": defineHint({
    id: "patterns-archive-selection",
    category: "next-step",
    audience: "all",
    when:
      "`patterns --logbook-file` cannot resolve a regular sealed archive basename.",
    family: "patterns-archive",
    example: undefined,
    template: (): string =>
      `${
        ownerDiscernCommand("patterns archives")
      } lists the sealed archive filenames that can be read.`,
  }),

  "patterns-lifecycle-confirmation": defineHint({
    id: "patterns-lifecycle-confirmation",
    category: "next-step",
    audience: "all",
    when:
      "A Logbook reset or archive apply is requested outside an eligible terminal.",
    family: "patterns-lifecycle",
    example: undefined,
    template: (): string =>
      "Use --dry-run to inspect the plan without interaction, or re-run apply from terminal stdin and stdout outside CI and --plain, then explicitly answer Yes.",
  }),

  "patterns-reset-empty": defineHint({
    id: "patterns-reset-empty",
    category: "notice",
    audience: "all",
    when: "`patterns reset` finds no logbook to remove.",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "No logbook exists to remove because nothing has been recorded.",
  }),

  "patterns-reset-preview": defineHint({
    id: "patterns-reset-preview",
    category: "next-step",
    audience: "all",
    when: "`patterns reset --dry-run` previews a logbook deletion.",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "Run without `--dry-run` to delete the logbook. This preview removed nothing.",
  }),

  "patterns-reset-recording-resumes": defineHint({
    id: "patterns-reset-recording-resumes",
    category: "notice",
    audience: "all",
    when:
      "`patterns reset` deletes the logbook while recording remains enabled.",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "Set [project].logbook = false to stop recording. Otherwise, recording " +
      "resumes on the next verb run after this reset.",
  }),

  /**
   * The Proof-tail finding: one strongest current-branch observation plus the
   * count and the route to the full evidence report.
   */
  "logbook-proof-finding": defineHint<{
    count: number;
    summary: string;
  }>({
    id: "logbook-proof-finding",
    category: "next-step",
    audience: "all",
    when: "Proof carries the strongest current-branch logbook finding.",
    family: "logbook-inline-finding",
    example: {
      count: 2,
      summary: "This branch has repeated the same failed stage.",
    },
    template: ({ count, summary }): string =>
      `Run ${
        discernCommand("patterns")
      } for full evidence and next steps. The logbook ` +
      `has ${count} branch finding${count === 1 ? "" : "s"}. ${summary}`,
  }),

  /** A session-scoped finding rendered as its summary and next step. */
  "logbook-status-finding": defineHint<{
    summary: string;
    next: string;
  }>({
    id: "logbook-status-finding",
    category: "next-step",
    audience: "all",
    when: "`status` carries a session-scoped logbook finding.",
    family: "logbook-inline-finding",
    example: {
      summary: "The same worktree has been refused 3 times.",
      next: "Inspect its current branch and Proof.",
    },
    template: ({ summary, next }): string =>
      `${next} Logbook finding: ${summary}`,
  }),

  /** The audit names its missing input instead of reading as a clean bill. */
  "improvement-logbook-off": defineHint({
    id: "improvement-logbook-off",
    category: "notice",
    audience: "all",
    when:
      "`improvement` runs while logbook recording is off, so the practice-history group has nothing to read.",
    example: undefined,
    template: (): string =>
      "Practice-history findings aren't available because `[project].logbook` is off.",
  }),

  /** A failed score threshold recovers through the report's ranked action, not
   * through the threshold message alone. */
  "improvement-follow-next-action": defineHint({
    id: "improvement-follow-next-action",
    category: "next-step",
    audience: "all",
    when: "`improvement --min-score` reports a score below its threshold.",
    family: "improvement-recovery",
    example: undefined,
    template: (): string =>
      "Carry out the report's ranked next action, then re-run the same improvement command to measure the result against its threshold.",
    interactiveTemplate: (): string =>
      "Carry out the report's ranked next action, then re-run the same " +
      "improvement command to measure the result against its threshold.",
  }),

  /**
   * Gate context for the shared unfinished-setup action. Gate verbs run during
   * setup, but their output is not the final project verdict yet.
   */
  "setup-unfinished-gate": defineHint({
    id: "setup-unfinished-gate",
    category: "guardrail",
    audience: "all",
    when: "A gate verb runs before setup has completed.",
    family: "setup-unfinished",
    example: undefined,
    template: (): string =>
      setupUnfinishedHint(
        `Gate commands are useful during setup, but their output is provisional. Only ${CMD.setupDone} validates the gate and records setup completion.`,
      ),
  }),

  /** A successful job emitted enough error-like output to warrant inspection. */
  "gate-job-loud-success": defineHint<{
    label: string;
    errorLikeLines: number;
    outputLines: number;
    outputPath: string | undefined;
  }>({
    id: "gate-job-loud-success",
    category: "notice",
    audience: "all",
    when: "A gate job passes after producing substantial error-like output.",
    example: {
      label: "lint",
      errorLikeLines: 12,
      outputLines: 80,
      outputPath: "/tmp/discern-job-lint.log",
    },
    template: ({ label, errorLikeLines, outputLines, outputPath }): string => {
      const where = outputPath === undefined
        ? "captured output"
        : `output at ${outputPath}`;
      return `Review ${label}'s ${where}. It passed but printed ` +
        `${errorLikeLines} error-like line${
          errorLikeLines === 1 ? "" : "s"
        } across ${outputLines} output line${outputLines === 1 ? "" : "s"}.`;
    },
  }),

  /** A trivial test pass when no test-stage job is wired. */
  "test-job-not-configured": defineHint({
    id: "test-job-not-configured",
    category: "notice",
    audience: "all",
    when: "`test` runs with no configured test-stage job.",
    example: undefined,
    template: (): string =>
      'Set [jobs].test = "<command>" in discern.toml to run tests. No test job is configured.',
  }),

  "gate-trunk-advanced": defineHint({
    id: "gate-trunk-advanced",
    category: "next-step",
    audience: "all",
    when: "The trunk advances while the gate is running.",
    example: undefined,
    template: (): string =>
      `Run ${CMD.update}, then ${CMD.done} again before ${CMD.accept}. ` +
      "The trunk advanced while the gate ran, so this branch is behind even " +
      "though the gate passed for this HEAD.",
  }),

  "gate-test-run-queued": defineHint<{
    cap: number;
    inFlight: string | undefined;
    typical: string | undefined;
    logbookOff: boolean;
  }>({
    id: "gate-test-run-queued",
    category: "notice",
    audience: "all",
    when:
      "A test-stage run arrives with every [gate].concurrent_test_runs slot held.",
    example: {
      cap: 1,
      inFlight: "done on agent/fix-upload-retry",
      typical: "3m",
      logbookOff: false,
    },
    template: ({ cap, inFlight, typical, logbookOff }): string => {
      const queued = `Tests queued: ${cap} of ${cap} concurrent test runs ` +
        `in use across this repository's checkouts ` +
        `([gate].concurrent_test_runs); the tests start the moment a slot ` +
        `frees.`;
      const flight = inFlight === undefined
        ? ""
        : ` In flight: ${inFlight}${
          typical === undefined ? "" : `, typically ~${typical}`
        }.`;
      const estimate = logbookOff
        ? " The logbook is off ([project].logbook = false), so there is no " +
          "wait estimate."
        : "";
      return `${queued}${flight}${estimate}`;
    },
  }),

  "gate-test-slots-unavailable": defineHint<{ reason: string }>({
    id: "gate-test-slots-unavailable",
    category: "notice",
    audience: "all",
    when:
      "[gate].concurrent_test_runs is set but the slot files under .git could not be prepared.",
    example: { reason: "could not create the slot directory" },
    template: ({ reason }): string =>
      `The concurrent test-run cap is not enforced for this run: ${reason}. ` +
      `The tests run uncapped.`,
  }),

  "gate-standards-limits-unverified": defineHint<{
    reason: string;
    trunk: string;
  }>({
    id: "gate-standards-limits-unverified",
    category: "next-step",
    audience: "all",
    when: "The gate cannot compare standard limits with the trunk.",
    family: "standards-limits-unverified",
    example: { reason: "the local branch is missing", trunk: "main" },
    template: ({ reason, trunk }): string =>
      `Standards limits are UNVERIFIED. Fetch the trunk where the gate runs so ` +
      `the limits can be verified. In CI, ` +
      `run \`git fetch origin ${trunk}:${trunk}\`. The never-loosen check could ` +
      `not read the trunk (${reason}).`,
  }),

  "gate-proof-skipped-dirty": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-proof-skipped-dirty",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot record Proof because the worktree is dirty.",
    family: "gate-proof",
    example: { reason: "2 tracked files changed" },
    template: ({ reason }): string =>
      `Use ${CMD.prepare} or ${CMD.test} while iterating. Then commit ` +
      `the intended final tree and re-run ${CMD.done} on the clean HEAD before ` +
      `handoff or acceptance. The gate passed but recorded no Proof because ` +
      `the worktree is dirty${reasonSuffix(reason)}.`,
  }),

  "gate-proof-head-moved": defineHint<{ reason: string | undefined }>({
    id: "gate-proof-head-moved",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot record Proof because the branch tip moved.",
    family: "gate-proof",
    example: { reason: "HEAD changed from a1b2c3d to d4e5f6a" },
    template: ({ reason }): string =>
      `Re-run ${CMD.done} on the final commit before handoff or acceptance. ` +
      `The gate passed but recorded no Proof because HEAD moved while it ran${
        reasonSuffix(reason)
      }. A Proof can vouch only for the exact tree the gate tested.`,
  }),

  "gate-proof-record-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-proof-record-failed",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot write Proof.",
    family: "gate-proof",
    example: { reason: "the Proof file could not be written" },
    template: ({ reason }): string =>
      `Run ${CMD.done} again later to record Proof. The gate passed, ` +
      `but discern could not record one${reasonSuffix(reason)}. Until then, ` +
      `${CMD.accept} will re-run the gate.`,
  }),

  "gate-proof-unavailable": defineHint<{ reason: string | undefined }>({
    id: "gate-proof-unavailable",
    category: "notice",
    audience: "all",
    when: "A green gate cannot prepare Proof state.",
    family: "gate-proof",
    example: { reason: "write authority was not established" },
    template: ({ reason }): string =>
      `Gate passed, but discern could not prepare Proof${
        reasonSuffix(reason)
      }. ${CMD.accept} may need to re-run the gate.`,
  }),

  "gate-proof-clear-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-proof-clear-failed",
    category: "next-step",
    audience: "all",
    when: "The gate cannot clear obsolete Proof.",
    family: "gate-proof",
    example: { reason: "the Proof file could not be removed" },
    template: ({ reason }): string =>
      `Fix the failure, then re-run ${CMD.done}. discern could not clear the ` +
      `previous Proof${reasonSuffix(reason)}.`,
  }),

  "done-unchanged-tree-red": defineHint({
    id: "done-unchanged-tree-red",
    category: "next-step",
    audience: "all",
    when:
      "`done` is asked to re-run on the exact tree it last judged red, without `--confirmed`.",
    family: "done-rerun",
    followThrough: RED_GATE_FOLLOW_THROUGH,
    example: undefined,
    template: (): string =>
      `Fix the failure the last run reported, iterating with ${CMD.prepare} ` +
      `or ${CMD.test}, then re-run ${CMD.done} — nothing ` +
      "changed since it judged this exact tree red, so an identical rerun " +
      "expects the identical verdict. Use the confirmed rerun only to probe " +
      `for a flaky verdict: ${
        discernCommand("done", flag("confirmed"))
      } does that, and ` +
      "records the rerun as a probe.",
  }),

  "done-unchanged-tree-green": defineHint({
    id: "done-unchanged-tree-green",
    category: "next-step",
    audience: "all",
    when:
      "`done` is asked to re-run on the exact tree it last judged green, without `--confirmed`.",
    family: "done-rerun",
    example: undefined,
    template: (): string =>
      `Run ${CMD.status} — this exact tree already passed ${CMD.done}, ` +
      "and status shows whether Proof remains valid without re-running anything. " +
      `To re-run the full gate on it anyway, run ${
        discernCommand("done", flag("confirmed"))
      }.`,
  }),

  "checkpoint-declare": defineHint<{ ids: string[] }>({
    id: "checkpoint-declare",
    category: "next-step",
    audience: "all",
    when:
      "`done` refuses because a governing stop checkpoint has no current conclusion.",
    family: "checkpoint-declaration",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Judge each criterion above against its changed paths, then record your ` +
      `conclusion and re-run the gate in one step: ${
        discernCommand("done", flag("met", "<id>"))
      } (repeatable) for a criterion your change satisfies, or ${
        discernCommand("done", flag("unmet", "<id>"))
      } with its required one-paragraph rationale (one per invocation) to ` +
      `record that it is not satisfied — the gate still runs, and the owner ` +
      `decides at landing. Awaiting: ${ids.join(", ")}.`,
  }),

  "checkpoint-advise": defineHint<
    { id: string; criterion: string; matched: string[] }
  >({
    id: "checkpoint-advise",
    category: "notice",
    audience: "all",
    when:
      "An advise-mode checkpoint's trigger fired; its criterion is served without blocking.",
    family: "checkpoint-advise",
    example: {
      id: "deletion-heavy-change",
      criterion: "Is the cut proven dead, and recovery bounded?",
      matched: ["src/legacy_module.ext"],
    },
    template: ({ id, criterion, matched }): string => {
      const shown = matched.slice(0, 4).join(", ");
      const more = matched.length > 4 ? `, +${matched.length - 4} more` : "";
      return `Checkpoint '${id}' (advisory — nothing blocks): ${criterion} ` +
        `Changed: ${shown}${more}.`;
    },
  }),

  "checkpoint-advisory": defineHint<{ advisory: string }>({
    id: "checkpoint-advisory",
    category: "notice",
    audience: "all",
    when:
      "A checkpoint could not govern or fire (unreadable state, a failing when command) and failed open.",
    example: {
      advisory:
        "checkpoint 'api-review': the when command did not finish within 10s; the trigger fails open and did not fire.",
    },
    template: ({ advisory }): string => `Checkpoint fail-open: ${advisory}`,
  }),

  "gate-variance-required": defineHint<{ ids: string[] }>({
    id: "gate-variance-required",
    category: "notice",
    audience: "all",
    when:
      "The gate passed while a declared-unmet checkpoint conclusion stands.",
    family: "checkpoint-variance",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `A declared-unmet conclusion stands on: ${ids.join(", ")}. The gate is ` +
      `green, but landing needs the owner to authorize each variance in the ` +
      `current conversation — recorded grants never cover one. Relay the ` +
      `Proof and the rationale; the decision is served at ${CMD.accept}.`,
  }),

  "accept-declarations-stale": defineHint<{ ids: string[] }>({
    id: "accept-declarations-stale",
    category: "next-step",
    audience: "all",
    when:
      "`accept` finds a governing stop checkpoint whose conclusion is missing or no longer current.",
    family: "checkpoint-declaration",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Run ${CMD.done} — it serves each checkpoint's criterion and evidence ` +
      `and records your conclusion (${MET_FLAG}, or ${UNMET_FLAG} with ` +
      `${WHY_FLAG}). Missing or stale: ${ids.join(", ")}.`,
  }),

  "accept-authorize-variance": defineHint<{ ids: string[] }>({
    id: "accept-authorize-variance",
    category: "next-step",
    audience: "all",
    when:
      "`accept` refuses because a current declared-unmet conclusion has no owner-authorized variance.",
    family: "checkpoint-variance",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Relay each criterion and rationale above to the owner. Once the owner ` +
      `accepts the landing AND each named variance in the current ` +
      `conversation, re-run ${
        discernCommand(
          "accept",
          flag("confirmed"),
          ...ids.map((id) => flag("variance", id)),
        )
      }. Recorded standing and effort grants never authorize a variance.`,
  }),

  "gate-failure-gotchas": defineHint<
    { command: CommandRef; path?: never } | { path: string; command?: never }
  >({
    id: "gate-failure-gotchas",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure occurs, the project configures a gotchas document, and no trap matcher matches the failure.",
    family: "gotchas-doc",
    example: {
      command: discernCommand(
        "map",
        positional("target", "80-development/done-gate-gotchas"),
        flag("json"),
      ),
    },
    template: (reference): string =>
      reference.command !== undefined
        ? `If the result message and diagnostics do not explain the failure, run ${reference.command} to read this project's known gate failures and their fixes.`
        : `If the result message and diagnostics do not explain the failure, read this project's known gate failures and fixes in \`${reference.path}\`.`,
  }),

  /**
   * The inlined trap (ADR 0189): a matcher in the gotchas doc recognized this
   * failure, so the entry's own prose replaces the generic pointer — the fix
   * arrives inside the failure instead of one fetch away. The body is bounded
   * by the gotchas surface before firing.
   */
  "gate-failure-gotcha-matched": defineHint<
    & { title: string; body: string }
    & ({ command: CommandRef; path?: never } | {
      path: string;
      command?: never;
    })
  >({
    id: "gate-failure-gotcha-matched",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure matches a trap matcher in the configured gotchas document.",
    family: "gotchas-doc",
    example: {
      title: "A command hangs, then fails with a timeout",
      body:
        "**Symptom.** The gate sits on a stage with no output, then fails it after the timeout.\n\n**Fix.** Wire the command in its single-run form.",
      command: discernCommand(
        "map",
        positional("target", "80-development/done-gate-gotchas"),
        flag("json"),
      ),
    },
    template: ({ title, body, ...reference }): string =>
      `This failure matches "${title}", a documented trap in this project's gate gotchas:\n\n${body}\n\n` +
      (reference.command !== undefined
        ? `Read the full page with ${reference.command}.`
        : `The full page is \`${reference.path}\`.`),
  }),

  /**
   * A malformed trap matcher, surfaced whenever the doc is consulted: a bad
   * block must warn by entry name, never skip without a trace (ADR 0189).
   */
  "gotchas-matcher-invalid": defineHint<{ entry: string; problem: string }>({
    id: "gotchas-matcher-invalid",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure consults a gotchas document carrying a malformed trap matcher.",
    family: "gotchas-doc",
    example: {
      entry: "A command hangs, then fails with a timeout",
      problem: '`stage` is "timeout", which is not a gate stage',
    },
    template: ({ entry, problem }): string =>
      `Fix the \`gotcha-match\` block in the gotchas entry "${entry}": ${problem}. Until it parses, the entry cannot match failures.`,
  }),

  /** The diagnostic-driven remedy for a failed fix stage, which prepare re-runs. */
  "gate-failure-fix": defineGateFailureRemedyHint({
    id: "gate-failure-fix",
    category: "next-step",
    audience: "all",
    when: "The gate's fix stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_PREPARE_REMEDY_CORE,
  }),

  /** The build-stage remedy: prepare never builds, so the loop is the
   * diagnostic's own reproduce command. */
  "gate-failure-build": defineHint({
    id: "gate-failure-build",
    category: "next-step",
    audience: "all",
    when: "The gate's build stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_REPRODUCE_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a standalone check-stage failure. */
  "gate-failure-check": defineGateFailureRemedyHint({
    id: "gate-failure-check",
    category: "next-step",
    audience: "all",
    when: "A standalone gate check fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_PREPARE_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a standalone test-stage failure. */
  "gate-failure-test": defineGateFailureRemedyHint({
    id: "gate-failure-test",
    category: "next-step",
    audience: "all",
    when: "A standalone test run fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_TEST_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for the full gate's combined check/test stage. */
  "gate-failure-check-test": defineGateFailureRemedyHint({
    id: "gate-failure-check-test",
    category: "next-step",
    audience: "all",
    when: "The full gate's combined check and test stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_CHECK_TEST_REMEDY_CORE,
  }),

  /** The changed-scope remedy: a scope gate's check runs only in the full
   * gate, so the loop is the diagnostic's own reproduce command. */
  "gate-failure-scope-gates": defineHint({
    id: "gate-failure-scope-gates",
    category: "next-step",
    audience: "all",
    when: "One or more changed-scope gates fail.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `${GATE_REPRODUCE_REMEDY_CORE} One or more scope gates failed.`,
  }),

  /** A gate stage changed a committed-clean tracked file. */
  "gate-failure-tree-drift": defineHint({
    id: "gate-failure-tree-drift",
    category: "next-step",
    audience: "all",
    when: "A gate stage changes a tracked file from a committed-clean tree.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Review and commit the gate-produced tracked changes named by the diagnostics, then re-run the current discern command.",
  }),

  /** A declared generator changed one or more artifacts it owns. */
  "gate-failure-generated-drift": defineHint<GeneratedDriftRemedyParams>({
    id: "gate-failure-generated-drift",
    category: "next-step",
    audience: "all",
    when:
      "A declared generator changes one or more committed artifacts it owns.",
    family: "gate-failure-remedy",
    example: {
      group: "reference",
      run: "tool write-reference --source source/ --output reference/",
    },
    template: ({ group, run }): string =>
      `Generated group ${
        markdownCodeSpan(`[generated.${group}]`)
      } drifted. Run ${
        markdownCodeSpan(run)
      }, commit the regeneration, then re-run ${CMD.done}. If the tree goes dirty again immediately after you commit that regeneration, the generator is nondeterministic: the same tree did not produce the same bytes. Fix the generator before re-running.`,
  }),

  /** A tracked artifact would change under the current refresh plan. */
  "gate-failure-refresh-drift": defineHint({
    id: "gate-failure-refresh-drift",
    category: "next-step",
    audience: "all",
    when: "The read-only tracked-refresh plan finds an uncommitted effect.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh}, review and commit the tracked artifacts named by the diagnostics, then re-run the current discern command.`,
  }),

  /** A generated command changed paths outside every declared ownership glob. */
  "gate-failure-generated-undercoverage": defineHint<
    GeneratedUndercoverageRemedyParams
  >({
    id: "gate-failure-generated-undercoverage",
    category: "next-step",
    audience: "all",
    when: "Build changes paths that no generated group declares.",
    family: "gate-failure-remedy",
    example: { groups: ["reference", "schemas"] },
    template: ({ groups }): string =>
      `Generated output escaped every declared glob. Widen the responsible group's paths to include the files named by the diagnostic, commit the regeneration, then re-run ${CMD.done}. Candidate groups: ${
        boundedNameSummary(
          groups.length,
          groups.map((group) => markdownCodeSpan(`[generated.${group}]`)),
        )
      }.`,
  }),

  /** discern-managed ignored output was committed to the repository. */
  "gate-failure-tracked-artifacts": defineHint({
    id: "gate-failure-tracked-artifacts",
    category: "next-step",
    audience: "all",
    when: "The gate finds tracked discern-managed ignored artifacts.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Remove the discern-managed ignored artifacts named by the diagnostics from the Git index, run ${CMD.refresh}, then re-run the current discern command.`,
  }),

  /** Compiled agent instructions differ from their authored sources. */
  "gate-failure-instructions": defineHint({
    id: "gate-failure-instructions",
    category: "next-step",
    audience: "all",
    when: "The gate finds compiled instruction drift.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh}, then re-run the current discern command. If the instructions must change, edit \`[instructions].sources\`. Refresh overwrites agent files.`,
  }),

  /** Materialized skills differ from the effective authored set. */
  "gate-failure-skills": defineHint({
    id: "gate-failure-skills",
    category: "next-step",
    audience: "all",
    when: "The gate finds materialized skill drift.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh}, then re-run the current discern command. If a skill must change, edit its source in \`[skills].dir\`. Refresh overwrites materialized copies.`,
  }),

  /** An effective skill cannot be read by supported agent runtimes. */
  "gate-failure-skill-frontmatter": defineHint({
    id: "gate-failure-skill-frontmatter",
    category: "next-step",
    audience: "all",
    when: "The gate finds invalid frontmatter in an effective skill.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Fix each SKILL.md source named by the diagnostics, then re-run the current discern command. Coding-agent runtimes cannot read invalid frontmatter.",
  }),

  /** Two ADR records claim the same number. */
  "gate-failure-adr-numbers": defineHint({
    id: "gate-failure-adr-numbers",
    category: "next-step",
    audience: "all",
    when: "Two or more ADR records in the tree claim the same number.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Renumber the newer of the duplicated ADR records named by the diagnostics to the next free number (update its filename, title, and any references to it), then re-run the current discern command. An ADR number identifies one decision forever — records that landed first, and superseded records, keep theirs.",
  }),

  /** The maintained ADR index drifted from (or cannot be derived from) the records. */
  "gate-failure-adr-index": defineHint({
    id: "gate-failure-adr-index",
    category: "next-step",
    audience: "all",
    when:
      "The maintained ADR index is out of date, or a record defeats its derivation.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh} to regenerate the ADR index, commit the rewritten README, then re-run the current discern command. If the diagnostic says the index cannot be derived, first fix the named record heading or incomplete marker pair. Then refresh again.`,
  }),

  /** The map or a instruction source carries a reference readers cannot follow. */
  "gate-failure-map-integrity": defineHint({
    id: "gate-failure-map-integrity",
    category: "next-step",
    audience: "all",
    when:
      "The gate finds a broken reference or stale example in the map or a instruction source.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Fix each documentation finding named by the diagnostics: repoint dead links and anchors, repair the metadata block, update stale `discern` examples, keep published pages out of the internal trees, and make skill citations name skills that exist. Then re-run the current discern command.",
  }),

  /** The worktree branch does not contain the current trunk. */
  "gate-failure-merge": defineHint({
    id: "gate-failure-merge",
    category: "next-step",
    audience: "all",
    when: "The worktree branch does not contain the current trunk.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.update} to bring the trunk into this branch and re-materialize, then re-run ${CMD.done}.`,
  }),

  /** A branch attempted to weaken a standard held by the trunk. */
  "gate-failure-standards": defineHint({
    id: "gate-failure-standards",
    category: "next-step",
    audience: "all",
    when: "The branch weakens a standard limit held by the trunk.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Follow the standards diagnostics, then re-run the current discern command. Do not weaken a trunk limit on this branch. Moving a limit is an owner decision made on the trunk.",
  }),

  /** The gate cannot persist its discern-owned state. */
  "gate-failure-write-access": defineHint({
    id: "gate-failure-write-access",
    category: "next-step",
    audience: "all",
    when: "The gate cannot write discern-owned state.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Grant the write access named by the diagnostics, then re-run the current discern command. The gate needs that access to persist its state.",
  }),

  /** Proof covers the configured checks and leaves artifact verification to
   * the agent. Fired on a green run that emitted Proof before completion is
   * claimed. Carries the discipline of the retired
   * prove-it-works bundled skill (ADR 0173) at the moment it applies. */
  "gate-prove-it-works": defineHint({
    id: "gate-prove-it-works",
    category: "guardrail",
    audience: "agent",
    when: "A green gate emits Proof before the agent reports completion.",
    example: undefined,
    template: (): string =>
      "Proof covers the gate's configured checks. Before reporting completion, exercise the real artifact along the paths the change enables, then report what you ran and what you observed.",
  }),

  /** The owner-consent step after a green gate. Agent-audience: reporting to an
   * owner and waiting is an agent's move — a person running `done` at a
   * terminal IS the owner, with nobody further to report to. The composition
   * contract (account first, one-line Proof last, page stays with discern)
   * is ADR 0188's. */
  "gate-relay-proof": defineHint({
    id: "gate-relay-proof",
    category: "next-step",
    audience: "agent",
    when: "A successful gate records Proof ready for owner review.",
    example: undefined,
    template: (): string =>
      "If this completes the task, report the change, trade-offs, and artifact checks to your owner. End with the result's Proof line verbatim and stop. Your owner can retrieve the full Proof with " +
      `${OWNER_STATUS_VERBOSE}. Run ${CMD.accept} only after they accept.`,
  }),

  /** A green Proof whose exact tree the authority resolver covered. */
  "gate-land-under-verified-authority": defineHint<{
    source: LandingConsentSource;
    scopes: readonly string[];
  }>({
    id: "gate-land-under-verified-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A successful gate records Proof for a tree with machine-verified landing authority.",
    family: "landing-authority",
    example: { source: "standing-grant", scopes: ["map"] },
    template: ({ source, scopes }): string =>
      source === "effort-grant"
        ? `The owner pre-authorized this landing at the desk, and Proof covers the clean HEAD. Run ${CMD.accept} now to land it; acceptance rechecks the grant before the fast-forward. Report the landing with its Proof line afterward.`
        : `The clean HEAD named by Proof is covered by the standing grant for ${
          scopes.join(", ")
        }. Run ${CMD.accept} now to land it; acceptance rechecks every changed path before the fast-forward. Report the landing with its Proof line afterward.`,
  }),

  /** A green Proof whose recorded authority left changed paths uncovered. */
  "gate-relay-uncovered-authority": defineHint({
    id: "gate-relay-uncovered-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A successful gate records Proof but recorded authority does not cover its tree.",
    family: "landing-authority",
    example: undefined,
    template: (): string =>
      `Report this task to your owner in your own words, end with the ` +
      `result's Proof line verbatim, and stop: the recorded grant does not ` +
      `cover this landing. Your owner can retrieve the full Proof with ${OWNER_STATUS_VERBOSE}.`,
  }),

  "gate-update-docs": defineHint({
    id: "gate-update-docs",
    category: "next-step",
    audience: "all",
    when: "A gate run succeeds.",
    example: undefined,
    template: (): string =>
      "Before reporting completion, compare the changed behavior with the map pages that cover the edited files. Update every page whose facts changed.",
  }),

  "gate-deferred-standards": defineHint<{ names: readonly string[] }>({
    id: "gate-deferred-standards",
    category: "next-step",
    audience: "all",
    when: "A successful gate leaves one or more standards deferred.",
    example: { names: ["coverage", "binary_size"] },
    template: ({ names }): string =>
      `Measure ${names.length} deferred standard${
        names.length === 1 ? "" : "s"
      } with ${discernCommand("standards")} as needed: ${
        boundedNameSummary(names.length, names)
      }. Their ` +
      `measurements are on demand, but the never-loosen limit check still ran.`,
  }),

  "gate-previewable-change": defineHint({
    id: "gate-previewable-change",
    category: "next-step",
    audience: "all",
    when: "A successful gate includes a change that has a configured preview.",
    example: undefined,
    template: (): string =>
      "This change touches a previewable scope. Preview it from this worktree with the project's documented development-server workflow.",
  }),

  /** The pin pass has no configured metric to measure or tighten. */
  "standards-pin-empty": defineHint({
    id: "standards-pin-empty",
    category: "notice",
    audience: "all",
    when: "`standards --pin` finds no configured standards.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "No standards configured, so there is nothing to pin.",
  }),

  /** Pin previews honor the universal dry-run contract and measure nothing. */
  "standards-pin-dry-run": defineHint({
    id: "standards-pin-dry-run",
    category: "next-step",
    audience: "all",
    when: "`standards --pin --dry-run` previews without measuring.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("standards")
      } to measure once and find pinnable slack. Then run ` +
      `${
        discernCommand("standards", flag("pin"))
      } on the same clean commit to reuse those ` +
      "measurements. A pin dry-run measures nothing.",
  }),

  /** A same-commit check Proof supplied every measurement for the pin pass. */
  "standards-pin-reused-measurements": defineHint({
    id: "standards-pin-reused-measurements",
    category: "notice",
    audience: "all",
    when: "`standards --pin` reuses measurements from same-commit check Proof.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "Reused the green check's measurements for this commit. Nothing was re-measured.",
  }),

  /** A red standard blocks the whole pin rather than capturing a failing state. */
  "standards-pin-blocked": defineHint<{
    failingNames: readonly string[];
  }>({
    id: "standards-pin-blocked",
    category: "next-step",
    audience: "all",
    when: "`standards --pin` finds one or more failing standards.",
    family: "standards-pin",
    example: { failingNames: ["coverage", "bundle_size"] },
    template: ({ failingNames }): string => {
      const named = failingNames.length > 0
        ? boundedNameSummary(failingNames.length, failingNames)
        : "a standard";
      const singular = failingNames.length <= 1;
      return `Fix ${named}, then re-run ${
        discernCommand("standards", flag("pin"))
      } once green. ${
        singular ? "It is" : "They are"
      } failing, and diagnostics[] carries ${
        singular ? "the reason" : "each reason"
      }. No limits were pinned.`;
    },
  }),

  /** Every selected standard already equals its measured, margin-adjusted limit. */
  "standards-pin-no-slack": defineHint({
    id: "standards-pin-no-slack",
    category: "notice",
    audience: "all",
    when: "`standards --pin` finds no tighter limit to capture.",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "Nothing to pin. Every selected standard already sits at its measured value within its margin.",
  }),

  /** The limits-only pin commit inherited the valid Proof for its parent. */
  "standards-pin-carried-proof": defineHint({
    id: "standards-pin-carried-proof",
    category: "notice",
    audience: "all",
    when: "A limits-only pin commit inherits its parent's Proof.",
    family: "standards-pin-proof",
    example: undefined,
    template: (): string =>
      `Proof now follows this pin commit. ${CMD.accept} will skip the redundant gate re-run.`,
  }),

  /** The pin commit had no valid Proof available to carry forward. */
  "standards-pin-no-proof": defineHint({
    id: "standards-pin-no-proof",
    category: "next-step",
    audience: "all",
    when: "A pin commit has no honored Proof to carry forward.",
    family: "standards-pin-proof",
    example: undefined,
    template: (): string =>
      `Run ${CMD.done} before accepting, or acceptance will re-run the gate. No current Proof was available to carry forward.`,
  }),

  /** Standalone standards could not verify the branch limits against the trunk. */
  "standards-limits-unverified": defineHint<{
    reason: string | undefined;
  }>({
    id: "standards-limits-unverified",
    category: "next-step",
    audience: "all",
    when: "`standards` cannot compare branch limits with the trunk.",
    family: "standards-limits-unverified",
    example: { reason: "the local trunk is missing" },
    template: ({ reason }): string =>
      `Standards limits are UNVERIFIED. Fetch the trunk where standards run so ` +
      `the limits can be verified. The never-loosen check could not read it (` +
      `${reason ?? "unknown"}).`,
  }),

  /** Pinning a branch behind the trunk may capture limits that an update invalidates. */
  "standards-pin-behind": defineHint<{
    behind: string;
    trunk: string;
  }>({
    id: "standards-pin-behind",
    category: "next-step",
    audience: "all",
    when: "`standards --pin` runs on a branch behind the trunk.",
    family: "standards-pin",
    example: { behind: "2", trunk: "main" },
    template: ({ behind, trunk }): string => {
      const commits = behind === "1" ? "commit" : "commits";
      return `Run ${CMD.update} before pinning against the latest trunk. ` +
        `This worktree is ${behind} ${commits} behind ${trunk}, so its measured ` +
        "values may not survive the update.";
    },
  }),

  /** The standalone check has no configured standards to measure. */
  "standards-none-configured": defineHint({
    id: "standards-none-configured",
    category: "next-step",
    audience: "all",
    when: "`standards` finds no configured standards.",
    example: undefined,
    template: (): string =>
      "Add a [standards.<name>] table to measure a standard. No standards configured.",
  }),

  /** A green check found tighter limits that the pin pass can capture. */
  "standards-pinnable-slack": defineHint<{
    standards: readonly {
      name: string;
      bound: "floor" | "ceiling";
      limit: number;
      measured: string;
      newLimit: number;
    }[];
    proofed: boolean;
  }>({
    id: "standards-pinnable-slack",
    category: "next-step",
    audience: "all",
    when: "`standards` finds measured slack that can tighten a limit.",
    example: {
      standards: [{
        name: "coverage",
        bound: "floor",
        limit: 90,
        measured: "92.4",
        newLimit: 92.4,
      }],
      proofed: true,
    },
    template: ({ standards, proofed }): string => {
      const shown = standards.slice(0, HINT_NAME_CAP);
      const slack = shown.map((standard) =>
        `${standard.name} (${standard.bound} ${standard.limit}, measured ${standard.measured}, pinning to ${standard.newLimit})`
      );
      const summary = slack.length > 0
        ? slack.join("; ")
        : "review the reported standards";
      const remaining = Math.max(0, standards.length - shown.length);
      const overflow = remaining > 0
        ? ` ${remaining} more standard${
          remaining === 1 ? " is" : "s are"
        } eligible.`
        : "";
      return `Run ${
        discernCommand("standards", flag("pin"))
      } to capture pinnable slack: ${summary}.${overflow} ${
        proofed
          ? "On this commit, the pin reuses this check's measurements"
          : "This check already measured, so no pin dry-run is needed"
      }.`;
    },
  }),

  /**
   * First-registration lead-in to the shared restart-session lifecycle fact.
   */
  "refresh-mcp-first-install": defineHint({
    id: "refresh-mcp-first-install",
    category: "next-step",
    audience: "all",
    when:
      "`refresh` registers the Model Context Protocol server for the first time.",
    family: "restart-session",
    example: undefined,
    template: (): string =>
      restartSessionHint(
        "Restart your coding agent now, or reload its MCP servers, before trying to use the discern tools. This refresh registered the server for the first time, and the registration persists after restart.",
      ),
  }),

  /**
   * A successful refresh changed one or more tracked Agent files or Shared files.
   * The changed paths stay in `data`; this hint carries only the commit action.
   */
  "refresh-commit-tracked-artifacts": defineHint({
    id: "refresh-commit-tracked-artifacts",
    category: "next-step",
    audience: "all",
    when: "`refresh` changes tracked generated artifacts.",
    family: "refresh-result",
    example: undefined,
    template: (): string =>
      "Commit the refreshed copies with the source change that produced them.",
  }),

  /** A partial refresh reports each failed artifact with the correction and
   * the command that converges the full set again. */
  "refresh-artifact-failed": defineHint<{ message: string }>({
    id: "refresh-artifact-failed",
    category: "next-step",
    audience: "all",
    when: "`refresh` cannot reconcile one of its managed artifacts.",
    family: "refresh-result",
    example: { message: "could not update a co-owned agent config" },
    template: ({ message }): string =>
      `Fix the refresh error, then run ${CMD.refresh}: ${message}`,
  }),

  /** A successful skills eject leaves the authored override ready to edit. */
  "skills-eject-edit-override": defineHint({
    id: "skills-eject-edit-override",
    category: "next-step",
    audience: "all",
    when: "`skills eject` creates an authored override.",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("skills list")
      } to locate the authored override, then edit that source.`,
  }),

  /** Ejection succeeded, but one or more configured agent directories still
   * need the override materialized. */
  "skills-eject-finish-materialization": defineHint({
    id: "skills-eject-finish-materialization",
    category: "next-step",
    audience: "all",
    when:
      "`skills eject` writes the override but cannot materialize it everywhere.",
    family: "skills-eject-recovery",
    example: undefined,
    template: (): string =>
      `Fix every reported materialization error, then run ${CMD.refresh} ` +
      "to materialize the ejected Skill in every configured agent directory.",
    interactiveTemplate: (): string =>
      `Fix every reported materialization error, then run ${CMD.refresh} ` +
      "to materialize the ejected Skill in every configured agent directory.",
  }),

  /** The actionable retry carried by accept's read-only consent refusal. */
  "accept-awaiting-confirmation": defineHint({
    id: "accept-awaiting-confirmation",
    category: "next-step",
    audience: "all",
    when: "`accept` waits for explicit owner confirmation.",
    family: "accept-consent",
    example: undefined,
    template: (): string =>
      `Re-run ${
        discernCommand("accept", flag("confirmed"))
      } once the owner has accepted this ` +
      "landing in the current conversation. The flag attests only to that " +
      "conversation; recorded standing and effort grants are checked directly.",
  }),

  /** The status route to the Proof and raw diff needed for owner review. */
  "accept-review-via-status": defineHint({
    id: "accept-review-via-status",
    category: "next-step",
    audience: "all",
    when: "`accept` needs the Proof and diff surfaced by `status`.",
    family: "accept-consent",
    example: undefined,
    template: (): string =>
      `Run ${OWNER_STATUS_VERBOSE} to get the valid Proof for the owner's review ` +
      "and the exact `git diff` command for the raw change.",
  }),

  /** Recovery after an irreversible acceptance step follows the recorded state,
   * never a blind retry. */
  "accept-reconcile-partial-effects": defineHint({
    id: "accept-reconcile-partial-effects",
    category: "next-step",
    audience: "all",
    when: "Acceptance stops after at least one irreversible effect.",
    family: "accept-recovery",
    example: undefined,
    template: (): string =>
      "Read the reported landing state before acting. If the trunk already " +
      "landed, do not land the commit again; finish only the incomplete cleanup. " +
      `Otherwise resolve the reported failure, then run ${CMD.status} before ` +
      `attempting ${CMD.accept} again.`,
    interactiveTemplate: (): string =>
      "Read the reported landing state before acting. If the trunk already " +
      "landed, do not land the commit again; finish only the incomplete " +
      `cleanup. Otherwise resolve the failure, then run ${CMD.status} before ` +
      `attempting ${CMD.accept} again.`,
  }),

  /** Landing succeeded, but its best-effort local materialization did not. */
  "accept-refresh-failed": defineHint<{ trunk: string; mainRepo: string }>({
    id: "accept-refresh-failed",
    category: "next-step",
    audience: "all",
    when: "Landing succeeds but checkout-local materialization fails.",
    family: "post-landing-convergence",
    example: { trunk: "main", mainRepo: "/workspace/project" },
    template: ({ trunk, mainRepo }): string =>
      `Acceptance landed on ${trunk}, but checkout-local coding-agent artifacts could ` +
      `not be materialized in ${mainRepo}. Run ${CMD.refresh} there to retry and ` +
      `review any reported tracked effect before committing it.`,
  }),

  /** Post-landing convergence changed tracked files in the receiving checkout. */
  "accept-convergence-changed-tracked": defineHint<{
    trunk: string;
    mainRepo: string;
  }>({
    id: "accept-convergence-changed-tracked",
    category: "next-step",
    audience: "all",
    when:
      "Post-landing convergence changes tracked files in the receiving checkout.",
    family: "post-landing-convergence",
    example: { trunk: "main", mainRepo: "/workspace/project" },
    template: ({ trunk, mainRepo }): string =>
      `Review \`git status\` in ${mainRepo}. Acceptance landed on ${trunk}, but ` +
      `post-landing convergence changed tracked files there.`,
  }),

  /** A successful acceptance exposes the system-rendered line for the agent's
   * report; the full page stays in the durable landing record. */
  "accept-relay-landing-proof": defineHint({
    id: "accept-relay-landing-proof",
    category: "next-step",
    audience: "agent",
    when: "`accept` lands successfully and returns a one-line landing Proof.",
    example: undefined,
    template: (): string =>
      "Report the landing in your own words, then end your response with the result's Proof line verbatim. " +
      `Retrieve the full review page with ${OWNER_STATUS_VERBOSE} if a PR body needs it.`,
  }),

  /** Fetch transport is enabled, but publication stays an explicit owner-side
   * Git operation so discern never makes a network request. */
  "accept-publish-proof-note": defineHint<{ remote: string }>({
    id: "accept-publish-proof-note",
    category: "next-step",
    audience: "all",
    when: "A landing Proof note is recorded with fetch transport enabled.",
    example: { remote: "origin" },
    template: ({ remote }): string =>
      `Share this landing's Proof with other clones: ` +
      `\`git push ${remote} refs/notes/discern\`. discern records Proof ` +
      "locally; network publication occurs only through the Git command you run.",
  }),

  /** Integration-summary fallback when its read-only git census cannot complete. */
  "update-summary-fallback": defineHint<{
    source: string;
    predicted: boolean;
  }>({
    id: "update-summary-fallback",
    category: "next-step",
    audience: "all",
    when: "`update` cannot build its detailed integration summary.",
    family: "update-summary",
    example: { source: "main", predicted: false },
    template: ({ source, predicted }): string =>
      predicted
        ? `Run ${CMD.update} to apply ${source}, then ${CMD.done}. The ` +
          "detailed preview summary was unavailable."
        : `Run ${CMD.done} to verify the merged tree. The detailed ${source} ` +
          "integration summary was unavailable.",
  }),

  /**
   * Integration action when incoming changes overlap the branch's own files.
   * Full-list commands join this same hint when either data list is capped.
   */
  "update-overlap": defineHint<{
    source: string;
    overlap: readonly string[];
    overlapTotal: number;
    predicted: boolean;
    filesRange: string | undefined;
    commitsRange: { before: string; main: string } | undefined;
  }>({
    id: "update-overlap",
    category: "next-step",
    audience: "all",
    when: "`update` finds overlap between incoming and branch-owned files.",
    family: "update-summary",
    example: {
      source: "main",
      overlap: ["src/main.ts", "tests/main_test.ts"],
      overlapTotal: 2,
      predicted: false,
      filesRange: "HEAD~2..HEAD",
      commitsRange: { before: "HEAD~2", main: "main" },
    },
    template: (
      {
        source,
        overlap,
        overlapTotal,
        predicted,
        filesRange,
        commitsRange,
      },
    ): string => {
      const shown = overlap.slice(0, 5).map((path) => `\`${path}\``).join(", ");
      const more = overlapTotal > 5 ? `, … (+${overlapTotal - 5} more)` : "";
      const files = `${overlapTotal} overlapping file${
        overlapTotal === 1 ? "" : "s"
      }: ${shown}${more}.`;
      const action = predicted
        ? `Run ${CMD.update} to apply, then re-read the ${files}`
        : `Re-read the ${files}`;
      return `${action} This branch and ${source} ${
        predicted ? "both touch" : "both changed"
      } them, and a clean merge cannot catch semantic conflicts. Run ` +
        `${CMD.done} after reviewing them.` +
        updateOverflowAdvice(filesRange, commitsRange);
    },
  }),

  /**
   * Integration action when incoming and branch-owned files do not overlap.
   * Full-list commands join this same hint when either data list is capped.
   */
  "update-no-overlap": defineHint<{
    source: string;
    predicted: boolean;
    filesRange: string | undefined;
    commitsRange: { before: string; main: string } | undefined;
  }>({
    id: "update-no-overlap",
    category: "next-step",
    audience: "all",
    when: "`update` finds no overlap between incoming and branch-owned files.",
    family: "update-summary",
    example: {
      source: "main",
      predicted: false,
      filesRange: "HEAD~2..HEAD",
      commitsRange: { before: "HEAD~2", main: "main" },
    },
    template: (
      { source, predicted, filesRange, commitsRange },
    ): string => {
      const next = predicted
        ? `Run ${CMD.update} to apply, then ${CMD.done}.`
        : `Run ${CMD.done} to verify the merged tree.`;
      return `${next} No files changed by this branch overlap ${source}'s ` +
        `incoming changes.` + updateOverflowAdvice(filesRange, commitsRange);
    },
  }),

  /** A supplied start name reduced to no branch-safe characters. */
  "start-name-fallback": defineHint<{ name: string }>({
    id: "start-name-fallback",
    category: "notice",
    audience: "all",
    when: "A requested worktree name has no branch-safe characters.",
    family: "start-name",
    example: { name: "///" },
    template: ({ name }): string =>
      `Used a random codename because '${name}' has no branch-safe characters.`,
  }),

  /** A supplied start name was normalized into its branch-safe slug. */
  "start-name-normalized": defineHint<{ name: string; slug: string }>({
    id: "start-name-normalized",
    category: "notice",
    audience: "all",
    when: "A requested worktree name needs normalization.",
    family: "start-name",
    example: { name: "Hint Registry", slug: "hint-registry" },
    template: ({ name, slug }): string =>
      `Normalized the worktree name '${name}' to '${slug}'.`,
  }),

  /** Prospective authority at the moment a new effort begins. */
  "start-landing-authority": defineHint<{
    source: LandingConsentSource | undefined;
    standingScopes: string[];
    warnings: string[];
  }>({
    id: "start-landing-authority",
    category: "notice",
    audience: "agent",
    when:
      "`start` creates an effort under a recorded landing grant or finds authority evidence that needs attention.",
    family: "landing-authority",
    example: {
      source: "standing-grant",
      standingScopes: ["map"],
      warnings: [],
    },
    template: ({ source, standingScopes, warnings }): string => {
      if (source === "effort-grant") {
        return "The owner pre-authorized this effort's landing at the desk. discern will recheck that grant against the final branch before it lands.";
      }
      if (standingScopes.length > 0) {
        return `Standing landing authority is recorded for ${
          standingScopes.join(", ")
        }. Changes kept within ${
          standingScopes.length === 1 ? "that scope" : "those scopes"
        } can land without a further conversation; discern will check the final changed paths.`;
      }
      return `Landing authority needs attention: ${warnings.join(" ")}`;
    },
  }),

  /** The CLI cannot relocate the caller, so it gives the re-root instruction. */
  "start-re-root": defineHint<{ dir: string }>({
    id: "start-re-root",
    category: "next-step",
    audience: "all",
    when: "`start` creates a worktree but cannot relocate the CLI caller.",
    family: "start-result",
    example: { dir: "/workspace/project.worktrees/hint-registry" },
    template: ({ dir }): string =>
      `${
        worktreeContinuityPolicy(CMD.start)
      } Start a session rooted at ${dir} ` +
      `(or cd there) to continue. Do not keep working in the main checkout.`,
  }),

  /** Uncommitted main-checkout work stays behind when start forks a commit. */
  "start-main-changes-stay": defineHint<{
    changes: number;
    startPoint: string;
  }>({
    id: "start-main-changes-stay",
    category: "notice",
    audience: "all",
    when: "`start` leaves uncommitted main-checkout changes behind.",
    family: "start-result",
    example: { changes: 2, startPoint: "main" },
    template: ({ changes, startPoint }): string =>
      `${changes} uncommitted change${
        changes === 1 ? "" : "s"
      } stay in the main checkout. The new worktree branches from '${startPoint}'.`,
  }),

  /** A fresh worktree checkout carries a `.gitmodules` that `git worktree add`
   * leaves unpopulated, and no configured lifecycle command mentions
   * submodules — so the gate is about to run against empty directories. */
  "start-submodules-empty": defineHint({
    id: "start-submodules-empty",
    category: "notice",
    audience: "all",
    when:
      "`start` finds `.gitmodules` in the new worktree while no configured command mentions submodules.",
    family: "start-result",
    example: undefined,
    template: (): string =>
      "This repository pins submodules, and git leaves them empty in a fresh " +
      'worktree. Add `ensure = ["git submodule update --init --recursive"]` ' +
      "under `[repository]` in discern.toml so every checkout populates them.",
  }),

  /** Session start on the main-checkout side. The SessionStart hook injects
   * this stdout as agent context — the one channel that can pre-empt trunk
   * edits, which call no verb before the damage. */
  "ensure-main-worktree-first": defineHint({
    id: "ensure-main-worktree-first",
    category: "guardrail",
    audience: "agent",
    when: "`worktree ensure` runs on the main-checkout side at session start.",
    followThrough: MAIN_WORKTREE_FOLLOW_THROUGH,
    example: undefined,
    template: (): string =>
      `Session opened in the main checkout, where every effort lands. ${
        worktreeContinuityPolicy(CMD.start)
      } For a new effort, run ${CMD.start} before editing and work in the ` +
      "worktree it returns. Questions and investigation can read from anywhere.",
  }),

  /** Setup's refresh core reports each failed artifact with its next action. */
  "setup-refresh-artifact-failed": defineHint<{ message: string }>({
    id: "setup-refresh-artifact-failed",
    category: "next-step",
    audience: "all",
    when: "Setup cannot refresh one of its generated artifacts.",
    family: "setup-refresh",
    example: { message: "could not write .codex/config.toml" },
    template: ({ message }): string =>
      `Fix the setup refresh error, then run ${CMD.refresh}: ${message}`,
  }),

  /** A flag-less setup begin re-serves the full consent exchange and exact
   * attested continuation in structured fields. */
  "setup-awaiting-confirmation": defineHint<{ command: CommandRef }>({
    id: "setup-awaiting-confirmation",
    category: "next-step",
    audience: "all",
    when: "`setup begin` has no conversation-consent attestation.",
    family: "setup-consent",
    example: {
      command: discernCommand(
        "setup begin",
        flag("model", '"<your-model-id>"'),
        flag("confirmed"),
      ),
    },
    template: ({ command }): string =>
      "Present the setup instructions in this result to the owner, wait for their " +
      `answers, then run ${command}; its \`--confirmed\` flag attests ` +
      "only to that conversation.",
    interactiveTemplate: (): string =>
      "Review the setup instructions and answer its questions, then run the " +
      "displayed command; its `--confirmed` flag attests only to this " +
      "conversation.",
  }),

  /** Setup completion carries the unfinished files and checks as structured
   * evidence, so its recovery names those fields. */
  "setup-finish-incomplete": defineHint({
    id: "setup-finish-incomplete",
    category: "next-step",
    audience: "all",
    when: "`setup done` finds skeleton markers or unmet completion checks.",
    family: "setup-done-recovery",
    example: undefined,
    template: (): string =>
      `Complete every listed file and unmet check, then re-run ${CMD.setupDone}; ` +
      `use \`--force\` only ` +
      "to record completion without that proof.",
    interactiveTemplate: (): string =>
      `Complete every listed file and unmet check, then re-run ${CMD.setupDone}; ` +
      "use `--force` only to record completion without that proof.",
  }),

  /** Existing authored agent instructions were preserved in the canonical source. */
  "setup-instructions-preserved": defineHint<{
    paths: readonly string[];
    instructionRel: string;
  }>({
    id: "setup-instructions-preserved",
    category: "next-step",
    audience: "all",
    when:
      "Setup migrates existing authored instructions into the canonical source.",
    family: "setup-instructions-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      instructionRel: SOURCE_PATHS.instructions.defaultPath,
    },
    template: ({ paths, instructionRel }): string =>
      `Fold the instructions migrated from ${
        paths.join(", ")
      } into your conventions, then delete the import note from ${instructionRel}. ` +
      `Setup preserved the existing instructions there.`,
  }),

  /** A pre-existing agent file matched discern's own prior compiled output. */
  "setup-instructions-own-render-skipped": defineHint<{
    paths: readonly string[];
    instructionRel: string;
  }>({
    id: "setup-instructions-own-render-skipped",
    category: "notice",
    audience: "all",
    when: "Setup recognizes an agent file as its own prior compiled output.",
    family: "setup-instructions-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      instructionRel: SOURCE_PATHS.instructions.defaultPath,
    },
    template: ({ paths, instructionRel }): string =>
      `Skipped importing ${
        paths.join(", ")
      } into ${instructionRel}. It matches discern's own compiled output from an ` +
      `earlier setup. ${instructionRel} remains the canonical authored source.`,
  }),

  /** A completed setup on the dedicated setup branch is ready to land. */
  "setup-done-land-dedicated": defineHint<{
    branch: string;
    target: string;
    acceptCommand: CommandRef;
  }>({
    id: "setup-done-land-dedicated",
    category: "next-step",
    audience: "all",
    when: "Setup completes on the dedicated setup branch.",
    family: "setup-done-next",
    example: {
      branch: "discern-setup",
      target: "main",
      acceptCommand: discernCommand("setup accept"),
    },
    template: ({ branch, target, acceptCommand }): string =>
      `Land setup with ${acceptCommand}, or leave it for review. Setup remains ` +
      `on \`${branch}\`; \`${target}\` does not contain it yet.`,
  }),

  /** A setup performed on another feature branch must use the project's normal merge. */
  "setup-done-land-manually": defineHint<{
    branch: string;
    target: string;
    acceptCommand: CommandRef;
    setupBranch: string;
  }>({
    id: "setup-done-land-manually",
    category: "next-step",
    audience: "all",
    when: "Setup completes on another feature branch.",
    family: "setup-done-next",
    example: {
      branch: "feature/project-setup",
      target: "main",
      acceptCommand: discernCommand("setup accept"),
      setupBranch: "discern-setup",
    },
    template: ({ branch, target, acceptCommand, setupBranch }): string =>
      `Merge \`${branch}\` into \`${target}\` your usual way when ready. ` +
      `${acceptCommand} only lands the \`${setupBranch}\` branch.`,
  }),

  /** Provider integrations load at session start, so setup hands off reactivation. */
  "setup-reactivate-tools": defineHint({
    id: "setup-reactivate-tools",
    category: "next-step",
    audience: "all",
    when: "Setup completes but configured providers need session reactivation.",
    family: "setup-done-next",
    example: undefined,
    template: (): string =>
      "Before continuing, follow each provider-specific reactivation step carried with this result. discern's MCP tools, session hooks, and project rules are now wired, but coding agents load them at session start, so this session cannot use them yet:",
  }),

  /** Setup's final improvement route for the newly wired project.
   * Agent audience: reviewing the findings with the owner is an instruction
   * only an agent can follow. */
  "setup-run-coach": defineHint<{ coachVerb: string; todoRel: string }>({
    id: "setup-run-coach",
    category: "next-step",
    audience: "agent",
    when: "Setup completes and offers the project coaching follow-up.",
    family: "setup-done-next",
    example: {
      coachVerb: "improvement",
      todoRel: SOURCE_PATHS.todo.defaultPath,
    },
    template: ({ coachVerb, todoRel }): string =>
      `Deepen your setup: run ${
        discernCommand(coachVerb, flag("json"))
      }, review the ranked findings with your owner, apply the bounded changes now, and record larger changes in ${todoRel}.`,
  }),

  /**
   * Doctor context for the shared unfinished-setup action. Doctor is a required
   * setup check, but a healthy result does not establish setup completion.
   */
  "setup-unfinished-doctor": defineHint({
    id: "setup-unfinished-doctor",
    category: "guardrail",
    audience: "all",
    when: "`doctor` runs while setup remains incomplete.",
    family: "setup-unfinished",
    example: undefined,
    template: (): string =>
      setupUnfinishedHint(
        `Running ${
          discernCommand("doctor")
        } is a required setup step. A healthy result proves install health only. It does not complete the setup brief or record setup completion.`,
      ),
  }),

  /** A failed install check already carries its specific fix in the report. */
  "doctor-failed-checks": defineHint({
    id: "doctor-failed-checks",
    category: "next-step",
    audience: "all",
    when: "`doctor` reports one or more failed install checks.",
    example: undefined,
    template: (): string =>
      `Apply the fix listed under each failed check, then run ${
        discernCommand("doctor")
      } again.`,
  }),

  /** Upgrade never checks the network, so it names the installed update channel. */
  "upgrade-newer-discern": defineHint<{ updateChannel: string }>({
    id: "upgrade-newer-discern",
    category: "notice",
    audience: "all",
    when: "`upgrade` reports the installed update channel.",
    example: { updateChannel: "run the installer again" },
    template: ({ updateChannel }): string =>
      `To get a newer discern, ${updateChannel}. discern never checks the ` +
      `network for updates.`,
  }),

  /** A stale read-only check names the command that applies its pending work. */
  "upgrade-check-pending": defineHint({
    id: "upgrade-check-pending",
    category: "next-step",
    audience: "all",
    when:
      "`upgrade --check` finds pending migrations or install reconciliation.",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("upgrade")
      } to apply pending migrations and reconcile this install.`,
  }),

  /** Post-upgrade lead-in to the shared restart-session lifecycle fact. */
  "upgrade-restart-session": defineHint({
    id: "upgrade-restart-session",
    category: "next-step",
    audience: "all",
    when: "`upgrade` completes while agent sessions still run the old server.",
    family: "restart-session",
    example: undefined,
    template: (): string =>
      restartSessionHint(
        "For every open agent session, restart it so its discern MCP server reloads this build, or reload its MCP servers directly, before continuing. A server process started before the upgrade still runs the old build.",
      ),
  }),

  /** An empty known-job command records a deliberate deferred gate slot. */
  "config-job-deferred": defineHint<{ name: string }>({
    id: "config-job-deferred",
    category: "next-step",
    audience: "all",
    when: "A known job has an empty command.",
    example: { name: "integration" },
    template: ({ name }): string =>
      `Add an inline # comment explaining why "${name}" is deferred, or set a ` +
      `real command to enforce it. An empty command is present but a no-op, so ` +
      `the gate skips it.`,
  }),

  /**
   * Registered fallback for a failure whose domain-specific recovery has not
   * supplied a narrower hint. The serialization invariant makes this an
   * actionable floor, not the preferred ceiling for tailored remedies.
   */
  "failure-recovery": defineHint<{ verb: string }>({
    id: "failure-recovery",
    category: "next-step",
    audience: "all",
    when:
      "A failed result has no more specific registered recovery instruction.",
    family: "failure-recovery",
    example: { verb: "doctor" },
    template: (): string =>
      "Use this result's message or first diagnostic to correct the reported problem before retrying.",
  }),

  /** A docs/map ambiguity can only recover by selecting one exact candidate. */
  "docs-choose-candidate": defineHint({
    id: "docs-choose-candidate",
    category: "next-step",
    audience: "all",
    when: "A docs or map target resolves to more than one entry.",
    family: "docs-recovery",
    example: undefined,
    template: (): string =>
      "Choose one exact path from the listed candidates, then re-run the same command with that path as its target.",
    interactiveTemplate: (): string =>
      "Choose one exact path from the listed candidates, then re-run the same " +
      "command with that path as its target.",
  }),

  /** A missing docs/map target recovers through structured suggestions or the
   * verb's index, rather than by guessing from a message alone. */
  "docs-find-target": defineHint({
    id: "docs-find-target",
    category: "next-step",
    audience: "all",
    when: "A docs or map target does not resolve.",
    family: "docs-recovery",
    example: undefined,
    template: (): string =>
      "Use an exact suggested path when one is listed; otherwise run the same command without a target to inspect its index, then retry with one returned path.",
    interactiveTemplate: (): string =>
      "Use an exact suggested path when one is listed; otherwise run the same " +
      "command without a target to inspect its index, then retry with one " +
      "returned path.",
  }),

  /** The optional canonical suggestion in an unknown-command refusal. */
  "unknown-command-suggestion": defineHint<{ command: string }>({
    id: "unknown-command-suggestion",
    category: "next-step",
    audience: "all",
    when: "An unknown command has a canonical suggestion.",
    family: "unknown-command",
    example: { command: "status" },
    template: ({ command }): string =>
      `Did you mean ${discernCommand(command)}?`,
  }),

  /** The standing documentation pointer closing every unknown-command refusal. */
  "unknown-command-help": defineHint({
    id: "unknown-command-help",
    category: "next-step",
    audience: "all",
    when: "An unknown command refusal needs its documentation route.",
    family: "unknown-command",
    example: undefined,
    template: (): string =>
      `Run ${discernCommand("docs")} for the documentation, or ${
        discernCommand("", flag("help"))
      } to list the commands.`,
  }),

  /**
   * The MCP-specific start re-root guardrail. It distinguishes the server's
   * automatic tool re-aim from the file operations the connected agent must
   * move, gives the fallback for a fixed working root, and names the split-state
   * consequence.
   * Agent-audience: it fires only over MCP and instructs the connected agent.
   */
  "start-mcp-re-root": defineHint<{ path: string }>({
    id: "start-mcp-re-root",
    category: "guardrail",
    audience: "agent",
    delivery: "mcp",
    when:
      "`start` runs through the Model Context Protocol and the connected agent must re-root before editing.",
    family: "start-result",
    example: { path: "/workspace/project.worktrees/hint-registry" },
    template: ({ path }): string =>
      `${
        worktreeContinuityPolicy(CMD.start)
      } Re-root or cd into ${path} before ` +
      `editing. discern's MCP tools already ` +
      `target this worktree. \`discern_done\`, \`discern_update\`, and ` +
      `\`discern_accept\` follow it automatically. If you can't change your ` +
      `working root, prefix every shell command with ` +
      `\`cd ${path} && …\` and pass \`path="${path}"\` to every discern MCP tool. ` +
      `Otherwise, edits land on the trunk while the gate runs in the worktree, ` +
      `and the two states diverge.`,
  }),

  /**
   * Version-mismatch lead-in to the shared restart-session lifecycle fact. It keeps
   * the cross-build rewrite risk explicit until the caller restarts.
   */
  "mcp-version-mismatch": defineHint<{
    serverVersion: string;
    installedVersion: string;
  }>({
    id: "mcp-version-mismatch",
    category: "next-step",
    audience: "all",
    delivery: "mcp",
    when:
      "The running Model Context Protocol server version differs from the installed build.",
    family: "restart-session",
    example: { serverVersion: "1.4.0", installedVersion: "1.5.0" },
    template: ({ serverVersion, installedVersion }): string =>
      restartSessionHint(
        `Restart your agent session or reload its MCP servers to replace MCP ` +
          `server v${serverVersion} with installed v${installedVersion}. Until ` +
          `then, its results can conflict with the current CLI and rewrite ` +
          `generated files from different builds.`,
      ),
  }),
} as const;

const ACTIONABLE_HINT_IDS = new Set(
  Object.values(HINTS)
    .filter((def) => def.category === "next-step")
    .map((def) => def.id),
);

/** Evidence the generic failure-recovery instruction can truthfully cite. */
export const FAILURE_RECOVERY_EVIDENCE = ["message", "diagnostic"] as const;
export type FailureRecoveryEvidence =
  (typeof FAILURE_RECOVERY_EVIDENCE)[number];

/** Whether one canonical error family may use the evidence-backed generic
 * floor or must carry a narrower registered instruction. This total satellite
 * of {@link ErrorSlug} records the semantic audit: a new slug cannot compile
 * until its recovery contract is classified. */
export type FailureRecoveryMode = "evidence" | "tailored";

/** Error-less applied failures form one explicit compatibility family. Their
 * first diagnostic or message is the only recovery evidence available; a
 * data-only result still fails closed at the boundary. */
export const ERRORLESS_FAILURE_RECOVERY: FailureRecoveryMode = "evidence";

export const ERROR_FAILURE_RECOVERY = {
  active_worktrees: "evidence",
  ambiguous: "tailored",
  apply_failed: "evidence",
  awaiting_consent: "tailored",
  awaiting_declaration: "tailored",
  awaiting_variance: "tailored",
  below_min_score: "tailored",
  brief_unparseable: "evidence",
  checkout_failed: "evidence",
  config_template_unavailable: "evidence",
  confirmation_required: "evidence",
  conflict: "evidence",
  desk_already_active: "evidence",
  detached_head: "evidence",
  diagrams_misaligned: "evidence",
  dirty_worktree: "evidence",
  edit_error: "evidence",
  gate_failed: "evidence",
  gitignore_template_unavailable: "evidence",
  identity_error: "evidence",
  incomplete: "tailored",
  internal_error: "evidence",
  invalid_arguments: "evidence",
  invalid_config: "evidence",
  invalid_config_file: "evidence",
  invalid_migrated_config: "evidence",
  invalid_preset: "evidence",
  invalid_settings_file: "evidence",
  invalid_toml: "evidence",
  invalid_value: "evidence",
  no_docs: "evidence",
  no_map: "evidence",
  no_project: "evidence",
  no_repository: "evidence",
  no_such_step: "evidence",
  no_target: "evidence",
  not_found: "tailored",
  not_initialized: "evidence",
  not_main_checkout: "evidence",
  not_on_trunk: "evidence",
  not_set_up: "evidence",
  not_setup_branch: "evidence",
  partial_acceptance: "tailored",
  partial_materialization: "tailored",
  partial_refresh: "tailored",
  pin_failed: "evidence",
  precondition_failed: "evidence",
  provisioned_resources: "evidence",
  read_error: "evidence",
  renamed_command: "evidence",
  renamed_config_key: "evidence",
  schema_version_too_new: "evidence",
  setup_plan_failed: "evidence",
  skills_eject_failed: "evidence",
  tables_malformed: "evidence",
  templates_not_found: "evidence",
  tidy_parse_failed: "evidence",
  tidy_write_failed: "evidence",
  uncommitted_changes: "evidence",
  unchanged_tree_rerun: "tailored",
  unknown_category: "evidence",
  unknown_command: "tailored",
  unknown_key: "evidence",
  unknown_preset: "evidence",
  unknown_standard: "evidence",
  write_access: "evidence",
} as const satisfies Record<ErrorSlug, FailureRecoveryMode>;

const FAILURE_RECOVERY_EVIDENCE_READERS = {
  message: (result: DiscernResult): boolean =>
    result.message !== undefined && result.message.trim().length > 0,
  diagnostic: (result: DiscernResult): boolean =>
    result.diagnostics?.[0] !== undefined,
} satisfies Record<
  FailureRecoveryEvidence,
  (result: DiscernResult) => boolean
>;

/** Whether the generic instruction can point at evidence the envelope carries. */
export function hasFailureRecoveryEvidence(result: DiscernResult): boolean {
  return FAILURE_RECOVERY_EVIDENCE.some((evidence) =>
    FAILURE_RECOVERY_EVIDENCE_READERS[evidence](result)
  );
}

/** Resolve the recovery contract for a failed result. */
export function failureRecoveryMode(
  result: DiscernResult,
): FailureRecoveryMode {
  return result.error === undefined
    ? ERRORLESS_FAILURE_RECOVERY
    : ERROR_FAILURE_RECOVERY[result.error];
}

/** Fire the registered actionable floor for a failed result. */
export function failureRecoveryHint(verb: string): FiredHint {
  return fire(HINTS["failure-recovery"], { verb });
}

/** Project the actionable fallback onto an envelope without losing its identity. */
export function failureRecoveryHintTexts(verb: string): string[] {
  return hintTexts([failureRecoveryHint(verb)]);
}

/**
 * Whether an envelope carries at least one fired, registered `next-step`
 * instruction. Plain strings, unknown ids, notices, and guardrails do not
 * satisfy recovery: only identity retained by {@link hintTexts} counts.
 */
export function hasRegisteredActionableHint(
  texts: readonly string[] | undefined,
): boolean {
  return firedHintsFromTexts(texts).some((hint) =>
    ACTIONABLE_HINT_IDS.has(hint.id)
  );
}

/** Whether the result explicitly carries the generic recovery fallback. */
export function hasGenericFailureRecoveryHint(
  texts: readonly string[] | undefined,
): boolean {
  return firedHintsFromTexts(texts).some((hint) =>
    hint.id === "failure-recovery"
  );
}

/**
 * Add the registered recovery floor to a failed result only when its audited
 * family permits it, no narrower next step is present, and the result carries
 * the message or diagnostic the instruction tells the caller to use. Both CLI
 * and MCP call this before serialization, so their wire envelopes and locally
 * observed hint ids stay identical. Every other failure must supply a tailored
 * next step.
 */
export function withFailureRecoveryHint<TData>(
  result: DiscernResult<TData>,
): DiscernResult<TData> {
  if (
    result.ok || hasRegisteredActionableHint(result.hints) ||
    failureRecoveryMode(result) !== "evidence" ||
    !hasFailureRecoveryEvidence(result)
  ) {
    return result;
  }
  return {
    ...result,
    hints: appendHintTexts(result.hints, [failureRecoveryHint(result.verb)]),
  };
}

/** Bind a parameterized entry to its example for parameterless totality audits. */
function exampleBoundHint<P>(def: HintDef<P>): HintDef<undefined> {
  const interactive = def.interactiveTemplate;
  return {
    ...def,
    example: undefined,
    template: (): string => def.template(def.example),
    interactiveTemplate: interactive === undefined
      ? undefined
      : (): string => interactive(def.example),
  };
}

/** Failed-stage lookup into the registry. Total over {@link FailedStage}, so a
 * new stage cannot compile until its remedy is registered and enrolled here. */
export const GATE_FAILURE_REMEDIES = {
  fix: HINTS["gate-failure-fix"],
  build: HINTS["gate-failure-build"],
  check: HINTS["gate-failure-check"],
  test: HINTS["gate-failure-test"],
  "check/test": HINTS["gate-failure-check-test"],
  scope_gates: HINTS["gate-failure-scope-gates"],
  tree_drift: HINTS["gate-failure-tree-drift"],
  generated_drift: exampleBoundHint(HINTS["gate-failure-generated-drift"]),
  refresh_drift: HINTS["gate-failure-refresh-drift"],
  tracked_artifacts: HINTS["gate-failure-tracked-artifacts"],
  instructions: HINTS["gate-failure-instructions"],
  skills: HINTS["gate-failure-skills"],
  skill_frontmatter: HINTS["gate-failure-skill-frontmatter"],
  adr_numbers: HINTS["gate-failure-adr-numbers"],
  adr_index: HINTS["gate-failure-adr-index"],
  map_integrity: HINTS["gate-failure-map-integrity"],
  merge: HINTS["gate-failure-merge"],
  standards: HINTS["gate-failure-standards"],
  write_access: HINTS["gate-failure-write-access"],
} as const satisfies Record<FailedStage, HintDef<undefined>>;

/** Fire the registered remedy for a failed gate stage. Generated-drift callers
 * pass the owning group; the example fallback keeps closed-set audits total
 * before the stage gains its wave-2 producer. */
export function gateFailureRemedy(
  stage: FailedStage,
  generated?: GeneratedDriftRemedyParams,
): FiredHint {
  if (stage === "generated_drift" && generated !== undefined) {
    return fire(HINTS["gate-failure-generated-drift"], generated);
  }
  return fire(GATE_FAILURE_REMEDIES[stage]);
}

/** True when a fired registry entry targets the requested audience. */
export function hintHasAudience(
  fired: FiredHint,
  audience: HintAudience,
): boolean {
  const defs = Object.values(HINTS) as readonly {
    readonly id: string;
    readonly audience: HintAudience;
  }[];
  return defs.some((def) => def.id === fired.id && def.audience === audience);
}

/**
 * The fired entries the interactive terminal presentation prints: agent-audience
 * entries drop, everything else passes in order. The wire result always carries
 * the full channel.
 */
export function interactiveHints(
  fired: readonly FiredHint[],
): FiredHint[] {
  return fired
    .filter((hint) => !hintHasAudience(hint, "agent"))
    .map((hint) =>
      hint.interactiveText === undefined
        ? hint
        : { ...hint, text: hint.interactiveText }
    );
}

/**
 * Project a result's wire hints for an interactive terminal presentation. Entries
 * whose recovered in-process identity is agent-audience drop; texts with no
 * identity pass through unchanged. Pass the envelope's own `hints` array —
 * identity recovery keys on the exact array object, so a copy loses it.
 */
export function interactiveHintTexts(
  texts: readonly string[] | undefined,
): string[] {
  if (texts === undefined) {
    return [];
  }
  const drop = new Set(
    firedHintsFromTexts(texts)
      .filter((hint) => hintHasAudience(hint, "agent"))
      .map((hint) => hint.text),
  );
  const replacements = new Map(
    firedHintsFromTexts(texts)
      .filter((hint) => !hintHasAudience(hint, "agent"))
      .flatMap((hint) =>
        hint.interactiveText === undefined
          ? []
          : [[hint.text, hint.interactiveText] as const]
      ),
  );
  return texts
    .filter((text) => !drop.has(text))
    .map((text) => replacements.get(text) ?? text);
}
