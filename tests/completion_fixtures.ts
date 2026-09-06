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
  context: "local",
  kind: "standard",
  definition: COMPLETION_DIGEST,
} as const;
export const COMPLETION_RECOVERY = {
  phase: "restore",
  reason: "restore command failed",
  children_quiescent: true,
  drift: { kind: "uncaptured", reason: "capture failed" },
  retained_paths: ["/workspace/evidence"],
  frozen_cleanup: ["cleanup owned resource"],
} as const;

const APPLICABILITY = ApplicabilitySchema.parse({
  producer: "jobs.test",
  context: "local",
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
      source: COMPLETION_SOURCE,
      dependencies: [],
      expected_predecessor: { head: "d".repeat(40), candidate_id: null },
      head: COMPLETION_HEAD,
      tree: COMPLETION_SOURCE.tree,
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
      composition: {
        procedure: COMPLETION_DIGEST,
        generated_ownership: COMPLETION_DIGEST,
        generators: COMPLETION_DIGEST,
        merge_commit: null,
        regeneration_commit: null,
      },
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
      environment_id: completionId(5),
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
        context: "local",
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
        context: "local",
        path: `environment/gate-proof-${completionId(4)}.json`,
        digest: COMPLETION_DIGEST,
        bytes: 123,
      },
    }),
    environment: parse("environment", 5, {
      path: "/workspace/effort-a",
      declaration: COMPLETION_DIGEST,
      ownership: {
        kind: "borrowed",
        source: COMPLETION_SOURCE,
        identity: {
          worktree_id: "effort-a",
          seed: 42,
          resources: { db: "effort_a" },
        },
      },
      release: {
        kind: "released",
        id: completionId(22),
        at: 15,
        owner: "effort-a",
        subject: COMPLETION_DIGEST,
        retirement: true,
      },
      state: { kind: "idle" },
    }),
    authority: parse("authority", 6, {
      source: {
        source: "effort-grant",
        record_id: completionId(23),
        scopes: [],
      },
      approved_at: 15,
      sources: [COMPLETION_SOURCE],
      composition_procedure: COMPLETION_DIGEST,
      policy: COMPLETION_DIGEST,
      predecessor_authorities: [],
      state: { kind: "granted" },
    }),
    queue: parse("queue", 7, {
      trunk: "d".repeat(40),
      entries: [{
        source: COMPLETION_SOURCE,
        provisional_order: 0,
        eligible_order: 0,
        approval_batch: completionId(24),
        candidate_id: completionId(1),
        authority_id: completionId(6),
        dependencies: [],
        state: "eligible",
        invalidation: null,
      }],
    }),
    landing: parse("landing", 8, {
      attempt_id: completionId(2),
      candidate_id: completionId(1),
      source: COMPLETION_SOURCE,
      executor: COMPLETION_EXECUTOR,
      expected_trunk: "d".repeat(40),
      target: COMPLETION_HEAD,
      policy: COMPLETION_DIGEST,
      claim: {
        kind: "normal",
        proof_id: completionId(4),
        authority_id: completionId(6),
        decisions: { judgments: [], variances: [], proposals: [] },
      },
      outcome: { kind: "planned" },
      authority_settlement: "pending",
      note: "pending",
    }),
    retirement: parse("retirement", 9, {
      landing_id: completionId(8),
      source: COMPLETION_SOURCE,
      environment_id: completionId(5),
      release_id: completionId(22),
      ownership: COMPLETION_DIGEST,
      frozen_cleanup: ["cleanup owned resource"],
      outcome: { kind: "pending" },
    }),
  };
}
