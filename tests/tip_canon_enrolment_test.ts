/**
 * Closed-set ENROLMENT guard for the desk curriculum.
 *
 * Every feature-canon node enters the tip account when it enters the canon,
 * whether or not it carries a command surface: a node without `surfaces` may
 * still describe a human-visible benefit. Every top-level verb enters
 * independently from `KNOWN_VERBS`. Each member must be taught by a tip or
 * recorded in `TIP_COVERAGE_DELIBERATELY_ABSENT` with the reason.
 *
 * A verb is taught when a tip claims a feature node whose live `surfaces`
 * include that verb. This keeps the relationship on the canon's single
 * source instead of copying verb names into a second tip-specific map.
 * The existing tip closed-set guard owns the inverse feature-citation check;
 * this file does not duplicate it.
 */

import { assert, assertEquals } from "@std/assert";
import {
  allFeatureNodes,
  FEATURE_CANON,
  type FeatureNode,
} from "../scripts/feature_registry.ts";
import { TIP_COVERAGE_DELIBERATELY_ABSENT, TIPS } from "../src/shared/tips.ts";
import { KNOWN_VERBS } from "../src/shared/verbs.ts";

interface TipFeatureClaim {
  readonly id: string;
  readonly features: readonly string[];
}

interface TipCoverageFixture {
  readonly tree: readonly FeatureNode[];
  readonly verbs: ReadonlySet<string>;
  readonly tips: readonly TipFeatureClaim[];
  readonly absences: Readonly<Record<string, string>>;
}

/** Return the coverage offenders. */
function coverageOffenders(fixture: TipCoverageFixture): string[] {
  const nodes = allFeatureNodes(fixture.tree);
  const nodesById = new Map(nodes.map(({ node }) => [node.id, node]));
  const tippedFeatures = new Set(
    fixture.tips.flatMap((tip) => [...tip.features]),
  );
  const tippedVerbs = new Set<string>();
  for (const feature of tippedFeatures) {
    for (const surface of nodesById.get(feature)?.surfaces ?? []) {
      if (surface.startsWith("verb:")) {
        tippedVerbs.add(surface.slice("verb:".length));
      }
    }
  }

  const offenders: string[] = [];
  const checkMember = (key: string, tipped: boolean): void => {
    const absent = Object.hasOwn(fixture.absences, key);
    if (!tipped && !absent) {
      offenders.push(
        `${key} ships dark — claim it from a tip's features, or record it in ` +
          "TIP_COVERAGE_DELIBERATELY_ABSENT with the reason",
      );
    }
    if (tipped && absent) {
      offenders.push(
        `${key} is tipped and recorded absent — delete the stale absence`,
      );
    }
  };

  for (const { node } of nodes) {
    checkMember(`feature:${node.id}`, tippedFeatures.has(node.id));
  }
  for (const verb of fixture.verbs) {
    checkMember(`verb:${verb}`, tippedVerbs.has(verb));
  }
  return offenders;
}

/** Return the live fixture. */
function liveFixture(): TipCoverageFixture {
  return {
    tree: FEATURE_CANON,
    verbs: KNOWN_VERBS,
    tips: TIPS,
    absences: TIP_COVERAGE_DELIBERATELY_ABSENT,
  };
}

Deno.test("every feature node and known verb is tipped or deliberately absent", () => {
  const offenders = coverageOffenders(liveFixture());
  assertEquals(
    offenders,
    [],
    `the desk curriculum must account for every human-discoverable member:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("every tip-coverage absence names a live member and gives a reason", () => {
  const liveFeatures = new Set(
    allFeatureNodes(FEATURE_CANON).map(({ node }) => node.id),
  );
  for (
    const [key, reason] of Object.entries(
      TIP_COVERAGE_DELIBERATELY_ABSENT,
    )
  ) {
    const at = key.indexOf(":");
    const set = at === -1 ? key : key.slice(0, at);
    const member = at === -1 ? "" : key.slice(at + 1);
    assert(
      set === "feature" || set === "verb",
      `${key}: "${set}" is not a tip-coverage set`,
    );
    const live = set === "feature" ? liveFeatures : KNOWN_VERBS;
    assert(
      live.has(member),
      `${key}: no such live member — delete or rename the stale record`,
    );
    assert(
      reason.trim().length > 0,
      `${key}: a deliberate absence carries its reason`,
    );
  }
});

Deno.test("tip enrolment catches a newly added unclaimed verb", () => {
  const tree: FeatureNode[] = [
    {
      id: "taught",
      title: "Taught",
      what: "A fixture.",
      plain: { title: "Taught", what: "A fixture." },
      surfaces: ["verb:known"],
    },
  ];
  const offenders = coverageOffenders({
    tree,
    verbs: new Set(["known", "new"]),
    tips: [{ id: "tip", features: ["taught"] }],
    absences: {},
  });
  assertEquals(offenders.length, 1);
  assert(
    offenders[0]?.startsWith("verb:new ships dark"),
    `the new verb must be the offender: ${offenders.join(", ")}`,
  );
});

Deno.test("tip enrolment catches a newly added unclaimed feature node", () => {
  const tree: FeatureNode[] = [
    {
      id: "taught",
      title: "Taught",
      what: "A fixture.",
      plain: { title: "Taught", what: "A fixture." },
      children: [
        {
          id: "new",
          title: "New",
          what: "A fixture.",
          plain: { title: "New", what: "A fixture." },
        },
      ],
    },
  ];
  const offenders = coverageOffenders({
    tree,
    verbs: new Set(),
    tips: [{ id: "tip", features: ["taught"] }],
    absences: {},
  });
  assertEquals(offenders.length, 1);
  assert(
    offenders[0]?.startsWith("feature:new ships dark"),
    `the new feature must be the offender: ${offenders.join(", ")}`,
  );
});

Deno.test("tip enrolment rejects an absence after a member gains a tip", () => {
  const tree: FeatureNode[] = [
    {
      id: "taught",
      title: "Taught",
      what: "A fixture.",
      plain: { title: "Taught", what: "A fixture." },
    },
  ];
  const offenders = coverageOffenders({
    tree,
    verbs: new Set(),
    tips: [{ id: "tip", features: ["taught"] }],
    absences: { "feature:taught": "A stale fixture." },
  });
  assertEquals(offenders, [
    "feature:taught is tipped and recorded absent — delete the stale absence",
  ]);
});
