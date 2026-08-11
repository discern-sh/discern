/**
 * Coverage guards for the benefit canon (ADR 0268) — the enrolment discipline
 * pointed at value. Every feature node must be cited by a benefit entry's
 * `drawsOn` or recorded in `BENEFIT_COVERAGE_ABSENCES` with the reason,
 * exactly one of the two, so a new capability cannot land without someone
 * stating what it buys a person. Every public claim in the brand ledger must
 * be carried by at least one benefit, so public wording always has a
 * benefit-shaped home. A stranded citation — a feature id or claim slug that
 * no longer exists — fails loudly. Commercial value and the reason it follows
 * stay separate from the claim ledger's publication qualifications (ADR 0269).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  allBenefitEntries,
  allFeatureNodes,
  BENEFIT_CANON,
  BENEFIT_CANON_CATEGORY,
  BENEFIT_CANON_COMMERCIAL_VALUE,
  BENEFIT_CANON_PROMISE,
  BENEFIT_COVERAGE_ABSENCES,
  renderFeatureCanonBenefitsDoc,
} from "../scripts/feature_registry.ts";
import { CLAIMS, type ClaimSlug } from "../scripts/brand/claims.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

Deno.test("benefit ids are unique across the benefit canon and the feature tree, and every statement is complete", () => {
  const featureIds = new Set(allFeatureNodes().map(({ node }) => node.id));
  const seen = new Set<string>();
  for (
    const [id, sentence] of [
      ["benefit-canon-category", BENEFIT_CANON_CATEGORY],
      ["benefit-canon-promise", BENEFIT_CANON_PROMISE],
      ["benefit-canon-commercial-value", BENEFIT_CANON_COMMERCIAL_VALUE],
    ] as const
  ) {
    assert(
      /[.!?]$/u.test(sentence.trim()),
      `${id} is not a complete sentence`,
    );
    assert(!sentence.includes("`"), `${id} contains product-code markup`);
  }
  const claim = (id: string): void => {
    assert(!seen.has(id), `duplicate benefit-canon id: ${id}`);
    assert(
      !featureIds.has(id),
      `benefit-canon id collides with a feature node: ${id}`,
    );
    assert(KEBAB.test(id), `benefit-canon id is not kebab-case: ${id}`);
    seen.add(id);
  };
  for (const cluster of BENEFIT_CANON) {
    claim(cluster.id);
    assert(cluster.title.trim().length > 0, `empty title for: ${cluster.id}`);
    assert(
      !cluster.title.endsWith("."),
      `cluster title carries a trailing period: ${cluster.id}`,
    );
    assert(
      /[.!?]$/u.test(cluster.promise.trim()),
      `cluster "promise" is not a complete sentence for: ${cluster.id}`,
    );
    assert(
      /[.!?]$/u.test(cluster.commercialValue.trim()),
      `cluster "commercialValue" is not a complete sentence for: ${cluster.id}`,
    );
    assert(
      !cluster.promise.includes("`") &&
        !cluster.commercialValue.includes("`"),
      `cluster ${cluster.id} mixes product-code markup into human value`,
    );
    assert(
      cluster.primaryFor.length > 0,
      `cluster ${cluster.id} names no primary reader`,
    );
    assertEquals(
      new Set(cluster.primaryFor).size,
      cluster.primaryFor.length,
      `cluster ${cluster.id} names a primary reader twice`,
    );
    assert(
      cluster.benefits.length > 0,
      `cluster ${cluster.id} has no benefits — a cluster is a grouping, not a leaf`,
    );
  }
  for (const { entry } of allBenefitEntries()) {
    claim(entry.id);
    assert(entry.title.trim().length > 0, `empty title for: ${entry.id}`);
    assert(
      !entry.title.endsWith("."),
      `benefit title carries a trailing period: ${entry.id}`,
    );
    assert(
      /[.!?]$/u.test(entry.value.trim()),
      `benefit "value" is not a complete sentence for: ${entry.id}`,
    );
    assert(
      /[.!?]$/u.test(entry.whyItFollows.trim()),
      `benefit "whyItFollows" is not a complete sentence for: ${entry.id}`,
    );
    assert(
      !entry.value.includes("`"),
      `benefit value contains product-code markup instead of human value: ${entry.id}`,
    );
    assert(entry.drawsOn.length > 0, `benefit cites no features: ${entry.id}`);
    assertEquals(
      new Set(entry.drawsOn).size,
      entry.drawsOn.length,
      `benefit cites a feature twice: ${entry.id}`,
    );
  }
});

Deno.test("every drawsOn citation names a live feature node", () => {
  const featureIds = new Set(allFeatureNodes().map(({ node }) => node.id));
  for (const { entry } of allBenefitEntries()) {
    for (const id of entry.drawsOn) {
      assert(
        featureIds.has(id),
        `benefit ${entry.id} cites unknown feature node: ${id}`,
      );
    }
  }
});

Deno.test("every feature node is cited by a benefit or recorded absent — exactly one of the two", () => {
  const cited = new Set(
    allBenefitEntries().flatMap(({ entry }) => [...entry.drawsOn]),
  );
  const featureIds = new Set(allFeatureNodes().map(({ node }) => node.id));
  const uncovered: string[] = [];
  const stale: string[] = [];
  for (const id of featureIds) {
    const absent = id in BENEFIT_COVERAGE_ABSENCES;
    if (!cited.has(id) && !absent) uncovered.push(id);
    if (cited.has(id) && absent) stale.push(id);
  }
  assertEquals(
    uncovered,
    [],
    "state what each buys a person in a benefit's drawsOn, or record the absence with its reason in BENEFIT_COVERAGE_ABSENCES",
  );
  assertEquals(
    stale,
    [],
    "these features are cited by a benefit — remove their stale absence records",
  );
  for (const [id, reason] of Object.entries(BENEFIT_COVERAGE_ABSENCES)) {
    assert(
      featureIds.has(id),
      `absence record names an unknown feature node: ${id}`,
    );
    assert(
      reason.trim().length > 0,
      `absence record carries no reason: ${id}`,
    );
  }
});

Deno.test("every public claim in the ledger is carried by at least one benefit", () => {
  const carried = new Set(
    allBenefitEntries().flatMap(({ entry }) => [...(entry.claims ?? [])]),
  );
  const uncarried = (Object.keys(CLAIMS) as ClaimSlug[]).filter((slug) =>
    !carried.has(slug)
  );
  assertEquals(
    uncarried,
    [],
    "every public claim needs a benefit-shaped home — cite it from the benefit it backs",
  );
});

const COMMAND_MENTION = /`discern ([a-z][a-z-]*)/g;

/** Extract backticked discern command names from benefit-canon prose. */
function mentionedVerbs(text: string): string[] {
  return [...text.matchAll(COMMAND_MENTION)].map((m) => m[1] ?? "");
}

Deno.test("every discern command mentioned in benefit prose is a live verb", () => {
  const texts: Array<[string, string]> = [];
  for (const cluster of BENEFIT_CANON) {
    texts.push([cluster.id, cluster.promise]);
    texts.push([cluster.id, cluster.commercialValue]);
  }
  for (const { entry } of allBenefitEntries()) {
    texts.push([entry.id, entry.value]);
    texts.push([entry.id, entry.whyItFollows]);
  }
  for (const [id, text] of texts) {
    for (const verb of mentionedVerbs(text)) {
      assert(
        KNOWN_VERBS.has(verb),
        `${id} mentions \`discern ${verb}\`, which is not a live verb`,
      );
    }
  }
});

Deno.test("control: command-mention extraction discriminates", () => {
  assertEquals(mentionedVerbs("run `discern done`, read `discern.toml`"), [
    "done",
  ]);
});

Deno.test("the rendered page carries the banner, every cluster, every benefit, and the coverage appendix", () => {
  const doc = renderFeatureCanonBenefitsDoc();
  assertStringIncludes(doc, "<!-- GENERATED by `deno task codegen`");
  assertStringIncludes(doc, "# Benefit canon");
  for (const cluster of BENEFIT_CANON) {
    assertStringIncludes(
      doc,
      `## ${cluster.title}`,
      `no rendering for cluster: ${cluster.id}`,
    );
  }
  for (const { entry } of allBenefitEntries()) {
    assertStringIncludes(
      doc,
      `### ${entry.title}`,
      `no rendering for benefit: ${entry.id}`,
    );
  }
  for (const slug of Object.keys(CLAIMS)) {
    assertStringIncludes(
      doc,
      `- \`${slug}\` — `,
      `claims appendix misses ledger claim: ${slug}`,
    );
  }
  assertStringIncludes(doc, "### Recorded absences");
  assertStringIncludes(doc, "### Claim homes");
});

Deno.test("the commercial account is not interrupted by claim-review qualifications", () => {
  const doc = renderFeatureCanonBenefitsDoc();
  const [commercialBody = doc] = doc.split(
    "## Coverage and claim traceability",
  );
  assert(
    !commercialBody.includes("Caveat:"),
    "commercial body renders an inline caveat",
  );
  for (
    const evidenceClass of [
      "(structural)",
      "(demonstrated)",
      "(observational)",
      "(anecdotal)",
      "(hypothesis)",
    ]
  ) {
    assert(
      !commercialBody.includes(evidenceClass),
      `commercial body renders an evidence-class qualification: ${evidenceClass}`,
    );
  }
  for (const slug of Object.keys(CLAIMS)) {
    assert(
      !commercialBody.includes(`\`${slug}\``),
      `commercial body renders a claim-ledger slug: ${slug}`,
    );
  }
});
