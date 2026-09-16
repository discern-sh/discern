/**
 * Readiness questions connect a person's concern to the practice that can
 * help answer it. They describe uses of existing features, not additional
 * runtime checks. Stable question ids serve both the canon and future
 * question-led discovery surfaces (ADR 0392).
 */
import { renderMarkdownHtml } from "../../src/lib/markdown.ts";

/** The contribution a feature makes; these are routes, not result states. */
export type ReadinessContribution =
  | "Project checks"
  | "Declared judgment"
  | "Advisory evidence"
  | "Taught method"
  | "Project knowledge"
  | "Completion evidence"
  | "Landing authority";

interface ReadinessRoute {
  readonly contribution: ReadinessContribution;
  /** Brand register: the reason someone would want this feature in the work. */
  readonly invitation: string;
  /** The concrete part this feature plays in answering its linked questions. */
  readonly how: string;
  /** Repository-relative documentation link, including a section anchor when useful. */
  readonly doc: string;
  readonly humanBenefit: string;
  readonly agentBenefit: string;
}

/** Keys are feature-canon identities. Titles and benefit prose stay there. */
export const READINESS_ROUTES = {
  gate: {
    invitation: "Make done mean something you can rely on.",
    how:
      "The Gate runs the checks the project declares before recording completion, giving testable acceptance criteria a repeatable place in the work.",
    contribution: "Project checks",
    doc: "project/manual/10-guides/finish-and-land-a-change.md",
    humanBenefit: "project-defined-completion",
    agentBenefit: "run-the-relevant-gate-efficiently",
  },
  checkpoints: {
    invitation:
      "Bring your judgment into the change while it can still shape the work.",
    how:
      "A project checkpoint pairs a relevant change with a written review question and records the agent's conclusion, including any unmet condition that needs an owner decision.",
    contribution: "Declared judgment",
    doc: "project/manual/20-understand/checkpoints.md",
    humanBenefit: "judgment-at-the-change",
    agentBenefit: "carry-judgment-as-judgment",
  },
  coupling: {
    invitation: "Follow the change beyond the files already in front of you.",
    how:
      "Coupling uses Git history to name files that habitually change together, giving the agent concrete companions to investigate while the change is open.",
    contribution: "Advisory evidence",
    doc: "project/map/20-quality-gate/coupling.md",
    humanBenefit: "catch-related-files",
    agentBenefit: "diagnose-workflow-friction-locally",
  },
  "skill-cure-a-bug": {
    invitation: "Let this fix outlast this defect.",
    how:
      "The skill teaches the agent to prove the cause, find the defect class, and leave a guard that covers future instances.",
    contribution: "Taught method",
    doc: "project/manual/10-guides/create-and-manage-skills.md",
    humanBenefit: "remove-bug-class",
    agentBenefit: "invoke-curated-project-procedures",
  },
  "skill-write-it-once": {
    invitation: "Make the next change easier to get right.",
    how:
      "The skill teaches one authority per fact, guards that include future members, and effects planned before execution; the agent applies those methods to shared data, retries, and interrupted work.",
    contribution: "Taught method",
    doc: "project/manual/10-guides/create-and-manage-skills.md",
    humanBenefit: "reuse-engineering-discipline",
    agentBenefit: "invoke-curated-project-procedures",
  },
  standards: {
    invitation: "Keep the gains you worked for.",
    how:
      "A project supplies a repeatable measurement and a defensible limit; Standards hold that limit against regressions in memory, calls, cost, or another property the measurement represents.",
    contribution: "Project checks",
    doc: "project/manual/20-understand/standards.md",
    humanBenefit: "retain-measured-gains",
    agentBenefit: "retain-earned-quality",
  },
  "skill-clear-the-decks": {
    invitation: "Leave room for the next idea.",
    how:
      "The cleanup skill teaches the agent to find accumulated clutter, prove each removal safe, and retain a measured limit where recurring clutter can be counted.",
    contribution: "Taught method",
    doc: "project/manual/10-guides/create-and-manage-skills.md",
    humanBenefit: "keep-clutter-down",
    agentBenefit: "invoke-curated-project-procedures",
  },
  "adr-discipline": {
    invitation: "Keep the reason within reach of the next decision.",
    how:
      "Decision records preserve significant choices, alternatives, and reasons in the project, with an index that later maintainers and agents can follow.",
    contribution: "Project knowledge",
    doc: "project/manual/20-understand/instructions-skills-and-map.md",
    humanBenefit: "preserve-decision-reasons",
    agentBenefit: "recover-the-project-mental-model",
  },
  map: {
    invitation: "Give the next person somewhere useful to start.",
    how:
      "The Map explains boundaries and workflows with evidence, linking the relevant procedures, checks, and decisions. It preserves context for data handling, recovery, compatibility, and release work where the project needs it.",
    contribution: "Project knowledge",
    doc: "project/manual/20-understand/instructions-skills-and-map.md",
    humanBenefit: "inspect-agent-understanding",
    agentBenefit: "recover-the-project-mental-model",
  },
  instructions: {
    invitation: "Let your expectations reach every agent who joins the work.",
    how:
      "Project instructions carry architectural boundaries and supported-environment policies into the compiled instructions each coding agent receives.",
    contribution: "Project knowledge",
    doc: "project/manual/10-guides/write-project-instructions.md",
    humanBenefit: "teach-project-once",
    agentBenefit: "inherit-current-agent-instructions",
  },
  "skill-delegate-work": {
    invitation: "Give ambition a brief someone can finish.",
    how:
      "The delegation skill teaches complete task briefs with intended outcomes, scope, and acceptance criteria, followed by review of what returns.",
    contribution: "Taught method",
    doc: "project/manual/10-guides/delegate-work.md",
    humanBenefit: "shape-substantial-work",
    agentBenefit: "invoke-curated-project-procedures",
  },
  proof: {
    invitation: "Know what stands behind the work that comes back.",
    how:
      "Proof binds the recorded completion evidence to the validated change, so a reviewer can compare what was established with the questions the release still raises.",
    contribution: "Completion evidence",
    doc: "project/manual/20-understand/proof.md",
    humanBenefit: "evidence-for-this-change",
    agentBenefit: "prove-the-exact-tree",
  },
  accept: {
    invitation: "Keep the decision to land in the right hands.",
    how:
      "Acceptance checks authority for the actual landing diff, including a combined result, and requires the owner's authorization for the current unmet checkpoint set. Waiting for a landing turn keeps the submitted revision fixed.",
    contribution: "Landing authority",
    doc: "project/manual/10-guides/finish-and-land-a-change.md",
    humanBenefit: "explicit-release-decision",
    agentBenefit: "land-only-with-release-authority",
  },
  "scope-gates": {
    invitation:
      "Give each part of the project the attention its changes deserve.",
    how:
      "Scopes connect changed paths to project-defined checks, letting a workflow's regression checks run when its part of the repository changes.",
    contribution: "Project checks",
    doc: "project/map/20-quality-gate/README.md",
    humanBenefit: "run-relevant-checks",
    agentBenefit: "see-the-change-discern-sees",
  },
  "jobs-table": {
    invitation: "Put the checks your project needs into its everyday practice.",
    how:
      "Declared jobs give the project's tests, analysis, and specialist tools a shared command table, including checks for sensitive output or release configuration.",
    contribution: "Project checks",
    doc: "project/manual/30-reference/config-reference.md#jobs",
    humanBenefit: "project-defined-completion",
    agentBenefit: "run-the-relevant-gate-efficiently",
  },

  "generated-artifact-declarations": {
    invitation: "Change the source and bring its copies with it.",
    how:
      "Generated artifact declarations name which committed files a generator owns and how to regenerate them, keeping derived files connected to the source the project chose.",
    contribution: "Project checks",
    doc: "project/manual/30-reference/config-reference.md#generatedname",
    humanBenefit: "catch-documentation-breakage",
    agentBenefit: "use-a-fast-inner-loop",
  },
  "producer-evidence": {
    invitation: "See the checks behind the confidence.",
    how:
      "Validation results name the producers executed or reused, their input binding, and the reason for reuse, so a reviewer can see how the current result obtained its evidence.",
    contribution: "Completion evidence",
    doc: "project/map/20-quality-gate/complete-evidence.md",
    humanBenefit: "reduce-routine-review",
    agentBenefit: "prove-the-exact-tree",
  },
  "map-freshness": {
    invitation: "Find the explanation that needs another look.",
    how:
      "When source files change, discern points agents to the Map pages that explain them, helping each session find its way around the project and keep that shared understanding current.",
    contribution: "Advisory evidence",
    doc: "project/manual/20-understand/instructions-skills-and-map.md",
    humanBenefit: "inspect-agent-understanding",
    agentBenefit: "recover-the-project-mental-model",
  },
  "impact": {
    invitation: "See which parts of the project your change reaches.",
    how:
      "Impact names the configured scopes touched by the change, giving the agent a concrete starting point for comparing repository changes with the agreed brief.",
    contribution: "Advisory evidence",
    doc: "project/map/20-quality-gate/README.md",
    humanBenefit: "run-relevant-checks",
    agentBenefit: "see-the-change-discern-sees",
  },
  "proof-notes": {
    invitation: "Keep the evidence with the code people will build on.",
    how:
      "After landing, a Proof note retains the structured completion record on the landed trunk commit, making the evidence findable beyond the session that produced it.",
    contribution: "Completion evidence",
    doc: "project/map/20-quality-gate/proof-notes.md",
    humanBenefit: "evidence-that-lasts",
    agentBenefit: "prove-the-exact-tree",
  },
  "integration-landings": {
    invitation: "Let finished work join a project that keeps moving.",
    how:
      "When other work lands first, discern combines the submitted change with the current trunk in an owned integration worktree and proves that result before landing. The resulting Proof keeps the submitted source and the tested combination distinct.",
    contribution: "Completion evidence",
    doc: "project/manual/10-guides/finish-and-land-a-change.md",
    humanBenefit: "land-finished-work-as-the-project-moves",
    agentBenefit: "prove-the-exact-tree",
  },
} as const satisfies Readonly<Record<string, ReadinessRoute>>;

export type ReadinessRouteId = keyof typeof READINESS_ROUTES;

export interface ReadinessQuestion {
  readonly id: string;
  readonly question: string;
  /** First route is the question's primary discovery destination. */
  readonly routes: readonly [ReadinessRouteId, ...ReadinessRouteId[]];
  /** A practical way to use today's mechanism to investigate this question. */
  readonly approach: string;
}

export interface ReadinessFamily {
  readonly id: string;
  readonly title: string;
  readonly role: "framing" | "concern" | "evidence" | "authority";
  /** Brand register: the future the person wants for this part of the work. */
  readonly promise: string;
  readonly applies: string;
  readonly questions: readonly ReadinessQuestion[];
}

/** The founder's readiness questions, grouped for consideration and discovery. */
export const READINESS_CANON: readonly ReadinessFamily[] = [
  {
    id: "readiness-intent",
    title: "Intent",
    role: "framing",
    promise: "Bring back the thing you set out to build.",
    applies:
      "Frame every effort with its purpose, acceptance criteria, and agreed scope.",
    questions: [
      {
        id: "solve-the-requested-problem",
        question: "Does this solve the problem we asked it to solve?",
        routes: ["skill-delegate-work", "checkpoints"],
        approach:
          "Put the intended outcome in the brief, then review the working result against it.",
      },
      {
        id: "meet-acceptance-criteria",
        question: "Are the acceptance criteria met?",
        routes: ["gate", "checkpoints"],
        approach:
          "Turn testable criteria into project checks and exercise the criteria that need judgment against the result.",
      },
      {
        id: "stay-within-agreed-scope",
        question: "Did anything outside the agreed scope change?",
        routes: ["impact", "checkpoints", "skill-delegate-work"],
        approach:
          "Compare the changed work with the brief; record and resolve any expansion of scope.",
      },
    ],
  },
  {
    id: "readiness-behavior",
    title: "Behavior",
    role: "concern",
    promise: "Build for the ways people will really use it.",
    applies:
      "Consider changed inputs, state transitions, failure paths, and repeatable actions.",
    questions: [
      {
        id: "handle-input-extremes",
        question:
          "What happens with empty, invalid, or unusually large inputs?",
        routes: ["gate"],
        approach:
          "Add representative boundary cases to the project's tests and include those tests in its declared checks.",
      },
      {
        id: "recover-after-failure",
        question: "Do failures leave the system in a recoverable state?",
        routes: ["skill-write-it-once", "gate"],
        approach:
          "Plan the operation's effects, interrupt it at meaningful boundaries, and test the recovery path.",
      },
      {
        id: "retry-without-duplicate-effects",
        question:
          "Does retrying repeat an action that should happen only once?",
        routes: ["skill-write-it-once", "gate"],
        approach:
          "Define what a repeat should do and test retries after success, partial completion, and uncertain outcomes.",
      },
    ],
  },
  {
    id: "readiness-regression",
    title: "Regression",
    role: "concern",
    promise: "Keep the workflows people count on.",
    applies:
      "Review established workflows, companion changes, and the recurrence of a repaired defect.",
    questions: [
      {
        id: "preserve-existing-workflows",
        question: "Do existing workflows still work?",
        routes: ["gate", "scope-gates", "integration-landings"],
        approach:
          "Run the project's workflow tests, including the checks selected for the affected parts of the project.",
      },
      {
        id: "check-related-places",
        question: "Have we checked the other places affected by this change?",
        routes: ["coupling", "scope-gates"],
        approach:
          "Use repository co-change history to find habitual companion files, then investigate whether they need attention in this change.",
      },
      {
        id: "guard-against-recurrence",
        question: "Is there a guard against this defect returning?",
        routes: ["skill-cure-a-bug", "gate"],
        approach:
          "Prove the cause, identify the defect class, and leave a practical guard that enrolls future members.",
      },
    ],
  },
  {
    id: "readiness-usability",
    title: "Usability",
    role: "concern",
    promise: "Make the next step feel obvious.",
    applies:
      "Exercise changed workflows with the people and circumstances they serve.",
    questions: [
      {
        id: "complete-without-explanation",
        question: "Can someone complete the task without explanation?",
        routes: ["checkpoints"],
        approach:
          "Observe someone attempting the task and use a project checkpoint to review what the exercise established.",
      },
      {
        id: "make-interface-states-useful",
        question: "Are loading, empty, and error states useful?",
        routes: ["checkpoints", "gate"],
        approach:
          "Exercise each state in the working interface; keep repeatable behavior checks in the test suite.",
      },
      {
        id: "recover-from-a-mistake",
        question: "Can they recover from a mistake?",
        routes: ["checkpoints", "gate"],
        approach:
          "Try cancellation, correction, and undo where they apply, and review whether the next action is understandable.",
      },
    ],
  },
  {
    id: "readiness-accessibility",
    title: "Accessibility",
    role: "concern",
    promise: "Welcome more people into what you have built.",
    applies:
      "Review changed interaction, navigation, content, and presentation with the relevant assistive tools.",
    questions: [
      {
        id: "complete-with-a-keyboard",
        question: "Can the workflow be completed with a keyboard?",
        routes: ["checkpoints", "gate"],
        approach:
          "Exercise the full keyboard path, including focus and recovery, and automate the interactions the project can test reliably.",
      },
      {
        id: "make-sense-to-a-screen-reader",
        question: "Does it make sense to a screen reader?",
        routes: ["checkpoints"],
        approach:
          "Exercise the workflow with a screen reader and record the tools, scenario, and findings used in the judgment.",
      },
      {
        id: "communicate-beyond-color",
        question:
          "Is essential information available without relying on color?",
        routes: ["checkpoints", "jobs-table"],
        approach:
          "Review labels, symbols, and state changes; use configured analysis for the properties a tool can check.",
      },
    ],
  },
  {
    id: "readiness-compatibility",
    title: "Compatibility",
    role: "concern",
    promise: "Take the people who already depend on you forward.",
    applies:
      "Consult the project's supported environments, clients, and saved-data contracts.",
    questions: [
      {
        id: "work-on-supported-environments",
        question: "Does this work on the devices and browsers we support?",
        routes: ["gate", "instructions"],
        approach:
          "Record the supported environments and run the project's checks on them, identifying any device checks still needed.",
      },
      {
        id: "preserve-existing-api-clients",
        question: "Can existing clients still use the API?",
        routes: ["gate", "checkpoints"],
        approach:
          "Test the supported client contracts and review any intended break against the project's compatibility policy.",
      },
      {
        id: "open-older-saved-data",
        question: "Will older saved data still open?",
        routes: ["gate"],
        approach:
          "Keep representative saved records from supported versions and exercise them through the current reader or migration.",
      },
    ],
  },
  {
    id: "readiness-data-integrity",
    title: "Data integrity",
    role: "concern",
    promise: "Keep people's work intact as your software grows.",
    applies:
      "Examine writes, deletion, import, migration, and recovery involving persistent data.",
    questions: [
      {
        id: "avoid-data-loss-or-duplication",
        question: "Could this lose or duplicate data?",
        routes: ["skill-write-it-once", "gate"],
        approach:
          "State the data invariants before planning writes, then test conflicting, repeated, and interrupted operations.",
      },
      {
        id: "preserve-records-through-migration",
        question: "Does the migration preserve existing records?",
        routes: ["gate", "checkpoints"],
        approach:
          "Exercise the migration on representative records and inspect the preservation properties the automated checks do not establish.",
      },
      {
        id: "survive-partial-completion",
        question: "What happens if the operation stops halfway?",
        routes: ["skill-write-it-once", "gate"],
        approach:
          "Identify durable boundaries and test interruption and recovery at each meaningful stage.",
      },
    ],
  },
  {
    id: "readiness-security",
    title: "Security",
    role: "concern",
    promise: "Build for the trust people place in your software.",
    applies:
      "Review changed access boundaries, sensitive data paths, and exposed interfaces.",
    questions: [
      {
        id: "enforce-permissions-at-the-boundary",
        question: "Are permissions enforced at the right boundary?",
        routes: ["checkpoints", "gate"],
        approach:
          "Review where access decisions happen and run project tests that attempt the protected operations directly.",
      },
      {
        id: "isolate-account-data",
        question: "Can one account access another account’s data?",
        routes: ["gate", "checkpoints"],
        approach:
          "Exercise cross-account requests using realistic identities and review the data boundary those tests cover.",
      },
      {
        id: "keep-secrets-out-of-diagnostics",
        question: "Could secrets appear in logs or error messages?",
        routes: ["jobs-table", "gate", "checkpoints"],
        approach:
          "Inspect failure output and configure secret detection or output assertions suited to the project's data paths.",
      },
    ],
  },
  {
    id: "readiness-privacy",
    title: "Privacy",
    role: "concern",
    promise: "Keep the promises that made people comfortable saying yes.",
    applies:
      "Review changes to collection, retention, deletion, data sharing, and stated commitments.",
    questions: [
      {
        id: "collect-only-needed-data",
        question: "Are we collecting only the data we need?",
        routes: ["checkpoints", "map"],
        approach:
          "Review each collected field against its purpose and keep the project's data-flow account current.",
      },
      {
        id: "honor-deletion-expectations",
        question: "Does deletion remove what users expect it to remove?",
        routes: ["gate", "checkpoints"],
        approach:
          "Test the deletion path across relevant stores and review retention and recovery behavior against the user-facing promise.",
      },
      {
        id: "keep-privacy-commitments-current",
        question: "Have the stated privacy commitments remained accurate?",
        routes: ["checkpoints", "map-freshness", "map"],
        approach:
          "Compare changed data behavior with published commitments and update the affected explanations.",
      },
    ],
  },
  {
    id: "readiness-efficiency",
    title: "Efficiency",
    role: "concern",
    promise: "Let the project grow without wasting what it needs to run.",
    applies:
      "Measure changed resource use with representative workloads and environments.",
    questions: [
      {
        id: "hold-memory-use",
        question: "Has memory use increased?",
        routes: ["standards"],
        approach:
          "Measure memory under a repeatable workload and capture a defensible ceiling as a project Standard.",
      },
      {
        id: "avoid-unnecessary-calls",
        question: "Are we making unnecessary network or database calls?",
        routes: ["standards", "checkpoints"],
        approach:
          "Measure calls for the affected workflow and review whether each call serves a necessary purpose.",
      },
      {
        id: "understand-realistic-running-cost",
        question: "What does this cost under realistic usage?",
        routes: ["standards", "checkpoints"],
        approach:
          "Provide a project measurement using realistic usage and current service prices, and review the assumptions behind it.",
      },
    ],
  },
  {
    id: "readiness-architecture",
    title: "Architecture",
    role: "concern",
    promise: "Build something the next idea can fit into.",
    applies:
      "Review new dependencies between components, shared facts, and abstractions.",
    questions: [
      {
        id: "respect-project-boundaries",
        question: "Does this respect the project’s boundaries?",
        routes: ["instructions", "checkpoints", "gate"],
        approach:
          "Carry the boundaries in project instructions, test mechanical rules, and review decisions that need architectural judgment.",
      },
      {
        id: "keep-one-source-of-truth",
        question: "Have we introduced a second source of truth?",
        routes: ["skill-write-it-once", "generated-artifact-declarations"],
        approach:
          "Identify the authority for each shared fact and bind its consumers through derivation, generation, or a guard.",
      },
      {
        id: "justify-an-abstraction",
        question: "Does the new abstraction earn its complexity?",
        routes: ["checkpoints", "adr-discipline"],
        approach:
          "Review the actual callers and alternatives; record a significant tradeoff where future work can find its reasons.",
      },
    ],
  },
  {
    id: "readiness-maintainability",
    title: "Maintainability",
    role: "concern",
    promise: "Leave the next person a project they can take further.",
    applies:
      "Consider the next maintainer's understanding, the cost of change, and leftover scaffolding.",
    questions: [
      {
        id: "make-the-next-change-understandable",
        question: "Can the next person understand and change this?",
        routes: ["map", "map-freshness", "checkpoints"],
        approach:
          "Keep the project's explanation current and review whether someone can locate the relevant behavior and decisions.",
      },
      {
        id: "remove-temporary-scaffolding",
        question: "Have temporary scaffolding and dead code been removed?",
        routes: ["skill-clear-the-decks"],
        approach:
          "Apply the cleanup playbook, prove each cut safe, and retain a useful limit on recurring clutter.",
      },
      {
        id: "record-important-decisions",
        question: "Is the important decision recorded somewhere durable?",
        routes: ["adr-discipline"],
        approach:
          "Record significant decisions and their reasons in the project's decision records, linked from the affected subsystem.",
      },
    ],
  },
  {
    id: "readiness-dependencies",
    title: "Dependencies",
    role: "concern",
    promise: "Choose foundations you can keep building on.",
    applies:
      "Review a new or changed package, service, or other external dependency.",
    questions: [
      {
        id: "justify-a-dependency",
        question: "Do we need this dependency?",
        routes: ["checkpoints", "adr-discipline"],
        approach:
          "Compare the dependency with the project's actual need and record consequential adoption choices.",
      },
      {
        id: "assess-dependency-maintenance",
        question: "Is its maintenance situation acceptable?",
        routes: ["checkpoints"],
        approach:
          "Inspect current maintenance evidence, supported versions, and the project's ability to replace or maintain the dependency.",
      },
      {
        id: "handle-dependency-unavailability",
        question: "What happens if the service or package becomes unavailable?",
        routes: ["gate", "checkpoints"],
        approach:
          "Exercise the relevant unavailable-service or failed-install scenario and review fallback and recovery choices.",
      },
    ],
  },
  {
    id: "readiness-release",
    title: "Release readiness",
    role: "concern",
    promise: "Carry the work from your machine into people's hands.",
    applies:
      "Assess the target release environment, deployment sequence, and rollback plan.",
    questions: [
      {
        id: "deploy-with-current-configuration",
        question: "Can this be deployed with the current configuration?",
        routes: ["jobs-table", "checkpoints"],
        approach:
          "Configure checks against the intended release environment and review the configuration and prerequisites they depend on.",
      },
      {
        id: "sequence-the-rollout",
        question: "Does the rollout need a particular order?",
        routes: ["checkpoints", "map"],
        approach:
          "Record the deployment dependencies and have the release review assess their sequence before execution.",
      },
      {
        id: "roll-back-without-data-damage",
        question: "Can we roll back without damaging data?",
        routes: ["gate", "checkpoints"],
        approach:
          "Exercise the proposed rollback with representative data and review changes whose effects cannot be reversed.",
      },
    ],
  },
  {
    id: "readiness-operations",
    title: "Operations",
    role: "concern",
    promise: "Be ready to look after what you launch.",
    applies:
      "Review changed runtime failures, observability, diagnostics, and recovery procedures.",
    questions: [
      {
        id: "notice-runtime-failure",
        question: "Will we know when this fails?",
        routes: ["gate", "checkpoints"],
        approach:
          "Exercise failure scenarios and check the project's monitoring and alerts with the people who will respond.",
      },
      {
        id: "make-diagnostics-actionable",
        question: "Will the diagnostic tell us what to do?",
        routes: ["checkpoints", "gate"],
        approach:
          "Review the diagnostic beside a real failure and test stable details such as the failure location and recovery action.",
      },
      {
        id: "exercise-operational-recovery",
        question: "Has recovery been exercised?",
        routes: ["gate", "map"],
        approach:
          "Rehearse the recovery procedure, preserve the evidence, and keep the operational instructions aligned with what worked.",
      },
    ],
  },
  {
    id: "readiness-communication",
    title: "Communication",
    role: "concern",
    promise: "Bring people with you as the product changes.",
    applies:
      "Consider the people whose workflows, expectations, or support responsibilities change.",
    questions: [
      {
        id: "inform-affected-users",
        question: "Do affected users need to know?",
        routes: ["checkpoints"],
        approach:
          "Review the effect on people's work and decide what communication belongs with the change.",
      },
      {
        id: "explain-breaking-changes",
        question: "Are breaking changes explained?",
        routes: ["checkpoints", "map"],
        approach:
          "Review the migration instructions and release explanation against the actual compatibility change.",
      },
      {
        id: "prepare-support-for-the-change",
        question: "Can support answer the questions this change will create?",
        routes: ["checkpoints", "map", "map-freshness"],
        approach:
          "Walk through likely user questions and review the support material with the people who will use it.",
      },
    ],
  },
  {
    id: "readiness-evidence",
    title: "Evidence",
    role: "evidence",
    promise: "Have something to stand behind when the work comes back.",
    applies:
      "Qualify every readiness conclusion with the evidence and conditions that support it.",
    questions: [
      {
        id: "run-the-relevant-checks",
        question: "Were the relevant checks actually run?",
        routes: [
          "producer-evidence",
          "proof",
          "scope-gates",
          "integration-landings",
        ],
        approach:
          "Read the completion evidence for the declared checks and compare their scope with the concerns this change raises.",
      },
      {
        id: "bind-results-to-this-version",
        question: "Do their results belong to this version?",
        routes: [
          "proof",
          "producer-evidence",
          "proof-notes",
          "integration-landings",
        ],
        approach:
          "Check the tested commit and evidence identity. For an integrated landing, distinguish the submitted source from the combined result; external exercises also need their tested version and environment recorded.",
      },
      {
        id: "name-what-remains-unverified",
        question: "What remains unverified?",
        routes: ["proof", "checkpoints"],
        approach:
          "Compare the relevant questions with the evidence available and state the missing checks or unresolved judgments.",
      },
    ],
  },
  {
    id: "readiness-authority",
    title: "Authority",
    role: "authority",
    promise: "Keep the call that matters yours.",
    applies:
      "Resolve permission for the intended next action, separately from what the evidence establishes.",
    questions: [
      {
        id: "identify-required-approval",
        question: "Does this require someone’s approval?",
        routes: ["accept"],
        approach:
          "For landing, use discern's checked consent or recorded grant; identify any separate release or organizational approvals.",
      },
      {
        id: "identify-an-exception",
        question: "Is an exception being made?",
        routes: ["checkpoints", "accept"],
        approach:
          "Declare an unmet checkpoint with its reason and keep the exception visible at the landing decision.",
      },
      {
        id: "authorize-the-exception",
        question: "Has the responsible person accepted that exception?",
        routes: ["accept", "checkpoints"],
        approach:
          "Obtain the responsible person's authorization for the current unmet checkpoint set before landing; a standing grant does not cover the variance.",
      },
    ],
  },
];

/** Flatten without maintaining a second question list. */
export function allReadinessQuestions(
  families: readonly ReadinessFamily[] = READINESS_CANON,
): readonly ReadinessQuestion[] {
  return families.flatMap((family) => family.questions);
}

/** The same question-to-feature relationship, read from the feature end. */
export function readinessForFeature(
  featureId: string,
  families: readonly ReadinessFamily[] = READINESS_CANON,
): readonly {
  family: ReadinessFamily;
  question: ReadinessQuestion;
  primary: boolean;
}[] {
  return families.flatMap((family) =>
    family.questions.flatMap((question) =>
      question.routes.some((route) => route === featureId)
        ? [{ family, question, primary: question.routes[0] === featureId }]
        : []
    )
  );
}

/** A title becomes a link using the same heading renderer as the map. */
export function canonLink(
  page: string,
  heading: string,
  label = heading,
): string {
  const id = renderMarkdownHtml(`### ${heading}`).headings[0]?.id;
  if (id === undefined) {
    throw new Error(`No readiness citation heading: ${heading}`);
  }
  return `[${label}](${page}#${id})`;
}
