/**
 * Enrolment and sync guard for the practice canon — the canonical-set parity
 * discipline applied to the practice's tenets (the ADR 0051 family, beside
 * feature_canon_enrolment and glossary_enrolment).
 *
 * The taught stratum cannot lag the skill set: every bundled skill must be
 * CLAIMED by a tenet's carriers or recorded in `PRACTICE_DELIBERATELY_ABSENT`
 * with the reason — exactly one of the two. A new bundled skill therefore
 * forces a canon decision the moment it exists, and an absence record for a
 * skill the canon now claims fails as stale.
 *
 * The inverse holds for every citation: a carrier must name a live verb,
 * config table, or bundled skill; a mechanism must name a live feature node;
 * a yield must name a live benefit cluster — so a rename or removal strands
 * its citation and fails the gate. The fixed project inventory must be fully
 * maintained: every item claimed by at least one tenet, every tenet claiming
 * at least one item. And the committed canon page must equal the generator
 * output, the same drift-guard discipline as the other canon pages.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  inventoryPhrase,
  parseCarrier,
  PRACTICE_CANON,
  PRACTICE_CANON_PAGE_REL,
  PRACTICE_DELIBERATELY_ABSENT,
  PRACTICE_FRAME,
  PRACTICE_PROPERTIES,
  PROJECT_INVENTORY,
  renderPracticeCanonDoc,
  tenetHolds,
} from "../scripts/practice_registry.ts";
import { allFeatureNodes, BENEFIT_CANON } from "../scripts/feature_registry.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { bundledSkillNames } from "../src/lib/skills.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

/** The sets a carrier may claim members of, from their single sources. */
const CARRIER_SETS: Readonly<Record<string, readonly string[]>> = {
  verb: [...KNOWN_VERBS],
  config: Object.keys(configSchema.shape),
  skill: await bundledSkillNames(),
};

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

Deno.test("every tenet and property id is unique and kebab-case", () => {
  const seen = new Set<string>();
  const ids = [
    ...PRACTICE_CANON.map((tenet) => tenet.id),
    ...PRACTICE_PROPERTIES.map((property) => property.id),
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

Deno.test("every carrier names a live member of a known set", () => {
  for (const tenet of PRACTICE_CANON) {
    assert(tenet.carriers.length > 0, `tenet has no carriers: ${tenet.id}`);
    for (const carrier of tenet.carriers) {
      const { set, member } = parseCarrier(carrier);
      const members = CARRIER_SETS[set];
      assert(
        members !== undefined,
        `tenet ${tenet.id} carrier uses unknown set: ${carrier}`,
      );
      assert(
        members.includes(member),
        `tenet ${tenet.id} carrier names no live member: ${carrier}`,
      );
    }
    assert(
      tenetHolds(tenet).length > 0,
      `tenet derives no holds: ${tenet.id}`,
    );
  }
});

Deno.test("every bundled skill is claimed by a tenet or recorded absent — exactly one", () => {
  const claimed = new Set(
    PRACTICE_CANON.flatMap((tenet) => tenet.carriers)
      .map((carrier) => parseCarrier(carrier))
      .filter(({ set }) => set === "skill")
      .map(({ member }) => member),
  );
  const skills = CARRIER_SETS["skill"] ?? [];
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
  for (const skill of Object.keys(PRACTICE_DELIBERATELY_ABSENT)) {
    assert(
      skills.includes(skill),
      `absence record names no live bundled skill: ${skill}`,
    );
  }
});

Deno.test("every mechanism cites a live feature node and every yield a live benefit cluster", () => {
  const nodeIds = new Set(allFeatureNodes().map(({ node }) => node.id));
  const clusterIds = new Set(BENEFIT_CANON.map((cluster) => cluster.id));
  const citing = [
    ...PRACTICE_CANON.map((tenet) => ({
      id: tenet.id,
      mechanisms: tenet.mechanisms,
    })),
    ...PRACTICE_PROPERTIES.map((property) => ({
      id: property.id,
      mechanisms: property.mechanisms,
    })),
  ];
  for (const { id, mechanisms } of citing) {
    assert(mechanisms.length > 0, `no mechanisms cited by: ${id}`);
    for (const mechanism of mechanisms) {
      assert(
        nodeIds.has(mechanism),
        `${id} cites unknown feature node: ${mechanism}`,
      );
    }
  }
  for (const tenet of PRACTICE_CANON) {
    assert(tenet.yields.length > 0, `tenet yields nothing: ${tenet.id}`);
    for (const cluster of tenet.yields) {
      assert(
        clusterIds.has(cluster),
        `tenet ${tenet.id} yields unknown benefit cluster: ${cluster}`,
      );
    }
  }
});

Deno.test("the fixed inventory is fully maintained", () => {
  for (const item of PROJECT_INVENTORY) {
    assert(
      PRACTICE_CANON.some((tenet) => tenet.holds.includes(item)),
      `no tenet maintains the inventory item: ${item}`,
    );
  }
  for (const tenet of PRACTICE_CANON) {
    assert(
      tenet.holds.length > 0,
      `tenet maintains no inventory item: ${tenet.id}`,
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
