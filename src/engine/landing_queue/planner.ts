import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Active commands consume per-prefix plans. This port runs no validation or ref transition. */
import type { Candidate } from "../completion/candidate.ts";
import type { CompletionPolicy } from "../../shared/config_schema.ts";
import type { AttemptIdentity, Executor } from "../completion/identity.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type {
  CompletionBlocker,
  CompletionObservation,
  EnvironmentPlan,
  QueueAction,
  QueuePlan,
  QueuePlanner,
  ValidationPlan,
} from "../completion/protocol.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { withQueueLock } from "./repository.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import type { CandidateDecisions } from "./authority.ts";
import { retainedExecutionCount, workCapacity } from "./claims.ts";
import { expectedPredecessor, orderedEntries, sameSource } from "./model.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  REPOSITORY_QUEUE_ID,
  requireQueue,
} from "./repository.ts";

/** The observer composes source/grant/judgment/policy audits and the current producer evaluator. */
export interface CandidateAssessment {
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly blockers: readonly CompletionBlocker[];
  readonly proof: Extract<CompletionRecord, { kind: "proof" }> | null;
  readonly authority_id: string | null;
  readonly decisions: CandidateDecisions;
  readonly refresh: {
    readonly plan: ValidationPlan;
    readonly environment: EnvironmentPlan;
  } | null;
}

/** Distinguish a live actor from expired or absent execution ownership. */
function activeBlocker(
  observation: CompletionObservation,
  id: string,
): CompletionBlocker {
  const attempts = observedRecords(observation).filter((
    record,
  ): record is Extract<CompletionRecord, { kind: "attempt" }> =>
    record.kind === "attempt" && record.data.identity.candidate_id === id
  )
    .sort((a, b) => b.data.identity.sequence - a.data.identity.sequence);
  const current = attempts[0];
  if (current?.data.state.kind === "recovery") {
    return {
      kind: "recovery-incomplete",
      record_id: current.id,
      recovery: current.data.state.recovery,
    };
  }
  if (
    current?.data.state.kind === "claimed" &&
    current.data.state.claim.expires_at > observation.observed_at
  ) {
    return {
      kind: "waiting-for-operation",
      attempt_id: current.id,
      expires_at: current.data.state.claim.expires_at,
    };
  }
  return {
    kind: "recovery-incomplete",
    record_id: current?.id ?? id,
    recovery: {
      phase: "publish",
      reason:
        "The work reservation has no live actor. Reconcile its attempt and environment before claiming work again.",
      children_quiescent: false,
      drift: {
        kind: "uncaptured",
        reason: "Execution ownership has not been reconciled.",
      },
      retained_paths: [],
      frozen_cleanup: [],
    },
  };
}

/** An aggregate Proof belongs to one exact prefix, independently of reused components. */
function proofMatches(
  assessment: CandidateAssessment,
  observation: CompletionObservation,
): boolean {
  const proof = assessment.proof?.data;
  const recorded = observedRecords(observation).find((record) =>
    record.kind === "proof" && record.id === assessment.proof?.id
  );
  return proof !== undefined && proof.mode === "strict" &&
    recorded?.kind === "proof" &&
    JSON.stringify(recorded.data) === JSON.stringify(proof) &&
    proof.candidate_id === assessment.candidate_id &&
    proof.head === assessment.candidate.head &&
    proof.policy === assessment.candidate.policy &&
    proof.requirement_set === assessment.candidate.requirement_set;
}

/** Reuse an exact planned transition; another actor or unfinished recovery remains explicit. */
function transitionAction(input: {
  observation: CompletionObservation;
  assessment: CandidateAssessment;
  authority: string;
  expected: string;
  executor: Executor;
  attempt: AttemptIdentity | undefined;
}): Extract<QueueAction, { kind: "land" }> | CompletionBlocker {
  const { observation, assessment, authority, expected, executor, attempt } =
    input;
  const existing = observation.records.find(({ reading }) =>
    reading.kind === "recorded" && reading.record.kind === "landing" &&
    reading.record.data.candidate_id === assessment.candidate_id &&
    reading.record.data.outcome.kind !== "not-landed"
  )?.reading;
  if (
    existing !== undefined && existing.kind !== "missing" &&
    existing.kind !== "recorded"
  ) {
    return {
      kind: "environment-unavailable",
      reason: "The transition record cannot be read; preserve it for recovery.",
    };
  }
  if (existing?.kind === "recorded" && existing.record.kind === "landing") {
    const record = existing.record;
    if (record.data.outcome.kind === "recovery") {
      return {
        kind: "recovery-incomplete",
        record_id: record.id,
        recovery: record.data.outcome.recovery,
      };
    }
    if (record.data.outcome.kind !== "planned") {
      return {
        kind: "stale-evidence",
        evidence_ids: [],
        reason: "predecessor-changed",
      };
    }
    const owner = observedRecords(observation).find((item) =>
      item.kind === "attempt" && item.id === record.data.attempt_id
    );
    if (
      JSON.stringify(record.data.executor) !== JSON.stringify(executor) ||
      owner?.kind !== "attempt" ||
      owner.data.state.kind !== "claimed" ||
      owner.data.state.claim.expires_at <= observation.observed_at
    ) return activeBlocker(observation, assessment.candidate_id);
    if (
      record.data.expected_trunk !== expected ||
      record.data.target !== assessment.candidate.head ||
      record.data.claim.kind !== "normal" ||
      record.data.claim.authority_id !== authority ||
      record.data.claim.proof_id !== assessment.proof?.id ||
      JSON.stringify(record.data.claim.decisions) !==
        JSON.stringify(assessment.decisions)
    ) {
      return {
        kind: "missing-judgment",
        subjects: ["planned-transition-subject-changed"],
      };
    }
    return { kind: "land", record, expected_stamp: existing.stamp };
  }
  const claim = observedRecords(observation).find((record) =>
    record.kind === "attempt" && record.id === attempt?.id
  );
  if (
    attempt === undefined || attempt.candidate_id !== assessment.candidate_id ||
    JSON.stringify(attempt.executor) !== JSON.stringify(executor) ||
    assessment.proof === null ||
    claim?.kind !== "attempt" ||
    JSON.stringify(claim.data.identity) !== JSON.stringify(attempt) ||
    claim.data.state.kind !== "claimed" ||
    claim.data.state.claim.expires_at <= observation.observed_at
  ) {
    return { kind: "missing-evidence", requirements: [] };
  }
  return {
    kind: "land",
    expected_stamp: null,
    record: {
      version: ON_DISK_FORMATS.completionRecord.version,
      kind: "landing",
      id: attempt.id,
      revision: 1,
      data: {
        attempt_id: attempt.id,
        candidate_id: assessment.candidate_id,
        source: assessment.candidate.source,
        executor,
        expected_trunk: expected,
        target: assessment.candidate.head,
        policy: assessment.candidate.policy,
        claim: {
          kind: "normal",
          proof_id: assessment.proof.id,
          authority_id: authority,
          decisions: assessment.decisions,
        },
        outcome: { kind: "planned" },
        authority_settlement: "pending",
        note: "pending",
      },
    },
  };
}

/** Each action has its own expected trunk, complete Proof, authority and exact decisions. */
export function planQueue(input: {
  readonly observation: CompletionObservation;
  readonly policy: CompletionPolicy;
  readonly requested_effort: string;
  readonly assessments: ReadonlyMap<string, CandidateAssessment>;
  readonly executor: Executor;
  readonly transition_attempts: ReadonlyMap<string, AttemptIdentity>;
}): QueuePlan {
  const reading = input.observation.records.find(({ selector }) =>
    selector.kind === "queue" && selector.id === REPOSITORY_QUEUE_ID
  )?.reading;
  if (reading?.kind !== "recorded" || reading.record.kind !== "queue") {
    throw new Error(
      "A supported repository queue must be initialized before planning.",
    );
  }
  const queue = reading.record.data;
  const actions: QueueAction[] = [];
  const blockers: CompletionBlocker[] = [];
  const result: QueuePlan = {
    queue_id: REPOSITORY_QUEUE_ID,
    expected_stamp: reading.stamp,
    queue,
    actions,
    blockers,
  };
  if (queue.trunk !== input.observation.trunk) {
    blockers.push({
      kind: "stale-evidence",
      evidence_ids: [],
      reason: "external-trunk",
    });
    return result;
  }
  const entries = orderedEntries(queue);
  const requested = entries.findIndex((entry) =>
    entry.source.effort_id === input.requested_effort
  );
  if (requested < 0) return result;
  const candidates = new Map(
    [...input.assessments].map((
      [id, assessment],
    ) => [id, assessment.candidate]),
  );
  for (const entry of entries.slice(0, requested + 1)) {
    const assessment = entry.candidate_id === null
      ? undefined
      : input.assessments.get(entry.candidate_id);
    const stop = (blocker: CompletionBlocker): QueuePlan => {
      const stops = [blocker, ...assessment?.blockers ?? []];
      blockers.push(
        ...new Map(stops.map((item) => [JSON.stringify(item), item])).values(),
      );
      return result;
    };
    if (entry.authority_id === null) {
      return stop({ kind: "missing-authority", sources: [entry.source] });
    }
    if (
      entry.dependencies.some((dependency) =>
        entries.findIndex((item) => item.source.effort_id === dependency) >
          entries.indexOf(entry)
      )
    ) {
      return stop({
        kind: "missing-judgment",
        subjects: ["source-dependency-order"],
      });
    }
    if (entry.state === "failed") {
      return stop({ kind: "validation-failed", evidence_ids: [] });
    }
    if (entry.state === "active" && entry.candidate_id !== null) {
      return stop(activeBlocker(input.observation, entry.candidate_id));
    }
    if (assessment === undefined) {
      return stop({ kind: "missing-evidence", requirements: [] });
    }
    if (!sameSource(entry.source, assessment.candidate.source)) {
      return stop({
        kind: "stale-evidence",
        evidence_ids: [],
        reason: "source-replaced",
      });
    }
    const expected = expectedPredecessor(
      queue,
      entry.source.effort_id,
      candidates,
    );
    if ("kind" in expected) return stop(expected);
    if (
      expected.head !== assessment.candidate.expected_predecessor.head ||
      entry.invalidation !== null
    ) {
      const blocked = assessment.blockers.find((item) =>
        item.kind !== "missing-evidence" && item.kind !== "stale-evidence"
      );
      if (blocked !== undefined) return stop(blocked);
      const environment = assessment.refresh?.environment;
      if (
        environment === undefined || environment.declaration === null ||
        environment.expected_stamp === null
      ) {
        return stop({
          kind: "environment-unavailable",
          reason:
            "The changed predecessor needs composition in a declared, explicitly released environment.",
        });
      }
      const capacity = workCapacity(
        entries,
        entry.source.effort_id,
        input.policy,
        false,
        retainedExecutionCount(entries, input.observation),
      );
      if (capacity !== undefined) return stop(capacity);
      actions.push({
        kind: "compose",
        source: entry.source,
        predecessor: expected,
        environment_id: environment.environment_id,
        expected_stamp: environment.expected_stamp,
      });
      return result;
    }
    const blocker = assessment.blockers.find((item) =>
      item.kind !== "missing-evidence" && item.kind !== "stale-evidence"
    ) ?? assessment.blockers[0];
    if (
      blocker !== undefined && blocker.kind !== "missing-evidence" &&
      blocker.kind !== "stale-evidence"
    ) {
      return stop(blocker);
    }
    if (blocker !== undefined || !proofMatches(assessment, input.observation)) {
      if (assessment.refresh === null) {
        return stop(blocker ?? { kind: "missing-evidence", requirements: [] });
      }
      const capacity = workCapacity(
        entries,
        entry.source.effort_id,
        input.policy,
        assessment.candidate.head === assessment.candidate.source.head &&
          assessment.candidate.expected_predecessor.head === queue.trunk,
        retainedExecutionCount(entries, input.observation),
      );
      if (capacity !== undefined) {
        return stop(capacity);
      }
      actions.push({ kind: "validate", ...assessment.refresh });
      return result;
    }
    if (assessment.authority_id !== entry.authority_id) {
      return stop({ kind: "missing-authority", sources: [entry.source] });
    }
    const action = transitionAction({
      observation: input.observation,
      assessment,
      authority: entry.authority_id,
      expected: expected.head,
      executor: input.executor,
      attempt: input.transition_attempts.get(assessment.candidate_id),
    });
    if (action.kind !== "land") {
      return stop(action);
    }
    actions.push(action);
  }
  return result;
}

/** Bind read-only assessment and pure planning to short, optimistic publication. */
export function createQueuePlanner(options: {
  readonly root: string;
  readonly trunk: string;
  readonly executor: Executor;
  readonly transition_attempts: ReadonlyMap<string, AttemptIdentity>;
  readonly assess: (
    observation: CompletionObservation,
  ) => Promise<ReadonlyMap<string, CandidateAssessment>>;
  readonly clock?: Clock;
}): QueuePlanner {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const assessments = new WeakMap<
    CompletionObservation,
    ReadonlyMap<string, CandidateAssessment>
  >();
  const contexts = new WeakMap<
    QueuePlan,
    { policy: CompletionPolicy; effort: string }
  >();
  const observe = async (): Promise<CompletionObservation> => {
    const observation = await observeQueue(options.root, options.trunk, clock);
    assessments.set(observation, await options.assess(observation));
    return observation;
  };
  const plan = (
    observation: CompletionObservation,
    policy: CompletionPolicy,
    effort: string,
  ): QueuePlan => {
    const current = assessments.get(observation);
    if (current === undefined) {
      throw new Error(
        "Queue plan requires its own current observation and audits.",
      );
    }
    const result = planQueue({
      observation,
      policy,
      requested_effort: effort,
      assessments: current,
      executor: options.executor,
      transition_attempts: options.transition_attempts,
    });
    contexts.set(result, { policy, effort });
    return result;
  };
  return {
    observe,
    plan,
    publish: async (proposal, executor) => {
      const context = contexts.get(proposal);
      if (
        context === undefined ||
        executor.operation_id !== options.executor.operation_id
      ) return { kind: "replan" };
      // Expensive artifact and composition audits finish before the short publication lock.
      const observation = await observe();
      const fresh = plan(observation, context.policy, context.effort);
      if (JSON.stringify(fresh) !== JSON.stringify(proposal)) {
        return { kind: "replan" };
      }
      return await withQueueLock(options.root, async () => {
        const queue = await requireQueue(options.root);
        if (queue.stamp !== proposal.expected_stamp) return { kind: "replan" };
        const current = await observeQueue(options.root, options.trunk, clock);
        if (
          current.trunk !== observation.trunk ||
          JSON.stringify(current.records) !==
            JSON.stringify(observation.records)
        ) return { kind: "replan" };
        for (const action of proposal.actions) {
          if (action.kind !== "land") continue;
          if (action.expected_stamp !== null) continue;
          const written = await writeCompletionRecord(
            options.root,
            action.record,
            action.expected_stamp,
            undefined,
            clock,
          );
          if (written.kind !== "written") return { kind: "replan" };
        }
        const written = await replaceQueue(
          options.root,
          queue,
          proposal.queue,
          clock,
        );
        return written.kind === "written"
          ? { kind: "published" }
          : { kind: "replan" };
      });
    },
  };
}
