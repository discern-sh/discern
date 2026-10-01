/**
 * The sentences each row state builds from its facts, in two registers.
 *
 * `explanation` is the human register: what is true and who moves next,
 * without commands; the Desk and the status dashboard show it. `attention`
 * is the CLI register: the next step with its exact command, absent when
 * nothing is due; status prints it as the row's next action. `qualifier` is
 * the short phrase after a state's label ("4 commits ahead"). Pure.
 */

import type { FleetRowStateId } from "../../shared/fleet_row_vocabulary.ts";
import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import { compactDuration, elapsedDuration } from "../output.ts";
import {
  degradedFleetAttention,
  unreadableSubject,
} from "./recovery_presentation.ts";
import {
  exceptionArgvWith,
  type FleetBranchRowFacts,
  type FleetRowJudgment,
  fleetRowProof,
  type FleetTaskRowFacts,
  hasExceptionHandOff,
  idleDaysOf,
  positiveCount,
  proofFinishedAt,
  relativeAge,
  STALE_WORKTREE_DAYS,
} from "./row_facts.ts";

/** The sentences one state builds from its facts. */
export interface FleetRowSentences<Facts> {
  /** The short phrase after the label on a state line ("4 commits ahead"). */
  qualifier(facts: Facts): string | undefined;
  /** Human register: what is true and who moves next, without commands. */
  explanation(facts: Facts): string;
  /** CLI register: the next step with its exact command, when one is due. */
  attention(facts: Facts): string | undefined;
}

/** States a live task row can resolve to. */
export type FleetTaskRowStateId = Exclude<FleetRowStateId, "parked" | "landed">;

/** States a retained branch without a checkout resolves to. */
export type FleetBranchRowStateId = Extract<
  FleetRowStateId,
  "parked" | "landed"
>;

type TaskSentences = FleetRowSentences<FleetTaskRowFacts>;

/** `1 commit`, `3 commits`. */
function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** An age phrase, or undefined when the time is unknown. */
function ageOf(iso: string | undefined, nowMs: number): string | undefined {
  const age = relativeAge(iso, nowMs);
  return age === "—" ? undefined : age;
}

/** ` 2h ago`, or nothing when the time is unknown. */
function spacedAge(iso: string | undefined, nowMs: number): string {
  const age = ageOf(iso, nowMs);
  return age === undefined ? "" : ` ${age}`;
}

/** The idle span that made a row stale, in days. */
function idleSpan(facts: FleetTaskRowFacts): string {
  return plural(
    idleDaysOf(facts.entry.last_activity, facts.nowMs) ?? STALE_WORKTREE_DAYS,
    "day",
  );
}

/** Commits the branch carries, as a qualifier. */
function aheadQualifier(facts: FleetTaskRowFacts): string | undefined {
  const ahead = positiveCount(facts.entry.ahead);
  return ahead === undefined ? undefined : `${plural(ahead, "commit")} ahead`;
}

/** The branch an exception or landing names: the task, never its copy. */
function taskBranch(facts: FleetTaskRowFacts): string {
  return facts.entry.integration?.for_branch ?? facts.entry.branch;
}

/** `Checks passed 20m ago on this exact commit`. */
function checksPassed(facts: FleetTaskRowFacts): string {
  const finished = proofFinishedAt(fleetRowProof(facts.entry));
  return `Checks passed${
    spacedAge(finished, facts.nowMs)
  } on this exact commit`;
}

/** How main moved since the checks passed, continuing their sentence. */
function sinceChecks(entry: StatusFleetEntry): string {
  if (entry.behind === 0) return ", and main hasn't moved since.";
  const behind = positiveCount(entry.behind);
  return behind === undefined
    ? "."
    : `, and main has ${
      plural(behind, "new commit")
    } since. Landing combines them and reruns every check first.`;
}

/** What landing still needs from the owner. */
function landingNeeds(entry: StatusFleetEntry): string {
  const uncovered = entry.landing_authority?.uncovered?.length ?? 0;
  return (entry.landing_authority?.standing_scopes?.length ?? 0) > 0 &&
      uncovered > 0
    ? `Landing needs your approval: ${plural(uncovered, "path")} ${
      uncovered === 1 ? "isn't" : "aren't"
    } covered by your standing approval.`
    : "Landing needs your approval.";
}

/** The stale-and-queued note: a pre-authorized submission may still land. */
function queuedNote(facts: FleetTaskRowFacts): string {
  return facts.queueRow?.authority === "pre-authorized"
    ? " It is queued and pre-authorized, so it may land with the next landing."
    : "";
}

/** `Checks started 1m 12s ago and usually take about 3m.` */
function runningSentence(
  subject: string,
  facts: FleetTaskRowFacts,
  verb: "take" | "takes" = "takes",
): string {
  const running = facts.entry.running;
  if (running === undefined) return `${subject} started just now.`;
  const typical = running.typical_duration_ms === undefined
    ? ""
    : ` and usually ${verb} about ${
      compactDuration(running.typical_duration_ms)
    }`;
  return `${subject} started ${
    elapsedDuration(running.elapsed_ms)
  } ago${typical}.`;
}

/** The decision a retained landing copy waits on, when one does. */
function retainedJudgment(
  facts: FleetTaskRowFacts,
): FleetRowJudgment | undefined {
  return facts.integration?.awaiting_judgment === true
    ? facts.integration.judgment
    : undefined;
}

/** The decisions a Proof, or a retained composition's variance, leaves for
 * the owner, as one clause. */
function exceptionParts(facts: FleetTaskRowFacts): string | undefined {
  const proof = facts.entry.gate_proof?.proof_data;
  const judgment = retainedJudgment(facts);
  const unmet = judgment?.decision === "variance"
    ? judgment.awaiting.length
    : proof?.checkpoints?.declared_unmet.length ?? 0;
  const limits = proof?.standard_proposals?.length ?? 0;
  const parts = [
    ...(unmet === 0 ? [] : [
      `${plural(unmet, "checkpoint answer")} ${
        unmet === 1 ? "is" : "are"
      } unmet`,
    ]),
    ...(limits === 0 ? [] : [
      `${plural(limits, "standard limit change")} ${
        limits === 1 ? "is" : "are"
      } proposed`,
    ]),
  ];
  return parts.length === 0 ? undefined : parts.join(" and ");
}

/** The exact hand-off command, with a placeholder per standard token; when
 * the facts cannot name the decision, `discern accept` serves it. */
function exceptionCommand(facts: FleetTaskRowFacts): string {
  const proof = facts.entry.gate_proof?.proof_data;
  const judgment = retainedJudgment(facts);
  if (!hasExceptionHandOff(proof, judgment)) {
    return `With the owner's approval, run \`discern accept --target ${
      taskBranch(facts)
    }\`; it serves the exact decision to record.`;
  }
  const tokens = (proof?.standard_proposals ?? []).map((proposal) =>
    `<${proposal.standard}-token>`
  );
  const tail = tokens.length === 0
    ? ""
    : "; the refusal from `discern accept` serves each standard's token";
  return `With the owner's approval, run \`${
    exceptionArgvWith(taskBranch(facts), proof, tokens, judgment).join(" ")
  }\`${tail}.`;
}

/** The agent's checkpoint answers a retained composition waits on. */
function awaitedDeclaration(
  facts: FleetTaskRowFacts,
): FleetRowJudgment | undefined {
  const judgment = retainedJudgment(facts);
  return judgment?.decision === "declaration" ? judgment : undefined;
}

/** `discern done` failed at test 2h ago. */
function failedCommand(facts: FleetTaskRowFacts): string {
  const action = facts.entry.last_action;
  const partial = action?.outcome === "partial";
  const stage = action?.failed_stage === undefined
    ? ""
    : ` at ${action.failed_stage}`;
  return `\`discern ${action?.verb ?? "verb"}\` ${
    partial ? "completed only part of its work" : `failed${stage}`
  }${spacedAge(action?.at, facts.nowMs)}`;
}

/** The failed stage, or how long ago the action failed. */
function failedQualifier(facts: FleetTaskRowFacts): string | undefined {
  const action = facts.entry.last_action;
  return action?.failed_stage === undefined
    ? ageOf(action?.at, facts.nowMs)
    : `at ${action.failed_stage}`;
}

/** Where setup stopped, from its journal. */
function setupQualifier(facts: FleetTaskRowFacts): string | undefined {
  const steps = facts.entry.setup?.journal?.steps ?? [];
  const stopped = steps.findIndex((step) => step.state !== "completed");
  return stopped < 0 ? undefined : `at step ${stopped + 1} of ${steps.length}`;
}

/** Degraded rows keep the recovery wording status already routes. */
function degradedAttention(kind: string): TaskSentences["attention"] {
  return (facts) => degradedFleetAttention(kind, facts.entry);
}

const STALE_COMMANDS = (facts: FleetTaskRowFacts): string =>
  `park its checkout with \`discern worktree park ${facts.entry.path}\`, or review \`discern worktree drop ${facts.entry.path}\` before discarding work.`;

/** Every live task state's sentences, keyed by state. */
export const TASK_ROW_SENTENCES = {
  broken: {
    qualifier: () => "no configuration",
    explanation: () =>
      "Setup stopped before this task's project configuration arrived, so discern can't read its state. Its recovery steps say how to repair or drop it.",
    attention: degradedAttention("broken"),
  },
  unreadable: {
    qualifier: (facts) => {
      const subject = unreadableSubject(facts.entry);
      return subject.kind === "git"
        ? "Git can't read it"
        : subject.kind === "env-file"
        ? "env file unreadable"
        : "files unreadable";
    },
    explanation: (facts) => {
      const subject = unreadableSubject(facts.entry);
      return subject.kind === "git"
        ? "Git can't read this checkout, so its state is unknown. Nothing about it is assumed clean."
        : subject.kind === "env-file"
        ? `discern can't read its env file ${subject.file}, so the values it records are unknown.`
        : "discern can't read this checkout's files, so its state is unknown.";
    },
    attention: degradedAttention("unreadable"),
  },
  "setup-retry": {
    qualifier: setupQualifier,
    explanation: () =>
      "Setup stopped partway through. Retrying resumes from the step that failed; finished steps are skipped.",
    attention: degradedAttention("setup-incomplete"),
  },
  "setup-manual": {
    qualifier: setupQualifier,
    explanation: () =>
      "Setup stopped partway through and can't resume on its own. Its recovery steps say what to repair first.",
    attention: degradedAttention("setup-incomplete"),
  },
  "setup-unknown": {
    qualifier: () => "record unreadable",
    explanation: () =>
      "Couldn't read this task's setup record, so discern can't tell whether setup finished.",
    attention: degradedAttention("setup-incomplete"),
  },
  landing: {
    qualifier: () => undefined,
    explanation: (facts) =>
      facts.entry.running?.verb === "accept"
        ? `${
          runningSentence("Landing", facts)
        } It combines main in a separate copy and reruns every check first.`
        : "discern is landing it now. It combines main in a separate copy and reruns every check before anything lands.",
    attention: (facts) =>
      facts.queueRow?.operation_handle === undefined
        ? undefined
        : `Its landing is running; follow it with \`discern progress ${facts.queueRow.operation_handle}\`.`,
  },
  exception: {
    qualifier: () => "needs your exception",
    explanation: (facts) => {
      const parts = exceptionParts(facts);
      return retainedJudgment(facts) !== undefined
        ? `Its landing stopped to ask you about the combined code${
          parts === undefined ? "" : `: ${parts}`
        }. discern kept the combined copy until you decide.`
        : parts !== undefined
        ? `Its checks passed, but ${parts}. Landing needs your exception first.`
        : "Its landing waits for your decision on a checkpoint answer or a standard limit change.";
    },
    attention: (facts) => {
      const parts = exceptionParts(facts);
      return `Landing needs the owner's exception${
        parts === undefined ? "" : `: ${parts}`
      }. ${exceptionCommand(facts)}`;
    },
  },
  interrupted: {
    qualifier: () => "nothing landed",
    explanation: () =>
      "Its landing stopped before it finished, and nothing landed. discern kept the combined copy; its recovery steps reclaim it.",
    attention: () =>
      "Its landing stopped before it finished and nothing landed. Reclaim discern's integration copy with `discern worktree prune`.",
  },
  checking: {
    qualifier: () => undefined,
    explanation: (facts) => runningSentence("Checks", facts, "take"),
    attention: () => undefined,
  },
  updating: {
    qualifier: () => undefined,
    explanation: (facts) => runningSentence("Updating from main", facts),
    attention: () => undefined,
  },
  running: {
    qualifier: () => undefined,
    explanation: (facts) =>
      runningSentence(`discern ${facts.entry.running?.verb ?? "verb"}`, facts),
    attention: () => undefined,
  },
  "checks-failed": {
    qualifier: failedQualifier,
    explanation: (facts) => {
      const stage = facts.entry.last_action?.failed_stage;
      return `The final checks failed${
        stage === undefined ? "" : ` at the ${stage} stage`
      }${
        spacedAge(facts.entry.last_action?.at, facts.nowMs)
      }. Hand it back to its agent, then run checks again.`;
    },
    attention: (facts) =>
      `${
        failedCommand(facts)
      }. Fix the failure, then run \`discern done\` again.`,
  },
  "land-failed": {
    qualifier: failedQualifier,
    explanation: (facts) => {
      const stage = facts.entry.last_action?.failed_stage;
      return `Its landing failed${stage === undefined ? "" : ` at ${stage}`}${
        spacedAge(facts.entry.last_action?.at, facts.nowMs)
      }, and nothing landed. Hand it back to its agent to fix the cause.`;
    },
    attention: (facts) =>
      `${
        failedCommand(facts)
      } and nothing landed. Fix the cause, then run \`discern done\` before landing again.`,
  },
  failed: {
    qualifier: (facts) => `discern ${facts.entry.last_action?.verb ?? "verb"}`,
    explanation: (facts) => {
      const action = facts.entry.last_action;
      return `discern ${action?.verb ?? "verb"} ${
        action?.outcome === "partial"
          ? "finished only part of its work"
          : "failed"
      }${
        spacedAge(action?.at, facts.nowMs)
      }. Hand it back to its agent to fix it.`;
    },
    attention: (facts) =>
      `${failedCommand(facts)}. Fix the failure, then run it again.`,
  },
  "awaiting-owner": {
    qualifier: aheadQualifier,
    explanation: (facts) =>
      `${checksPassed(facts)}${
        sinceChecks(facts.entry)
      } Its agent asked to land it, and landing needs your approval.`,
    attention: (facts) =>
      `Its agent asked to land it; landing needs the owner's approval. The owner lands it with \`discern accept --target ${
        taskBranch(facts)
      } --confirmed\`.`,
  },
  refused: {
    qualifier: (facts) =>
      awaitedDeclaration(facts) !== undefined
        ? "checkpoint question"
        : `discern ${facts.entry.last_action?.verb ?? "verb"}`,
    explanation: (facts) =>
      awaitedDeclaration(facts) !== undefined
        ? "Its landing stopped on a checkpoint question about the combined code. Its agent needs to answer it before the landing continues."
        : `discern ${facts.entry.last_action?.verb ?? "verb"} was refused${
          spacedAge(facts.entry.last_action?.at, facts.nowMs)
        }. Its agent needs to read the refusal and do what it names.`,
    attention: (facts) => {
      const declaration = awaitedDeclaration(facts);
      if (declaration !== undefined) {
        return `Its landing waits for the agent's checkpoint answers about the combined code. Run \`discern accept\` in its worktree to be served the questions, then answer each with \`--met\` or \`--unmet\` and \`--composition-receipt ${declaration.composition}\`.`;
      }
      const action = facts.entry.last_action;
      const slug = action?.error === undefined ? "" : ` (${action.error})`;
      return `\`discern ${action?.verb ?? "verb"}\` was refused${
        spacedAge(action?.at, facts.nowMs)
      }${slug}. Read its refusal and complete the named prerequisite.`;
    },
  },
  "stale-proven": {
    qualifier: (facts) => `idle ${idleSpan(facts)}`,
    explanation: (facts) =>
      `No activity for ${idleSpan(facts)}. Its checks passed then${
        sinceChecks(facts.entry)
      } Land it, park it, or drop it.${queuedNote(facts)}`,
    attention: (facts) =>
      `No recorded activity for ${
        idleSpan(facts)
      }; its Proof still covers the clean HEAD. The owner can land it with \`discern accept --target ${
        taskBranch(facts)
      } --confirmed\`; otherwise ${STALE_COMMANDS(facts)}`,
  },
  stale: {
    qualifier: (facts) => `idle ${idleSpan(facts)}`,
    explanation: (facts) => {
      const changed = facts.entry.changed_files ?? 0;
      const ahead = positiveCount(facts.entry.ahead) ?? 0;
      return facts.entry.clean === false
        ? `No activity for ${idleSpan(facts)}, and ${
          plural(changed, "uncommitted file")
        } ${
          changed === 1 ? "is" : "are"
        } waiting. Resume its agent or drop it.${queuedNote(facts)}`
        : `No activity for ${idleSpan(facts)}, and its ${
          plural(ahead, "commit")
        } ${
          ahead === 1 ? "has" : "have"
        } no passing checks. Resume its agent, park it, or drop it.${
          queuedNote(facts)
        }`;
    },
    attention: (facts) =>
      `This worktree has unlanded work and no recorded activity for ${
        idleSpan(facts)
      }. Resume its agent, ${STALE_COMMANDS(facts)}`,
  },
  editing: {
    qualifier: (facts) => {
      const age = ageOf(facts.entry.last_activity, facts.nowMs);
      return age === undefined ? undefined : `active ${age}`;
    },
    explanation: (facts) =>
      `Its files changed${
        spacedAge(facts.entry.last_activity, facts.nowMs)
      } and aren't committed yet. An agent may still be working here.`,
    attention: () => undefined,
  },
  queued: {
    qualifier: (facts) =>
      facts.queueRow?.readiness === "waiting" ? "waiting" : "pre-authorized",
    explanation: (facts) =>
      facts.queueRow?.readiness === "waiting"
        ? `Its checks passed and you pre-authorized it, but it can't land yet. ${
          facts.queueRow.reason ?? ""
        }`.trimEnd()
        : "Its checks passed and you pre-authorized it. It lands the next time anything lands, or now if you choose Land.",
    attention: (facts) =>
      facts.queueRow?.readiness === "waiting"
        ? facts.queueRow.reason
        : undefined,
  },
  approved: {
    qualifier: (facts) =>
      facts.entry.landing_authority?.source === "standing-grant"
        ? "standing approval"
        : "pre-authorized",
    explanation: (facts) =>
      `Its checks passed and ${
        facts.entry.landing_authority?.source === "standing-grant"
          ? "your standing approval covers every changed path"
          : "you pre-authorized it"
      }. It isn't queued yet; it lands when you choose Land.`,
    attention: () => undefined,
  },
  ready: {
    qualifier: aheadQualifier,
    explanation: (facts) =>
      `${checksPassed(facts)}${sinceChecks(facts.entry)} ${
        landingNeeds(facts.entry)
      }`,
    attention: (facts) =>
      (facts.entry.landing_authority?.standing_scopes?.length ?? 0) > 0 &&
        (facts.entry.landing_authority?.uncovered?.length ?? 0) > 0
        ? "The clean branch has a valid Proof. Its recorded grant does not cover every changed path."
        : "The clean branch has a valid Proof and is ready for owner review; landing needs approval.",
  },
  behind: {
    qualifier: (facts) => {
      const behind = positiveCount(facts.entry.behind);
      return behind === undefined ? undefined : `${behind} behind main`;
    },
    explanation: (facts) =>
      `Main has ${
        plural(positiveCount(facts.entry.behind) ?? 0, "new commit")
      } this branch doesn't have, and its work has no passing checks yet. Update it from main, then run checks.`,
    attention: (facts) => {
      const behind = positiveCount(facts.entry.behind) ?? 0;
      return `Run \`discern update\` in this worktree. Its branch is ${
        plural(behind, "commit")
      } behind ${facts.trunk}.`;
    },
  },
  "proof-error": {
    qualifier: () => "unreadable",
    explanation: () =>
      "discern can't read its recorded checks, so they don't count. Run checks again to record them.",
    attention: (facts) => {
      const reason = fleetRowProof(facts.entry).reason;
      return `The clean branch's Proof is unreadable${
        reason === undefined ? "" : `: ${reason}`
      }. Repair the Proof state or run \`discern done\` again.`;
    },
  },
  "proof-unknown": {
    qualifier: () => "not inspected",
    explanation: () =>
      "discern couldn't inspect its recorded checks. Run checks to record them again.",
    attention: (facts) => {
      const reason = fleetRowProof(facts.entry).reason;
      return `The clean branch's Proof is unavailable${
        reason === undefined ? "" : `: ${reason}`
      }. Run \`discern done\` before review.`;
    },
  },
  recheck: {
    qualifier: () => "older commit",
    explanation: () =>
      "Its recorded checks are for an older commit. Run checks on the current one.",
    attention: () =>
      "The recorded Proof names another commit. Run `discern done` on the current clean HEAD before review.",
  },
  "needs-checks": {
    qualifier: aheadQualifier,
    explanation: (facts) =>
      `It has ${
        plural(positiveCount(facts.entry.ahead) ?? 0, "commit")
      } and no passing checks yet. Run checks once its agent is done.`,
    attention: () =>
      "This clean branch has committed work and no valid Proof. Run `discern done` before review.",
  },
  contained: {
    qualifier: (facts) => `in ${facts.entry.contained_in ?? "a later task"}`,
    explanation: (facts) =>
      `Its commits are all part of ${
        facts.entry.contained_in ?? "a later task"
      }, which carries them on. Its checkout can be reclaimed; the branch is kept.`,
    attention: (facts) =>
      `Its commits ride in \`${
        facts.entry.contained_in ?? "a later branch"
      }\`. Reclaim its checkout with \`discern worktree prune --contained\`; the branch stays until that work lands.`,
  },
  empty: {
    qualifier: (facts) => {
      const days = idleDaysOf(facts.entry.last_activity, facts.nowMs) ?? 0;
      return days === 0 ? undefined : `idle ${plural(days, "day")}`;
    },
    explanation: () => "No commits and no changes yet.",
    attention: () => undefined,
  },
  "idle-unknown": {
    qualifier: () => "counts unknown",
    explanation: () =>
      "Git couldn't count its commits against main, so discern can't tell whether it has work to land.",
    attention: () => undefined,
  },
} as const satisfies Record<FleetTaskRowStateId, TaskSentences>;

/** The branch states' sentences, keyed by state. */
export const BRANCH_ROW_SENTENCES = {
  parked: {
    qualifier: () => "no checkout",
    explanation: () =>
      "Its branch, title and brief are kept, but it has no checkout. Resuming gives it a fresh checkout on this branch.",
    attention: (facts) =>
      `Resume it with \`discern start --from ${facts.branch}\`.`,
  },
  landed: {
    qualifier: (facts) => ageOf(facts.at, facts.nowMs),
    explanation: (facts) =>
      `It landed on main${spacedAge(facts.at, facts.nowMs)}.`,
    attention: () => undefined,
  },
} as const satisfies Record<
  FleetBranchRowStateId,
  FleetRowSentences<FleetBranchRowFacts>
>;
