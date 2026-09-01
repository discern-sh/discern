/**
 * Coverage guards for the demand canon (ADR 0292) — the benefit canon's
 * enrolment discipline run in reverse. Every benefit must be answered by a
 * demand entry or recorded in `SUPPLY_PUSH_RECORDS` with the reason,
 * exactly one of the two, so a new benefit cannot land without someone
 * stating who is hypothesized to want it — or naming it a bet. Every entry
 * must cite the benefits that answer it or record a gap, so observed demand
 * with no product home stays visible as roadmap signal. Demand evidence is
 * held to the claims ledger's market classes: `structural` and
 * `demonstrated` describe the product and can never describe the market.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  allFeatureNodes,
  allHumanBenefitEntries,
  HUMAN_BENEFIT_CANON,
} from "../scripts/feature_registry.ts";
import {
  allDemandEntries,
  DEMAND_CANON,
  DEMAND_CANON_SITUATION,
  DEMAND_CANON_TENSION,
  DEMAND_CORPORA,
  DEMAND_EVIDENCE_CLASS_NAMES,
  type DemandAnswer,
  type DemandCorpus,
  SUPPLY_PUSH_RECORDS,
} from "../scripts/brand/demand.ts";
import { EVIDENCE_CLASS_NAMES } from "../scripts/brand/model.ts";
import { renderBrandDoc } from "../scripts/brand_registry.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SENTENCE = /[.!?]$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_DIMINISHING_LANGUAGE =
  /\b(?:babysit(?:ter|ting)?|hall monitor|minder)\b/i;

Deno.test("DemandAnswer excludes a simultaneous benefit answer and gap", () => {
  const contradictoryShape = {
    benefits: ["future-benefit"] as const,
    gap: "A future gap.",
  };
  // @ts-expect-error — one demand cannot be answered and remain a gap
  const contradictory: DemandAnswer = contradictoryShape;
  assert("benefits" in contradictory && "gap" in contradictory);
});

Deno.test("demand ids are unique and do not collide with the benefit canon or the feature tree", () => {
  const taken = new Set<string>([
    ...allFeatureNodes().map(({ node }) => node.id),
    ...HUMAN_BENEFIT_CANON.map((cluster) => cluster.id),
    ...allHumanBenefitEntries().map(({ entry }) => entry.id),
  ]);
  const seen = new Set<string>();
  const claim = (id: string): void => {
    assert(!seen.has(id), `duplicate demand-canon id: ${id}`);
    assert(
      !taken.has(id),
      `demand-canon id collides with a benefit or feature id: ${id}`,
    );
    assert(KEBAB.test(id), `demand-canon id is not kebab-case: ${id}`);
    seen.add(id);
  };
  for (const territory of DEMAND_CANON) claim(territory.id);
  for (const { entry } of allDemandEntries()) claim(entry.id);
});

Deno.test("every demand statement is complete and stays in human language", () => {
  for (
    const [id, sentence] of [
      ["demand-canon-situation", DEMAND_CANON_SITUATION],
      ["demand-canon-tension", DEMAND_CANON_TENSION],
    ] as const
  ) {
    assert(SENTENCE.test(sentence.trim()), `${id} is not a complete sentence`);
    assert(!sentence.includes("`"), `${id} contains product-code markup`);
  }
  for (const territory of DEMAND_CANON) {
    assert(
      territory.title.trim().length > 0,
      `empty title for: ${territory.id}`,
    );
    assert(
      !territory.title.endsWith("."),
      `territory title carries a trailing period: ${territory.id}`,
    );
    assert(
      SENTENCE.test(territory.tension.trim()),
      `territory "tension" is not a complete sentence for: ${territory.id}`,
    );
    assert(
      !territory.tension.includes("`"),
      `territory ${territory.id} mixes product-code markup into the tension`,
    );
    assertEquals(
      new Set(territory.heardAs).size,
      territory.heardAs.length,
      `territory ${territory.id} repeats a heard-as phrase`,
    );
    for (const phrase of territory.heardAs) {
      assert(
        phrase.trim().length > 0 && !phrase.endsWith("."),
        `territory ${territory.id} heard-as phrases are fragments of market language, not sentences: ${phrase}`,
      );
    }
  }
  for (const { entry } of allDemandEntries()) {
    assert(entry.title.trim().length > 0, `empty title for: ${entry.id}`);
    assert(
      !entry.title.endsWith("."),
      `entry title carries a trailing period: ${entry.id}`,
    );
    for (
      const [field, text] of [
        ["situation", entry.situation],
        ["alternative", entry.alternative],
        ["cost", entry.cost],
      ] as const
    ) {
      assert(
        SENTENCE.test(text.trim()),
        `entry "${field}" is not a complete sentence for: ${entry.id}`,
      );
      assert(
        !text.includes("`"),
        `entry ${entry.id} mixes product-code markup into "${field}"`,
      );
    }
    assertEquals(
      new Set(entry.forces).size,
      entry.forces.length,
      `entry ${entry.id} names a force twice`,
    );
    assertEquals(
      new Set(entry.segments).size,
      entry.segments.length,
      `entry ${entry.id} names a segment twice`,
    );
  }
});

Deno.test("demand language never casts the owner as the agents' minder", () => {
  const doc = renderBrandDoc("demand-canon");
  assert(
    !OWNER_DIMINISHING_LANGUAGE.test(doc),
    "describe the owner's attention and the work's state without casting them as a babysitter or hall monitor",
  );
  assert(
    OWNER_DIMINISHING_LANGUAGE.test("Babysitting a worker"),
    "control: the owner-framing guard must catch a fresh singular sibling",
  );
});

Deno.test("demand evidence is dated, sourced, and confined to the ledger's market classes", () => {
  // The market classes are exactly the ledger's classes below the
  // product-truth pair, in the ledger's own strongest-first order — a new
  // ledger class enrols or is excluded here deliberately.
  assertEquals(
    [...DEMAND_EVIDENCE_CLASS_NAMES],
    EVIDENCE_CLASS_NAMES.slice(2),
    "demand evidence classes must be the claims ledger's market classes",
  );
  for (const { entry } of allDemandEntries()) {
    for (const row of entry.evidence) {
      assert(
        SENTENCE.test(row.source.trim()),
        `evidence source is not a complete sentence for: ${entry.id}`,
      );
      assert(
        ISO_DATE.test(row.date) && !Number.isNaN(Date.parse(row.date)),
        `evidence date is not a valid YYYY-MM-DD date for: ${entry.id}`,
      );
      if (row.class !== "corroborated") continue;
      assert(
        row.corpus in DEMAND_CORPORA,
        `corroborated evidence cites an unrecorded corpus: ${entry.id}`,
      );
    }
  }
});

Deno.test("every recorded corpus is public, independent, bounded, and cited", () => {
  const cited = new Set<string>(
    allDemandEntries().flatMap(({ entry }) =>
      entry.evidence.flatMap((row) =>
        row.class === "corroborated" ? [row.corpus] : []
      )
    ),
  );
  for (const [id, corpus] of Object.entries<DemandCorpus>(DEMAND_CORPORA)) {
    assert(KEBAB.test(id), `corpus id is not kebab-case: ${id}`);
    assert(cited.has(id), `corpus reaches no demand entry: ${id}`);
    assert(
      SENTENCE.test(corpus.pattern.trim()),
      `corpus pattern is not a complete sentence: ${id}`,
    );
    assert(
      corpus.sources.length >= 3,
      `corpus needs at least three public accounts: ${id}`,
    );
    assert(
      new Set(corpus.sources.map((source) => source.url)).size ===
        corpus.sources.length,
      `corpus repeats a public source: ${id}`,
    );
    assert(
      new Set(corpus.sources.map((source) => source.venue)).size >= 2,
      `corpus needs at least two venues: ${id}`,
    );
    for (const source of corpus.sources) {
      assert(
        source.venue.trim().length > 0 && source.title.trim().length > 0,
        `corpus has an unlabeled public source: ${id}`,
      );
      assert(
        source.url.startsWith("https://"),
        `corpus source is not HTTPS: ${id}`,
      );
    }
    assert(
      SENTENCE.test(corpus.limits.trim()),
      `corpus limits are not a complete sentence: ${id}`,
    );
  }
});

Deno.test("the rendered page holds each corpus once and links every corroborated row to it", () => {
  const doc = renderBrandDoc("demand-canon");
  assertStringIncludes(doc, "## Corpora");
  for (const id of Object.keys(DEMAND_CORPORA)) {
    assertEquals(
      doc.split(`### \`${id}\``).length - 1,
      1,
      `corpus rendered other than once: ${id}`,
    );
  }
  for (const { entry } of allDemandEntries()) {
    for (const row of entry.evidence) {
      if (row.class !== "corroborated") continue;
      assertStringIncludes(
        doc,
        `[\`${row.corpus}\`](#${row.corpus})`,
        `corroborated row does not link its corpus: ${entry.id}`,
      );
    }
  }
});

Deno.test("every territory counters a live benefit cluster, and every cluster is countered", () => {
  const clusterIds = new Set(HUMAN_BENEFIT_CANON.map((cluster) => cluster.id));
  const countered = new Set<string>();
  for (const territory of DEMAND_CANON) {
    assert(
      clusterIds.has(territory.counterpart),
      `territory ${territory.id} counters unknown cluster: ${territory.counterpart}`,
    );
    countered.add(territory.counterpart);
  }
  const uncountered = [...clusterIds].filter((id) => !countered.has(id));
  assertEquals(
    uncountered,
    [],
    "every benefit cluster needs a demand-side counterpart territory",
  );
});

Deno.test("every answering citation names a live benefit, exactly once per entry", () => {
  const benefitIds = new Set(
    allHumanBenefitEntries().map(({ entry }) => entry.id),
  );
  for (const { entry } of allDemandEntries()) {
    if (entry.answer.benefits === undefined) continue;
    assertEquals(
      new Set(entry.answer.benefits).size,
      entry.answer.benefits.length,
      `entry ${entry.id} cites a benefit twice`,
    );
    for (const id of entry.answer.benefits) {
      assert(
        benefitIds.has(id),
        `entry ${entry.id} cites unknown benefit: ${id}`,
      );
    }
  }
});

Deno.test("every benefit is answered by an entry or recorded supply-push — exactly one of the two", () => {
  const answered = new Set(
    allDemandEntries().flatMap(({ entry }) =>
      entry.answer.benefits !== undefined ? [...entry.answer.benefits] : []
    ),
  );
  const benefitIds = new Set(
    allHumanBenefitEntries().map(({ entry }) => entry.id),
  );
  const uncovered: string[] = [];
  const stale: string[] = [];
  for (const id of benefitIds) {
    const recorded = id in SUPPLY_PUSH_RECORDS;
    if (!answered.has(id) && !recorded) uncovered.push(id);
    if (answered.has(id) && recorded) stale.push(id);
  }
  assertEquals(
    uncovered,
    [],
    "state whose struggle each benefit answers in a demand entry, or record the bet with its reason in SUPPLY_PUSH_RECORDS",
  );
  assertEquals(
    stale,
    [],
    "these benefits are answered by a demand entry — remove their stale supply-push records",
  );
  for (const [id, reason] of Object.entries(SUPPLY_PUSH_RECORDS)) {
    assert(
      benefitIds.has(id),
      `supply-push record names an unknown benefit: ${id}`,
    );
    assert(
      SENTENCE.test(reason.trim()),
      `supply-push record is not a complete sentence: ${id}`,
    );
  }
});

Deno.test("every recorded gap states its reason as a complete sentence", () => {
  for (const { entry } of allDemandEntries()) {
    if (entry.answer.gap === undefined) continue;
    assert(
      SENTENCE.test(entry.answer.gap.trim()),
      `entry "gap" is not a complete sentence for: ${entry.id}`,
    );
  }
});

const COMMAND_MENTION = /`discern ([a-z][a-z-]*)/g;

/** Extract backticked discern command names from demand-canon prose. */
function mentionedVerbs(text: string): string[] {
  return [...text.matchAll(COMMAND_MENTION)].map((m) => m[1] ?? "");
}

Deno.test("every discern command mentioned in demand prose is a live verb", () => {
  const texts: Array<[string, string]> = [];
  for (const territory of DEMAND_CANON) {
    texts.push([territory.id, territory.tension]);
  }
  for (const { entry } of allDemandEntries()) {
    texts.push([entry.id, entry.situation]);
    texts.push([entry.id, entry.alternative]);
    texts.push([entry.id, entry.cost]);
    if (entry.answer.gap !== undefined) {
      texts.push([entry.id, entry.answer.gap]);
    }
  }
  for (const [id, reason] of Object.entries(SUPPLY_PUSH_RECORDS)) {
    texts.push([id, reason]);
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

Deno.test("the rendered page carries the banner, every territory, every entry, and the coverage appendix", () => {
  const doc = renderBrandDoc("demand-canon");
  assertStringIncludes(doc, "GENERATED by `deno task codegen`");
  assertStringIncludes(doc, "# Demand canon");
  for (const territory of DEMAND_CANON) {
    assertStringIncludes(
      doc,
      `## ${territory.title}`,
      `no rendering for territory: ${territory.id}`,
    );
  }
  for (const { entry } of allDemandEntries()) {
    assertStringIncludes(
      doc,
      `### ${entry.title}`,
      `no rendering for entry: ${entry.id}`,
    );
  }
  assertStringIncludes(doc, "### Supply-push records");
  assertStringIncludes(doc, "### Recorded gaps");
  for (const id of Object.keys(SUPPLY_PUSH_RECORDS)) {
    assertStringIncludes(
      doc,
      `- \`${id}\` — `,
      `supply-push appendix misses record: ${id}`,
    );
  }
  for (const { entry } of allDemandEntries()) {
    if (entry.answer.gap === undefined) continue;
    assertStringIncludes(
      doc,
      `- \`${entry.id}\` — `,
      `gap appendix misses entry: ${entry.id}`,
    );
  }
});

Deno.test("the rendered account uses the short scan labels", () => {
  const doc = renderBrandDoc("demand-canon");
  const count = (label: string): number =>
    doc.match(
      new RegExp(`^- \\*\\*${label}:\\*\\*`, "gm"),
    )?.length ?? 0;
  for (const label of ["Counterpart", "Tension", "Heard as"]) {
    assertEquals(count(label), DEMAND_CANON.length, `${label} labels`);
  }
  const entries = allDemandEntries();
  for (
    const label of [
      "Situation",
      "Today's alternative",
      "Cost",
      "Forces",
      "Segments",
      "Evidence",
    ]
  ) {
    assertEquals(count(label), entries.length, `${label} labels`);
  }
  const gaps =
    entries.filter(({ entry }) => entry.answer.gap !== undefined).length;
  assertEquals(count("Recorded gap"), gaps, "Recorded gap labels");
  assertEquals(
    count("Answered by"),
    entries.length - gaps,
    "Answered by labels",
  );
});
