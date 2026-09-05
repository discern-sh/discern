/** Candidate decisions and queue stops remain separate from machine success. */
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  COMPLETION_DIGEST,
  COMPLETION_EXECUTOR,
  COMPLETION_RECOVERY,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
} from "../src/engine/completion/records.ts";
import { RecoverySchema } from "../src/engine/completion/environment.ts";
import { CompletionPolicySchema } from "../src/engine/completion/configuration.ts";
import { observation } from "./completion_producers_fixtures.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import {
  type CandidateAssessment,
  planQueue,
} from "../src/engine/landing_queue/planner.ts";
import { REPOSITORY_QUEUE_ID } from "../src/engine/landing_queue/repository.ts";
import {
  evaluatePredecessorPolicy,
  predecessorPolicyIdentity,
} from "../src/engine/landing_queue/policy.ts";

Deno.test("completion baseline: queue planning distinguishes source, predecessor, authority, and active recovery stops", () => {
  const { queue, candidates } = queueExample(1);
  const candidate = candidates.get(completionId(100));
  const entry = queue.entries[0];
  assert(candidate !== undefined && entry !== undefined);
  const assessment: CandidateAssessment = {
    candidate_id: completionId(100),
    candidate,
    proof: null,
    authority_id: completionId(6),
    blockers: [],
    decisions: { judgments: [], variances: [], proposals: [] },
    refresh: null,
  };
  const base = { ...entry, authority_id: completionId(6) };
  const plan = (
    changed: typeof base,
    audit: CandidateAssessment | null = assessment,
    extra: CompletionRecord[] = [],
    trunk = queue.trunk,
  ): ReturnType<typeof planQueue> =>
    planQueue({
      observation: {
        ...observation([{
          version: 1,
          kind: "queue",
          id: REPOSITORY_QUEUE_ID,
          revision: 1,
          data: { ...queue, entries: [changed] },
        }, ...extra]),
        trunk,
      },
      policy: CompletionPolicySchema.parse({}),
      requested_effort: entry.source.effort_id,
      assessments: new Map(audit === null ? [] : [[audit.candidate_id, audit]]),
      executor: COMPLETION_EXECUTOR,
      transition_attempts: new Map(),
    });
  assertEquals(plan(base).blockers[0]?.kind, "missing-evidence");
  assertEquals(plan(base, null).blockers[0]?.kind, "missing-evidence");
  assertEquals(
    plan({ ...base, state: "failed" }).blockers[0]?.kind,
    "validation-failed",
  );
  assertEquals(plan(base, assessment, [], "e".repeat(40)).blockers[0], {
    kind: "stale-evidence",
    evidence_ids: [],
    reason: "external-trunk",
  });
  assertEquals(
    plan(base, {
      ...assessment,
      candidate: {
        ...candidate,
        source: { ...candidate.source, head: "e".repeat(40) },
      },
    }).blockers[0],
    { kind: "stale-evidence", evidence_ids: [], reason: "source-replaced" },
  );
  assertEquals(plan({ ...base, invalidation: "policy-changed" }).blockers[0], {
    kind: "stale-evidence",
    evidence_ids: [],
    reason: "policy-changed",
  });
  const attempt = COMPLETION_FAMILIES.attempt.schema.parse(
    completionFixtures().attempt,
  );
  attempt.data = {
    ...attempt.data,
    identity: { ...attempt.data.identity, candidate_id: completionId(100) },
    state: {
      kind: "recovery",
      recovery: RecoverySchema.parse(COMPLETION_RECOVERY),
    },
  };
  assertEquals(
    plan({ ...base, state: "active" }, assessment, [attempt]).blockers[0],
    {
      kind: "recovery-incomplete",
      record_id: attempt.id,
      recovery: RecoverySchema.parse(COMPLETION_RECOVERY),
    },
  );
  assertThrows(
    () =>
      planQueue({
        observation: observation(),
        policy: CompletionPolicySchema.parse({}),
        requested_effort: "missing",
        assessments: new Map(),
        executor: COMPLETION_EXECUTOR,
        transition_attempts: new Map(),
      }),
    Error,
    "initialized",
  );
});

Deno.test("completion baseline: predecessor policy rejects changed decisions and unavailable or changed definitions", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, "discern.toml"),
      '[project]\nslug="policy-boundary"\n',
    );
    await gitInit(root);
    const head = await gitOut(root, "rev-parse", "HEAD");
    const candidate =
      COMPLETION_FAMILIES.candidate.schema.parse(completionFixtures().candidate)
        .data;
    const decisions = { judgments: [], variances: [], proposals: [] };
    const subject = {
      ...candidate,
      expected_predecessor: { head, candidate_id: null },
      policy: await predecessorPolicyIdentity(root, head),
    };
    assertEquals(
      await evaluatePredecessorPolicy({
        root,
        candidate: subject,
        standards: [],
        current: decisions,
        authorized: decisions,
      }),
      [],
    );
    assertEquals(
      (await evaluatePredecessorPolicy({
        root,
        candidate: { ...subject, policy: COMPLETION_DIGEST },
        standards: [],
        current: decisions,
        authorized: decisions,
      }))[0],
      { kind: "stale-evidence", evidence_ids: [], reason: "policy-changed" },
    );
    assertEquals(
      (await evaluatePredecessorPolicy({
        root,
        candidate: subject,
        standards: [],
        current: {
          ...decisions,
          judgments: [{
            checkpoint: "review",
            subject: COMPLETION_DIGEST,
            declaration: COMPLETION_DIGEST,
          }],
        },
        authorized: decisions,
      }))[0]?.kind,
      "missing-judgment",
    );
    await Deno.writeTextFile(join(root, "discern.toml"), "[invalid\n");
    await git(root, "add", "discern.toml");
    await git(root, "commit", "-m", "Record unreadable policy fixture");
    await assertRejects(() => predecessorPolicyIdentity(root, "HEAD"), Error);
    await assertRejects(
      () => predecessorPolicyIdentity(root, "missing-reference"),
      Error,
    );
  });
});
