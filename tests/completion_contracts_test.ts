import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ApplicabilitySchema,
  applicabilitySubject,
} from "../src/engine/completion/evidence.ts";
import { z } from "@zod/zod";
import {
  COMPLETION_FAMILIES,
  CompletionRecordSchema,
  recordTransitionAllowed,
} from "../src/engine/completion/records.ts";
import { parseCompletionRecord } from "../src/engine/completion/store.ts";
import { newAttemptIdentity } from "../src/engine/completion/identity.ts";
import { ExceptionClaimSchema } from "../src/engine/completion/authority.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_DIGEST,
  COMPLETION_EXECUTOR,
  COMPLETION_HEAD,
  COMPLETION_REQUIREMENT,
  COMPLETION_SOURCE,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

Deno.test("completion families round trip, reject incomplete shapes, and discriminate version skew", async () => {
  const fixtures = completionFixtures();
  assertEquals(
    Object.keys(fixtures).sort(),
    Object.keys(COMPLETION_FAMILIES).sort(),
  );
  for (const fixture of Object.values(fixtures)) {
    const raw = JSON.stringify(fixture);
    const read = await parseCompletionRecord(raw, fixture);
    assert(read.kind === "recorded");
    assertEquals(read.record, fixture);
    assertEquals(
      (await parseCompletionRecord(raw, { ...fixture, id: completionId(90) }))
        .kind,
      "invalid",
    );
    for (const key of Object.keys(fixture)) {
      const missing = Object.fromEntries(
        Object.entries(fixture).filter(([field]) => field !== key),
      );
      assertEquals(
        (await parseCompletionRecord(JSON.stringify(missing), fixture)).kind,
        "invalid",
        `${fixture.kind}.${key}`,
      );
    }
    for (const field of Object.keys(fixture.data)) {
      const data = Object.fromEntries(
        Object.entries(fixture.data).filter(([key]) => key !== field),
      );
      assertEquals(
        (await parseCompletionRecord(
          JSON.stringify({ ...fixture, data }),
          fixture,
        )).kind,
        "invalid",
        `${fixture.kind}.data.${field}`,
      );
    }
    assertEquals(
      (await parseCompletionRecord(
        JSON.stringify({ ...fixture, future: true }),
        fixture,
      )).kind,
      "invalid",
    );
    assertEquals(
      (await parseCompletionRecord(
        JSON.stringify({
          version: ON_DISK_FORMATS.completionRecord.version + 1,
          kind: "future",
          opaque: true,
        }),
        fixture,
      )).kind,
      "newer",
    );
    for (
      const raw of [
        "{}",
        "null",
        "{",
        JSON.stringify({ ...fixture, version: 0 }),
      ]
    ) {
      assertEquals((await parseCompletionRecord(raw, fixture)).kind, "invalid");
    }
  }
});

Deno.test("completion evidence cannot turn incomplete capture, uncovered obligations, or mismatched ids into Proof", () => {
  const fixtures = completionFixtures();
  const proof = COMPLETION_FAMILIES.proof.schema.parse(fixtures.proof);
  const receipt = proof.data.receipts[0];
  assert(receipt !== undefined);
  for (
    const data of [
      {
        ...proof.data,
        requirements: [...proof.data.requirements, {
          ...COMPLETION_REQUIREMENT,
          definition: "e".repeat(64),
        }],
        receipts: [receipt, {
          ...receipt,
          requirement: {
            ...COMPLETION_REQUIREMENT,
            definition: "e".repeat(64),
          },
        }],
      },
      { ...proof.data, receipts: [] },
      { ...proof.data, receipts: [receipt, receipt] },
      {
        ...proof.data,
        requirements: [...proof.data.requirements, {
          ...COMPLETION_REQUIREMENT,
          kind: "job",
        }],
      },
      {
        ...proof.data,
        receipts: [{ ...receipt, candidate_id: completionId(99) }],
      },
      { ...proof.data, receipts: [{ ...receipt, policy: "f".repeat(64) }] },
      { ...proof.data, receipts: [{ ...receipt, reading: null }] },
    ]
  ) {
    assertEquals(
      CompletionRecordSchema.safeParse({ ...proof, data }).success,
      false,
    );
  }
  const evidence = COMPLETION_FAMILIES.evidence.schema.parse(fixtures.evidence);
  for (
    const outcome of [
      { kind: "passed", capture_complete: false, metrics: {} },
      {
        kind: "passed",
        capture_complete: true,
        metrics: { coverage: Infinity },
      },
      { kind: "passed", capture_complete: true, metrics: { coverage: NaN } },
    ]
  ) {
    assertEquals(
      CompletionRecordSchema.safeParse({
        ...evidence,
        data: { ...evidence.data, outcome },
      }).success,
      false,
    );
  }
  for (
    const path of [
      "../report",
      "/report",
      ".git/state",
      "a/../report",
      "a//report",
      "./report",
      "a\\report",
    ]
  ) {
    assertEquals(
      CompletionRecordSchema.safeParse({
        ...evidence,
        data: {
          ...evidence.data,
          artifacts: evidence.data.artifacts.map((artifact) => ({
            ...artifact,
            path,
          })),
        },
      }).success,
      false,
      path,
    );
  }
  for (const field of ["attempt_id", "candidate_id"]) {
    assertEquals(
      CompletionRecordSchema.safeParse({
        ...evidence,
        data: {
          ...evidence.data,
          artifacts: evidence.data.artifacts.map((artifact) => ({
            ...artifact,
            [field]: completionId(99),
          })),
        },
      }).success,
      false,
    );
  }
});

Deno.test("exception claims stay distinct from Proof and bind the approved trunk and repair exactly", () => {
  const claim = ExceptionClaimSchema.parse({
    kind: "exception",
    authorization_id: completionId(80),
    authorized_at: 100,
    actual_trunk: "d".repeat(40),
    source: COMPLETION_SOURCE,
    candidate_id: completionId(1),
    candidate_head: COMPLETION_HEAD,
    policy: COMPLETION_DIGEST,
    reason: "restore service",
    exceptions: ["failed", "unrun", "stale"].map((state) => ({
      requirement: COMPLETION_REQUIREMENT,
      state,
      evidence_id: state === "unrun" ? null : completionId(3),
    })),
  });
  assertEquals(claim.kind, "exception");
  assertEquals(
    ExceptionClaimSchema.safeParse({ ...claim, kind: "normal" }).success,
    false,
  );
  assertEquals(
    ExceptionClaimSchema.safeParse({ ...claim, exceptions: [] }).success,
    false,
  );
  const record = COMPLETION_FAMILIES.exception.schema.parse(
    completionFixtures().exception,
  );
  assertEquals(
    CompletionRecordSchema.safeParse({
      ...record,
      id: claim.authorization_id,
      data: {
        ...record.data,
        claim,
        expected_trunk: claim.actual_trunk,
        target: claim.candidate_head,
      },
    }).success,
    true,
  );
  for (
    const data of [
      { ...record.data, claim, expected_trunk: "e".repeat(40) },
      { ...record.data, claim, target: "e".repeat(40) },
    ]
  ) {
    assertEquals(
      CompletionRecordSchema.safeParse({
        ...record,
        id: claim.authorization_id,
        data,
      }).success,
      false,
    );
  }
  assertEquals(
    CompletionRecordSchema.safeParse({
      ...record,
      id: completionId(81),
    }).success,
    false,
    "exception id must match the approved authorization",
  );
});

Deno.test("completion identities use injected capabilities and reject impossible coordinates", () => {
  const input = {
    candidate_id: completionId(1),
    executor: COMPLETION_EXECUTOR,
    sequence: 2,
    rerun_of: completionId(2),
  };
  const attempt = newAttemptIdentity(input, COMPLETION_CLOCK, {
    uuid: () => completionId(30),
    fillBytes: () => {},
  });
  assertEquals(attempt.started_at, 100);
  assertEquals(attempt.id, completionId(30));
  assertThrows(
    () => newAttemptIdentity({ ...input, sequence: 0 }, COMPLETION_CLOCK),
    z.ZodError,
  );
});

Deno.test("completion lifetime rules preserve immutable history and bind attempt claims once", () => {
  for (const fixture of Object.values(completionFixtures())) {
    assertEquals(
      recordTransitionAllowed(fixture, { ...fixture, revision: 2 }),
      COMPLETION_FAMILIES[fixture.kind].lifetime === "mutable",
    );
    assertEquals(
      recordTransitionAllowed(fixture, {
        ...fixture,
        id: completionId(91),
        revision: 2,
      }),
      false,
    );
  }
  const claimed = COMPLETION_FAMILIES.attempt.schema.parse(
    completionFixtures().attempt,
  );
  assert(claimed.data.state.kind === "claimed");
  const planning = COMPLETION_FAMILIES.attempt.schema.parse({
    ...claimed,
    data: {
      ...claimed.data,
      subjects: [],
      state: { kind: "planning", claim: claimed.data.state.claim },
    },
  });
  const bound = { ...claimed, revision: 2 };
  assertEquals(recordTransitionAllowed(planning, bound), true);
  assertEquals(
    recordTransitionAllowed(bound, { ...planning, revision: 3 }),
    false,
    "a bound claim never returns to planning",
  );
  assertEquals(
    recordTransitionAllowed(bound, {
      ...bound,
      revision: 3,
      data: {
        ...bound.data,
        state: {
          kind: "claimed",
          claim: {
            ...claimed.data.state.claim,
            token: completionId(77),
          },
        },
      },
    }),
    false,
    "a bound claim's token never changes",
  );
  assertEquals(
    recordTransitionAllowed(bound, {
      ...bound,
      revision: 3,
      data: { ...bound.data, subjects: [] },
    }),
    false,
    "bound subjects never change again",
  );
  const finished = COMPLETION_FAMILIES.attempt.schema.parse({
    ...claimed,
    revision: 3,
    data: {
      ...claimed.data,
      state: { kind: "finished", outcome: "passed", finished_at: 110 },
    },
  });
  assertEquals(recordTransitionAllowed(bound, finished), true);
  assertEquals(
    recordTransitionAllowed(finished, { ...bound, revision: 4 }),
    false,
    "a finished attempt is terminal",
  );
});

Deno.test("completion attempt subjects cover every applicability dimension and ignore JSON key order", async () => {
  const evidence =
    COMPLETION_FAMILIES.evidence.schema.parse(completionFixtures().evidence)
      .data;
  const original = evidence.applicability;
  const subject = await applicabilitySubject(original);
  const reordered = ApplicabilitySchema.parse(
    Object.fromEntries(Object.entries(original).reverse()),
  );
  assertEquals(await applicabilitySubject(reordered), subject);
  for (const [key, value] of Object.entries(original)) {
    const without = Object.fromEntries(
      Object.entries(original).filter(([field]) => field !== key),
    );
    assertEquals(ApplicabilitySchema.safeParse(without).success, false, key);
    const changed = key === "closure"
      ? { kind: "candidate", head: COMPLETION_HEAD }
      : typeof value === "number"
      ? value + 1
      : key === "producer"
      ? "jobs.build"
      : "e".repeat(64);
    const replacement = ApplicabilitySchema.parse({
      ...original,
      [key]: changed,
    });
    assert((await applicabilitySubject(replacement)) !== subject, key);
  }
});
