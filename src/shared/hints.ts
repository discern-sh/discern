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
export interface HintDef<P = void> {
  /** Stable kebab-case identifier — the logbook, renderers, and tests key on it. */
  readonly id: string;
  readonly category: HintCategory;
  readonly audience: HintAudience;
  /**
   * Groups variants of one underlying fact (the restart-session family, the
   * generated-file-drift family) so wording reviews see them side by side.
   */
  readonly family?: string;
  /** Renders the hint from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
}

/** Identity helper so an entry's parameter type is inferred at the definition. */
export function defineHint<P = void>(def: HintDef<P>): HintDef<P> {
  return def;
}

/** A hint fired at a call site: the in-process pair; only `text` reaches the wire. */
export interface FiredHint {
  readonly id: string;
  readonly text: string;
}

/**
 * Fire a registry entry. A parameterless entry (`HintDef<void>`) is fired with
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

/**
 * The registry. Entries land site-by-site as the emission sites migrate off
 * inline strings; once the last site moves, the closed-set guard pins this
 * table as the only source `hints[]` accepts.
 */
export const HINTS = {
  /**
   * The canonical one-line advisory shown when setup is still outstanding: the
   * status lead hint and the session-start reminder share this wording so the
   * agent's responsibility never drifts between them. An empty pending set still
   * warrants the reminder because `discern setup done` has not recorded completion.
   */
  "setup-unfinished-status": defineHint<{ pendingCount: number }>({
    id: "setup-unfinished-status",
    category: "next-step",
    audience: "all",
    family: "setup-unfinished",
    template: ({ pendingCount }): string => {
      const tail = pendingCount > 0
        ? ` ${pendingCount} file(s) still carry skeleton markers.`
        : "";
      return (
        "Setup is NOT finished — completing it is your job as the agent in this " +
        "session, not a report to hand back. Work the brief `discern setup begin` prints " +
        "(re-run `discern setup begin` to reprint it — it won't touch your work), then run " +
        "`discern setup done`; don't tell the user setup is complete until it passes." +
        tail
      );
    },
  }),

  /** One-line warning when the configured integration branch cannot be checked. */
  "missing-integration-branch": defineHint<{ branch: string }>({
    id: "missing-integration-branch",
    category: "next-step",
    audience: "all",
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
    template: ({ paths }): string =>
      `The agent files are untracked (${
        paths.join(", ")
      }); commit them so cloud and out-of-tool agents read the same guidance from a fresh clone.`,
  }),

  "generated-agent-files-missing": defineHint<{ paths: string }>({
    id: "generated-agent-files-missing",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    template: ({ paths }): string =>
      `Agent files aren't built yet (${paths}); run \`discern refresh\`.`,
  }),

  "generated-agent-files-stale": defineHint<{ paths: string }>({
    id: "generated-agent-files-stale",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    template: ({ paths }): string =>
      `Agent files are out of date (${paths}); run \`discern refresh\` — edits belong in your [guidance].sources, not the generated file.`,
  }),

  "materialized-skills-missing": defineHint<{ dirs: string }>({
    id: "materialized-skills-missing",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    template: ({ dirs }): string =>
      `Skills aren't materialized yet (${dirs}); run \`discern refresh\`.`,
  }),

  "materialized-skills-stale": defineHint<{ dirs: string }>({
    id: "materialized-skills-stale",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    template: ({ dirs }): string =>
      `Materialized skills are out of date (${dirs}); run \`discern refresh\` — edits belong in your [skills].dir source, not the materialized copy.`,
  }),

  "provider-integrations-missing": defineHint<{ paths: string }>({
    id: "provider-integrations-missing",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    template: ({ paths }): string =>
      `Provider integration files are missing (${paths}); run \`discern refresh\`.`,
  }),

  "provider-integrations-stale": defineHint<{ paths: string }>({
    id: "provider-integrations-stale",
    category: "next-step",
    audience: "all",
    family: "generated-drift",
    template: ({ paths }): string =>
      `Provider integration files need attention (${paths}); run \`discern refresh\`, and if it reports a malformed settings file, repair that file and re-run refresh.`,
  }),

  /**
   * The on-the-trunk guardrail, agent-facing. An agent in the main checkout on
   * the trunk has no isolated workspace yet, so this points it at `discern start`.
   * Interactive status omits it because a person there is monitoring the fleet.
   */
  "status-start-on-trunk": defineHint({
    id: "status-start-on-trunk",
    category: "guardrail",
    audience: "agent",
    family: "status-start-here",
    template: (): string =>
      "You're on the trunk (the main checkout), not an isolated worktree — don't start work here. Run `discern start` to create your own worktree and move into it, naming it after the task you're starting so the worktree is identifiable rather than an opaque codename; never adopt an existing idle worktree (each belongs to another line of work, and a clean tree doesn't mean it's free).",
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
    template: ({ trunk }): string =>
      `Committed and up to date with ${trunk}, but the main checkout has uncommitted tracked changes — commit or stash them there before a user-requested landing can proceed.`,
  }),

  "status-ready-for-review": defineHint<{ trunk: string; branch: string }>({
    id: "status-ready-for-review",
    category: "next-step",
    audience: "all",
    family: "status-review-readiness",
    template: ({ trunk, branch }): string =>
      `Committed, up to date with ${trunk}, and this clean HEAD has an honored receipt from \`discern done\` — ready for owner review: relay the receipt (data.gate_receipt.receipt) to your owner and wait; they can inspect the raw diff with \`git diff ${trunk}...${branch}\`. Run \`discern accept\` only after the user explicitly asks you to land it.`,
  }),

  "status-missing-done-receipt": defineHint<{ trunk: string }>({
    id: "status-missing-done-receipt",
    category: "next-step",
    audience: "all",
    family: "status-review-readiness",
    template: ({ trunk }): string =>
      `Committed and up to date with ${trunk}, but this clean HEAD has no honored receipt from \`discern done\`; run \`discern done\` before reporting the branch ready for review or a user-requested landing.`,
  }),

  /**
   * The fleet ownership rule, agent-facing. It fires whenever a survey includes a
   * separate line of work. Interactive status uses the fleet caption instead.
   */
  "fleet-ownership": defineHint({
    id: "fleet-ownership",
    category: "guardrail",
    audience: "agent",
    template: (): string =>
      "Worktrees in the fleet belong to separate lines of work — never start work in one you didn't create; a clean working tree doesn't mean it's free.",
  }),

  "status-no-active-worktrees": defineHint({
    id: "status-no-active-worktrees",
    category: "next-step",
    audience: "all",
    template: (): string => "No active worktrees; start one to begin work.",
  }),

  "status-dirty-fleet-members": defineHint<{ names: readonly string[] }>({
    id: "status-dirty-fleet-members",
    category: "notice",
    audience: "all",
    template: ({ names }): string =>
      `${names.length} worktree${names.length === 1 ? "" : "s"} ${
        names.length === 1 ? "has" : "have"
      } uncommitted changes: ${names.join(", ")}.`,
  }),

  "status-fleet-member-ready": defineHint<{
    name: string;
    trunk: string;
    branch: string;
  }>({
    id: "status-fleet-member-ready",
    category: "next-step",
    audience: "all",
    template: ({ name, trunk, branch }): string =>
      `Worktree ${name} has committed work ready for owner review — inspect it with \`git diff ${trunk}...${branch}\`.`,
  }),

  "status-fleet-member-unreadable": defineHint<{ name: string }>({
    id: "status-fleet-member-unreadable",
    category: "next-step",
    audience: "all",
    template: ({ name }): string =>
      `Worktree ${name}'s git state could not be read — its checkout ` +
      `is missing or damaged, so any unsaved work there is ` +
      `unverifiable. Investigate it, or discard it with ` +
      `\`discern worktree drop ${name}\` (refused without --force ` +
      `while the state can't be read).`,
  }),

  "status-fleet-member-broken": defineHint<{ name: string }>({
    id: "status-fleet-member-broken",
    category: "next-step",
    audience: "all",
    template: ({ name }): string =>
      `Worktree ${name} never finished its setup — ` +
      `its checkout may be incomplete. Discard it with ` +
      `\`discern worktree drop ${name}\`.`,
  }),

  "status-fleet-member-stale": defineHint<{
    name: string;
    idleDays: number;
    clean: boolean;
    ahead: number | undefined;
    changedFiles: number | undefined;
  }>({
    id: "status-fleet-member-stale",
    category: "next-step",
    audience: "all",
    template: ({ name, idleDays, clean, ahead, changedFiles }): string => {
      const work = clean
        ? `${ahead} unlanded commit${ahead === 1 ? "" : "s"}`
        : `${changedFiles} uncommitted change${changedFiles === 1 ? "" : "s"}`;
      return `Worktree ${name} looks stale: idle ${idleDays}d, ${work} — resume a session ` +
        `there, or discard it with \`discern worktree drop ${name}\`.`;
    },
  }),

  "status-unlanded-branches": defineHint<{ branches: readonly string[] }>({
    id: "status-unlanded-branches",
    category: "next-step",
    audience: "all",
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
    template: ({ a, b, ofA, ofB }): string =>
      `\`${a}\` and \`${b}\` have not changed together in recent history ` +
      `(from git history; \`${a}\`: ${ofA} commit(s), \`${b}\`: ${ofB} commit(s)).`,
  }),

  /** Pair evidence summary before the individual shared-commit rows. */
  "coupling-evidence-summary": defineHint<{
    a: string;
    b: string;
    together: number;
    ofA: number;
    ofB: number;
  }>({
    id: "coupling-evidence-summary",
    category: "notice",
    audience: "all",
    family: "coupling-evidence",
    template: ({ a, b, together, ofA, ofB }): string => {
      const shareA = ofA > 0 ? ` (${Math.round((together / ofA) * 100)}%)` : "";
      const shareB = ofB > 0 ? ` (${Math.round((together / ofB) * 100)}%)` : "";
      return `\`${a}\` and \`${b}\` changed together in ${together} commit(s) — ${together} of ` +
        `\`${a}\`'s ${ofA}${shareA} and ${together} of \`${b}\`'s ${ofB}` +
        `${shareB} recent commits (from git history):`;
    },
  }),

  "coupling-evidence-commit": defineHint<{
    sha: string;
    date: string;
    subject: string;
  }>({
    id: "coupling-evidence-commit",
    category: "notice",
    audience: "all",
    family: "coupling-evidence",
    template: ({ sha, date, subject }): string =>
      `  ${sha}  ${date}  ${subject}`,
  }),

  "coupling-evidence-more": defineHint<{ more: number }>({
    id: "coupling-evidence-more",
    category: "notice",
    audience: "all",
    family: "coupling-evidence",
    template: ({ more }): string => `… and ${more} more shared commit(s).`,
  }),

  "coupling-diff-header": defineHint({
    id: "coupling-diff-header",
    category: "notice",
    audience: "all",
    family: "coupling-partners",
    template: (): string =>
      "Coupling (from git history; advisory only and not exhaustive) — files that usually " +
      "change with what you've changed on this branch " +
      "(vs the trunk, the shared landing branch) but aren't among those changes:",
  }),

  "coupling-diff-partner": defineHint<{
    from: string;
    path: string;
    cochanges: number;
    of: number;
    confidence: number;
  }>({
    id: "coupling-diff-partner",
    category: "notice",
    audience: "all",
    family: "coupling-partners",
    template: ({ from, path, cochanges, of, confidence }): string =>
      `You changed \`${from}\` but not \`${path}\` — which changed in ${cochanges} ` +
      `of the ${of} recent commits that touched \`${from}\` (${
        Math.round(confidence * 100)
      }%). ` +
      `Worth a look, or intentional?`,
  }),

  "coupling-query-header": defineHint<{ target: string }>({
    id: "coupling-query-header",
    category: "notice",
    audience: "all",
    family: "coupling-partners",
    template: ({ target }): string =>
      `Files that usually change with \`${target}\` (from git history; advisory, NOT ` +
      "exhaustive):",
  }),

  "coupling-query-partner": defineHint<{
    path: string;
    target: string;
    cochanges: number;
    of: number;
    confidence: number;
  }>({
    id: "coupling-query-partner",
    category: "notice",
    audience: "all",
    family: "coupling-partners",
    template: ({ path, target, cochanges, of, confidence }): string =>
      `\`${path}\` — changed together in ${cochanges} of \`${target}\`'s ${of} ` +
      `recent commits (${Math.round(confidence * 100)}%).`,
  }),

  "coupling-more-partners": defineHint<{
    remaining: number;
    queryTarget: string | undefined;
  }>({
    id: "coupling-more-partners",
    category: "next-step",
    audience: "all",
    family: "coupling-partners",
    template: ({ remaining, queryTarget }): string => {
      const arg = queryTarget === undefined ? "" : ` ${queryTarget}`;
      return `… and ${remaining} more — \`discern coupling${arg}\` lists them all.`;
    },
  }),

  "coupling-strong-pair": defineHint<{ from: string; path: string }>({
    id: "coupling-strong-pair",
    category: "next-step",
    audience: "all",
    family: "coupling-partners",
    template: ({ from, path }): string =>
      `\`${from}\` and \`${path}\` change together almost every time. ` +
      "If that reflects an essential invariant, consider locking it with a forcing-function " +
      "(see the `discern-cure-a-bug` skill) rather than relying on memory.",
  }),

  "patterns-logbook-empty": defineHint({
    id: "patterns-logbook-empty",
    category: "notice",
    audience: "all",
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
    template: ({ young, total }): string =>
      `The logbook is too young for ${young} of ${total} ` +
      `detectors — each reports insufficient evidence rather than guessing.`,
  }),

  "patterns-advisory-findings": defineHint({
    id: "patterns-advisory-findings",
    category: "next-step",
    audience: "all",
    template: (): string =>
      "Advisory findings: each next step says what to inspect or enforce.",
  }),

  "patterns-recording-off": defineHint({
    id: "patterns-recording-off",
    category: "notice",
    audience: "all",
    template: (): string =>
      "Recording is off ([project].logbook = false), so new runs aren't " +
      "recorded; this report reads the history that already exists.",
  }),

  "patterns-reset-empty": defineHint({
    id: "patterns-reset-empty",
    category: "notice",
    audience: "all",
    family: "patterns-reset",
    template: (): string => "No logbook to remove — nothing has been recorded.",
  }),

  "patterns-reset-preview": defineHint({
    id: "patterns-reset-preview",
    category: "next-step",
    audience: "all",
    family: "patterns-reset",
    template: (): string =>
      "A preview — nothing was removed. Run without --dry-run to delete.",
  }),

  "patterns-reset-recording-resumes": defineHint({
    id: "patterns-reset-recording-resumes",
    category: "notice",
    audience: "all",
    family: "patterns-reset",
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
    template: ({ observed, next }): string =>
      `Logbook: ${observed} Next: ${next}`,
  }),

  /**
   * The advisory a done, prepare, test, or standards result carries while setup
   * is outstanding. Those verbs run during setup, but their output must not read
   * as proof that the project itself is finished.
   */
  "setup-unfinished-gate": defineHint({
    id: "setup-unfinished-gate",
    category: "guardrail",
    audience: "all",
    family: "setup-unfinished",
    template: (): string =>
      "Setup is not finished — this gate output is indicative while you complete setup. " +
      "Run `discern setup done` to validate the gate and record completion.",
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
    template: (): string =>
      'No test job is configured (set test = "<command>" under [jobs] in discern.toml).',
  }),

  "gate-trunk-advanced": defineHint({
    id: "gate-trunk-advanced",
    category: "next-step",
    audience: "all",
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
    template: ({ reason }): string =>
      `The gate failed, and discern could not clear the previous gate receipt${
        reasonSuffix(reason)
      }; re-run \`discern done\` after fixing the failure.`,
  }),

  "gate-failure-gotchas": defineHint<{ doc: string }>({
    id: "gate-failure-gotchas",
    category: "next-step",
    audience: "all",
    template: ({ doc }): string =>
      `If the failure above isn't self-explanatory, this project's known gate failures and their fixes are documented in ${doc}.`,
  }),

  "gate-relay-receipt": defineHint({
    id: "gate-relay-receipt",
    category: "next-step",
    audience: "all",
    template: (): string =>
      "If this completes the task, relay the receipt to your owner and stop; run `discern accept` only once they accept.",
  }),

  "gate-update-docs": defineHint({
    id: "gate-update-docs",
    category: "next-step",
    audience: "all",
    template: (): string =>
      "If you changed documented behaviour, update the docs to match before you finish.",
  }),

  "gate-deferred-standards": defineHint<{ names: readonly string[] }>({
    id: "gate-deferred-standards",
    category: "next-step",
    audience: "all",
    template: ({ names }): string =>
      `${names.length} standard(s) deferred from the gate (measure = "on-demand"): ${
        names.join(", ")
      } — the never-loosen limit check still ran; measure them with \`discern standards\` as needed.`,
  }),

  "gate-previewable-change": defineHint({
    id: "gate-previewable-change",
    category: "next-step",
    audience: "all",
    template: (): string =>
      "A previewable change landed — start this worktree's dev server to view it.",
  }),

  /** The pin pass has no configured metric to measure or tighten. */
  "standards-pin-empty": defineHint({
    id: "standards-pin-empty",
    category: "notice",
    audience: "all",
    family: "standards-pin",
    template: (): string =>
      "No standards configured, so there is nothing to pin.",
  }),

  /** Pin previews honor the universal dry-run contract and measure nothing. */
  "standards-pin-dry-run": defineHint({
    id: "standards-pin-dry-run",
    category: "next-step",
    audience: "all",
    family: "standards-pin",
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
    template: (): string =>
      "Nothing to pin — every standard asked for already sits at its measured value (within its margin).",
  }),

  /** The limits-only pin commit inherited the honored receipt for its parent. */
  "standards-pin-carried-receipt": defineHint({
    id: "standards-pin-carried-receipt",
    category: "notice",
    audience: "all",
    family: "standards-pin-receipt",
    template: (): string =>
      "Carried the gate receipt forward — `discern accept` will skip the redundant gate re-run.",
  }),

  /** The pin commit had no honored receipt available to carry forward. */
  "standards-pin-no-receipt": defineHint({
    id: "standards-pin-no-receipt",
    category: "next-step",
    audience: "all",
    family: "standards-pin-receipt",
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
   * Advice surfaced to users and agents when refresh registers discern's MCP
   * server for the first time. A freshly-added server is typically not detected
   * until the coding agent restarts; the registration persists afterwards.
   */
  "refresh-mcp-first-install": defineHint({
    id: "refresh-mcp-first-install",
    category: "next-step",
    audience: "all",
    family: "restart-session",
    template: (): string =>
      "A discern MCP server was registered for the first time — restart your coding agent (or reload its MCP servers) for the discern tools to become available.",
  }),

  /** The actionable retry carried by accept's read-only consent refusal. */
  "accept-awaiting-confirmation": defineHint({
    id: "accept-awaiting-confirmation",
    category: "next-step",
    audience: "all",
    family: "accept-consent",
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
    template: ({ trunk, mainRepo }): string =>
      `Acceptance landed on ${trunk}, but post-landing convergence changed ` +
      `tracked files in ${mainRepo}; review \`git status\` there.`,
  }),

  /** A successful acceptance exposes its receipt as the durable landing record. */
  "accept-relay-landing-receipt": defineHint({
    id: "accept-relay-landing-receipt",
    category: "next-step",
    audience: "all",
    template: (): string =>
      "The receipt (data.receipt) is the landing record — relay it to your owner; it pastes cleanly into a PR body.",
  }),

  /** Integration-summary fallback when its read-only git census cannot complete. */
  "update-summary-fallback": defineHint<{ source: string }>({
    id: "update-summary-fallback",
    category: "next-step",
    audience: "all",
    family: "update-summary",
    template: ({ source }): string =>
      `Updated ${source} and re-materialized the agent files — run ` +
      `\`discern done\` to verify against the merged tree.`,
  }),

  /** Integration headline when incoming changes overlap the branch's own files. */
  "update-overlap": defineHint<{
    source: string;
    behind: number;
    overlap: readonly string[];
    overlapTotal: number;
    predicted: boolean;
  }>({
    id: "update-overlap",
    category: "next-step",
    audience: "all",
    family: "update-summary",
    template: (
      { source, behind, overlap, overlapTotal, predicted },
    ): string => {
      const verb = predicted ? "Would update" : "Updated";
      const next = predicted
        ? "run `discern update` to apply, then `discern done`."
        : "run `discern done` to verify against the merged tree.";
      const shown = overlap.slice(0, 5).join(", ");
      const more = overlapTotal > 5 ? `, … (+${overlapTotal - 5} more)` : "";
      const caveat = predicted
        ? "git would merge these cleanly, but they may still conflict semantically — " +
          "re-read them after updating, then "
        : "git merged these cleanly, but re-read them for semantic conflicts a clean " +
          "merge can't catch, then ";
      return `⚠ ${verb} ${source}: +${behind} commit(s) beneath your work. ` +
        `${overlapTotal} file(s) you've changed are also changed by ` +
        `${source}: ${shown}${more} — ${caveat}${next}`;
    },
  }),

  /** Integration headline when incoming and branch-owned files do not overlap. */
  "update-no-overlap": defineHint<{
    source: string;
    behind: number;
    filesTotal: number;
    ownTotal: number;
    predicted: boolean;
  }>({
    id: "update-no-overlap",
    category: "next-step",
    audience: "all",
    family: "update-summary",
    template: ({ source, behind, filesTotal, ownTotal, predicted }): string => {
      const verb = predicted ? "Would update" : "Updated";
      const next = predicted
        ? "run `discern update` to apply, then `discern done`."
        : "run `discern done` to verify against the merged tree.";
      return `${verb} ${source}: +${behind} commit(s), ${filesTotal} ` +
        `file(s) changed beneath your work. None overlap the ${ownTotal} file(s) ` +
        `you've changed — ${next}`;
    },
  }),

  /** Escape hatch to the full incoming file list when the envelope caps it. */
  "update-files-truncated": defineHint<{
    shown: number;
    total: number;
    diffRange: string;
  }>({
    id: "update-files-truncated",
    category: "next-step",
    audience: "all",
    family: "update-summary",
    template: ({ shown, total, diffRange }): string =>
      `Showing ${shown} of ${total} changed files. Full ` +
      `list: \`git diff --stat ${diffRange}\`. Inspect one: ` +
      `\`git diff ${diffRange} -- <path>\`.`,
  }),

  /** Escape hatch to the full incoming commit list when the envelope caps it. */
  "update-commits-truncated": defineHint<{
    shown: number;
    total: number;
    before: string;
    main: string;
  }>({
    id: "update-commits-truncated",
    category: "next-step",
    audience: "all",
    family: "update-summary",
    template: ({ shown, total, before, main }): string =>
      `Showing ${shown} of ${total} commits. Full ` +
      `log: \`git log --oneline ${before}..${main}\`.`,
  }),

  /** A supplied start name reduced to no branch-safe characters. */
  "start-name-fallback": defineHint<{ name: string }>({
    id: "start-name-fallback",
    category: "notice",
    audience: "all",
    family: "start-name",
    template: ({ name }): string =>
      `Could not derive a branch-safe name from '${name}' — used a random codename instead.`,
  }),

  /** A supplied start name was normalized into its branch-safe slug. */
  "start-name-normalized": defineHint<{ name: string; slug: string }>({
    id: "start-name-normalized",
    category: "notice",
    audience: "all",
    family: "start-name",
    template: ({ name, slug }): string =>
      `Normalised the worktree name '${name}' → '${slug}'.`,
  }),

  /** Start cannot relocate the caller, so it names the newly-created root. */
  "start-re-root": defineHint<{ id: string; dir: string; branch: string }>({
    id: "start-re-root",
    category: "next-step",
    audience: "all",
    family: "start-result",
    template: ({ id, dir, branch }): string =>
      `Created worktree '${id}' at ${dir} (branch ${branch}). Nothing was relocated ` +
      `for you — start a session rooted at ${dir} (or cd there) to continue, and do ` +
      `not keep working in the main checkout.`,
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
    template: ({ branch, target, acceptCommand, setupBranch }): string =>
      `Your setup is on branch \`${branch}\`, not yet on \`${target}\` — \`${acceptCommand}\` only lands the \`${setupBranch}\` branch, so merge this branch your usual way when ready.`,
  }),

  /** Provider integrations load at session start, so setup hands off reactivation. */
  "setup-reactivate-tools": defineHint({
    id: "setup-reactivate-tools",
    category: "next-step",
    audience: "all",
    family: "setup-done-next",
    template: (): string =>
      "discern's MCP tools (discern_*), session hooks, and project rules are now wired — but coding agents load them at session start, so this session can't see them yet. Reactivate to use them:",
  }),

  /** Setup's final coaching route for deepening the newly-wired project. */
  "setup-run-coach": defineHint<{ coachVerb: string; todoRel: string }>({
    id: "setup-run-coach",
    category: "next-step",
    audience: "all",
    family: "setup-done-next",
    template: ({ coachVerb, todoRel }): string =>
      `Deepen your setup: run \`discern ${coachVerb} --json\` (the project coach), review the findings with your human, do the quick wins now, and record larger ones in ${todoRel}.`,
  }),

  /** The setup-only landing command completed against its target branch. */
  "setup-accept-landed": defineHint<{ target: string }>({
    id: "setup-accept-landed",
    category: "notice",
    audience: "all",
    template: ({ target }): string => `Setup landed onto ${target}.`,
  }),

  /**
   * Mid-setup doctor qualifier: a healthy install is not proof that the authored
   * setup is finished. This is the third setup-unfinished surface alongside status
   * and the gate.
   */
  "setup-unfinished-doctor": defineHint({
    id: "setup-unfinished-doctor",
    category: "guardrail",
    audience: "all",
    family: "setup-unfinished",
    template: (): string =>
      "Setup is NOT finished — these checks prove the install is healthy, not that setup is complete. " +
      "Continue the setup brief (`discern setup begin` reprints it), then run `discern setup done` to finish.",
  }),

  /** Upgrade never checks the network, so it names the installed update channel. */
  "upgrade-newer-discern": defineHint<{ updateChannel: string }>({
    id: "upgrade-newer-discern",
    category: "notice",
    audience: "all",
    template: ({ updateChannel }): string =>
      `discern never checks the network for updates; to get a newer discern, ${updateChannel}.`,
  }),

  /** An open agent session retains the pre-upgrade MCP process until restarted. */
  "upgrade-restart-session": defineHint({
    id: "upgrade-restart-session",
    category: "next-step",
    audience: "all",
    family: "restart-session",
    template: (): string =>
      "If an agent session is open, restart it so its discern MCP server reloads this build — a server started before the upgrade keeps running the old engine and templates until then.",
  }),

  /** An empty known-job command records a deliberate deferred gate slot. */
  "config-job-deferred": defineHint<{ name: string }>({
    id: "config-job-deferred",
    category: "next-step",
    audience: "all",
    template: ({ name }): string =>
      `An empty command records "${name}" as deferred — present but a no-op, so the gate skips it. Add an inline # comment beside it saying why, or set a real command to enforce it.`,
  }),
} as const;

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
