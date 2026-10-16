/**
 * Status hints: orientation, the fleet, and the next step `discern status`
 * names for the current checkout. Entries are registered here and fired only
 * through `HINTS` in `../hints.ts`.
 */

import { managedVersionAdvice } from "../managed_version.ts";
import { DESK_ACTION_LABELS } from "../desk_vocabulary.ts";
import type { LandingConsentSource } from "../consent.ts";
import { markdownCodeSpan } from "../markdown_code.ts";
import {
  type ProvenBehindAuthority,
  provenBehindRouteText,
} from "../proven_behind_route.ts";
import { discernCommand, flag, positional } from "../command_reference.ts";
import { worktreeContinuityPolicy } from "../operating_policies.ts";
import type { GitCount } from "../git_count.ts";
import {
  boundedNameSummary,
  CMD,
  defineHint,
  OWNER_STATUS_VERBOSE,
  setupUnfinishedHint,
  STATUS_BRANCH_UPDATE_FOLLOW_THROUGH,
} from "./define.ts";

/** The status catalog, keyed by hint id. */
export const STATUS_HINTS = {
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
    behind: GitCount;
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
      } behind ${trunk} with its work still in progress, and the command is idempotent and checks its own git preconditions.${overlapNote} Prove the finished tree with ${CMD.done}. Once a revision is proven, trunk movement alone needs no further update: ${CMD.accept} composes and checks the moved trunk itself.`;
    },
  }),

  /** The proven counterpart of the behind hint: honored Proof at a clean
   * HEAD routes to acceptance, which composes the moved trunk itself. */
  "status-proven-behind": defineHint<{
    trunk: string;
    authority: ProvenBehindAuthority;
  }>({
    id: "status-proven-behind",
    category: "next-step",
    audience: "agent",
    when: "`status` finds a clean branch with honored Proof behind the trunk.",
    family: "status-review-readiness",
    example: { trunk: "main", authority: { kind: "review" } },
    template: ({ trunk, authority }): string =>
      provenBehindRouteText(trunk, authority, CMD.accept),
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

  "managed-version-adoption": defineHint({
    id: "managed-version-adoption",
    category: "next-step",
    audience: "all",
    when:
      "The running discern version differs from the version recorded in the project.",
    example: {
      advice: managedVersionAdvice(
        { state: "unknown", running: "1.2.7" },
        "references",
      ) ?? "",
    },
    template: ({ advice }: { advice: string }): string => advice,
  }),

  "release-check-sequence": defineHint({
    id: "release-check-sequence",
    category: "next-step",
    audience: "agent",
    when:
      "A release handoff is requested or clone-local release reminder evidence is due.",
    example: undefined,
    template: (): string =>
      `When asked to check for updates, run ${
        discernCommand("releases", flag("json"))
      } and fetch the returned JSON URL. Report whether an update is available and what's changed. Ask before checking if this reminder is the only prompt. If installation was requested, follow the release page's update steps without asking again; otherwise ask before installing. Don't recommend downgrading or treating a prerelease as a stable update.`,
  }),

  "status-fleet-logbook-disabled": defineHint({
    id: "status-fleet-logbook-disabled",
    category: "notice",
    audience: "all",
    when:
      "A fleet survey cannot show per-worktree actions because logbook recording is disabled.",
    example: undefined,
    template: (): string =>
      "Per-worktree actions aren't available because `[project].record_logbook` is off.",
  }),

  "status-no-active-worktrees": defineHint({
    id: "status-no-active-worktrees",
    category: "notice",
    audience: "all",
    when: "A fleet survey finds no active worktrees.",
    example: undefined,
    template: (): string => "There are no active worktrees.",
  }),

  /** The one main-checkout action that is safe for the reading agent. */
  "status-continue-own-effort": defineHint({
    id: "status-continue-own-effort",
    category: "next-step",
    audience: "agent",
    when:
      "Status runs in the main checkout and setup is complete with a usable trunk.",
    example: undefined,
    template: (): string =>
      "Continue in the worktree assigned to this effort. Only for a new " +
      "effort, follow the start procedure under Authority and boundaries.",
  }),

  /** The bounded projection advertises its explicit full-detail escape hatch. */
  "status-full-structured-detail": defineHint({
    id: "status-full-structured-detail",
    category: "notice",
    audience: "agent",
    when:
      "Status returns the default bounded structured orientation projection.",
    example: undefined,
    template: (): string =>
      `This result uses the bounded orientation projection. For full structured ` +
      `status, run ${CMD.statusFull}.`,
  }),

  "status-reappeared-worktree-paths": defineHint<{ total: number }>({
    id: "status-reappeared-worktree-paths",
    category: "owner-attention",
    audience: "all",
    when:
      "Status finds a path discern removed with a worktree that exists again.",
    example: { total: 2 },
    template: ({ total }): string =>
      `${total} removed worktree path${total === 1 ? " is" : "s are"} ` +
      `present again. The owner decides whether to remove ${
        total === 1 ? "it" : "them"
      } after confirming that no program still writes there.`,
    interactiveTemplate: ({ total }): string =>
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
    category: "owner-attention",
    audience: "all",
    when: "A fleet survey finds worktrees with uncommitted changes.",
    example: {
      total: 5,
      names: ["hint-registry", "docs-refresh", "gate-copy", "cli-help"],
    },
    template: ({ total, names }): string =>
      `${total} other effort${total === 1 ? " has" : "s have"} uncommitted ` +
      `changes: ${
        boundedNameSummary(total, names)
      }. The owner decides whether ` +
      `${total === 1 ? "it needs" : "they need"} intervention.`,
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
    category: "owner-attention",
    audience: "all",
    when: "A fleet survey finds worktrees ready for owner review.",
    example: {
      total: 5,
      names: ["hint-registry", "docs-refresh", "gate-copy", "cli-help"],
      trunk: "main",
    },
    template: ({ total, names, trunk }): string =>
      `${total} other effort${total === 1 ? " is" : "s are"} ready for owner ` +
      `review against ${markdownCodeSpan(trunk)}: ${
        boundedNameSummary(total, names)
      }. The owner ` +
      `${
        total === 1 ? "reviews its" : "reviews their"
      } assigned branch before ` +
      "deciding whether it lands.",
    interactiveTemplate: ({ total, names, trunk }): string =>
      `Review ${total} worktree${total === 1 ? "" : "s"} with committed work ` +
      `ready for owner review: ${
        boundedNameSummary(total, names)
      }. ${OWNER_STATUS_VERBOSE} shows the complete branch and Proof for each. ` +
      `Inspect a branch with \`git diff ${trunk}...<branch>\`.`,
  }),

  /** Ready fleet rows whose recorded authority has already been verified. */
  "status-fleet-authorized-landings": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-authorized-landings",
    category: "owner-attention",
    audience: "agent",
    when:
      "A fleet survey finds ready worktrees with machine-verified landing authority.",
    family: "landing-authority",
    example: {
      total: 2,
      names: ["docs-refresh", "release-notes"],
    },
    template: ({ total, names }): string =>
      `${total} other ready effort${
        total === 1 ? " has" : "s have"
      } machine-verified landing authority: ${
        boundedNameSummary(total, names)
      }. ${total === 1 ? "It stays" : "They stay"} with ${
        total === 1 ? "its" : "their"
      } assigned session; recorded authority does not transfer between efforts.`,
  }),

  /** Every validation slot is occupied while queued efforts wait — the one
   * capacity sentence status carries, naming the binding setting and who
   * holds the slots. */
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
      }. Both sides may merge cleanly and still conflict semantically. Each later landing composes and re-checks the combined code itself; a real conflict returns to that author with ${CMD.update} naming the shared paths to resolve. While authoring, re-read the shared paths after an update brings the other side in.`,
    interactiveTemplate: ({ total, pairs }): string =>
      `${total} worktree pair${
        total === 1 ? " is" : "s are"
      } changing the same files: ${
        boundedNameSummary(total, pairs)
      }. ${OWNER_STATUS_VERBOSE} lists the shared paths. Later landings compose and re-check the combined code; a real conflict returns to its author to resolve.`,
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

  /** One bounded summary for every fleet member whose Git state or own files
   * are unreadable. */
  "status-fleet-member-unreadable": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-unreadable",
    category: "owner-attention",
    audience: "all",
    when: "A fleet survey cannot read one or more worktree states.",
    example: {
      total: 5,
      names: ["damaged", "missing", "unreadable", "no-access"],
    },
    template: ({ total, names }): string => {
      return `${total} worktree${total === 1 ? "" : "s"} ${
        total === 1 ? "has" : "have"
      } unreadable state: ${boundedNameSummary(total, names)}. ${
        total === 1 ? "Its" : "Their"
      } uncommitted work or recorded env values are unverifiable. In the desk, select ${
        total === 1 ? "the task" : "each task"
      } and choose ${DESK_ACTION_LABELS.recovery}.`;
    },
    interactiveTemplate: ({ total, names }): string =>
      `Investigate ${total} worktree${total === 1 ? "" : "s"} whose state ` +
      `cannot be read: ${
        boundedNameSummary(total, names)
      }. In the desk, select ${
        total === 1 ? "the task" : "each task"
      } and choose ${DESK_ACTION_LABELS.recovery}.`,
  }),

  /** One bounded summary for every fleet member whose setup never completed. */
  "status-fleet-member-broken": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-broken",
    category: "owner-attention",
    audience: "all",
    when: "A fleet survey finds worktrees whose setup never completed.",
    example: {
      total: 5,
      names: ["incomplete", "crashed", "half-built", "no-config"],
    },
    template: ({ total, names }): string => {
      return `${total} worktree${total === 1 ? "" : "s"} ${
        total === 1 ? "has" : "have"
      } incomplete setup: ${
        boundedNameSummary(total, names)
      }. In the desk, select ${
        total === 1 ? "the task" : "each task"
      } and choose ${DESK_ACTION_LABELS.recovery} before cleanup.`;
    },
    interactiveTemplate: ({ total, names }): string =>
      `Diagnose ${total} worktree${total === 1 ? "" : "s"} whose setup did ` +
      `not complete: ${boundedNameSummary(total, names)}. In the desk, select ${
        total === 1 ? "the task" : "each task"
      } and choose ${DESK_ACTION_LABELS.recovery}.`,
  }),

  /** One bounded summary for every fleet member that looks abandoned. */
  "status-fleet-member-stale": defineHint<{
    total: number;
    names: readonly string[];
  }>({
    id: "status-fleet-member-stale",
    category: "owner-attention",
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
      return `${total} ${subject} stale: ${
        boundedNameSummary(total, names)
      }. The owner decides whether to resume or discard ${
        total === 1 ? "the effort" : "each effort"
      }; status has already accounted for last activity and unlanded work.`;
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
    category: "owner-attention",
    audience: "all",
    when: "A fleet survey finds unlanded branches with no worktree.",
    example: { branches: ["agent/old-task", "agent/paused-task"] },
    template: ({ branches }): string =>
      `${branches.length} branch${branches.length === 1 ? "" : "es"} ${
        branches.length === 1 ? "holds" : "hold"
      } unlanded work with no ` +
      `worktree: ${boundedNameSummary(branches.length, branches)}. The owner ` +
      `decides whether to resume or delete ${
        branches.length === 1 ? "it" : "them"
      }.`,
    interactiveTemplate: ({ branches }): string =>
      `${branches.length} branch${branches.length === 1 ? "" : "es"} ${
        branches.length === 1 ? "holds" : "hold"
      } unlanded work with no worktree: ${
        boundedNameSummary(branches.length, branches)
      }. Resume one with ${
        discernCommand("start", flag("from", "<branch>"))
      }, or delete an abandoned branch after review.`,
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
} as const;
