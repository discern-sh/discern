/**
 * Human words for every step a plan can show.
 *
 * `BUILT_IN_STEP_LABELS` keeps each operation's stable kebab-case label for
 * plans, results, and agents. These are the words for a view that shows an
 * operation to people: one short sentence-case phrase per built-in step,
 * keyed the same way, so a new built-in operation has its human words before
 * any progress view reads them. A phrase that names the trunk carries the
 * placeholder the configured trunk replaces. A project-owned step (a job, an
 * ensure command, a resource) or a runtime name reads through its kind's
 * phrase, with its configured spelling kept word for word inside it.
 */

import { BUILT_IN_STEP_LABELS, type StepKind } from "./result.ts";
import { TRUNK_PLACEHOLDER, withTrunk } from "./desk_vocabulary.ts";

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
  fastForwardTrunk: `Move ${TRUNK_PLACEHOLDER} to this branch`,
  instructionCheck: "Check the agent instructions are current",
  inheritEnv: "Copy the environment settings",
  materializeLocalAgentArtifacts: "Refresh agent files in the main checkout",
  merge: `Merge ${TRUNK_PLACEHOLDER} into the branch`,
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
  trackedRefreshLandingBoundary: "Check generated files before landing",
  trackedRefreshProofBoundary: "Check generated files before recording Proof",
  trunkLimits: `Check ${TRUNK_PLACEHOLDER}'s quality limits`,
  writeTaskMetadata: "Record the task title",
  writeProofNote: "Record the Proof note",
} as const satisfies Record<BuiltInStepKey, string>;

const HUMAN_BY_LABEL: ReadonlyMap<string, string> = new Map(
  Object.entries(BUILT_IN_STEP_LABELS).flatMap(([key, label]) => {
    const human = Object.entries(STEP_HUMAN_LABELS).find(([candidate]) =>
      candidate === key
    )?.[1];
    return human === undefined ? [] : [[label, human] as const];
  }),
);

/** The human phrase for a plan step's label, with the configured trunk, or
 * undefined for a project-owned step whose configured spelling is already
 * its name. */
export function humanStepLabel(
  label: string,
  trunk: string,
): string | undefined {
  const human = HUMAN_BY_LABEL.get(label);
  return human === undefined ? undefined : withTrunk(human, trunk);
}

/** A step label that is already a lowercase phrase, in sentence case; a
 * name such as a path or a branch, after `verb`. */
function phraseOr(verb: string): (label: string) => string {
  return (label) =>
    /\s/u.test(label)
      ? `${label.charAt(0).toUpperCase()}${label.slice(1)}`
      : `${verb} ${label}`;
}

/**
 * How a step whose label is not a built-in operation reads, by kind: the
 * project's command or name inside a short phrase. Keyed by every step kind,
 * so a new kind cannot reach a progress view as a bare identifier.
 */
export const STEP_KIND_PHRASES = {
  job: (label) => `Run ${label}`,
  "scope-gate": (label) => `Run the ${label} checks`,
  "merge-check": (label) => `Check ${label}`,
  "standards-limits-check": (label) => `Check ${label}`,
  "tracked-artifacts-check": (label) => `Check ${label}`,
  "instructions-check": (label) => `Check ${label}`,
  "skills-check": (label) => `Check ${label}`,
  "tracked-refresh-check": (label) => `Check ${label}`,
  "resource-create": (label) => `Create ${label}`,
  "resource-destroy": (label) => `Release ${label}`,
  git: phraseOr("Update"),
  "task-metadata": phraseOr("Record"),
  "setup-step": (label) => `Run ${label}`,
  "repository-ensure": (label) => `Run ${label}`,
  "checkout-clean-check": (label) => `Check ${label}`,
  "setup-ensure": (label) => `Run ${label}`,
  env: (label) => `Record ${label}`,
  refresh: (label) => `Refresh ${label}`,
  tidy: (label) => `Format ${label}`,
  standard: (label) => `Measure ${label}`,
} as const satisfies Record<StepKind, (label: string) => string>;

/**
 * The words a person reads for one plan step: a built-in operation's
 * phrase, with the configured trunk, or its kind's phrase around the
 * configured spelling.
 */
export function stepWords(
  step: { readonly kind: StepKind; readonly label: string },
  trunk: string,
): string {
  return humanStepLabel(step.label, trunk) ??
    STEP_KIND_PHRASES[step.kind](step.label);
}
