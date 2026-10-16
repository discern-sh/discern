/**
 * Worktree lifecycle hints: starting, updating, awaiting, and landing an effort.
 * Entries are registered here and fired only through `HINTS` in `../hints.ts`.
 */

import type { LandingConsentSource } from "../consent.ts";
import { type CommandRef, discernCommand, flag } from "../command_reference.ts";
import { productSentence } from "../product_sentence.ts";
import { worktreeContinuityPolicy } from "../operating_policies.ts";
import { PROOF_NOTES_REF } from "../git_conventions.ts";
import {
  CMD,
  defineHint,
  MAIN_WORKTREE_FOLLOW_THROUGH,
  OWNER_STATUS_VERBOSE,
  updateOverflowAdvice,
} from "./define.ts";

/** The lifecycle catalog, keyed by hint id. */
export const LIFECYCLE_HINTS = {
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
      `${
        productSentence(`Not yet: ${summary}`)
      } Continue this same watch once for up to ` +
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
  "accept-recover-partial-effects": defineHint({
    id: "accept-recover-partial-effects",
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

  /** A best-effort lifecycle convergence step failed without undoing the
   * merge, setup pass, or landing that preceded it. */
  "lifecycle-convergence-failed": defineHint({
    id: "lifecycle-convergence-failed",
    category: "next-step",
    audience: "all",
    when:
      "A non-fatal lifecycle convergence step fails after its preceding effect is kept.",
    family: "lifecycle-convergence",
    example: undefined,
    template: (): string =>
      "Fix each failed convergence step named in the diagnostics, then run " +
      "its reproduce command again in the checkout where that step ran.",
  }),

  "submit-start-walk": defineHint<{ branch: string }>({
    id: "submit-start-walk",
    category: "next-step",
    audience: "all",
    when: "A proven revision is recorded without starting a landing walk.",
    example: { branch: "agent/example" },
    template: ({ branch }): string =>
      `An active or later acceptance walk can pick up this revision. To start a walk, run discern accept --target ${branch}.`,
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
    category: "owner-attention",
    audience: "owner",
    when: "A landing Proof note is recorded with fetch transport enabled.",
    example: { remote: "origin" },
    template: ({ remote }): string =>
      `The owner can share this landing's Proof with other clones by running \`git push ${remote} ${PROOF_NOTES_REF}\`; discern records it locally and never publishes it.`,
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
        return "The owner pre-authorized this task's branch at the desk, so its next green `discern done` can land without a further conversation. Landing uses up the grant, and the owner can revoke it from the desk until then.";
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

  /** A deliberate start base is valid but does not yet contain the trunk. */
  "start-base-behind-trunk": defineHint<{
    behind: number;
    trunk: string;
  }>({
    id: "start-base-behind-trunk",
    category: "next-step",
    audience: "all",
    when: "`start --from` selects a commit that is behind the local trunk.",
    example: { behind: 2, trunk: "main" },
    template: ({ behind, trunk }): string =>
      `The selected base trails ${trunk} by ${behind} on the commit graph; the ` +
      `worktree uses the exact requested commit. Run ${CMD.update} there before ${CMD.done}.`,
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
} as const;
