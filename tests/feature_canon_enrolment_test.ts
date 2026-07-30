/**
 * Closed-set ENROLMENT guard for the feature canon — the canonical-set parity
 * discipline applied to the product's feature account (the ADR 0051 family,
 * beside glossary_enrolment and friends).
 *
 * Every member of the product's closed sets — the top-level verbs, the known
 * jobs, the stages, the top-level config tables, the bundled skills, the agent
 * providers — must be in the feature canon the moment it exists: either
 * CLAIMED by a node's `surfaces` or recorded in `FEATURES_DELIBERATELY_ABSENT`
 * with the reason. Exactly one of the two: an unclaimed, unrecorded member
 * fails the gate until someone decides where the feature account carries it,
 * and an absence record for a member the canon now claims fails as stale.
 *
 * The inverse holds too: every claim must name a live member, so a rename or
 * removal strands its claim and fails the gate — the canon cannot describe a
 * product that no longer exists.
 *
 * The sets are read from their single sources (`KNOWN_VERBS`, `KNOWN_JOBS`,
 * `STAGES`, the config schema's shape, the bundled-skills directory, the
 * agent catalogue), never a hand-copied list, so a new member auto-enrols in
 * the check itself.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  allHintCitations,
  allSurfaceClaims,
  FEATURE_CANON,
  type FeatureNode,
  FEATURES_DELIBERATELY_ABSENT,
  SURFACE_SETS,
  type SurfaceSet,
} from "../scripts/feature_registry.ts";
import { HINTS } from "../src/shared/hints.ts";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { bundledSkillNames } from "../src/lib/skills.ts";

/** The closed sets the canon must account for, from their single sources. */
const CLOSED_SETS: Readonly<Record<SurfaceSet, readonly string[]>> = {
  verb: [...KNOWN_VERBS].sort(),
  job: Object.keys(KNOWN_JOBS),
  stage: STAGES,
  config: Object.keys(configSchema.shape).sort(),
  skill: (await bundledSkillNames()).sort(),
  agent: [...AGENT_NAMES],
};

/** Claimed members per set, from the canon's explicit surface claims. */
function claimedBySet(): Map<SurfaceSet, Set<string>> {
  const claimed = new Map<SurfaceSet, Set<string>>();
  for (const claim of allSurfaceClaims()) {
    const members = claimed.get(claim.set) ?? new Set<string>();
    members.add(claim.member);
    claimed.set(claim.set, members);
  }
  return claimed;
}

Deno.test("every verb, job, stage, config table, bundled skill, and agent is claimed or recorded deliberately absent", () => {
  const claimed = claimedBySet();
  const offenders: string[] = [];
  for (const set of SURFACE_SETS) {
    for (const member of CLOSED_SETS[set]) {
      const key = `${set}:${member}`;
      const isClaimed = claimed.get(set)?.has(member) ?? false;
      const recorded = Object.hasOwn(FEATURES_DELIBERATELY_ABSENT, key);
      if (!isClaimed && !recorded) {
        offenders.push(
          `${key} is outside the feature account — claim it from a node's ` +
            "surfaces, or record it in FEATURES_DELIBERATELY_ABSENT with the reason",
        );
      }
      if (isClaimed && recorded) {
        offenders.push(
          `${key} is recorded deliberately absent, but the canon claims it — ` +
            "delete the stale record",
        );
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "closed-set members must enter the feature canon the moment they exist " +
      `(scripts/feature_registry.ts):\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every surface claim names a live closed-set member", () => {
  const offenders: string[] = [];
  for (const claim of allSurfaceClaims()) {
    if (!CLOSED_SETS[claim.set].includes(claim.member)) {
      offenders.push(
        `${claim.claimedBy} claims ${claim.set}:${claim.member}, which is not ` +
          "a live member — the set changed under the canon; update the node",
      );
    }
  }
  assertEquals(
    offenders,
    [],
    `stale claims in the feature canon:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every deliberate-absence record points at a live closed-set member, with a reason", () => {
  for (const [key, reason] of Object.entries(FEATURES_DELIBERATELY_ABSENT)) {
    const at = key.indexOf(":");
    const set = at === -1 ? key : key.slice(0, at);
    const member = at === -1 ? "" : key.slice(at + 1);
    const members = Object.hasOwn(CLOSED_SETS, set)
      ? CLOSED_SETS[set as SurfaceSet]
      : undefined;
    assert(
      members !== undefined,
      `${key}: "${set}" is not a closed set the enrolment guard covers`,
    );
    assert(
      members.includes(member),
      `${key}: no such member — the set changed under this record; delete or rename it`,
    );
    assert(
      reason.trim().length > 0,
      `${key}: a deliberate absence carries its reason`,
    );
  }
});

// Hint citations are SOFT references into the hint registry: a citation must
// name a live registered hint, but no hint demands a citation — enrolling the
// full hint corpus would drown the canon in claims for marginal truth.

Deno.test("every hint citation names a live registered hint", () => {
  const live = new Set(Object.keys(HINTS));
  const offenders = allHintCitations()
    .filter(({ id }) => !live.has(id))
    .map(({ id, citedBy }) =>
      `${citedBy} cites hint '${id}', which the hint registry does not carry`
    );
  assertEquals(
    offenders,
    [],
    `stale hint citations in the feature canon:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("hint-citation extraction reads the whole tree (positive control)", () => {
  const fixture: FeatureNode[] = [
    {
      id: "root",
      title: "Root",
      what: "A fixture.",
      agent: "A fixture.",
      hints: ["gate-prove-it-works"],
      plain: { title: "Fixture", what: "A fixture." },
      children: [
        {
          id: "leaf",
          title: "Leaf",
          what: "A fixture.",
          agent: "A fixture.",
          hints: ["status-start-on-trunk"],
          plain: { title: "Fixture", what: "A fixture." },
        },
      ],
    },
  ];
  assertEquals(allHintCitations(fixture), [
    { id: "gate-prove-it-works", citedBy: "root" },
    { id: "status-start-on-trunk", citedBy: "leaf" },
  ]);
});

// Positive controls: prove the claim machinery discriminates, so the guard
// can't rot into a test that passes because nothing looks claimed.

Deno.test("enrolment guard: claims are read from the whole tree, at any depth", () => {
  const fixture: FeatureNode[] = [
    {
      id: "root",
      title: "Root",
      what: "A fixture.",
      plain: { title: "Fixture", what: "A fixture." },
      surfaces: ["verb:done"],
      children: [
        {
          id: "leaf",
          title: "Leaf",
          what: "A fixture.",
          plain: { title: "Fixture", what: "A fixture." },
          surfaces: ["job:test", "stage:fix"],
        },
      ],
    },
  ];
  assertEquals(allSurfaceClaims(fixture), [
    { set: "verb", member: "done", claimedBy: "root" },
    { set: "job", member: "test", claimedBy: "leaf" },
    { set: "stage", member: "fix", claimedBy: "leaf" },
  ]);
});

Deno.test("enrolment guard: malformed and unknown-set claims fail loudly", () => {
  assertThrows(
    () =>
      allSurfaceClaims([
        {
          id: "bad",
          title: "Bad",
          what: "A fixture.",
          plain: { title: "Fixture", what: "A fixture." },
          surfaces: ["done"],
        },
      ]),
    Error,
    "malformed surface key",
  );
  assertThrows(
    () =>
      allSurfaceClaims([
        {
          id: "bad",
          title: "Bad",
          what: "A fixture.",
          plain: { title: "Fixture", what: "A fixture." },
          surfaces: ["tool:discern_done"],
        },
      ]),
    Error,
    "unknown surface set",
  );
});

Deno.test("the live canon claims every closed set at least once", () => {
  const claimed = claimedBySet();
  for (const set of SURFACE_SETS) {
    assert(
      (claimed.get(set)?.size ?? 0) > 0,
      `the canon claims no ${set} members — a whole set fell out of the account`,
    );
  }
  assert(FEATURE_CANON.length > 0, "the canon is never empty");
});
