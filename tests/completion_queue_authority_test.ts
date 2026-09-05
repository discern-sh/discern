import { assert, assertEquals } from "@std/assert";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  renewSourceAuthority,
  resolveSourceAuthority,
  type SourceGrantFacts,
  verifyCandidateDecisions,
} from "../src/engine/landing_queue/authority.ts";
import { reviseUnlandedPin } from "../src/engine/landing_queue/policy.ts";
import {
  COMPLETION_DIGEST,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

Deno.test("queue A01/A02: exact source consent, revocation and procedure currency are independent", () => {
  const fixtures = completionFixtures();
  const candidate =
    COMPLETION_FAMILIES.candidate.schema.parse(fixtures.candidate).data;
  const authority = COMPLETION_FAMILIES.authority.schema.parse(
    fixtures.authority,
  );
  const facts: SourceGrantFacts = {
    source: candidate.source,
    record_id: authority.data.source.record_id,
    policy: candidate.policy,
    current: true,
    classifications: [],
    granted_scopes: [],
    defined_scopes: [],
  };
  const resolve = (
    record = authority,
    subject = candidate,
    observed = facts,
  ): string =>
    resolveSourceAuthority({
      candidate: subject,
      authority: record,
      facts: [observed],
      predecessors: [],
    }).kind;
  assertEquals(resolve(), "authorized");
  assertEquals(
    resolve({
      ...authority,
      data: { ...authority.data, state: { kind: "revoked", at: 100 } },
    }),
    "missing-authority",
  );
  assertEquals(
    resolve(authority, {
      ...candidate,
      source: { ...candidate.source, head: "f".repeat(40) },
    }),
    "missing-authority",
  );
  assertEquals(
    resolve(authority, {
      ...candidate,
      composition: { ...candidate.composition, procedure: "f".repeat(64) },
    }),
    "missing-authority",
  );
  assertEquals(
    resolve(authority, candidate, { ...facts, current: false }),
    "missing-authority",
  );
  const standing = {
    ...authority,
    data: {
      ...authority.data,
      source: {
        ...authority.data.source,
        source: "standing-grant" as const,
        scopes: ["map"],
      },
    },
  };
  assertEquals(
    resolve(standing, candidate, {
      ...facts,
      classifications: [{ path: "src/a.ts", scopes: ["code"] }],
      granted_scopes: ["map"],
      defined_scopes: ["map", "code"],
    }),
    "missing-authority",
  );
  const renewed = renewSourceAuthority(authority.data, {
    ...facts,
    policy: "e".repeat(64),
  }, [completionId(99)]);
  assert(!("kind" in renewed));
  assertEquals(renewed.sources, authority.data.sources);
  assertEquals(renewed.predecessor_authorities, [completionId(99)]);
});

Deno.test("queue A01: successor consent cannot supply an unapproved predecessor", () => {
  const fixtures = completionFixtures();
  const candidate =
    COMPLETION_FAMILIES.candidate.schema.parse(fixtures.candidate).data;
  const authority = COMPLETION_FAMILIES.authority.schema.parse(
    fixtures.authority,
  );
  const predecessor = {
    ...candidate,
    source: {
      ...candidate.source,
      effort_id: "predecessor",
      branch: "refs/heads/agent/predecessor",
      head: "d".repeat(40),
    },
  };
  const preceding = {
    ...authority,
    id: completionId(80),
    data: { ...authority.data, sources: [predecessor.source] },
  };
  const facts = [candidate.source, predecessor.source].map((source) => ({
    source,
    record_id: authority.data.source.record_id,
    policy: COMPLETION_DIGEST,
    current: true,
    classifications: [],
    granted_scopes: [],
    defined_scopes: [],
  }));
  const resolve = (record = authority): string =>
    resolveSourceAuthority({
      candidate: { ...candidate, dependencies: [predecessor.source] },
      authority: record,
      facts,
      predecessors: [{
        candidate: predecessor,
        authority: preceding,
        landed: false,
      }],
    }).kind;
  assertEquals(resolve(), "missing-authority");
  assertEquals(
    resolve({
      ...authority,
      data: { ...authority.data, predecessor_authorities: [preceding.id] },
    }),
    "authorized",
  );
});

Deno.test("queue A02/A04: grants cannot fill changed judgments, variances or owner pin tuples", () => {
  const empty = { judgments: [], variances: [], proposals: [] };
  const judgment = {
    checkpoint: "review",
    subject: COMPLETION_DIGEST,
    declaration: COMPLETION_DIGEST,
  };
  assertEquals(
    verifyCandidateDecisions({ ...empty, judgments: [judgment] }, empty)?.kind,
    "missing-judgment",
  );
  assertEquals(
    verifyCandidateDecisions({ ...empty, judgments: [judgment] }, {
      ...empty,
      judgments: [{ ...judgment, subject: "e".repeat(64) }],
    })?.kind,
    "missing-judgment",
  );
  const variance = {
    checkpoint: "review",
    subject: "subject",
    definition_hash: "definition",
    why: "The owner accepts this exact tradeoff.",
  };
  assertEquals(
    verifyCandidateDecisions({ ...empty, variances: [variance] }, empty)?.kind,
    "missing-judgment",
  );
  assertEquals(
    verifyCandidateDecisions({ ...empty, variances: [variance] }, {
      ...empty,
      variances: [variance],
    }),
    undefined,
  );
  const source =
    COMPLETION_FAMILIES.candidate.schema.parse(completionFixtures().candidate)
      .data.source;
  const pin = {
    source,
    predecessor: "d".repeat(40),
    policy: COMPLETION_DIGEST,
    standard: "coverage",
    from: 99,
    to: 98,
    direction: "up" as const,
  };
  assertEquals(reviseUnlandedPin(pin, null, false).kind, "missing-judgment");
  assertEquals(
    reviseUnlandedPin(pin, { ...pin, to: 97 }, false).kind,
    "missing-judgment",
  );
  assertEquals(reviseUnlandedPin(pin, pin, true).kind, "missing-judgment");
  assertEquals(reviseUnlandedPin(pin, pin, false).kind, "revise-source");
});
