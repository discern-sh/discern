/**
 * The messaging architecture as typed registry data: message territories,
 * pillars, approved descriptions, hero systems, the headline inventory, the
 * CTA system, the proof order, and the public-copy guardrails.
 * `messaging.md` compiles from this module; every pillar cites the claims
 * ledger by slug, so a message without a defensible reason to believe
 * cannot compile.
 */

import type {
  CtaBank,
  Description,
  Headline,
  HeroSystem,
  Pillar,
  Territory,
} from "./model.ts";
import type { ClaimSlug } from "./claims.ts";

/** The canonical message hierarchy, in rendering order. */
export const TERRITORIES = [
  {
    id: "brand-worldview",
    title: "Brand worldview",
    body: `**Consequential Code**

Internal platform name. The public meaning is that software earns confidence through the way it is built.`,
  },
  {
    id: "audience-signature",
    title: "Audience signature",
    body: `> **For people who take their software seriously.**

Use sparingly. It works best as a signature, eyebrow, manifesto line, social bio, or campaign closer. Its force depends on the unspoken second reading: the builder wants the software to be taken seriously by others.`,
  },
  {
    id: "lead-creative",
    title: "Lead creative territory",
    body: `Approved candidates:

> **A bolder way to build.**

Best when the page should feel ambitious, audacious, and founder-led. “Bolder” describes the builder's reach. It does not describe the codebase's size.

> **Build further.**

Best when restraint, elegance, and flexibility matter. It can mean further into an idea, beyond one person's capacity, or toward software people can depend on.

> **A bigger way to build.**

Retained as a contextual candidate because of its cadence and impact. Use it where nearby copy makes clear that “bigger” means capability and ambition.

Avoid defaulting to **A better way to build**. It is broadly true but insufficiently distinctive unless a specific comparison gives “better” content.`,
  },
  {
    id: "durable-outcome",
    title: "Durable outcome territory",
    body: `> **Software that holds up.**

A flexible expression covering ongoing change, scrutiny, real users, coherence, and maintainability.

> **Ship serious software.**

Compact, active, and campaign-ready. Effective for closing CTAs, guides, video titles, and product sections.

> **Software worth putting your name to.**

Personal and premium. Best where pride, authorship, and reputation are already present.

> **Build software you are proud to stand behind.**

Warmer and more explicit. Useful in founder, customer, and new-builder narratives.`,
  },
  {
    id: "category",
    title: "Category",
    body: `> **An engineering practice for agent-built software.**

> **discern installs that practice into the project.**

Alternative contextual forms:

- An agent-native engineering practice.
- A serious engineering practice, installed in your project.
- A working practice for coding agents and the people responsible for what ships.

The category line should orient. Let the emotional headline do a different job.`,
  },
  {
    id: "primary-conversion",
    title: "Primary conversion territory",
    body: `> **Spend your attention where your judgment matters most.**

This works across audiences:

- the engineer moves away from routine implementation inspection;
- the new builder receives a meaningful basis for decisions without pretending to become a code reviewer.

Supporting expressions:

- Let substantial work move without staying inside every detail.
- Come back to work that is ready for a decision.
- Give the agent the work; keep your attention for direction and consequence.
- Hand over the complete unit of work. This is strongest on engineer-focused conversion pages and needs careful translation for new builders.`,
  },
  {
    id: "technical-distinction",
    title: "Technical distinction",
    body: `> **Agent ergonomics**

Supporting expressions:

- Software designed around the way coding agents work.
- A familiar project for every agent.
- The project keeps its way of working when the provider changes.
- Context treated as a budget.

This territory leads the For Agents page and technical thought leadership.`,
  },
] as const satisfies readonly Territory[];

export type TerritoryId = (typeof TERRITORIES)[number]["id"];

/** The message pillars; each cites the claims that make it defensible. */
export const PILLARS = [
  {
    id: "ambition-and-personal-leverage",
    title: "Ambition and personal reach",
    humanTruth:
      "Coding agents let one person attempt work that used to require more people, time, or specialist access.",
    promise: "discern helps that capability become usable at greater scope.",
    goodExpressions: [
      "A bolder way to build.",
      "Build further.",
      "Take the project further than one pair of hands.",
      "Turn a backlog into organized progress.",
      "Let your judgment influence more of the work.",
    ],
    avoid: [
      "raw line-count claims;",
      "10× or 100× promises;",
      "equating more code with more value;",
      "hustle or factory imagery.",
    ],
    claims: ["shaped-delegation", "reduced-review-burden", "runs-on-itself"],
  },
  {
    id: "earns-confidence",
    title: "Software that earns confidence",
    humanTruth:
      "A project becomes meaningful when other people are asked to rely on it.",
    promise:
      "the way the software is built can support continued confidence as it changes.",
    goodExpressions: [
      "Software that holds up.",
      "Ship serious software.",
      "Software worth putting your name to.",
      "When people start depending on it, the way you build it matters.",
      "The prototype can become a product.",
    ],
    avoid: [
      "`enterprise-grade` without a specific meaning;",
      "fear about bugs, firing, or reputational ruin;",
      "universal reliability or security guarantees.",
    ],
    claims: [
      "standards-cannot-loosen",
      "pin-measured-gains",
      "proof-exact-tree",
    ],
  },
  {
    id: "practice-retained",
    title: "A practice the project retains",
    humanTruth:
      "Repeated prompts and personal memory are weak places to store a project's standards.",
    promise: "discern gives future agents a persistent way of working.",
    goodExpressions: [
      "An engineering practice, installed in the project.",
      "Every agent starts with the project already in view.",
      "Change agents without starting the project over.",
      "The project retains the decisions, methods, and standards that matter.",
    ],
    avoid: [
      "leading with canonical product nouns before the reader wants the outcome;",
      "implying autonomous learning or a model inside discern;",
      "making “practice” sound like compliance overhead.",
    ],
    claims: [
      "installs-a-practice",
      "one-guidance-source",
      "switch-without-reteaching",
    ],
  },
  {
    id: "meaningful-delegation",
    title: "Meaningful delegation",
    humanTruth:
      "Many agent workflows still leave the human responsible for shaping, coordinating, checking, and relaying nearly everything around the code.",
    promise:
      "more of the complete unit of work can move without continuous human administration.",
    goodExpressions: [
      "Spend your attention where your judgment matters most.",
      "Give the work a complete handoff.",
      "Several pieces can move at once without making you their courier.",
      "Come back to work that is ready for a real decision.",
    ],
    avoid: [
      "fully autonomous factory claims;",
      "implying that human review never matters;",
      "treating delegation itself as unique when vendor coding-agent CLIs increasingly offer fleets.",
    ],
    claims: [
      "shaped-delegation",
      "isolated-worktrees",
      "no-checkout-collisions",
      "reduced-review-burden",
    ],
  },
  {
    id: "exact-reasons-to-believe",
    title: "Exact reasons to believe",
    humanTruth:
      "Confidence needs observable conditions that stand apart from the agent's tone.",
    promise:
      "discern can show what was evaluated and which change the evidence belongs to.",
    goodExpressions: [
      "Evidence for the exact change.",
      "A measurable gain can become the new floor.",
      "The project declares what must pass.",
      "The final decision remains yours.",
    ],
    note:
      "Use the product names **Gate**, **Standard**, and **Proof** after they have been introduced in plain language.",
    avoid: [
      "suggesting formal proof of universal correctness;",
      "suggesting a passing Gate is sufficient for security or business suitability;",
      "turning the page into a catalog of checks.",
    ],
    claims: [
      "proof-exact-tree",
      "standards-cannot-loosen",
      "pin-measured-gains",
      "gate-grants-no-authority",
    ],
  },
  {
    id: "provider-continuity",
    title: "Provider continuity",
    humanTruth:
      "people move between coding-agent providers because of preference, task fit, availability, subscription limits, and changing model quality.",
    promise:
      "the project retains its practice while the active intelligence changes.",
    goodExpressions: [
      "Keep the project consistent when you change agents.",
      "Switch providers without re-teaching the work.",
      "One project understanding across the agents you use.",
      "Keep moving when one provider reaches its quota.",
    ],
    note:
      "The quota message is timely and practical. It should not become the enduring master promise because provider pricing and limits will change.",
    claims: ["switch-without-reteaching", "one-guidance-source"],
  },
  {
    id: "agent-ergonomics",
    title: "Agent ergonomics",
    humanTruth:
      "most software still asks an agent to operate interfaces designed for humans and to reconstruct state through expensive context.",
    promise:
      "discern gives the agent structured, bounded, recoverable ways to work.",
    goodExpressions: [
      "Agent ergonomics for software development.",
      "Software designed for the machine doing the work.",
      "Clear state, bounded context, useful refusals.",
      "A project that feels familiar to every supported agent.",
    ],
    avoid: [
      "presenting an agent as a victim or comic incompetent;",
      "technical admiration without a human consequence;",
      "claiming artificial intelligence inside discern.",
    ],
    claims: ["agent-as-operator", "no-model-inside", "isolated-worktrees"],
  },
] as const satisfies readonly Pillar<ClaimSlug>[];

export type PillarId = (typeof PILLARS)[number]["id"];

/** Approved descriptions: the by-length ladder, then the audience variants. */
export const DESCRIPTIONS = [
  {
    id: "five-words",
    group: "length",
    heading: "Five words",
    body: `- Engineering practice for agent-built software.
- Build further with coding agents.
- Serious software, built with agents.`,
  },
  {
    id: "one-sentence",
    group: "length",
    heading: "One sentence",
    body:
      `> discern installs an engineering practice into agent-built projects, helping one person build further while the software continues to earn confidence.`,
  },
  {
    id: "thirty-words",
    group: "length",
    heading: "Approximately 30 words",
    body:
      `> discern gives coding agents a project-owned way to plan, work, verify, and deliver changes. Ambitious software can move faster without making your attention scale with every implementation detail.`,
  },
  {
    id: "sixty-words",
    group: "length",
    heading: "Approximately 60 words",
    body:
      `> Coding agents can take a project further than one person could build alone. discern installs a serious engineering practice into the repository: shared project understanding, isolated work for every task, deterministic checks, quality measures that retain gains, and evidence for the exact change. The agents do more of the work; you stay responsible for what gets launched.`,
  },
  {
    id: "hundred-words",
    group: "length",
    heading: "Approximately 100 words",
    body:
      `> discern is an engineering practice for software built with coding agents. Your agent studies the repository, learns what matters, wires the project's real checks, and leaves every future agent with a shared understanding and working methods. Each task gets its own isolated environment. Substantial work can be divided, coordinated, reviewed, and returned with evidence attached to the exact completed change. Measurable improvements can become the new floor, and the person responsible for the project retains authority over what lands. The result is a bolder way to build: more ambition and reach, with software that continues to earn confidence as it grows.`,
  },
  {
    id: "experienced-engineer",
    group: "audience",
    heading: "Experienced engineer",
    body:
      `> discern turns your engineering judgment into a project-owned practice every coding agent works through. Run substantial work in parallel, reduce routine review and coordination, and keep your taste and standards intact across sessions and providers.`,
  },
  {
    id: "new-consequential-builder",
    group: "audience",
    heading: "New consequential builder",
    body:
      `> Tell your coding agent to commission discern. It studies your project, establishes the checks and guidance future agents will follow, explains the important choices, and proves the setup in a fresh worktree before it finishes. Your software gains a working practice that can grow with it.`,
  },
  {
    id: "agent",
    group: "audience",
    heading: "Agent",
    body:
      `> discern gives you structured tools, persistent project guidance, isolated work, explicit authority, and bounded results across supported providers. The project keeps its practice; you can spend context on the work.`,
  },
  {
    id: "press-or-partner",
    group: "audience",
    heading: "Press or partner",
    body:
      `> discern is an agent-native engineering practice for the growing class of software created through coding agents. It helps experienced engineers and new builders turn agent capability into software that can sustain real users, ongoing change, and responsibility.`,
  },
] as const satisfies readonly Description[];

/** The candidate hero systems, each a testable homepage arrangement. */
export const HERO_SYSTEMS = [
  {
    id: "hero-a",
    title: "Hero A — Ambition-led",
    eyebrow: "For people who take their software seriously.",
    headline: "A bolder way to build.",
    sub:
      "discern helps coding agents take on substantial work, so one person can take an ambitious project further with confidence in what comes back.",
    primaryCta: "See discern in practice",
    secondaryCta: "Tell your agent to set it up",
    signature: "An engineering practice for agent-built software.",
  },
  {
    id: "hero-b",
    title: "Hero B — Open",
    eyebrow: "For people who take their software seriously.",
    headline: "Build further.",
    sub:
      "Give coding agents a project-owned way to work, and take your software beyond the limits of one person's attention.",
    primaryCta: "Watch a project get commissioned",
    secondaryCta: "Read how discern works",
  },
  {
    id: "hero-c",
    title: "Hero C — Outcome-led",
    headline: "Software worth putting your name to.",
    sub:
      "discern installs a serious engineering practice into agent-built projects, helping the software hold up as it gains users, change, and responsibility.",
    primaryCta: "See the practice",
    secondaryCta: "Explore the evidence",
  },
] as const satisfies readonly HeroSystem[];

/** The contextual headline inventory. */
export const HEADLINES = [
  {
    line: "A bolder way to build.",
    bestUse: "Homepage, launch, founder-led campaign",
    caution:
      "Support with seriousness quickly so “bold” does not read as reckless.",
  },
  {
    line: "Build further.",
    bestUse: "Homepage variant, brand film, closing line",
    caution: "Needs a literal subhead because it is intentionally open.",
  },
  {
    line: "A bigger way to build.",
    bestUse: "Parallel-work demo, launch campaign",
    caution: "Clarify the capability and ambition the line describes.",
  },
  {
    line: "Software that holds up.",
    bestUse: "Outcome section, customer story, product page",
    caution: "Add energy nearby; can feel defensive alone.",
  },
  {
    line: "Ship serious software.",
    bestUse: "CTA, guide, campaign, video",
    caution: "Do not use as an accusation that current work is unserious.",
  },
  {
    line: "Software worth putting your name to.",
    bestUse: "Founder, pride, responsibility, close",
    caution: "Avoid overusing “name” alongside ownership language.",
  },
  {
    line: "Spend your attention where your judgment matters most.",
    bestUse: "Delegation section, engineer page",
    caution: "Long for a hero; strongest as a section proposition.",
  },
  {
    line: "When the prototype becomes the product.",
    bestUse: "Acquisition campaign, new-builder page",
    caution: "Situational; exclude from master-brand use.",
  },
  {
    line: "When people start depending on it.",
    bestUse: "Consequence-threshold campaign",
    caution: "Follow with a positive promise that celebrates the threshold.",
  },
  {
    line: "Agent ergonomics.",
    bestUse: "For Agents, technical essay",
    caution: "Human benefit must follow on mixed-audience surfaces.",
  },
] as const satisfies readonly Headline[];

/** The CTA system's named groups, in rendering order. */
export const CTA_BANKS = [
  {
    id: "demonstration",
    title: "Demonstration",
    ctas: [
      "See discern in practice",
      "See a backlog become a plan",
      "Watch a project get commissioned",
      "Follow a change from brief to acceptance",
      "See how several agents work together",
    ],
  },
  {
    id: "evaluation",
    title: "Evaluation",
    ctas: [
      "Explore the engineering practice",
      "Read the Proof model",
      "See how Standards work",
      "Review the trust boundaries",
      "Compare the agent experience",
    ],
  },
  {
    id: "action",
    title: "Action",
    ctas: [
      "Tell your agent to set it up",
      "Install discern",
      "Commission this project",
      "Open the setup guide",
    ],
  },
  {
    id: "agent",
    title: "Agent",
    ctas: [
      "Read the machine guide",
      "Open `llms.txt`",
      "Inspect the MCP tools",
      "Learn the project contract",
    ],
  },
] as const satisfies readonly CtaBank[];

/** The proof order: reveal mechanism in the order required by belief. */
export const PROOF_ORDER: readonly { step: string; detail: string }[] = [
  {
    step: "Show the desired future",
    detail: "greater ambition, earned confidence, meaningful attention.",
  },
  {
    step: "Show a recognizable moment",
    detail:
      "backlog planning, commissioning, parallel work, ready-for-decision return.",
  },
  {
    step: "Explain the category",
    detail: "an engineering practice installed into the project.",
  },
  {
    step: "Name the connected mechanisms",
    detail:
      "guidance, isolated work, deterministic checks, Standards, Proof, acceptance.",
  },
  {
    step: "Show an artifact",
    detail:
      "brief, wave plan, Standard trajectory, Proof, Map, Pattern finding.",
  },
  {
    step: "State the boundary",
    detail: "what the evidence covers and what it does not.",
  },
  {
    step: "Offer technical depth",
    detail: "documentation, source-level explanation, schemas, trust page.",
  },
];

/** The public-copy guardrails, in rendering order. */
export const PUBLIC_COPY_GUARDRAILS: readonly string[] = [
  "A feature supplies supporting evidence; promote it only when it serves the reader's moment.",
  "A canonical product noun becomes compelling only when it carries human meaning.",
  "“Serious” should feel aspirational and pleasurable.",
  "Give “bold” enough discipline to feel considered.",
  "Frame speed as expanded possibility. Avoid celebrating code volume.",
  "New builders should be welcomed without erasing engineering expertise.",
  "Engineers should be respected without making the brand an insiders' club.",
  "Agents should be presented as capable collaborators.",
  "Avoid `X, not Y` phrasing; the template reads as contemporary generated copy.",
  "Do not repeat the same slogan across several adjacent sections.",
  "Let natural sentences do more work than fragments and aphorisms.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render one pillar's section. */
function renderPillar(pillar: Pillar<ClaimSlug>): string {
  const parts = [
    `### ${pillar.title}`,
    "",
    `**Human truth:** ${pillar.humanTruth}`,
    "",
    `**Promise:** ${pillar.promise}`,
    "",
    "**Good expressions:**",
    "",
    bullets(pillar.goodExpressions),
  ];
  if (pillar.note !== undefined) {
    parts.push("", pillar.note);
  }
  if (pillar.avoid !== undefined) {
    parts.push("", "**Avoid:**", "", bullets(pillar.avoid));
  }
  return parts.join("\n");
}

/** Render one hero system's blockquote arrangement. */
function renderHero(hero: HeroSystem): string {
  const lines = [`### ${hero.title}`, ""];
  if (hero.eyebrow !== undefined) {
    lines.push(`> **${hero.eyebrow}**`, ">");
  }
  lines.push(
    `> # ${hero.headline}`,
    ">",
    `> ${hero.sub}`,
    ">",
    `> **Primary CTA:** ${hero.primaryCta}\\`,
    `> **Secondary CTA:** ${hero.secondaryCta}`,
  );
  if (hero.signature !== undefined) {
    lines.push(">", `> _${hero.signature}_`);
  }
  return lines.join("\n");
}

/** Render the descriptions belonging to one group. */
function renderDescriptions(group: Description["group"]): string {
  return DESCRIPTIONS.filter((description) => description.group === group)
    .map((description) => `### ${description.heading}\n\n${description.body}`)
    .join("\n\n");
}

/** The whole messaging document, ready for the barrel to stamp and resolve. */
export function renderMessagingDoc(): string {
  return [
    "# Messaging architecture",
    "",
    "**Status:** Canonical\\",
    "**Use for:** public descriptions, homepage and campaign direction, page hierarchy, CTAs, partner copy, launch material, and message testing.",
    "",
    "## How to use this document",
    "",
    "This document defines a family of message roles. It does not require one slogan to appear everywhere.",
    "",
    "Choose the message that serves the reader's moment, then support it with the appropriate category explanation and proof.",
    "",
    "The order is usually:",
    "",
    "1. human recognition or desire;",
    "2. changed experience;",
    "3. literal category;",
    "4. product mechanism;",
    "5. evidence and limits;",
    "6. action.",
    "",
    "## Canonical message hierarchy",
    "",
    TERRITORIES.map((territory) =>
      `### ${territory.title}\n\n${territory.body}`
    ).join("\n\n"),
    "",
    "## Message pillars",
    "",
    PILLARS.map(renderPillar).join("\n\n"),
    "",
    "## Descriptions by length",
    "",
    renderDescriptions("length"),
    "",
    "## Audience variants",
    "",
    renderDescriptions("audience"),
    "",
    "## Candidate hero systems",
    "",
    "These are testable candidates for the homepage.",
    "",
    HERO_SYSTEMS.map(renderHero).join("\n\n"),
    "",
    "## Contextual headline inventory",
    "",
    "| Line | Best use | Caution |",
    "| --- | --- | --- |",
    ...HEADLINES.map(
      (headline) =>
        `| ${headline.line} | ${headline.bestUse} | ${headline.caution} |`,
    ),
    "",
    "## CTA system",
    "",
    "CTAs should describe a destination or action.",
    "",
    CTA_BANKS.map((bank) => `### ${bank.title}\n\n${bullets(bank.ctas)}`)
      .join("\n\n"),
    "",
    "Avoid generic labels where the destination is unclear: `Explore`, `Discover`, `Continue`, and repeated `Learn more`.",
    "",
    "## Proof order",
    "",
    "Do not open with the complete mechanism list. Reveal proof in the order required by belief:",
    "",
    ...PROOF_ORDER.map(
      (entry, index) => `${index + 1}. **${entry.step}:** ${entry.detail}`,
    ),
    "",
    "## Public-copy guardrails",
    "",
    bullets(PUBLIC_COPY_GUARDRAILS),
  ].join("\n");
}
