/**
 * Guards for the consequence canon (ADR 0370). A consequence is deductive on
 * the benefits and claims it cites, so every citation must resolve to a live
 * row of the audience's benefit canon and the claims ledger. The behavior it
 * predicts is empirical, so its evidence is held to the claims ledger's
 * market classes with a source and a date, a shared hypothesis resolves and
 * is cited, and a hypothesis-class behavior is labelled on the page and
 * kept out of the messaging inventory's public lines. Coverage runs one
 * way: a benefit with no consequence above it needs no record.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
  HUMAN_BENEFIT_AUDIENCES,
  HUMAN_BENEFIT_CANON,
} from "../scripts/feature_registry.ts";
import {
  CONSEQUENCE_AUDIENCES,
  CONSEQUENCE_CANON,
  CONSEQUENCE_EVIDENCE_CLASS_NAMES,
  consequencesFor,
  SHARED_HYPOTHESES,
  type SharedHypothesis,
} from "../scripts/brand/consequences.ts";
import { CLAIMS } from "../scripts/brand/claims.ts";
import {
  allDemandEntries,
  DEMAND_CANON,
  DEMAND_CORPORA,
} from "../scripts/brand/demand.ts";
import { FACT_LINES, HEADLINES } from "../scripts/brand/messaging.ts";
import { EVIDENCE_CLASS_NAMES } from "../scripts/brand/model.ts";
import { renderBrandDoc } from "../scripts/brand_registry.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import { assertFreshCanonIds } from "./canon_ids.ts";

const SENTENCE = /[.!?]$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_DIMINISHING_LANGUAGE =
  /\b(?:babysit(?:ter|ting)?|hall monitor|minder)\b/i;

Deno.test("consequence ids are unique, kebab-case, and collide with no benefit, feature, or demand id", () => {
  const taken = new Set<string>([
    ...allFeatureNodes().map(({ node }) => node.id),
    ...HUMAN_BENEFIT_CANON.map((cluster) => cluster.id),
    ...allHumanBenefitEntries().map(({ entry }) => entry.id),
    ...allAgentBenefitEntries().map(({ entry }) => entry.id),
    ...DEMAND_CANON.map((territory) => territory.id),
    ...allDemandEntries().map(({ entry }) => entry.id),
  ]);
  assertFreshCanonIds("consequence-canon", [
    ...CONSEQUENCE_CANON.map((entry) => entry.id),
    ...Object.keys(SHARED_HYPOTHESES),
  ], taken);
});

Deno.test("every consequence rests on live benefits of its own audience, each cited once", () => {
  const human = new Set(allHumanBenefitEntries().map(({ entry }) => entry.id));
  const agent = new Set(allAgentBenefitEntries().map(({ entry }) => entry.id));
  for (const entry of CONSEQUENCE_CANON) {
    const live = entry.audience === "person" ? human : agent;
    assertEquals(
      new Set(entry.restsOn).size,
      entry.restsOn.length,
      `consequence ${entry.id} cites a benefit twice`,
    );
    for (const id of entry.restsOn) {
      assert(
        live.has(id),
        `consequence ${entry.id} rests on a benefit outside the ${entry.audience} canon: ${id}`,
      );
    }
  }
});

Deno.test("every consequence cites live claims, each once, and person entries name live segments", () => {
  for (const entry of CONSEQUENCE_CANON) {
    assertEquals(
      new Set(entry.claims).size,
      entry.claims.length,
      `consequence ${entry.id} cites a claim twice`,
    );
    for (const slug of entry.claims) {
      assert(
        slug in CLAIMS,
        `consequence ${entry.id} cites unknown claim: ${slug}`,
      );
    }
    if (entry.audience !== "person") continue;
    assertEquals(
      new Set(entry.segments).size,
      entry.segments.length,
      `consequence ${entry.id} names a segment twice`,
    );
    for (const segment of entry.segments) {
      assert(
        (HUMAN_BENEFIT_AUDIENCES as readonly string[]).includes(segment),
        `consequence ${entry.id} names an unknown segment: ${segment}`,
      );
    }
  }
});

Deno.test("every prose field is a complete sentence in human language and every headline is a line", () => {
  for (const entry of CONSEQUENCE_CANON) {
    assert(
      entry.headline.trim().length > 0,
      `empty headline for: ${entry.id}`,
    );
    assert(
      !entry.headline.includes("`"),
      `headline carries product-code markup: ${entry.id}`,
    );
    for (
      const [field, text] of [
        ["consequence", entry.consequence],
        ["then", entry.then.statement],
        ["boundary", entry.boundary],
      ] as const
    ) {
      assert(
        SENTENCE.test(text.trim()),
        `consequence "${field}" is not a complete sentence for: ${entry.id}`,
      );
      assert(
        !text.includes("`"),
        `consequence ${entry.id} mixes product-code markup into "${field}"`,
      );
    }
  }
  for (
    const [id, hypothesis] of Object.entries<SharedHypothesis>(
      SHARED_HYPOTHESES,
    )
  ) {
    assert(
      SENTENCE.test(hypothesis.statement.trim()),
      `shared hypothesis statement is not a complete sentence: ${id}`,
    );
    assert(
      SENTENCE.test(hypothesis.limits.trim()),
      `shared hypothesis limits are not a complete sentence: ${id}`,
    );
  }
});

Deno.test("behavior evidence is dated, sourced, confined to the ledger's market classes, and resolves what it cites", () => {
  assertEquals(
    [...CONSEQUENCE_EVIDENCE_CLASS_NAMES],
    EVIDENCE_CLASS_NAMES.slice(2),
    "behavior evidence classes must be the claims ledger's market classes",
  );
  for (const entry of CONSEQUENCE_CANON) {
    const row = entry.then.evidence;
    assert(
      (CONSEQUENCE_EVIDENCE_CLASS_NAMES as readonly string[]).includes(
        row.class,
      ),
      `behavior evidence carries a product-truth class for: ${entry.id}`,
    );
    assert(
      SENTENCE.test(row.source.trim()),
      `evidence source is not a complete sentence for: ${entry.id}`,
    );
    assert(
      ISO_DATE.test(row.date) && !Number.isNaN(Date.parse(row.date)),
      `evidence date is not a valid YYYY-MM-DD date for: ${entry.id}`,
    );
    if (row.class === "corroborated") {
      assert(
        row.corpus in DEMAND_CORPORA,
        `corroborated behavior cites an unrecorded corpus: ${entry.id}`,
      );
    }
    if (row.shared !== undefined) {
      assertEquals(
        row.class,
        "hypothesis",
        `only a hypothesis may cite a shared hypothesis: ${entry.id}`,
      );
      assert(
        row.shared in SHARED_HYPOTHESES,
        `consequence cites an unrecorded shared hypothesis: ${entry.id}`,
      );
    }
  }
});

Deno.test("every shared hypothesis is cited by at least one consequence", () => {
  const cited = new Set<string>(
    CONSEQUENCE_CANON.flatMap((entry) =>
      entry.then.evidence.shared !== undefined
        ? [entry.then.evidence.shared]
        : []
    ),
  );
  for (const id of Object.keys(SHARED_HYPOTHESES)) {
    assert(cited.has(id), `shared hypothesis reaches no consequence: ${id}`);
  }
});

Deno.test("a hypothesis-class behavior never reaches a fact line or headline row", () => {
  const publicLines = [
    ...FACT_LINES.map((fact) => fact.line),
    ...HEADLINES.map((headline) => headline.line),
  ].map((line) => line.toLowerCase());
  for (const entry of CONSEQUENCE_CANON) {
    if (entry.then.evidence.class !== "hypothesis") continue;
    const statement = entry.then.statement.toLowerCase().replace(/[.!?]$/u, "");
    assert(
      !publicLines.some((line) => line.includes(statement)),
      `a hypothesis-class behavior appears in the messaging inventory: ${entry.id}`,
    );
  }
});

Deno.test("consequence language never casts the owner as the agents' minder", () => {
  const doc = renderBrandDoc("consequence-canon");
  assert(
    !OWNER_DIMINISHING_LANGUAGE.test(doc),
    "describe the work's state and the person's decisions without casting them as a babysitter or hall monitor",
  );
  assert(
    OWNER_DIMINISHING_LANGUAGE.test("Babysitting a worker"),
    "control: the owner-framing guard must catch a fresh singular sibling",
  );
});

const COMMAND_MENTION = /`discern ([a-z][a-z-]*)/g;

/** Extract backticked discern command names from consequence prose. */
function mentionedVerbs(text: string): string[] {
  return [...text.matchAll(COMMAND_MENTION)].map((m) => m[1] ?? "");
}

Deno.test("every discern command mentioned in consequence prose is a live verb", () => {
  for (const entry of CONSEQUENCE_CANON) {
    for (
      const text of [
        entry.consequence,
        entry.then.statement,
        entry.then.evidence.source,
        entry.boundary,
        entry.note ?? "",
      ]
    ) {
      for (const verb of mentionedVerbs(text)) {
        assert(
          KNOWN_VERBS.has(verb),
          `${entry.id} mentions \`discern ${verb}\`, which is not a live verb`,
        );
      }
    }
  }
});

Deno.test("control: command-mention extraction discriminates", () => {
  assertEquals(mentionedVerbs("run `discern done`, read `discern.toml`"), [
    "done",
  ]);
});

Deno.test("the rendered page carries the banner, both audiences, every entry, every hypothesis label, and the shared hypotheses once", () => {
  const doc = renderBrandDoc("consequence-canon");
  assertStringIncludes(doc, "GENERATED by `deno task codegen`");
  assertStringIncludes(doc, "# Consequence canon");
  assertStringIncludes(doc, "## For the person");
  assertStringIncludes(doc, "## For the agent");
  for (const audience of CONSEQUENCE_AUDIENCES) {
    assert(
      consequencesFor(audience).length > 0,
      `no consequences for the ${audience}`,
    );
  }
  for (const entry of CONSEQUENCE_CANON) {
    assertStringIncludes(
      doc,
      `### ${entry.headline}`,
      `no rendering for consequence: ${entry.id}`,
    );
  }
  const hypotheses =
    CONSEQUENCE_CANON.filter((entry) =>
      entry.then.evidence.class === "hypothesis"
    ).length;
  assertEquals(
    doc.match(/^- \*\*Evidence:\*\* hypothesis — /gm)?.length ?? 0,
    hypotheses,
    "every hypothesis-class behavior must be labelled on the page",
  );
  for (const id of Object.keys(SHARED_HYPOTHESES)) {
    assertEquals(
      doc.split(`### \`${id}\``).length - 1,
      1,
      `shared hypothesis rendered other than once: ${id}`,
    );
  }
  for (const entry of CONSEQUENCE_CANON) {
    const shared = entry.then.evidence.shared;
    if (shared === undefined) continue;
    assertStringIncludes(
      doc,
      `[\`${shared}\`](#${shared})`,
      `consequence does not link its shared hypothesis: ${entry.id}`,
    );
  }
});

Deno.test("the rendered account uses the short scan labels", () => {
  const doc = renderBrandDoc("consequence-canon");
  const count = (label: string): number =>
    doc.match(new RegExp(`^- \\*\\*${label}:\\*\\*`, "gm"))?.length ?? 0;
  const total = CONSEQUENCE_CANON.length;
  for (
    const label of [
      "Consequence",
      "Then",
      "Evidence",
      "Rests on",
      "Claims",
      "Boundary",
    ]
  ) {
    assertEquals(count(label), total, `${label} labels`);
  }
  assertEquals(
    count("Segments"),
    consequencesFor("person").length,
    "Segments labels",
  );
  assertEquals(
    count("Note"),
    CONSEQUENCE_CANON.filter((entry) => entry.note !== undefined).length,
    "Note labels",
  );
});
