/**
 * Human words for the operations discern performs itself.
 *
 * `BUILT_IN_STEP_LABELS` keeps each operation's stable kebab-case label for
 * plans, results, and agents. People watching an operation read these
 * instead: one short sentence-case phrase per built-in step, keyed the same
 * way, so a new built-in operation cannot reach a progress view without its
 * human words. Project-owned steps (jobs, ensure commands, scripts) keep their
 * configured spelling and have no entry here.
 */

import { BUILT_IN_STEP_LABELS } from "./result.ts";

/** One built-in operation's registry key. */
export type BuiltInStepKey = keyof typeof BUILT_IN_STEP_LABELS;

/** The human phrase for every built-in operation. */
export const STEP_HUMAN_LABELS = {
  addWorktree: "Create the checkout",
  autoResolveGeneratedConflicts: "Resolve conflicts in generated files",
  checkTrunkCheckout: "Check the main checkout is clean",
  commitRegeneratedArtifacts: "Commit the regenerated files",
  completeRefresh: "Refresh generated files",
  configuredMarkdown: "Format the project's Markdown sources",
  deleteBranch: "Delete the branch",
  ensureBranch: "Create the branch",
  fastForwardTrunk: "Move main to this branch",
  instructionCheck: "Check the agent instructions are current",
  inheritEnv: "Copy the environment settings",
  materializeLocalAgentArtifacts: "Refresh agent files on main",
  merge: "Merge main into the branch",
  mergeCheck: "Check the branch merges cleanly",
  planIntegrity: "Check the plan is consistent",
  preserveBranchTip: "Keep the last commit for recovery",
  reconcileProofNoteFetch: "Sync Proof records",
  recordPort: "Record the checkout's port",
  reclaimOrphanDir: "Remove the leftover folder",
  recoverInterruptedAcceptance: "Recover an interrupted landing",
  recoverSetupStep: "Recover an interrupted setup step",
  removeWorktree: "Remove the checkout",
  rootDiscernToml: "Format discern.toml",
  setup: "Set up the checkout",
  skillsCheck: "Check the skills are current",
  standardsLimitsCheck: "Check the quality limits",
  teardownResources: "Release its ports and services",
  trackedArtifactsCheck: "Check tracked generated files",
  trackedRefreshCheck: "Check generated files need no refresh",
  trackedRefreshLandingBoundary: "Check main needs no refresh",
  trackedRefreshProofBoundary: "Check generated files before recording Proof",
  trunkLimits: "Check main's quality limits",
  writeTaskMetadata: "Record the task title",
  writeProofNote: "Record the Proof on main",
} as const satisfies Record<BuiltInStepKey, string>;

const HUMAN_BY_LABEL: ReadonlyMap<string, string> = new Map(
  Object.entries(BUILT_IN_STEP_LABELS).flatMap(([key, label]) => {
    const human = Object.entries(STEP_HUMAN_LABELS).find(([candidate]) =>
      candidate === key
    )?.[1];
    return human === undefined ? [] : [[label, human] as const];
  }),
);

/** The human phrase for a plan step's label, or undefined for a
 * project-owned step whose configured spelling is already its name. */
export function humanStepLabel(label: string): string | undefined {
  return HUMAN_BY_LABEL.get(label);
}
