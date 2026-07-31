/**
 * Closed-set guard for the tip registry (ADR 0234): ids are unique and
 * kebab-case, every feature citation resolves to a live feature-canon node
 * (the reverse of the canon's hint-citation guard), every follow-through verb
 * is a live verb, and no `since` tag post-dates the shipping version — the
 * structural guarantee behind the fresh-install baseline rule, under the same
 * comparator selection applies.
 */

import { assert, assertEquals } from "@std/assert";
import { TIPS } from "../src/shared/tips.ts";
import { allFeatureNodes } from "../scripts/feature_registry.ts";
import { KNOWN_VERBS } from "../src/shared/verbs.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import { compareTipVersions } from "../src/engine/desk/tips.ts";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

Deno.test("tip ids are unique, kebab-case, and the registry is non-empty", () => {
  assert(TIPS.length > 0, "the desk needs at least one tip to teach");
  const ids = TIPS.map((tip) => tip.id);
  assertEquals(new Set(ids).size, ids.length, "tip ids must be unique");
  for (const id of ids) {
    assert(KEBAB.test(id), `tip id ${JSON.stringify(id)} must be kebab-case`);
  }
});

Deno.test("every tip cites at least one live feature-canon node", () => {
  const live = new Set(allFeatureNodes().map(({ node }) => node.id));
  const offenders: string[] = [];
  for (const tip of TIPS) {
    if (tip.features.length === 0) {
      offenders.push(`${tip.id}: cites no feature`);
    }
    for (const id of tip.features) {
      if (!live.has(id)) {
        offenders.push(
          `${tip.id}: cites feature '${id}', which the canon does not carry`,
        );
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `stale feature citations in the tip registry:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every tip follow-through verb is a live verb", () => {
  const offenders: string[] = [];
  for (const tip of TIPS) {
    const rule = tip.followThrough;
    if (rule === undefined) {
      continue;
    }
    if (rule.verbs.length === 0) {
      offenders.push(`${tip.id}: declares a follow-through with no verbs`);
    }
    for (const verb of rule.verbs) {
      if (!KNOWN_VERBS.has(verb)) {
        offenders.push(
          `${tip.id}: follow-through names unknown verb '${verb}'`,
        );
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `follow-through declarations must name live verbs:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("no tip's since tag post-dates the shipping version", () => {
  // A fresh install baselines its seen-state at the current version; an entry
  // dated after it would render "New in" on day one, which the baseline rule
  // forbids. The comparison is the selection engine's own.
  const offenders = TIPS.filter(
    (tip) =>
      tip.since !== undefined &&
      compareTipVersions(tip.since, KIT_VERSION) > 0,
  ).map((tip) => `${tip.id}: since ${tip.since} > ${KIT_VERSION}`);
  assertEquals(
    offenders,
    [],
    `since tags must not exceed the shipping version:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("every since tag is a dotted-numeric version", () => {
  const offenders = TIPS.filter(
    (tip) => tip.since !== undefined && !/^\d+\.\d+\.\d+$/.test(tip.since),
  ).map((tip) => `${tip.id}: ${JSON.stringify(tip.since)}`);
  assertEquals(
    offenders,
    [],
    `since tags must be x.y.z versions:\n  ${offenders.join("\n  ")}`,
  );
});
