/** Canonical contract fixtures shared by record, IO, and domain-port exercises. */
import {
  type CompletionFamily,
  type CompletionRecord,
  CompletionRecordSchema,
} from "../src/engine/completion/records.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import {
  ApplicabilitySchema,
  applicabilitySubject,
} from "../src/engine/completion/evidence.ts";
import type { Clock } from "../src/shared/clock.ts";

/** Give fixture records distinct, deterministic UUID coordinates. */
export function completionId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
export const COMPLETION_DIGEST = "a".repeat(64);
export const COMPLETION_HEAD = "b".repeat(40);
export const COMPLETION_TRUNK = "d".repeat(40);
export const COMPLETION_CLOCK: Clock = {
  wallNow: () => 100,
  monotonicNow: () => 10,
};
export const COMPLETION_SOURCE = {
  effort_id: "effort-a",
  branch: "refs/heads/agent/effort-a",
  head: COMPLETION_HEAD,
  tree: "c".repeat(40),
};
export const COMPLETION_EXECUTOR = {
  operation_id: completionId(20),
  originating_effort: "effort-a",
  started_at: 10,
};
export const COMPLETION_CLAIM = {
  token: completionId(21),
  executor: COMPLETION_EXECUTOR,
  acquired_at: 20,
  expires_at: 200,
};
export const COMPLETION_REQUIREMENT = {
  id: "coverage",
  kind: "standard",
  definition: COMPLETION_DIGEST,
} as const;

const APPLICABILITY = ApplicabilitySchema.parse({
  producer: "jobs.test",
  policy: COMPLETION_DIGEST,
  protected_definitions: COMPLETION_DIGEST,
  command: COMPLETION_DIGEST,
  extractor: COMPLETION_DIGEST,
  inputs: COMPLETION_DIGEST,
  denominator_inputs: COMPLETION_DIGEST,
  toolchain: COMPLETION_DIGEST,
  environment: COMPLETION_DIGEST,
  seed: 42,
  closure: { kind: "declared", declaration: COMPLETION_DIGEST },
});
const SUBJECT = await applicabilitySubject(APPLICABILITY);

/** A mapped fixture makes a new family require meaningful round-trip evidence. */
export function completionFixtures(): Record<
  CompletionFamily,
  CompletionRecord
> {
  const header = {
    version: ON_DISK_FORMATS.completionRecord.version,
    revision: 1,
  };
  const parse = (
    kind: CompletionFamily,
    id: number,
    data: unknown,
  ): CompletionRecord =>
    CompletionRecordSchema.parse({
      ...header,
      kind,
      id: completionId(id),
      data,
    });
  return {
    candidate: parse("candidate", 1, {
      attempt_id: completionId(2),
      sources: [COMPLETION_SOURCE],
      predecessor: COMPLETION_TRUNK,
      head: COMPLETION_HEAD,
      tree: COMPLETION_SOURCE.tree,
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
    }),
    attempt: parse("attempt", 2, {
      identity: {
        id: completionId(2),
        candidate_id: completionId(1),
        executor: COMPLETION_EXECUTOR,
        sequence: 1,
        rerun_of: null,
        started_at: 10,
      },
      subjects: [SUBJECT],
      purpose: "completion",
      mode: "strict",
      state: { kind: "claimed", claim: COMPLETION_CLAIM },
    }),
    evidence: parse("evidence", 3, {
      attempt_id: completionId(2),
      candidate_id: completionId(1),
      sequence: 1,
      purpose: "completion",
      mode: "strict",
      applicability: APPLICABILITY,
      finished_at: 99,
      artifacts: [{
        attempt_id: completionId(2),
        candidate_id: completionId(1),
        path: "coverage/report.json",
        digest: COMPLETION_DIGEST,
        bytes: 123,
      }],
      outcome: {
        kind: "passed",
        capture_complete: true,
        metrics: { coverage: 99 },
      },
    }),
    proof: parse("proof", 4, {
      attempt_id: completionId(2),
      candidate_id: completionId(1),
      head: COMPLETION_HEAD,
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
      mode: "strict",
      requirements: [COMPLETION_REQUIREMENT],
      receipts: [{
        requirement: COMPLETION_REQUIREMENT,
        evidence_id: completionId(3),
        candidate_id: completionId(1),
        policy: COMPLETION_DIGEST,
        reading: 99,
      }],
      assembled_at: 100,
    }),
    presentation: parse("presentation", 4, {
      candidate_id: completionId(1),
      artifact: {
        attempt_id: completionId(2),
        candidate_id: completionId(1),
        path: `environment/gate-proof-${completionId(4)}.json`,
        digest: COMPLETION_DIGEST,
        bytes: 123,
      },
    }),
    exception: parse("exception", 6, {
      claim: {
        kind: "exception",
        authorization_id: completionId(6),
        authorized_at: 15,
        actual_trunk: COMPLETION_TRUNK,
        source: COMPLETION_SOURCE,
        candidate_id: completionId(1),
        candidate_head: COMPLETION_HEAD,
        policy: COMPLETION_DIGEST,
        reason: "broken trunk repair",
        exceptions: [{
          requirement: COMPLETION_REQUIREMENT,
          state: "failed",
          evidence_id: null,
        }],
      },
      executor: COMPLETION_EXECUTOR,
      expected_trunk: COMPLETION_TRUNK,
      target: COMPLETION_HEAD,
      outcome: { kind: "planned" },
      note: "pending",
    }),
  };
}
