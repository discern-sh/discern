/**
 * The register bridge as typed registry data: the core concept map (the
 * table behind `{{concept:…}}` citations), the product-to-brand translation
 * examples, the direct-lift watchlist, and the register-drift smell lists.
 * `register-bridge.md` compiles from this module; the barrel builds its
 * concept citation table from `CONCEPTS`, so a renamed concept can never
 * strand a reference.
 */

import type { Concept, Translation } from "./model.ts";

/** The heading the concept map renders under (also its citation anchor). */
export const CONCEPT_MAP_HEADING = "Core concept map";

/** The core concept map: one row per product concept, in table order. */
export const CONCEPTS = [
  {
    id: "practice",
    name: "Practice",
    productRole:
      "The connected project-specific system of instructions, Skills, worktrees, checks, Standards, evidence, acceptance, maintained knowledge, and local history.",
    humanSituation:
      "The person cannot personally repeat or supervise every expectation across growing agent work.",
    brandInterpretation:
      "A serious way of working that persists around the project.",
    plainFirstUse: "“An engineering practice installed into your project.”",
    prominence: "Yes, as category.",
    doNotImply:
      "A vague methodology, consultancy, or ritual detached from software.",
  },
  {
    id: "change",
    name: "Change",
    productRole:
      "One bounded effort and resulting committed tree through evaluation and acceptance.",
    humanSituation:
      "The person needs to reason about one unit of delegated work from brief to decision.",
    brandInterpretation: "Work that returns in a complete, reviewable form.",
    plainFirstUse: "“One task and the exact completed change it produced.”",
    prominence: "Yes, after orientation.",
    doNotImply: "A universal guarantee about the entire application.",
  },
  {
    id: "gate",
    name: "Gate",
    productRole:
      "The project's declared full check, run deterministically over the current tree.",
    humanSituation:
      "An agent says the work is finished, but “done” needs a stable project meaning.",
    brandInterpretation: "The project has a real definition of ready.",
    plainFirstUse: "“The project's final quality check (the Gate).”",
    prominence: "Supporting proof.",
    doNotImply:
      "That passing alone proves security, usefulness, or universal correctness.",
  },
  {
    id: "standard",
    name: "Standard",
    productRole:
      "A measurable floor or ceiling held against the trunk and allowed to tighten only.",
    humanSituation: "A project improves, then later work gives the gain back.",
    brandInterpretation:
      "Once the project earns a measurable improvement, it can keep it.",
    plainFirstUse: "“A quality measure that can only improve (a Standard).”",
    prominence: "Yes, in proof sections.",
    doNotImply: "That every important quality is reducible to one number.",
  },
  {
    id: "proof",
    name: "Proof",
    productRole:
      "Evidence that one exact clean committed tree passed the declared Gate and held applicable Standards.",
    humanSituation:
      "The person needs to know which result the evidence covers.",
    brandInterpretation: "Evidence attached to the exact completed change.",
    plainFirstUse:
      "“Proof that this exact change passed the project's declared checks.”",
    prominence: "Yes, with scope.",
    doNotImply:
      "Formal verification, security proof, absence of all defects, or automatic shipping authority.",
  },
  {
    id: "worktree",
    name: "Worktree",
    productRole:
      "A separate Git checkout and branch for one effort, with identity, environment, and declared resources.",
    humanSituation:
      "Several agents need to work without sharing one mutable checkout or environment.",
    brandInterpretation: "Every task receives its own prepared place to work.",
    plainFirstUse: "“An isolated workspace for one task (a Git worktree).”",
    prominence: "On how-it-works and engineer pages.",
    doNotImply:
      "That logical source overlap or semantic integration conflict can never occur.",
  },
  {
    id: "instructions",
    name: "Instructions",
    productRole:
      "One authored source compiled into each configured provider's instruction surface.",
    humanSituation:
      "The project is re-explained in every session and provider.",
    brandInterpretation: "Every agent arrives already briefed.",
    plainFirstUse:
      "“Shared project instructions, written once and supplied to every agent.”",
    prominence: "Yes, as a benefit.",
    doNotImply: "Autonomous learning or a model inside discern.",
  },
  {
    id: "skill",
    name: "Skill",
    productRole: "A reusable `SKILL.md` playbook materialized for each agent.",
    humanSituation:
      "A hard-won procedure disappears with the session that learned it.",
    brandInterpretation: "A method future agents can inherit and apply.",
    plainFirstUse: "“A reusable agent playbook (a Skill).”",
    prominence: "Supporting.",
    doNotImply:
      "A plugin marketplace or an autonomous capability requiring no judgment.",
  },
  {
    id: "map",
    name: "Map",
    productRole:
      "Agent-maintained project documentation, mechanically checked and selectively publishable.",
    humanSituation:
      "Delegation increases while the project becomes less legible to its human.",
    brandInterpretation:
      "A readable account of what the agents understand about the project.",
    plainFirstUse: "“The project's maintained guide (the Map).”",
    prominence: "Yes, in continuity and trust sections.",
    doNotImply: "Subjective prose freshness that discern can perfectly judge.",
  },
  {
    id: "desk",
    name: "Desk",
    productRole: "The human's interactive surface over work in flight.",
    humanSituation:
      "The person needs one calm view over delegated tasks and valid next actions.",
    brandInterpretation: "One place to see and direct the work.",
    plainFirstUse: "“The human view over work in progress (the Desk).”",
    prominence: "Product-page supporting object.",
    doNotImply: "A cloud management dashboard or team control plane.",
  },
  {
    id: "logbook",
    name: "Logbook",
    productRole: "Local, metadata-only history of discern use.",
    humanSituation:
      "The team or owner remembers friction anecdotally but cannot see recurring practice.",
    brandInterpretation: "A private record of how the work has been moving.",
    plainFirstUse:
      "“A local activity record (the Logbook) containing metadata; it excludes code and output.”",
    prominence: "Deeper proof.",
    doNotImply:
      "Surveillance, remote telemetry, code capture, or employee monitoring.",
  },
  {
    id: "patterns",
    name: "Patterns",
    productRole:
      "Read-only analysis of local evidence across behavior, gate fit, funnel flow, Standards, cohorts, and epochs.",
    humanSituation:
      "The practice needs evidence about how its way of working changes over time.",
    brandInterpretation: "See how the way of working changes over time.",
    plainFirstUse:
      "“A practice report that finds recurring friction and trends (Patterns).”",
    prominence: "Important secondary pillar.",
    doNotImply:
      "Agent grading, causal certainty, or fair performance ranking across different task mixes.",
  },
  {
    id: "accept",
    name: "Accept",
    productRole:
      "The verified operation that fast-forwards an authorized exact change onto the trunk and cleans up the effort.",
    humanSituation:
      "A completed change must become shared without ambiguity about tree or authority.",
    brandInterpretation:
      "A recorded decision that turns verified work into shared work.",
    plainFirstUse: "“Accept the exact reviewed change onto the shared branch.”",
    prominence: "Supporting authority story.",
    doNotImply: "That a passing Gate independently grants permission.",
  },
  {
    id: "landing-authority",
    name: "Landing authority",
    productRole:
      "Machine-checked evidence that a specific worktree or scope may land.",
    humanSituation:
      "The human wants independence without approving every routine action.",
    brandInterpretation: "Define permission once at a meaningful boundary.",
    plainFirstUse: "“Recorded permission for this task or scope to land.”",
    prominence: "Consent and trust pages.",
    doNotImply:
      "Blanket autonomous action or inferred consent from old conversation.",
  },
  {
    id: "fleet",
    name: "Fleet",
    productRole: "The set of active worktrees reported by status and the Desk.",
    humanSituation: "Several delegated tasks are moving at once.",
    brandInterpretation: "Work in flight across several agents.",
    plainFirstUse: "“All current tasks in flight (the fleet).”",
    prominence: "Engineer and agent pages.",
    doNotImply:
      "Enterprise scale, command-and-control surveillance, or uniqueness versus vendor fleets.",
  },
  {
    id: "commission",
    name: "Commission",
    productRole: "Brand interpretation of staged agent-driven setup.",
    humanSituation:
      "A project needs a working practice tailored to its repository and intent.",
    brandInterpretation:
      "The agent studies, establishes, and proves the project's way of working.",
    plainFirstUse: "“Commission discern for this project.”",
    prominence: "Yes, especially setup.",
    doNotImply:
      "A passive installer, instant magic, or zero work by the agent.",
  },
  {
    id: "agent-ergonomics",
    name: "Agent ergonomics",
    productRole:
      "Design discipline for machine operators: bounded context, typed contracts, stable state, callable idempotence, useful refusals, relay-safe prose.",
    humanSituation:
      "Agents waste context and tool calls operating human-oriented software.",
    brandInterpretation: "Software designed around the machine doing the work.",
    plainFirstUse: "“Agent ergonomics: interaction design for coding agents.”",
    prominence: "Technical and For Agents.",
    doNotImply: "An AI model inside discern or a proprietary agent.",
  },
  {
    id: "provider-independence",
    name: "Provider independence",
    productRole:
      "One project instructions and practice across supported providers.",
    humanSituation:
      "Quotas, preferences, capabilities, and availability lead the user to switch agents.",
    brandInterpretation: "Change agents without re-teaching the project.",
    plainFirstUse: "“One project practice across the coding agents you use.”",
    prominence: "Yes, current practical benefit.",
    doNotImply:
      "Identical provider capability, guaranteed portability of every vendor feature, or permanent quota economics.",
  },
  {
    id: "owner",
    name: "Owner",
    productRole:
      "The responsible human who sets intent and authority and carries consequences.",
    humanSituation:
      "Someone must decide what becomes shared and stand behind the result.",
    brandInterpretation:
      "Express the action or consequence and keep the abstract role backstage.",
    plainFirstUse: "“The person responsible for the project.”",
    prominence: "Mostly backstage.",
    doNotImply:
      "Corporate “product owner,” legal ownership, management hierarchy, or constant supervision.",
  },
  {
    id: "serious-software",
    name: "Serious software",
    productRole: "A brand territory with no product definition.",
    humanSituation:
      "The software has users, data, revenue, reputation, maintenance, or operational importance.",
    brandInterpretation: "Software that deserves and earns confidence.",
    plainFirstUse: "No technical definition required; show the consequences.",
    prominence: "Yes, central worldview.",
    doNotImply:
      "Somber personality, over-engineering, exclusion, or moral superiority.",
  },
] as const satisfies readonly Concept[];

/** The product-to-brand translation examples, in rendering order. */
export const TRANSLATIONS = [
  {
    id: "gate",
    title: "Gate",
    productTruth:
      "`discern done` runs the project's declared finishing and verification work.",
    weakLiteralTranslation: "A comprehensive deterministic quality gate.",
    betterHumanTranslations: [
      "Know what “ready” means in this project.",
      "Let the project decide whether the work has met its conditions.",
      "Receive work after the project's real checks have run.",
    ],
    productNounEntry:
      "The project's final quality check (the Gate) runs the commands and Standards the project declares.",
  },
  {
    id: "standards",
    title: "Standards",
    productTruth:
      "a floor may rise and a ceiling may fall; a branch cannot loosen either.",
    weakLiteralTranslation: "Ratcheting numerical quality constraints.",
    betterHumanTranslations: [
      "Once the project improves, a later change cannot give the gain back.",
      "Lock in every gain.",
      "Keep a hard-won improvement as the new starting point.",
    ],
  },
  {
    id: "proof",
    title: "Proof",
    productTruth:
      "evidence covers one exact committed tree and its declared Gate result.",
    weakLiteralTranslation: "A DSSE-compatible completion attestation.",
    betterHumanTranslations: [
      "Know which exact change the evidence belongs to.",
      "Receive a completed change with a clear account of what passed.",
      "Review a claim tied directly to the work and its result.",
    ],
  },
  {
    id: "worktrees",
    title: "Worktrees",
    productTruth:
      "one separate checkout, branch, identity, and declared resource set per effort.",
    weakLiteralTranslation: "Automated Git worktree orchestration.",
    betterHumanTranslations: [
      "Give every task its own prepared place to work.",
      "Let several agents move without sharing the same workspace.",
      "Stop administering ports, environments, and cleanup by hand.",
    ],
  },
  {
    id: "instructions",
    title: "Instructions",
    productTruth:
      "one authored source compiles into supported provider instruction files.",
    weakLiteralTranslation: "Cross-provider generated instruction parity.",
    betterHumanTranslations: [
      "Change agents without starting the project explanation over.",
      "What you've taught the project outlives every session.",
      "Keep the project's conventions somewhere stronger than repeated prompts.",
    ],
  },
  {
    id: "delegate-work",
    title: "Delegate Work",
    productTruth:
      "a Skill shapes one handoff, internal fan-out, parallel streams, or staged dependencies, with complete briefs, work boundaries, authority, and adversarial review.",
    weakLiteralTranslation: "Multi-agent planning and orchestration.",
    betterHumanTranslations: [
      "Turn a standing backlog into work in flight.",
      "Give several agents complete, non-overlapping responsibilities.",
      "Let dependencies resolve without becoming the courier between sessions.",
      "What comes back has already faced an independent technical pass.",
    ],
  },
  {
    id: "patterns",
    title: "Patterns",
    productTruth:
      "local evidence is analyzed through named detectors across behavior, gate fit, funnel, trajectories, providers, and configurations.",
    weakLiteralTranslation: "Local agent workflow analytics.",
    betterHumanTranslations: [
      "See where the practice is improving and where work keeps losing time.",
      "Replace recurring anecdotes with counted evidence.",
      "Compare working patterns at the cohort level and leave agent rankings out.",
    ],
  },
] as const satisfies readonly Translation[];

/** Product phrases that may not automatically become brand headlines. */
export const DIRECT_LIFT_WATCHLIST: readonly string[] = [
  "The repo decides what done means.",
  "An agent's confidence has no vote.",
  "Signal without new failure modes.",
  "Facts before judgments.",
  "Necessary, not sufficient.",
  "Placement is consent.",
  "Calling the verb replaces pre-checking it.",
  "The gate is the bar for done.",
  "Quality numbers that can never get worse.",
  "The agent is the user.",
  "Context is a budget.",
];

/** The drafting procedure's steps, in order. */
export const DRAFTING_PROCEDURE: readonly string[] = [
  "State the exact product truth in product language.",
  "Identify the human moment in which it matters.",
  "Name the burden, risk, or limitation that exists today.",
  "Describe the changed experience in ordinary language.",
  "Decide whether that change deserves public prominence.",
  "Write the human proposition without product nouns.",
  "Reintroduce only the product nouns required to explain or prove it.",
  "Check the proposed claim against {{doc:claims-and-evidence}}.",
];

/** Product-copy smells that flag a brand draft. */
export const PRODUCT_COPY_SMELLS: readonly string[] = [
  "begins with a command, subsystem, registry, or internal artifact;",
  "uses several canonical nouns before a human situation appears;",
  "follows the feature canon's pillar order;",
  "explains the mechanism before the reader wants the outcome;",
  "sounds like a precise manual with larger typography;",
  "treats the completeness of the feature list as a reason to mention everything;",
  "repeats product aphorisms as section headlines;",
  "uses operational failure language to create urgency;",
  "turns “serious” into compliance, fear, or solemnity.",
];

/** Brand-copy drift smells that flag a product draft. */
export const BRAND_COPY_DRIFT: readonly string[] = [
  "substitutes a memorable synonym for a canonical term;",
  "hides the exact state or scope behind emotional language;",
  "uses a broad brand promise where a specific condition is required;",
  "anthropomorphises or judges an agent;",
  "implies authority without machine-checkable evidence;",
  "calls a result safe, secure, correct, or complete beyond what the product establishes;",
  "leaves the next valid action ambiguous.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render one concept's table row (formatting aligns the columns later). */
function conceptRow(concept: Concept): string {
  return `| **${concept.name}** | ${concept.productRole} | ${concept.humanSituation} | ${concept.brandInterpretation} | ${concept.plainFirstUse} | ${concept.prominence} | ${concept.doNotImply} |`;
}

/** Render one translation's section. */
function renderTranslation(translation: Translation): string {
  const parts = [
    `### ${translation.title}`,
    "",
    `**Product truth:** ${translation.productTruth}`,
    "",
    `**Weak literal translation:** \`${translation.weakLiteralTranslation}\``,
    "",
    "**Better human translations:**",
    "",
    bullets(translation.betterHumanTranslations),
  ];
  if (translation.productNounEntry !== undefined) {
    parts.push(
      "",
      "**Where the product noun enters:**",
      "",
      `> ${translation.productNounEntry}`,
    );
  }
  return parts.join("\n");
}

/** The whole register bridge, ready for the barrel to stamp and resolve. */
export function renderBridgeDoc(): string {
  return [
    "# Register bridge",
    "",
    "**Status:** Canonical\\",
    "**Purpose:** Convert product truth into human meaning without letting the product canon dictate the brand's surface style.",
    "",
    "## The register firewall",
    "",
    "Every public claim should be traceable backwards:",
    "",
    "> Brand expression → human situation → practical consequence → product mechanism → source of truth",
    "",
    "Only features that help the reader understand or believe the human proposition belong in marketing.",
    "",
    "Use the product canon as evidence after defining the human proposition.",
    "",
    "## Drafting procedure",
    "",
    "Before writing public copy about a feature:",
    "",
    ...DRAFTING_PROCEDURE.map((step, index) => `${index + 1}. ${step}`),
    "",
    `## ${CONCEPT_MAP_HEADING}`,
    "",
    "| Concept | Exact product role | Human situation | Brand interpretation | Plain-language first use | Use prominently? | Do not imply |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...CONCEPTS.map(conceptRow),
    "",
    "## Product-to-brand translations",
    "",
    TRANSLATIONS.map(renderTranslation).join("\n\n"),
    "",
    "## Direct-lift watchlist",
    "",
    "The following product phrases may be accurate and useful in documentation. Treat them as quoted source material when considering brand headlines:",
    "",
    bullets(DIRECT_LIFT_WATCHLIST.map((phrase) => `\`${phrase}\``)),
    "",
    "Use these phrases in technical thought leadership or a product section when they serve the reader. Their place in the canon says nothing about whether they create human desire at the top of a marketing page.",
    "",
    "## Product-copy smells in brand drafts",
    "",
    "Flag a brand draft when it:",
    "",
    bullets(PRODUCT_COPY_SMELLS),
    "",
    "## Brand-copy drift in product drafts",
    "",
    "Flag a product draft when it:",
    "",
    bullets(BRAND_COPY_DRIFT),
  ].join("\n");
}
