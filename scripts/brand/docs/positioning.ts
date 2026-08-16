/**
 * The positioning as a prose-led registry module: the strategy's visible
 * sets — the promise hierarchy, the reasons to believe, the differentiation
 * blocks, the strategic tests, and the what-the-brand-is-not list — live as
 * typed data; the narrative stays authored Markdown. `positioning.md`
 * compiles from this module; cross-document references are `{{doc:…}}`
 * citation tokens the barrel resolves.
 */

/** One level of the promise hierarchy. */
export interface BrandPromise {
  readonly id: string;
  readonly title: string;
  readonly promise: string;
}

/** One numbered reason to believe the brand promise. */
export interface ReasonToBelieve {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

/** One differentiation block. */
export interface Differentiator {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** The promise hierarchy, strongest human promise first. */
export const PROMISE_HIERARCHY = [
  {
    id: "human",
    title: "Human promise",
    promise:
      "Build ambitious software with agents and remain confident in what the project becomes.",
  },
  {
    id: "practical",
    title: "Practical promise",
    promise:
      "More implementation can move without making coordination and review scale linearly with it.",
  },
  {
    id: "project",
    title: "Project promise",
    promise:
      "Every supported agent works through one project-owned engineering practice.",
  },
  {
    id: "evidence",
    title: "Evidence promise",
    promise:
      "Important claims attach to inspectable conditions and the exact change being considered.",
  },
  {
    id: "authority",
    title: "Authority promise",
    promise: "The person retains the decision over what becomes shared.",
  },
] as const satisfies readonly BrandPromise[];

/** The reasons to believe, in rendering order. */
export const REASONS_TO_BELIEVE = [
  {
    id: "commissioning",
    name: "Commissioning",
    detail:
      "the setup agent studies the repository, learns intent, wires the project's real checks, authors project instructions and principles, and proves the practice in an isolated worktree.",
  },
  {
    id: "project-continuity",
    name: "Project continuity",
    detail:
      "one authored source reaches every configured coding-agent provider; project knowledge and procedures persist across sessions.",
  },
  {
    id: "shaped-delegation",
    name: "Shaped delegation",
    detail:
      "substantial work can become complete briefs, parallel waves, or staged dependencies with explicit authority and independent review.",
  },
  {
    id: "isolated-work",
    name: "Isolated work",
    detail:
      "each task receives its own checkout, branch, identity, environment values, and declared resources.",
  },
  {
    id: "deterministic-completion",
    name: "Deterministic completion",
    detail:
      "the project runs its declared checks; no AI model judges another model's confidence.",
  },
  {
    id: "standards-retain-gains",
    name: "Standards that retain gains",
    detail:
      "a measurable improvement can be captured and may not be surrendered by a later branch.",
  },
  {
    id: "exact-change-evidence",
    name: "Exact-change evidence",
    detail:
      "the completion artifact identifies the committed tree and declared conditions it covers.",
  },
  {
    id: "human-acceptance",
    name: "Human acceptance",
    detail: "passing conditions do not independently grant authority to land.",
  },
  {
    id: "practice-evidence",
    name: "Practice evidence",
    detail:
      "local history can reveal recurring friction, provider cohorts, cycle time, gate fit, and quality trajectories.",
  },
  {
    id: "provider-continuity",
    name: "Provider continuity",
    detail:
      "the intelligence may change while the project's working practice remains.",
  },
] as const satisfies readonly ReasonToBelieve[];

/** The differentiation blocks, in rendering order. */
export const DIFFERENTIATION = [
  {
    id: "against-manual-review",
    title: "Against manual review",
    body:
      "Manual review does not scale at the same rate as agent production. discern moves more judgment into the project before, during, and after implementation.",
  },
  {
    id: "against-ai-code-review",
    title: "Against AI code review",
    body:
      "AI review offers interpretation. discern supplies deterministic project conditions, exact change evidence, and a controlled lifecycle. AI review can coexist with discern.",
  },
  {
    id: "against-ci",
    title: "Against CI",
    body:
      "CI remains useful for shared and remote verification. discern owns an earlier, local, agent-native practice around how work begins, proceeds, proves itself, and becomes eligible for acceptance. discern can also run the Gate in CI.",
  },
  {
    id: "against-vendor-fleets",
    title: "Against vendor-native agent fleets",
    body:
      "Vendor fleets can launch and coordinate sessions. discern gives the project a provider-independent practice: persistent instructions, work boundaries, quality conditions, evidence, authority, and memory.",
  },
  {
    id: "against-loose-tools",
    title: "Against a loose collection of tools",
    body:
      "discern's value comes from the connected method. Its prescriptiveness is part of the product: loosely coordinated delegation would scale inconsistency.",
  },
] as const satisfies readonly Differentiator[];

/** The strategic tests a core-brand message must pass, all of them. */
export const STRATEGIC_TESTS: readonly string[] = [
  "It is meaningful to experienced engineers and new consequential builders, or it is explicitly assigned to one audience path.",
  "It creates a human desire before requiring product vocabulary.",
  "It remains valuable as coding agents improve.",
  "It celebrates capability while preserving seriousness.",
  "It can be supported by a product mechanism or credible evidence.",
  "It does not imply security, total correctness, or autonomous shipping authority.",
  "It is something the founder can say aloud with conviction.",
  "It sounds recognizably like discern and avoids generic AI developer-tool language.",
];

/** What the brand must not be positioned as. */
export const BRAND_IS_NOT: readonly string[] = [
  "protection from stupid, rogue, or morally untrustworthy agents;",
  "a way to produce the greatest possible volume of code;",
  "a guarantee that software is secure or universally correct;",
  "a sandbox, firewall, virtual machine, or model-control layer;",
  "an AI reviewer replacing human judgment;",
  "a CI replacement;",
  "a fleet dashboard;",
  "a certification of the builder's status;",
  "a shortcut that makes engineering knowledge irrelevant;",
  "a solemn duty imposed through fear.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** The whole positioning document, ready for the barrel to stamp. */
export function renderPositioningDoc(): string {
  return [
    "# Positioning",
    "",
    "**Status:** Canonical\\",
    "**Strategic platform:** Consequential Code\\",
    "**Review when:** the market category, primary audience, product authority model, or launch strategy changes materially.",
    "",
    "## One-sentence strategic position",
    "",
    "> **discern helps people build ambitious software with coding agents, while giving the project the engineering practice required to earn confidence as it grows.**",
    "",
    "This sentence guides strategy. Public copy can express the idea in words suited to its surface.",
    "",
    "## The cultural change",
    "",
    "Coding agents have made software production abundant.",
    "",
    "One person can now attempt work that previously required a team, a longer schedule, deeper specialist access, or a much narrower ambition. Experienced engineers can direct several streams of implementation at once. People without a conventional software background can create applications for businesses, communities, projects, and ideas that would previously have remained out of reach.",
    "",
    "This is an expansion of human capability worth celebrating.",
    "",
    "It also changes the bottleneck. Execution can scale faster than personal attention, project memory, coordination, review, and the practical discipline that keeps software coherent over time.",
    "",
    "Faster production leaves a harder problem: the project must retain what matters while more of the implementation is delegated.",
    "",
    "## The audience identity",
    "",
    "> **For people who take their software seriously.**",
    "",
    "This is the shared identity across discern's primary human audiences.",
    "",
    "For an experienced engineer, it recognizes an existing standard: years of judgment, conventions, architectural instincts, and care for what ships.",
    "",
    "For a new builder, it expresses an aspiration: the desire for users, customers, collaborators, peers, and the builder themselves to regard the software as real, dependable, and worthy of confidence.",
    "",
    "The line recognizes a shared attitude across levels of experience. It welcomes people into a practice while respecting the value of experience.",
    "",
    "## What “serious” means",
    "",
    "Serious software is software with consequences.",
    "",
    "It may have:",
    "",
    bullets([
      "users who depend on it;",
      "data that matters;",
      "revenue or operating cost behind it;",
      "a reputation attached to it;",
      "maintenance obligations;",
      "a role in someone's workday;",
      "a future larger than the first demo.",
    ]),
    "",
    "“Serious” does not mean somber, joyless, corporate, large, or over-engineered.",
    "",
    "It means the builder has earned the privilege of caring about what happens next. The software deserves a way of working appropriate to the trust being placed in it.",
    "",
    "## The human tension",
    "",
    "Coding agents can produce implementation faster than one person can personally supervise it.",
    "",
    "Without a stronger practice, increased capability often creates a second job for the human:",
    "",
    bullets([
      "repeating project expectations;",
      "preparing and coordinating workspaces;",
      "dividing work into viable tasks;",
      "checking whether the right tests ran;",
      "reading every implementation detail;",
      "resolving avoidable branch and environment friction;",
      "remembering decisions and conventions across sessions;",
      "interpreting conversational reassurance as readiness.",
    ]),
    "",
    "The person gained execution capacity and became the operating layer around it.",
    "",
    "## The desired transformation",
    "",
    "With discern, more implementation can move without requiring attention, coordination, and review to grow at the same rate.",
    "",
    "The person can spend more of their judgment on:",
    "",
    bullets([
      "what should be built;",
      "why it matters;",
      "architecture and direction;",
      "trade-offs and exceptions;",
      "the working result;",
      "the decision to make a change shared.",
    ]),
    "",
    "The emotional movement is:",
    "",
    "> **Ambition → momentum → confidence → pride**",
    "",
    "The user should feel capable and liberated, with the practice carrying more of the coordination burden.",
    "",
    "## The master worldview: Consequential Code",
    "",
    "The internal name for the brand platform is **Consequential Code**. It pairs with the design system's **Editorial Engineering** (see {{doc:visual-identity}}). The labels serve one system: Consequential Code names what discern stands for, and Editorial Engineering names how discern looks.",
    "",
    "It contains a belief:",
    "",
    "> Software earns confidence through the way it is built.",
    "",
    "It contains an audience promise:",
    "",
    "> People newly empowered to build software can adopt a practice worthy of its consequences.",
    "",
    "It contains an experienced-engineer promise:",
    "",
    "> Accumulated judgment can influence far more work than one person can personally inspect.",
    "",
    "It contains a social desire:",
    "",
    "> The software should be taken seriously by the people asked to use, buy, maintain, trust, or depend on it.",
    "",
    "The platform should always feel aspirational. It must not rely on threats about bugs, job loss, angry customers, or model failure to make the reader care.",
    "",
    "## The enduring relationship",
    "",
    "discern rests on an enduring relationship among human judgment, agent capability, and project continuity. The human sets intent and grants authority. The agent interprets direction and implements the work. The project carries shared understanding, conditions, memory, and evidence across agents and tasks.",
    "",
    "A unit of work receives human intent, moves through an agent, enters the project, and returns with evidence for a human decision. The relationship persists as people, providers, tasks, and scale change. {{doc:visual-identity}} records its expression in the mark and the extended visual language.",
    "",
    "## Category",
    "",
    "### Primary category expression",
    "",
    "> **An engineering practice for agent-built software.**",
    "",
    "### Explanatory expression",
    "",
    "> **discern installs that practice into the project.**",
    "",
    "The category is broader than a quality gate, AI review tool, worktree manager, CI layer, or agent orchestrator.",
    "",
    "A discern practice includes:",
    "",
    bullets([
      "the project understanding every agent inherits;",
      "the conditions in which each change is made;",
      "reusable methods for recurring engineering work;",
      "deterministic checks and ratcheting quality measures;",
      "evidence attached to the exact completed change;",
      "explicit authority over what becomes shared;",
      "local evidence showing how the practice behaves over time.",
    ]),
    "",
    "“Installs a practice” explains the category. Lead public pages with the capability and confidence that living with the practice creates.",
    "",
    "## Positioning statement",
    "",
    "> **For people building software with real consequences, discern is an agent-native engineering practice that gives coding agents a project-owned way to plan, work, verify, and return changes. It lets one person build further while the software continues to earn confidence.**",
    "",
    "## Strategic platform roles",
    "",
    "### Master brand: Consequential Code",
    "",
    "This provides the worldview, audience identity, cultural breadth, and durable reason to exist.",
    "",
    "### Creative energy: Personal reach",
    "",
    "This supplies ambition and momentum through territories such as:",
    "",
    bullets([
      "**A bolder way to build.**",
      "**Build further.**",
      "**A bigger way to build.** Use it where the surrounding copy clearly establishes capability and ambition.",
    ]),
    "",
    "This territory should make discern enjoyable to promote and exciting to discover.",
    "",
    "### Conversion benefit: Meaningful delegation",
    "",
    "This explains a concrete change in the user's working life:",
    "",
    bullets([
      "substantial implementation can move without continuous supervision;",
      "attention can move toward direction, outcome, and consequential decisions;",
      "technical review can remain skeptical while becoming delegable;",
      "the human need not become the courier between parallel efforts.",
    ]),
    "",
    "Delegation supports the brand. It cannot serve as the master promise because many new builders have never worked through manual line-by-line review and autonomous “fleet” language can evoke a low-quality code factory.",
    "",
    "### Technical distinction: Agent ergonomics",
    "",
    "This explains why discern feels different to coding agents and advanced technical users.",
    "",
    "It is deterministic software designed around an intelligent machine as the principal operator: context is budgeted, state is explicit, refusals route forward, operations are safe to call, and the project retains one way of working across providers.",
    "",
    "Agent ergonomics should lead the For Agents page and technical thought leadership while supporting the main human promise.",
    "",
    "## The promise hierarchy",
    "",
    PROMISE_HIERARCHY.map((level) => `### ${level.title}\n\n> ${level.promise}`)
      .join("\n\n"),
    "",
    "## Reasons to believe",
    "",
    "A connected system supports the brand promise:",
    "",
    ...REASONS_TO_BELIEVE.map(
      (reason, index) => `${index + 1}. **${reason.name}:** ${reason.detail}`,
    ),
    "",
    "## Differentiation",
    "",
    DIFFERENTIATION.map(
      (differentiator) =>
        `### ${differentiator.title}\n\n${differentiator.body}`,
    ).join("\n\n"),
    "",
    "## Market boundary",
    "",
    "The meaningful boundary follows the software's intended life and consequences, regardless of the builder's credentials, team size, or project scale.",
    "",
    "The initial focus is:",
    "",
    "> **Software someone intends to rely upon.**",
    "",
    "The initial product is principally designed for one responsible person on one machine, including shared repositories. Future team and multi-machine editions may extend the commercial model without changing the core brand belief.",
    "",
    "## What the brand is not",
    "",
    "Do not position discern as:",
    "",
    bullets(BRAND_IS_NOT),
    "",
    "## Founder fit",
    "",
    "The chosen position should be natural for the founder to promote.",
    "",
    "The founder's authentic story is one of enthusiasm after skepticism: coding agents became genuinely useful, parallelism increased capability, traditional review became the bottleneck, and judgment moved into a durable practice around the work.",
    "",
    "The brand should therefore sound optimistic about agents, excited by new builders, and confident that discipline can increase freedom.",
    "",
    "## Strategic tests",
    "",
    "A proposed message belongs in the core brand only when it passes these tests:",
    "",
    ...STRATEGIC_TESTS.map((test, index) => `${index + 1}. ${test}`),
    "",
    "## Canonical summary",
    "",
    "> discern is for people who take their software seriously. It responds to a world in which far more people can build far more software, while the attention and discipline required to stand behind it remain scarce. discern installs an engineering practice into the project so coding agents can take on substantial work, the project can retain what matters, and the resulting software can continue to earn confidence. The brand should feel ambitious, premium, culturally alive, and exhilarating. The product earns that confidence through exact mechanisms; the brand begins with the future those mechanisms make possible.",
  ].join("\n");
}
