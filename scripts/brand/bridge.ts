/**
 * The register bridge as typed registry data: the core concept map (the
 * concept blocks behind `{{concept:…}}` citations), the product-to-brand
 * translation examples, the direct-lift watchlist, and the register-drift
 * smell lists. `register-bridge.md` compiles from this module; the barrel
 * builds its concept citation table from `CONCEPTS`, so a renamed concept can
 * never strand a reference.
 *
 * Each concept carries facts both registers share, then one form per
 * register: `docs` for the product voice (the manual, CLI text, tips) and
 * `brand` for the brand voice. Product language follows the glossary's
 * running-prose casing; `productLanguage()` hands every such string to the
 * casing guard in `tests/brand_registry_codegen_test.ts`.
 */

import type { Concept, Translation } from "./model.ts";

/** The heading the concept map renders under (also its citation anchor). */
export const CONCEPT_MAP_HEADING = "Core concept map";

/** The core concept map: one block per product concept, in rendering order. */
export const CONCEPTS = [
  {
    id: "readiness",
    name: "Readiness",
    productRole:
      "A question-led account of fitness for an intended next step, connected to project checks, declared judgments, taught methods, evidence, and authority.",
    humanSituation:
      "The software is about to enter people's lives, and the builder wants it to hold up to what they will ask of it.",
    doNotImply:
      "A new automatic assessment engine, a readiness score, a universal checklist, or a replacement for human and agent judgment.",
    docs: {
      instead:
        "Name the question the reader wants answered, then the feature that helps answer it, such as a checkpoint or a standard.",
    },
    brand: {
      firstUse:
        "“The questions you want answered before people depend on the next release.”",
      interpretation:
        "Give the project a way to carry the care you bring to what ships.",
      prominence: "Yes, through a recognizable question or desired future.",
    },
  },
  {
    id: "practice",
    name: "Practice",
    productRole:
      "The connected, project-specific system of instructions, skills, worktrees, checks, standards, evidence, acceptance, maintained knowledge, and local history.",
    humanSituation:
      "The person cannot personally repeat or supervise every expectation across growing agent work.",
    doNotImply:
      "A vague methodology, consultancy, or ritual detached from software.",
    docs: {
      firstUse:
        "the **practice**: the way of working discern sets up in your project, which carries over from one session to the next",
      reason:
        "Every session starts with the project's instructions, checks, and methods already in hand, so you don't have to explain the project again.",
    },
    brand: {
      firstUse: "“An engineering practice installed into your project.”",
      interpretation:
        "A serious way of working that persists around the project.",
      prominence: "Yes, as category.",
    },
  },
  {
    id: "change",
    name: "Change",
    productRole:
      "One bounded effort and the committed tree it produces, carried through the gate, review, and landing.",
    humanSituation:
      "The person needs to reason about one unit of delegated work from brief to decision.",
    doNotImply: "A universal guarantee about the entire application.",
    docs: {
      instead:
        "Write “task” for the work and “change” for what it produces. Both are everyday words that need no definition.",
    },
    brand: {
      firstUse: "“One task and the exact completed change it produced.”",
      interpretation: "Work that returns in a complete, reviewable form.",
      prominence: "Yes, after orientation.",
    },
  },
  {
    id: "gate",
    name: "Gate",
    productRole:
      "The project's declared full check, which `discern done` runs on the committed tree: its jobs, the `gate` command of each scope the change touches, its standards, and discern's own checks.",
    humanSituation:
      "An agent says the work is finished, but “done” needs a stable project meaning.",
    doNotImply:
      "That a pass proves security, usefulness, or universal correctness, or grants permission to land.",
    docs: {
      firstUse:
        "the **gate**: your project's own commands, such as its linter and tests, which must all pass before a change counts as finished",
      reason:
        "You don't have to take your agent's word that a change is finished, because your project's own commands decide.",
    },
    brand: {
      firstUse: "“The project's final quality check (the Gate).”",
      interpretation: "The project has a real definition of ready.",
      prominence: "Supporting proof.",
    },
  },
  {
    id: "standard",
    name: "Standard",
    productRole:
      "A measured limit: a floor that may only rise, or a ceiling that may only fall. The gate checks it on every change against the trunk's configuration, so a branch can't loosen it without the owner's approval of that exact proposal.",
    humanSituation: "A project improves, then later work gives the gain back.",
    doNotImply:
      "That every important quality reduces to one number, or that a limit can never loosen: the owner can approve a looser one.",
    docs: {
      firstUse:
        "a **standard**: a measured limit your project holds, such as a maximum download size or a minimum test coverage",
      reason:
        "Once your project reaches a number worth keeping, every later change has to meet it, so a measured gain can't slip back.",
    },
    brand: {
      firstUse: "“A quality limit that later work can't weaken (a Standard).”",
      interpretation:
        "Once the project earns a measurable improvement, it can keep it.",
      prominence: "Yes, in proof sections.",
    },
  },
  {
    id: "proof",
    name: "Proof",
    productRole:
      "discern's record that one exact, clean, committed tree passed the declared gate and held its standards, with the agent's checkpoint answers kept separate. Any later edit makes it stale.",
    humanSituation:
      "The person needs to know which result the evidence covers.",
    doNotImply:
      "Formal verification, a security proof, the absence of all defects, verification of the agent's checkpoint answers, or permission to land.",
    docs: {
      firstUse:
        "**Proof**: discern's record of which of your project's commands passed on one exact commit",
      reason:
        "Your review starts from what passed on the commit in front of you, so it can go straight to the questions only you can answer.",
    },
    brand: {
      firstUse:
        "“Proof that this exact change passed the project's declared checks.”",
      interpretation: "Evidence attached to the exact completed change.",
      prominence: "Yes, with scope.",
    },
  },
  {
    id: "checkpoint",
    name: "Checkpoint",
    productRole:
      "A `[checkpoints.<id>]` entry that pairs a trigger, which picks out matching changes, with a question for the agent to judge. A `stop` checkpoint holds the gate until the agent records its answer as declared met or declared unmet, and an `advise` checkpoint only offers the question. The questions come from the trunk, so a branch can't rewrite them.",
    humanSituation:
      "The questions a reviewer would raise need judgment, and they go unasked when every test passes.",
    doNotImply:
      "That discern verifies the agent's answer, or that a question can stand in for a test.",
    docs: {
      firstUse:
        "a **checkpoint**: a review question your project asks your agent whenever a certain kind of change happens",
      reason:
        "Your agent's answer goes into the Proof for you to read, so you don't have to remember to ask.",
    },
    brand: {
      firstUse:
        "“A question the project asks whenever a change needs judgment (a checkpoint).”",
      interpretation:
        "The questions an experienced reviewer would raise get asked at the right moment.",
      prominence: "Yes, in judgment and review sections.",
    },
  },
  {
    id: "variance",
    name: "Variance",
    productRole:
      "The owner's permission, given in the current conversation, to land a change despite a declared-unmet checkpoint answer. It covers that exact declaration, its reason, and the landed commit, and no grant covers it.",
    humanSituation:
      "The agent reports a gap it couldn't close, and someone has to decide whether the change lands anyway.",
    doNotImply:
      "That a grant, a general go-ahead, or an earlier conversation can approve one, or that approving it retires the question for later work.",
    docs: {
      firstUse:
        "a **variance**: your permission to land a change despite an unmet checkpoint answer",
      reason:
        "Your agent can report a gap it couldn't close and still finish its work, while the decision to land anyway stays with you.",
    },
    brand: {
      firstUse:
        "“Your recorded decision to land despite a known gap (a variance).”",
      interpretation:
        "A known gap reaches you as a decision, with the agent's reason attached.",
      prominence: "Consent and trust pages.",
    },
  },
  {
    id: "worktree",
    name: "Worktree",
    productRole:
      "A separate Git checkout and branch for one effort, with identity, environment, and declared resources.",
    humanSituation:
      "Several agents need to work without sharing one mutable checkout or environment.",
    doNotImply:
      "That logical source overlap or semantic integration conflict can never occur, or that a worktree sandboxes the agent.",
    docs: {
      firstUse:
        "a **worktree**: a separate copy of the project on its own branch, where one task's work happens",
      reason:
        "Your agent can try an idea, break something, and fix it there while your shared branch keeps working.",
    },
    brand: {
      firstUse: "“An isolated workspace for one task (a Git worktree).”",
      interpretation: "Every task receives its own prepared place to work.",
      prominence: "On how-it-works and engineer pages.",
    },
  },
  {
    id: "trunk",
    name: "Trunk",
    productRole:
      "The project's shared branch, named by `[repository].trunk` and usually `main`, where finished changes land. New tasks branch from it by default, and `discern accept` moves it only by fast-forward.",
    humanSituation:
      "Agents experiment in parallel, and the person needs one branch that holds the work they've agreed to.",
    doNotImply:
      "Branch protection: discern moves the trunk only by landing, and a commit made directly on it skips the gate and review.",
    docs: {
      firstUse:
        "the **trunk**: your project's shared branch, usually `main`, where finished changes land",
      reason:
        "Each task works on its own branch, so the trunk holds what you've agreed to while agents experiment elsewhere.",
    },
    brand: {
      firstUse:
        "“The shared version of the project that finished work joins (the trunk).”",
      interpretation:
        "The version everyone builds on holds what you've agreed to.",
      prominence: "Supporting, on how-it-works and engineer pages.",
    },
  },
  {
    id: "instructions",
    name: "Instructions",
    productRole:
      "The project's instruction source, compiled with discern's built-in instructions into the instruction file each configured coding agent reads.",
    humanSituation:
      "The project is re-explained in every session and provider.",
    doNotImply: "Autonomous learning or a model inside discern.",
    docs: {
      firstUse:
        "the project **instructions**: the rules every session reads before it starts, which discern writes from one source into the file each coding agent reads",
      reason:
        "You teach a rule once, and every later session and coding agent starts out knowing it.",
    },
    brand: {
      firstUse:
        "“Shared project instructions, written once and supplied to every agent.”",
      interpretation: "Every agent arrives already briefed.",
      prominence: "Yes, as a benefit.",
    },
  },
  {
    id: "skill",
    name: "Skill",
    productRole:
      "A reusable `SKILL.md` playbook, bundled or written by the project, that discern makes available to each configured coding agent. The agent reads its full steps only when a job needs them.",
    humanSituation:
      "A hard-won procedure disappears with the session that learned it.",
    doNotImply:
      "A plugin marketplace or an autonomous capability requiring no judgment.",
    docs: {
      firstUse:
        "a **skill**: a ready-made playbook your agent follows for one kind of job",
      reason:
        "A method worked out once reaches every later session, which reads its full steps only when the job needs them.",
    },
    brand: {
      firstUse: "“A reusable agent playbook (a Skill).”",
      interpretation: "A method future agents can inherit and apply.",
      prominence: "Supporting.",
    },
  },
  {
    id: "map",
    name: "Map",
    productRole:
      "Agent-maintained project documentation, mechanically checked and selectively publishable.",
    humanSituation:
      "Delegation increases while the project becomes less legible to its human.",
    doNotImply:
      "That a passing gate proves a page true: the gate checks links, headings, and command examples.",
    docs: {
      firstUse:
        "the **map**: your project's own guide to how it works and why, which your agents write and keep current",
      reason:
        "You can read what your agents understand about the project and correct it before a misunderstanding turns into code.",
    },
    brand: {
      firstUse: "“The project's maintained guide (the Map).”",
      interpretation:
        "A readable account of what the agents understand about the project.",
      prominence: "Yes, in continuity and trust sections.",
    },
  },
  {
    id: "desk",
    name: "Desk",
    productRole:
      "The interactive terminal view that `discern` opens in the main checkout: every task in progress, the actions available for each, and the only place to grant or revoke one task's permission to land.",
    humanSituation:
      "The person needs one calm view over delegated tasks and valid next actions.",
    doNotImply: "A cloud management dashboard or team control plane.",
    docs: {
      firstUse:
        "the **desk**: the interactive view that opens when you run `discern` in your main checkout",
      reason:
        "You see every task in progress, and what you can do with each, in one place.",
    },
    brand: {
      firstUse: "“The human view over work in progress (the Desk).”",
      interpretation: "One place to see and direct the work.",
      prominence: "Product-page supporting object.",
    },
  },
  {
    id: "logbook",
    name: "Logbook",
    productRole: "Local, metadata-only history of discern use.",
    humanSituation:
      "The team or owner remembers friction anecdotally but cannot see recurring practice.",
    doNotImply:
      "Surveillance, remote telemetry, code capture, or employee monitoring.",
    docs: {
      firstUse:
        "the **logbook**: discern's local record of what each command did and how long it took, which never holds your code or command output",
      reason:
        "Your agent can find what keeps slowing work down from the project's history instead of guessing.",
    },
    brand: {
      firstUse:
        "“A local activity record (the Logbook) containing metadata; it excludes code and output.”",
      interpretation: "A private record of how the work has been moving.",
      prominence: "Deeper proof.",
    },
  },
  {
    id: "patterns",
    name: "Patterns",
    productRole:
      "Read-only analysis of local evidence across behavior, gate fit, funnel flow, standards, cohorts, and epochs.",
    humanSituation:
      "The practice needs evidence about how its way of working changes over time.",
    doNotImply:
      "Agent grading, causal certainty, or fair performance ranking across different task mixes.",
    docs: {
      firstUse:
        "the **pattern report**: `discern patterns`, which reads the logbook and reports what keeps happening in your project's work, with the counts behind each finding",
      reason:
        "You can fix the friction that keeps coming back, with counts to show it, before you change how the project works.",
    },
    brand: {
      firstUse:
        "“A practice report that finds recurring friction and trends (Patterns).”",
      interpretation: "See how the way of working changes over time.",
      prominence: "Important secondary pillar.",
    },
  },
  {
    id: "landing",
    name: "Landing",
    productRole:
      "`discern accept` lands one submitted commit that has current Proof and landing authority. It moves the trunk only by fast-forward: when newer work has reached the trunk, discern first checks the combination in an integration worktree and lands what passed. It then removes the task's worktree and branch unless unlanded work remains there.",
    humanSituation:
      "A completed change must become shared without ambiguity about tree or authority.",
    doNotImply:
      "That a passing gate grants permission to land, or that landing releases the change to users.",
    docs: {
      firstUse:
        "**landing**: discern moving a finished change onto the trunk, which it does only with your permission",
      reason:
        "Finishing a task leaves your shared branch unchanged, so you can review the change before it lands.",
    },
    brand: {
      firstUse: "“Accept the exact reviewed change onto the shared branch.”",
      interpretation:
        "A recorded decision that turns verified work into shared work.",
      prominence: "Supporting authority story.",
    },
  },
  {
    id: "landing-authority",
    name: "Landing authority",
    productRole:
      "Permission for a submitted commit to land: the owner's consent in the current conversation, which the agent attests with `discern accept --confirmed`, or a recorded grant that discern checks at the landing boundary. A standing grant covers named scopes, and a one-task grant, recorded from the desk, covers every file in that task.",
    humanSituation:
      "The human wants independence without approving every routine action.",
    doNotImply:
      "Blanket autonomy, consent inferred from an earlier conversation, or a grant that covers a variance, a looser standard limit, or an emergency landing.",
    docs: {
      firstUse:
        "permission to land: your yes in the current conversation, or a **grant**, permission you set up in advance for named areas of the project or for one task",
      reason:
        "Routine changes you don't need to see can land without asking, and everything else comes back to you.",
    },
    brand: {
      firstUse: "“Recorded permission for this task or scope to land.”",
      interpretation: "Define permission once at a meaningful boundary.",
      prominence: "Consent and trust pages.",
    },
  },
  {
    id: "fleet",
    name: "Fleet",
    productRole:
      "All the task worktrees in the project, which the desk and `discern status` show from the main checkout.",
    humanSituation: "Several delegated tasks are moving at once.",
    doNotImply:
      "Enterprise scale, command-and-control surveillance, or uniqueness versus vendor fleets.",
    docs: {
      firstUse:
        "your **fleet**: all the tasks in progress, each in its own worktree",
      reason:
        "You see every task at once, including tasks that changed the same files, before their work combines.",
    },
    brand: {
      firstUse: "“All current tasks in flight (the fleet).”",
      interpretation: "Work in flight across several agents.",
      prominence: "Engineer and agent pages.",
    },
  },
  {
    id: "commission",
    name: "Commission",
    productRole:
      "Brand interpretation of staged, agent-driven setup, which ends when `discern setup done` passes the gate in a throwaway worktree.",
    humanSituation:
      "A project needs a working practice tailored to its repository and intent.",
    doNotImply:
      "A passive installer, instant magic, or zero work by the agent.",
    docs: {
      instead:
        "Call it setup: your agent studies the project, asks the questions only you can answer, and runs the gate in a throwaway worktree before setup counts as complete.",
    },
    brand: {
      firstUse: "“Commission discern for this project.”",
      interpretation:
        "The agent studies, establishes, and proves the project's way of working.",
      prominence: "Yes, especially setup.",
    },
  },
  {
    id: "agent-ergonomics",
    name: "Agent ergonomics",
    productRole:
      "Design discipline for machine operators: bounded context, typed contracts, stable state, callable idempotence, useful refusals, relay-safe prose.",
    humanSituation:
      "Agents waste context and tool calls operating human-oriented software.",
    doNotImply: "An AI model inside discern or a proprietary agent.",
    docs: {
      instead:
        "Say discern is built for your agent to operate: short results name the next step, and a failure comes with the command that reproduces it.",
    },
    brand: {
      firstUse: "“Agent ergonomics: interaction design for coding agents.”",
      interpretation: "Software designed around the machine doing the work.",
      prominence: "Technical and For Agents.",
    },
  },
  {
    id: "provider-independence",
    name: "Provider independence",
    productRole:
      "One project's instructions, skills, and practice, written once for every supported coding agent.",
    humanSituation:
      "Quotas, preferences, capabilities, and availability lead the user to switch agents.",
    doNotImply:
      "Identical provider capability, guaranteed portability of every vendor feature, or permanent quota economics.",
    docs: {
      instead:
        "Name the effect: discern writes the same instructions, from one source, into the file each coding agent reads, so you can switch agents without rewriting them.",
    },
    brand: {
      firstUse: "“One project practice across the coding agents you use.”",
      interpretation: "Change agents without re-teaching the project.",
      prominence: "Yes, current practical benefit.",
    },
  },
  {
    id: "owner",
    name: "Owner",
    productRole:
      "The responsible human who sets intent and authority and carries consequences.",
    humanSituation:
      "Someone must decide what becomes shared and stand behind the result.",
    doNotImply:
      "Corporate “product owner,” legal ownership, management hierarchy, or constant supervision.",
    docs: {
      instead:
        "Address the owner as “you”, and name the decision, such as “you decide whether it lands”.",
    },
    brand: {
      firstUse: "“The person responsible for the project.”",
      interpretation:
        "Express the action or consequence and keep the abstract role backstage.",
      prominence: "Mostly backstage.",
    },
  },
  {
    id: "serious-software",
    name: "Serious software",
    productRole: "A brand territory with no product definition.",
    humanSituation:
      "The software has users, data, revenue, reputation, maintenance, or operational importance.",
    doNotImply:
      "Somber personality, over-engineering, exclusion, or moral superiority.",
    docs: {
      instead:
        "Describe the consequence, such as the people who depend on the app.",
    },
    brand: {
      firstUse: "No technical definition required; show the consequences.",
      interpretation: "Software that deserves and earns confidence.",
      prominence: "Yes, central worldview.",
    },
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
      "a floor may only rise and a ceiling may only fall; loosening either needs the owner's approval of the exact proposal.",
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
      "evidence covers one exact committed tree and its declared gate result.",
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
    title: "Delegate work",
    productTruth:
      "a skill shapes one handoff, internal fan-out, parallel streams, or staged dependencies, with complete briefs, work boundaries, authority, and adversarial review.",
    weakLiteralTranslation: "Multi-agent planning and orchestration.",
    betterHumanTranslations: [
      "Turn a standing backlog into work in flight.",
      "Give several agents complete, non-overlapping responsibilities.",
      "Let dependencies resolve without becoming the courier between sessions.",
      "What comes back has already faced an independent technical pass.",
    ],
  },
  {
    id: "landing",
    title: "Landing",
    productTruth:
      "a passing gate makes a change eligible; landing requires conversational consent or a recorded grant checked at the boundary.",
    weakLiteralTranslation: "Authority-gated fast-forward merge workflow.",
    betterHumanTranslations: [
      "Ready is the Gate's question; shipping is yours.",
      "Nothing lands on an agent's say-so.",
      "Grant independence once, at a boundary you choose.",
    ],
    productNounEntry:
      "Passing the Gate makes a change eligible to land; acceptance is the recorded decision that lands it.",
  },
  {
    id: "patterns",
    title: "Patterns",
    productTruth:
      "named detectors analyze local evidence across behavior, gate fit, funnel, trajectories, providers, and configurations.",
    weakLiteralTranslation: "Local agent workflow analytics.",
    betterHumanTranslations: [
      "See where the practice is improving and where work keeps losing time.",
      "Replace recurring anecdotes with counted evidence.",
      "Compare working patterns at the cohort level and leave agent rankings out.",
    ],
  },
] as const satisfies readonly Translation[];

/** One product-language string and the registry field it came from. */
export interface ProductLanguage {
  readonly origin: string;
  readonly text: string;
}

/**
 * Every product-language string the bridge holds: each concept's product
 * role, limits, and documentation form, and each translation's product truth.
 * These follow the glossary's running-prose casing. The brand forms follow
 * the brand voice instead, so they stay out.
 */
export function productLanguage(): readonly ProductLanguage[] {
  return [
    ...CONCEPTS.flatMap((concept: Concept) => [
      { origin: `${concept.id}.productRole`, text: concept.productRole },
      { origin: `${concept.id}.doNotImply`, text: concept.doNotImply },
      ...Object.entries(concept.docs).map(([field, text]) => ({
        origin: `${concept.id}.docs.${field}`,
        text,
      })),
    ]),
    ...TRANSLATIONS.map((translation: Translation) => ({
      origin: `${translation.id}.productTruth`,
      text: translation.productTruth,
    })),
  ];
}

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

/** The brand drafting procedure's steps, in order. */
export const DRAFTING_PROCEDURE: readonly string[] = [
  "State the exact product truth in product language.",
  "Identify the human moment in which it matters.",
  "Name the burden, risk, or limitation that exists today.",
  "Describe the changed experience in ordinary language.",
  "Decide whether that change deserves public prominence.",
  "Write the human proposition without product nouns.",
  "Reintroduce only the product nouns required to explain or prove it.",
  "Run the line tests in {{doc:messaging}} on any line meant for a public page.",
  "Check the proposed claim against {{doc:claims-and-evidence}}.",
];

/**
 * How documentation uses the concept map: one bolded rule per item, then its
 * explanation. The product register's economy lives here, so a page defines
 * a term briefly, argues for it once, and links to its home.
 */
export const DOCUMENTATION_RULES: readonly string[] = [
  "**Define the term where the page first needs it.** Use the documentation first use, which defines the term by what it's made of in the reader's project, then use the bare term. The first use follows the glossary's casing: it capitalizes Proof, Proof line, and Proof note, and writes every other concept in lowercase. A page that mentions a term only in passing can link to the term's home instead of defining it.",
  "**Give the reason once.** A concept's reason to care is one sentence. Say it where the concept first matters on the page, and only when the reader needs it to decide or act. Later sections use the term without arguing for it again.",
  '**Link to the home instead of re-arguing it.** One page explains each concept in full: the worry it answers, how it works, and where it stops. Other pages give the first use, add the reason only when they need it, and link to that page. `discern docs --search "<term>"` finds it.',
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
  "gives every feature it mentions a story of why it matters, where one reason and a link would do;",
  "anthropomorphises or judges an agent;",
  "implies authority without machine-checkable evidence;",
  "calls a result safe, secure, correct, or complete beyond what the product establishes;",
  "leaves the next valid action ambiguous.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render one concept's block: shared facts, then each register's forms. */
function renderConcept(concept: Concept): string {
  const docs = "instead" in concept.docs
    ? [`**Documentation first use:** None. ${concept.docs.instead}`]
    : [
      `**Documentation first use:** ${concept.docs.firstUse}.`,
      `**Documentation reason:** ${concept.docs.reason}`,
    ];
  return [
    `### ${concept.name}`,
    "",
    bullets([
      `**Product role:** ${concept.productRole}`,
      `**Human situation:** ${concept.humanSituation}`,
      `**Do not imply:** ${concept.doNotImply}`,
      ...docs,
      `**Brand first use:** ${concept.brand.firstUse}`,
      `**Brand interpretation:** ${concept.brand.interpretation}`,
      `**Brand prominence:** ${concept.brand.prominence}`,
    ]),
  ].join("\n");
}

/** Render one translation's section. */
function renderTranslation(translation: Translation): string {
  const parts = [
    `### ${translation.title} in brand copy`,
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
    "**Purpose:** Turn each product fact into a reason to care, in documentation and in brand copy, without letting the product canon dictate the brand's surface style.",
    "",
    "## The register firewall",
    "",
    "A brand line gives someone a reason to want the product. Preserve that invitation when tracing it to product truth: explain the mechanism in the supporting copy and place its relevant limit where the reader needs it. Replacing a strong headline with a contract sentence loses the communication job. Readiness follows the same rule: lead with a recognizable question and the future it serves; keep the evidence distinctions in the account of how the project answers it.",
    "",
    "Every public claim should be traceable backwards:",
    "",
    "> Brand expression → human situation → practical consequence → product mechanism → source of truth",
    "",
    "Only features that help the reader understand or believe the human proposition belong in marketing.",
    "",
    "Use the product canon as evidence after defining the human proposition.",
    "",
    "The fact inventory in {{doc:messaging}} holds pre-cleared lines whose trace to the claims ledger is already recorded; prefer one of those before translating a feature from scratch.",
    "",
    "## Drafting brand copy",
    "",
    "Before writing brand copy about a feature:",
    "",
    ...DRAFTING_PROCEDURE.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Writing documentation",
    "",
    "Documentation, including the manual, CLI text, and tips, writes in the product voice. It takes each concept's documentation first use and reason from the concept map, and checks its claims against “Do not imply”.",
    "",
    bullets(DOCUMENTATION_RULES),
    "",
    "Documentation skips the brand drafting procedure. The manual applies these forms through its [authoring procedure](manual-authoring.md).",
    "",
    `## ${CONCEPT_MAP_HEADING}`,
    "",
    "Each concept starts with the facts both registers share: its product role, the human situation it answers, and what it must not imply. The documentation fields serve the product voice, and the brand fields serve the brand voice.",
    "",
    "Keep each form in its own register. A brand first use can capitalize a named product object, such as the Gate, where documentation writes it in lowercase. A documentation first use leads with the mechanism, which a marketing page brings in only after the reader has a reason to care.",
    "",
    CONCEPTS.map(renderConcept).join("\n\n"),
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
