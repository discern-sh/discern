/**
 * Positive ownership for automatic worktree-branch deletion.
 *
 * Merge status says a ref is low-loss; it never says discern created or owns
 * that ref. Every automatic branch deletion therefore presents one of two
 * canonical identities here: a worktree id whose configured derived branch is
 * the exact ref, or the dedicated setup branch in setup's own lifecycle.
 */

import type { IdentitySettings } from "./identity.ts";
import { deriveIdentity } from "./identity.ts";
import { SETUP_BRANCH } from "../../shared/setup_state.ts";
import { runGit } from "../../shared/subprocess.ts";

export type AutomaticBranchOwnershipEvidence =
  | {
    readonly kind: "worktree";
    readonly branch: string;
    readonly id: string;
    readonly settings: IdentitySettings;
    readonly source:
      | "created"
      | "registered"
      | "gitlinked"
      | "ready-marker";
  }
  | {
    readonly kind: "setup";
    readonly branch: string;
  };

export type AutomaticBranchOwnership =
  | { readonly owned: true; readonly reason: string }
  | { readonly owned: false; readonly reason: string };

/** Decide automatic branch ownership without reading merge or filesystem state. */
export function classifyAutomaticBranchOwnership(
  evidence: AutomaticBranchOwnershipEvidence,
): AutomaticBranchOwnership {
  if (evidence.kind === "setup") {
    return evidence.branch === SETUP_BRANCH
      ? { owned: true, reason: "dedicated setup lifecycle" }
      : {
        owned: false,
        reason: `only ${SETUP_BRANCH} belongs to the setup lifecycle`,
      };
  }
  const expected = deriveIdentity(evidence.id, evidence.settings).branch;
  return evidence.branch === expected
    ? {
      owned: true,
      reason:
        `exact configured branch for ${evidence.source} worktree identity ${evidence.id}`,
    }
    : {
      owned: false,
      reason: evidence.branch === ""
        ? `detached checkout has no branch matching worktree identity ${evidence.id}`
        : `branch ${evidence.branch} does not match the worktree identity's configured branch ${expected}`,
    };
}

/** Explain why a branch with no canonical identity stays observational only. */
export function branchWithoutOwnershipReason(
  branch: string,
  settings: IdentitySettings,
): string {
  if (branch === SETUP_BRANCH) {
    return "dedicated setup branch; setup lifecycle only";
  }
  return branch.startsWith(settings.branchPrefix)
    ? "configured-prefix branch without worktree identity evidence"
    : "outside discern branch ownership";
}

export type OwnedBranchDeletionResult =
  | { readonly kind: "deleted" }
  | { readonly kind: "absent" }
  | {
    readonly kind: "refused";
    readonly refusal:
      | "ownership"
      | "changed"
      | "in-use"
      | "unmerged"
      | "unavailable";
    readonly reason: string;
  };

/**
 * Delete one automatically-owned branch by compare-and-swap.
 *
 * The caller supplies the commit captured while ownership evidence was live.
 * An optional merge target adds the ordinary landed-work proof. A branch that
 * moved, became checked out, lost ownership, or cannot be inspected is kept.
 */
export async function deleteAutomaticallyOwnedBranch(opts: {
  readonly repoRoot: string;
  readonly branch: string;
  readonly expectedCommit: string;
  readonly ownership: AutomaticBranchOwnershipEvidence;
  readonly mergedInto?: string;
}): Promise<OwnedBranchDeletionResult> {
  const ownership = classifyAutomaticBranchOwnership(opts.ownership);
  if (!ownership.owned || opts.ownership.branch !== opts.branch) {
    return {
      kind: "refused",
      refusal: "ownership",
      reason: ownership.owned
        ? "ownership evidence names a different branch"
        : ownership.reason,
    };
  }
  if (opts.expectedCommit === "") {
    return {
      kind: "refused",
      refusal: "unavailable",
      reason: "the owned branch commit is unavailable",
    };
  }
  const ref = `refs/heads/${opts.branch}`;
  const current = await runGit(
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: opts.repoRoot },
  );
  if (!current.success) {
    const exists = await runGit(
      ["show-ref", "--verify", "--quiet", ref],
      { cwd: opts.repoRoot },
    );
    return exists.code === 1 ? { kind: "absent" } : {
      kind: "refused",
      refusal: "unavailable",
      reason: current.stderr.trim() || "Git could not inspect the branch",
    };
  }
  if (current.stdout.trim() !== opts.expectedCommit) {
    return {
      kind: "refused",
      refusal: "changed",
      reason: "the branch moved after ownership was captured",
    };
  }
  const worktrees = await runGit(["worktree", "list", "--porcelain"], {
    cwd: opts.repoRoot,
  });
  if (!worktrees.success) {
    return {
      kind: "refused",
      refusal: "unavailable",
      reason: worktrees.stderr.trim() || "Git could not inspect worktree use",
    };
  }
  if (worktrees.stdout.includes(`branch ${ref}\n`)) {
    return {
      kind: "refused",
      refusal: "in-use",
      reason: "the branch is still checked out",
    };
  }
  if (opts.mergedInto !== undefined) {
    const merged = await runGit(
      [
        "merge-base",
        "--is-ancestor",
        opts.expectedCommit,
        `refs/heads/${opts.mergedInto}`,
      ],
      { cwd: opts.repoRoot },
    );
    if (!merged.success) {
      return {
        kind: "refused",
        refusal: merged.code === 1 ? "unmerged" : "unavailable",
        reason: merged.code === 1
          ? `the owned branch is not fully merged into ${opts.mergedInto}`
          : merged.stderr.trim() || "Git could not verify branch ancestry",
      };
    }
  }
  const deleted = await runGit(
    [
      "update-ref",
      "-m",
      `discern: retire owned branch ${opts.branch}`,
      "-d",
      ref,
      opts.expectedCommit,
    ],
    { cwd: opts.repoRoot },
  );
  if (!deleted.success) {
    return {
      kind: "refused",
      refusal: "unavailable",
      reason: deleted.stderr.trim() || "Git refused the branch deletion",
    };
  }
  // Match `git branch -d`/`-D`: the ref is already safely gone, so an absent
  // branch-local config section or a config write refusal is advisory.
  await runGit(["config", "--remove-section", `branch.${opts.branch}`], {
    cwd: opts.repoRoot,
  });
  return { kind: "deleted" };
}
