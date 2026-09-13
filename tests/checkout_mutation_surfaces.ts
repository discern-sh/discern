/**
 * Exact registry of checkout-changing Git invocations under the workspace
 * contract (ADR 0389).
 *
 * An operation changes the checked-out revision, index, or working tree only
 * of the checkout it was invoked in, of a worktree discern itself created, or
 * of the main checkout a landing converges. Every authored argument list that
 * hands Git a command able to install a revision or replace a tree is one row
 * naming its path, enclosing function, command, allowance, and reason. The
 * structural guard checks both directions, so an unknown invocation and a
 * stale registry row both fail, and the falling `checkout_mutation_boundaries`
 * Standard holds the population.
 */

/** The Git commands that install a revision or replace an index or tree. */
export const CHECKOUT_MUTATION_COMMANDS = [
  "checkout",
  "switch",
  "reset",
  "read-tree",
  "restore",
  "clean",
  "worktree add",
  "worktree remove",
] as const;

export type CheckoutMutationCommand =
  (typeof CHECKOUT_MUTATION_COMMANDS)[number];

/** The three allowances of the workspace contract. */
export const CHECKOUT_MUTATION_ALLOWANCES = {
  "invoked-checkout":
    "the operation changes only the checkout it was invoked in",
  "owned-worktree":
    "the operation creates or removes a worktree discern itself created",
  "landing-convergence":
    "a landing converges the main checkout to the trunk it advanced",
} as const;

export type CheckoutMutationAllowance =
  keyof typeof CHECKOUT_MUTATION_ALLOWANCES;

/** One exact checkout-changing Git invocation. */
export interface CheckoutMutationBoundary {
  /** Repository-relative authored source path. */
  readonly path: string;
  /** Stable nearest named function or `<module>` for a top-level invocation. */
  readonly enclosingFunction: string;
  /** The guarded command the argument list names. */
  readonly command: CheckoutMutationCommand;
  /** Which allowance of the workspace contract covers the invocation. */
  readonly allowance: CheckoutMutationAllowance;
  /** Why the invocation stays inside that allowance, in one line. */
  readonly reason: string;
}

/** Every checkout-changing Git invocation in production and tooling code. */
export const CHECKOUT_MUTATION_BOUNDARIES = [
  {
    path: "src/commands/setup.ts",
    enclosingFunction: "ensureSetupBranch",
    command: "checkout",
    allowance: "invoked-checkout",
    reason:
      "setup begin moves the invoked checkout onto its existing isolated setup branch",
  },
  {
    path: "src/commands/setup.ts",
    enclosingFunction: "ensureSetupBranch",
    command: "checkout",
    allowance: "invoked-checkout",
    reason:
      "setup begin creates the isolated setup branch in the invoked checkout when none exists",
  },
  {
    path: "src/commands/setup_accept.ts",
    enclosingFunction: "runSetupAccept",
    command: "checkout",
    allowance: "landing-convergence",
    reason:
      "setup accept switches the main checkout to the trunk it is about to advance",
  },
  {
    path: "src/commands/setup_accept.ts",
    enclosingFunction: "runSetupAccept",
    command: "checkout",
    allowance: "landing-convergence",
    reason:
      "a refused setup landing returns the main checkout to the setup branch it left",
  },
  {
    path: "src/commands/setup_completion_git.ts",
    enclosingFunction: "restorePendingCompletionMarker",
    command: "restore",
    allowance: "invoked-checkout",
    reason:
      "setup unstages its own pending config edit in the invoked checkout",
  },
  {
    path: "src/engine/gate/standard_proposals.ts",
    enclosingFunction: "recoverProposalTransaction",
    command: "checkout",
    allowance: "invoked-checkout",
    reason:
      "an interrupted proposal restores the one scoped config file in the invoked checkout",
  },
  {
    path: "src/engine/gate/standard_proposals.ts",
    enclosingFunction: "restoreProposalEdit",
    command: "checkout",
    allowance: "invoked-checkout",
    reason:
      "a failed proposal apply restores the scoped config in the invoked checkout",
  },
  {
    path: "src/engine/gate/standards.ts",
    enclosingFunction: "restorePinEdits",
    command: "checkout",
    allowance: "invoked-checkout",
    reason:
      "a half-applied pin restores the config file to HEAD in the invoked checkout",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "resolveGeneratedConflicts",
    command: "checkout",
    allowance: "invoked-checkout",
    reason:
      "update takes the incoming side of a generated-only conflict in the invoked worktree, a landing's own integration worktree included",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "recoverCheckedOutFastForward",
    command: "read-tree",
    allowance: "landing-convergence",
    reason:
      "an interrupted landing finishes the recorded two-tree update of the main checkout",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "fastForwardCheckedOutBranch",
    command: "read-tree",
    allowance: "landing-convergence",
    reason:
      "a landing converges the main checkout to the trunk its compare-and-swap advanced",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "fastForwardCheckedOutBranch",
    command: "read-tree",
    allowance: "landing-convergence",
    reason:
      "a failed convergence reverses the two-tree update after the ref rolls back",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "ensureWorktreeBranch",
    command: "switch",
    allowance: "invoked-checkout",
    reason:
      "a detached invoked worktree gains a named branch at its current commit",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "addWorktree",
    command: "worktree add",
    allowance: "owned-worktree",
    reason:
      "start, the setup viability probe, and a landing's integration worktree create the worktrees discern owns",
  },
  {
    path: "src/engine/worktree/git.ts",
    enclosingFunction: "removeWorktreeSafely",
    command: "worktree remove",
    allowance: "owned-worktree",
    reason:
      "accept (its integration worktree included), drop, park, and confirmed prune remove worktrees registered to this repository",
  },
  {
    path: "src/shared/discern_commit.ts",
    enclosingFunction: "rollbackDiscernOwnedCommit",
    command: "read-tree",
    allowance: "invoked-checkout",
    reason:
      "rolling back a discern-authored commit restores its parent tree in the invoked checkout",
  },
  {
    path: "src/shared/discern_commit.ts",
    enclosingFunction: "rollbackDiscernOwnedCommit",
    command: "read-tree",
    allowance: "invoked-checkout",
    reason:
      "a failed rollback restores the owned commit's tree after its ref is retained",
  },
] as const satisfies readonly CheckoutMutationBoundary[];

/** The population the falling Standard holds. */
export function registeredCheckoutMutationCount(): number {
  return CHECKOUT_MUTATION_BOUNDARIES.length;
}
