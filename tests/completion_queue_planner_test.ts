import { assert, assertEquals } from "@std/assert";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
  CompletionRecordSchema,
} from "../src/engine/completion/records.ts";
import { CompletionPolicySchema } from "../src/engine/completion/configuration.ts";
import {
  type CandidateAssessment,
  planQueue,
} from "../src/engine/landing_queue/planner.ts";
import { REPOSITORY_QUEUE_ID } from "../src/engine/landing_queue/repository.ts";
import {
  COMPLETION_DIGEST,
  COMPLETION_EXECUTOR,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { queueAuthority, queueExample } from "./completion_queue_fixture.ts";
import { observation } from "./completion_producers_fixtures.ts";
import { approveBatch } from "../src/engine/landing_queue/model.ts";
import type { AttemptIdentity } from "../src/engine/completion/identity.ts";
import type { CompletionBlocker } from "../src/engine/completion/protocol.ts";

/** Every prefix carries a distinct exact aggregate and a separately reserved transition. */
function fixture(count: number): Parameters<typeof planQueue>[0] {
  const { queue: provisional, candidates } = queueExample(count);
  const approvals = approveBatch(
    provisional,
    completionId(30),
    new Map(
      provisional.entries.map((
        entry,
        index,
      ) => [entry.source.effort_id, queueAuthority(index)]),
    ),
  );
  assert(approvals.kind === "changed");
  const queue = approvals.queue;
  const records: CompletionRecord[] = [{
    version: 1,
    kind: "queue",
    id: REPOSITORY_QUEUE_ID,
    revision: 1,
    data: queue,
  }];
  const assessments = new Map<string, CandidateAssessment>();
  const transitions = new Map<string, AttemptIdentity>();
  let predecessor = { head: queue.trunk, candidate_id: null as string | null };
  for (const [id, sourceCandidate] of candidates) {
    const candidate = { ...sourceCandidate, expected_predecessor: predecessor };
    const authority = queue.entries.find((entry) => entry.candidate_id === id)
      ?.authority_id;
    assert(authority !== null && authority !== undefined);
    const proof = COMPLETION_FAMILIES.proof.schema.parse(
      completionFixtures().proof,
    );
    const exactProof = {
      ...proof,
      id: completionId(1000 + assessments.size),
      data: {
        ...proof.data,
        candidate_id: id,
        head: candidate.head,
        policy: candidate.policy,
        receipts: proof.data.receipts.map((receipt) => ({
          ...receipt,
          candidate_id: id,
          policy: candidate.policy,
        })),
      },
    };
    records.push(exactProof);
    assessments.set(id, {
      candidate_id: id,
      candidate,
      proof: exactProof,
      blockers: [],
      authority_id: authority,
      decisions: { judgments: [], variances: [], proposals: [] },
      refresh: null,
    });
    const attempt = COMPLETION_FAMILIES.attempt.schema.parse(
      completionFixtures().attempt,
    );
    const identity = {
      ...attempt.data.identity,
      candidate_id: id,
      id: completionId(2000 + assessments.size),
      sequence: 100 + assessments.size,
    };
    records.push({
      ...attempt,
      id: identity.id,
      data: { ...attempt.data, identity, subjects: [] },
    });
    transitions.set(id, identity);
    predecessor = { head: candidate.head, candidate_id: id };
  }
  return {
    observation: {
      ...observation(
        records.map((record) => CompletionRecordSchema.parse(record)),
      ),
      trunk: queue.trunk,
    },
    assessments,
    transition_attempts: transitions,
    policy: CompletionPolicySchema.parse({ concurrency: 2, lookahead: 2 }),
    requested_effort: `effort-${count - 1}`,
    executor: COMPLETION_EXECUTOR,
  };
}

Deno.test("queue Q04: combined Proof cannot prove an unvalidated intermediate prefix", () => {
  for (const count of [2, 3, 4, 5, 80]) {
    const input = fixture(count);
    const all = planQueue(input);
    assertEquals(all.actions.length, count);
    assertEquals(
      planQueue({
        ...input,
        observation: {
          ...input.observation,
          records: input.observation.records.filter(({ selector }) =>
            selector.kind !== "proof"
          ),
        },
      }).actions,
      [],
    );
    const assessments = new Map(input.assessments);
    const first = assessments.get(completionId(100));
    assert(first !== undefined);
    assessments.set(first.candidate_id, { ...first, proof: null });
    assertEquals(planQueue({ ...input, assessments }).actions, []);
    assessments.set(first.candidate_id, first);
    const second = assessments.get(completionId(101));
    assert(second !== undefined);
    assessments.set(second.candidate_id, { ...second, proof: null });
    assertEquals(planQueue({ ...input, assessments }).actions.length, 1);
    assertEquals(
      all.actions.filter((action) => action.kind === "land").map((action) =>
        action.record.data.expected_trunk
      ),
      [...input.assessments.values()].map((entry) =>
        entry.candidate.expected_predecessor.head
      ),
    );
  }
});

Deno.test("queue Q07: planning is read-only and preserves distinct stops", () => {
  const input = fixture(2);
  const first = input.assessments.get(completionId(100));
  assert(first !== undefined);
  const stops: CompletionBlocker[] = [
    { kind: "missing-judgment", subjects: ["checkpoint"] },
    { kind: "missing-authority", sources: [first.candidate.source] },
    { kind: "environment-unavailable", reason: "no released checkout" },
    { kind: "validation-failed", evidence_ids: [completionId(3)] },
  ];
  const before = JSON.stringify(input.observation);
  for (const stop of stops) {
    const assessments = new Map(input.assessments).set(first.candidate_id, {
      ...first,
      blockers: [stop],
    });
    assertEquals(planQueue({ ...input, assessments }).blockers, [stop]);
  }
  assertEquals(JSON.stringify(input.observation), before);
});

Deno.test("queue Q06: two actors coordinate one exact transition and an absent actor requires recovery", () => {
  const input = fixture(2);
  const planned = planQueue(input);
  const action = planned.actions[0];
  assert(action?.kind === "land");
  const records = input.observation.records.flatMap(({ reading }) =>
    reading.kind === "recorded" ? [reading.record] : []
  );
  records.push(action.record);
  const current = { ...observation(records), trunk: input.observation.trunk };
  const own = planQueue({ ...input, observation: current });
  assertEquals(own.actions[0], {
    ...action,
    expected_stamp: COMPLETION_DIGEST,
  });
  const other = planQueue({
    ...input,
    observation: current,
    executor: { ...input.executor, operation_id: completionId(5000) },
  });
  assertEquals(other.actions, []);
  assertEquals(other.blockers[0]?.kind, "waiting-for-operation");
  const expired = planQueue({
    ...input,
    observation: { ...current, observed_at: 201 },
    executor: { ...input.executor, operation_id: completionId(5000) },
  });
  assertEquals(expired.blockers[0]?.kind, "recovery-incomplete");
});
