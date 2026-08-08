/**
 * The copy review as a prose-led registry module: the three scorecards, the
 * automatic-failure list, and the proposed mechanical checks live as typed
 * data; the review procedures stay authored Markdown sections.
 * `copy-review.md` compiles from this module. The proposed checks carry ids
 * so the generated Vale styles (`scripts/brand/vale.ts`) can cite which
 * proposals they implement and record a disposition for the rest.
 */

import { type Register, REGISTERS } from "../model.ts";

/** One scored dimension of a review scorecard. */
export interface ScorecardRow {
  readonly dimension: string;
  readonly test: string;
}

/** One register's scorecard; `closing` is its block-release rule. */
export interface Scorecard {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ScorecardRow[];
  readonly closing?: string;
}

/** The immediate-failure conditions — any one fails a draft outright. */
export const AUTOMATIC_FAILURES: readonly string[] = [
  "makes an unsupported security, correctness, reliability, or autonomy claim;",
  "implies that Proof establishes more than the declared Gate over the exact tree;",
  "implies that a passing Gate grants authority to ship;",
  "presents discern as a sandbox, firewall, AI reviewer, CI replacement, or complete fleet manager;",
  "blames or morally judges coding agents;",
  "excludes new builders from a general-audience surface;",
  "patronizes new builders or suggests engineering expertise is irrelevant;",
  "uses a product term inconsistently with the canonical glossary;",
  "uses brand prose where an exact operational condition is required;",
  "hides destructive consequences or consent scope;",
  "fabricates customer evidence, performance figures, or market validation;",
  "uses the full product canon as page structure.",
];

/** The three scorecards, in rendering order. */
export const SCORECARDS = [
  {
    id: "brand",
    title: "Brand-copy scorecard",
    rows: [
      {
        dimension: "Human desire",
        test:
          "Does the opening describe a future, status, relief, or capability the reader wants?",
      },
      {
        dimension: "Audience recognition",
        test:
          "Can the intended reader recognize their circumstance without a job-title persona?",
      },
      {
        dimension: "Category clarity",
        test: "Can a new visitor tell what kind of product discern is?",
      },
      {
        dimension: "Transformation",
        test:
          "Is the changed experience more prominent than the feature mechanism?",
      },
      {
        dimension: "Cultural relevance",
        test:
          "Does the copy feel connected to the current expansion of agent-built software without trend-chasing?",
      },
      {
        dimension: "Distinctiveness",
        test: "Could a generic AI developer tool use the same copy unchanged?",
      },
      {
        dimension: "Specificity",
        test: "Are there concrete moments, objects, actions, or artifacts?",
      },
      {
        dimension: "Credibility",
        test: "Are important claims supported by mechanisms or evidence?",
      },
      {
        dimension: "Scope discipline",
        test: "Are claim limits clear where misunderstanding would matter?",
      },
      {
        dimension: "Register fit",
        test:
          "Does the page carry the brand's persuasive energy without reading like an enlarged manual?",
      },
      {
        dimension: "Voice",
        test: "Is it literate, confident, inviting, premium, and alive?",
      },
      {
        dimension: "Seriousness",
        test: "Does “serious” feel aspirational, earned, and alive?",
      },
      {
        dimension: "Audience breadth",
        test:
          "Does the copy respect experienced engineers and leave a credible route for new builders?",
      },
      {
        dimension: "Action",
        test: "Does the CTA describe a real destination or commitment?",
      },
    ],
  },
  {
    id: "product",
    title: "Product-copy scorecard",
    rows: [
      {
        dimension: "State",
        test: "Is the current condition stated clearly?",
      },
      {
        dimension: "Object",
        test:
          "Is the branch, tree, worktree, Proof, Standard, path, or command named?",
      },
      {
        dimension: "Action",
        test: "Is the next valid move explicit?",
      },
      {
        dimension: "Reason",
        test: "Is the restriction or recovery reason included where useful?",
      },
      {
        dimension: "Canonical language",
        test: "Are product terms exact and consistent?",
      },
      {
        dimension: "Evidence scope",
        test: "Does certainty match the available evidence?",
      },
      {
        dimension: "Authority",
        test: "Are consent and landing boundaries explicit?",
      },
      {
        dimension: "Agent neutrality",
        test:
          "Does the copy describe work and conditions without judging the agent?",
      },
      {
        dimension: "Stress usability",
        test: "Can a reader act correctly while hurried or frustrated?",
      },
      {
        dimension: "Surface parity",
        test: "Can human and machine renderings preserve the same meaning?",
      },
    ],
    closing:
      "Any 0 in state, action, canonical language, evidence scope, or authority blocks release.",
  },
  {
    id: "agent",
    title: "Agent-copy scorecard",
    rows: [
      {
        dimension: "Self-contained",
        test: "Can the agent act without hidden context from another message?",
      },
      {
        dimension: "Working root",
        test: "Are path and worktree assumptions explicit?",
      },
      {
        dimension: "Authority",
        test: "Is dispatch, install, write, and landing permission clear?",
      },
      {
        dimension: "Context economy",
        test: "Is the immediate action visible without unbounded background?",
      },
      {
        dimension: "Callable path",
        test:
          "Does the copy direct the agent to a self-checking verb where appropriate?",
      },
      {
        dimension: "Recovery",
        test: "Does a refusal or failure route to the next valid action?",
      },
      {
        dimension: "Completion",
        test: "Is the stop condition falsifiable?",
      },
      {
        dimension: "Human outcome",
        test: "Does the brief include the user's semantic success condition?",
      },
      {
        dimension: "Relay",
        test: "Does the agent know what to report and when to stop?",
      },
      {
        dimension: "Summarization resilience",
        test: "Would critical instructions survive context compression?",
      },
    ],
    closing:
      "Any 0 in authority, working root, completion, or relay blocks release.",
  },
] as const satisfies readonly Scorecard[];

/** One proposed mechanical check, exactly as the document lists it. The id
 * is the handle the generated Vale styles cite; the text is signed-off
 * content and renders verbatim. */
export interface ProposedCheck {
  readonly id: string;
  readonly text: string;
}

/**
 * The document's "Proposed mechanical checks" — candidates for Vale, tests,
 * or registries, per register. `scripts/brand/vale.ts` implements the
 * practical subset as generated styles and records a disposition for every
 * other id; `tests/brand_vale_codegen_test.ts` holds that partition exact,
 * so a proposal added here fails the gate until it is implemented or its
 * deferral is recorded.
 */
export const PROPOSED_MECHANICAL_CHECKS = {
  brand: [
    {
      id: "hero-noun-density",
      text: "warn when a hero contains more than two canonical product nouns;",
    },
    {
      id: "repeated-contrast",
      text: "warn on repeated `X, not Y` syntax within one page;",
    },
    {
      id: "generic-verbs",
      text:
        "warn on generic verbs: `unlock`, `empower`, `transform`, `reimagine`;",
    },
    {
      id: "unsupported-adjectives",
      text:
        "warn on unsupported adjectives: `seamless`, `robust`, `powerful`, `enterprise-grade`;",
    },
    {
      id: "cta-generic-label",
      text: "warn when a CTA is only “Learn more,” “Explore,” or “Discover”;",
    },
    {
      id: "claim-annotation",
      text:
        "require a claim annotation in source for designated claim-bearing blocks;",
    },
    {
      id: "serious-near-threat",
      text:
        "warn when “serious” occurs near threat vocabulary without an approved context;",
    },
    {
      id: "headline-duplication",
      text: "check headline duplication across pages;",
    },
    {
      id: "audience-signature-frequency",
      text: "check audience signature frequency.",
    },
  ],
  product: [
    {
      id: "canonical-glossary-terms",
      text: "canonical glossary term enforcement;",
    },
    { id: "retired-synonyms", text: "retired synonym enforcement;" },
    {
      id: "command-flag-references",
      text: "command and flag references from typed registries;",
    },
    {
      id: "path-identifier-formatting",
      text: "path and identifier formatting;",
    },
    { id: "agent-blame", text: "prohibited agent-blame vocabulary;" },
    {
      id: "refusal-next-action",
      text: "required next-action field for refusal families;",
    },
    {
      id: "consent-language",
      text: "consent-language templates for authority-critical operations.",
    },
  ],
  agent: [
    {
      id: "skill-stop-condition",
      text: "required stop condition in Skills and setup steps;",
    },
    {
      id: "authority-field",
      text:
        "required authority field for dispatch, install, and landing procedures;",
    },
    {
      id: "relative-cross-worktree-paths",
      text: "warning on relative cross-worktree paths;",
    },
    {
      id: "vague-pronouns",
      text: "warning on vague pronouns in operational guidance;",
    },
    {
      id: "context-length-budgets",
      text: "context-length budgets by surface;",
    },
    {
      id: "stable-target-validation",
      text: "stable target validation;",
    },
    {
      id: "relay-message-completeness",
      text: "relay-message completeness tests.",
    },
  ],
} as const satisfies Record<Register, readonly ProposedCheck[]>;

/** The brand scorecard's scoring rubric. */
const SCORE_RUBRIC: readonly string[] = [
  "**0:** absent, misleading, or actively weak;",
  "**1:** present but generic, incomplete, or uneven;",
  "**2:** clear, specific, and persuasive.",
];

/** The brand scorecard's interpretation bands. */
const INTERPRETATION_BANDS: readonly string[] = [
  "**24–28:** strong candidate; proceed to final claim and craft review.",
  "**18–23:** promising but one or more strategic elements need revision.",
  "**Below 18:** rebuild the argument before revising the wording.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render a scorecard's dimension table. */
function scorecardTable(scorecard: Scorecard): string {
  return [
    "| Dimension | Test |",
    "| --- | --- |",
    ...scorecard.rows.map((row) => `| **${row.dimension}** | ${row.test} |`),
  ].join("\n");
}

/** Look a scorecard up by id, or throw — ids are a closed set. */
function scorecardById(id: (typeof SCORECARDS)[number]["id"]): Scorecard {
  const scorecard = SCORECARDS.find((candidate) => candidate.id === id);
  if (scorecard === undefined) {
    throw new Error(`no scorecard is registered as ${id}`);
  }
  return scorecard;
}

/** Render one of the closing-ruled scorecards (product, agent). */
function renderRuledScorecard(id: "product" | "agent"): string {
  const scorecard = scorecardById(id);
  if (scorecard.closing === undefined) {
    throw new Error(`${id} declares no block-release rule`);
  }
  return [
    `## ${scorecard.title}`,
    "",
    scorecardTable(scorecard),
    "",
    scorecard.closing,
  ].join("\n");
}

/** The whole copy-review document, ready for the barrel to stamp. */
export function renderCopyReviewDoc(): string {
  const brand = scorecardById("brand");
  return [
    "# Copy review",
    "",
    "**Status:** Governance\\",
    "**Purpose:** Provide a repeatable acceptance gate for brand, product, and agent-facing copy.",
    "",
    "## Before reviewing",
    "",
    "Record:",
    "",
    `\`\`\`text
Draft:
Register:
Surface:
Primary reader:
Desired changed belief or action:
Message territory:
Claims:
Reviewer:
Date:
\`\`\``,
    "",
    "A draft that cannot supply these fields is not ready for line editing.",
    "",
    "## Review order",
    "",
    "Review in this sequence:",
    "",
    "1. strategy;",
    "2. audience;",
    "3. clarity and desire;",
    "4. register fit;",
    "5. claim truth;",
    "6. structure;",
    "7. voice and craft;",
    "8. CTA;",
    "9. mechanical checks.",
    "",
    "Do not polish a sentence before deciding whether the page is making the right argument.",
    "",
    "## Automatic failures",
    "",
    "A draft fails immediately when it:",
    "",
    bullets(AUTOMATIC_FAILURES),
    "",
    `## ${brand.title}`,
    "",
    "Score each dimension 0–2:",
    "",
    bullets(SCORE_RUBRIC),
    "",
    scorecardTable(brand),
    "",
    "### Interpretation",
    "",
    bullets(INTERPRETATION_BANDS),
    "",
    "A score of 0 in human desire, category clarity, credibility, or register fit is an automatic rewrite regardless of total.",
    "",
    renderRuledScorecard("product"),
    "",
    renderRuledScorecard("agent"),
    "",
    "## Ontology-capture test",
    "",
    "For brand copy:",
    "",
    "1. Remove the words Gate, Standard, Proof, Map, Desk, Worktree, Fleet, deterministic, owner, and canon.",
    "2. Read the draft again.",
    "3. Ask whether the human proposition still stands.",
    "4. Check whether the page order follows a buyer's questions or the feature canon.",
    "5. Check whether the hero contains more than one unexplained product noun.",
    "",
    "If the message disappears, rebuild it from the human situation and use the product concepts later as evidence.",
    "",
    "## Five-second test",
    "",
    "Show the page briefly to someone unfamiliar with discern. Ask:",
    "",
    "1. What is this?",
    "2. Who is it for?",
    "3. What could it help them do?",
    "4. What seems different?",
    "5. What would you click?",
    "",
    "The answer does not need to be technically complete. It must be directionally correct.",
    "",
    "## Audience tests",
    "",
    "### Experienced engineer",
    "",
    bullets([
      "Does the copy respect their familiarity with Git, CI, testing, review, and architecture?",
      "Does it explain why the connected practice is valuable even when the components are familiar?",
      "Does it promise greater reach without implying deskilling?",
      "Does it avoid raw output worship?",
    ]),
    "",
    "### New consequential builder",
    "",
    bullets([
      "Does the copy recognize what they have already achieved?",
      "Does it explain commissioning without expecting manual configuration knowledge?",
      "Does it preserve their authority without turning them into a technical approver?",
      "Does it avoid promising security or guaranteed quality?",
      "Does it make the software being taken seriously feel attainable?",
    ]),
    "",
    "### Agent",
    "",
    bullets([
      "Can the agent form an accurate product model?",
      "Does the operational copy state tools, roots, authority, and stop conditions?",
      "Does public agent copy remain technically useful beneath the wit?",
    ]),
    "",
    "## Seriousness test",
    "",
    "Ask:",
    "",
    bullets([
      "Does the copy make serious software sound desirable?",
      "Does the copy invite the reader into a standard they want to reach?",
      "Is the benefit framed through confidence, pride, growth, or capability?",
      "Has the copy used fear of bugs, job loss, customers, or incidents as its main engine?",
      "Does the tone leave room for pleasure, creativity, and ambition?",
    ]),
    "",
    "Replace punitive seriousness with earned confidence.",
    "",
    "## Distinctiveness test",
    "",
    "Temporarily replace “discern” with the name of a generic AI coding tool.",
    "",
    "If the copy still fits, identify what is missing:",
    "",
    bullets([
      "installed practice;",
      "project-owned continuity;",
      "agent ergonomics;",
      "exact-change evidence;",
      "Standards retaining gains;",
      "human acceptance authority;",
      "new builders and serious software;",
      "provider independence;",
      "local deterministic foundation.",
    ]),
    "",
    "Add only the differentiator relevant to the section.",
    "",
    "## Contemporary model-copy smell check",
    "",
    "Apply the applicable voice Skill's banned-move check first. Then flag these patterns and inspect the page for repetition:",
    "",
    bullets([
      "`X, not Y` constructions;",
      "`This isn't just…`;",
      "`In a world where…`;",
      "`The future of…`;",
      "three-part abstract noun sequences;",
      "fragments in every heading and paragraph;",
      "over-neat mirrored sentences;",
      "repeated commands beginning with `Unlock`, `Empower`, `Transform`, `Reimagine`;",
      "solemn manifesto tone on routine pages;",
      "alliteration used more than once in a small section;",
      "several slogans stacked together;",
      "explanatory em dashes in nearly every sentence;",
      "generic superlatives;",
      "anthropomorphic claims about the project “thinking,” “knowing,” or “learning” without a literal mechanism.",
    ]),
    "",
    "A banned move fails on first use. Elsewhere, judge patterns across the draft; one well-chosen device can still earn its place.",
    "",
    "## Line-editing pass",
    "",
    "After strategy passes:",
    "",
    "1. Remove throat-clearing.",
    "2. Make the main clause arrive earlier.",
    "3. Replace generic adjectives with a mechanism or consequence.",
    "4. Replace abstract nouns with actions and objects.",
    "5. Cut repetition between heading and body.",
    "6. Check pronoun references.",
    "7. Vary sentence length.",
    "8. Read aloud.",
    "9. Test the line in the visual layout.",
    "10. Confirm the CTA destination.",
    "",
    "## Claim review",
    "",
    "For every consequential claim:",
    "",
    `\`\`\`text
Claim:
Public wording:
Evidence class:
Mechanism/source:
Conditions:
Forbidden inference:
Nearby boundary needed? yes/no
\`\`\``,
    "",
    "If the ledger records no such claim, add one before publishing. Do not improvise a boundary in the page.",
    "",
    "## Surface-specific review",
    "",
    "### Homepage",
    "",
    bullets([
      "One dominant promise in the hero.",
      "Category clear within the hero or immediately after.",
      "First proof is a recognisable demonstration.",
      "Feature taxonomy does not control the sequence.",
      "Engineer and new-builder routes are visible.",
      "Trust boundary appears before the final CTA.",
    ]),
    "",
    "### Campaign landing page",
    "",
    bullets([
      "One audience moment.",
      "One claim or transformation.",
      "One primary CTA.",
      "No attempt to explain the entire product.",
    ]),
    "",
    "### Founder essay",
    "",
    bullets([
      "Begins with a scene or discovery.",
      "Preserves uncertainty and mental-model change.",
      "Product enters after the human problem is felt.",
      "Internal evidence is attributed.",
      "Ends with an invitation and leaves room for the reader's choice.",
    ]),
    "",
    "### Product page",
    "",
    bullets([
      "Human consequence leads each section.",
      "Canonical nouns appear after first-use definitions.",
      "Mechanism and trade-off are clear.",
      "Links to technical depth and keeps full detail in its owning reference.",
    ]),
    "",
    "### Trust page",
    "",
    bullets([
      "No euphemism.",
      "What discern does and does not do are equally legible.",
      "Local does not imply network-free project work.",
      "Deterministic does not imply universal correctness.",
      "Security boundary is explicit.",
    ]),
    "",
    "### For Agents page",
    "",
    bullets([
      "Works as an accurate agent orientation.",
      "Works as an enjoyable human read.",
      "Humor targets poorly designed interfaces and respects agent intelligence.",
      "Exact machine routes are present.",
    ]),
    "",
    "## Proposed mechanical checks",
    "",
    "These are candidates for Vale, tests, or registries after the rules are accepted.",
    "",
    ...REGISTERS.flatMap((register) => [
      `### ${register.charAt(0).toUpperCase()}${register.slice(1)} register`,
      "",
      bullets(
        PROPOSED_MECHANICAL_CHECKS[register].map((check) => check.text),
      ),
      "",
    ]),
    "## Final acceptance record",
    "",
    "Use this block in review PRs or internal notes:",
    "",
    `\`\`\`markdown
## Copy acceptance

- Register:${" "}
- Surface:${" "}
- Audience:${" "}
- Message territory:${" "}
- Claims:${" "}
- Score:${" "}
- Automatic failures: none | <list>
- Ontology-capture test: pass | fail
- Seriousness test: pass | fail
- Model-copy review: pass | fail
- CTA verified: yes | no
- Approved by:${" "}
- Date:${" "}
\`\`\``,
  ].join("\n");
}
