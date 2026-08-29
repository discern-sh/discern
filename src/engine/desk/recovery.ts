/** Pure degraded-task evidence and distinct cleanup consequence accounts. */

import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import type { DeskActionFacts, DeskConsequence } from "./model.ts";

/** Typed evidence for a degraded task's read-only recovery view. */
export interface DeskRecoveryFact {
  readonly failure: string;
  readonly failedCommand?: string;
  readonly verified: readonly string[];
  readonly unavailable: readonly string[];
  readonly nextStep: string;
  readonly repair: "retry" | "manual";
  readonly repairCommand: string;
}

/** Whether the checkout cannot safely support ordinary Desk actions. */
export function isUnhealthy(entry: StatusFleetEntry): boolean {
  return entry.broken === true || entry.git_unavailable === true ||
    entry.setup?.state === "incomplete" ||
    entry.setup?.state === "unavailable";
}

/** Prefer the recovery refusal while retaining an action's healthy-state result. */
export function healthyActionAvailability(
  entry: StatusFleetEntry,
  recoveryMessage: string,
  availableWhenHealthy?: string,
): string | undefined {
  return isUnhealthy(entry) ? recoveryMessage : availableWhenHealthy;
}

/** Explain whether the real setup core may retry this observed state. */
export function retrySetupAvailability(
  entry: StatusFleetEntry,
): string | undefined {
  return entry.setup?.repair?.kind === "retry"
    ? undefined
    : entry.setup?.repair?.reason ??
      "This setup state has no safe automatic repair.";
}

/** Retain the setup/Git distinction in final-check refusal copy. */
export function finalChecksAvailability(
  entry: StatusFleetEntry,
  availableWhenHealthy: string | undefined,
): string | undefined {
  if (!isUnhealthy(entry)) return availableWhenHealthy;
  return entry.broken === true
    ? "Setup is incomplete. Finish or repair setup before final checks."
    : "Git state is unreadable. Repair Git before final checks.";
}

/** Reclaim requires both exact containment and a verifiable checkout. */
export function reclaimAvailability(
  facts: DeskActionFacts,
): string | undefined {
  if (facts.entry.contained_in === undefined) {
    return "This checkout is not contained in another live task.";
  }
  return isUnhealthy(facts.entry)
    ? "The task state is not verifiable enough to reclaim. Follow its recovery steps first."
    : undefined;
}

/** Build recovery evidence without inferring facts an observer could not read. */
export function recoveryFact(
  entry: StatusFleetEntry,
): DeskRecoveryFact | undefined {
  if (!isUnhealthy(entry)) return undefined;
  const setup = entry.setup;
  const repair = setup?.repair;
  const gitFailure = entry.git_failure;
  const failure = gitFailure?.reason ?? repair?.reason ??
    (entry.broken === true
      ? "The checkout does not contain a readable discern.toml."
      : "The checkout did not reach a verifiable setup-ready state.");
  const verified = [
    `Checkout identity: ${entry.id ?? entry.task?.id ?? entry.branch}`,
    `Checkout path: ${entry.path}`,
    `Branch identity: ${entry.branch}`,
    ...(entry.registration === undefined ? [] : [
      `Git registration: ${entry.registration.head}`,
      `Branch reachability: ${
        entry.branch_reachable === true ? "reachable" : "unreachable"
      }`,
    ]),
    ...(entry.filesystem?.state === "directory"
      ? ["Filesystem: checkout directory is present"]
      : []),
    ...Object.entries(entry.resources ?? {}).map(([name, value]) =>
      `Resource ${name}: ${value}`
    ),
  ];
  const unavailable = [
    ...(entry.registration === undefined
      ? ["Git worktree registration could not be verified"]
      : []),
    ...(entry.filesystem?.state !== "directory"
      ? [
        `Filesystem: ${
          entry.filesystem?.reason ?? entry.filesystem?.state ?? "unavailable"
        }`,
      ]
      : []),
    ...(setup?.journal?.status === "unavailable"
      ? [`Setup journal: ${setup.journal.reason ?? "unavailable"}`]
      : []),
  ];
  const repairCommand = repair?.command ?? "discern doctor";
  return {
    failure,
    ...(gitFailure === undefined ? {} : { failedCommand: gitFailure.command }),
    verified,
    unavailable,
    nextStep: repair?.reason ?? `Run ${repairCommand}.`,
    repair: repair?.kind ?? "manual",
    repairCommand,
  };
}

interface CleanupContext {
  readonly trunk: string;
  readonly branch: string;
  readonly path: string;
  readonly containedIn?: string;
  readonly taskMetadataRecorded: boolean;
  readonly effortGranted: boolean;
  readonly proofRecorded: boolean;
  readonly changedFiles?: number;
  readonly ahead?: number | "unknown";
  readonly resources: readonly string[];
}

/** Structured artifact account for containment-preserving Reclaim. */
export function reclaimConsequence(
  context: CleanupContext,
): DeskConsequence {
  return {
    keeps: [
      `Branch ${context.branch}`,
      `Containing branch ${context.containedIn ?? "another live task"}`,
      "Commits carried by the containing branch",
    ],
    changes: [
      context.resources.length === 0
        ? "No external resources are recorded"
        : `Destroy resources: ${context.resources.join(", ")}`,
    ],
    removes: [
      "Task checkout",
      ...(context.taskMetadataRecorded ? ["Task metadata"] : []),
      ...(context.effortGranted ? ["Task landing grant"] : []),
      ...(context.proofRecorded ? ["Task-local Proof"] : []),
    ],
    recoverable: [
      "The retained branch self-cleans after its containing work lands",
    ],
  };
}

/** Structured artifact account for branch-preserving Park. */
export function parkConsequence(context: CleanupContext): DeskConsequence {
  return {
    keeps: [
      `Branch ${context.branch}`,
      "Task title, brief, and creation source",
      "Committed work, including work not on the trunk",
    ],
    changes: [
      context.resources.length === 0
        ? "Record that no external resources need cleanup"
        : `Destroy resources: ${context.resources.join(", ")}`,
    ],
    removes: [
      "Task checkout",
      ...(context.effortGranted ? ["Task landing grant"] : []),
      ...(context.proofRecorded ? ["Task-local Proof"] : []),
    ],
    recoverable: ["Resume the retained branch from Work without a worktree"],
  };
}

/** Structured artifact account for destructive Drop. */
export function dropConsequence(context: CleanupContext): DeskConsequence {
  return {
    keeps: ["Trunk and other tasks"],
    changes: [
      context.resources.length === 0
        ? "No external resources are recorded"
        : `Destroy resources: ${context.resources.join(", ")}`,
    ],
    removes: [
      "Task checkout",
      `Branch ${context.branch} when the lifecycle plan verifies discern ownership`,
      ...(context.changedFiles === undefined
        ? ["Uncommitted work cannot be ruled out"]
        : context.changedFiles > 0
        ? [`${context.changedFiles} uncommitted changes`]
        : []),
      ...(context.ahead === "unknown"
        ? ["Unlanded commits cannot be ruled out"]
        : typeof context.ahead === "number" && context.ahead > 0
        ? [`${context.ahead} commits not on the trunk`]
        : []),
      ...(context.taskMetadataRecorded ? ["Task metadata"] : []),
      ...(context.effortGranted ? ["Task landing grant"] : []),
      ...(context.proofRecorded ? ["Task-local Proof"] : []),
    ],
    recoverable: [
      "A deleted committed branch tip receives a bounded recovery ref",
      "Uncommitted files have no automatic recovery",
    ],
  };
}

/** Park is available only for a clean, reachable, non-contained task branch. */
export function parkAvailability(
  facts: DeskActionFacts,
): string | undefined {
  if (isUnhealthy(facts.entry)) {
    return "Follow the task's recovery steps before parking it.";
  }
  if (facts.entry.contained_in !== undefined) {
    return "This task is contained in another live task. Use Reclaim to preserve its containment contract.";
  }
  if (facts.entry.clean !== true) {
    return facts.entry.clean === false
      ? "Commit or discard the uncommitted changes before parking."
      : "Worktree cleanliness is unknown.";
  }
  if (
    facts.entry.branch === facts.trunk ||
    facts.entry.branch_reachable !== true
  ) {
    return "Park requires a named task branch separate from the trunk.";
  }
  return undefined;
}
