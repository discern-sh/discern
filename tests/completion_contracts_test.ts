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
import {
  candidateRef,
  newAttemptIdentity,
} from "../src/engine/completion/identity.ts";
import {
  environmentAvailability,
  EnvironmentSchema,
} from "../src/engine/completion/environment.ts";
import {
  CompletionClaimSchema,
  ExceptionClaimSchema,
} from "../src/engine/completion/authority.ts";
import { CANDIDATE_REF_PREFIX } from "../src/shared/git_conventions.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_CLOCK,
  COMPLETION_DIGEST,
  COMPLETION_EXECUTOR,
  COMPLETION_HEAD,
  COMPLETION_RECOVERY,
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

Deno.test("completion evidence cannot turn incomplete capture, substituted contexts, or mismatched ids into Proof", () => {
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
          context: "ci",
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
  for (const field of ["attempt_id", "candidate_id", "context"]) {
    assertEquals(
      CompletionRecordSchema.safeParse({
        ...evidence,
        data: {
          ...evidence.data,
          artifacts: evidence.data.artifacts.map((artifact) => ({
            ...artifact,
            [field]: field === "context" ? "ci" : completionId(99),
          })),
        },
      }).success,
      false,
    );
  }
});

Deno.test("completion authority and exception claims retain different obligations", () => {
  const authority = COMPLETION_FAMILIES.authority.schema.parse(
    completionFixtures().authority,
  );
  for (
    const source of [
      { source: "urgent", record_id: completionId(1), scopes: [] },
      { source: "standing-grant", record_id: completionId(1), scopes: [] },
      { source: "conversation", record_id: completionId(1), scopes: ["src"] },
      { source: "effort-grant", scopes: [] },
    ]
  ) {
    assertEquals(
      CompletionRecordSchema.safeParse({
        ...authority,
        data: { ...authority.data, source },
      }).success,
      false,
    );
  }
  const exception = ExceptionClaimSchema.parse({
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
  assertEquals(CompletionClaimSchema.parse(exception).kind, "exception");
  assertEquals(
    CompletionClaimSchema.safeParse({ ...exception, kind: "normal" }).success,
    false,
  );
  const landing = COMPLETION_FAMILIES.landing.schema.parse(
    completionFixtures().landing,
  );
  assertEquals(
    CompletionRecordSchema.safeParse({
      ...landing,
      data: { ...landing.data, claim: exception },
    }).success,
    true,
  );
  assertEquals(
    CompletionRecordSchema.safeParse({
      ...landing,
      data: {
        ...landing.data,
        claim: { ...exception, actual_trunk: "e".repeat(40) },
      },
    }).success,
    false,
  );
});

Deno.test("completion environment availability distinguishes held, active, expired, and incomplete recovery", () => {
  const environment = COMPLETION_FAMILIES.environment.schema.parse(
    completionFixtures().environment,
  ).data;
  assertEquals(environmentAvailability(environment, 100).kind, "available");
  assertEquals(
    environmentAvailability({ ...environment, release: { kind: "held" } }, 100),
    { kind: "environment-unavailable", reason: "held" },
  );
  const executing = EnvironmentSchema.parse({
    ...environment,
    state: {
      kind: "executing",
      attempt_id: completionId(2),
      candidate_id: completionId(1),
      release_id: completionId(22),
      claim: COMPLETION_CLAIM,
      phase: "validate",
    },
  });
  assertEquals(environmentAvailability(executing, 100), {
    kind: "environment-unavailable",
    reason: "busy",
  });
  assertEquals(environmentAvailability(executing, 200), {
    kind: "recovery-incomplete",
    reason: "claim-expired",
  });
  const recovery = EnvironmentSchema.parse({
    ...environment,
    state: {
      kind: "recovery",
      attempt_id: completionId(2),
      recovery: COMPLETION_RECOVERY,
    },
  });
  assertEquals(environmentAvailability(recovery, 900), {
    kind: "recovery-incomplete",
    reason: "recorded",
  });
  assertEquals(
    EnvironmentSchema.safeParse({ ...executing, release: { kind: "held" } })
      .success,
    false,
  );
});

Deno.test("completion identities use injected capabilities and immutable ref coordinates", () => {
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
  assertEquals(
    candidateRef(input.candidate_id, attempt.id),
    `${CANDIDATE_REF_PREFIX}/${completionId(1)}/${completionId(30)}`,
  );
  assertThrows(() => candidateRef("../../trunk", attempt.id), z.ZodError);
  assertThrows(
    () => newAttemptIdentity({ ...input, sequence: 0 }, COMPLETION_CLOCK),
    z.ZodError,
  );
});

Deno.test("completion lifetime rules preserve immutable history and separate landing from retirement", () => {
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
  const landing = COMPLETION_FAMILIES.landing.schema.parse(
    completionFixtures().landing,
  );
  const landed = COMPLETION_FAMILIES.landing.schema.parse({
    ...landing,
    revision: 2,
    data: {
      ...landing.data,
      outcome: { kind: "landed", at: 101, transition_marker: completionId(8) },
      authority_settlement: "consumed",
      note: "recovery",
    },
  });
  assert(recordTransitionAllowed(landing, landed));
  assertEquals(
    recordTransitionAllowed(landed, { ...landing, revision: 3 }),
    false,
  );
  assertEquals(
    recordTransitionAllowed(landed, {
      ...landed,
      revision: 3,
      data: { ...landed.data, target: "e".repeat(40) },
    }),
    false,
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
      : key === "context"
      ? "ci"
      : "e".repeat(64);
    const replacement = ApplicabilitySchema.parse({
      ...original,
      [key]: changed,
    });
    assert((await applicabilitySubject(replacement)) !== subject, key);
  }
});
