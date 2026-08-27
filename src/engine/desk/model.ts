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
import { compactDuration } from "../output.ts";
import type { ProjectScript } from "../project_scripts.ts";
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
  "accept",
  "grant",
  "revoke_grant",
  "update",
  "reclaim",
  "scripts",
  "agent",
  "jump",
  "inspect",
  "drop",
] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];

export type DeskActionGroupId = "landing" | "work" | "review" | "worktree";

interface DeskActionLabelContext {
  readonly trunk: string;
  readonly containedIn?: string;
}

interface DeskActionMetadata {
  readonly group: DeskActionGroupId;
  readonly label: (context: DeskActionLabelContext) => string;
}

/** Action labels and menu placement share one exhaustive metadata table. */
export const DESK_ACTION_METADATA = {
  accept: {
    group: "landing",
    label: ({ trunk }: DeskActionLabelContext): string =>
      `Accept and land on ${trunk}`,
  },
  grant: {
    group: "landing",
    label: (_context: DeskActionLabelContext): string =>
      "Pre-authorize landing once green",
  },
  revoke_grant: {
    group: "landing",
    label: (_context: DeskActionLabelContext): string =>
      "Revoke landing pre-authorization",
  },
  update: {
    group: "landing",
    label: ({ trunk }: DeskActionLabelContext): string =>
      `Update branch from ${trunk}`,
  },
  reclaim: {
    group: "worktree",
    label: ({ containedIn }: DeskActionLabelContext): string =>
      `Reclaim checkout, keep branch (work contained in ${
        containedIn ?? "another live task"
      })`,
  },
  scripts: {
    group: "work",
    label: (_context: DeskActionLabelContext): string => "Run a Project Script",
  },
  agent: {
    group: "work",
    label: (_context: DeskActionLabelContext): string => "Open with an agent",
  },
  jump: {
    group: "work",
    label: (_context: DeskActionLabelContext): string => "Open a shell",
  },
  inspect: {
    group: "review",
    label: (_context: DeskActionLabelContext): string =>
      "Inspect commits and changes",
  },
  drop: {
    group: "worktree",
    label: (_context: DeskActionLabelContext): string =>
      "Drop worktree and branch",
  },
} as const satisfies Readonly<Record<DeskAction, DeskActionMetadata>>;

interface DeskActionOfferBase {
  readonly action: DeskAction;
  readonly group: DeskActionGroupId;
  readonly label: string;
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
  /** Every canonical action, enabled or disabled, exactly once. */
  readonly actions: readonly DeskActionOffer[];
  readonly recommendedAction?: DeskAction;
}

/** One selectable effort and its already-complete decision. */
export interface DeskRow {
  readonly entry: StatusFleetEntry;
  readonly task: DeskTaskLabel;
  readonly scripts: readonly ProjectScript[];
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly decision: DeskDecision;
}

/** Main-checkout state carried by the board decision. */
export interface DeskMainDecision {
  readonly state: "clean" | "changed" | "unknown";
  readonly headline: string;
}

/** One bounded root-level fact that is not a selectable task. */
export interface DeskBoardNotice {
  readonly id: "unlanded" | "contained" | "reappeared";
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

/** Whether the checkout cannot safely support ordinary Desk actions. */
function isUnhealthy(entry: StatusFleetEntry): boolean {
  return entry.broken === true || entry.git_unavailable === true;
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
      ? "Task landing pre-authorization recorded"
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

/** Render observed Git counts with units and the named trunk. */
function gitDetails(entry: StatusFleetEntry, trunk: string): DeskDetail[] {
  if (isUnhealthy(entry)) return [];
  const details: DeskDetail[] = [];
  if (entry.clean === false) {
    details.push({
      kind: "git",
      text: entry.changed_files === undefined
        ? "Uncommitted file count unavailable"
        : plural(entry.changed_files, "uncommitted file"),
    });
  }
  if (entry.ahead === UNKNOWN_GIT_COUNT) {
    details.push({
      kind: "git",
      text: `Ahead count versus ${trunk} unavailable`,
    });
  } else if (entry.ahead !== undefined && isPositiveGitCount(entry.ahead)) {
    details.push({
      kind: "git",
      text: `${plural(entry.ahead, "commit")} ahead of ${trunk}`,
    });
  }
  if (entry.behind === UNKNOWN_GIT_COUNT) {
    details.push({
      kind: "git",
      text: `Behind count versus ${trunk} unavailable`,
    });
  } else if (
    entry.behind !== undefined && isPositiveGitCount(entry.behind)
  ) {
    details.push({
      kind: "git",
      text: `${plural(entry.behind, "commit")} behind ${trunk}`,
    });
  }
  return details;
}

/** Choose the short headline for the already-classified decision. */
function headlineFor(
  statusKind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  collisions: readonly DeskCollision[],
  trunk: string,
  nowMs: number,
): string {
  if (collisions.length > 0) {
    const kinds = new Set(collisions.map((collision) => collision.kind));
    if (collisions.length > 1 || kinds.size > 1) {
      return "Collisions need review";
    }
    const only = collisions[0];
    return only?.kind === "adr"
      ? `ADR ${only.number} is claimed by another task`
      : "Changed-file collision needs review";
  }
  if (entry.contained_in !== undefined) {
    return `Work continues in ${entry.contained_in}`;
  }
  switch (statusKind) {
    case "broken":
      return "Setup incomplete";
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
      case "unreadable":
      case "ready":
      case "running":
      case "idle":
        return undefined;
    }
  })();
  return text === undefined ? undefined : { kind: "next_condition", text };
}

const ACTION_ALLOWED_WHILE_RUNNING = {
  accept: false,
  grant: false,
  revoke_grant: false,
  update: false,
  reclaim: false,
  scripts: false,
  agent: false,
  jump: true,
  inspect: true,
  drop: false,
} as const satisfies Readonly<Record<DeskAction, boolean>>;

interface ActionFacts {
  readonly entry: StatusFleetEntry;
  readonly effortGranted: boolean;
  readonly scripts: readonly ProjectScript[];
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly trunk: string;
}

/** Undefined means enabled; a string is the observed reason it is disabled. */
function disabledReason(
  action: DeskAction,
  facts: ActionFacts,
): string | undefined {
  const { entry } = facts;
  if (isUnhealthy(entry) && action !== "drop") {
    return entry.broken === true
      ? "Setup is incomplete."
      : "Git state is unreadable.";
  }
  if (entry.running !== undefined && !ACTION_ALLOWED_WHILE_RUNNING[action]) {
    return `${discernCommand(entry.running.verb)} is running.`;
  }
  switch (action) {
    case "accept":
      if (entry.behind === UNKNOWN_GIT_COUNT) {
        return `Git divergence from ${facts.trunk} is unknown.`;
      }
      if (entry.behind !== undefined && isPositiveGitCount(entry.behind)) {
        return `${plural(entry.behind, "commit")} behind ${facts.trunk}.`;
      }
      if (entry.clean !== true) {
        return entry.clean === false
          ? "The worktree has uncommitted changes."
          : "Worktree cleanliness is unknown.";
      }
      if (entry.ahead === UNKNOWN_GIT_COUNT) {
        return `Git divergence from ${facts.trunk} is unknown.`;
      }
      return entry.ahead !== undefined && isPositiveGitCount(entry.ahead)
        ? undefined
        : `No commits are ahead of ${facts.trunk}.`;
    case "grant":
      return facts.effortGranted
        ? "This task already has landing pre-authorization."
        : undefined;
    case "revoke_grant":
      return facts.effortGranted
        ? undefined
        : "No task landing pre-authorization is recorded.";
    case "update":
      if (entry.behind === UNKNOWN_GIT_COUNT) {
        return `Git divergence from ${facts.trunk} is unknown.`;
      }
      return entry.behind !== undefined && isPositiveGitCount(entry.behind)
        ? undefined
        : `The branch is not behind ${facts.trunk}.`;
    case "reclaim":
      return entry.contained_in === undefined
        ? "This checkout is not contained in another live task."
        : undefined;
    case "scripts":
      return facts.scripts.length > 0
        ? undefined
        : "No Project Scripts are available in this task.";
    case "agent":
      return facts.agentLaunches.length > 0
        ? undefined
        : "No configured agent is available on PATH for this task.";
    case "jump":
    case "inspect":
    case "drop":
      return undefined;
  }
}

/** Choose the action that addresses the highest-priority observed condition. */
function recommendedActionFor(
  statusKind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  collisions: readonly DeskCollision[],
): DeskAction | undefined {
  if (entry.running !== undefined) return undefined;
  if (collisions.length > 0) return "inspect";
  if (entry.contained_in !== undefined) return "reclaim";
  switch (statusKind) {
    case "behind":
      return "update";
    case "ready":
      return "accept";
    case "failed":
    case "blocked":
    case "in-progress":
    case "proof-unreadable":
    case "proof-unavailable":
    case "proof-stale":
    case "needs-gate":
      return "jump";
    case "broken":
    case "unreadable":
    case "running":
    case "stale":
    case "idle":
      return undefined;
  }
}

/** Represent every action once and retain only an enabled recommendation. */
function actionOffers(
  facts: ActionFacts,
  candidate: DeskAction | undefined,
): { actions: DeskActionOffer[]; recommendedAction?: DeskAction } {
  const actions = DESK_ACTIONS.map((action): DeskActionOffer => {
    const metadata = DESK_ACTION_METADATA[action];
    const base: DeskActionOfferBase = {
      action,
      group: metadata.group,
      label: metadata.label({
        trunk: facts.trunk,
        ...(facts.entry.contained_in === undefined
          ? {}
          : { containedIn: facts.entry.contained_in }),
      }),
    };
    const reason = disabledReason(action, facts);
    if (reason !== undefined) {
      return { ...base, availability: "disabled", recommended: false, reason };
    }
    return {
      ...base,
      availability: "enabled",
      recommended: action === candidate,
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
  readonly scripts?: readonly ProjectScript[];
  readonly agentLaunches?: readonly DeskAgentLaunch[];
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
  const state = collisions.length > 0
    ? "needs_attention"
    : DESK_STATE_BY_STATUS_KIND[presentation.kind];
  const effortGranted = authority.source === "effort-grant" &&
    authority.status === "granted";
  const candidate = recommendedActionFor(
    presentation.kind,
    entry,
    collisions,
  );
  const offers = actionOffers({
    entry,
    effortGranted,
    scripts,
    agentLaunches,
    trunk: options.trunk,
  }, candidate);
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
  details.push(...gitDetails(entry, options.trunk));
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
  const needsHumanDecision = collisions.length > 0 ||
    state === "needs_attention" || entry.contained_in !== undefined ||
    (state === "ready_to_review" && authority.status !== "granted");
  return {
    state,
    statusKind: presentation.kind,
    headline: headlineFor(
      presentation.kind,
      entry,
      collisions,
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
      nextAction:
        "Open a branch with discern start --from <branch> before continuing it.",
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
    if (found === undefined) continue;
    for (const action of provider.cli.actions) {
      launches.push({
        id: `${provider.name}:${action.kind}`,
        agent: provider.name,
        providerLabel: provider.label,
        binary: found.binary,
        kind: action.kind,
        label: action.label,
        args: action.args,
      });
    }
  }
  return launches;
}

/** Most-recent-first by last activity; unknown activity sinks. */
function byActivityDesc(a: StatusFleetEntry, b: StatusFleetEntry): number {
  const at = a.last_activity === undefined ? 0 : Date.parse(a.last_activity);
  const bt = b.last_activity === undefined ? 0 : Date.parse(b.last_activity);
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

export interface BuildDeskRowsOptions {
  readonly trunk: string;
  readonly nowMs: number;
  readonly fleetCollisions?: readonly StatusFleetCollision[];
  readonly adrCollisions?: readonly StatusAdrCollision[];
}

/** Build and decision-sort every non-main fleet row. */
export function buildDeskRows(
  fleet: readonly StatusFleetEntry[],
  scriptsByPath: ReadonlyMap<string, readonly ProjectScript[]>,
  agentLaunchesByPath: ReadonlyMap<string, readonly DeskAgentLaunch[]>,
  options: BuildDeskRowsOptions,
): DeskRow[] {
  const rows = fleet
    .filter((entry) => !entry.is_main)
    .map((entry): DeskRow => {
      const scripts = scriptsByPath.get(entry.path) ?? [];
      const agentLaunches = agentLaunchesByPath.get(entry.path) ?? [];
      return {
        entry,
        task: taskLabel(entry),
        scripts,
        agentLaunches,
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
          agentLaunches,
        }),
      };
    });
  return rows.sort((left, right) => {
    const stateOrder = DESK_STATES.indexOf(left.decision.state) -
      DESK_STATES.indexOf(right.decision.state);
    return stateOrder === 0
      ? byActivityDesc(left.entry, right.entry)
      : stateOrder;
  });
}
