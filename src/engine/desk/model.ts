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
  DESK_COMMAND_LABELS,
  type DeskAction,
  labelName,
  withTrunk,
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
  type FleetRowPresentation,
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
  idleDaysOf,
  positiveCount,
  relativeAge,
  STALE_WORKTREE_DAYS,
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

export type {
  DeskConsequenceItem,
  DeskConsequenceLine,
} from "./review_facts.ts";
import {
  consequence,
  type DeskActionReviewFacts,
  type DeskConsequenceItem,
  type DeskConsequenceLine,
  type DeskPlanFacts,
  type DeskReviewFacts,
  resolveConsequences,
  shortCommit,
} from "./review_facts.ts";

/**
 * What a review captures as `expected` and the effect boundary compares
 * before applying: a mismatch refuses the apply and asks for a fresh review.
 */
export const DESK_BINDING_FACTS = [
  "worktree-identity",
  "path",
  "branch",
  "branch-head",
  "trunk-head",
  "authority",
  "queue-walk",
  "plan",
  "challenge",
  "clean",
  "dirty-stamp",
  "grant-absent",
  "grant-record",
  "grant-and-queue",
  "contained-tip",
  "setup-step",
  "title",
  "script-path",
  "script-digest",
  "argv",
  "main-path",
  "base-commit",
  "base-head",
  "branch-name",
  "parked-record",
  "parked-head",
  "running-version",
] as const;
export type DeskBindingFact = (typeof DESK_BINDING_FACTS)[number];

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
  /** The registered checkout's commit. */
  readonly head?: string;
  /** The commit the recorded checks ran on. */
  readonly proofHead?: string;
  /** How long ago the recorded checks ran: "20m ago". */
  readonly proofAge?: string;
  /** How long a stale task has been idle: "11 days". Absent unless stale. */
  readonly idle?: string;
}

/** What a task action's review lines and their facts read. */
type ActionFacts = DeskActionReviewFacts;

/** One registered task action's complete contract. */
export interface DeskActionMetadata {
  readonly section: DeskActionSection;
  /** A shorter footer form, only where the label cannot fit. The label
   * itself is the vocabulary's (`DESK_ACTION_LABELS`), never a copy here. */
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
  /** What it does, in review order; lines naming a fact show while it holds. */
  readonly consequence: readonly DeskConsequenceItem<ActionFacts>[];
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
  /** The row's activity in status's words: "2d ago · last action done
   * failed at test", "just now · usually 3m". */
  readonly activity: string;
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
  /** The observed task facts every label, summary, and review reads. */
  readonly context: DeskActionContext;
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

/** The main checkout's facts that decide whether a landing can start: the
 * same preconditions acceptance checks before it moves the trunk. */
export interface DeskMainCheckoutFacts {
  /** Changed tracked paths, which a landing refuses on; untracked files
   * never block it. Absent when the observation could not count them. */
  readonly trackedChanges?: number;
  /** The branch checked out there, when known; a landing needs the trunk. */
  readonly branch?: string;
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
    ? `${actionName("done")} first.`
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

/** Landing refuses while the main checkout has tracked changes or another
 * branch checked out; acceptance checks exactly these before it starts. */
function mainCheckoutReason(facts: DeskActionFacts): string | undefined {
  const main = facts.mainCheckout;
  const place = labelName(DESK_COMMAND_LABELS.main_checkout);
  if (main?.trackedChanges !== undefined && main.trackedChanges > 0) {
    return `The main checkout has uncommitted tracked changes, so landing would refuse. Commit or stash them first; ${place} shows them.`;
  }
  return main?.branch !== undefined && main.branch !== "" &&
      main.branch !== facts.trunk
    ? `The main checkout is on ${main.branch}, not ${facts.trunk}, so landing would refuse. Switch it back to ${facts.trunk} first.`
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

/** One task action's consequence, optionally shown only while a fact holds. */
const line = consequence<ActionFacts>;

/** What starting a task creates, for every route that starts one. */
export const START_CONSEQUENCES: readonly DeskConsequenceItem<
  DeskReviewFacts
>[] = [
  consequence(
    "changes",
    ({ plan }) =>
      plan.creates === undefined
        ? "Create a branch"
        : `Create branch ${plan.creates.branch} from ${plan.creates.base} at ${
          shortCommit(plan.creates.commit)
        }`,
    "creates",
  ),
  consequence(
    "changes",
    ({ plan }) =>
      `Give it its own checkout and run setup${
        (plan.creates?.resources ?? 0) === 0
          ? ""
          : `, creating ${plural(plan.creates?.resources ?? 0, "resource")}`
      }`,
    "creates",
  ),
];

/** What running a Project Script does, from a task or the main checkout. */
export const SCRIPT_CONSEQUENCES: readonly DeskConsequenceItem<
  DeskReviewFacts
>[] = [
  consequence(
    "changes",
    ({ plan }) =>
      plan.script === undefined
        ? "Runs the chosen script"
        : `Runs ${commandEvidence(plan.script.argv)} in ${plan.script.where}`,
    "script",
  ),
  consequence("changes", "It owns the terminal until it exits"),
  consequence("warning", "This script hasn't declared what it changes"),
];

const NO_CONFIRMATION = { kind: "none" } as const;

/** An action's label as a name inside a sentence or title. */
function actionName(action: DeskAction): string {
  return labelName(DESK_ACTION_LABELS[action]);
}

const ACCEPT_NAME = actionName("accept");

/** The landing records Park, Reclaim, and Drop end with the checkout. */
const ENDS_AUTHORITY = [
  line("removes", "Ends its pre-authorization", "ends-grant"),
  line("removes", "Leaves the landing queue", "leaves-queue"),
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
      `${actionName("recovery")} for ${context.title}`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "status", "--all"],
      workingDirectory: "main",
    }),
    consequence: [line("keeps", "Nothing changes; the steps only read")],
    confirmation: NO_CONFIRMATION,
    binding: [],
    availability: (facts: DeskActionFacts): string | undefined =>
      recoveryFact(facts.entry, facts.state) === undefined
        ? "This task has nothing to recover."
        : undefined,
  },
  retry_setup: {
    section: "manage",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["setup-retry"],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Resume setup from the step that failed",
    reviewTitle: (context: DeskActionContext): string =>
      `${actionName("retry_setup")} for ${context.title}?`,
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
    key: "c",
    parameters: false,
    effect: "change",
    availableWhileRunning: false,
    next: ["proof-error", "proof-unknown", "recheck", "needs-checks"],
    also: ["checks-failed"],
    summary: (_context: DeskActionContext): string =>
      "Run this project's checks on the committed work",
    reviewTitle: (context: DeskActionContext): string =>
      `${actionName("done")} on ${context.title}?`,
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
        ({ context }) =>
          `Fixers may rewrite files; a pass records Proof for ${
            context.head === undefined
              ? "this commit"
              : shortCommit(context.head)
          }`,
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
        "warning",
        ({ context }) => `No activity for ${context.idle ?? "a long while"}`,
        "stale",
      ),
      line(
        "evidence",
        ({ context }) =>
          `Checks passed${
            context.proofAge === undefined ? "" : ` ${context.proofAge}`
          } on this exact commit${
            context.proofHead === undefined
              ? ""
              : ` (${shortCommit(context.proofHead)})`
          }`,
        "proof-honored",
      ),
      line(
        "changes",
        ({ plan }) => landsSentence(plan),
        "lands",
        ({ plan }) =>
          plan.lands === undefined ? undefined : {
            insertions: plan.lands.insertions,
            deletions: plan.lands.deletions,
          },
      ),
      line(
        "changes",
        ({ context }) => `${context.trunk} hasn't moved, so it lands directly`,
        "direct",
      ),
      line(
        "changes",
        ({ context, plan }) =>
          `${context.trunk} has ${
            plan.integrates?.behind === undefined
              ? "moved"
              : plural(plan.integrates.behind, "new commit")
          }. Landing first combines them in a separate copy and reruns every check`,
        "integrates",
      ),
      line(
        "changes",
        "If they conflict or a check fails, nothing lands and the task stays as it is",
        "integrates",
      ),
      line("changes", ({ plan }) => authoritySentence(plan), "authority"),
      line(
        "changes",
        ({ plan }) =>
          (plan.queueWalk ?? []).map((queued) =>
            `Then ${queued.title} lands too: queued and pre-authorized`
          ),
        "queue-walk",
      ),
      line(
        "warning",
        ({ plan }) =>
          `Waits for ${
            plan.landingInProgress?.title ?? "another landing"
          } to finish landing`,
        "landing-in-progress",
      ),
      line(
        "warning",
        ({ plan }) =>
          (plan.ignoredRoots ?? []).map((root) =>
            `${root} changed since setup and is removed with the checkout`
          ),
        "ignored-roots",
      ),
      line(
        "removes",
        ({ context }) =>
          (context.resources?.length ?? 0) > 0
            ? "Removes its checkout, branch, ports and services"
            : "Removes its checkout and branch",
      ),
      line(
        "warning",
        "Its recorded ports and services can't be read",
        "resources-unreadable",
      ),
      line(
        "keeps",
        ({ context }) => `Keeps the Proof, recorded on ${context.trunk}`,
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
      line(
        "changes",
        ({ plan }) =>
          `Records this version (${
            shortCommit(plan.revision ?? "")
          }) in the landing queue`,
        "revision",
      ),
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
        ({ context }) =>
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
        ({ context }) =>
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
      `${actionName("agent")} in ${context.title}`,
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
      ...START_CONSEQUENCES,
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
    key: "x",
    parameters: true,
    effect: "launch",
    availableWhileRunning: false,
    next: [],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Run one of the project's scripts in this checkout",
    reviewTitle: (context: DeskActionContext): string =>
      `${actionName("scripts")} in ${context.title}?`,
    command: (_context: DeskActionContext): DeskCommandEvidence => ({
      argv: ["discern", "scripts", "<name>"],
      workingDirectory: "task",
    }),
    consequence: SCRIPT_CONSEQUENCES,
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
      `${actionName("jump")} in ${context.title}`,
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
    parameters: false,
    effect: "change",
    availableWhileRunning: true,
    next: [],
    also: [],
    summary: (_context: DeskActionContext): string =>
      "Ask you again before it lands",
    reviewTitle: (context: DeskActionContext): string =>
      `${actionName("revoke_grant")} for ${context.title}?`,
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
        ({ context }) =>
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
        ({ context }) =>
          `Keeps branch ${context.branch}, its commits, title and brief`,
      ),
      line("removes", "Removes its Proof", "removes-proof"),
      ...ENDS_AUTHORITY,
      ...ENDS_RESOURCES,
      line(
        "recoverable",
        `Resume it from ${labelName(DESK_COMMAND_LABELS.parked)}`,
      ),
    ],
    confirmation: confirm("Keep", "Park"),
    binding: ["branch-head", "clean", "worktree-identity", "grant-and-queue"],
    availability: parkAvailability,
  },
  drop: {
    section: "danger",
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
        ({ plan }) => (plan.discards ?? []).map((work) => `Discards ${work}`),
        "discards",
      ),
      line(
        "warning",
        ({ plan }) =>
          (plan.uncertain ?? []).map((doubt) =>
            `Can't rule out lost work: ${doubt}`
          ),
        "uncertain",
      ),
      line(
        "removes",
        ({ context }) => `Removes its checkout and branch ${context.branch}`,
      ),
      ...ENDS_RECORDS,
      ...ENDS_AUTHORITY,
      ...ENDS_RESOURCES,
      line(
        "recoverable",
        "Its last commit is kept for a while; the technical plan shows how to restore it",
      ),
      line(
        "keeps",
        ({ context }) => `Keeps ${context.trunk} and every other task`,
      ),
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

/** Resolve one action's declared consequences against its review facts. */
export function consequenceLines(
  action: DeskAction,
  facts: ActionFacts,
): DeskConsequenceLine[] {
  const items: readonly DeskConsequenceItem<ActionFacts>[] =
    DESK_ACTION_REGISTRY[action].consequence;
  return resolveConsequences(action, items, facts);
}

/** What a landing lands: its commits, files, and line counts beside. */
function landsSentence(plan: DeskPlanFacts): string {
  const lands = plan.lands;
  if (lands === undefined) return "Lands this revision";
  return `Lands ${
    lands.commits === undefined
      ? "this revision"
      : plural(lands.commits, "commit")
  } · ${plural(lands.files, "file")}`;
}

/** Who approves a landing, in the words a review uses. */
function authoritySentence(plan: DeskPlanFacts): string {
  const authority = plan.authority;
  switch (authority?.kind) {
    case "pre-authorized":
      return "Covered by your pre-authorization";
    case "standing":
      return `Covered by your standing approval${
        authority.scopes === undefined || authority.scopes.length === 0
          ? ""
          : ` (${authority.scopes.join(", ")})`
      }`;
    case "partial":
      return `Your standing approval covers ${
        plural(authority.covered ?? 0, "path")
      }; choosing ${ACCEPT_NAME} approves the rest`;
    default:
      return `Choosing ${ACCEPT_NAME} approves this landing`;
  }
}

/**
 * The one sentence every surface shows for an action that cannot run now:
 * "Update from main isn't available: the branch is not behind main."
 */
export function unavailableSentence(label: string, reason: string): string {
  const because = reason.charAt(0).toLowerCase() + reason.slice(1);
  return `${labelName(label)} isn't available: ${because}`;
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
  nowMs: number,
): DeskActionContext {
  const entry = facts.entry;
  const proof = fleetRowProof(entry);
  const stale = facts.state === "stale" || facts.state === "stale-proven";
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
    ...(entry.registration === undefined
      ? {}
      : { head: entry.registration.head }),
    ...(proof.head === undefined ? {} : { proofHead: proof.head }),
    ...(proof.recorded === undefined || Number.isNaN(Date.parse(proof.recorded))
      ? {}
      : { proofAge: relativeAge(proof.recorded, nowMs) }),
    ...(stale
      ? {
        idle: plural(
          idleDaysOf(entry.last_activity, nowMs) ?? STALE_WORKTREE_DAYS,
          "day",
        ),
      }
      : {}),
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
      label: withTrunk(DESK_ACTION_LABELS[action], context.trunk),
      summary: metadata.summary(context),
      reviewTitle: metadata.reviewTitle(context),
      command: metadata.command(context),
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

/** The task's Proof as a fact of its own, in status's words. It never
 * decides the row's label, glyph, or tone; those are the row state's. */
function proofFact(
  entry: StatusFleetEntry,
  presentation: FleetRowPresentation,
): DeskProofFact {
  const proofLine = entry.gate_proof?.proof_line ?? entry.proof_line;
  return {
    status: presentation.proof.status,
    honored: presentation.proof.status === "honored",
    summary: presentation.proof.label,
    ...(presentation.proof.detail === undefined
      ? {}
      : { detail: presentation.proof.detail }),
    ...(proofLine === undefined ? {} : { line: proofLine }),
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
  const proof = proofFact(entry, presentation);
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
  const context = actionContext(
    facts,
    taskLabel(entry).name,
    presentation.queue !== undefined,
    options.nowMs,
  );
  const offers = actionOffers(facts, context);
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
  const recovery = recoveryFact(entry, presentation.state);
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
    activity: presentation.activity,
    proof,
    authority,
    collisions,
    ...(recovery === undefined ? {} : { recovery }),
    actions: offers,
    ...(next === undefined ? {} : { next }),
    also,
    context,
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

/**
 * The observation context every desk decision reads, from one status survey
 * and its exception hand-offs (`deskExceptionArgvs`). The live desk and any
 * flow that re-observes mid-action build rows from this one projection, so
 * no route decides availability from a partial observation.
 */
export function deskObservation(
  data: StatusData,
  options: {
    readonly trunk: string;
    readonly nowMs: number;
    readonly exceptionArgvs: ReadonlyMap<string, readonly string[]>;
  },
): DeskObservationContext {
  return {
    trunk: data.git?.trunk ?? options.trunk,
    nowMs: options.nowMs,
    fleetCollisions: data.fleet_collisions ?? [],
    adrCollisions: data.adr_collisions ?? [],
    queue: data.queue ?? [],
    mainCheckout: deskMainCheckoutFacts(data),
    exceptionArgvs: options.exceptionArgvs,
  };
}

/** The main-checkout facts that decide whether landing can start. A clean
 * checkout has no tracked changes; an older observation without the tracked
 * count leaves it unknown rather than counting untracked files. */
export function deskMainCheckoutFacts(
  data: Pick<StatusData, "git">,
): DeskMainCheckoutFacts {
  const git = data.git;
  if (git === undefined || git === null) return {};
  const trackedChanges = git.tracked_changes ?? (git.clean ? 0 : undefined);
  return {
    ...(trackedChanges === undefined ? {} : { trackedChanges }),
    ...(git.branch === "" ? {} : { branch: git.branch }),
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
