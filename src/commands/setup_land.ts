/**
 * `discern setup land` — land the finished setup onto the integration branch.
 *
 * A fresh `discern setup` isolates its several commits on a dedicated `discern-setup`
 * branch (ADR 0065), so after `setup done` the harness exists on that branch but NOT
 * on `main`. A novice who restarts and switches to `main` can appear to "lose" discern
 * entirely. This command closes that gap deterministically: it fast-forwards (or
 * merges) the `discern-setup` branch onto the integration branch and deletes the
 * merged branch, leaving the user on `main` with the harness in place. It lands
 * ONLY that dedicated branch: run from any other branch it refuses, because the
 * merge takes whatever the current branch contains and an ordinary branch's own
 * commits would be swept onto the trunk with no review.
 *
 * It is the main-checkout counterpart to `discern graduate` (which lands a linked
 * WORKTREE's branch): same land-onto-trunk shape — clean-tree precondition, fast-
 * forward when the trunk is an ancestor, a real merge otherwise, refuse on conflict —
 * minus the worktree teardown, since setup runs on the main checkout, not a worktree.
 * Choosing instead to leave the branch for review, or to discard it, is simply not
 * running this command; `setup done` spells out all three options.
 */

import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { findRoot } from "../shared/env.ts";
import { emitResult } from "../shared/emit.ts";
import { runGit } from "../shared/subprocess.ts";
import { SETUP_BRANCH } from "../shared/setup_state.ts";
import { worktreeState } from "../lib/git.ts";
import { integrationBranch } from "../engine/worktree/git.ts";

/** Options for `discern setup land` (global flags + preview). */
export interface SetupLandOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
}

/** The exact command a user runs to land their setup — the one string `setup done`
 * and any guidance quote, so the verb name lives in one place. */
export const LAND_COMMAND = "discern setup land";

/** A light, read-only account of where finished setup work lives and how to land it —
 * what `setup done` reports without running the merge. */
export interface LandingSummary {
  /** True when the project is inside a git work tree (a branch exists to land). */
  inRepo: boolean;
  /** The current branch, or "" when detached / not in a repo. */
  branch: string;
  /** The integration branch the work lands onto. */
  target: string;
  /** True when the work already lives on the integration branch (nothing to land). */
  onTarget: boolean;
  /**
   * True when the current branch is the dedicated `discern-setup` branch — the ONLY
   * branch `setup land` lands. Computed here, once, so every surface that recommends
   * landing (`setup done`'s hints, its "What's next" step, the relay message) keys
   * off the same predicate the land command itself enforces: an in-place
   * (`--allow-dirty`) setup on the user's own branch is steered to a manual merge,
   * never to a command that would sweep that branch's own commits onto the trunk.
   */
  onSetupBranch: boolean;
}

/** Resolve where the just-finished setup lives relative to the integration branch —
 * read-only, for `setup done`'s "where your work is + how to land it" report. */
export async function landingSummary(
  root: string,
  config: DiscernConfig,
): Promise<LandingSummary> {
  const target = integrationBranch(config.project.main_branch);
  const inRepo =
    (await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: root }))
      .success;
  if (!inRepo) {
    return {
      inRepo: false,
      branch: "",
      target,
      onTarget: false,
      onSetupBranch: false,
    };
  }
  const branch = (await runGit(["branch", "--show-current"], { cwd: root }))
    .stdout.trim();
  return {
    inRepo: true,
    branch,
    target,
    onTarget: branch === target,
    onSetupBranch: branch === SETUP_BRANCH,
  };
}

/** What the executed (or previewed) landing did/would do, for the `--json` envelope. */
interface LandData {
  landed: boolean;
  branch: string;
  target: string;
  fast_forward: boolean;
  branch_deleted: boolean;
}

/** Emit a landing refusal/no-op (human + `--json`) and return its exit code. */
function emitLand(
  opts: SetupLandOptions,
  result: {
    ok: boolean;
    error?: string;
    message: string;
    detail?: string[];
    code: number;
  },
): number {
  if (opts.json) {
    emitResult({
      ok: result.ok,
      verb: "setup land",
      ...(result.error !== undefined ? { error: result.error } : {}),
      message: result.message,
    });
  } else {
    const stream = result.ok ? console.log : console.error;
    stream(`discern: ${result.message}`);
    for (const d of result.detail ?? []) {
      stream(`         ${d}`);
    }
  }
  return result.code;
}

/**
 * `discern setup land` — fast-forward (or merge) the `discern-setup` branch onto the
 * integration branch, then delete the merged branch. Refuses on a dirty tree, a
 * merge conflict (the branch keeps all its commits), or any current branch that is
 * not the setup branch; a no-op when already on the integration branch or outside a
 * git repo. `--dry-run` previews and touches nothing.
 */
export async function runSetupLand(opts: SetupLandOptions): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    return emitLand(opts, {
      ok: false,
      error: "no_project",
      message:
        "not inside a discern project (no discern.toml in this directory or any parent).",
      code: 1,
    });
  }
  const config = await loadConfig(root);
  const target = integrationBranch(config.project.main_branch);
  const run = (args: string[]) => runGit(args, { cwd: root });

  // Outside a git repo there is no branch to land — setup is already in place as-is.
  const state = await worktreeState(root);
  if (state.kind === "not-a-repo") {
    return emitLand(opts, {
      ok: true,
      message:
        "no git repository here, so there is nothing to land — your setup is already in place.",
      code: 0,
    });
  }

  const branch = (await run(["branch", "--show-current"])).stdout.trim();
  if (branch === "") {
    return emitLand(opts, {
      ok: false,
      error: "detached_head",
      message:
        `not on a branch (detached HEAD), so there is nothing to land onto ${target}. Check out your setup branch first.`,
      code: 1,
    });
  }
  if (branch === target) {
    return emitLand(opts, {
      ok: true,
      message:
        `already on ${target} — your setup work is landed; nothing to do.`,
      code: 0,
    });
  }
  // Land ONLY the dedicated setup branch. This command fast-forwards (or merges)
  // the CURRENT branch onto the integration branch — run from an ordinary branch
  // it would sweep that branch's own commits onto the trunk with no review.
  if (branch !== SETUP_BRANCH) {
    return emitLand(opts, {
      ok: false,
      error: "not_setup_branch",
      message:
        `you are on \`${branch}\`, not the \`${SETUP_BRANCH}\` branch this command lands — ` +
        `landing here would sweep \`${branch}\`'s own commits onto \`${target}\`. ` +
        `If your finished setup lives on \`${SETUP_BRANCH}\`, check it out and re-run \`${LAND_COMMAND}\`. ` +
        `If you set up on \`${branch}\` deliberately (--allow-dirty), merge it your usual way ` +
        `(\`git checkout ${target} && git merge ${branch}\`) when you're ready.`,
      code: 1,
    });
  }
  if (!(await run(["rev-parse", "--verify", "--quiet", target])).success) {
    // The common shape of this: a brand-new repository whose first commits were
    // born on the setup branch, so the integration branch never came into being.
    // Serve the exact creation-then-land step in the message itself, so it rides
    // both surfaces identically, rather than dead-ending.
    return emitLand(opts, {
      ok: false,
      error: "no_target",
      message:
        `the integration branch \`${target}\` doesn't exist in this repository yet — in a ` +
        `brand-new repository the first commits are born on \`${branch}\`, so there is no ` +
        `\`${target}\` to land onto. Create it at your setup's tip, then land: ` +
        `\`git branch ${target} && ${LAND_COMMAND}\`. ` +
        `(If this project integrates on a different branch, set [project].main_branch to it instead.)`,
      code: 1,
    });
  }

  // Refuse to land a tree with uncommitted TRACKED changes — never sweep unrelated
  // work into the merge. Untracked scratch files are harmless and ignored (the same
  // notion of "dirty" `discern setup` uses to gate its own branch creation).
  if (state.kind === "dirty") {
    return emitLand(opts, {
      ok: false,
      error: "dirty_worktree",
      message:
        `your working tree has uncommitted changes. Commit or stash them, then re-run \`${LAND_COMMAND}\`.`,
      detail: state.changes.slice(0, 10),
      code: 1,
    });
  }

  // Fast-forward is possible exactly when the integration branch is already an
  // ancestor of the setup branch (the common case — setup branched off it and only
  // added commits). Otherwise the integration branch has moved on and we merge.
  const fastForward =
    (await run(["merge-base", "--is-ancestor", target, branch])).success;

  // Dry-run: report the plan, touch nothing.
  if (opts.dryRun) {
    if (opts.json) {
      emitResult({
        ok: true,
        verb: "setup land",
        dry_run: true,
        data: {
          landed: false,
          branch,
          target,
          fast_forward: fastForward,
          branch_deleted: false,
        },
      });
    } else {
      console.log(`Dry run — \`${LAND_COMMAND}\` would:`);
      console.log(
        fastForward
          ? `  • fast-forward ${target} to ${branch}`
          : `  • merge ${branch} into ${target}`,
      );
      console.log(`  • check out ${target}`);
      console.log(`  • delete the merged ${branch}`);
      console.log("");
      console.log("No changes were made (--dry-run).");
    }
    return 0;
  }

  // Check out the integration branch, then land the setup branch onto it.
  const checkout = await run(["checkout", "--quiet", target]);
  if (!checkout.success) {
    return emitLand(opts, {
      ok: false,
      error: "checkout_failed",
      message:
        `could not check out ${target}. Your work is safe on ${branch}. Git said:`,
      detail: [checkout.stderr.trim()],
      code: 1,
    });
  }
  const merge = fastForward
    ? await run(["merge", "--ff-only", "--quiet", branch])
    : await run(["merge", "--no-edit", branch]);
  if (!merge.success) {
    // Step the conflict aside so the tree is left clean, then refuse.
    await run(["merge", "--abort"]);
    await run(["checkout", "--quiet", branch]);
    return emitLand(opts, {
      ok: false,
      error: "conflict",
      message:
        `landing ${branch} onto ${target} hit a conflict. Resolve it by merging manually ` +
        `(\`git checkout ${target} && git merge ${branch}\`), or leave ${branch} for review. ` +
        `Your work is safe on ${branch}.`,
      detail: [merge.stderr.trim()].filter((d) => d !== ""),
      code: 1,
    });
  }

  // The setup branch is now fully contained in the integration branch — delete it.
  const del = await run(["branch", "-d", branch]);
  const branchDeleted = del.success;

  const data: LandData = {
    landed: true,
    branch,
    target,
    fast_forward: fastForward,
    branch_deleted: branchDeleted,
  };
  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup land",
      data,
      hints: [`Setup landed onto ${target}.`],
    });
    return 0;
  }
  console.log(
    fastForward
      ? `Setup landed — fast-forwarded ${target} to ${branch}.`
      : `Setup landed — merged ${branch} into ${target}.`,
  );
  console.log(`You are now on ${target} with discern set up.`);
  if (branchDeleted) {
    console.log(`Deleted the merged ${branch} branch.`);
  } else {
    console.log(
      `Left the ${branch} branch in place (it is fully merged; delete it with \`git branch -d ${branch}\` when ready).`,
    );
  }
  return 0;
}
