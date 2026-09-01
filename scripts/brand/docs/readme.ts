/**
 * The brand README as a registry-rendered module: the document map derives
 * from `BRAND_DOCUMENTS` (the barrel passes the live rows in, so this module
 * never imports the barrel), and the reading paths, precedence order,
 * working summary, and outstanding-work table live as typed data — a row
 * leaves the outstanding-work table by leaving the data. The narrative stays
 * authored Markdown. `README.md` compiles from this module.
 */

import { brandDocHrefFromGenerated, type BrandDocument } from "../model.ts";
import { BRAND_FOUNDATION_READING_STEPS, voiceSkillRel } from "../voice.ts";

/** One task-scoped reading path. */
export interface ReadingPath {
  readonly id: string;
  readonly heading: string;
  readonly intro: string;
  readonly steps: readonly string[];
  readonly note?: string;
}

/** One level of the precedence order. */
export interface PrecedenceLevel {
  readonly name: string;
  readonly detail: string;
}

/** One line of the working summary. */
export interface SummaryLine {
  readonly label: string;
  readonly value: string;
}

/** One row of the outstanding-work table. */
export interface OutstandingItem {
  readonly id: string;
  readonly task: string;
  readonly summary: string;
}

/** The task-scoped reading paths, in rendering order. */
export const READING_PATHS = [
  {
    id: "homepage-or-campaign",
    heading: "Homepage or campaign copy",
    intro: "Read, in order:",
    steps: [
      ...BRAND_FOUNDATION_READING_STEPS.map((step) => step.instruction),
      "the `discern-brand-voice` skill",
      "the relevant section of `website-brief.md`",
      "only the relevant claims from `claims-and-evidence.md`",
    ],
    note:
      "Do **not** load the complete product canon as a style model. Consult product sources only to verify a claim or mechanism.",
  },
  {
    id: "manifesto-founder-visual",
    heading: "Manifesto, founder philosophy, or extended visual work",
    intro: "Read, in order:",
    steps: [
      "`positioning.md`;",
      "`visual-identity.md`;",
      "`launch-narrative.md`;",
      "the `discern-brand-voice` skill;",
      "the relevant surface brief and only the claims the work introduces.",
    ],
    note:
      "Treat the metaphysical reading as founder-authentic territory. Do not assign it to the audience. Reserve the Sierpiński triangle for the uses governed by `visual-identity.md`.",
  },
  {
    id: "product-documentation-cli",
    heading: "Product, documentation, or CLI copy",
    intro: "Read:",
    steps: [
      "the product glossary and relevant product documentation;",
      "the `discern-product-voice` skill;",
      "`claims-and-evidence.md` when a public-facing promise is involved;",
      "`register-bridge.md` only when a product concept must be introduced to a new audience.",
    ],
  },
  {
    id: "agent-operational",
    heading: "Agent-operational copy",
    intro: "Read:",
    steps: [
      "the relevant product contract or workflow;",
      "the `discern-agent-voice` skill in **operational mode**;",
      "the canonical glossary;",
      "relevant consent, authority, and stop-condition documentation.",
    ],
  },
  {
    id: "for-agents-page",
    heading: "For Agents page or `llms.txt`",
    intro: "Read:",
    steps: [
      "`for-agents-brief.md`;",
      "the `discern-agent-voice` skill in the appropriate mode;",
      "`positioning.md` and `messaging.md` for brand alignment;",
      "the exact product contracts needed to support the claims.",
    ],
  },
  {
    id: "claim-review",
    heading: "Claim review",
    intro: "Read:",
    steps: [
      "`claims-and-evidence.md`;",
      "the relevant record in `boundary-canon.md`;",
      "the named source of product truth;",
      "the line tests in `messaging.md`.",
    ],
  },
] as const satisfies readonly ReadingPath[];

/** The precedence order applied when instructions conflict. */
export const PRECEDENCE = [
  {
    name: "Product truth and safety boundaries",
    detail:
      "canonical registries, live behavior, source code, generated canon, setup contract, and documentation.",
  },
  {
    name: "Claims and evidence",
    detail: "the strongest public wording currently supported.",
  },
  {
    name: "Positioning",
    detail: "the strategic meaning discern has chosen to own.",
  },
  {
    name: "Audience definition",
    detail: "the reader and circumstance the surface serves.",
  },
  {
    name: "Messaging architecture",
    detail: "the role each message must play.",
  },
  {
    name: "Surface brief",
    detail: "the job of the page, campaign, product screen, or agent surface.",
  },
  {
    name: "Applicable voice skill",
    detail: "how the message should sound.",
  },
  {
    name: "Examples",
    detail: "inspiration only; never a source of truth.",
  },
] as const satisfies readonly PrecedenceLevel[];

/** The working summary, one line per anchor. */
export const WORKING_SUMMARY = [
  {
    label: "Worldview",
    value: "software earns seriousness through how it is built.",
  },
  { label: "Audience", value: "people who take their software seriously." },
  { label: "Energy", value: "a bolder way to build; build further." },
  {
    label: "Human outcome",
    value: "ambitious software that holds up and earns confidence.",
  },
  {
    label: "Category",
    value:
      "an engineering practice for agent-built software, installed into the project.",
  },
  {
    label: "Relationship",
    value: "human judgment, agent capability, and project continuity.",
  },
  {
    label: "Conversion benefits",
    value:
      "greater personal reach, meaningful delegation, preserved standards, reduced review burden, and clearer evidence.",
  },
  { label: "Technical distinction", value: "agent ergonomics." },
  { label: "Authority", value: "the human decides what becomes shared." },
  {
    label: "Brand voice",
    value: "editorial confidence with creative momentum.",
  },
  { label: "Product voice", value: "composed exactness." },
  { label: "Agent voice", value: "operational intelligence." },
] as const satisfies readonly SummaryLine[];

/**
 * The outstanding-work table. Rows leave as they complete; the brand
 * refresh is done when this set is empty and its section is removed.
 */
export const OUTSTANDING_WORK = [
  {
    id: "root-readme-rewrite",
    task: "Root README rewrite",
    summary:
      "Rewrite the complete root-level README.md file based on the new branding and messaging rules.",
  },
  {
    id: "public-docs-review",
    task: "Public docs review",
    summary:
      "Review the verbiage of map entries published to the public `/docs` pages and make any pre-launch edits.",
  },
  {
    id: "dogfooding-snapshot",
    task: "Dogfooding snapshot",
    summary:
      "Revisit the dated internal evidence snapshot in `claims-and-evidence.md` so it is accurate and fully up to date.",
  },
  {
    id: "llms-txt-rewrite",
    task: "`llms.txt` rewrite",
    summary:
      "Rewrite the public site's `llms.txt` (per `for-agents-brief.md`) before it goes live.",
  },
  {
    id: "homepage-brief",
    task: "Homepage brief",
    summary:
      "Update or remove the old `8a` first-principles homepage-rewrite brief (owner to take a view).",
  },
  {
    id: "publish-the-adr",
    task: "Publish the ADR",
    summary:
      "Number the WIP ADR in `decisions.md` and publish it permanently into `project/map/_adr/` at the end of the effort. Add a second ADR to record the brand documents' registry ownership.",
  },
  {
    id: "glossary-and-proof-migration",
    task: "Glossary and Proof migration",
    summary:
      "Keep the canonical glossary definitions and Proof terminology aligned across the product.",
  },
  {
    id: "registry-canonicalisation",
    task: "Brand registry conversion",
    summary:
      "Model the brand system as typed registry data under `scripts/brand/` and generate these documents from it. Start with a byte-faithful conversion, with each document's sign-off gating its conversion.",
  },
  {
    id: "site-prose-standards",
    task: "Site prose standards",
    summary:
      "Once the launch site copy lands: add a scope for the public site's pages, bring their prose under the Vale guards, and pin new `[standards]` limits at launch-day values so the copy only improves.",
  },
] as const satisfies readonly OutstandingItem[];

/** The marker an overlay document's “Stays private?” cell carries. */
export const PRIVATE_OVERLAY_MARKER = "private overlay (local)";

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render one document-map row. A skill row displays its repo-relative
 * path while its link still traverses from this README's directory; an
 * authored row's link crosses into the `_private` overlay tree. */
function documentRow(doc: BrandDocument): string {
  const overlay = doc.mode.kind === "authored" && doc.mode.privateOverlay;
  const display = doc.mode.kind === "skill"
    ? voiceSkillRel(doc.mode.register)
    : doc.file;
  return `| [\`${display}\`](${
    brandDocHrefFromGenerated(doc)
  }) | ${doc.status} | ${doc.job} | ${overlay ? PRIVATE_OVERLAY_MARKER : ""} |`;
}

/** Render one reading path's section. */
function renderReadingPath(path: ReadingPath): string {
  const parts = [
    `### ${path.heading}`,
    "",
    path.intro,
    "",
    ...path.steps.map((step, index) => `${index + 1}. ${step}`),
  ];
  if (path.note !== undefined) {
    parts.push("", path.note);
  }
  return parts.join("\n");
}

/**
 * The whole brand README, ready for the barrel to stamp. The barrel passes
 * the live document rows in; this module renders every row except the
 * README's own.
 */
export function renderReadmeDoc(
  documents: readonly BrandDocument[],
): string {
  const mapped = documents.filter((doc) => doc.id !== "readme");
  return [
    "# discern brand operating system",
    "",
    "> Repository-ready instructions for positioning, messaging, public copy, product copy, and agent-facing communication.",
    "",
    "**Status:** Canonical working system",
    "",
    "## Purpose",
    "",
    "This directory keeps discern's public strategy coherent while preserving clear boundaries among its communication jobs:",
    "",
    "1. **Brand communication** helps a person decide whether discern belongs in the future they want to build.",
    "2. **Product communication** helps a person understand state, meaning, authority, and the next correct action.",
    "3. **Agent communication** helps an intelligent machine operate discern accurately, economically, and independently.",
    "",
    "Every register draws from the same product truth and keeps a surface voice suited to its reader.",
    "",
    "The system exists to prevent recurring failures:",
    "",
    bullets([
      "public copy collapsing into a polished technical manual;",
      "attractive marketing drifting beyond what the product can defend.",
    ]),
    "",
    "## The strategic center",
    "",
    "The current brand platform is internally named **Consequential Code**.",
    "",
    "The shared audience identity is:",
    "",
    "> **For people who take their software seriously.**",
    "",
    "The line speaks to each primary audience:",
    "",
    bullets([
      "experienced engineers recognize the care and standards they already bring;",
      "new builders recognize the desire for their software to earn confidence from everyone else.",
    ]),
    "",
    "The public brand should make that seriousness feel like an earned privilege: more ambition, greater reach, more confidence, and more pride. It should never make seriousness feel joyless, corporate, punitive, or fear-driven.",
    "",
    "## Document map",
    "",
    "| Document | Status | Job | Stays private? |",
    "| --- | --- | --- | --- |",
    ...mapped.map(documentRow),
    "",
    `**Stays private?** marks a document that stays authored under \`_private\`, outside the brand registry, and is wiped before the repository goes public. It remains locally as a private overlay, where the document-map links resolve. Unmarked documents are registry-owned: their source of truth is in \`scripts/brand/\`, and their generated pages live here under \`_internal/brand/\`. The anecdote ledger, claims requiring future validation, and the dated internal evidence snapshot carved out of \`claims-and-evidence.md\` live in \`claims-residue.md\`.`,
    "",
    "## Read only what the task needs",
    "",
    "The brand operating system should keep task context small and relevant.",
    "",
    READING_PATHS.map(renderReadingPath).join("\n\n"),
    "",
    "## Precedence",
    "",
    "When instructions conflict, apply this order:",
    "",
    ...PRECEDENCE.map(
      (level, index) => `${index + 1}. **${level.name}:** ${level.detail}`,
    ),
    "",
    "A memorable example never overrides the strategy or claim boundary that produced it.",
    "",
    "## Source-of-truth boundaries",
    "",
    "### The product name",
    "",
    "The name is always written **discern**: entirely lowercase, in every register and every position, including at the start of a sentence or headline. Recast any line that would capitalize the name. Display styling is a design-system decision; the spelling never changes.",
    "",
    "### Product vocabulary",
    "",
    "The product glossary remains canonical for product terms. Brand copy may introduce a term in plain language before naming it, but must not redefine it or casually invent a synonym that changes its meaning.",
    "",
    "### Brand vocabulary",
    "",
    "This directory governs the interpretation and public presentation of the product. It may use broader human language that does not belong in the product glossary: ambition, confidence, pride, seriousness, momentum, expanded capability, and being taken seriously.",
    "",
    "### Creative lines",
    "",
    "Lines in `messaging.md` are approved territories and candidate expressions. Choose the line that serves the page. Avoid forcing one headline across every surface.",
    "",
    "### Evidence",
    "",
    "Internal dogfooding, anecdotes, and product mechanisms carry different evidential weight. The claims ledger marks the difference. Do not convert internal observations into universal customer outcomes.",
    "",
    "## Register declaration",
    "",
    "Before drafting, state the register explicitly:",
    "",
    `\`\`\`text
Register: brand | product | agent-operational | agent-public
Surface: <page, command, hint, guide, campaign, etc.>
Reader: <audience circumstance>
Desired change: <what the reader should understand, feel, or do>
Claims used: <claim slugs>
\`\`\``,
    "",
    "A draft without these fields is likely to inherit the language of whichever source file was read most recently.",
    "",
    "## Updating the system",
    "",
    "1. Record a material strategic choice in `decisions.md`.",
    "2. Update the canonical document that owns the choice.",
    "3. Update dependent examples only after the source is stable.",
    "4. Add or revise claims in the ledger when the product or evidence changes.",
    "5. Run the line tests in `messaging.md` against the changed lines.",
    "6. Regenerate or enforce mechanical rules only after the prose rule is understood.",
    "",
    "Recommended candidates for later registry-backed generation:",
    "",
    bullets([
      "approved first-use definitions;",
      "claim slugs, evidence classes, and forbidden inferences;",
      "message slugs and audience applicability;",
      "prohibited or retired public phrasings;",
      "register-specific Vale rules;",
      "link and enrollment checks across this directory.",
    ]),
    "",
    "## Working summary",
    "",
    bullets(
      WORKING_SUMMARY.map((line) => `**${line.label}:** ${line.value}`),
    ),
    "",
    "## Outstanding work",
    "",
    "The running list for the brand refresh. Rows leave the table as they complete; the refresh is done when the table is empty and this section is removed.",
    "",
    "| Task | Summary |",
    "| --- | --- |",
    ...OUTSTANDING_WORK.map((item) => `| ${item.task} | ${item.summary} |`),
  ].join("\n");
}
