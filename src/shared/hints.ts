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

import type { DiscernResult, FailedStage } from "./result.ts";
import { SOURCE_PATHS } from "./paths_registry.ts";
import type { LandingConsentSource } from "./consent.ts";

/**
 * How an entry means to steer the caller. `next-step` names the action to
 * take from here; `guardrail` states a rule protecting shared state before
 * it is broken; `notice` discloses a condition the caller should weigh but
 * need not act on.
 */
export type HintCategory = "next-step" | "guardrail" | "notice";

/**
 * A suppression flag for interactive human surfaces, not a targeting field:
 * every entry rides the `--json`/MCP envelope regardless of audience. `all`
 * also renders on the interactive human surfaces; `agent` marks entries whose
 * instruction only an agent can execute — relaying to an owner, re-rooting a
 * session — which the interactive human renderers drop. The drop keys on this
 * field, not on reconstructing the rendered string.
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

/** Every gate-failure remedy shares one declared outcome rule. */
function defineGateFailureRemedyHint<P = undefined>(
  def: HintDef<P> & { readonly family: "gate-failure-remedy" },
): HintDef<P> {
  return defineHint({ ...def, followThrough: RED_GATE_FOLLOW_THROUGH });
}

/** A hint fired at a call site: the in-process pair; only `text` reaches the wire. */
export interface FiredHint {
  readonly id: string;
  readonly text: string;
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
 */
export function fire<P>(
  def: HintDef<P>,
  ...params: P extends void ? [] : [params: P]
): FiredHint {
  const [p] = params;
  // The tuple type above guarantees `p` is `P` exactly when the template
  // needs it; the cast bridges what the conditional tuple cannot express.
  return { id: def.id, text: def.template(p as P) };
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
  "Setup is NOT finished. Do not stop or hand the setup brief back as a report. " +
  "Complete it in this agent session: run `discern setup begin` to print or " +
  "reprint it without changing your work, complete every step, then run `discern " +
  "setup done`. Tell the user setup is complete only after `discern setup done` " +
  "passes.";

/** Append one context-specific reason to the canonical unfinished-setup action. */
function setupUnfinishedHint(context: string): string {
  return `${SETUP_UNFINISHED_CORE} ${context}`;
}

/** Shared remedy for every missing or stale discern-managed artifact. */
const GENERATED_DRIFT_CORE =
  "Run `discern refresh` to restore discern-managed artifacts.";

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

/** Shared diagnostic loop for gate stages whose machine facts carry the detail. */
const GATE_DIAGNOSTIC_REMEDY_CORE =
  "Run the reproduce command from each diagnostic and fix the reported " +
  "problems. Iterate with `discern prepare` (the fast fix-then-check loop) " +
  "or `discern test`; when the tree is ready, re-run `discern done`.";

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

  /** One-line warning when the configured integration branch cannot be checked. */
  "missing-integration-branch": defineHint<{ branch: string }>({
    id: "missing-integration-branch",
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
      `If the ${changedFiles} uncommitted change${
        changedFiles === 1 ? "" : "s"
      } in the main checkout at ${mainRepo} ${
        changedFiles === 1 ? "is" : "are"
      } yours, WORK INSIDE this untouched worktree. Prefix every shell command ` +
      `with \`cd ${cwd} && …\` and pass \`path="${cwd}"\` to every discern MCP ` +
      `tool. Otherwise, your edits land on the trunk while discern runs here.`,
  }),

  /**
   * Discern-owned ignored artifacts are tracked despite the managed ignore
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
      `from the Git index, then run \`discern refresh\`. Affected paths: ${pathSummary}.`,
  }),

  /**
   * Compiled guidance files are present but untracked and not ignored. Committing
   * them puts the same guidance in reach of agents reading a fresh clone.
   */
  "untracked-agent-files": defineHint<{ paths: readonly string[] }>({
    id: "untracked-agent-files",
    category: "next-step",
    audience: "all",
    when: "Agent files are untracked and not ignored.",
    example: { paths: ["AGENTS.md", "CLAUDE.md"] },
    template: ({ paths }): string =>
      `Commit the untracked Agent files (${
        paths.join(", ")
      }) so cloud and out-of-tool agents read the same guidance from a fresh clone.`,
  }),

  /** Missing agent-file context for the shared generated-drift remedy. */
  "generated-agent-files-missing": defineHint<{ paths: string }>({
    id: "generated-agent-files-missing",
    category: "next-step",
    audience: "all",
    when: "A generated Agent file is missing.",
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
    when: "A generated Agent file differs from its authored sources.",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Agent files are out of date (${paths}).`,
        "Make intended guidance changes in [guidance].sources. Refresh overwrites Agent files.",
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
        "If refresh reports a malformed settings file, repair it and run `discern refresh` again.",
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
        "Edit record files, not the generated lists. Refresh rewrites the lists between the markers.",
      ),
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
      'Run `discern start --name "<task>"` from this main checkout on the trunk, then move into the new worktree before editing. The name keeps the worktree identifiable. Never adopt an existing worktree: each belongs to another line of work, and a clean tree may still be in use.',
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
      return `Run \`git switch ${trunk}\` in the main checkout before ` +
        `\`discern accept\`. The checkout is parked on ${label}, while '${trunk}' ` +
        `is the trunk. New worktrees still fork from the trunk, so you can run ` +
        `\`discern start\` meanwhile. Never adopt an existing worktree. Each belongs ` +
        `to another line of work.`;
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
        `fork and \`discern accept\` cannot land until the configuration and ` +
        `repository agree.`;
    },
  }),

  "status-dirty-worktree-scoped": defineHint<{ scopes: readonly string[] }>({
    id: "status-dirty-worktree-scoped",
    category: "next-step",
    audience: "all",
    when: "`status` finds scoped, uncommitted changes in the current worktree.",
    family: "status-dirty-worktree",
    example: { scopes: ["code", "docs"] },
    template: ({ scopes }): string =>
      `Use \`discern prepare\` or targeted tests while iterating on changes in ${
        scopes.join(", ")
      }. Then commit the intended final tree and run \`discern done\` on the ` +
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
      "Use `discern prepare` or targeted tests while iterating on uncommitted changes. Then commit the intended final tree and run `discern done` on the clean HEAD before calling work done.",
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
      return `Run \`discern update\` directly. This branch is ${behind} commit${
        behind === 1 ? "" : "s"
      } behind ${trunk}, and the command is idempotent and checks its own git ` +
        `preconditions.${overlapNote} Run \`discern done\` before handing off or a ` +
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

  /** Agent-audience: every fact here (clean HEAD, honored receipt, up to
   * date) already renders in the interactive summary lines, and the
   * instructions — report, close with the line, wait, land only on an explicit
   * ask — are the agent's consent workflow, not a person's. The composition
   * contract (account first, one-line receipt last, page stays with discern)
   * is ADR 0188's. */
  "status-ready-for-review": defineHint<{ trunk: string; branch: string }>({
    id: "status-ready-for-review",
    category: "next-step",
    audience: "agent",
    when: "A clean, current branch has an honored gate receipt.",
    family: "status-review-readiness",
    example: { trunk: "main", branch: "agent/hints" },
    template: ({ trunk, branch }): string =>
      `Report this branch to your owner in your own words and end with the ` +
      `receipt in \`data.gate_receipt.receipt_line\` verbatim, then wait. This ` +
      `clean HEAD is committed and up to date with ${trunk}. Don't paste the ` +
      `full receipt: your owner pulls it with \`discern status --verbose\`, ` +
      `and the raw diff with \`git diff ${trunk}...${branch}\`. Run ` +
      `\`discern accept\` only after the user explicitly asks you to land it.`,
  }),

  /** A ready receipt whose exact tree the authority resolver covered. */
  "status-land-under-verified-authority": defineHint<{
    source: LandingConsentSource;
    scopes: readonly string[];
  }>({
    id: "status-land-under-verified-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A clean, current branch has an honored receipt and machine-verified landing authority.",
    family: "landing-authority",
    example: { source: "standing-grant", scopes: ["docs"] },
    template: ({ source, scopes }): string =>
      source === "effort-grant"
        ? "The owner pre-authorized this landing at the desk, and the clean HEAD has an honored receipt. Run `discern accept` now to land it; the command rechecks the grant at the fast-forward boundary."
        : `The clean HEAD is covered by the standing grant for ${
          scopes.join(", ")
        } and has an honored receipt. Run \`discern accept\` now to land it; the command rechecks every changed path at the fast-forward boundary.`,
  }),

  /** A ready receipt whose recorded standing grant does not cover every path. */
  "status-ready-uncovered-authority": defineHint<{
    uncovered: readonly string[];
    warnings: readonly string[];
    trunk: string;
    branch: string;
  }>({
    id: "status-ready-uncovered-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A clean, current branch has an honored receipt but recorded authority does not cover it.",
    family: "landing-authority",
    example: {
      uncovered: ["`src/main.ts` (scopes: engine)"],
      warnings: [],
      trunk: "main",
      branch: "agent/hints",
    },
    template: ({ uncovered, warnings, trunk, branch }): string =>
      `Report this branch to your owner and end with \`data.gate_receipt.receipt_line\` verbatim, then stop. The recorded grant does not cover ${
        uncovered.length > 0 ? uncovered.join(", ") : "this landing"
      }.${
        warnings.length > 0 ? ` ${warnings.join(" ")}` : ""
      } Inspect the raw change with \`git diff ${trunk}...${branch}\`.`,
  }),

  "status-missing-done-receipt": defineHint<{ trunk: string }>({
    id: "status-missing-done-receipt",
    category: "next-step",
    audience: "all",
    when: "A clean, current branch has no honored gate receipt.",
    family: "status-review-readiness",
    example: { trunk: "main" },
    template: ({ trunk }): string =>
      `Run \`discern done\` before reporting the branch ready for review or a ` +
      `user-requested landing. This clean HEAD is committed and up to date with ` +
      `${trunk}, but it has no honored gate receipt.`,
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
    when: "A fleet survey includes worktrees owned by other lines of work.",
    example: undefined,
    template: (): string =>
      "Never work in a fleet worktree you didn't create. Each belongs to another line of work, and a clean tree may still be in use.",
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
      "Run `discern start` to begin work. There are no active worktrees.",
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
      }. Use each branch ` +
      `from \`data.fleet\` with \`git diff ${trunk}...<branch>\`.`,
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
      }. Open each worktree and run \`discern accept\` now; acceptance rechecks its grant before landing.`,
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
      } (paths in \`data.fleet_collisions\`). Both sides may merge cleanly and still conflict semantically — whoever lands second should run \`discern update\` and re-read the shared paths.`,
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
      } (records in \`data.adr_collisions\`). The records are different files ` +
      `that merge cleanly, so nothing collides until both sit in one tree and ` +
      `the gate refuses the duplicate — whoever lands second takes the next ` +
      `free number.`,
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
        "discard one, run `discern worktree drop <name>`. It refuses without " +
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
        `${checkout} incomplete. Run \`discern worktree drop <name>\` for each.`;
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
        "`discern worktree drop <name>`. `data.fleet` carries last activity and " +
        "unlanded work.";
    },
  }),

  "status-unlanded-branches": defineHint<{ branches: readonly string[] }>({
    id: "status-unlanded-branches",
    category: "next-step",
    audience: "all",
    when: "A fleet survey finds unlanded branches with no worktree.",
    example: { branches: ["agent/old-task", "agent/paused-task"] },
    template: ({ branches }): string =>
      `Resume one with \`discern start --from <branch>\`, or use ` +
      `\`discern update --from <branch>\` from an existing worktree. Delete an ` +
      `abandoned branch with \`git branch -D <branch>\`. ${branches.length} branch${
        branches.length === 1 ? "" : "es"
      } ${branches.length === 1 ? "holds" : "hold"} unlanded work with no ` +
      `worktree: ${boundedNameSummary(branches.length, branches)}.`,
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

  /** Pair evidence summary; the commit rows themselves stay in `data.commits`. */
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
      return `Review the shared commits in data.commits. \`${a}\` and \`${b}\` ` +
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
      `Review the most recent shared commits in data.commits. ${more} older ` +
      `commit${more === 1 ? " is" : "s are"} outside its cap.`,
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
      const arg = queryTarget === undefined ? "" : ` ${queryTarget}`;
      return `Run \`discern coupling${arg}\` to review ${remaining} more ranked ` +
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
  "await-green-met": defineHint<{ branch: string }>({
    id: "await-green-met",
    category: "next-step",
    audience: "all",
    when: "`await --green` finds the awaited branch's receipt honored.",
    family: "await-met",
    example: { branch: "agent/upload-retry" },
    template: ({ branch }): string =>
      `\`${branch}\` is green — its worktree holds an honored receipt. ` +
      `Build on it with \`discern update --from ${branch}\` from your ` +
      `worktree, or \`discern start --from ${branch}\` for a fresh one.`,
  }),

  /** The integration move once awaited work reaches the trunk. */
  "await-landed-met": defineHint<{
    branch: string;
    trunk: string;
    overlapTotal: number;
  }>({
    id: "await-landed-met",
    category: "next-step",
    audience: "all",
    when: "`await` finds the awaited work reachable from the trunk.",
    family: "await-met",
    example: { branch: "agent/upload-retry", trunk: "main", overlapTotal: 2 },
    template: ({ branch, trunk, overlapTotal }): string =>
      `The work from \`${branch}\` landed on \`${trunk}\` — run ` +
      `\`discern update\` to bring it beneath this branch.` +
      (overlapTotal > 0
        ? ` ${overlapTotal} incoming file${
          overlapTotal === 1 ? " overlaps" : "s overlap"
        } your own changes — re-read them after updating.`
        : ""),
  }),

  "await-trunk-moved-met": defineHint<{
    trunk: string;
    overlapTotal: number;
  }>({
    id: "await-trunk-moved-met",
    category: "next-step",
    audience: "all",
    when: "`await --trunk-moved` sees the trunk ref advance.",
    family: "await-met",
    example: { trunk: "main", overlapTotal: 0 },
    template: ({ trunk, overlapTotal }): string =>
      `\`${trunk}\` moved while you waited — run \`discern update\` to bring ` +
      `the latest beneath this branch.` +
      (overlapTotal > 0
        ? ` ${overlapTotal} incoming file${
          overlapTotal === 1 ? " overlaps" : "s overlap"
        } your own changes — re-read them after updating.`
        : ""),
  }),

  /** The timeout answer: not a failure, an appointment — one call, one number,
   * no guessing at sleep intervals. */
  "await-not-yet": defineHint<{
    summary: string;
    seconds: number;
    command: string;
  }>({
    id: "await-not-yet",
    category: "next-step",
    audience: "all",
    when: "`await` times out before its condition holds.",
    example: {
      summary: "`agent/upload-retry` has no honored receipt yet",
      seconds: 180,
      command: "discern await --green agent/upload-retry --timeout 180",
    },
    template: ({ summary, seconds, command }): string =>
      `Not yet: ${summary}. Call again in about ${seconds}s — ` +
      `e.g. \`${command}\`.`,
  }),

  /** Point-of-use honesty when the flat default replaces priced advice. */
  "await-timing-degraded": defineHint({
    id: "await-timing-degraded",
    category: "notice",
    audience: "all",
    when: "`await` times out with the logbook disabled.",
    example: undefined,
    template: (): string =>
      "The retry delay is a flat default — the logbook is off, so no " +
      "duration evidence exists to price the wait.",
  }),

  /** The honest refusal when the awaited branch does not resolve at call
   * start — the sha to watch can no longer be pinned. */
  "await-branch-missing": defineHint<{ branch: string; trunk: string }>({
    id: "await-branch-missing",
    category: "next-step",
    audience: "all",
    when: "`await` is asked to watch a branch that does not exist.",
    example: { branch: "agent/upload-retry", trunk: "main" },
    template: ({ branch, trunk }): string =>
      `Branch \`${branch}\` was not found. It may not have started yet — or ` +
      `its work may already have landed (acceptance deletes a landed ` +
      `branch). Check \`discern status\` from the main checkout; if it ` +
      `landed, \`discern update\` brings \`${trunk}\` beneath your branch.`,
  }),

  "patterns-logbook-empty": defineHint({
    id: "patterns-logbook-empty",
    category: "notice",
    audience: "all",
    when: "`patterns` finds no recorded logbook events.",
    example: undefined,
    template: (): string =>
      "Check back after more discern use. The logbook is empty, and discern " +
      "records one local event per verb run under the repository's git directory.",
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
      `The logbook is too young for ${young} of ${total} ` +
      `detectors. Each reports insufficient evidence rather than guessing.`,
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
   * The receipt-tail finding: one strongest current-branch observation plus the
   * count and the route to the full evidence report.
   */
  "logbook-receipt-finding": defineHint<{
    count: number;
    observed: string;
  }>({
    id: "logbook-receipt-finding",
    category: "next-step",
    audience: "all",
    when:
      "A gate receipt carries the strongest current-branch logbook finding.",
    family: "logbook-inline-finding",
    example: {
      count: 2,
      observed: "This branch has repeated the same failed stage.",
    },
    template: ({ count, observed }): string =>
      `Run \`discern patterns\` for full evidence and next steps. The logbook ` +
      `has ${count} branch finding${count === 1 ? "" : "s"}. ${observed}`,
  }),

  /** A session-scoped finding rendered as its observation and next step. */
  "logbook-status-finding": defineHint<{
    observed: string;
    next: string;
  }>({
    id: "logbook-status-finding",
    category: "next-step",
    audience: "all",
    when: "`status` carries a session-scoped logbook finding.",
    family: "logbook-inline-finding",
    example: {
      observed: "The same worktree has been refused 3 times.",
      next: "Inspect its current branch and receipt.",
    },
    template: ({ observed, next }): string =>
      `${next} Logbook finding: ${observed}`,
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
        "Gate commands are useful during setup, but their output is provisional. Only `discern setup done` validates the gate and records setup completion.",
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
      "Run `discern update`, then `discern done` again before `discern accept`. " +
      "The trunk advanced while the gate ran, so this branch is behind even " +
      "though the gate passed for this HEAD.",
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

  "gate-receipt-skipped-dirty": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-receipt-skipped-dirty",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot record a receipt because the worktree is dirty.",
    family: "gate-receipt",
    example: { reason: "2 tracked files changed" },
    template: ({ reason }): string =>
      `Use \`discern prepare\` or \`discern test\` while iterating. Then commit ` +
      `the intended final tree and re-run \`discern done\` on the clean HEAD before ` +
      `handoff or acceptance. The gate passed but recorded no receipt because ` +
      `the worktree is dirty${reasonSuffix(reason)}.`,
  }),

  "gate-receipt-head-moved": defineHint<{ reason: string | undefined }>({
    id: "gate-receipt-head-moved",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot record a receipt because the branch tip moved.",
    family: "gate-receipt",
    example: { reason: "HEAD changed from a1b2c3d to d4e5f6a" },
    template: ({ reason }): string =>
      `Re-run \`discern done\` on the final commit before handoff or acceptance. ` +
      `The gate passed but recorded no receipt because HEAD moved while it ran${
        reasonSuffix(reason)
      }. A receipt can vouch only for the exact tree the gate tested.`,
  }),

  "gate-receipt-record-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-receipt-record-failed",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot write its receipt.",
    family: "gate-receipt",
    example: { reason: "the receipt file could not be written" },
    template: ({ reason }): string =>
      `Run \`discern done\` again later to record a gate receipt. The gate passed, ` +
      `but discern could not record one${reasonSuffix(reason)}. Until then, ` +
      `\`discern accept\` will re-run the gate.`,
  }),

  "gate-receipt-unavailable": defineHint<{ reason: string | undefined }>({
    id: "gate-receipt-unavailable",
    category: "notice",
    audience: "all",
    when: "A green gate cannot prepare receipt state.",
    family: "gate-receipt",
    example: { reason: "write authority was not established" },
    template: ({ reason }): string =>
      `Gate passed, but discern could not prepare the gate receipt${
        reasonSuffix(reason)
      }. \`discern accept\` may need to re-run the gate.`,
  }),

  "gate-receipt-clear-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-receipt-clear-failed",
    category: "next-step",
    audience: "all",
    when: "The gate cannot clear an obsolete receipt.",
    family: "gate-receipt",
    example: { reason: "the receipt file could not be removed" },
    template: ({ reason }): string =>
      `Fix the failure, then re-run \`discern done\`. discern could not clear the ` +
      `previous gate receipt${reasonSuffix(reason)}.`,
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
      "Fix the failure the last run reported, iterating with `discern " +
      "prepare` or `discern test`, then re-run `discern done` — nothing " +
      "changed since it judged this exact tree red, so an identical rerun " +
      "expects the identical verdict. Probing for a flaky verdict is the one " +
      "reason to re-run unchanged: `discern done --confirmed` does that, and " +
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
      "Run `discern status` — this exact tree already passed `discern done`, " +
      "and status shows the receipt's standing without re-running anything. " +
      "To re-run the full gate on it anyway, run `discern done --confirmed`.",
  }),

  "gate-failure-gotchas": defineHint<
    { command: string; path?: never } | { path: string; command?: never }
  >({
    id: "gate-failure-gotchas",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure occurs, the project configures a gotchas document, and no trap matcher matches the failure.",
    family: "gotchas-doc",
    example: {
      command: "discern map 80-development/done-gate-gotchas --json",
    },
    template: (reference): string =>
      reference.command !== undefined
        ? `If the failure above isn't self-explanatory, run \`${reference.command}\` to read this project's known gate failures and their fixes.`
        : `If the failure above isn't self-explanatory, this project's known gate failures and their fixes are documented in \`${reference.path}\`.`,
  }),

  /**
   * The inlined trap (ADR 0189): a matcher in the gotchas doc recognized this
   * failure, so the entry's own prose replaces the generic pointer — the fix
   * arrives inside the failure instead of one fetch away. The body is bounded
   * by the gotchas surface before firing.
   */
  "gate-failure-gotcha-matched": defineHint<
    & { title: string; body: string }
    & ({ command: string; path?: never } | { path: string; command?: never })
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
      command: "discern map 80-development/done-gate-gotchas --json",
    },
    template: ({ title, body, ...reference }): string =>
      `This failure matches "${title}", a documented trap in this project's gate gotchas:\n\n${body}\n\n` +
      (reference.command !== undefined
        ? `Read the full page with \`${reference.command}\`.`
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

  /** The diagnostic-driven remedy for a failed fix stage. */
  "gate-failure-fix": defineGateFailureRemedyHint({
    id: "gate-failure-fix",
    category: "next-step",
    audience: "all",
    when: "The gate's fix stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_DIAGNOSTIC_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a failed build stage. */
  "gate-failure-build": defineGateFailureRemedyHint({
    id: "gate-failure-build",
    category: "next-step",
    audience: "all",
    when: "The gate's build stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_DIAGNOSTIC_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a standalone check-stage failure. */
  "gate-failure-check": defineGateFailureRemedyHint({
    id: "gate-failure-check",
    category: "next-step",
    audience: "all",
    when: "A standalone gate check fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_DIAGNOSTIC_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a standalone test-stage failure. */
  "gate-failure-test": defineGateFailureRemedyHint({
    id: "gate-failure-test",
    category: "next-step",
    audience: "all",
    when: "A standalone test run fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_DIAGNOSTIC_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for the full gate's combined check/test stage. */
  "gate-failure-check-test": defineGateFailureRemedyHint({
    id: "gate-failure-check-test",
    category: "next-step",
    audience: "all",
    when: "The full gate's combined check and test stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_DIAGNOSTIC_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for failed changed-scope checks. */
  "gate-failure-scope-gates": defineGateFailureRemedyHint({
    id: "gate-failure-scope-gates",
    category: "next-step",
    audience: "all",
    when: "One or more changed-scope gates fail.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `${GATE_DIAGNOSTIC_REMEDY_CORE} One or more scope gates failed.`,
  }),

  /** A gate stage changed a committed-clean tracked file. */
  "gate-failure-tree-drift": defineGateFailureRemedyHint({
    id: "gate-failure-tree-drift",
    category: "next-step",
    audience: "all",
    when: "A gate stage changes a tracked file from a committed-clean tree.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Review and commit the gate-produced tracked changes named by the diagnostics, then re-run the current discern command.",
  }),

  /** Discern-managed ignored output was committed to the repository. */
  "gate-failure-tracked-artifacts": defineGateFailureRemedyHint({
    id: "gate-failure-tracked-artifacts",
    category: "next-step",
    audience: "all",
    when: "The gate finds tracked discern-managed ignored artifacts.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Remove the discern-managed ignored artifacts named by the diagnostics from the Git index, run `discern refresh`, then re-run the current discern command.",
  }),

  /** Compiled agent guidance differs from its authored sources. */
  "gate-failure-guidance": defineGateFailureRemedyHint({
    id: "gate-failure-guidance",
    category: "next-step",
    audience: "all",
    when: "The gate finds compiled guidance drift.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Run `discern refresh`, then re-run the current discern command. If the guidance must change, edit `[guidance].sources`. Refresh overwrites Agent files.",
  }),

  /** Materialized skills differ from the effective authored set. */
  "gate-failure-skills": defineGateFailureRemedyHint({
    id: "gate-failure-skills",
    category: "next-step",
    audience: "all",
    when: "The gate finds materialized skill drift.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Run `discern refresh`, then re-run the current discern command. If a skill must change, edit its source in `[skills].dir`. Refresh overwrites materialized copies.",
  }),

  /** An effective skill cannot be read by supported agent runtimes. */
  "gate-failure-skill-frontmatter": defineGateFailureRemedyHint({
    id: "gate-failure-skill-frontmatter",
    category: "next-step",
    audience: "all",
    when: "The gate finds invalid frontmatter in an effective skill.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Fix each SKILL.md source named by the diagnostics, then re-run the current discern command. Agent runtimes cannot read invalid frontmatter.",
  }),

  /** Two ADR records claim the same number. */
  "gate-failure-adr-numbers": defineGateFailureRemedyHint({
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
  "gate-failure-adr-index": defineGateFailureRemedyHint({
    id: "gate-failure-adr-index",
    category: "next-step",
    audience: "all",
    when:
      "The maintained ADR index is out of date, or a record defeats its derivation.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Run `discern refresh` to regenerate the ADR index, commit the rewritten README, then re-run the current discern command. If the diagnostic says the index cannot be derived, fix what it names first — a record's first heading, or a marker pair in the README missing its END marker — and refresh again.",
  }),

  /** The map or a guidance source carries a reference readers cannot follow. */
  "gate-failure-map-integrity": defineGateFailureRemedyHint({
    id: "gate-failure-map-integrity",
    category: "next-step",
    audience: "all",
    when:
      "The gate finds a broken reference or stale example in the map or a guidance source.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Fix each documentation finding named by the diagnostics — repoint dead links and anchors, repair the metadata block, update stale `discern` examples, keep published pages out of the internal trees, and make skill citations name skills that exist — then re-run the current discern command.",
  }),

  /** The worktree branch does not contain the current trunk. */
  "gate-failure-merge": defineGateFailureRemedyHint({
    id: "gate-failure-merge",
    category: "next-step",
    audience: "all",
    when: "The worktree branch does not contain the current trunk.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Run `discern update` to bring the trunk into this branch and re-materialize, then re-run `discern done`.",
  }),

  /** A branch attempted to weaken a standard held by the trunk. */
  "gate-failure-standards": defineGateFailureRemedyHint({
    id: "gate-failure-standards",
    category: "next-step",
    audience: "all",
    when: "The branch weakens a standard limit held by the trunk.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Follow the standards diagnostics, then re-run the current discern command. Do not weaken a trunk limit on this branch. Moving a limit is an owner decision made on the trunk.",
  }),

  /** The gate cannot persist its Discern-owned state. */
  "gate-failure-write-access": defineGateFailureRemedyHint({
    id: "gate-failure-write-access",
    category: "next-step",
    audience: "all",
    when: "The gate cannot write Discern-owned state.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Grant the write access named by the diagnostics, then re-run the current discern command. The gate needs that access to persist its state.",
  }),

  /** Green-gate humility: a passing gate is mechanical proof, not semantic
   * proof. Fired only on a green run that emitted a receipt — the moment
   * "done" is about to be claimed. Carries the discipline of the retired
   * prove-it-works bundled skill (ADR 0173) at the moment it applies. */
  "gate-prove-it-works": defineHint({
    id: "gate-prove-it-works",
    category: "guardrail",
    audience: "agent",
    when: "A green gate emits a receipt — before the agent offers it as done.",
    example: undefined,
    template: (): string =>
      "A green gate is necessary, not sufficient — it cannot see a feature stubbed out behind the demo path or wired to nothing. Before offering this receipt as done, exercise the real artifact along the paths the change enables and report what you ran and what you observed.",
  }),

  /** The owner-consent step after a green gate. Agent-audience: reporting to an
   * owner and waiting is an agent's move — a person running `done` at a
   * terminal IS the owner, with nobody further to report to. The composition
   * contract (account first, one-line receipt last, page stays with discern)
   * is ADR 0188's. */
  "gate-relay-receipt": defineHint({
    id: "gate-relay-receipt",
    category: "next-step",
    audience: "agent",
    when: "A successful gate records a receipt ready for owner review.",
    example: undefined,
    template: (): string =>
      "If this completes the task, report it to your owner in your own words — the change, trade-offs, what you exercised beyond the gate — then end with `data.receipt.line` verbatim and stop. Don't paste the full receipt: your owner pulls it with `discern status --verbose`. Run `discern accept` only after they accept.",
  }),

  /** A green receipt whose exact tree the authority resolver covered. */
  "gate-land-under-verified-authority": defineHint<{
    source: LandingConsentSource;
    scopes: readonly string[];
  }>({
    id: "gate-land-under-verified-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A successful gate records a receipt for a tree with machine-verified landing authority.",
    family: "landing-authority",
    example: { source: "standing-grant", scopes: ["docs"] },
    template: ({ source, scopes }): string =>
      source === "effort-grant"
        ? "The owner pre-authorized this landing at the desk, and the receipt covers the clean HEAD. Run `discern accept` now to land it; acceptance rechecks the grant before the fast-forward. Report the landing with `data.receipt_line` afterward."
        : `The receipt's clean HEAD is covered by the standing grant for ${
          scopes.join(", ")
        }. Run \`discern accept\` now to land it; acceptance rechecks every changed path before the fast-forward. Report the landing with \`data.receipt_line\` afterward.`,
  }),

  /** A green receipt whose recorded authority left changed paths uncovered. */
  "gate-relay-uncovered-authority": defineHint<{
    uncovered: readonly string[];
    warnings: readonly string[];
  }>({
    id: "gate-relay-uncovered-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A successful gate records a receipt but recorded authority does not cover its tree.",
    family: "landing-authority",
    example: {
      uncovered: ["`src/main.ts` (scopes: engine)"],
      warnings: [],
    },
    template: ({ uncovered, warnings }): string =>
      `Report this task to your owner in your own words, end with \`data.receipt.line\` verbatim, and stop. The recorded grant does not cover ${
        uncovered.length > 0 ? uncovered.join(", ") : "this landing"
      }.${
        warnings.length > 0 ? ` ${warnings.join(" ")}` : ""
      } Don't paste the full receipt: your owner pulls it with \`discern status --verbose\`.`,
  }),

  "gate-update-docs": defineHint({
    id: "gate-update-docs",
    category: "next-step",
    audience: "all",
    when: "A gate run succeeds.",
    example: undefined,
    template: (): string =>
      "If you changed documented behavior, update the docs to match before you finish.",
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
      } with \`discern standards\` as needed: ${
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
      "Start this worktree's dev server to view the previewable change.",
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
      "Run `discern standards` to measure once and find pinnable slack. Then run " +
      "`discern standards --pin` on the same clean commit to reuse those " +
      "measurements. A pin dry-run measures nothing.",
  }),

  /** A same-commit check receipt supplied every measurement for the pin pass. */
  "standards-pin-reused-measurements": defineHint({
    id: "standards-pin-reused-measurements",
    category: "notice",
    audience: "all",
    when:
      "`standards --pin` reuses measurements from a same-commit check receipt.",
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
      return `Fix ${named}, then re-run \`discern standards --pin\` once green. ${
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

  /** The limits-only pin commit inherited the honored receipt for its parent. */
  "standards-pin-carried-receipt": defineHint({
    id: "standards-pin-carried-receipt",
    category: "notice",
    audience: "all",
    when: "A limits-only pin commit inherits its parent's gate receipt.",
    family: "standards-pin-receipt",
    example: undefined,
    template: (): string =>
      "The gate receipt now follows this pin commit. `discern accept` will skip the redundant gate re-run.",
  }),

  /** The pin commit had no honored receipt available to carry forward. */
  "standards-pin-no-receipt": defineHint({
    id: "standards-pin-no-receipt",
    category: "next-step",
    audience: "all",
    when: "A pin commit has no honored gate receipt to carry forward.",
    family: "standards-pin-receipt",
    example: undefined,
    template: (): string =>
      "Run `discern done` before accepting, or acceptance will re-run the gate. No current gate receipt was available to carry forward.",
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
      return "Run `discern update` before pinning against the latest trunk. " +
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
    receipted: boolean;
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
      receipted: true,
    },
    template: ({ standards, receipted }): string => {
      const shown = standards.slice(0, HINT_NAME_CAP);
      const slack = shown.map((standard) =>
        `${standard.name} (${standard.bound} ${standard.limit}, measured ${standard.measured}, pinning to ${standard.newLimit})`
      );
      const summary = slack.length > 0
        ? slack.join("; ")
        : "review data.standards";
      const remaining = Math.max(0, standards.length - shown.length);
      const overflow = remaining > 0
        ? ` Review ${remaining} more in data.standards.`
        : "";
      return `Run \`discern standards --pin\` to capture pinnable slack: ${summary}.${overflow} ${
        receipted
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

  /** A successful skills eject leaves the authored override ready to edit. */
  "skills-eject-edit-override": defineHint({
    id: "skills-eject-edit-override",
    category: "next-step",
    audience: "all",
    when: "`skills eject` creates an authored override.",
    example: undefined,
    template: (): string =>
      "Edit the override there. `discern skills list` confirms its location.",
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
      "Re-run `discern accept --confirmed` once the owner has accepted this " +
      "landing in the current conversation. The flag attests only to that " +
      "conversation; recorded standing and effort grants are checked directly.",
  }),

  /** The status route to the receipt and raw diff needed for owner review. */
  "accept-review-via-status": defineHint({
    id: "accept-review-via-status",
    category: "next-step",
    audience: "all",
    when: "`accept` needs the receipt and diff surfaced by `status`.",
    family: "accept-consent",
    example: undefined,
    template: (): string =>
      "Run `discern status` to get the honored receipt for the owner's review " +
      "(data.gate_receipt.receipt) and the exact `git diff` command for the raw " +
      "change.",
  }),

  /** Landing succeeded, but its best-effort agent-file refresh did not. */
  "accept-refresh-failed": defineHint<{ trunk: string; mainRepo: string }>({
    id: "accept-refresh-failed",
    category: "next-step",
    audience: "all",
    when: "Landing succeeds but the post-landing refresh fails.",
    family: "post-landing-convergence",
    example: { trunk: "main", mainRepo: "/workspace/project" },
    template: ({ trunk, mainRepo }): string =>
      `Run \`discern refresh\` in ${mainRepo}. Acceptance landed on ${trunk}, ` +
      `but the post-landing refresh failed.`,
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
   * report and the full page as the durable landing record. */
  "accept-relay-landing-receipt": defineHint({
    id: "accept-relay-landing-receipt",
    category: "next-step",
    audience: "agent",
    when: "`accept` lands successfully and returns a one-line landing receipt.",
    example: undefined,
    template: (): string =>
      "Report the landing in your own words, then end your response with `data.receipt_line` verbatim. `data.receipt` is the full landing record; paste that Markdown into a PR body when one exists.",
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
        ? `Run \`discern update\` to apply ${source}, then \`discern done\`. The ` +
          "detailed preview summary was unavailable."
        : `Run \`discern done\` to verify the merged tree. The detailed ${source} ` +
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
        ? `Run \`discern update\` to apply, then re-read the ${files}`
        : `Re-read the ${files}`;
      return `${action} This branch and ${source} ${
        predicted ? "both touch" : "both changed"
      } them, and a clean merge cannot catch semantic conflicts. Run ` +
        `\`discern done\` after reviewing them.` +
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
        ? "Run `discern update` to apply, then `discern done`."
        : "Run `discern done` to verify the merged tree.";
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
    example: { name: "✨" },
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
      standingScopes: ["docs"],
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
      `Start a session rooted at ${dir} (or cd there) to continue. Do not keep ` +
      `working in the main checkout.`,
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
      "Session opened in the main checkout — the trunk every effort lands " +
      "on. Before editing, run `discern start` and work in the worktree it " +
      "returns. A worktree is for changes; questions and investigation read " +
      "from anywhere.",
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
      `Fix the setup refresh error, then run \`discern refresh\`: ${message}`,
  }),

  /** Existing authored agent guidance was preserved in the canonical source. */
  "setup-guidance-preserved": defineHint<{
    paths: readonly string[];
    guidanceRel: string;
  }>({
    id: "setup-guidance-preserved",
    category: "next-step",
    audience: "all",
    when:
      "Setup migrates existing authored guidance into the canonical source.",
    family: "setup-guidance-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      guidanceRel: SOURCE_PATHS.guidance.defaultPath,
    },
    template: ({ paths, guidanceRel }): string =>
      `Fold the guidance migrated from ${
        paths.join(", ")
      } into your conventions, then delete the import note from ${guidanceRel}. ` +
      `Setup preserved the existing guidance there.`,
  }),

  /** A pre-existing agent file matched discern's own prior compiled output. */
  "setup-guidance-own-render-skipped": defineHint<{
    paths: readonly string[];
    guidanceRel: string;
  }>({
    id: "setup-guidance-own-render-skipped",
    category: "notice",
    audience: "all",
    when: "Setup recognizes an Agent file as its own prior compiled output.",
    family: "setup-guidance-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      guidanceRel: SOURCE_PATHS.guidance.defaultPath,
    },
    template: ({ paths, guidanceRel }): string =>
      `Skipped importing ${
        paths.join(", ")
      } into ${guidanceRel}. It matches discern's own compiled output from an ` +
      `earlier setup, not your authoring.`,
  }),

  /** A completed setup on the dedicated setup branch is ready to land. */
  "setup-done-land-dedicated": defineHint<{
    branch: string;
    target: string;
    acceptCommand: string;
  }>({
    id: "setup-done-land-dedicated",
    category: "next-step",
    audience: "all",
    when: "Setup completes on the dedicated setup branch.",
    family: "setup-done-next",
    example: {
      branch: "discern-setup",
      target: "main",
      acceptCommand: "discern setup accept",
    },
    template: ({ branch, target, acceptCommand }): string =>
      `Land setup with \`${acceptCommand}\`, or leave it for review. It is on ` +
      `\`${branch}\`, not yet on \`${target}\`.`,
  }),

  /** A setup performed on another feature branch must use the project's normal merge. */
  "setup-done-land-manually": defineHint<{
    branch: string;
    target: string;
    acceptCommand: string;
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
      acceptCommand: "discern setup accept",
      setupBranch: "discern-setup",
    },
    template: ({ branch, target, acceptCommand, setupBranch }): string =>
      `Merge \`${branch}\` into \`${target}\` your usual way when ready. ` +
      `\`${acceptCommand}\` only lands the \`${setupBranch}\` branch.`,
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
      "Before continuing, reactivate every configured coding agent using the provider-specific steps below. discern's MCP tools, session hooks, and project rules are now wired, but coding agents load them at session start, so this session cannot use them yet:",
  }),

  /** Setup's final coaching route for deepening the newly-wired project.
   * Agent-audience: "review the findings with your human" is an instruction
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
      `Deepen your setup: run \`discern ${coachVerb} --json\` (the project coach), review the findings with your human, do the quick wins now, and record larger ones in ${todoRel}.`,
  }),

  /**
   * Doctor context for the shared unfinished-setup action. Doctor is a required
   * setup check, but a healthy result is not proof that setup is complete.
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
        "Running `discern doctor` is a required setup step. A healthy result proves install health only. It does not complete the setup brief or record setup completion.",
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
      "Apply the fix listed under each failed check, then run `discern doctor` again.",
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
      "Run `discern upgrade` to apply pending migrations and reconcile this install.",
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

  /** The optional canonical suggestion in an unknown-command refusal. */
  "unknown-command-suggestion": defineHint<{ command: string }>({
    id: "unknown-command-suggestion",
    category: "next-step",
    audience: "all",
    when: "An unknown command has a canonical suggestion.",
    family: "unknown-command",
    example: { command: "status" },
    template: ({ command }): string => `Did you mean \`discern ${command}\`?`,
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
      "Run `discern help` for the documentation, or `discern --help` to list the commands.",
  }),

  /**
   * The MCP-specific start re-root guardrail. It distinguishes the server's
   * automatic tool re-aim from the file move the client must perform, gives the
   * fallback for a fixed working root, and names the split-state consequence.
   * Agent-audience: it fires only over MCP and instructs the connected agent.
   */
  "start-mcp-re-root": defineHint<{ path: string }>({
    id: "start-mcp-re-root",
    category: "guardrail",
    audience: "agent",
    when:
      "`start` runs through the Model Context Protocol and the client must re-root before editing.",
    family: "start-result",
    example: { path: "/workspace/project.worktrees/hint-registry" },
    template: ({ path }): string =>
      `Re-root or cd into ${path} before editing. discern's MCP tools already ` +
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
 * Add the registered recovery floor to a failed result only when no narrower
 * next step is already present and the result carries the message or diagnostic
 * the instruction tells the caller to use. Both CLI and MCP call this before
 * serialization, so their wire envelopes and locally observed hint ids stay
 * identical. A data-only failure must supply a tailored next step.
 */
export function withFailureRecoveryHint<TData>(
  result: DiscernResult<TData>,
): DiscernResult<TData> {
  if (
    result.ok || hasRegisteredActionableHint(result.hints) ||
    !hasFailureRecoveryEvidence(result)
  ) {
    return result;
  }
  return {
    ...result,
    hints: appendHintTexts(result.hints, [failureRecoveryHint(result.verb)]),
  };
}

/**
 * Failed-stage lookup into the registry. Total over {@link FailedStage}, so a new
 * stage cannot compile until its remedy is registered and enrolled here.
 */
export const GATE_FAILURE_REMEDIES = {
  fix: HINTS["gate-failure-fix"],
  build: HINTS["gate-failure-build"],
  check: HINTS["gate-failure-check"],
  test: HINTS["gate-failure-test"],
  "check/test": HINTS["gate-failure-check-test"],
  scope_gates: HINTS["gate-failure-scope-gates"],
  tree_drift: HINTS["gate-failure-tree-drift"],
  tracked_artifacts: HINTS["gate-failure-tracked-artifacts"],
  guidance: HINTS["gate-failure-guidance"],
  skills: HINTS["gate-failure-skills"],
  skill_frontmatter: HINTS["gate-failure-skill-frontmatter"],
  adr_numbers: HINTS["gate-failure-adr-numbers"],
  adr_index: HINTS["gate-failure-adr-index"],
  map_integrity: HINTS["gate-failure-map-integrity"],
  merge: HINTS["gate-failure-merge"],
  standards: HINTS["gate-failure-standards"],
  write_access: HINTS["gate-failure-write-access"],
} as const satisfies Record<FailedStage, HintDef<undefined>>;

/** Fire the registered remedy for a failed gate stage. */
export function gateFailureRemedy(stage: FailedStage): FiredHint {
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
 * The fired entries an interactive human renderer prints: agent-audience
 * entries drop, everything else passes in order. The single projection every
 * human surface uses — the wire envelope always carries the full channel.
 */
export function interactiveHints(
  fired: readonly FiredHint[],
): FiredHint[] {
  return fired.filter((hint) => !hintHasAudience(hint, "agent"));
}

/**
 * Project a result's wire hints for an interactive human renderer. Entries
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
  return texts.filter((text) => !drop.has(text));
}
