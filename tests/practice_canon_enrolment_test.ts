/**
 * Enrolment and sync guard for the practice canon — the canonical-set parity
 * discipline applied to the practice's tenets (the ADR 0051 family, beside
 * feature_canon_enrolment and glossary_enrolment).
 *
 * The taught stratum cannot lag the skill set: every bundled skill must be
 * CLAIMED by a tenet's taught tier or recorded in
 * `PRACTICE_DELIBERATELY_ABSENT` with a reason — exactly one of the two — so
 * a new bundled skill forces a canon decision the moment it exists, and a
 * stale absence fails. The same discipline runs in reverse at the coarse
 * altitudes: every feature pillar must be cited (at any resolution) or
 * recorded absent, and every benefit cluster must be yielded or recorded
 * absent. Node-level reverse enrolment is deliberately NOT checked:
 * mechanism citations are representative, not inventories.
 *
 * Citations are checked member-by-member: an upheld key must name a live
 * verb, config table, or bundled skill (skills only under `taught`); a
 * mechanism must name a live feature node; a yield a live cluster — so a
 * rename or removal strands its citation and fails the gate. The fixed
 * project inventory must keep a maintainer per item, the committed pages
 * must equal their generators, and each deferred consumer's practice prose
 * must match its recorded fingerprint: changing that prose without aligning
 * it to the canon (or re-recording the fingerprint) fails here.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  allUpheldKeys,
  inventoryPhrase,
  parseCarrier,
  PRACTICE_AGENT_BENEFIT_ABSENCES,
  PRACTICE_ARCS,
  PRACTICE_CANON,
  PRACTICE_CANON_PAGE_REL,
  PRACTICE_CLUSTER_ABSENCES,
  PRACTICE_DEFERRED_CONSUMERS,
  PRACTICE_DELIBERATELY_ABSENT,
  PRACTICE_FRAME,
  PRACTICE_PILLAR_ABSENCES,
  PRACTICE_PROPERTIES,
  PRACTICE_PUBLIC_PAGE_REL,
  PROJECT_INVENTORY,
  renderPracticeCanonDoc,
  renderPracticePublicDoc,
  upheldEntries,
} from "../scripts/practice_registry.ts";
import {
  allAgentBenefitEntries,
  allFeatureNodes,
  HUMAN_BENEFIT_CANON,
} from "../scripts/feature_registry.ts";
import { CONCEPTS } from "../scripts/brand/bridge.ts";
import { buildPracticeCarrierCatalog } from "../scripts/practice_carriers.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const PRACTICE_CARRIERS = await buildPracticeCarrierCatalog();

Deno.test("the configured map's practice canon matches the generator (run `deno task codegen`)", async () => {
  const path = join(REPO_AUTHORED_PATHS.map, PRACTICE_CANON_PAGE_REL);
  const committed = await Deno.readTextFile(path);
  assertEquals(
    committed,
    await canonicalGeneratedMarkdown(path, renderPracticeCanonDoc()),
    `${
      join(REPO_AUTHORED_PATHS.mapRel, PRACTICE_CANON_PAGE_REL)
    } is stale — run \`deno task codegen\``,
  );
});

Deno.test("the configured map's public practice page matches the generator (run `deno task codegen`)", async () => {
  const path = join(REPO_AUTHORED_PATHS.map, PRACTICE_PUBLIC_PAGE_REL);
  const committed = await Deno.readTextFile(path);
  assertEquals(
    committed,
    await canonicalGeneratedMarkdown(path, renderPracticePublicDoc()),
    `${
      join(REPO_AUTHORED_PATHS.mapRel, PRACTICE_PUBLIC_PAGE_REL)
    } is stale — run \`deno task codegen\``,
  );
});

Deno.test("every tenet, property, and deferred-consumer id is unique and kebab-case", () => {
  const seen = new Set<string>();
  const ids = [
    ...PRACTICE_CANON.map((tenet) => tenet.id),
    ...PRACTICE_PROPERTIES.map((property) => property.id),
    ...PRACTICE_DEFERRED_CONSUMERS.map((consumer) => consumer.id),
  ];
  for (const id of ids) {
    assert(!seen.has(id), `duplicate practice id: ${id}`);
    seen.add(id);
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id),
      `practice id is not kebab-case: ${id}`,
    );
  }
});

/** Every carrier member the canon cites, in every tier, deduplicated. */
function everyCarrierMember(): readonly string[] {
  return [
    ...new Set(
      PRACTICE_CANON.flatMap((tenet) => allUpheldKeys(tenet))
        .map((key) => parseCarrier(key).member),
    ),
  ];
}

Deno.test("every tenet carries a belief that names no carrier and no identifier", () => {
  const members = everyCarrierMember();
  for (const tenet of PRACTICE_CANON) {
    const why = tenet.why.trim();
    assert(why.length > 0, `tenet ${tenet.id} has no belief`);
    assert(
      !why.includes("`"),
      `tenet ${tenet.id}: the belief names an identifier`,
    );
    assert(
      why !== tenet.obligation.trim(),
      `tenet ${tenet.id}: the belief restates the obligation`,
    );
    const sentences = why.split(/[.!?](?:\s+|$)/).filter((s) => s.length > 0);
    assert(
      sentences.length <= 2,
      `tenet ${tenet.id}: the belief runs to ${sentences.length} sentences; keep it to one or two`,
    );
    for (const member of members) {
      const pattern = new RegExp(
        `\\b${member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      );
      assert(
        !pattern.test(why),
        `tenet ${tenet.id}: the belief names the carrier "${member}"; state the reason without product vocabulary`,
      );
    }
  }
});

Deno.test("the canon numbers its tenets in lens order, and no lens is empty", () => {
  const order = PRACTICE_ARCS.map((arc) => arc.id);
  assertEquals(new Set(order).size, order.length, "a lens is listed twice");
  const seen = PRACTICE_CANON.map((tenet) => order.indexOf(tenet.arc));
  for (const [index, rank] of seen.entries()) {
    assert(
      rank !== -1,
      `tenet ${
        PRACTICE_CANON[index]?.id
      } has a lens PRACTICE_ARCS does not list`,
    );
    const previous = seen[index - 1] ?? -1;
    assert(
      rank >= previous,
      `tenet ${PRACTICE_CANON[index]?.id} is numbered out of lens order`,
    );
  }
  for (const arc of order) {
    assert(
      PRACTICE_CANON.some((tenet) => tenet.arc === arc),
      `no tenet belongs to the lens: ${arc}`,
    );
  }
});

Deno.test("every upheld key names a live member, on the right tier", () => {
  for (const tenet of PRACTICE_CANON) {
    const entries = upheldEntries(tenet);
    assert(entries.length > 0, `tenet is upheld by nothing: ${tenet.id}`);
    for (const { tier, keys } of entries) {
      for (const key of keys) {
        const { set } = parseCarrier(key);
        const carriers = tier === "taught"
          ? PRACTICE_CARRIERS.teaching
          : PRACTICE_CARRIERS.enforcement;
        assert(
          carriers.some((carrier) => carrier.key === key),
          `tenet ${tenet.id} ${tier} key names no compatible live carrier: ${key}`,
        );
        if (tier === "taught") {
          assert(
            set === "skill",
            `tenet ${tenet.id} taught tier carries a non-skill key: ${key}`,
          );
        } else {
          assert(
            set !== "skill",
            `tenet ${tenet.id} ${tier} tier carries a skill key: ${key}`,
          );
        }
      }
    }
  }
});

Deno.test("every bundled skill is claimed by a tenet or recorded absent — exactly one, with a reason", () => {
  const claimed = new Set(
    PRACTICE_CANON.flatMap((tenet) => allUpheldKeys(tenet))
      .map((key) => parseCarrier(key))
      .filter(({ set }) => set === "skill")
      .map(({ member }) => member),
  );
  const skills = PRACTICE_CARRIERS.teaching.map(({ member }) => member);
  for (const skill of skills) {
    const absent = skill in PRACTICE_DELIBERATELY_ABSENT;
    assert(
      claimed.has(skill) || absent,
      `bundled skill is neither claimed by a tenet nor recorded absent: ${skill}`,
    );
    assert(
      !(claimed.has(skill) && absent),
      `stale absence record: the canon claims ${skill}`,
    );
  }
  for (const [skill, reason] of Object.entries(PRACTICE_DELIBERATELY_ABSENT)) {
    assert(
      skills.includes(skill),
      `absence record names no live bundled skill: ${skill}`,
    );
    assert(
      reason.trim().length > 0,
      `blank absence reason for bundled skill: ${skill}`,
    );
  }
});

Deno.test("every mechanism and human or agent yield cites a live member", () => {
  const nodeIds = new Set(allFeatureNodes().map(({ node }) => node.id));
  const clusterIds = new Set(HUMAN_BENEFIT_CANON.map((cluster) => cluster.id));
  const agentBenefitIds = new Set(
    allAgentBenefitEntries().map(({ entry }) => entry.id),
  );
  const citing = [
    ...PRACTICE_CANON.map((tenet) => ({
      id: tenet.id,
      mechanisms: tenet.mechanisms,
      yields: tenet.yields,
      agentYields: tenet.agentYields,
    })),
    ...PRACTICE_PROPERTIES.map((property) => ({
      id: property.id,
      mechanisms: property.mechanisms,
      yields: property.yields ?? [],
      agentYields: property.agentYields ?? [],
    })),
  ];
  for (const { id, mechanisms, yields, agentYields } of citing) {
    assert(mechanisms.length > 0, `no mechanisms cited by: ${id}`);
    for (const mechanism of mechanisms) {
      assert(
        nodeIds.has(mechanism),
        `${id} cites unknown feature node: ${mechanism}`,
      );
    }
    for (const cluster of yields) {
      assert(
        clusterIds.has(cluster),
        `${id} yields unknown benefit cluster: ${cluster}`,
      );
    }
    for (const outcome of agentYields) {
      assert(
        agentBenefitIds.has(outcome),
        `${id} enables unknown agent benefit: ${outcome}`,
      );
    }
  }
  for (const tenet of PRACTICE_CANON) {
    assert(tenet.yields.length > 0, `tenet yields nothing: ${tenet.id}`);
    assert(
      tenet.agentYields.length > 0,
      `tenet enables no coding-agent outcome: ${tenet.id}`,
    );
  }
});

interface AgentOutcomeCoverageFixture {
  readonly outcomeIds: readonly string[];
  readonly tenets: readonly { id: string; agentYields: readonly string[] }[];
  readonly properties: readonly {
    id: string;
    agentYields?: readonly string[];
  }[];
  readonly absences: Readonly<Record<string, string>>;
}

/** Report every unclaimed outcome, stale absence, and stranded absence record. */
function agentOutcomeCoverageOffenders(
  fixture: AgentOutcomeCoverageFixture,
): string[] {
  const live = new Set(fixture.outcomeIds);
  const claimed = new Set([
    ...fixture.tenets.flatMap((tenet) => [...tenet.agentYields]),
    ...fixture.properties.flatMap((property) => [
      ...(property.agentYields ?? []),
    ]),
  ]);
  const offenders: string[] = [];
  for (const outcome of fixture.outcomeIds) {
    const absent = Object.hasOwn(fixture.absences, outcome);
    if (!claimed.has(outcome) && !absent) {
      offenders.push(`${outcome}: no practice carrier or recorded absence`);
    }
    if (claimed.has(outcome) && absent) {
      offenders.push(`${outcome}: claimed with a stale absence`);
    }
  }
  for (const [outcome, reason] of Object.entries(fixture.absences)) {
    if (!live.has(outcome)) {
      offenders.push(`${outcome}: absence names no live agent benefit`);
    }
    if (reason.trim() === "") {
      offenders.push(`${outcome}: absence has no reason`);
    }
  }
  return offenders;
}

/** Bind agent-outcome coverage to both canon authorities and the absence ledger. */
function liveAgentOutcomeCoverage(): AgentOutcomeCoverageFixture {
  return {
    outcomeIds: allAgentBenefitEntries().map(({ entry }) => entry.id),
    tenets: PRACTICE_CANON,
    properties: PRACTICE_PROPERTIES,
    absences: PRACTICE_AGENT_BENEFIT_ABSENCES,
  };
}

Deno.test("every coding-agent outcome is enabled by the practice or recorded absent", () => {
  assertEquals(
    agentOutcomeCoverageOffenders(liveAgentOutcomeCoverage()),
    [],
  );
});

Deno.test("a future coding-agent outcome enrolls in practice coverage", () => {
  assertEquals(
    agentOutcomeCoverageOffenders({
      outcomeIds: ["current-outcome", "freshly-named-outcome"],
      tenets: [{ id: "practice", agentYields: ["current-outcome"] }],
      properties: [],
      absences: {},
    }),
    ["freshly-named-outcome: no practice carrier or recorded absence"],
  );
  assertEquals(
    agentOutcomeCoverageOffenders({
      outcomeIds: ["current-outcome"],
      tenets: [{ id: "practice", agentYields: ["current-outcome"] }],
      properties: [],
      absences: { "current-outcome": "A former exception." },
    }),
    ["current-outcome: claimed with a stale absence"],
  );
});

Deno.test("every feature pillar is claimed at some resolution or recorded absent — exactly one, with a reason", () => {
  const flattened = allFeatureNodes();
  const parents = new Map<string, string>();
  for (const { node, parent } of flattened) {
    if (parent !== undefined) parents.set(node.id, parent);
  }
  const pillarOf = (id: string): string => {
    let current = id;
    for (
      let parent = parents.get(current);
      parent !== undefined;
      parent = parents.get(current)
    ) {
      current = parent;
    }
    return current;
  };
  const claimedPillars = new Set(
    [
      ...PRACTICE_CANON.flatMap((tenet) => [...tenet.mechanisms]),
      ...PRACTICE_PROPERTIES.flatMap((property) => [...property.mechanisms]),
    ].map(pillarOf),
  );
  const pillars = flattened
    .filter(({ depth }) => depth === 0)
    .map(({ node }) => node.id);
  for (const pillar of pillars) {
    const absent = pillar in PRACTICE_PILLAR_ABSENCES;
    assert(
      claimedPillars.has(pillar) || absent,
      `feature pillar is neither cited by the practice canon nor recorded absent: ${pillar}`,
    );
    assert(
      !(claimedPillars.has(pillar) && absent),
      `stale pillar absence: the canon cites ${pillar}`,
    );
  }
  for (const [pillar, reason] of Object.entries(PRACTICE_PILLAR_ABSENCES)) {
    assert(
      pillars.includes(pillar),
      `pillar absence names no live pillar: ${pillar}`,
    );
    assert(
      reason.trim().length > 0,
      `blank pillar absence reason: ${pillar}`,
    );
  }
});

Deno.test("every benefit cluster is yielded or recorded absent — exactly one, with a reason", () => {
  const yielded = new Set([
    ...PRACTICE_CANON.flatMap((tenet) => [...tenet.yields]),
    ...PRACTICE_PROPERTIES.flatMap((property) => [...(property.yields ?? [])]),
  ]);
  const clusters = HUMAN_BENEFIT_CANON.map((cluster) => cluster.id);
  for (const cluster of clusters) {
    const absent = cluster in PRACTICE_CLUSTER_ABSENCES;
    assert(
      yielded.has(cluster) || absent,
      `benefit cluster is neither yielded by the practice canon nor recorded absent: ${cluster}`,
    );
    assert(
      !(yielded.has(cluster) && absent),
      `stale cluster absence: the canon yields ${cluster}`,
    );
  }
  for (const [cluster, reason] of Object.entries(PRACTICE_CLUSTER_ABSENCES)) {
    assert(
      clusters.includes(cluster),
      `cluster absence names no live cluster: ${cluster}`,
    );
    assert(
      reason.trim().length > 0,
      `blank cluster absence reason: ${cluster}`,
    );
  }
});

Deno.test("the fixed inventory keeps a maintainer per item", () => {
  for (const item of PROJECT_INVENTORY) {
    assert(
      PRACTICE_CANON.some((tenet) => tenet.holds.includes(item)),
      `no tenet maintains the inventory item: ${item}`,
    );
  }
});

Deno.test("the frame's project role carries the fixed inventory phrase verbatim", () => {
  const project = PRACTICE_FRAME.find((role) => role.id === "project");
  assert(project !== undefined, "the frame names no project role");
  assert(
    project.line.includes(inventoryPhrase()),
    "the project role's line does not interpolate the inventory phrase",
  );
});

/** SHA-256 of a UTF-8 string, as lowercase hex. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The pinned practice slice of one deferred consumer, extracted live. */
async function deferredSlice(consumerId: string): Promise<string> {
  switch (consumerId) {
    case "brand-concept-row": {
      const row = CONCEPTS.find((concept) => concept.id === "practice");
      assert(
        row !== undefined,
        "the brand concept map no longer carries a practice row",
      );
      return JSON.stringify(row);
    }
    case "machine-edition-loop": {
      const text = await Deno.readTextFile(
        join(REPO_ROOT, "site/text/discern.txt"),
      );
      const start = text.indexOf("**The practice.**");
      const end = text.indexOf("**Canonical concepts**");
      assert(
        start !== -1 && end > start,
        "site/text/discern.txt no longer carries the practice block markers",
      );
      return text.slice(start, end);
    }
    default:
      throw new Error(
        `no slice extractor for deferred consumer: ${consumerId}`,
      );
  }
}

Deno.test("each deferred consumer's practice prose matches its recorded fingerprint", async () => {
  for (const consumer of PRACTICE_DEFERRED_CONSUMERS) {
    assert(
      consumer.until.trim().length > 0 && consumer.what.trim().length > 0,
      `deferred consumer needs a non-blank what and until: ${consumer.id}`,
    );
    const actual = await sha256Hex(await deferredSlice(consumer.id));
    assertEquals(
      actual,
      consumer.sha256,
      `${consumer.file}: ${consumer.what} changed without meeting the practice canon — ` +
        "align the surface with the canon (render or cite the tenets), or re-record " +
        `its fingerprint in PRACTICE_DEFERRED_CONSUMERS as ${actual} with the change`,
    );
  }
});
