/**
 * The desk's pure decision model.
 *
 * `status` owns observation and row-status precedence. The desk consumes that
 * projection, adds only desk capabilities and pairwise collision evidence, and
 * returns everything a renderer needs to explain the state and offer actions.
 * Time and every observed fact are injected so the decision table remains
 * deterministic.
 */

import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import type {
  GateProofCheckStatus,
  LandingAuthorityData,
  StatusAdrCollision,
  StatusData,
  StatusFleetCollision,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import type { DetectedAgentBinary } from "../../lib/detect_agents.ts";
import type { AgentName } from "../../lib/config.ts";
import { providerFor } from "../../lib/providers.ts";
import type { AgentCliPromptArgument } from "../../lib/providers.ts";
import { compactDuration } from "../output.ts";
import type { DeskProjectScript } from "../project_scripts.ts";
import {
  type FleetRowStatusKind,
  presentFleetRow,
  relativeAge,
} from "../status/tty.ts";
import { taskLabel, type WorktreeTaskLabel } from "../worktree/task_label.ts";
import {
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import {
  type DeskRecoveryFact,
  dropConsequence,
  finalChecksAvailability,
  healthyActionAvailability,
  isUnhealthy,
  parkAvailability,
  parkConsequence,
  reclaimAvailability,
  reclaimConsequence,
  recoveryFact,
  retrySetupAvailability,
} from "./recovery.ts";
export type { DeskRecoveryFact } from "./recovery.ts";
import { gitDetails } from "./git_details.ts";

export { taskLabel } from "../worktree/task_label.ts";

/** Human decisions in priority order. */
export const DESK_STATES = [
  "needs_attention",
  "ready_to_review",
  "working",
  "paused",
  "empty",
] as const;
export type DeskState = (typeof DESK_STATES)[number];

/**
 * The exhaustive decision-level adaptation of status's canonical row kinds.
 * Status remains the only owner of precedence; a future status kind cannot
 * compile until the desk consciously places it.
 */
export const DESK_STATE_BY_STATUS_KIND = {
  broken: "needs_attention",
  "setup-incomplete": "needs_attention",
  unreadable: "needs_attention",
  failed: "needs_attention",
  blocked: "needs_attention",
  behind: "paused",
  ready: "ready_to_review",
  running: "working",
  stale: "needs_attention",
  "in-progress": "paused",
  "proof-unreadable": "needs_attention",
  "proof-unavailable": "needs_attention",
  "proof-stale": "paused",
  "needs-gate": "paused",
  idle: "empty",
} as const satisfies Readonly<Record<FleetRowStatusKind, DeskState>>;

/** Every action the desk can represent, in menu order. */
export const DESK_ACTIONS = [
  "recovery",
  "retry_setup",
  "done",
  "accept",
  "update",
  "agent",
  "follow_up",
  "scripts",
  "jump",
  "inspect",
  "rename",
  "grant",
  "revoke_grant",
  "reclaim",
  "park",
  "drop",
] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];

/** Product groups in their fixed presentation order. */
export const DESK_ACTION_GROUPS = [
  "recommended",
  "work",
  "review",
  "manage",
  "danger",
] as const;
export type DeskActionGroupId = (typeof DESK_ACTION_GROUPS)[number];
type DeskBaseActionGroupId = Exclude<DeskActionGroupId, "recommended">;

/** Confirmation behavior belongs to the action, not its dispatcher branch. */
export type DeskConfirmationPolicy =
  | { readonly kind: "none" }
  | {
    readonly kind: "confirm";
    readonly defaultTo: false;
    readonly yesLabel: string;
    readonly noLabel: string;
  }
  | {
    readonly kind: "typed-branch";
    readonly defaultTo: false;
    readonly yesLabel: string;
    readonly noLabel: string;
  };

/** The CLI evidence a person can copy before authorizing an action. */
export interface DeskCommandEvidence {
  readonly argv: readonly string[];
  readonly workingDirectory: "task" | "main";
}

/** The consequence account every material action presents before it runs. */
export interface DeskConsequence {
  readonly keeps: readonly string[];
  readonly changes: readonly string[];
  readonly removes: readonly string[];
  readonly recoverable: readonly string[];
}

interface DeskActionLabelContext {
  readonly trunk: string;
  readonly branch: string;
  readonly path: string;
  readonly proofHonored: boolean;
  readonly containedIn?: string;
  readonly taskMetadataRecorded: boolean;
  readonly effortGranted: boolean;
  readonly proofRecorded: boolean;
  readonly changedFiles?: number;
  readonly ahead?: number | "unknown";
  readonly resources: readonly string[];
}

export interface DeskActionMetadata {
  readonly group: DeskBaseActionGroupId;
  /** Whether this action's real effect boundary remains valid while status
   * reports another operation in this task. Applied centrally to every action. */
  readonly availableWhileRunning: boolean;
  readonly label: (context: DeskActionLabelContext) => string;
  readonly command: (context: DeskActionLabelContext) => DeskCommandEvidence;
  readonly consequence: (
    context: DeskActionLabelContext,
  ) => DeskConsequence;
  readonly confirmation: DeskConfirmationPolicy;
  readonly availability: (facts: DeskActionFacts) => string | undefined;
}

interface DeskActionOfferBase {
  readonly action: DeskAction;
  readonly group: DeskActionGroupId;
  readonly label: string;
  readonly command: DeskCommandEvidence;
  readonly consequence: DeskConsequence;
  readonly confirmation: DeskConfirmationPolicy;
}

export interface EnabledDeskAction extends DeskActionOfferBase {
  readonly availability: "enabled";
  readonly recommended: boolean;
}

export interface DisabledDeskAction extends DeskActionOfferBase {
  readonly availability: "disabled";
  readonly recommended: false;
  /** One observed condition that prevents an honest offer. */
  readonly reason: string;
}

export type DeskActionOffer = EnabledDeskAction | DisabledDeskAction;

/** One provider-owned command the desk can launch in a selected worktree. */
export interface DeskAgentLaunch {
  readonly id: string;
  readonly agent: AgentName;
  readonly providerLabel: string;
  readonly binary: string;
  readonly kind: "open" | "continue";
  readonly label: string;
  readonly args: readonly string[];
  readonly promptArgument?: AgentCliPromptArgument;
  readonly availability?: "enabled" | "disabled";
  readonly reason?: string;
}

/** Resolve a stored brief through a provider-declared, documented argv option. */
export function agentLaunchArgs(
  launch: DeskAgentLaunch,
  brief: string | undefined,
): { readonly args: readonly string[]; readonly briefPassed: boolean } {
  if (brief === undefined || launch.promptArgument === undefined) {
    return { args: launch.args, briefPassed: false };
  }
  return {
    args: [...launch.args, launch.promptArgument.flag, brief],
    briefPassed: true,
  };
}

/** The human task name plus an optional minted-id disambiguator. */
export type DeskTaskLabel = WorktreeTaskLabel;

export type DeskDetailKind =
  | "activity"
  | "git"
  | "proof"
  | "authority"
  | "collision"
  | "containment"
  | "next_condition";

export interface DeskDetail {
  readonly kind: DeskDetailKind;
  readonly text: string;
}

export interface DeskProofFact {
  readonly status: GateProofCheckStatus;
  readonly honored: boolean;
  readonly summary: string;
  readonly detail?: string;
  /** Stored one-line Proof, present only when the survey reports it. */
  readonly line?: string;
}

/** Running or most-recent command evidence, already interpreted for display. */
export interface DeskActivityFact {
  readonly status: "running" | "last_action" | "unrecorded";
  readonly summary: string;
  readonly detail?: string;
}

export interface DeskAuthorityFact {
  readonly status: "granted" | "needs_approval" | "scope_limited" | "unknown";
  readonly source?: NonNullable<LandingAuthorityData["source"]>;
  readonly summary: string;
  readonly scopes: readonly string[];
  readonly uncoveredPaths: readonly string[];
  readonly warnings: readonly string[];
}

export interface DeskChangedFileCollision {
  readonly kind: "changed_files";
  readonly otherBranch: string;
  readonly paths: readonly string[];
  readonly total: number;
}

export interface DeskAdrCollision {
  readonly kind: "adr";
  readonly number: string;
  readonly otherBranches: readonly string[];
  readonly paths: readonly string[];
}

export type DeskCollision = DeskChangedFileCollision | DeskAdrCollision;

/** A complete decision; renderers need no raw status-field interpretation. */
export interface DeskDecision {
  readonly state: DeskState;
  /** The status projection that supplied this decision's base meaning. */
  readonly statusKind: FleetRowStatusKind;
  readonly headline: string;
  readonly details: readonly DeskDetail[];
  readonly needsHumanDecision: boolean;
  readonly landingReady: boolean;
  readonly activity: DeskActivityFact;
  readonly proof: DeskProofFact;
  readonly authority: DeskAuthorityFact;
  readonly collisions: readonly DeskCollision[];
  readonly recovery?: DeskRecoveryFact;
  /** Every canonical action, enabled or disabled, exactly once. */
  readonly actions: readonly DeskActionOffer[];
  readonly recommendedAction?: DeskAction;
}

/** One selectable effort and its already-complete decision. */
export interface DeskRow {
  readonly entry: StatusFleetEntry;
  readonly task: DeskTaskLabel;
  readonly scripts: readonly DeskProjectScript[];
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
  readonly decision: DeskDecision;
}

/** Main-checkout state carried by the board decision. */
export interface DeskMainDecision {
  readonly state: "clean" | "changed" | "unknown";
  readonly headline: string;
}

/** One bounded root-level fact that is not a selectable task. */
export interface DeskBoardNotice {
  readonly id: "unlanded" | "contained" | "reappeared" | "emergency";
  readonly state: "attention" | "information";
  readonly headline: string;
  readonly detail?: string;
  readonly nextAction?: string;
}

/** Complete root-board meaning; the view only maps these decisions to Components. */
export interface DeskBoardDecision {
  readonly project: string;
  readonly main: DeskMainDecision;
  readonly taskCount: number;
  readonly needsPersonCount: number;
  readonly readyToReviewCount: number;
  /** Static in this wave; a later live-refresh stream replaces this value. */
  readonly refreshedAge: "just now";
  readonly notices: readonly DeskBoardNotice[];
}

/** The headings rendered for decision groups. */
export function stateTitle(state: DeskState): string {
  switch (state) {
    case "needs_attention":
      return "Needs attention";
    case "ready_to_review":
      return "Ready to review";
    case "working":
      return "Working";
    case "paused":
      return "Paused";
    case "empty":
      return "Empty";
  }
}

/** Build the compact line used by today's board from decision-owned copy. */
export function decisionSummary(decision: DeskDecision): string {
  return [decision.headline, ...decision.details.map((detail) => detail.text)]
    .join(" · ");
}

/** Render a counted noun with an optional irregular plural. */
function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Render a recorded verb as the command a person recognizes. */
function discernCommand(verb: string | undefined): string {
  if (verb === undefined || verb === "") return "The last command";
  return verb.startsWith("discern ") ? verb : `discern ${verb}`;
}

/** Render task activity with an explicit subject, including current activity. */
function activeAge(iso: string | undefined, nowMs: number): string {
  const age = relativeAge(iso, nowMs);
  if (age === "just now") return "active now";
  if (age === "—") return "No activity recorded";
  return `Last activity ${age}`;
}

/** Project one complete Proof status into decision-owned factual copy. */
function proofFact(
  status: GateProofCheckStatus,
  detail?: string,
  line?: string,
): DeskProofFact {
  const summary = ((): string => {
    switch (status) {
      case "honored":
        return "Proof honored for this commit";
      case "report_only":
        return "Proof is report-only";
      case "missing":
        return "No Proof is recorded";
      case "stale":
        return "Proof belongs to another commit";
      case "dirty":
        return "Proof does not cover uncommitted work";
      case "unavailable":
        return "Proof state is unavailable";
      case "read_failed":
        return "Proof could not be read";
    }
  })();
  return {
    status,
    honored: status === "honored",
    summary,
    ...(detail === undefined ? {} : { detail }),
    ...(line === undefined ? {} : { line }),
  };
}

/** Project command activity once so detail views never reinterpret survey rows. */
function activityFact(
  entry: StatusFleetEntry,
  nowMs: number,
): DeskActivityFact {
  if (entry.running !== undefined) {
    const timing = [
      `Elapsed ${compactDuration(entry.running.elapsed_ms)}`,
      ...(entry.running.typical_duration_ms === undefined
        ? []
        : [`usually ${compactDuration(entry.running.typical_duration_ms)}`]),
    ].join("; ");
    return {
      status: "running",
      summary: `Running ${discernCommand(entry.running.verb)}`,
      detail: timing,
    };
  }
  if (entry.last_action !== undefined) {
    const age = relativeAge(entry.last_action.at, nowMs);
    const outcome = entry.last_action.outcome === "ok"
      ? "completed"
      : entry.last_action.outcome === "partial"
      ? "completed part of its work"
      : entry.last_action.outcome === "refused"
      ? "was refused"
      : "failed";
    const detail = [
      ...(age === "—" ? [] : [`Recorded ${age}`]),
      ...(entry.last_action.failed_stage === undefined
        ? []
        : [`failed check: ${entry.last_action.failed_stage}`]),
    ].join("; ");
    return {
      status: "last_action",
      summary: `${discernCommand(entry.last_action.verb)} ${outcome}`,
      ...(detail === "" ? {} : { detail }),
    };
  }
  return {
    status: "unrecorded",
    summary: activeAge(entry.last_activity, nowMs),
  };
}

/** Project survey-carried landing authority without inventing missing facts. */
function authorityFact(
  authority: LandingAuthorityData | undefined,
): DeskAuthorityFact {
  if (authority === undefined) {
    return {
      status: "unknown",
      summary: "Landing authority was not reported",
      scopes: [],
      uncoveredPaths: [],
      warnings: [],
    };
  }
  const scopes = authority.scopes ?? authority.standing_scopes ?? [];
  const uncoveredPaths = authority.uncovered?.map((item) => item.path) ?? [];
  const warnings = authority.warnings ?? [];
  if (authority.kind === "authorized") {
    const summary = authority.source === "effort-grant"
      ? "Current source approval recorded"
      : authority.source === "standing-grant"
      ? scopes.length === 0
        ? "Standing landing grant recorded"
        : `Standing landing grant covers ${scopes.join(", ")}`
      : authority.source === "conversation"
      ? "Conversation approval recorded"
      : "Landing authority recorded";
    return {
      status: "granted",
      ...(authority.source === undefined ? {} : { source: authority.source }),
      summary,
      scopes,
      uncoveredPaths,
      warnings,
    };
  }
  const scopeLimited = (authority.standing_scopes?.length ?? 0) > 0 ||
    uncoveredPaths.length > 0;
  const summary = scopeLimited
    ? uncoveredPaths.length === 0
      ? "Standing landing grant does not cover this work"
      : `Owner approval needed for ${
        plural(uncoveredPaths.length, "changed path")
      } outside the standing grant`
    : "Owner approval needed to land";
  return {
    status: scopeLimited ? "scope_limited" : "needs_approval",
    summary,
    scopes,
    uncoveredPaths,
    warnings,
  };
}

/** Select ADR-number collisions whose branch set includes this task. */
function adrCollisionsFor(
  entry: StatusFleetEntry,
  collisions: readonly StatusAdrCollision[],
): DeskAdrCollision[] {
  if (entry.branch === "") return [];
  return collisions.flatMap((collision) => {
    if (!collision.branches.includes(entry.branch)) return [];
    return [{
      kind: "adr" as const,
      number: collision.number,
      otherBranches: collision.branches.filter((branch) =>
        branch !== entry.branch
      ),
      paths: collision.paths,
    }];
  });
}

/** Render collision evidence as ordered human facts. */
function collisionDetails(collisions: readonly DeskCollision[]): DeskDetail[] {
  return collisions.map((collision): DeskDetail => {
    if (collision.kind === "changed_files") {
      return {
        kind: "collision",
        text: `${
          plural(collision.total, "changed file")
        } overlap with ${collision.otherBranch}`,
      };
    }
    const branches = collision.otherBranches.length === 0
      ? "another task"
      : collision.otherBranches.join(", ");
    return {
      kind: "collision",
      text: `ADR ${collision.number} is also claimed by ${branches}`,
    };
  });
}

/** Choose the short headline for the already-classified decision. */
function headlineFor(
  statusKind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  trunk: string,
  nowMs: number,
): string {
  if (entry.contained_in !== undefined) {
    return `Work continues in ${entry.contained_in}`;
  }
  switch (statusKind) {
    case "broken":
      return "Setup incomplete";
    case "setup-incomplete":
      return "Setup needs recovery";
    case "unreadable":
      return "Git state unreadable";
    case "failed": {
      const action = entry.last_action;
      if (action?.outcome === "partial") {
        return `${discernCommand(action.verb)} completed only part of the work`;
      }
      return action?.failed_stage === undefined
        ? `${discernCommand(action?.verb)} failed`
        : `Checks failed: ${action.failed_stage}`;
    }
    case "blocked":
      return `${discernCommand(entry.last_action?.verb)} was refused`;
    case "behind":
      return `Update from ${trunk} needed`;
    case "ready":
      return "Ready for review";
    case "running": {
      const running = entry.running;
      return running === undefined
        ? "Work is active"
        : `Running ${discernCommand(running.verb)} · ${
          compactDuration(running.elapsed_ms)
        }`;
    }
    case "stale": {
      const age = relativeAge(entry.last_activity, nowMs);
      return age === "—"
        ? "Unlanded work has no recorded activity"
        : `Unlanded work was last active ${age}`;
    }
    case "in-progress":
      return "Uncommitted work is paused";
    case "proof-unreadable":
      return "Proof is unreadable";
    case "proof-unavailable":
      return "Proof state is unavailable";
    case "proof-stale":
      return "Final checks are stale";
    case "needs-gate":
      return "Final checks needed";
    case "idle":
      return "No work to review";
  }
}

/** Name the next unmet condition without claiming an unobserved session. */
function nextConditionDetail(
  statusKind: FleetRowStatusKind,
  entry: StatusFleetEntry,
): DeskDetail | undefined {
  if (entry.contained_in !== undefined) {
    return {
      kind: "next_condition",
      text: "This checkout can be reclaimed without deleting its branch",
    };
  }
  const text = ((): string | undefined => {
    switch (statusKind) {
      case "failed":
        return "Resolve the failure before rerunning discern done";
      case "blocked":
        return "Complete the refused command's named prerequisite";
      case "behind":
        return "Update this task before review";
      case "stale":
        return "Choose whether to resume or discard this task";
      case "in-progress":
        return "Commit or discard the uncommitted work before final checks";
      case "proof-unreadable":
        return "Repair the Proof state or rerun discern done";
      case "proof-unavailable":
      case "proof-stale":
      case "needs-gate":
        return "Run discern done from this task";
      case "broken":
      case "setup-incomplete":
      case "unreadable":
      case "ready":
      case "running":
      case "idle":
        return undefined;
    }
  })();
  return text === undefined ? undefined : { kind: "next_condition", text };
}

/** All observed facts available to the action registry's pure predicates. */
export interface DeskActionFacts {
  readonly entry: StatusFleetEntry;
  readonly effortGranted: boolean;
  readonly scripts: readonly DeskProjectScript[];
  readonly scriptsUnavailableReason?: string;
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
  readonly statusKind: FleetRowStatusKind;
  readonly collisions: readonly DeskCollision[];
  readonly trunk: string;
}

/** A shared running-operation refusal for actions that cannot safely overlap. */
function runningReason(
  availableWhileRunning: boolean,
  facts: DeskActionFacts,
): string | undefined {
  return facts.entry.running !== undefined &&
      !availableWhileRunning
    ? `${discernCommand(facts.entry.running.verb)} is running.${
      facts.entry.running.typical_duration_ms === undefined
        ? ""
        : ` It usually takes ${
          compactDuration(facts.entry.running.typical_duration_ms)
        }.`
    }`
    : undefined;
}

/** Shared clean, committed, ahead-of-trunk preconditions for review actions.
 * `provenBehindLands` is Accept's routing rule: honored Proof makes a moved
 * trunk composable by the landing itself, so behind stops only unproven work
 * (done must still start up to date). */
function committedWorkReason(
  facts: DeskActionFacts,
  provenBehindLands = false,
): string | undefined {
  const { entry } = facts;
  if (entry.behind === UNKNOWN_GIT_COUNT || entry.ahead === UNKNOWN_GIT_COUNT) {
    return `Git divergence from ${facts.trunk} is unknown.`;
  }
  const behindBlocks = !provenBehindLands ||
    entry.gate_proof?.status !== "honored";
  if (
    behindBlocks && entry.behind !== undefined &&
    isPositiveGitCount(entry.behind)
  ) {
    return `${plural(entry.behind, "commit")} behind ${facts.trunk}.`;
  }
  if (entry.clean !== true) {
    return entry.clean === false
      ? "Commit or discard the uncommitted changes first."
      : "Worktree cleanliness is unknown.";
  }
  return entry.ahead !== undefined && isPositiveGitCount(entry.ahead)
    ? undefined
    : `No commits are ahead of ${facts.trunk}.`;
}

/** The first exact configured capability failure, when there is one. */
function capabilityReason(facts: DeskActionFacts): string | undefined {
  return facts.capabilityError;
}

/** Whether at least one configured agent command can run. */
function hasAvailableAgent(facts: DeskActionFacts): boolean {
  return facts.agentLaunches.some((launch) =>
    launch.availability !== "disabled"
  );
}

/** Whether at least one project-authored script can run. */
function hasAvailableScript(facts: DeskActionFacts): boolean {
  return facts.scripts.some((script) => script.availability !== "disabled");
}

/** One static consequence record without repeated mutable arrays. */
function consequences(
  keeps: readonly string[],
  changes: readonly string[],
  removes: readonly string[],
  recoverable: readonly string[],
): DeskConsequence {
  return { keeps, changes, removes, recoverable };
}

const NO_CONFIRMATION = { kind: "none" } as const;

/**
 * The single action-fact authority. Menu labels, command evidence, availability,
 * recommendations, consequence accounts, and confirmation defaults all derive
 * from this exhaustive registry.
 */
export const DESK_ACTION_REGISTRY = {
  recovery: {
    group: "work",
    availableWhileRunning: true,
    label: (_context: DeskActionLabelContext): string => "Show recovery steps",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "status", "--all"],
      workingDirectory: "main",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Checkout, branch, resources, task metadata, grant, and Proof"],
        [],
        [],
        ["Diagnosis is read-only"],
      ),
    confirmation: NO_CONFIRMATION,
    availability: (facts: DeskActionFacts): string | undefined =>
      isUnhealthy(facts.entry)
        ? undefined
        : "This task has no degraded state to diagnose.",
  },
  retry_setup: {
    group: "manage",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string => "Retry setup",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "setup"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Checkout, branch, task metadata, grant, and Proof"],
        ["Resume safe setup steps and verify the setup-ready marker"],
        [],
        ["Completed setup steps remain recorded and are not rerun"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Retry",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      retrySetupAvailability(facts.entry),
  },
  done: {
    group: "work",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string => "Run final checks",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "done"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Branch and checkout"],
        [
          "Generated or formatted files may change",
          "A passing run records Proof",
        ],
        [],
        ["Review any changed files before committing"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Cancel",
      yesLabel: "Run",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      finalChecksAvailability(facts.entry, committedWorkReason(facts)),
  },
  accept: {
    group: "review",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string => "Accept",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "accept"],
      workingDirectory: "task",
    }),
    consequence: (context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Committed history on the trunk"],
        [`Fast-forward ${context.trunk} and converge its checkout`],
        ["Task checkout", `Branch ${context.branch}`, "Task-local resources"],
        ["Landing records Proof in Git notes before cleanup"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Land",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "The task is not healthy enough to land. Follow its recovery steps first.",
        committedWorkReason(facts, true),
      ),
  },
  update: {
    group: "manage",
    availableWhileRunning: false,
    label: ({ trunk }: DeskActionLabelContext): string =>
      `Update branch from ${trunk}`,
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "update"],
      workingDirectory: "task",
    }),
    consequence: (context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Task branch and checkout"],
        [
          `Merge ${context.trunk} into ${context.branch}`,
          "Refresh generated files",
        ],
        [],
        ["A merge conflict is aborted before the task is returned"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Update",
    },
    availability: (facts: DeskActionFacts): string | undefined => {
      if (isUnhealthy(facts.entry)) {
        return "Git state is not healthy enough to update. Follow the task's recovery steps first.";
      }
      if (facts.entry.behind === UNKNOWN_GIT_COUNT) {
        return `Git divergence from ${facts.trunk} is unknown.`;
      }
      return facts.entry.behind !== undefined &&
          isPositiveGitCount(facts.entry.behind)
        ? undefined
        : `The branch is not behind ${facts.trunk}.`;
    },
  },
  agent: {
    group: "work",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string =>
      "Start or resume agent",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["<configured-agent>"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Desk session and task state"],
        ["The selected agent may change files in this task"],
        [],
        ["Exit the agent to return to the desk"],
      ),
    confirmation: NO_CONFIRMATION,
    availability: (facts: DeskActionFacts): string | undefined => {
      if (isUnhealthy(facts.entry)) {
        return "Follow the task's recovery steps before launching an agent.";
      }
      const capability = capabilityReason(facts);
      if (capability !== undefined) return capability;
      if (hasAvailableAgent(facts)) return undefined;
      const reason = facts.agentLaunches.find((launch) =>
        launch.availability === "disabled"
      )?.reason;
      return reason ??
        "No agent is configured for this task. Add one under [project].agents in discern.toml.";
    },
  },
  follow_up: {
    group: "work",
    availableWhileRunning: true,
    label: (_context: DeskActionLabelContext): string =>
      "Start a follow-up from this task",
    command: (context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "start", "--from", context.branch],
      workingDirectory: "main",
    }),
    consequence: (context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Current task checkout and branch"],
        [`Create a new task from the committed tip of ${context.branch}`],
        [],
        ["The follow-up has its own worktree and branch"],
      ),
    confirmation: NO_CONFIRMATION,
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow the task's recovery steps before starting a follow-up.",
      ),
  },
  scripts: {
    group: "work",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string => "Project Scripts",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "scripts", "<name>"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Desk session"],
        ["The selected project-authored script may change project state"],
        [],
        ["The desk re-surveys the task after the script exits"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Cancel",
      yesLabel: "Run",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      (isUnhealthy(facts.entry)
        ? "Follow the task's recovery steps before running a Project Script."
        : capabilityReason(facts)) ??
        (hasAvailableScript(facts)
          ? undefined
          : facts.scriptsUnavailableReason ??
            "No Project Scripts are available in this task."),
  },
  jump: {
    group: "work",
    availableWhileRunning: true,
    label: (_context: DeskActionLabelContext): string => "Open a shell",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["<user-shell>"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Desk session and task state"],
        ["Shell commands may change this task"],
        [],
        ["Exit the shell to return to the desk"],
      ),
    confirmation: NO_CONFIRMATION,
    availability: (facts: DeskActionFacts): string | undefined =>
      facts.entry.filesystem?.state === "directory"
        ? undefined
        : `The checkout directory is ${
          facts.entry.filesystem?.state ?? "unavailable"
        }.`,
  },
  inspect: {
    group: "review",
    availableWhileRunning: true,
    label: (_context: DeskActionLabelContext): string => "Review changes",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["git", "diff"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["All task state"],
        [],
        [],
        ["Review is read-only"],
      ),
    confirmation: NO_CONFIRMATION,
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow the task's recovery steps before reviewing Proof and changes.",
      ),
  },
  rename: {
    group: "manage",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string => "Change task title",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "rename", "<title>"],
      workingDirectory: "task",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Worktree id, branch, path, brief, and creation source"],
        ["Update the human display title"],
        [],
        ["A later title change can replace it"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Change",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow the task's recovery steps before changing the title.",
      ),
  },
  grant: {
    group: "manage",
    // The marker writer and acceptance claim share an atomic linearization
    // point, so a Gate run cannot make this human authority choice unsafe.
    availableWhileRunning: true,
    label: (_context: DeskActionLabelContext): string =>
      "Pre-authorize landing",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "desk"],
      workingDirectory: "main",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Task and branch"],
        ["Authorize a later submitted green revision to land without a further conversation"],
        [],
        [
          "Revoke the grant from this task before it lands",
          "A variance, a standard proposal, or an emergency still needs you",
        ],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Allow",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      isUnhealthy(facts.entry)
        ? "The task is not healthy enough to receive landing authority."
        : facts.effortGranted
        ? "This task is already pre-authorized to land once green."
        : undefined,
  },
  revoke_grant: {
    group: "manage",
    availableWhileRunning: true,
    label: (_context: DeskActionLabelContext): string =>
      "Revoke pre-authorization",
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "desk"],
      workingDirectory: "main",
    }),
    consequence: (_context: DeskActionLabelContext): DeskConsequence =>
      consequences(
        ["Task and branch"],
        ["Remove this task's landing authority"],
        ["Task landing grant"],
        ["A later desk session can grant authority again"],
      ),
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Revoke",
    },
    availability: (facts: DeskActionFacts): string | undefined =>
      facts.effortGranted
        ? undefined
        : "No task landing pre-authorization is recorded.",
  },
  reclaim: {
    group: "manage",
    availableWhileRunning: false,
    label: ({ containedIn }: DeskActionLabelContext): string =>
      `Reclaim checkout, keep branch (work contained in ${
        containedIn ?? "another live task"
      })`,
    command: (_context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "prune", "--contained"],
      workingDirectory: "main",
    }),
    consequence: reclaimConsequence,
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Reclaim",
    },
    availability: reclaimAvailability,
  },
  park: {
    group: "manage",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string =>
      "Park checkout, keep branch",
    command: (context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "park", context.path],
      workingDirectory: "main",
    }),
    consequence: parkConsequence,
    confirmation: {
      kind: "confirm",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Park",
    },
    availability: parkAvailability,
  },
  drop: {
    group: "danger",
    availableWhileRunning: false,
    label: (_context: DeskActionLabelContext): string => "Drop",
    command: (context: DeskActionLabelContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "drop", context.path],
      workingDirectory: "main",
    }),
    consequence: dropConsequence,
    confirmation: {
      kind: "typed-branch",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Drop",
    },
    availability: (_facts: DeskActionFacts): string | undefined => undefined,
  },
} as const satisfies Readonly<Record<DeskAction, DeskActionMetadata>>;

/** Represent every action once and retain only an enabled recommendation. */
function actionOffers(
  facts: DeskActionFacts,
): { actions: DeskActionOffer[]; recommendedAction?: DeskAction } {
  const actions = DESK_ACTIONS.map((action): DeskActionOffer => {
    const metadata = DESK_ACTION_REGISTRY[action];
    const context: DeskActionLabelContext = {
      trunk: facts.trunk,
      branch: facts.entry.branch,
      path: facts.entry.path,
      proofHonored: facts.entry.gate_proof?.status === "honored",
      taskMetadataRecorded: facts.entry.task?.title_source === "recorded",
      effortGranted: facts.effortGranted,
      proofRecorded: facts.entry.gate_proof !== undefined &&
        facts.entry.gate_proof.status !== "missing" &&
        facts.entry.gate_proof.status !== "unavailable",
      ...(facts.entry.changed_files === undefined
        ? {}
        : { changedFiles: facts.entry.changed_files }),
      ...(facts.entry.ahead === undefined ? {} : { ahead: facts.entry.ahead }),
      resources: Object.values(facts.entry.resources ?? {}),
      ...(facts.entry.contained_in === undefined
        ? {}
        : { containedIn: facts.entry.contained_in }),
    };
    const recommended = false;
    const base: DeskActionOfferBase = {
      action,
      group: metadata.group,
      label: metadata.label(context),
      command: metadata.command(context),
      consequence: metadata.consequence(context),
      confirmation: metadata.confirmation,
    };
    const reason = runningReason(metadata.availableWhileRunning, facts) ??
      metadata.availability(facts);
    if (reason !== undefined) {
      return { ...base, availability: "disabled", recommended: false, reason };
    }
    return {
      ...base,
      availability: "enabled",
      recommended,
    };
  });
  const recommended = actions.find((offer) => offer.recommended);
  return {
    actions,
    ...(recommended === undefined
      ? {}
      : { recommendedAction: recommended.action }),
  };
}

export interface DeskDecisionOptions {
  readonly trunk: string;
  readonly nowMs: number;
  readonly fleetCollisions?: readonly StatusFleetCollision[];
  readonly adrCollisions?: readonly StatusAdrCollision[];
  readonly scripts?: readonly DeskProjectScript[];
  readonly scriptsUnavailableReason?: string;
  readonly agentLaunches?: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
}

/** Build one complete decision from the status survey and desk capabilities. */
export function buildDeskDecision(
  entry: StatusFleetEntry,
  options: DeskDecisionOptions,
): DeskDecision {
  const scripts = options.scripts ?? [];
  const agentLaunches = options.agentLaunches ?? [];
  const presentation = presentFleetRow(entry, {
    trunk: options.trunk,
    nowMs: options.nowMs,
    ...(options.fleetCollisions === undefined
      ? {}
      : { collisions: options.fleetCollisions }),
  });
  const proof = proofFact(
    presentation.proof.status,
    presentation.proof.detail,
    entry.gate_proof?.proof_line ?? entry.proof_line,
  );
  const activity = activityFact(entry, options.nowMs);
  const authority = authorityFact(entry.landing_authority);
  const collisions: DeskCollision[] = [
    ...presentation.collisions.map((collision): DeskChangedFileCollision => ({
      kind: "changed_files",
      otherBranch: collision.branch,
      paths: collision.overlap,
      total: collision.total,
    })),
    ...adrCollisionsFor(entry, options.adrCollisions ?? []),
  ];
  const state = DESK_STATE_BY_STATUS_KIND[presentation.kind];
  const effortGranted = authority.source === "effort-grant" &&
    authority.status === "granted";
  const offers = actionOffers({
    entry,
    effortGranted,
    scripts,
    ...(options.scriptsUnavailableReason === undefined
      ? {}
      : { scriptsUnavailableReason: options.scriptsUnavailableReason }),
    agentLaunches,
    ...(options.capabilityError === undefined
      ? {}
      : { capabilityError: options.capabilityError }),
    statusKind: presentation.kind,
    collisions,
    trunk: options.trunk,
  });
  const details: DeskDetail[] = [];
  if (entry.running !== undefined) {
    details.push({ kind: "activity", text: "active now" });
    if (entry.running.typical_duration_ms !== undefined) {
      details.push({
        kind: "activity",
        text: `Usually ${compactDuration(entry.running.typical_duration_ms)}`,
      });
    }
  }
  details.push(...collisionDetails(collisions));
  details.push(...gitDetails(entry, options.trunk, plural));
  const proofRelevant = entry.ahead === UNKNOWN_GIT_COUNT ||
    (entry.ahead !== undefined && isPositiveGitCount(entry.ahead)) ||
    presentation.kind === "ready" || presentation.kind.startsWith("proof-");
  if (proofRelevant) {
    details.push({
      kind: "proof",
      text: proof.detail === undefined
        ? proof.summary
        : `${proof.summary}: ${proof.detail}`,
    });
  }
  const authorityRelevant = entry.ahead !== undefined &&
      isPositiveGitCount(entry.ahead) ||
    authority.status !== "unknown";
  if (authorityRelevant) {
    details.push({ kind: "authority", text: authority.summary });
  }
  if (entry.contained_in !== undefined) {
    details.push({
      kind: "containment",
      text: `Commits are contained in ${entry.contained_in}`,
    });
  }
  if (entry.running === undefined) {
    details.push({
      kind: "activity",
      text: activeAge(entry.last_activity, options.nowMs),
    });
  }
  const nextCondition = nextConditionDetail(presentation.kind, entry);
  if (nextCondition !== undefined) details.push(nextCondition);
  const needsHumanDecision = state === "needs_attention" ||
    entry.contained_in !== undefined ||
    (state === "ready_to_review" && authority.status !== "granted");
  const recovery = recoveryFact(entry);
  return {
    state,
    statusKind: presentation.kind,
    headline: headlineFor(
      presentation.kind,
      entry,
      options.trunk,
      options.nowMs,
    ),
    details,
    needsHumanDecision,
    landingReady: presentation.landingReady,
    activity,
    proof,
    authority,
    collisions,
    ...(recovery === undefined ? {} : { recovery }),
    actions: offers.actions,
    ...(offers.recommendedAction === undefined
      ? {}
      : { recommendedAction: offers.recommendedAction }),
  };
}

/** Build the complete root-board decision from one canonical status survey. */
export function buildDeskBoardDecision(
  data: StatusData,
  rows: readonly DeskRow[],
): DeskBoardDecision {
  const project = data.project?.trim();
  const mainEntry = (data.fleet ?? []).find((entry) => entry.is_main);
  const main: DeskMainDecision = mainEntry === undefined
    ? {
      state: "unknown",
      headline: "Main checkout state was not reported",
    }
    : mainEntry.clean === true
    ? { state: "clean", headline: `${mainEntry.branch} is clean` }
    : mainEntry.clean === false
    ? {
      state: "changed",
      headline: mainEntry.changed_files === undefined
        ? `${mainEntry.branch} has uncommitted changes`
        : `${mainEntry.branch} has ${
          plural(mainEntry.changed_files, "uncommitted change")
        }`,
    }
    : {
      state: "unknown",
      headline: `${mainEntry.branch} state is unavailable`,
    };
  const notices: DeskBoardNotice[] = [];
  for (const exception of data.emergency_validation ?? []) {
    if (exception.state !== "outstanding") continue;
    notices.push({
      id: "emergency",
      state: "attention",
      headline: "Emergency integration has outstanding validation",
      detail: `${exception.landing_id}: ${exception.reason}`,
      nextAction: exception.next_action,
    });
  }
  const unlanded = data.unlanded_branches ?? [];
  if (unlanded.length > 0) {
    const only = unlanded.length === 1 ? unlanded[0] : undefined;
    notices.push({
      id: "unlanded",
      state: "attention",
      headline: `${plural(unlanded.length, "branch", "branches")} ${
        unlanded.length === 1 ? "has" : "have"
      } no worktree`,
      ...(only === undefined ? {} : { detail: only }),
      nextAction: "Choose a branch under Work without a worktree.",
    });
  }
  const contained = data.contained_refs ?? [];
  if (contained.length > 0) {
    const only = contained.length === 1 ? contained[0] : undefined;
    notices.push({
      id: "contained",
      state: "information",
      headline: `${
        plural(contained.length, "reclaimed branch", "reclaimed branches")
      } ${contained.length === 1 ? "remains" : "remain"} inside live work`,
      ...(only === undefined ? {} : {
        detail:
          `${only.branch} remains inside ${only.contained_in} until it lands`,
      }),
    });
  }
  const reappeared = data.reappeared_worktree_paths ?? [];
  if (reappeared.length > 0) {
    notices.push({
      id: "reappeared",
      state: "attention",
      headline: `${plural(reappeared.length, "removed worktree path")} ${
        reappeared.length === 1 ? "is" : "are"
      } present again`,
      nextAction: "Review with discern worktree prune --dry-run.",
    });
  }
  return {
    project: project === undefined || project === ""
      ? "Project identity unavailable"
      : project,
    main,
    taskCount: rows.length,
    needsPersonCount:
      rows.filter((row) => row.decision.needsHumanDecision).length,
    readyToReviewCount:
      rows.filter((row) => row.decision.state === "ready_to_review").length,
    refreshedAge: "just now",
    notices,
  };
}

/**
 * Derive configured agent commands for one checkout. Committed configuration
 * chooses providers; the live PATH scan chooses which can launch now.
 */
export function buildAgentLaunches(
  config: DiscernConfig,
  detected: readonly DetectedAgentBinary[],
): DeskAgentLaunch[] {
  const detectedByName = new Map(detected.map((item) => [item.name, item]));
  const launches: DeskAgentLaunch[] = [];
  for (const configuredAgent of resolveConfiguredAgents(config)) {
    const provider = providerFor(configuredAgent);
    if (provider === undefined) continue;
    const found = detectedByName.get(provider.name);
    const binary = found?.binary ?? provider.binaries[0] ?? provider.name;
    const reason = found === undefined
      ? `${provider.label} is configured, but ${
        provider.binaries.map((candidate) => `\`${candidate}\``).join(" or ")
      } is not on PATH. Install ${provider.label} or remove it from [project].agents in discern.toml.`
      : undefined;
    for (const action of provider.cli.actions) {
      launches.push({
        id: `${provider.name}:${action.kind}`,
        agent: provider.name,
        providerLabel: provider.label,
        binary,
        kind: action.kind,
        label: action.label,
        args: action.args,
        ...(action.promptArgument === undefined
          ? {}
          : { promptArgument: action.promptArgument }),
        availability: found === undefined ? "disabled" : "enabled",
        ...(reason === undefined ? {} : { reason }),
      });
    }
  }
  return launches;
}

export interface BuildDeskRowsOptions {
  readonly trunk: string;
  readonly nowMs: number;
  readonly fleetCollisions?: readonly StatusFleetCollision[];
  readonly adrCollisions?: readonly StatusAdrCollision[];
  readonly scriptsUnavailableReasons?: ReadonlyMap<string, string>;
  readonly capabilityErrors?: ReadonlyMap<string, string>;
}

/** Build and decision-sort every non-main fleet row. */
export function buildDeskRows(
  fleet: readonly StatusFleetEntry[],
  scriptsByPath: ReadonlyMap<string, readonly DeskProjectScript[]>,
  agentLaunchesByPath: ReadonlyMap<string, readonly DeskAgentLaunch[]>,
  options: BuildDeskRowsOptions,
): DeskRow[] {
  const rows = fleet
    .filter((entry) => !entry.is_main)
    .map((entry): DeskRow => {
      const scripts = scriptsByPath.get(entry.path) ?? [];
      const agentLaunches = agentLaunchesByPath.get(entry.path) ?? [];
      const scriptsUnavailableReason = options.scriptsUnavailableReasons?.get(
        entry.path,
      );
      const capabilityError = options.capabilityErrors?.get(entry.path);
      return {
        entry,
        task: taskLabel(entry),
        scripts,
        agentLaunches,
        ...(capabilityError === undefined ? {} : { capabilityError }),
        decision: buildDeskDecision(entry, {
          trunk: options.trunk,
          nowMs: options.nowMs,
          ...(options.fleetCollisions === undefined
            ? {}
            : { fleetCollisions: options.fleetCollisions }),
          ...(options.adrCollisions === undefined
            ? {}
            : { adrCollisions: options.adrCollisions }),
          scripts,
          ...(scriptsUnavailableReason === undefined
            ? {}
            : { scriptsUnavailableReason }),
          agentLaunches,
          ...(capabilityError === undefined ? {} : { capabilityError }),
        }),
      };
    });
  return rows.sort((left, right) => {
    const leftName = left.task.name.toLowerCase();
    const rightName = right.task.name.toLowerCase();
    return leftName < rightName
      ? -1
      : leftName > rightName
      ? 1
      : deskRowId(left).localeCompare(deskRowId(right), "en");
  });
}

/** Stable identity for navigation and effect targeting, including degraded rows. */
export function deskRowId(row: Pick<DeskRow, "entry">): string {
  return row.entry.id ?? (row.entry.branch || row.entry.path);
}
