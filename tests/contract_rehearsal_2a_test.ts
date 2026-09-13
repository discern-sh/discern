/**
 * Compatibility rehearsal against the finished integration-landing contract.
 *
 * Schema and reader fixtures only — no batching, speculation, or concurrent
 * execution is implemented here. The rehearsal shows which future additions
 * the launch contracts already absorb:
 *
 * COMPATIBLE within the current majors — multiple exact composition inputs
 * (the candidate's `sources` list plus its closed `integration` procedure),
 * additional per-submission landing outcomes in `data.landings`, optional
 * queue and progress detail (new optional fields, unknown fields for pinned
 * additive readers, extra rows), optional configuration keys added by a later
 * release (existing documents keep their meaning), and private
 * journal/record fields behind the registered forward-skew policies.
 *
 * STILL A PUBLIC-PROMISE CHANGE — widening a closed result enum (queue
 * `readiness`, a landing outcome's `status`), changing `data.landing` away
 * from the selected landing's projection, making an optional field required,
 * changing an existing configuration default, or a Proof-note payload whose
 * required claim changes shape (a new payload version). No design can
 * pre-approve every future feature; those keep their explicit decisions.
 */

import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { CandidateSchema } from "../src/engine/completion/candidate.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import {
  AcceptDataSchema,
  LandingOutcomeSchema,
  ProofNotePayloadSchema,
  SubmissionRowSchema,
  TolerantProofNotePayloadSchema,
} from "../src/shared/result_schemas.ts";
import { COMPLETION_SOURCE, completionId } from "./completion_fixtures.ts";

const DIGEST = "a".repeat(64);
const TRUNK = "1".repeat(40);
const MERGED = "2".repeat(40);

/** A second exact source revision beside the shared fixture's. */
const SECOND_SOURCE = {
  effort_id: "second-effort",
  branch: "refs/heads/agent/second-effort",
  head: "4".repeat(40),
  tree: "5".repeat(40),
};

Deno.test("the candidate already represents multiple exact composition inputs as data", () => {
  const parsed = CandidateSchema.parse({
    attempt_id: completionId(2),
    sources: [COMPLETION_SOURCE, SECOND_SOURCE],
    predecessor: TRUNK,
    head: MERGED,
    tree: "3".repeat(40),
    policy: DIGEST,
    requirement_set: DIGEST,
    integration: { procedure: "merge-trunk" },
  });
  assertEquals(parsed.sources.length, 2);
  // Executing a multi-input composition stays unimplemented: the schema
  // holds the representation, and the runtime still supplies one entry.
});

Deno.test("one call describes several landing outcomes, overlapping checks included, as data", () => {
  const outcomes = z.array(LandingOutcomeSchema).parse([
    {
      effort: "one",
      branch: "agent/one",
      head: TRUNK,
      selected: true,
      status: "landed",
      landed_commit: TRUNK,
    },
    {
      effort: "two",
      branch: "agent/two",
      head: MERGED,
      selected: false,
      status: "landed",
      landed_commit: "6".repeat(40),
      integrated: true,
    },
  ]);
  assertEquals(outcomes.filter((outcome) => outcome.selected).length, 1);
  // Two rows checked at once — a future scheduler's shape — is expressible
  // today: distinct running handles on separate waiting rows.
  const rows = z.array(SubmissionRowSchema).parse([
    {
      effort: "three",
      branch: "agent/three",
      path: "/fleet/three",
      head: TRUNK,
      submitted_at: "2026-09-12T10:00:00.000Z",
      authority: "pre-authorized",
      position: 1,
      readiness: "waiting",
      reason: "A running landing is checking its combined code now.",
      integration: true,
      operation_handle: "R1-AAAA-AAAA-AA",
    },
    {
      effort: "four",
      branch: "agent/four",
      path: "/fleet/four",
      head: MERGED,
      submitted_at: "2026-09-12T10:01:00.000Z",
      authority: "awaiting-owner",
      position: 2,
      readiness: "waiting",
      reason: "A running landing is checking its combined code now.",
      integration: true,
      operation_handle: "R1-BBBB-BBBB-BB",
    },
  ]);
  assertEquals(new Set(rows.map((row) => row.operation_handle)).size, 2);
});

Deno.test("a pre-2A accept result still reads, and additive queue detail passes a pinned additive reader", () => {
  // Yesterday's shape — no landings collection, no integration detail —
  // remains a valid current document: the additions are optional.
  const legacy = AcceptDataSchema.parse({
    root: "/repo",
    consent: { source: "conversation" },
    landing: {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    },
  });
  assertEquals(legacy.landings, undefined);

  // A pinned version-1 consumer reads additive output by ignoring unknown
  // object fields (the published result schema's contract), so tomorrow's
  // optional scheduling detail cannot break it.
  const additiveReader = z.looseObject({
    readiness: z.enum(["ready", "waiting"]),
    position: z.number(),
  });
  const future = additiveReader.parse({
    readiness: "waiting",
    position: 1,
    // Hypothetical future optional detail, unknown to the pinned reader:
    scheduled_after: "R1-CCCC-CCCC-CC",
    checks: [{ started_at: 1, finished_at: null }],
  });
  assertEquals(future.readiness, "waiting");

  // The strict current producer rejects the same unknown fields: additive
  // tolerance is the consumer's contract, never a writer loophole.
  const strict = SubmissionRowSchema.safeParse({
    effort: "five",
    branch: "agent/five",
    path: "/fleet/five",
    head: TRUNK,
    submitted_at: "2026-09-12T10:00:00.000Z",
    authority: "awaiting-owner",
    position: 1,
    readiness: "ready",
    scheduled_after: "R1-CCCC-CCCC-CC",
  });
  assert(!strict.success);
});

Deno.test("a hypothetical optional setting keeps existing configuration meaningful", () => {
  const today = {
    project: { slug: "rehearsal" },
    repository: { trunk: "main" },
  };
  assert(configSchema.safeParse(today).success);
  // A later release adds an optional section: every existing valid document
  // parses under the extended schema with unchanged meaning.
  const future = configSchema.safeParse.bind(
    // The rehearsal's stand-in for a future engine: today's closed schema
    // plus one optional addition. Adding it changes no existing key,
    // default, or meaning.
    z.object({ landing_queue: z.object({}).optional() }).and(configSchema),
  );
  assert(future(today).success);
  // Today's closed input schema rejects the unknown key — the recorded
  // ADR 0208 limitation: a cached old schema may reject additions, and the
  // engine's migrations remain the authority for moving between releases.
  assert(
    !configSchema.safeParse({ ...today, landing_queue: {} }).success,
  );
});

Deno.test("representative old Proof-note readers stay usable while the current producer stays strict", () => {
  const claim = {
    candidate_id: completionId(1),
    proof_id: completionId(2),
    candidate: {
      attempt_id: completionId(2),
      sources: [COMPLETION_SOURCE],
      predecessor: TRUNK,
      head: COMPLETION_SOURCE.head,
      tree: COMPLETION_SOURCE.tree,
      policy: DIGEST,
      requirement_set: DIGEST,
    },
    validation: {
      attempt_id: completionId(2),
      candidate_id: completionId(1),
      head: COMPLETION_SOURCE.head,
      policy: DIGEST,
      requirement_set: DIGEST,
      mode: "strict",
      requirements: [{ id: "lint", kind: "job", definition: DIGEST }],
      receipts: [{
        requirement: { id: "lint", kind: "job", definition: DIGEST },
        evidence_id: completionId(3),
        candidate_id: completionId(1),
        policy: DIGEST,
        reading: null,
      }],
      assembled_at: 100,
    },
    components: [{
      id: completionId(3),
      evidence: {
        attempt_id: completionId(2),
        candidate_id: completionId(1),
        sequence: 1,
        purpose: "completion",
        mode: "strict",
        applicability: {
          producer: "job:lint",
          policy: DIGEST,
          protected_definitions: DIGEST,
          command: DIGEST,
          extractor: DIGEST,
          inputs: DIGEST,
          denominator_inputs: DIGEST,
          toolchain: DIGEST,
          environment: DIGEST,
          seed: 1,
          closure: { kind: "candidate", head: COMPLETION_SOURCE.head },
        },
        finished_at: 90,
        artifacts: [],
        outcome: {
          kind: "passed",
          capture_complete: true,
          metrics: {},
        },
      },
    }],
    attempts: [{
      identity: {
        id: completionId(2),
        candidate_id: completionId(1),
        executor: {
          operation_id: completionId(20),
          originating_effort: COMPLETION_SOURCE.effort_id,
          started_at: 10,
        },
        sequence: 1,
        rerun_of: null,
        started_at: 10,
      },
      subjects: [],
      purpose: "completion",
      mode: "strict",
      state: { kind: "finished", outcome: "passed", finished_at: 95 },
    }],
    executors: [{
      operation_id: completionId(20),
      originating_effort: COMPLETION_SOURCE.effort_id,
      started_at: 10,
    }],
  };
  const payload = {
    subject: { commit: COMPLETION_SOURCE.head },
    proof: {
      completion: claim,
      branch: "agent/one",
      trunk: "main",
      head: COMPLETION_SOURCE.head.slice(0, 12),
      files_total: 1,
      insertions: 1,
      deletions: 0,
    },
    presentation: { line: "> **Proof:** …", markdown: "# Proof\n" },
  };
  assert(ProofNotePayloadSchema.safeParse(payload).success);
  // A durable reader keeps reading when optional future fields appear at
  // several levels; the strict producer refuses to write them.
  const withAdditions = {
    ...payload,
    scheduling: { queue_position: 3 },
    proof: { ...payload.proof, combined_inputs: 1 },
  };
  assert(TolerantProofNotePayloadSchema.safeParse(withAdditions).success);
  assert(!ProofNotePayloadSchema.safeParse(withAdditions).success);
});
