/**
 * The desk's pure decision model.
 *
 * `status` owns observation, row-status precedence, and the row-state
 * vocabulary. The desk consumes that projection, adds only desk capabilities
 * and pairwise collision evidence, and returns everything a renderer needs to
 * explain the state and offer actions. Time and every observed fact are
 * injected so the decision table remains deterministic.
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
  SubmissionRowData,
} from "../../shared/result_schemas.ts";
import type { FleetRowGroup } from "../../shared/fleet_row_vocabulary.ts";
import {
  DESK_ACTION_LABELS,
  DESK_ACTIONS,
  type DeskAction,
  labelName,
} from "../../shared/desk_vocabulary.ts";
import { commandEvidence } from "../../shared/command_evidence.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import type { DetectedAgentBinary } from "../../lib/detect_agents.ts";
import type { AgentName } from "../../lib/config.ts";
import { providerFor } from "../../lib/providers.ts";
import type { AgentCliPromptArgument } from "../../lib/providers.ts";
import { compactDuration } from "../output.ts";
import type { DeskProjectScript } from "../project_scripts.ts";
import {
  compareTaskTitles,
  integrationFor,
  presentFleetRow,
  speaksForAnotherRow,
} from "../status/fleet_rows.ts";
import {
  exceptionArgv,
  exceptionArgvWith,
  type FleetRowIntegration,
  fleetRowProof,
  type FleetRowStatusKind,
  hasExceptionFacts,
  hasExceptionHandOff,
  positiveCount,
  relativeAge,
} from "../status/row_facts.ts";
import { fleetRowGroupRank, type FleetRowTone } from "../status/row_states.ts";
import type { FleetTaskRowStateId } from "../status/row_sentences.ts";
import { taskLabel, type WorktreeTaskLabel } from "../worktree/task_label.ts";
import {
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import {
  type DeskRecoveryFact,
  finalChecksAvailability,
  healthyActionAvailability,
  isUnhealthy,
  parkAvailability,
  reclaimAvailability,
  recoveryFact,
  retrySetupAvailability,
} from "./recovery.ts";
export type { DeskRecoveryFact } from "./recovery.ts";
import { gitDetails } from "./git_details.ts";

export { taskLabel } from "../worktree/task_label.ts";
export { DESK_ACTIONS, type DeskAction } from "../../shared/desk_vocabulary.ts";

/** Menu sections in their fixed presentation order. */
export const DESK_ACTION_SECTIONS = [
  "work",
  "review",
  "manage",
  "danger",
] as const;
export type DeskActionSection = (typeof DESK_ACTION_SECTIONS)[number];

/** Section titles, as the action menu shows them. */
export const DESK_ACTION_SECTION_TITLES = {
  work: "Work",
  review: "Review",
  manage: "Manage",
  danger: "Danger",
} as const satisfies Record<DeskActionSection, string>;

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

/** What a control does to the project when it runs. */
export type DeskEffect =
  /** Reads and shows; changes nothing. */
  | "read"
  /** Hands the terminal to a child that may change the checkout. */
  | "launch"
  /** Changes project, Git, or authority state through a lifecycle core. */
  | "change";

/** The marks a consequence line carries, from evidence to warnings. */
export type DeskConsequenceMark =
  | "evidence"
  | "changes"
  | "removes"
  | "discards"
  | "keeps"
  | "recoverable"
  | "warning";

/**
 * Observed facts a consequence line can depend on. A line with `when` shows
 * only while its fact holds, so a review never claims an effect the task
 * cannot have.
 */
export const DESK_CONSEQUENCE_FACTS = {
  granted: (context: DeskActionContext): boolean => context.effortGranted,
  "not-granted": (context: DeskActionContext): boolean =>
    !context.effortGranted,
  queued: (context: DeskActionContext): boolean => context.queued,
  "proof-honored": (context: DeskActionContext): boolean =>
    context.proofHonored,
  "proof-recorded": (context: DeskActionContext): boolean =>
    context.proofRecorded,
  "metadata-recorded": (context: DeskActionContext): boolean =>
    context.taskMetadataRecorded,
  uncommitted: (context: DeskActionContext): boolean =>
    (context.changedFiles ?? 0) > 0,
  "uncommitted-unknown": (context: DeskActionContext): boolean =>
    context.changedFiles === undefined,
  "unlanded-commits": (context: DeskActionContext): boolean =>
    typeof context.ahead === "number" && context.ahead > 0,
  "unlanded-unknown": (context: DeskActionContext): boolean =>
    context.ahead === UNKNOWN_GIT_COUNT,
  resources: (context: DeskActionContext): boolean =>
    (context.resources?.length ?? 0) > 0,
  "resources-unreadable": (context: DeskActionContext): boolean =>
    context.resources === undefined,
} as const;
export type DeskConsequenceFact = keyof typeof DESK_CONSEQUENCE_FACTS;

/** One declared consequence: its mark, its words, and the fact it needs. */
export interface DeskConsequenceItem {
  readonly mark: DeskConsequenceMark;
  readonly text: string | ((context: DeskActionContext) => string);
  readonly when?: DeskConsequenceFact;
}

/** One consequence line as a review shows it for the observed task. */
export interface DeskConsequenceLine {
  readonly mark: DeskConsequenceMark;
  readonly text: string;
}

/**
 * What a review captures as `expected` and the effect boundary compares
 * before applying: a mismatch refuses the apply and asks for a fresh review.
 */
export type DeskBindingFact =
  | "worktree-identity"
  | "path"
  | "branch"
  | "branch-head"
  | "trunk-head"
  | "authority"
  | "queue-walk"
  | "plan"
  | "challenge"
  | "clean"
  | "dirty-stamp"
  | "grant-absent"
  | "grant-record"
  | "grant-and-queue"
  | "contained-tip"
  | "setup-step"
  | "title"
  | "script-path"
  | "script-digest"
  | "argv"
  | "main-path"
  | "base-commit"
  | "base-head"
  | "branch-name"
  | "parked-record"
  | "parked-head"
  | "running-version";

/** The observed task facts a label, summary, consequence, or command reads. */
export interface DeskActionContext {
  readonly trunk: string;
  /** The task's display title. */
  readonly title: string;
  readonly branch: string;
  readonly path: string;
  readonly proofHonored: boolean;
  readonly containedIn?: string;
  readonly taskMetadataRecorded: boolean;
  readonly effortGranted: boolean;
  readonly proofRecorded: boolean;
  readonly queued: boolean;
  /** Absent when the uncommitted file count is unknown. */
  readonly changedFiles?: number;
  readonly ahead?: number | "unknown";
  readonly behind?: number | "unknown";
  /** Absent when the env files recording the handles cannot be read. */
  readonly resources?: readonly string[];
}

/** One registered task action's complete contract. */
export interface DeskActionMetadata {
  readonly section: DeskActionSection;
  /** The one label; it ends with an ellipsis exactly when the action asks
   * for a confirmation or more input before it runs. */
  readonly label: string;
  /** A shorter footer form, only where the label cannot fit. */
  readonly short?: string;
  /** The task-layer mnemonic; one Shift costs a destructive action. */
  readonly key?: string;
  /** Whether the action asks for values (a form or a title) before it runs. */
  readonly parameters: boolean;
  readonly effect: DeskEffect;
  /** Whether this action's real effect boundary remains valid while status
   * reports another operation in this task. Applied centrally to every action. */
  readonly availableWhileRunning: boolean;
  /** Row states whose next step (Enter) this action is. */
  readonly next: readonly FleetTaskRowStateId[];
  /** Row states that offer this action beside their next step. */
  readonly also: readonly FleetTaskRowStateId[];
  /** One line for the menu detail and the next-step block. */
  readonly summary: (context: DeskActionContext) => string;
  /** The question a review of this action asks. */
  readonly reviewTitle: (context: DeskActionContext) => string;
  readonly command: (context: DeskActionContext) => DeskCommandEvidence;
  readonly consequence: readonly DeskConsequenceItem[];
  readonly confirmation: DeskConfirmationPolicy;
  /** What a review binds; empty only for actions that read. */
  readonly binding: readonly DeskBindingFact[];
  readonly availability: (facts: DeskActionFacts) => string | undefined;
}

interface DeskActionOfferBase {
  readonly action: DeskAction;
  readonly section: DeskActionSection;
  readonly key?: string;
  readonly label: string;
  readonly summary: string;
  readonly reviewTitle: string;
  readonly command: DeskCommandEvidence;
  readonly consequence: readonly DeskConsequenceLine[];
  readonly confirmation: DeskConfirmationPolicy;
}

export interface EnabledDeskAction extends DeskActionOfferBase {
  readonly availability: "enabled";
}

export interface DisabledDeskAction extends DeskActionOfferBase {
  readonly availability: "disabled";
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
  | "queue"
  | "collision"
  | "containment";

export interface DeskDetail {
  readonly kind: DeskDetailKind;
  readonly text: string;
}

export interface DeskProofFact {
  readonly status: GateProofCheckStatus;
  readonly honored: boolean;
  /** The recorded checks in human words: "Passed 20m ago", "None yet". */
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
  readonly status: "granted" | "needs_approval";
  readonly source?: NonNullable<LandingAuthorityData["source"]>;
  /** Landing authority in human words; absent when it cannot be known. */
  readonly summary?: string;
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
  /** The status kind that supplied this decision's base meaning. */
  readonly statusKind: FleetRowStatusKind;
  /** Status's row state, and everything every surface shows for it. */
  readonly state: FleetTaskRowStateId;
  readonly group: FleetRowGroup;
  /** The state's label, with the queue place when it has one. */
  readonly label: string;
  readonly glyph: string;
  readonly ascii: string;
  readonly tones: {
    readonly glyph: FleetRowTone;
    readonly label: FleetRowTone;
  };
  readonly qualifier?: string;
  /** What is true and who moves next, without commands. */
  readonly explanation: string;
  readonly details: readonly DeskDetail[];
  readonly activity: DeskActivityFact;
  readonly proof: DeskProofFact;
  readonly authority: DeskAuthorityFact;
  readonly collisions: readonly DeskCollision[];
  readonly recovery?: DeskRecoveryFact;
  /** Every canonical action, enabled or disabled, exactly once. */
  readonly actions: readonly DeskActionOffer[];
  /** The state's next step (Enter), enabled or not. */
  readonly next?: DeskActionOffer;
  /** The state's other keyed steps that are available now, at most three. */
  readonly also: readonly EnabledDeskAction[];
}

/** The observation facts a decision is built from, beyond its own row. */
export interface DeskObservationContext {
  readonly trunk: string;
  readonly nowMs: number;
  readonly fleetCollisions?: readonly StatusFleetCollision[];
  readonly adrCollisions?: readonly StatusAdrCollision[];
  /** The landing queue, so a queued task reads its place and authority. */
  readonly queue?: readonly SubmissionRowData[];
  /** The whole fleet, so a landing's integration copy speaks for its task. */
  readonly fleet?: readonly StatusFleetEntry[];
  readonly mainCheckout?: DeskMainCheckoutFacts;
  /** Exact exception hand-off commands by branch (`deskExceptionArgvs`). */
  readonly exceptionArgvs?: ReadonlyMap<string, readonly string[]>;
}

/** The main checkout's facts that decide whether a landing can start. */
export interface DeskMainCheckoutFacts {
  /** False when tracked changes would make a landing refuse. */
  readonly clean?: boolean;
  /** True when generated files on main are out of date. */
  readonly pendingRefresh: boolean;
}

/** One selectable effort and its already-complete decision. */
export interface DeskRow {
  readonly entry: StatusFleetEntry;
  readonly task: DeskTaskLabel;
  readonly scripts: readonly DeskProjectScript[];
  readonly scriptsUnavailableReason?: string;
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
  /** The observation this row's decision was built from. */
  readonly observation: DeskObservationContext;
  readonly decision: DeskDecision;
}

/** Discovery owns capabilities; status keeps authority over task and Proof facts. */
export type DeskCapabilities = Pick<
  DeskRow,
  "scripts" | "scriptsUnavailableReason" | "agentLaunches" | "capabilityError"
>;

/** Apply discovered capabilities to the latest observed task before deriving offers. */
export function withDeskCapabilities(
  row: DeskRow,
  inventory: DeskCapabilities,
  nowMs: number,
): DeskRow {
  const observation = { ...row.observation, nowMs };
  return {
    entry: row.entry,
    task: row.task,
    scripts: inventory.scripts,
    agentLaunches: inventory.agentLaunches,
    ...(inventory.scriptsUnavailableReason === undefined ? {} : {
      scriptsUnavailableReason: inventory.scriptsUnavailableReason,
    }),
    ...(inventory.capabilityError === undefined ? {} : {
      capabilityError: inventory.capabilityError,
    }),
    observation,
    decision: buildDeskDecision(row.entry, {
      ...observation,
      agentLaunches: inventory.agentLaunches,
      ...(inventory.capabilityError === undefined
        ? {}
        : { capabilityError: inventory.capabilityError }),
    }),
  };
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

/** All observed facts available to the action registry's pure predicates. */
export interface DeskActionFacts {
  readonly entry: StatusFleetEntry;
  /** Status's row state for this task. */
  readonly state: FleetTaskRowStateId;
  readonly effortGranted: boolean;
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
  readonly trunk: string;
  readonly mainCheckout?: DeskMainCheckoutFacts;
  /** The integration copy that speaks for this task, when one does. */
  readonly integration?: FleetRowIntegration;
  /** The exact exception hand-off, when the observation computed it. */
  readonly exceptionArgv?: readonly string[];
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

/** Clean, committed, up-to-date preconditions for running final checks. */
function committedWorkReason(facts: DeskActionFacts): string | undefined {
  const { entry } = facts;
  if (entry.behind === UNKNOWN_GIT_COUNT || entry.ahead === UNKNOWN_GIT_COUNT) {
    return `Git divergence from ${facts.trunk} is unknown.`;
  }
  if (entry.behind !== undefined && isPositiveGitCount(entry.behind)) {
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

/**
 * The landable facts a landing or a queue entry requires: an honored Proof on
 * a clean branch with commits ahead. A moved trunk does not block proven work,
 * because the landing combines it; unproven work behind needs an update first.
 */
function landableReason(facts: DeskActionFacts): string | undefined {
  const { entry } = facts;
  if (entry.behind === UNKNOWN_GIT_COUNT || entry.ahead === UNKNOWN_GIT_COUNT) {
    return `Git divergence from ${facts.trunk} is unknown.`;
  }
  if (entry.clean !== true) {
    return entry.clean === false
      ? "Commit or discard the uncommitted changes first."
      : "Worktree cleanliness is unknown.";
  }
  if (entry.ahead === undefined || !isPositiveGitCount(entry.ahead)) {
    return `No commits are ahead of ${facts.trunk}.`;
  }
  if (fleetRowProof(entry).status === "honored") return undefined;
  const behind = positiveCount(entry.behind);
  return behind === undefined
    ? "Run checks first."
    : `${
      plural(behind, "commit")
    } behind ${facts.trunk}. Update it, then run checks.`;
}

/** The owner's exception hand-off: landing needs a decision only the CLI
 * records today, so the reason carries the exact command, or names the
 * command that serves the decision when the facts cannot name it. */
function exceptionReason(facts: DeskActionFacts): string | undefined {
  const proofData = facts.entry.gate_proof?.proof_data;
  if (facts.state !== "exception" && !hasExceptionFacts(proofData)) {
    return undefined;
  }
  const judgment = facts.integration?.awaiting_judgment === true
    ? facts.integration.judgment
    : undefined;
  if (!hasExceptionHandOff(proofData, judgment)) {
    return `Needs your exception, which the desk can't record yet. Run in a terminal: ${
      commandEvidence(["discern", "accept", "--target", facts.entry.branch])
    }. It serves the exact decision to record.`;
  }
  const argv = facts.exceptionArgv ??
    exceptionArgvWith(
      facts.entry.branch,
      proofData,
      (proofData?.standard_proposals ?? []).map(() => "<standard-token>"),
      judgment,
    );
  return `Needs your exception, which the desk can't record yet. Run in a terminal: ${
    commandEvidence(argv)
  }`;
}

/** A retained landing copy waiting on the agent's checkpoint answers: a
 * landing or a queue entry would only serve the question again. */
function awaitedDeclarationReason(
  facts: DeskActionFacts,
): string | undefined {
  return facts.integration?.awaiting_judgment === true &&
      facts.integration.judgment?.decision === "declaration"
    ? "Its landing waits for its agent's checkpoint answers about the combined code."
    : undefined;
}

/** Landing refuses while main has tracked changes or stale generated files. */
function mainCheckoutReason(facts: DeskActionFacts): string | undefined {
  const main = facts.mainCheckout;
  if (main?.clean === false) {
    return `${facts.trunk} has uncommitted tracked changes, so landing would refuse. Clean it first from Main checkout.`;
  }
  return main?.pendingRefresh === true
    ? `${facts.trunk} has generated files out of date, so landing would refuse. Refresh them first from Main checkout.`
    : undefined;
}

/** Whether at least one configured agent command can run. */
function hasAvailableAgent(facts: DeskActionFacts): boolean {
  return facts.agentLaunches.some((launch) =>
    launch.availability !== "disabled"
  );
}

/** `4 commits`, or `its commits` when the count is unknown. */
function commitsOf(context: DeskActionContext): string {
  return typeof context.ahead === "number" && context.ahead > 0
    ? plural(context.ahead, "commit")
    : "its commits";
}

/** A no-default confirmation with its safe and effect buttons. */
function confirm(noLabel: string, yesLabel: string): DeskConfirmationPolicy {
  return { kind: "confirm", defaultTo: false, noLabel, yesLabel };
}

/** One consequence line, optionally shown only while a fact holds. */
function line(
  mark: DeskConsequenceMark,
  text: DeskConsequenceItem["text"],
  when?: DeskConsequenceFact,
): DeskConsequenceItem {
  return { mark, text, ...(when === undefined ? {} : { when }) };
}

const NO_CONFIRMATION = { kind: "none" } as const;
const ACCEPT_NAME = labelName(DESK_ACTION_LABELS.accept);

/** The cleanup lines Park, Reclaim, and Drop share. */
const ENDS_AUTHORITY = [
  line("removes", "Ends its pre-authorization", "granted"),
  line("removes", "Leaves the landing queue", "queued"),
] as const;
const ENDS_RESOURCES = [
  line("removes", "Destroys its ports and services", "resources"),
  line(
    "warning",
    "Its recorded ports and services can't be read",
    "resources-unreadable",
  ),
] as const;
const ENDS_RECORDS = [
  line("removes", "Removes its title and brief", "metadata-recorded"),
  line("removes", "Removes its Proof", "proof-recorded"),
] as const;

/**
 * The single action-fact authority. Labels, keys, next steps, command
 * evidence, availability, consequences, bindings, and confirmation defaults
 * all derive from this exhaustive registry.
 */
export const DESK_ACTION_REGISTRY = {
  recovery: {
    section: "work",
    label: DESK_ACTION_LABELS.recovery,
    parameters: false,
    effect: "read",
    availableWhileRunning: true,
    next: [
      "broken",
      "unreadable",
      "setup-manual",
      "setup-unknown",
      "interrupted",
    ],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Read what failed and the command that repairs it",
    reviewTitle: (context: DeskActionContext): string =>
      `Recovery steps for ${context.title}`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "status", "--all"],
      workingDirectory: "main",
    }),
    consequence: [line("keeps", "Nothing changes; the steps only read")],
    confirmation: NO_CONFIRMATION,
    binding: [],
    availability: (facts: DeskActionFacts): string | undefined =>
      isUnhealthy(facts.entry)
        ? undefined
        : "This task has nothing to recover.",
  },
  retry_setup: {
    section: "manage",
    label: DESK_ACTION_LABELS.retry_setup,
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["setup-retry"],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Resume setup from the step that failed",
    reviewTitle: (context: DeskActionContext): string =>
      `Retry setup for ${context.title}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "setup"],
      workingDirectory: "task",
    }),
    consequence: [
      line("changes", "Resumes setup from the step that failed"),
      line("keeps", "Finished steps are skipped"),
    ],
    confirmation: confirm("Keep", "Retry"),
    binding: ["setup-step", "worktree-identity"],
    availability: (facts: DeskActionFacts): string | undefined =>
      retrySetupAvailability(facts.entry),
  },
  done: {
    section: "work",
    label: DESK_ACTION_LABELS.done,
    key: "c",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["proof-error", "proof-unknown", "recheck", "needs-checks"],
    also: ["checks-failed"],
    summary: (_context: DeskActionContext): string =>
      "Run this project's checks on the committed work",
    reviewTitle: (context: DeskActionContext): string =>
      `Run checks on ${context.title}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "done"],
      workingDirectory: "task",
    }),
    consequence: [
      line(
        "changes",
        "Runs this project's checks here: fix, then check and test",
      ),
      line(
        "changes",
        "Fixers may rewrite files; a pass records Proof for this commit",
      ),
      line("keeps", "Keeps the branch and checkout"),
      line("recoverable", "Review any changed files before committing"),
    ],
    confirmation: confirm("Cancel", "Run"),
    binding: ["branch-head", "dirty-stamp"],
    availability: (facts: DeskActionFacts): string | undefined =>
      finalChecksAvailability(facts.entry, committedWorkReason(facts)),
  },
  accept: {
    section: "review",
    label: DESK_ACTION_LABELS.accept,
    key: "l",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["ready", "awaiting-owner", "approved", "queued"],
    also: ["stale-proven"],
    summary: (context: DeskActionContext): string =>
      `Review, then land ${commitsOf(context)} on ${context.trunk}`,
    reviewTitle: (context: DeskActionContext): string =>
      `Land ${context.title} on ${context.trunk}?`,
    command: (context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "accept", "--target", context.branch, "--confirmed"],
      workingDirectory: "main",
    }),
    consequence: [
      line(
        "changes",
        (context) => `Lands ${commitsOf(context)} on ${context.trunk}`,
      ),
      line(
        "changes",
        (context) =>
          `If ${context.trunk} moved, landing combines it in a separate copy and reruns every check first; if that fails, nothing lands`,
      ),
      line("changes", "Then lands other queued work that is pre-authorized"),
      line("removes", "Removes its checkout and branch"),
      ...ENDS_RESOURCES,
      line(
        "keeps",
        (context) => `Keeps the Proof, recorded on ${context.trunk}`,
      ),
    ],
    confirmation: confirm("Keep", "Land"),
    binding: ["branch-head", "trunk-head", "authority", "queue-walk"],
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow its recovery steps before landing it.",
        awaitedDeclarationReason(facts) ?? exceptionReason(facts) ??
          landableReason(facts) ?? mainCheckoutReason(facts),
      ),
  },
  submit: {
    section: "review",
    label: DESK_ACTION_LABELS.submit,
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: [],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Record this version so it lands with the next landing",
    reviewTitle: (context: DeskActionContext): string =>
      `Queue ${context.title} for landing?`,
    command: (context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "accept", "queue", "--target", context.branch],
      workingDirectory: "main",
    }),
    consequence: [
      line("warning", "Asks you to pre-authorize it first", "not-granted"),
      line("changes", "Records this version in the landing queue"),
      line(
        "changes",
        `It lands with any landing, or when you choose ${ACCEPT_NAME}; nothing starts now`,
      ),
      line("keeps", "Keeps its checks, branch and checkout"),
    ],
    confirmation: confirm("Cancel", "Queue"),
    binding: ["branch-head", "worktree-identity"],
    availability: (facts: DeskActionFacts): string | undefined =>
      // Queue-only admission records no exception: it refuses any owner
      // decision, so an exception is handed off exactly as a landing is.
      healthyActionAvailability(
        facts.entry,
        "Follow its recovery steps before queueing it.",
        awaitedDeclarationReason(facts) ?? exceptionReason(facts) ??
          landableReason(facts),
      ),
  },
  update: {
    section: "manage",
    label: DESK_ACTION_LABELS.update,
    key: "u",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["behind"],
    also: ["land-failed"],
    summary: (context: DeskActionContext): string =>
      typeof context.behind === "number" && context.behind > 0
        ? `Bring ${
          plural(context.behind, "new commit")
        } from ${context.trunk} into this branch`
        : `Bring ${context.trunk} into this branch`,
    reviewTitle: (context: DeskActionContext): string =>
      `Update ${context.title} from ${context.trunk}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "update"],
      workingDirectory: "task",
    }),
    consequence: [
      line(
        "changes",
        (context) =>
          typeof context.behind === "number" && context.behind > 0
            ? `Merges ${
              plural(context.behind, "commit")
            } from ${context.trunk} and refreshes generated files`
            : `Merges ${context.trunk} and refreshes generated files`,
      ),
      line("changes", "Refreshes this task's setup"),
      line(
        "recoverable",
        "A conflict is aborted and the branch is left as it was",
      ),
      line(
        "warning",
        (context) =>
          `You don't need this to land: ${ACCEPT_NAME} combines ${context.trunk} itself. Updating makes the current checks outdated`,
        "proof-honored",
      ),
    ],
    confirmation: confirm("Keep", "Update"),
    binding: ["branch-head", "trunk-head"],
    availability: (facts: DeskActionFacts): string | undefined => {
      if (isUnhealthy(facts.entry)) {
        return "Follow its recovery steps before updating it.";
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
    section: "work",
    label: DESK_ACTION_LABELS.agent,
    key: "a",
    parameters: false,
    effect: "launch",
    // Project code holds no exclusion boundary: an agent may look in while a
    // discern command runs in its task.
    availableWhileRunning: true,
    next: [
      "checks-failed",
      "land-failed",
      "failed",
      "refused",
      "editing",
      "empty",
    ],
    also: [
      "checking",
      "updating",
      "running",
      "stale",
      "behind",
      "recheck",
      "needs-checks",
      "idle-unknown",
    ],
    summary: (_context: DeskActionContext): string =>
      "Open a coding agent in this task's checkout",
    reviewTitle: (context: DeskActionContext): string =>
      `Open agent in ${context.title}`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["<configured-agent>"],
      workingDirectory: "task",
    }),
    consequence: [
      line(
        "changes",
        "The agent works in this checkout and may change its files",
      ),
      line("keeps", "The desk waits until the agent exits"),
    ],
    confirmation: NO_CONFIRMATION,
    binding: ["worktree-identity", "path"],
    availability: (facts: DeskActionFacts): string | undefined => {
      if (isUnhealthy(facts.entry)) {
        return "Follow its recovery steps before opening an agent.";
      }
      if (facts.capabilityError !== undefined) return facts.capabilityError;
      if (hasAvailableAgent(facts)) return undefined;
      const reason = facts.agentLaunches.find((launch) =>
        launch.availability === "disabled"
      )?.reason;
      return reason ??
        "No agent is configured for this task. Add one under [project].agents in discern.toml.";
    },
  },
  follow_up: {
    section: "work",
    label: DESK_ACTION_LABELS.follow_up,
    key: "f",
    parameters: true,
    effect: "change",
    availableWhileRunning: true,
    next: [],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Start a new task from this branch's last commit",
    reviewTitle: (context: DeskActionContext): string =>
      `Start a follow-up from ${context.title}`,
    command: (context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "start", "--from", context.branch],
      workingDirectory: "main",
    }),
    consequence: [
      line("changes", "Creates a task from the last commit of this branch"),
      line("keeps", "Keeps this task as it is"),
    ],
    confirmation: confirm("Cancel", "Create"),
    binding: ["base-head"],
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow its recovery steps before starting a follow-up.",
      ),
  },
  scripts: {
    section: "work",
    label: DESK_ACTION_LABELS.scripts,
    key: "x",
    parameters: true,
    effect: "launch",
    availableWhileRunning: false,
    next: [],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Run one of the project's scripts in this checkout",
    reviewTitle: (context: DeskActionContext): string =>
      `Run a script in ${context.title}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "scripts", "<name>"],
      workingDirectory: "task",
    }),
    consequence: [
      line(
        "changes",
        "Runs the chosen script in this checkout; it owns the terminal until it exits",
      ),
      line("warning", "Scripts don't declare what they change"),
    ],
    confirmation: confirm("Cancel", "Run"),
    binding: [
      "worktree-identity",
      "path",
      "script-path",
      "script-digest",
      "argv",
    ],
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Restore the checkout before running a script.",
      ),
  },
  jump: {
    section: "work",
    label: DESK_ACTION_LABELS.jump,
    key: "s",
    parameters: false,
    effect: "launch",
    availableWhileRunning: true,
    next: [],
    also: [
      "broken",
      "unreadable",
      "setup-retry",
      "setup-manual",
      "setup-unknown",
      "checking",
      "updating",
      "running",
      "editing",
    ],
    summary: (_context: DeskActionContext): string =>
      "Open your shell in this task's checkout",
    reviewTitle: (context: DeskActionContext): string =>
      `Open shell in ${context.title}`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["<user-shell>"],
      workingDirectory: "task",
    }),
    consequence: [
      line("changes", "Commands you run in the shell may change this task"),
      line("keeps", "The desk waits until the shell exits"),
    ],
    confirmation: NO_CONFIRMATION,
    binding: ["worktree-identity", "path"],
    availability: (facts: DeskActionFacts): string | undefined =>
      facts.entry.filesystem?.state === "directory"
        ? undefined
        : `The checkout directory is ${
          facts.entry.filesystem?.state ?? "unavailable"
        }.`,
  },
  inspect: {
    section: "review",
    label: DESK_ACTION_LABELS.inspect,
    key: "v",
    parameters: false,
    effect: "read",
    availableWhileRunning: true,
    next: [
      "landing",
      "exception",
      "checking",
      "updating",
      "running",
      "stale-proven",
      "stale",
      "idle-unknown",
    ],
    also: [
      "interrupted",
      "checks-failed",
      "land-failed",
      "failed",
      "awaiting-owner",
      "refused",
      "editing",
      "queued",
      "approved",
      "ready",
      "proof-error",
      "proof-unknown",
      "contained",
    ],
    summary: (_context: DeskActionContext): string =>
      "See its commits, changed files and checks",
    reviewTitle: (context: DeskActionContext): string =>
      `Changes in ${context.title}`,
    command: (context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["git", "diff", `${context.trunk}...HEAD`],
      workingDirectory: "task",
    }),
    consequence: [line("keeps", "Nothing changes; viewing only reads")],
    confirmation: NO_CONFIRMATION,
    binding: [],
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow its recovery steps before viewing its changes.",
      ),
  },
  rename: {
    section: "manage",
    label: DESK_ACTION_LABELS.rename,
    key: "e",
    parameters: true,
    effect: "change",
    availableWhileRunning: false,
    next: [],
    also: ["empty"],
    summary: (_context: DeskActionContext): string =>
      "Change the title shown for this task",
    reviewTitle: (context: DeskActionContext): string =>
      `Rename ${context.title}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "rename", "<title>"],
      workingDirectory: "task",
    }),
    consequence: [
      line("changes", "Changes the task title only"),
      line("keeps", "Keeps the branch, checkout and brief"),
    ],
    confirmation: confirm("Keep", "Rename"),
    binding: ["worktree-identity", "title"],
    availability: (facts: DeskActionFacts): string | undefined =>
      healthyActionAvailability(
        facts.entry,
        "Follow its recovery steps before renaming it.",
      ),
  },
  grant: {
    section: "manage",
    label: DESK_ACTION_LABELS.grant,
    key: "g",
    parameters: false,
    effect: "change",
    // The marker writer and acceptance claim share an atomic linearization
    // point, so a Gate run cannot make this human authority choice unsafe.
    availableWhileRunning: true,
    next: [],
    also: ["awaiting-owner", "ready"],
    summary: (_context: DeskActionContext): string =>
      "Let it land without asking you once its checks pass",
    reviewTitle: (context: DeskActionContext): string =>
      `Let ${context.title} land without asking?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "desk"],
      workingDirectory: "main",
    }),
    consequence: [
      line(
        "changes",
        "Covers this branch and any later version whose checks pass",
      ),
      line(
        "changes",
        "Once queued, it lands with any landing, without asking you",
      ),
      line(
        "keeps",
        "Checkpoint exceptions, standard changes and emergencies still ask you",
      ),
      line(
        "recoverable",
        "Ends when it lands, is parked or dropped; revoke it any time",
      ),
    ],
    confirmation: confirm("Keep", "Allow"),
    binding: ["worktree-identity", "branch", "grant-absent"],
    availability: (facts: DeskActionFacts): string | undefined =>
      isUnhealthy(facts.entry)
        ? "Follow its recovery steps before pre-authorizing it."
        : facts.effortGranted
        ? "It is already pre-authorized."
        : undefined,
  },
  revoke_grant: {
    section: "manage",
    label: DESK_ACTION_LABELS.revoke_grant,
    parameters: false,
    effect: "change",
    availableWhileRunning: true,
    next: [],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Ask you again before it lands",
    reviewTitle: (context: DeskActionContext): string =>
      `Revoke pre-authorization for ${context.title}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "desk"],
      workingDirectory: "main",
    }),
    consequence: [
      line("changes", "Removes the pre-authorization"),
      line(
        "warning",
        "A queued version waits for your approval again",
        "queued",
      ),
      line("recoverable", "Pre-authorize it again any time"),
    ],
    confirmation: confirm("Keep", "Revoke"),
    binding: ["grant-record"],
    availability: (facts: DeskActionFacts): string | undefined =>
      facts.effortGranted ? undefined : "Nothing is pre-authorized.",
  },
  reclaim: {
    section: "manage",
    label: DESK_ACTION_LABELS.reclaim,
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["contained"],
    also: [],
    summary: (context: DeskActionContext): string =>
      `Remove this checkout; its commits are in ${
        context.containedIn ?? "another task"
      }`,
    reviewTitle: (context: DeskActionContext): string =>
      `Reclaim ${context.title}'s checkout?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "prune", "--contained"],
      workingDirectory: "main",
    }),
    consequence: [
      line(
        "changes",
        (context) =>
          `Its commits are already in ${
            context.containedIn ?? "another task"
          }; removes this checkout`,
      ),
      line("keeps", "Keeps the branch"),
      ...ENDS_RECORDS,
      ...ENDS_AUTHORITY,
      ...ENDS_RESOURCES,
      line(
        "recoverable",
        "The branch cleans itself up after the containing task lands",
      ),
    ],
    confirmation: confirm("Keep", "Reclaim"),
    binding: ["branch-head", "contained-tip", "worktree-identity"],
    availability: reclaimAvailability,
  },
  park: {
    section: "manage",
    label: DESK_ACTION_LABELS.park,
    key: "p",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: [],
    also: ["stale-proven", "stale"],
    summary: (_context: DeskActionContext): string =>
      "Free the checkout and keep the branch to resume later",
    reviewTitle: (context: DeskActionContext): string =>
      `Park ${context.title}?`,
    command: (context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "park", context.path],
      workingDirectory: "main",
    }),
    consequence: [
      line("changes", "Frees the checkout"),
      line(
        "keeps",
        (context) =>
          `Keeps branch ${context.branch}, its commits, title and brief`,
      ),
      line("removes", "Removes its Proof", "proof-recorded"),
      ...ENDS_AUTHORITY,
      ...ENDS_RESOURCES,
      line("recoverable", "Resume it later from its branch"),
    ],
    confirmation: confirm("Keep", "Park"),
    binding: ["branch-head", "clean", "worktree-identity", "grant-and-queue"],
    availability: parkAvailability,
  },
  drop: {
    section: "danger",
    label: DESK_ACTION_LABELS.drop,
    key: "D",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: [],
    also: ["stale-proven", "stale", "empty"],
    summary: (_context: DeskActionContext): string =>
      "Remove the checkout and branch; the last commit is kept for a while",
    reviewTitle: (context: DeskActionContext): string =>
      `Drop ${context.title}?`,
    command: (context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "worktree", "drop", context.path],
      workingDirectory: "main",
    }),
    consequence: [
      line(
        "discards",
        (context) =>
          `Discards ${commitsOf(context)} that ${
            context.ahead === 1 ? "isn't" : "aren't"
          } on ${context.trunk}`,
        "unlanded-commits",
      ),
      line(
        "warning",
        (context) => `Can't rule out commits that aren't on ${context.trunk}`,
        "unlanded-unknown",
      ),
      line(
        "discards",
        (context) =>
          `Deletes ${
            plural(context.changedFiles ?? 0, "uncommitted file")
          }; they can't be recovered`,
        "uncommitted",
      ),
      line("warning", "Can't rule out uncommitted work", "uncommitted-unknown"),
      line(
        "removes",
        (context) => `Removes its checkout and branch ${context.branch}`,
      ),
      ...ENDS_RECORDS,
      ...ENDS_AUTHORITY,
      ...ENDS_RESOURCES,
      line(
        "recoverable",
        "Its last commit is kept for a while; the technical plan shows how to restore it",
      ),
      line("keeps", (context) => `Keeps ${context.trunk} and every other task`),
    ],
    confirmation: {
      kind: "typed-branch",
      defaultTo: false,
      noLabel: "Keep",
      yesLabel: "Drop",
    },
    binding: ["plan", "challenge"],
    availability: (_facts: DeskActionFacts): string | undefined => undefined,
  },
} as const satisfies Readonly<Record<DeskAction, DeskActionMetadata>>;

/** Resolve one action's declared consequences against the observed task. */
export function consequenceLines(
  action: DeskAction,
  context: DeskActionContext,
): DeskConsequenceLine[] {
  const items: readonly DeskConsequenceItem[] =
    DESK_ACTION_REGISTRY[action].consequence;
  return items.flatMap((item) =>
    item.when === undefined || DESK_CONSEQUENCE_FACTS[item.when](context)
      ? [{
        mark: item.mark,
        text: typeof item.text === "string" ? item.text : item.text(context),
      }]
      : []
  );
}

/** The action whose `next` names this state, if any. */
export function deskNextAction(
  state: FleetTaskRowStateId,
): DeskAction | undefined {
  return DESK_ACTIONS.find((action) => {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    return metadata.next.includes(state);
  });
}

/** The actions whose `also` names this state, in registry order. */
export function deskAlsoActions(state: FleetTaskRowStateId): DeskAction[] {
  return DESK_ACTIONS.filter((action) => {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    return metadata.also.includes(state);
  });
}

/** The observed task facts every label, summary, and consequence reads. */
function actionContext(
  facts: DeskActionFacts,
  title: string,
  queued: boolean,
): DeskActionContext {
  const entry = facts.entry;
  return {
    trunk: facts.trunk,
    title,
    branch: entry.branch,
    path: entry.path,
    proofHonored: fleetRowProof(entry).status === "honored",
    taskMetadataRecorded: entry.task?.title_source === "recorded",
    effortGranted: facts.effortGranted,
    proofRecorded: entry.gate_proof !== undefined &&
      entry.gate_proof.status !== "missing" &&
      entry.gate_proof.status !== "unavailable",
    queued,
    ...(entry.clean === true
      ? { changedFiles: 0 }
      : entry.changed_files === undefined
      ? {}
      : { changedFiles: entry.changed_files }),
    ...(entry.ahead === undefined ? {} : { ahead: entry.ahead }),
    ...(entry.behind === undefined ? {} : { behind: entry.behind }),
    ...(entry.resources === undefined
      ? {}
      : { resources: Object.values(entry.resources) }),
    ...(entry.contained_in === undefined
      ? {}
      : { containedIn: entry.contained_in }),
  };
}

/** Represent every registered action once with its current availability. */
function actionOffers(
  facts: DeskActionFacts,
  context: DeskActionContext,
): DeskActionOffer[] {
  return DESK_ACTIONS.map((action): DeskActionOffer => {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    const base: DeskActionOfferBase = {
      action,
      section: metadata.section,
      ...(metadata.key === undefined ? {} : { key: metadata.key }),
      label: metadata.label,
      summary: metadata.summary(context),
      reviewTitle: metadata.reviewTitle(context),
      command: metadata.command(context),
      consequence: consequenceLines(action, context),
      confirmation: metadata.confirmation,
    };
    const reason = runningReason(metadata.availableWhileRunning, facts) ??
      metadata.availability(facts);
    return reason === undefined
      ? { ...base, availability: "enabled" }
      : { ...base, availability: "disabled", reason };
  });
}

export interface DeskDecisionOptions extends DeskObservationContext {
  readonly agentLaunches?: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
}

/** Project survey-carried landing authority without inventing missing facts. */
function authorityFact(
  entry: StatusFleetEntry,
  summary: string | undefined,
): DeskAuthorityFact {
  const authority = entry.landing_authority;
  return {
    status: authority?.kind === "authorized" ? "granted" : "needs_approval",
    ...(authority?.source === undefined ? {} : { source: authority.source }),
    ...(summary === undefined ? {} : { summary }),
  };
}

/** Build one complete decision from the status survey and desk capabilities. */
export function buildDeskDecision(
  entry: StatusFleetEntry,
  options: DeskDecisionOptions,
): DeskDecision {
  const presentation = presentFleetRow(entry, {
    trunk: options.trunk,
    nowMs: options.nowMs,
    ...(options.fleetCollisions === undefined
      ? {}
      : { collisions: options.fleetCollisions }),
    ...(options.queue === undefined ? {} : { queue: options.queue }),
    ...(options.fleet === undefined ? {} : { fleet: options.fleet }),
  });
  const proofLine = entry.gate_proof?.proof_line ?? entry.proof_line;
  const proof: DeskProofFact = {
    status: presentation.proof.status,
    honored: presentation.proof.status === "honored",
    summary: presentation.proof.label,
    ...(presentation.proof.detail === undefined
      ? {}
      : { detail: presentation.proof.detail }),
    ...(proofLine === undefined ? {} : { line: proofLine }),
  };
  const authority = authorityFact(entry, presentation.authority);
  const collisions: DeskCollision[] = [
    ...presentation.collisions.map((collision): DeskChangedFileCollision => ({
      kind: "changed_files",
      otherBranch: collision.branch,
      paths: collision.overlap,
      total: collision.total,
    })),
    ...adrCollisionsFor(entry, options.adrCollisions ?? []),
  ];
  const exceptionArgv = options.exceptionArgvs?.get(entry.branch);
  const facts: DeskActionFacts = {
    entry,
    state: presentation.state,
    effortGranted: authority.status === "granted" &&
      authority.source === "effort-grant",
    agentLaunches: options.agentLaunches ?? [],
    ...(options.capabilityError === undefined
      ? {}
      : { capabilityError: options.capabilityError }),
    trunk: options.trunk,
    ...(options.mainCheckout === undefined
      ? {}
      : { mainCheckout: options.mainCheckout }),
    ...(presentation.integration === undefined
      ? {}
      : { integration: presentation.integration }),
    ...(exceptionArgv === undefined ? {} : { exceptionArgv }),
  };
  const offers = actionOffers(
    facts,
    actionContext(
      facts,
      taskLabel(entry).name,
      presentation.queue !== undefined,
    ),
  );
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
      text: `Checks: ${proof.summary}${
        proof.detail === undefined || proof.summary.includes(proof.detail)
          ? ""
          : ` (${proof.detail})`
      }`,
    });
  }
  if (presentation.authority !== undefined) {
    details.push({
      kind: "authority",
      text: `Landing: ${presentation.authority}`,
    });
  }
  if (presentation.queue !== undefined) {
    details.push({ kind: "queue", text: `Queue: ${presentation.queue}` });
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
  const recovery = recoveryFact(entry);
  const nextAction = deskNextAction(presentation.state);
  const next = offers.find((offer) => offer.action === nextAction);
  const also = deskAlsoActions(presentation.state).flatMap((action) => {
    const offer = offers.find((candidate) => candidate.action === action);
    return offer?.availability === "enabled" ? [offer] : [];
  });
  return {
    statusKind: presentation.kind,
    state: presentation.state,
    group: presentation.group,
    label: presentation.label,
    glyph: presentation.glyph,
    ascii: presentation.ascii,
    tones: presentation.tones,
    ...(presentation.qualifier === undefined
      ? {}
      : { qualifier: presentation.qualifier }),
    explanation: presentation.explanation,
    details,
    activity: activityFact(entry, options.nowMs),
    proof,
    authority,
    collisions,
    ...(recovery === undefined ? {} : { recovery }),
    actions: offers,
    ...(next === undefined ? {} : { next }),
    also,
  };
}

/**
 * The exact exception hand-off for every task whose Proof, or whose retained
 * landing copy, names owner decisions, keyed by branch. Standard approval
 * tokens are digests, so the observation computes them once before the
 * synchronous decision reads them.
 */
export async function deskExceptionArgvs(
  data: Pick<StatusData, "fleet">,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const tasks = (data.fleet ?? []).filter((entry) => !entry.is_main);
  const pending = tasks.flatMap((entry) => {
    const integration = integrationFor(entry, tasks);
    const judgment = integration?.awaiting_judgment === true
      ? integration.judgment
      : undefined;
    return entry.integration === undefined &&
        hasExceptionHandOff(entry.gate_proof?.proof_data, judgment)
      ? [{ entry, judgment }]
      : [];
  });
  return new Map(
    await Promise.all(
      pending.map(async ({ entry, judgment }) =>
        [
          entry.branch,
          await exceptionArgv(
            entry.branch,
            entry.gate_proof?.proof_data,
            judgment,
          ),
        ] as const
      ),
    ),
  );
}

/** The main-checkout facts that decide whether landing can start. */
export function deskMainCheckoutFacts(
  data: Pick<StatusData, "git" | "pending_tracked_refresh">,
): DeskMainCheckoutFacts {
  return {
    ...(data.git?.clean === undefined ? {} : { clean: data.git.clean }),
    pendingRefresh: (data.pending_tracked_refresh?.length ?? 0) > 0,
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

export interface BuildDeskRowsOptions extends DeskObservationContext {
  readonly scriptsUnavailableReasons?: ReadonlyMap<string, string>;
  readonly capabilityErrors?: ReadonlyMap<string, string>;
}

/**
 * Build every task row the Desk lists, ordered by decision group, then
 * case-folded title, then identity. The main checkout is not a task, and a
 * landing's integration copy belongs to discern: it never gets a row or
 * actions, and speaks through its task's row instead.
 */
export function buildDeskRows(
  fleet: readonly StatusFleetEntry[],
  scriptsByPath: ReadonlyMap<string, readonly DeskProjectScript[]>,
  agentLaunchesByPath: ReadonlyMap<string, readonly DeskAgentLaunch[]>,
  options: BuildDeskRowsOptions,
): DeskRow[] {
  const tasks = fleet.filter((entry) => !entry.is_main);
  const {
    scriptsUnavailableReasons,
    capabilityErrors,
    ...observationOptions
  } = options;
  const observation: DeskObservationContext = {
    ...observationOptions,
    fleet: options.fleet ?? tasks,
  };
  const rows = tasks
    .filter((entry) =>
      entry.integration === undefined && !speaksForAnotherRow(entry, tasks)
    )
    .map((entry): DeskRow => {
      const scripts = scriptsByPath.get(entry.path) ?? [];
      const agentLaunches = agentLaunchesByPath.get(entry.path) ?? [];
      const scriptsUnavailableReason = scriptsUnavailableReasons?.get(
        entry.path,
      );
      const capabilityError = capabilityErrors?.get(entry.path);
      return {
        entry,
        task: taskLabel(entry),
        scripts,
        agentLaunches,
        ...(scriptsUnavailableReason === undefined
          ? {}
          : { scriptsUnavailableReason }),
        ...(capabilityError === undefined ? {} : { capabilityError }),
        observation,
        decision: buildDeskDecision(entry, {
          ...observation,
          agentLaunches,
          ...(capabilityError === undefined ? {} : { capabilityError }),
        }),
      };
    });
  return rows.sort((left, right) =>
    fleetRowGroupRank(left.decision.group) -
      fleetRowGroupRank(right.decision.group) ||
    compareTaskTitles(left.task.name, right.task.name) ||
    deskRowId(left).localeCompare(deskRowId(right), "en")
  );
}

/** Stable identity for navigation and effect targeting, including degraded rows. */
export function deskRowId(row: Pick<DeskRow, "entry">): string {
  return row.entry.id ?? (row.entry.branch || row.entry.path);
}
