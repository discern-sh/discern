/**
 * The messaging architecture as typed registry data: the positioning grid,
 * message territories, the fact inventory, pillars, approved descriptions,
 * hero systems, the headline inventory, the CTA system, the proof order,
 * and the public-copy guardrails. `messaging.md` compiles from this module;
 * pillars, grid rows, and fact lines cite the claims ledger by slug, so a
 * message without a defensible reason to believe cannot compile.
 */

import type {
  CtaBank,
  Description,
  FactLine,
  Headline,
  HeroSystem,
  Pillar,
  PositioningContrast,
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

Use sparingly. It works best as a signature, eyebrow, manifesto line, social bio, or campaign closer. Its force depends on the unspoken second reading: the builder wants the software to be taken seriously by others.

Any developer tool could sign this line, so it seasons a page rather than carrying one; the lines that carry a page are the ones only discern can say.`,
  },
  {
    id: "category",
    title: "Lead territory — the category claim",
    body: `> **An engineering practice for agent-built software.**

> **discern installs that practice into the project.**

This is the lead: the one claim no competitor can put their logo under. Agent vendors sell the agent; discern installs the practice the project keeps. When a page can make only one point, it makes this one.

The sharpest expression of the contrast:

> **The labs are making agents better. discern makes your project better at receiving them.**

Alternative contextual forms:

- An agent-native engineering practice.
- A serious engineering practice, installed in your project.
- A working practice for coding agents and the people responsible for what ships.

The category line orients. Pair it with a fact line or a recognizable moment; it does not need an abstract emotional headline above it.`,
  },
  {
    id: "durable-outcome",
    title: "Durable outcome territory",
    body: `> **Software that holds up.**

A flexible expression covering ongoing change, scrutiny, real users, coherence, and maintainability. It carries an implicit before-state — software that gives way under those pressures — which is what keeps it from reading as filler.

> **Ship serious software.**

Compact, active, and campaign-ready. Effective for closing CTAs, guides, video titles, and product sections.

> **Software worth putting your name to.**

Personal and premium. Best where pride, authorship, and reputation are already present.

> **Build software you are proud to stand behind.**

Warmer and more explicit. Useful in founder, customer, and new-builder narratives.`,
  },
  {
    id: "primary-conversion",
    title: "Primary conversion territory",
    body: `> **Come back to work that is ready for a decision.**

The territory's job is a changed relationship to delegated work, for both audiences:

- the engineer moves away from routine implementation inspection;
- the new builder receives a meaningful basis for decisions without pretending to become a code reviewer.

“Spend your attention where your judgment matters most” is retired from lead use: it is the shared promise of every agent vendor, so any of them could sign it. The replacement expressions carry the mechanism that makes the promise discern's own.

Supporting expressions:

- The work returns with evidence attached to the exact change.
- Several pieces can move at once without making you their courier.
- Give the agent the work; keep the decision to ship.
- Your agent wrote four thousand lines last night. Which ones did you read?

The last line opens the problem. Follow it with the practice in the next breath, never with fear.`,
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
  {
    id: "deferred-creative",
    title: "Deferred creative territory",
    body: `Held for later, not for launch:

> **A bolder way to build.**

> **Build further.**

> **A bigger way to build.**

Each is an open line that any builder's tool could sign, and each needs a subhead to explain itself — the mark of a line spending equity the brand has not yet earned. An open line works once years of concrete campaigns have given it content; until then, the concrete territories above do the work. Revisit when launch evidence exists.

Avoid defaulting to **A better way to build** for the same reason at greater strength.`,
  },
] as const satisfies readonly Territory[];

/**
 * The positioning grid: the default on the left, discern's answer on the
 * right. Every message derives from a row of this grid; each row cites the
 * claims that make its right-hand cell defensible.
 */
export const POSITIONING_GRID = [
  {
    id: "session-amnesia",
    against:
      "Every agent session starts from zero and relearns the project from its prompt.",
    instead:
      "The practice lives in the project; every agent starts with it already in view.",
    claims: ["installs-a-practice", "one-instruction-source"],
  },
  {
    id: "human-courier",
    against:
      "The human shapes, relays, checks, and coordinates everything around the code.",
    instead:
      "Work moves as a complete handoff and returns ready for a decision, evidence attached.",
    claims: ["shaped-delegation", "reduced-review-burden"],
  },
  {
    id: "tone-as-evidence",
    against: "Confidence rests on the agent's own account of what it did.",
    instead:
      "The declared Gate evaluates the exact committed change; Proof records what passed.",
    claims: ["proof-exact-tree"],
  },
  {
    id: "quality-drift",
    against: "Quality drifts quietly as sessions accumulate.",
    instead: "A Standard may tighten, and a branch cannot weaken it.",
    claims: ["standards-cannot-loosen", "pin-measured-gains"],
  },
  {
    id: "provider-reteaching",
    against: "Switching providers means re-teaching the project from scratch.",
    instead: "The project keeps its way of working when the agent changes.",
    claims: ["switch-without-reteaching", "one-instruction-source"],
  },
  {
    id: "agent-side-race",
    against: "Every lab is making the agent better.",
    instead: "discern makes the project better at receiving them.",
    claims: ["agent-as-operator", "installs-a-practice"],
  },
] as const satisfies readonly PositioningContrast<ClaimSlug>[];

/**
 * The fact inventory: concrete, ledger-backed lines a page can carry
 * verbatim. Each line links to the claim that bounds its wording.
 */
export const FACT_LINES = [
  {
    id: "one-file",
    line: "All project-specific discern settings live in one root file, `discern.toml`.",
    claim: "one-config-file",
    note:
      "The smallest demonstration of the footprint; show the file itself where the layout allows.",
  },
  {
    id: "self-hosted",
    line:
      "discern is developed under its own Gate, worktrees, Standards, Map, and Logbook.",
    claim: "runs-on-itself",
    note: "The sincerity fact: the practice is trusted with its own development.",
  },
  {
    id: "ratchet",
    line: "A Standard may tighten; a branch cannot weaken its limit.",
    claim: "standards-cannot-loosen",
  },
  {
    id: "exact-tree",
    line:
      "Proof names the exact committed change that passed; a later commit invalidates it.",
    claim: "proof-exact-tree",
  },
  {
    id: "no-model",
    line: "discern contains no AI model and needs no API key.",
    claim: "no-model-inside",
  },
  {
    id: "owner-decides",
    line:
      "Passing makes a change eligible for a decision; it does not decide what ships.",
    claim: "gate-grants-no-authority",
    note:
      "Also the honest-limit line: state it plainly where trust is being earned.",
  },
  {
    id: "isolated-checkouts",
    line:
      "Parallel agents work in separate checkouts and cannot overwrite one another's working tree.",
    claim: "no-checkout-collisions",
  },
  {
    id: "no-reteaching",
    line: "Change coding agents without starting the project explanation over.",
    claim: "switch-without-reteaching",
  },
] as const satisfies readonly FactLine<ClaimSlug>[];

/** The message pillars; each cites the claims that make it defensible. */
export const PILLARS = [
  {
    id: "ambition-and-personal-leverage",
    title: "Ambition and personal reach",
    humanTruth:
      "Coding agents let one person attempt work that used to require more people, time, or specialist access.",
    promise: "discern gives that reach a practice that can carry it.",
    goodExpressions: [
      "Take the project further than one pair of hands.",
      "Take on the project you kept postponing.",
      "Turn a standing backlog into work in flight.",
      "One person, several workstreams, one decision at the end.",
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
      "The demo took a weekend. Now people depend on it.",
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
      "Every session starts from zero — unless the project remembers.",
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
      "one-instruction-source",
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
      "Come back to work that is ready for a real decision.",
      "Give the work a complete handoff.",
      "Several pieces can move at once without making you their courier.",
      "It returns finished, with evidence for exactly what passed.",
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
      "Proof names the exact change that passed.",
      "A measured gain becomes the limit the next branch inherits.",
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
      "Agents come and go. The practice stays.",
      "Keep the project consistent when you change agents.",
      "Switch providers without re-teaching the work.",
      "One project understanding across the agents you use.",
      "Keep moving when one provider reaches its quota.",
    ],
    note:
      "The quota message is timely and practical. It should not become the enduring master promise because provider pricing and limits will change.",
    claims: ["switch-without-reteaching", "one-instruction-source"],
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

/** Approved descriptions: the by-length ladder, then the audience variants. */
export const DESCRIPTIONS = [
  {
    id: "five-words",
    group: "length",
    heading: "Five words",
    body: `- Engineering practice for agent-built software.
- The practice your project keeps.
- Serious software, built with agents.`,
  },
  {
    id: "one-sentence",
    group: "length",
    heading: "One sentence",
    body:
      `> discern installs an engineering practice into agent-built projects — the project keeps the way of working, and every change returns with evidence for exactly what passed.`,
  },
  {
    id: "thirty-words",
    group: "length",
    heading: "Approximately 30 words",
    body:
      `> discern gives coding agents a project-owned practice: instructions every agent inherits, an isolated worktree for every task, a Gate that decides what is done, and Proof bound to the exact change.`,
  },
  {
    id: "sixty-words",
    group: "length",
    heading: "Approximately 60 words",
    body:
      `> Coding agents can take a project further than one person could build alone. discern installs a serious engineering practice into the repository: shared project understanding, isolated work for every task, deterministic checks, Standards that can only tighten, and evidence for the exact change. The agents do more of the work; you stay responsible for what gets launched.`,
  },
  {
    id: "hundred-words",
    group: "length",
    heading: "Approximately 100 words",
    body:
      `> discern is an engineering practice for software built with coding agents. Your agent studies the repository, learns what matters, wires the project's real checks, and leaves every future agent with a shared understanding and working methods. Each task gets its own isolated environment. Substantial work can be divided, coordinated, reviewed, and returned with evidence attached to the exact completed change. Measurable improvements can become the new floor, and the person responsible for the project retains authority over what lands. discern is developed under its own Gate and worktrees — the practice it installs is the practice it is built with. One person takes on more; the software keeps earning confidence as it grows.`,
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
      `> Tell your coding agent to commission discern. It studies your project, establishes the checks and instructions future agents will follow, explains the important choices, and proves the setup in a fresh worktree before it finishes. Your software gains a working practice that can grow with it.`,
  },
  {
    id: "agent",
    group: "audience",
    heading: "Agent",
    body:
      `> discern gives you structured tools, persistent project instructions, isolated work, explicit authority, and bounded results across supported providers. The project keeps its practice; you can spend context on the work.`,
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
    title: "Hero A — Category-led",
    eyebrow: "For people who take their software seriously.",
    headline: "The labs are making agents better.",
    sub:
      "discern makes your project better at receiving them: an engineering practice installed into the repository, kept by the project, and inherited by every agent that works there.",
    primaryCta: "Watch a project get commissioned",
    secondaryCta: "Tell your agent to set it up",
    signature: "An engineering practice for agent-built software.",
  },
  {
    id: "hero-b",
    title: "Hero B — Fact-led",
    headline: "Every session, your agent starts from zero.",
    sub:
      "discern is the practice your project keeps: one file every agent inherits, a Gate that decides what is done, and Proof bound to the exact change that passed.",
    primaryCta: "See discern in practice",
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
    line:
      "The labs are making agents better. discern makes your project better at receiving them.",
    bestUse: "Homepage hero, category explanation, launch",
    caution:
      "Keep both sentences together; the first alone is a compliment to the labs.",
  },
  {
    line: "Every session, your agent starts from zero.",
    bestUse: "Homepage hero, practice-retained section",
    caution:
      "Only the problem; the practice the project keeps must follow immediately.",
  },
  {
    line: "Agents come and go. The practice stays.",
    bestUse: "Provider-continuity section, closing line",
    caution: "Best where switching pain is already recognized.",
  },
  {
    line: "The demo took a weekend. Now people depend on it.",
    bestUse: "Consequence-threshold campaign, new-builder page",
    caution: "Celebrate the threshold; never scold the weekend.",
  },
  {
    line:
      "Your agent wrote four thousand lines last night. Which ones did you read?",
    bestUse: "Problem-opening ad, delegation essay",
    caution:
      "A question, not an accusation; answer with the practice in the next breath.",
  },
  {
    line: "A bolder way to build.",
    bestUse: "Deferred; post-launch campaign at the earliest",
    caution:
      "An open line any tool could sign; revisit once concrete campaigns have given it content.",
  },
  {
    line: "Build further.",
    bestUse: "Deferred; brand film once equity exists",
    caution: "Open two-word lines spend equity the brand has not yet earned.",
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
    bestUse: "Retired from lead use",
    caution:
      "Every agent vendor makes this promise; where it appears, ground it in mechanism within the same breath.",
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
      "Watch the Gate refuse a change",
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
      "instructions, isolated work, deterministic checks, Standards, Proof, acceptance.",
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

/** Render one positioning-grid row; the cited claims are provenance only. */
function renderContrastRow(row: PositioningContrast<ClaimSlug>): string {
  return `| ${row.against} | ${row.instead} |`;
}

/** Render one fact line with its ledger citation and optional note. */
function renderFactLine(fact: FactLine<ClaimSlug>): string {
  const note = fact.note === undefined ? "" : ` ${fact.note}`;
  return `- **${fact.line}** — {{claim:${fact.claim}}}.${note}`;
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
    "Two standing rules: every public page carries at least one line from the fact inventory, and no page leads with a line a competitor could sign unchanged.",
    "",
    "## The positioning grid",
    "",
    "The grid every message derives from: the default the reader already lives with on the left, discern's answer on the right. A line that could sit on either side of the table says nothing.",
    "",
    "| The default | discern's answer |",
    "| --- | --- |",
    ...POSITIONING_GRID.map(renderContrastRow),
    "",
    "## Canonical message hierarchy",
    "",
    TERRITORIES.map((territory) =>
      `### ${territory.title}\n\n${territory.body}`
    ).join("\n\n"),
    "",
    "## The fact inventory",
    "",
    "Concrete, ledger-backed lines a page can carry verbatim. Prefer one of these to an adjective; each links to the claim that bounds its wording, and the wording may not outgrow the claim. When a page needs numbers, use the project's real measured values — an invented number is an opinion in costume.",
    "",
    FACT_LINES.map(renderFactLine).join("\n"),
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
