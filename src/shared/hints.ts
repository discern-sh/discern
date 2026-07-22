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

import type { FailedStage } from "./result.ts";
import { SOURCE_PATHS } from "./paths_registry.ts";

/**
 * How an entry means to steer the caller. `next-step` names the action to
 * take from here; `guardrail` states a rule protecting shared state before
 * it is broken; `notice` discloses a condition the caller should weigh but
 * need not act on.
 */
export type HintCategory = "next-step" | "guardrail" | "notice";

/**
 * Which surfaces render an entry. `all` reaches every surface; `agent` marks
 * hints written for coding agents that the interactive human renderers drop
 * (the fleet-ownership and trunk guardrails today) — the drop keys on this
 * field, not on reconstructing the rendered string.
 */
export type HintAudience = "all" | "agent";

/** One registered hint: a stable id, its classification, and a typed template. */
export interface HintDef<P = undefined> {
  /** Stable kebab-case identifier — the logbook, renderers, and tests key on it. */
  readonly id: string;
  readonly category: HintCategory;
  readonly audience: HintAudience;
  /**
   * Groups variants of one underlying fact (the restart-session family, the
   * generated-file-drift family) so wording reviews see them side by side.
   */
  readonly family?: string;
  /** Realistic placeholder parameters for validation and generated inventory. */
  readonly example: P;
  /** Renders the hint from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
}

/** Identity helper so an entry's parameter type is inferred at the definition. */
export function defineHint<P = undefined>(def: HintDef<P>): HintDef<P> {
  return def;
}

/** A hint fired at a call site: the in-process pair; only `text` reaches the wire. */
export interface FiredHint {
  readonly id: string;
  readonly text: string;
}

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
  return fired.map((f) => f.text);
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

/** Shared action for every unfinished-setup context. */
const SETUP_UNFINISHED_CORE =
  "Run `discern setup begin` to print or reprint the brief without changing your " +
  "work, complete it, then run `discern setup done`; do not report setup complete " +
  "until that command passes.";

/** Add one context-specific lead-in to the canonical unfinished-setup action. */
function setupUnfinishedHint(leadIn: string): string {
  return `${leadIn} ${SETUP_UNFINISHED_CORE}`;
}

/** Shared remedy for every missing or stale discern-managed artifact. */
const GENERATED_DRIFT_CORE =
  "Run `discern refresh` to restore discern-managed artifacts.";

/** Add one artifact-specific lead-in and optional source-ownership instruction. */
function generatedDriftHint(leadIn: string, followUp?: string): string {
  return `${leadIn} ${GENERATED_DRIFT_CORE}${
    followUp === undefined ? "" : ` ${followUp}`
  }`;
}

/** Shared lifecycle fact behind every restart-session action. */
const RESTART_SESSION_CORE =
  "Agent sessions load discern's MCP server, engine, and templates only when they " +
  "start or reload their MCP servers.";

/** Add one context-specific restart action to the canonical lifecycle fact. */
function restartSessionHint(leadIn: string): string {
  return `${leadIn} ${RESTART_SESSION_CORE}`;
}

/** Maximum fleet names rendered in one class summary. */
const FLEET_HINT_NAME_CAP = 3;

/** Render a bounded fleet-name sample while preserving the class's full count. */
function fleetNameSummary(total: number, names: readonly string[]): string {
  const shown = names.slice(0, FLEET_HINT_NAME_CAP);
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
  /** Status lead-in to the shared unfinished-setup action, including marker count. */
  "setup-unfinished-status": defineHint<{ pendingCount: number }>({
    id: "setup-unfinished-status",
    category: "next-step",
    audience: "all",
    family: "setup-unfinished",
    example: { pendingCount: 2 },
    template: ({ pendingCount }): string => {
      const tail = pendingCount > 0
        ? ` ${pendingCount} ${
          pendingCount === 1 ? "file still carries" : "files still carry"
        } skeleton markers.`
        : "";
      return setupUnfinishedHint(
        "Finish setup in this session instead of handing it back as a report." +
          tail,
      );
    },
  }),

  /** One-line warning when the configured integration branch cannot be checked. */
  "missing-integration-branch": defineHint<{ branch: string }>({
    id: "missing-integration-branch",
    category: "next-step",
    audience: "all",
    example: { branch: "main" },
    template: ({ branch }): string =>
      `The merge check could not run because the trunk branch '${branch}' is ` +
      `not available locally. Create that local branch, or set ` +
      `[repository].trunk to the branch this project uses, then re-run.`,
  }),

  /**
   * The pristine-worktree / dirty-main signature shared by status and done. It
   * catches edits landing on the trunk while discern's tools run in a worktree.
   */
  "silent-worktree-divergence": defineHint<{
    cwd: string;
    mainRepo: string;
    changedFiles: number;
  }>({
    id: "silent-worktree-divergence",
    category: "guardrail",
    audience: "all",
    example: {
      cwd: "/workspace/project.worktrees/task",
      mainRepo: "/workspace/project",
      changedFiles: 2,
    },
    template: ({ cwd, mainRepo, changedFiles }): string =>
      `This worktree is untouched (no changes, no commits), but the main ` +
      `checkout at ${mainRepo} has ${changedFiles} uncommitted change` +
      `${changedFiles === 1 ? "" : "s"}. If those are your edits, they are ` +
      `landing on the trunk while discern runs here — work INSIDE this worktree: ` +
      `prefix every shell command with \`cd ${cwd} && …\` and pass ` +
      `path="${cwd}" to discern's MCP tools.`,
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
    example: {
      pathSummary: ".claude/skills",
      repairCommand: "git rm -r --cached .claude/skills",
    },
    template: ({ pathSummary, repairCommand }): string =>
      `Discern-managed ignored artifacts are tracked by Git (${pathSummary}); remove them from the index with \`${repairCommand}\`, then run \`discern refresh\`.`,
  }),

  /**
   * Compiled guidance files are present but untracked and not ignored. Committing
   * them puts the same guidance in reach of agents reading a fresh clone.
   */
  "untracked-agent-files": defineHint<{ paths: readonly string[] }>({
    id: "untracked-agent-files",
    category: "next-step",
    audience: "all",
    example: { paths: ["AGENTS.md", "CLAUDE.md"] },
    template: ({ paths }): string =>
      `The agent files are untracked (${
        paths.join(", ")
      }); commit them so cloud and out-of-tool agents read the same guidance from a fresh clone.`,
  }),

  /** Missing agent-file lead-in to the shared generated-drift remedy. */
  "generated-agent-files-missing": defineHint<{ paths: string }>({
    id: "generated-agent-files-missing",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(`Restore the missing agent files (${paths}).`),
  }),

  /** Stale agent-file lead-in plus its authored-source instruction. */
  "generated-agent-files-stale": defineHint<{ paths: string }>({
    id: "generated-agent-files-stale",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Rebuild the out-of-date agent files (${paths}).`,
        "Edit [guidance].sources. Refresh overwrites the generated agent files.",
      ),
  }),

  /** Missing materialized-skills lead-in to the shared generated-drift remedy. */
  "materialized-skills-missing": defineHint<{ dirs: string }>({
    id: "materialized-skills-missing",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    example: { dirs: ".claude/skills" },
    template: ({ dirs }): string =>
      generatedDriftHint(`Materialize the missing skills (${dirs}).`),
  }),

  /** Stale materialized-skills lead-in plus its authored-source instruction. */
  "materialized-skills-stale": defineHint<{ dirs: string }>({
    id: "materialized-skills-stale",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    example: { dirs: ".claude/skills" },
    template: ({ dirs }): string =>
      generatedDriftHint(
        `Re-materialize the out-of-date skills (${dirs}).`,
        "Edit [skills].dir. Refresh overwrites the materialized copies.",
      ),
  }),

  /** Missing provider-integration lead-in to the shared generated-drift remedy. */
  "provider-integrations-missing": defineHint<{ paths: string }>({
    id: "provider-integrations-missing",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    example: { paths: ".codex/config.toml" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Restore the missing provider integration files (${paths}).`,
      ),
  }),

  /** Provider-integration drift lead-in plus its malformed-file recovery. */
  "provider-integrations-stale": defineHint<{ paths: string }>({
    id: "provider-integrations-stale",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    example: { paths: ".codex/config.toml" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Repair the provider integration files that need attention (${paths}).`,
        "If refresh reports a malformed settings file, repair it and run `discern refresh` again.",
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
    family: "status-start-here",
    example: { branch: "agent/hints", trunk: "main" },
    template: ({ branch, trunk }): string => {
      const label = branch === "" ? "(detached)" : `'${branch}'`;
      return `The main checkout is parked on ${label}, not '${trunk}' (the trunk). ` +
        `That's fine while you work with ${label} deliberately — new worktrees ` +
        `still fork from the trunk — but \`discern accept\` can't land until the checkout ` +
        `returns: run \`git switch ${trunk}\` here when you're done. To start new ` +
        `work meanwhile, run \`discern start\` (never adopt an existing idle ` +
        `worktree — each belongs to another line of work).`;
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
    example: { branch: "develop", trunk: "main" },
    template: ({ branch, trunk }): string => {
      const label = branch === "" ? "(detached)" : `'${branch}'`;
      return `The configured trunk ('${trunk}', [repository].trunk) doesn't ` +
        `exist in this repository — the main checkout is on ${label}. Worktrees ` +
        `can't fork from it and \`discern accept\` can't land on it until they agree: set ` +
        `[repository].trunk to the branch this project actually uses, or ` +
        `create the trunk (\`git branch ${trunk}\`).`;
    },
  }),

  "status-dirty-worktree-scoped": defineHint<{ scopes: readonly string[] }>({
    id: "status-dirty-worktree-scoped",
    category: "next-step",
    audience: "all",
    family: "status-dirty-worktree",
    example: { scopes: ["code", "docs"] },
    template: ({ scopes }): string =>
      `Changes in ${
        scopes.join(", ")
      }; use \`discern prepare\` or targeted tests while iterating, then commit the intended final tree and run \`discern done\` on the clean HEAD before calling work done.`,
  }),

  "status-dirty-worktree": defineHint({
    id: "status-dirty-worktree",
    category: "next-step",
    audience: "all",
    family: "status-dirty-worktree",
    example: undefined,
    template: (): string =>
      "Uncommitted changes; use `discern prepare` or targeted tests while iterating, then commit the intended final tree and run `discern done` on the clean HEAD before calling work done.",
  }),

  "status-branch-behind": defineHint<{
    behind: number;
    trunk: string;
    overlap: { total: number; paths: readonly string[] } | undefined;
  }>({
    id: "status-branch-behind",
    category: "next-step",
    audience: "all",
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
        ? ` ${overlap.total} of your changed file(s) also changed upstream (${
          overlap.paths.slice(0, 3).join(", ")
        }${overlap.total > 3 ? ", …" : ""}) — re-check those after updating.`
        : "";
      return `Branch is ${behind} behind ${trunk}; call \`discern update\` directly — it is idempotent and performs its own git preconditions — then run \`discern done\` before handing off or a user-requested landing.${overlapNote}`;
    },
  }),

  "status-main-checkout-dirty": defineHint<{ trunk: string }>({
    id: "status-main-checkout-dirty",
    category: "next-step",
    audience: "all",
    family: "status-review-readiness",
    example: { trunk: "main" },
    template: ({ trunk }): string =>
      `Committed and up to date with ${trunk}, but the main checkout has uncommitted tracked changes — commit or stash them there before a user-requested landing can proceed.`,
  }),

  "status-ready-for-review": defineHint<{ trunk: string; branch: string }>({
    id: "status-ready-for-review",
    category: "next-step",
    audience: "all",
    family: "status-review-readiness",
    example: { trunk: "main", branch: "agent/hints" },
    template: ({ trunk, branch }): string =>
      `Committed, up to date with ${trunk}, and this clean HEAD has an honored receipt from \`discern done\` — ready for owner review: relay the receipt (data.gate_receipt.receipt) to your owner and wait; they can inspect the raw diff with \`git diff ${trunk}...${branch}\`. Run \`discern accept\` only after the user explicitly asks you to land it.`,
  }),

  "status-missing-done-receipt": defineHint<{ trunk: string }>({
    id: "status-missing-done-receipt",
    category: "next-step",
    audience: "all",
    family: "status-review-readiness",
    example: { trunk: "main" },
    template: ({ trunk }): string =>
      `Committed and up to date with ${trunk}, but this clean HEAD has no honored receipt from \`discern done\`; run \`discern done\` before reporting the branch ready for review or a user-requested landing.`,
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
    example: undefined,
    template: (): string =>
      "Never work in a fleet worktree you didn't create. Each belongs to another line of work, and a clean tree may still be in use.",
  }),

  "status-no-active-worktrees": defineHint({
    id: "status-no-active-worktrees",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string => "No active worktrees; start one to begin work.",
  }),

  /** One bounded summary for every fleet member with uncommitted changes. */
  "status-dirty-fleet-members": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-dirty-fleet-members",
    category: "next-step",
    audience: "all",
    example: {
      total: 5,
      names: ["hint-registry", "docs-refresh", "gate-copy", "cli-help"],
    },
    template: ({ total, names }): string =>
      `Review ${total} worktree${total === 1 ? "" : "s"} with uncommitted ` +
      `changes: ${fleetNameSummary(total, names)}.`,
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
    example: {
      total: 5,
      names: ["hint-registry", "docs-refresh", "gate-copy", "cli-help"],
      trunk: "main",
    },
    template: ({ total, names, trunk }): string =>
      `Review ${total} worktree${total === 1 ? "" : "s"} with committed work ` +
      `ready for owner review: ${
        fleetNameSummary(total, names)
      }. Use each branch ` +
      `from \`data.fleet\` with \`git diff ${trunk}...<branch>\`.`,
  }),

  /** One bounded summary for every fleet member whose git state is unreadable. */
  "status-fleet-member-unreadable": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-unreadable",
    category: "next-step",
    audience: "all",
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
      } whose git state cannot be read: ${fleetNameSummary(total, names)}. ` +
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
      } whose setup never completed: ${fleetNameSummary(total, names)}. ` +
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
        fleetNameSummary(total, names)
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
    example: { branches: ["agent/old-task", "agent/paused-task"] },
    template: ({ branches }): string =>
      `${branches.length} branch${branches.length === 1 ? "" : "es"} hold${
        branches.length === 1 ? "s" : ""
      } unlanded work with no worktree: ${
        branches.join(", ")
      }. Pull one into new work with \`discern start --from <branch>\` (or ` +
      `\`discern update --from <branch>\` from an existing worktree), or ` +
      `delete it with \`git branch -D <branch>\`.`,
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
    family: "coupling-evidence",
    example: {
      a: "src/main.ts",
      b: "tests/main_test.ts",
      ofA: 6,
      ofB: 4,
    },
    template: ({ a, b, ofA, ofB }): string =>
      `\`${a}\` and \`${b}\` have not changed together in recent history ` +
      `(from git history; \`${a}\`: ${ofA} commit(s), \`${b}\`: ${ofB} commit(s)).`,
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
    family: "coupling-partners",
    example: { from: "src/main.ts", path: "tests/main_test.ts" },
    template: ({ from, path }): string =>
      `Add a forcing-function if \`${from}\` and \`${path}\` share an essential ` +
      "invariant. They change together almost every time. The `discern-cure-a-bug` " +
      "skill covers the pattern.",
  }),

  "patterns-logbook-empty": defineHint({
    id: "patterns-logbook-empty",
    category: "notice",
    audience: "all",
    example: undefined,
    template: (): string =>
      "The logbook is empty. discern records one event per verb run, locally " +
      "under the repository's git directory — check back after some use.",
  }),

  "patterns-insufficient-evidence": defineHint<{
    young: number;
    total: number;
  }>({
    id: "patterns-insufficient-evidence",
    category: "notice",
    audience: "all",
    example: { young: 4, total: 10 },
    template: ({ young, total }): string =>
      `The logbook is too young for ${young} of ${total} ` +
      `detectors — each reports insufficient evidence rather than guessing.`,
  }),

  "patterns-advisory-findings": defineHint({
    id: "patterns-advisory-findings",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "Advisory findings: each next step says what to inspect or enforce.",
  }),

  "patterns-recording-off": defineHint({
    id: "patterns-recording-off",
    category: "notice",
    audience: "all",
    example: undefined,
    template: (): string =>
      "Recording is off ([project].logbook = false), so new runs aren't " +
      "recorded; this report reads the history that already exists.",
  }),

  "patterns-reset-empty": defineHint({
    id: "patterns-reset-empty",
    category: "notice",
    audience: "all",
    family: "patterns-reset",
    example: undefined,
    template: (): string => "No logbook to remove — nothing has been recorded.",
  }),

  "patterns-reset-preview": defineHint({
    id: "patterns-reset-preview",
    category: "next-step",
    audience: "all",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "A preview — nothing was removed. Run without --dry-run to delete.",
  }),

  "patterns-reset-recording-resumes": defineHint({
    id: "patterns-reset-recording-resumes",
    category: "notice",
    audience: "all",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "The history is gone; recording starts again on the next verb run. " +
      "Set [project].logbook = false to stop recording entirely.",
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
    family: "logbook-inline-finding",
    example: {
      count: 2,
      observed: "This branch has repeated the same failed stage.",
    },
    template: ({ count, observed }): string =>
      `Logbook: ${count} branch finding${count === 1 ? "" : "s"}; ` +
      `${observed} Run \`discern patterns\` for full evidence and next steps.`,
  }),

  /** A session-scoped finding rendered as its observation and next step. */
  "logbook-status-finding": defineHint<{
    observed: string;
    next: string;
  }>({
    id: "logbook-status-finding",
    category: "next-step",
    audience: "all",
    family: "logbook-inline-finding",
    example: {
      observed: "The same worktree has been refused 3 times.",
      next: "Inspect its current branch and receipt.",
    },
    template: ({ observed, next }): string =>
      `Logbook: ${observed} Next: ${next}`,
  }),

  /**
   * Gate-context lead-in to the shared unfinished-setup action. Gate verbs run
   * during setup, but their output is not the final project verdict yet.
   */
  "setup-unfinished-gate": defineHint({
    id: "setup-unfinished-gate",
    category: "guardrail",
    audience: "all",
    family: "setup-unfinished",
    example: undefined,
    template: (): string =>
      setupUnfinishedHint(
        "Finish setup before treating this gate output as the final verdict.",
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
    example: {
      label: "lint",
      errorLikeLines: 12,
      outputLines: 80,
      outputPath: "/tmp/discern-job-lint.log",
    },
    template: ({ label, errorLikeLines, outputLines, outputPath }): string => {
      const where = outputPath === undefined
        ? ""
        : ` - output at ${outputPath}`;
      return `${label} passed but printed ${errorLikeLines} error-like line(s) across ${outputLines} output line(s)${where}.`;
    },
  }),

  /** A trivial test pass when no test-stage job is wired. */
  "test-job-not-configured": defineHint({
    id: "test-job-not-configured",
    category: "notice",
    audience: "all",
    example: undefined,
    template: (): string =>
      'No test job is configured (set test = "<command>" under [jobs] in discern.toml).',
  }),

  "gate-trunk-advanced": defineHint({
    id: "gate-trunk-advanced",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "The trunk advanced while the gate ran, so this branch is behind it now. " +
      "The gate still passed for this HEAD. Run `discern update`, then " +
      "`discern done` again before `discern accept`.",
  }),

  "gate-standards-limits-unverified": defineHint<{
    reason: string;
    trunk: string;
  }>({
    id: "gate-standards-limits-unverified",
    category: "next-step",
    audience: "all",
    family: "standards-limits-unverified",
    example: { reason: "the local branch is missing", trunk: "main" },
    template: ({ reason, trunk }): string =>
      `Standards limits are UNVERIFIED — the never-loosen check could not read the trunk (${reason}). Fetch the trunk where the gate runs (in CI: \`git fetch origin ${trunk}:${trunk}\`) so limits are verified.`,
  }),

  "gate-receipt-skipped-dirty": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-receipt-skipped-dirty",
    category: "next-step",
    audience: "all",
    family: "gate-receipt",
    example: { reason: "2 tracked files changed" },
    template: ({ reason }): string =>
      `Gate passed, but no gate receipt was recorded because the worktree is dirty${
        reasonSuffix(reason)
      }. Use \`discern prepare\` or \`discern test\` while iterating, then commit the intended final tree and re-run \`discern done\` on the clean HEAD before handoff or acceptance.`,
  }),

  "gate-receipt-head-moved": defineHint<{ reason: string | undefined }>({
    id: "gate-receipt-head-moved",
    category: "next-step",
    audience: "all",
    family: "gate-receipt",
    example: { reason: "HEAD changed from a1b2c3d to d4e5f6a" },
    template: ({ reason }): string =>
      `Gate passed, but no gate receipt was recorded because HEAD moved while the gate was running${
        reasonSuffix(reason)
      } — the receipt can only vouch for the exact tree the gate tested. Re-run \`discern done\` on the final commit before handoff or acceptance.`,
  }),

  "gate-receipt-record-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-receipt-record-failed",
    category: "next-step",
    audience: "all",
    family: "gate-receipt",
    example: { reason: "the receipt file could not be written" },
    template: ({ reason }): string =>
      `Gate passed, but discern could not record the gate receipt${
        reasonSuffix(reason)
      }; \`discern accept\` will re-run the gate unless a later \`discern done\` run records one.`,
  }),

  "gate-receipt-unavailable": defineHint<{ reason: string | undefined }>({
    id: "gate-receipt-unavailable",
    category: "notice",
    audience: "all",
    family: "gate-receipt",
    example: { reason: "write authority was not established" },
    template: ({ reason }): string =>
      `Gate passed, but discern could not prepare the gate receipt${
        reasonSuffix(reason)
      }; \`discern accept\` may need to re-run the gate.`,
  }),

  "gate-receipt-clear-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-receipt-clear-failed",
    category: "next-step",
    audience: "all",
    family: "gate-receipt",
    example: { reason: "the receipt file could not be removed" },
    template: ({ reason }): string =>
      `The gate failed, and discern could not clear the previous gate receipt${
        reasonSuffix(reason)
      }; re-run \`discern done\` after fixing the failure.`,
  }),

  "gate-failure-gotchas": defineHint<{ doc: string }>({
    id: "gate-failure-gotchas",
    category: "next-step",
    audience: "all",
    example: { doc: "docs/when-the-gate-fails.md" },
    template: ({ doc }): string =>
      `If the failure above isn't self-explanatory, this project's known gate failures and their fixes are documented in ${doc}.`,
  }),

  /** A failed fix stage needs no more specific recovery than the stage verdict. */
  "gate-failure-fix": defineHint({
    id: "gate-failure-fix",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => "The fix stage failed.",
  }),

  /** A failed build stage needs no more specific recovery than the stage verdict. */
  "gate-failure-build": defineHint({
    id: "gate-failure-build",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => "The build stage failed.",
  }),

  /** The standalone prepare check-stage failure remedy. */
  "gate-failure-check": defineHint({
    id: "gate-failure-check",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => "The check stage failed.",
  }),

  /** The standalone test-stage failure remedy. */
  "gate-failure-test": defineHint({
    id: "gate-failure-test",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => "The test stage failed.",
  }),

  /** The combined check/test stage used by the full gate. */
  "gate-failure-check-test": defineHint({
    id: "gate-failure-check-test",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => "The check/test stage failed.",
  }),

  /** One or more changed-scope checks rejected the tree. */
  "gate-failure-scope-gates": defineHint({
    id: "gate-failure-scope-gates",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => "One or more scope gates failed.",
  }),

  /** A gate stage changed a committed-clean tracked file. */
  "gate-failure-tree-drift": defineHint({
    id: "gate-failure-tree-drift",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "The gate left uncommitted changes on tracked files — commit the gate's own output (the diagnostic names the stage that produced it), then re-run.",
  }),

  /** Discern-managed ignored output was committed to the repository. */
  "gate-failure-tracked-artifacts": defineHint({
    id: "gate-failure-tracked-artifacts",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Discern-managed ignored artifacts are tracked by Git — remove them from the index, run `discern refresh`, then re-run.",
  }),

  /** Compiled agent guidance differs from its authored sources. */
  "gate-failure-guidance": defineHint({
    id: "gate-failure-guidance",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Agent files are out of date — run `discern refresh` (edits belong in your [guidance].sources, not the generated file, which a refresh overwrites).",
  }),

  /** Materialized skills differ from the effective authored set. */
  "gate-failure-skills": defineHint({
    id: "gate-failure-skills",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Materialized skills are out of date — run `discern refresh` (edits belong in your [skills].dir source, not the materialized copy, which a refresh overwrites).",
  }),

  /** An effective skill cannot be read by supported agent runtimes. */
  "gate-failure-skill-frontmatter": defineHint({
    id: "gate-failure-skill-frontmatter",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "A skill's SKILL.md frontmatter is invalid — agent runtimes could not read it. The diagnostics name each file and problem; edit the skill's source, then re-run.",
  }),

  /** The worktree branch does not contain the current trunk. */
  "gate-failure-merge": defineHint({
    id: "gate-failure-merge",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Run `discern update` to bring the trunk in and re-materialize, then re-run `discern done`.",
  }),

  /** A branch attempted to weaken a standard held by the trunk. */
  "gate-failure-standards": defineHint({
    id: "gate-failure-standards",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "A [standards] limit failed verification against the trunk — a limit only tightens on a branch; the diagnostics name each standard and both values.",
  }),

  /** The gate cannot persist its Discern-owned state. */
  "gate-failure-write-access": defineHint({
    id: "gate-failure-write-access",
    category: "next-step",
    audience: "all",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Discern cannot write the state this gate will persist — grant this command the write access named in diagnostics, then re-run.",
  }),

  "gate-relay-receipt": defineHint({
    id: "gate-relay-receipt",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "If this completes the task, relay the receipt to your owner and stop; run `discern accept` only once they accept.",
  }),

  "gate-update-docs": defineHint({
    id: "gate-update-docs",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "If you changed documented behaviour, update the docs to match before you finish.",
  }),

  "gate-deferred-standards": defineHint<{ names: readonly string[] }>({
    id: "gate-deferred-standards",
    category: "next-step",
    audience: "all",
    example: { names: ["coverage", "binary_size"] },
    template: ({ names }): string =>
      `${names.length} standard(s) deferred from the gate (measure = "on-demand"): ${
        names.join(", ")
      } — the never-loosen limit check still ran; measure them with \`discern standards\` as needed.`,
  }),

  "gate-previewable-change": defineHint({
    id: "gate-previewable-change",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "A previewable change landed — start this worktree's dev server to view it.",
  }),

  /** The pin pass has no configured metric to measure or tighten. */
  "standards-pin-empty": defineHint({
    id: "standards-pin-empty",
    category: "notice",
    audience: "all",
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
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "A pin dry-run measures nothing. `discern standards` (the plain check) " +
      "measures once and names any pinnable slack in its hints; " +
      "`discern standards --pin` on the same clean commit then reuses those " +
      "measurements to capture it.",
  }),

  /** A same-commit check receipt supplied every measurement for the pin pass. */
  "standards-pin-reused-measurements": defineHint({
    id: "standards-pin-reused-measurements",
    category: "notice",
    audience: "all",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "Reused the green check's measurements for this commit — nothing was re-measured.",
  }),

  /** A red standard blocks the whole pin rather than capturing a failing state. */
  "standards-pin-blocked": defineHint<{
    failingNames: readonly string[];
  }>({
    id: "standards-pin-blocked",
    category: "next-step",
    audience: "all",
    family: "standards-pin",
    example: { failingNames: ["coverage", "bundle_size"] },
    template: ({ failingNames }): string => {
      const named = failingNames.length > 0
        ? failingNames.join(", ")
        : "a standard";
      return `Not pinning: ${named} ${
        failingNames.length === 1 ? "is" : "are"
      } failing (diagnostics[] carries each reason). Fix them, then re-run \`discern standards --pin\` once green.`;
    },
  }),

  /** Every selected standard already equals its measured, margin-adjusted limit. */
  "standards-pin-no-slack": defineHint({
    id: "standards-pin-no-slack",
    category: "notice",
    audience: "all",
    family: "standards-pin",
    example: undefined,
    template: (): string =>
      "Nothing to pin — every standard asked for already sits at its measured value (within its margin).",
  }),

  /** The limits-only pin commit inherited the honored receipt for its parent. */
  "standards-pin-carried-receipt": defineHint({
    id: "standards-pin-carried-receipt",
    category: "notice",
    audience: "all",
    family: "standards-pin-receipt",
    example: undefined,
    template: (): string =>
      "Carried the gate receipt forward — `discern accept` will skip the redundant gate re-run.",
  }),

  /** The pin commit had no honored receipt available to carry forward. */
  "standards-pin-no-receipt": defineHint({
    id: "standards-pin-no-receipt",
    category: "next-step",
    audience: "all",
    family: "standards-pin-receipt",
    example: undefined,
    template: (): string =>
      "No current gate receipt to carry forward — run `discern done` before accepting, or accept re-runs the gate.",
  }),

  /** Standalone standards could not verify the branch limits against the trunk. */
  "standards-limits-unverified": defineHint<{
    reason: string | undefined;
  }>({
    id: "standards-limits-unverified",
    category: "next-step",
    audience: "all",
    family: "standards-limits-unverified",
    example: { reason: "the local trunk is missing" },
    template: ({ reason }): string =>
      `Standards limits are UNVERIFIED — the never-loosen check could not read the trunk (${
        reason ?? "unknown"
      }). Fetch the trunk where standards run so the limits can be verified.`,
  }),

  /** Pinning a branch behind the trunk may capture limits that an update invalidates. */
  "standards-pin-behind": defineHint<{
    behind: string;
    trunk: string;
  }>({
    id: "standards-pin-behind",
    category: "next-step",
    audience: "all",
    family: "standards-pin",
    example: { behind: "2", trunk: "main" },
    template: ({ behind, trunk }): string => {
      const commits = behind === "1" ? "commit" : "commits";
      return `This worktree is ${behind} ${commits} behind the trunk (${trunk}). ` +
        "The measured values describe this tree, and limits pinned now may not survive `discern update`. " +
        "Run `discern update` first to pin against the latest trunk.";
    },
  }),

  /** The standalone check has no configured standards to measure. */
  "standards-none-configured": defineHint({
    id: "standards-none-configured",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "No standards configured. Add a [standards.<name>] table to measure one.",
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
      const slack = standards.map((standard) =>
        `${standard.name} (${standard.bound} ${standard.limit}, measured ${standard.measured} — would pin to ${standard.newLimit})`
      );
      return `Pinnable slack: ${
        slack.join("; ")
      }. Capture it with \`discern standards --pin\` — ${
        receipted
          ? "on this commit it reuses this check's measurements (measure once, pin once)"
          : "this check already measured, no pin dry-run needed"
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
    family: "restart-session",
    example: undefined,
    template: (): string =>
      restartSessionHint(
        "Restart your coding agent to make the newly registered discern tools available.",
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
    example: undefined,
    template: (): string =>
      "Edit it there; `discern skills list` confirms the override.",
  }),

  /** The actionable retry carried by accept's read-only consent refusal. */
  "accept-awaiting-confirmation": defineHint({
    id: "accept-awaiting-confirmation",
    category: "next-step",
    audience: "all",
    family: "accept-consent",
    example: undefined,
    template: (): string =>
      "Re-run `discern accept --confirmed` once your owner has accepted this " +
      "landing — the flag attests that acceptance, so a pre-authorized landing " +
      "still takes one call.",
  }),

  /** The status route to the receipt and raw diff needed for owner review. */
  "accept-review-via-status": defineHint({
    id: "accept-review-via-status",
    category: "next-step",
    audience: "all",
    family: "accept-consent",
    example: undefined,
    template: (): string =>
      "`discern status` carries the honored receipt to relay " +
      "(data.gate_receipt.receipt) and the exact `git diff` command for the raw " +
      "change.",
  }),

  /** Landing succeeded, but its best-effort agent-file refresh did not. */
  "accept-refresh-failed": defineHint<{ trunk: string; mainRepo: string }>({
    id: "accept-refresh-failed",
    category: "next-step",
    audience: "all",
    family: "post-landing-convergence",
    example: { trunk: "main", mainRepo: "/workspace/project" },
    template: ({ trunk, mainRepo }): string =>
      `Acceptance landed on ${trunk}, but the post-landing refresh failed; ` +
      `run \`discern refresh\` in ${mainRepo}.`,
  }),

  /** Post-landing convergence changed tracked files in the receiving checkout. */
  "accept-convergence-changed-tracked": defineHint<{
    trunk: string;
    mainRepo: string;
  }>({
    id: "accept-convergence-changed-tracked",
    category: "next-step",
    audience: "all",
    family: "post-landing-convergence",
    example: { trunk: "main", mainRepo: "/workspace/project" },
    template: ({ trunk, mainRepo }): string =>
      `Acceptance landed on ${trunk}, but post-landing convergence changed ` +
      `tracked files in ${mainRepo}; review \`git status\` there.`,
  }),

  /** A successful acceptance exposes its receipt as the durable landing record. */
  "accept-relay-landing-receipt": defineHint({
    id: "accept-relay-landing-receipt",
    category: "next-step",
    audience: "all",
    example: undefined,
    template: (): string =>
      "The receipt (data.receipt) is the landing record — relay it to your owner; it pastes cleanly into a PR body.",
  }),

  /** Integration-summary fallback when its read-only git census cannot complete. */
  "update-summary-fallback": defineHint<{
    source: string;
    predicted: boolean;
  }>({
    id: "update-summary-fallback",
    category: "next-step",
    audience: "all",
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
    family: "start-name",
    example: { name: "✨" },
    template: ({ name }): string =>
      `Could not derive a branch-safe name from '${name}' — used a random codename instead.`,
  }),

  /** A supplied start name was normalized into its branch-safe slug. */
  "start-name-normalized": defineHint<{ name: string; slug: string }>({
    id: "start-name-normalized",
    category: "notice",
    audience: "all",
    family: "start-name",
    example: { name: "Hint Registry", slug: "hint-registry" },
    template: ({ name, slug }): string =>
      `Normalised the worktree name '${name}' → '${slug}'.`,
  }),

  /** The CLI cannot relocate the caller, so it gives the re-root instruction. */
  "start-re-root": defineHint<{ dir: string }>({
    id: "start-re-root",
    category: "next-step",
    audience: "all",
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
    family: "start-result",
    example: { changes: 2, startPoint: "main" },
    template: ({ changes, startPoint }): string =>
      `${changes} uncommitted change${
        changes === 1 ? "" : "s"
      } stay in the main checkout — the new worktree branches from '${startPoint}'.`,
  }),

  /** Setup's refresh core reports each artifact it could not complete. */
  "setup-refresh-artifact-failed": defineHint<{ message: string }>({
    id: "setup-refresh-artifact-failed",
    category: "notice",
    audience: "all",
    family: "setup-refresh",
    example: { message: "could not write .codex/config.toml" },
    template: ({ message }): string =>
      `setup could not complete a refresh artifact: ${message}`,
  }),

  /** Existing authored agent guidance was preserved in the canonical source. */
  "setup-guidance-preserved": defineHint<{
    paths: readonly string[];
    guidanceRel: string;
  }>({
    id: "setup-guidance-preserved",
    category: "next-step",
    audience: "all",
    family: "setup-guidance-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      guidanceRel: SOURCE_PATHS.guidance.defaultPath,
    },
    template: ({ paths, guidanceRel }): string =>
      `Preserved your existing ${
        paths.join(", ")
      } by migrating it into ${guidanceRel} — fold it into the conventions and delete the import note.`,
  }),

  /** A pre-existing agent file matched discern's own prior compiled output. */
  "setup-guidance-own-render-skipped": defineHint<{
    paths: readonly string[];
    guidanceRel: string;
  }>({
    id: "setup-guidance-own-render-skipped",
    category: "notice",
    audience: "all",
    family: "setup-guidance-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      guidanceRel: SOURCE_PATHS.guidance.defaultPath,
    },
    template: ({ paths, guidanceRel }): string =>
      `Skipped importing ${
        paths.join(", ")
      } into ${guidanceRel} — it matches discern's own compiled output (a leftover of an earlier setup), not your authoring.`,
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
    family: "setup-done-next",
    example: {
      branch: "discern-setup",
      target: "main",
      acceptCommand: "discern setup accept",
    },
    template: ({ branch, target, acceptCommand }): string =>
      `Your setup is on branch \`${branch}\`, not yet on \`${target}\` — land it with \`${acceptCommand}\` (or leave it for review).`,
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
    family: "setup-done-next",
    example: {
      branch: "feature/project-setup",
      target: "main",
      acceptCommand: "discern setup accept",
      setupBranch: "discern-setup",
    },
    template: ({ branch, target, acceptCommand, setupBranch }): string =>
      `Your setup is on branch \`${branch}\`, not yet on \`${target}\` — \`${acceptCommand}\` only lands the \`${setupBranch}\` branch, so merge this branch your usual way when ready.`,
  }),

  /** Provider integrations load at session start, so setup hands off reactivation. */
  "setup-reactivate-tools": defineHint({
    id: "setup-reactivate-tools",
    category: "next-step",
    audience: "all",
    family: "setup-done-next",
    example: undefined,
    template: (): string =>
      "discern's MCP tools (discern_*), session hooks, and project rules are now wired — but coding agents load them at session start, so this session can't see them yet. Reactivate to use them:",
  }),

  /** Setup's final coaching route for deepening the newly-wired project. */
  "setup-run-coach": defineHint<{ coachVerb: string; todoRel: string }>({
    id: "setup-run-coach",
    category: "next-step",
    audience: "all",
    family: "setup-done-next",
    example: {
      coachVerb: "improvement",
      todoRel: SOURCE_PATHS.todo.defaultPath,
    },
    template: ({ coachVerb, todoRel }): string =>
      `Deepen your setup: run \`discern ${coachVerb} --json\` (the project coach), review the findings with your human, do the quick wins now, and record larger ones in ${todoRel}.`,
  }),

  /**
   * Doctor-context lead-in to the shared unfinished-setup action. Healthy install
   * checks are not proof that the authored setup is complete.
   */
  "setup-unfinished-doctor": defineHint({
    id: "setup-unfinished-doctor",
    category: "guardrail",
    audience: "all",
    family: "setup-unfinished",
    example: undefined,
    template: (): string =>
      setupUnfinishedHint(
        "Finish setup before treating these healthy install checks as proof of completion.",
      ),
  }),

  /** Upgrade never checks the network, so it names the installed update channel. */
  "upgrade-newer-discern": defineHint<{ updateChannel: string }>({
    id: "upgrade-newer-discern",
    category: "notice",
    audience: "all",
    example: { updateChannel: "run the installer again" },
    template: ({ updateChannel }): string =>
      `discern never checks the network for updates; to get a newer discern, ${updateChannel}.`,
  }),

  /** Post-upgrade lead-in to the shared restart-session lifecycle fact. */
  "upgrade-restart-session": defineHint({
    id: "upgrade-restart-session",
    category: "next-step",
    audience: "all",
    family: "restart-session",
    example: undefined,
    template: (): string =>
      restartSessionHint(
        "Restart any open agent session to use this discern build.",
      ),
  }),

  /** An empty known-job command records a deliberate deferred gate slot. */
  "config-job-deferred": defineHint<{ name: string }>({
    id: "config-job-deferred",
    category: "next-step",
    audience: "all",
    example: { name: "integration" },
    template: ({ name }): string =>
      `An empty command records "${name}" as deferred — present but a no-op, so the gate skips it. Add an inline # comment beside it saying why, or set a real command to enforce it.`,
  }),

  /** The optional canonical suggestion in an unknown-command refusal. */
  "unknown-command-suggestion": defineHint<{ command: string }>({
    id: "unknown-command-suggestion",
    category: "next-step",
    audience: "all",
    family: "unknown-command",
    example: { command: "status" },
    template: ({ command }): string => `Did you mean \`discern ${command}\`?`,
  }),

  /** The standing documentation pointer closing every unknown-command refusal. */
  "unknown-command-help": defineHint({
    id: "unknown-command-help",
    category: "next-step",
    audience: "all",
    family: "unknown-command",
    example: undefined,
    template: (): string =>
      "Run `discern help` for the documentation, or `discern --help` to list the commands.",
  }),

  /**
   * The MCP-specific start re-root guardrail. It distinguishes the server's
   * automatic tool re-aim from the file move the client must perform, gives the
   * fallback for a fixed working root, and names the split-state consequence.
   */
  "start-mcp-re-root": defineHint<{ path: string }>({
    id: "start-mcp-re-root",
    category: "guardrail",
    audience: "all",
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
    family: "restart-session",
    example: { serverVersion: "1.4.0", installedVersion: "1.5.0" },
    template: ({ serverVersion, installedVersion }): string =>
      restartSessionHint(
        `Restart your agent session to replace MCP server v${serverVersion} with ` +
          `installed v${installedVersion}. Until then, its results can conflict ` +
          `with the current CLI and rewrite generated files from different builds.`,
      ),
  }),
} as const;

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
