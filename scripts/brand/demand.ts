/**
 * The demand canon — the market-side counterpart of the Human Benefit Canon
 * (ADR 0292). Where a benefit reasons forward from product facts to human
 * value, a demand entry reasons backward from a struggling moment somebody
 * is hypothesized to be in: the trigger situation, what they do about it
 * today, and what it costs them. Demand claims are empirical rather than
 * deductive, so every entry carries dated evidence restricted to the claims
 * ledger's market classes (corroborated, observational, anecdotal,
 * hypothesis) — a
 * struggling moment can never borrow the certainty of a product fact.
 * Its language addresses the person and describes the state of the work or
 * workflow; it never casts the person as the agents' minder (ADR 0244).
 *
 * Coverage runs in both directions, mirroring the Human Benefit Canon's guard:
 * every benefit is answered by at least one entry or recorded as a
 * supply-push bet in `SUPPLY_PUSH_RECORDS`, and every entry names the
 * benefits that answer it or records a gap. `tests/demand_canon_test.ts`
 * holds both directions. The generated page compiles into
 * `project/map/_internal/brand/demand-canon.md` through the brand registry.
 */

import {
  allHumanBenefitEntries,
  HUMAN_BENEFIT_CANON,
  type HumanBenefitAudience,
} from "../feature_registry.ts";
import { annotateProse } from "../canon_editor/annotation.ts";
import type { EvidenceClass } from "./model.ts";

/**
 * The evidence classes demand claims may carry: the claims ledger's
 * vocabulary below the product-truth classes. `structural` and
 * `demonstrated` describe the product and can never describe the market.
 */
export const DEMAND_EVIDENCE_CLASS_NAMES = [
  "corroborated",
  "observational",
  "anecdotal",
  "hypothesis",
] as const satisfies readonly EvidenceClass[];

export type DemandEvidenceClass = (typeof DEMAND_EVIDENCE_CLASS_NAMES)[number];

/**
 * What a moment does to the person, after the four forces of progress:
 * `push` drives them to seek help, `pull` attracts them to a new practice,
 * `anxiety` makes them hesitate over it, and `habit` holds them to the
 * current way. Anxiety and habit entries are the objections copy must
 * answer.
 */
export const DEMAND_FORCES = ["push", "pull", "anxiety", "habit"] as const;

export type DemandForce = (typeof DEMAND_FORCES)[number];

/** A human segment demand can be attributed to. Agents mediate adoption but
 * do not struggle, so the coding-agent audience carries no demand entries. */
export type DemandSegment = HumanBenefitAudience;

/** One public item in a corroborated qualitative corpus. */
export interface DemandPublicSource {
  /** The publishing venue; the corpus guard rejects a one-community set. */
  readonly venue: string;
  /** A short descriptive label for the account. */
  readonly title: string;
  /** The canonical public HTTPS location. */
  readonly url: string;
}

interface DemandEvidenceBase {
  /** Where the belief comes from, stated honestly — a complete sentence. */
  readonly source: string;
  /** The date the evidence was recorded, `YYYY-MM-DD`. */
  readonly date: string;
}

/** A corpus-backed market pattern, with its public-use boundary attached. */
export interface CorroboratedDemandEvidence extends DemandEvidenceBase {
  readonly class: "corroborated";
  /** At least three distinct accounts, spanning at least two venues. */
  readonly publicSources: readonly [
    DemandPublicSource,
    DemandPublicSource,
    DemandPublicSource,
    ...DemandPublicSource[],
  ];
  /** What this qualitative corpus does not establish. */
  readonly limits: string;
}

/** Internal observation, a permitted anecdote, or an untested hypothesis. */
export interface NonCorroboratedDemandEvidence extends DemandEvidenceBase {
  readonly class: Exclude<DemandEvidenceClass, "corroborated">;
  readonly publicSources?: never;
  readonly limits?: never;
}

/** One dated piece of evidence behind a demand entry. */
export type DemandEvidence =
  | CorroboratedDemandEvidence
  | NonCorroboratedDemandEvidence;

/**
 * What answers the entry: the benefit ids that address the struggle
 * (checked against the Human Benefit Canon by the guard), or a recorded gap — a
 * demand with no benefit home, kept as roadmap signal rather than deleted.
 */
export type DemandAnswer =
  | {
    readonly benefits: readonly [string, ...string[]];
    readonly gap?: never;
  }
  | { readonly benefits?: never; readonly gap: string };

/** One demand entry: a recurring struggling moment, evidence-tagged. */
export interface DemandEntry {
  /** Stable kebab-case id, unique across the demand and benefit canons. */
  readonly id: string;
  /** The struggling moment in ordinary language — no trailing period. */
  readonly title: string;
  /** The trigger situation, told from the person's side. */
  readonly situation: string;
  /** What they do about it today — the alternative any benefit must beat. */
  readonly alternative: string;
  /** What the situation costs them, in their own ledger. */
  readonly cost: string;
  readonly forces: readonly [DemandForce, ...DemandForce[]];
  readonly segments: readonly [DemandSegment, ...DemandSegment[]];
  readonly evidence: readonly [DemandEvidence, ...DemandEvidence[]];
  readonly answer: DemandAnswer;
}

/** One territory: a family of struggling moments countering one benefit
 * cluster. */
export interface DemandTerritory {
  /** Stable kebab-case id, unique across the demand and benefit canons. */
  readonly id: string;
  /** The territory's shared struggle in ordinary language — no period. */
  readonly title: string;
  /** The benefit-cluster id this territory is the demand side of. */
  readonly counterpart: string;
  /** The tension every entry below is a specific form of. */
  readonly tension: string;
  /** Pre-contact market language: what the struggle sounds like before the
   * person knows any product vocabulary. Hypothesis until observed. */
  readonly heardAs: readonly [string, ...string[]];
  readonly entries: readonly [DemandEntry, ...DemandEntry[]];
}

/** The situation every territory is a form of — the demand-side center. */
export const DEMAND_CANON_SITUATION =
  "One person is responsible for a project whose implementation increasingly arrives from coding agents.";

/** The demand canon's master tension: the struggle every territory shares. */
export const DEMAND_CANON_TENSION =
  "More implementation is moving than the person can personally follow, and everything currently holding it together — status, memory, verification, coordination — is them.";

const RECORDED = "2026-08-17";

/** The seed's shared evidence rows, named once so sources stay consistent. */
const FROM_POSITIONING: DemandEvidence = {
  class: "hypothesis",
  source:
    "Transposed from the positioning document's human-tension account; not yet tested outside this repository.",
  date: RECORDED,
};

const FROM_AUDIENCES: DemandEvidence = {
  class: "hypothesis",
  source:
    "Transposed from the audiences document's desired-progress and objections accounts; not yet tested outside this repository.",
  date: RECORDED,
};

const FROM_DISCOURSE: DemandEvidence = {
  class: "hypothesis",
  source:
    "A recurring theme in public discussion of agent-assisted development; no attributed instances collected yet.",
  date: RECORDED,
};

const OPERATING_LAYER_CORROBORATION: DemandEvidence = {
  class: "corroborated",
  source:
    "An artifact-backed founder account and independent public accounts describe planning, review, status, or coordination becoming limiting work as concurrent agent activity rises.",
  date: "2026-09-01",
  publicSources: [
    {
      venue: "Reddit",
      title: "Experienced developers discuss multi-agent limits",
      url:
        "https://www.reddit.com/r/ExperiencedDevs/comments/1ten4yg/how_do_you_cope_with_multi_agent_workflows/",
    },
    {
      venue: "Reddit",
      title: "Codex users discuss handoffs between agents",
      url:
        "https://www.reddit.com/r/codex/comments/1v852jd/how_do_you_guys_handoff_work_between_agents/",
    },
    {
      venue: "Independent blog",
      title: "STATUS.md for multi-agent work",
      url: "https://igortkanov.com/status-md-for-multi-agent-work/",
    },
    {
      venue: "Cursor",
      title: "Scaling long-running autonomous coding",
      url: "https://cursor.com/blog/scaling-agents",
    },
  ],
  limits:
    "The corpus does not establish a universal concurrency ceiling; tightly scoped independent work and additional orchestration can scale further.",
};

const READINESS_CORROBORATION: DemandEvidence = {
  class: "corroborated",
  source:
    "An artifact-backed founder account and independent public reports distinguish an agent's completion statement from durable evidence that the relevant checks ran.",
  date: "2026-09-01",
  publicSources: [
    {
      venue: "GitHub",
      title: "Claude Code declared work verified without the canonical build",
      url: "https://github.com/anthropics/claude-code/issues/63861",
    },
    {
      venue: "GitHub",
      title: "Codex weakened tests and reported validation as complete",
      url: "https://github.com/openai/codex/issues/24922",
    },
    {
      venue: "Reddit",
      title: "Passing Playwright tests patched the application under test",
      url:
        "https://www.reddit.com/r/ClaudeCode/comments/1rug14a/claude_wrote_playwright_tests_that_secretly/",
    },
    {
      venue: "GitHub",
      title: "A task reported command success without observable execution",
      url: "https://github.com/openai/codex/issues/34152",
    },
  ],
  limits:
    "The corpus does not establish a failure rate or show that every completion statement is unreliable, and a passing check cannot establish behavior outside its declared scope.",
};

const PROJECT_MEMORY_CORROBORATION: DemandEvidence = {
  class: "corroborated",
  source:
    "An artifact-backed founder account and independent public accounts describe session or provider context failing to carry forward automatically and requiring project-owned memory.",
  date: "2026-09-01",
  publicSources: [
    {
      venue: "GitHub",
      title:
        "Claude Code memory and conversation history lost between sessions",
      url: "https://github.com/anthropics/claude-code/issues/38459",
    },
    {
      venue: "GitHub",
      title: "Codex auto-compaction discarded conversation history",
      url: "https://github.com/openai/codex/issues/36642",
    },
    {
      venue: "Reddit",
      title: "Handling context loss between Claude Code sessions",
      url:
        "https://www.reddit.com/r/ClaudeCode/comments/1qn5tfc/how_do_you_handle_context_loss_between_claude/",
    },
    {
      venue: "GitHub",
      title: "AGENTS.md proposed as a source for Claude and Codex",
      url:
        "https://github.com/collaborationwithothers/mcp-platform-azure/issues/46",
    },
  ],
  limits:
    "The corpus does not show that every project starts cold; repository-owned instructions can remove much of the problem, and hidden conversational state or proprietary features remain non-portable.",
};

/**
 * The demand canon. Territory order mirrors the Human Benefit Canon's commercial
 * order, so the two accounts read side by side.
 */
export const DEMAND_CANON: readonly DemandTerritory[] = [
  {
    id: "operating-layer-trap",
    title: "Becoming the operating layer",
    counterpart: "build-further",
    tension:
      "Coding agents multiplied the execution available to one person, and the coordination they require has landed on that person: scheduling tasks, preparing workspaces, relaying status, and holding every thread of unfinished work.",
    heardAs: [
      "run multiple coding agents at once",
      "two agent sessions overwrote each other",
      "git worktrees for agent sessions",
      "resume an agent task from yesterday",
    ],
    entries: [
      {
        id: "backlog-outruns-attention",
        title: "More work than one person can shape and review",
        situation:
          "Agent execution expands faster than the person can shape tasks, resolve dependencies, and review what returns, so extra sessions queue behind those human decisions.",
        alternative:
          "Cap work at one or two concurrent sessions, or accept shallow briefs and a growing review queue.",
        cost:
          "Available implementation capacity goes unused, or produces more output than the person can safely integrate.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [OPERATING_LAYER_CORROBORATION],
        answer: { benefits: ["shape-substantial-work"] },
      },
      {
        id: "checkout-collisions",
        title: "Two sessions, one checkout",
        situation:
          "A second concurrent session edits the same checkout as the first, and the two overwrite each other's files, fight over the development server port, or reuse the same test database.",
        alternative:
          "Hand-rolled git worktrees or full repository clones, port numbers assigned by convention, and a private rule about which terminal owns which directory.",
        cost:
          "Lost edits, corrupted working state, and a workspace administration job that grows with every added session.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["parallel-work-on-one-machine"] },
      },
      {
        id: "human-message-bus",
        title: "Carrying messages between your own agents",
        situation:
          "One task depends on another's result, so the person polls the first session, summarizes its state, and pastes the answer into the second — for every dependency, in both directions.",
        alternative:
          "Serialize the dependent work, or keep both sessions open and relay progress by hand.",
        cost:
          "The person cannot leave the desk while dependent work is moving, and a missed relay leaves the downstream task stalled until somebody notices.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [OPERATING_LAYER_CORROBORATION],
        answer: { benefits: ["wait-without-relay", "compose-staged-work"] },
      },
      {
        id: "abandoned-session-amnesia",
        title: "Coming back cold to a half-finished task",
        situation:
          "A task pauses for a day — a review, a priority change, a closed laptop — and the return costs an archaeology session: which workspace, what state, what was left to do.",
        alternative:
          "Scroll the old conversation, diff the working tree by hand, and rebuild the plan from memory.",
        cost:
          "The first stretch of every resumed session goes to reconstructing context, and some paused tasks are abandoned because reconstruction costs more than the remaining work.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["resume-later"] },
      },
      {
        id: "spend-anxiety",
        title: "The meter runs faster than the backlog moves",
        situation:
          "Running more sessions multiplies subscription and token spend, and the person cannot tell which of it converted into landed work.",
        alternative:
          "Cap the number of concurrent sessions by gut feeling, or juggle subscription tiers and quotas across providers by hand.",
        cost:
          "Spend scales with activity rather than outcomes, and the fear of waste caps parallelism below what the backlog could use.",
        forces: ["push", "anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: {
          gap:
            "No current capability relates agent spend to landed outcomes; the Logbook records local activity metadata and does not measure spend.",
        },
      },
    ],
  },
  {
    id: "workflow-attention-tax",
    title: "Routine coordination crowds out the product",
    counterpart: "return-human-attention",
    tension:
      "As more work moves, routine coordination grows with it: checking status, confirming commands ran, waiting on long runs, and re-establishing project context. The workflow takes attention the person wants to spend on the product.",
    heardAs: [
      "how do I see which work needs me",
      "how do I know which checks ran",
      "the build failed after a long run",
      "stop re-explaining my project every session",
    ],
    entries: [
      {
        id: "redundant-re-review",
        title: "Re-running the same checks by hand",
        situation:
          "A finished task arrives without a durable record of whether the formatter, linter, and tests passed against the same tree, so the person runs them again before reviewing it.",
        alternative:
          "A personal checklist run by hand, or a CI pipeline that reports long after the session has moved on.",
        cost:
          "Every delegated task carries a fixed verification toll paid by the person, which caps how many tasks a day they can accept.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [READINESS_CORROBORATION],
        answer: { benefits: ["reduce-routine-review"] },
      },
      {
        id: "status-chasing",
        title: "Opening every session to reconstruct status",
        situation:
          "Work in flight is only visible inside each conversation, so reconstructing project state requires opening every session and combining its status by hand.",
        alternative:
          "A terminal per session and a mental model per terminal, rebuilt manually whenever the person returns.",
        cost:
          "Returning to the desk begins with reconstructing state before any decision can be made, and a stalled session can wait hours before anyone notices.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [OPERATING_LAYER_CORROBORATION],
        answer: { benefits: ["decisions-in-one-view"] },
      },
      {
        id: "doomed-runs",
        title: "Watching a run that was doomed at the first minute",
        situation:
          "A failure that was knowable early — a type error, a missing dependency, an unrelated broken suite — surfaces at the end of a long run, vaguely, after the budget is spent.",
        alternative:
          "Full pipeline runs for every iteration, and hand-reading long transcripts to find the line that mattered.",
        cost:
          "Minutes of machine time and agent context go to runs whose failure was already determined, and diagnosis restarts from a wall of output.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["useful-failures-sooner", "run-relevant-checks"] },
      },
      {
        id: "missing-companion-file",
        title: "The file review always catches",
        situation:
          "The change lands without its habitual companion — the migration, the fixture, the doc — and review or production finds the omission after the branch has moved on.",
        alternative:
          "Reviewer vigilance and unwritten knowledge about which files travel together.",
        cost:
          "A review round-trip per miss, and the same omission repeating because nothing carries the pairing forward.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["catch-related-files"] },
      },
      {
        id: "context-burned-on-tooling",
        title: "The context window goes to the tooling, not the task",
        situation:
          "Each session spends its early context rediscovering commands, conventions, and project layout, and the person watches the useful part of the window shrink before the work begins.",
        alternative:
          "Longer prompts pasted at session start, and acceptance that some of every window is spent re-learning the repository.",
        cost:
          "Less of each session's capacity reaches the task, and long tasks hit the window's end sooner.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["context-for-the-task"] },
      },
    ],
  },
  {
    id: "readiness-without-evidence",
    title: "Readiness without durable evidence",
    counterpart: "know-what-is-ready",
    tension:
      "Finished work arrives through conversation, and the conversation alone cannot distinguish a change that passed every declared check from one that has not been evaluated against them.",
    heardAs: [
      "how do I know which checks passed",
      "keep unfinished work off the shared branch",
      "how to verify agent-written code",
      "keep landing authority with me",
    ],
    entries: [
      {
        id: "completion-without-evidence",
        title: "A completion message with no durable evidence",
        situation:
          "A task is marked complete, but pulling the branch reveals a build failure, checks that did not run, or a change that solves a different problem than the brief.",
        alternative:
          "Pull the branch, run everything, and read the diff to reconstruct readiness before making a decision.",
        cost:
          "Reconstructing readiness consumes the time delegation was meant to return, and every task comes back with the same uncertainty.",
        forces: ["push", "anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [READINESS_CORROBORATION],
        answer: {
          benefits: ["project-defined-completion", "evidence-for-this-change"],
        },
      },
      {
        id: "what-was-checked-when",
        title: "No record of what was verified for this commit",
        situation:
          "Weeks later a commit is misbehaving in production, and nobody can say which checks it passed at the time, because the account of its verification lived in a chat that is gone.",
        alternative:
          "Search old transcripts and CI logs, or accept that the verification history of the codebase is unrecoverable.",
        cost:
          "Post-incident work starts from ignorance about what was established, and the same doubt attaches to every landed change.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_POSITIONING],
        answer: { benefits: ["evidence-that-lasts"] },
      },
      {
        id: "premature-landing",
        title: "Work reaches the shared branch before review",
        situation:
          "A change reaches the shared branch before the responsible person accepts it. Even when the change is sound, the workflow has exercised landing authority the person did not grant.",
        alternative:
          "Standing instructions never to push, repeated in every prompt, and branch-protection rules bolted on where the platform allows them.",
        cost:
          "The shared branch carries changes nobody reviewed, and the boundary around who decides what lands becomes uncertain.",
        forces: ["push", "anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: {
          benefits: [
            "explicit-release-decision",
            "unfinished-work-stays-isolated",
          ],
        },
      },
      {
        id: "approval-fatigue",
        title: "Stamping the same low-risk approval every day",
        situation:
          "Routine, clearly bounded changes — documentation, fixtures, generated files — queue behind the same yes the person gave yesterday and will give tomorrow.",
        alternative:
          "Approve each one by hand anyway, or stop reviewing that category entirely and hope the boundary holds.",
        cost:
          "Either attention goes where no decision is being made, or an unbounded exemption grows in the dark.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_AUDIENCES],
        answer: { benefits: ["bounded-standing-permission"] },
      },
      {
        id: "half-applied-state",
        title: "The operation that stopped halfway",
        situation:
          "A crash, a cancellation, or a closed lid interrupts an operation mid-flight, and the workspace is left convincing but wrong: some effects applied, some not, no record of which.",
        alternative:
          "Inspect everything the operation might have touched, or delete the workspace and start over.",
        cost:
          "Recovery time is unbounded because the missing information is what happened, and starting over discards real work.",
        forces: ["push", "anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["recover-interrupted-operations"] },
      },
    ],
  },
  {
    id: "eroding-gains",
    title: "Re-fixing what was already fixed",
    counterpart: "make-improvement-accumulate",
    tension:
      "Improvements do not stay improved: bugs return in new clothes, metrics drift back, migrations stall halfway, and every few months the same cleanup happens again under a new name.",
    heardAs: [
      "the same bug keeps reappearing",
      "test coverage keeps dropping",
      "duplicate helpers everywhere after agent sessions",
      "the migration never finished",
    ],
    entries: [
      {
        id: "quality-erosion",
        title: "The measure drifts backward",
        situation:
          "Coverage, bundle size, lint findings, and other measures give ground one small change at a time, and a branch can loosen a threshold solely to make its new work pass.",
        alternative:
          "Periodic audits that discover the drift after months, and code review as the only defense against a threshold edit.",
        cost:
          "Ground gained in dedicated efforts is surrendered gradually and invisibly, and has to be retaken at full price.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_AUDIENCES],
        answer: {
          benefits: [
            "retain-measured-gains",
            "pin-new-baseline",
            "standards-that-scale",
          ],
        },
      },
      {
        id: "regressions-reappear",
        title: "The same bug in a new place",
        situation:
          "A defect fixed in one location reappears in a sibling the fix never visited, because the repair addressed the instance and not the pattern.",
        alternative:
          "Fix each recurrence as its own bug, and rely on reviewers to remember the pattern's history.",
        cost:
          "The same diagnosis is paid for repeatedly, and confidence drops as fixed bugs stop staying fixed.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["remove-bug-class"] },
      },
      {
        id: "migrations-that-never-finish",
        title: "The migration that never reaches zero",
        situation:
          "The move to the new pattern stalls with the old one still present, and new code keeps choosing the old way because nothing marks it as closed.",
        alternative:
          "A tracking issue, an entry in the onboarding notes, and hope.",
        cost:
          "The codebase pays for both patterns indefinitely: double the concepts to learn, and every reader deciding which convention is current.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["retire-old-pattern"] },
      },
      {
        id: "slop-accumulation",
        title: "Each session leaves a little more behind",
        situation:
          "After many agent sessions the tree carries duplicated helpers, dead code from abandoned approaches, and scaffolding nobody removed, and no single change is to blame.",
        alternative:
          "An occasional cleanup campaign that recurs because nothing holds the ground it clears.",
        cost:
          "Navigation and review get slower everywhere at once, and each session's output degrades with the examples it learns from.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["keep-clutter-down"] },
      },
      {
        id: "docs-rot",
        title: "Instructions that no longer work",
        situation:
          "The project's own documentation drifts: commands that no longer exist, links that no longer resolve, pages describing a structure three refactors old — and agents follow it literally.",
        alternative:
          "Fix documentation when a person happens to notice, and teach agents to distrust the docs.",
        cost:
          "Every reader pays a verification toll on every page, and wrong instructions produce confident but incorrect changes.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["catch-documentation-breakage"] },
      },
      {
        id: "anecdote-driven-tuning",
        title: "Improving the workflow by feel",
        situation:
          "The person suspects the practice is losing time — some instruction misread, some stage slow, some capability unused — and has nothing but impressions to steer by.",
        alternative:
          "Adjust prompts and instructions on intuition and see whether things feel better.",
        cost:
          "Improvement effort lands where irritation is loudest rather than where time is lost, and nobody can say whether a change helped.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_POSITIONING],
        answer: { benefits: ["improve-practice-from-evidence"] },
      },
    ],
  },
  {
    id: "stateless-project-memory",
    title: "Explaining the project again",
    counterpart: "keep-project-knowledge-working",
    tension:
      "Sessions end and take their understanding with them, so the person is the project's memory: re-teaching conventions, re-litigating settled decisions, and re-orienting every fresh agent by hand.",
    heardAs: [
      "project conventions keep getting missed",
      "persistent project context for coding agents",
      "it suggested the approach we already rejected",
      "my instruction file is getting huge",
    ],
    entries: [
      {
        id: "repeated-explanation",
        title: "Teaching the same lesson every session",
        situation:
          "The same conventions, constraints, and preferences are explained again in each new session — and again for each provider, whose instruction files all differ.",
        alternative:
          "A hand-maintained instruction file per provider, growing stale at different rates, plus in-chat corrections that die with the session.",
        cost:
          "A recurring toll of explanation and correction on every task, multiplied by every provider in use.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [PROJECT_MEMORY_CORROBORATION],
        answer: { benefits: ["teach-project-once"] },
      },
      {
        id: "opaque-agent-understanding",
        title: "No durable account of the project's working model",
        situation:
          "The working model used in each session lives in its history, so the person cannot read or correct it until a change reveals the misunderstanding.",
        alternative:
          "Judge understanding indirectly from the quality of the output, and re-explain after each surprise.",
        cost:
          "Misunderstandings persist invisibly across sessions and surface as defects instead of as correctable text.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_AUDIENCES],
        answer: { benefits: ["inspect-agent-understanding"] },
      },
      {
        id: "relitigated-decisions",
        title: "The settled question reopens",
        situation:
          "A choice settled months ago — with context, trade-offs, and a rejected alternative — resurfaces as a fresh suggestion, and the rejected alternative is proposed with confidence.",
        alternative:
          "Institutional memory in one person's head, and a veto exercised each time the question returns.",
        cost:
          "Decision context is re-derived or lost, and the person becomes the only barrier between the project and its own rejected paths.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["preserve-decision-reasons"] },
      },
      {
        id: "known-failure-forgotten",
        title: "The gotcha nobody remembers in time",
        situation:
          "The failure has been seen before and its remedy written down, but the note lives where nobody looks while failing, so each recurrence is diagnosed from scratch.",
        alternative:
          "A gotchas page, an operations guide, or a wiki that must be remembered precisely when things are going wrong.",
        cost:
          "Documented knowledge performs as if it did not exist, and diagnosis time is spent re-earning it.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_POSITIONING],
        answer: { benefits: ["instructions-at-failure"] },
      },
      {
        id: "slow-session-starts",
        title: "The first ten minutes of every session",
        situation:
          "A fresh or resumed session begins with orientation — what is this project, where are things, what changed, what is the command — before any of the actual task begins.",
        alternative:
          "Paste a project tour into the prompt, or let orientation consume the opening part of the session.",
        cost:
          "Every session pays a startup toll, and short tasks pay proportionally the most.",
        forces: ["push"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["orient-new-session"] },
      },
      {
        id: "practice-does-not-travel",
        title: "Starting the discipline over per project",
        situation:
          "The habits that made the last project trustworthy — one source per fact, guards that enroll new members, effects planned before execution — restart from nothing in each new repository.",
        alternative:
          "Rebuild conventions by hand each time, or carry them imperfectly in memory between projects.",
        cost:
          "Each project re-pays the setup cost of discipline, and projects begun in a hurry never get it at all.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_POSITIONING],
        answer: { benefits: ["reuse-engineering-discipline"] },
      },
    ],
  },
  {
    id: "adoption-hesitation",
    title: "Wanting the practice, dreading the adoption",
    counterpart: "put-practice-in-place",
    tension:
      "The person already believes their project needs a more serious way of working; what stalls them is the adoption itself — the configuration to learn, the services to run, and the doubt that the method survives contact with real work.",
    heardAs: [
      "how to set up a serious workflow for agent coding",
      "engineering practice for a project built with agents",
      "tools like this never work on my repository",
      "not another daemon to run",
      "will a quality gate slow my agents down",
    ],
    entries: [
      {
        id: "integration-engineer-by-accident",
        title: "Adopting the tool means becoming its engineer",
        situation:
          "Every serious workflow tool asks the person to study its configuration language, wire it to their project by hand, and debug the integration — expertise they hoped to borrow rather than acquire.",
        alternative:
          "Spend the weekend on setup, adopt a diluted version of the practice, or postpone adoption again.",
        cost:
          "The projects most in need of practice — run by people busiest with the product — are the least able to pay the setup price.",
        forces: ["pull", "anxiety"],
        segments: ["new consequential builders", "experienced engineers"],
        evidence: [FROM_AUDIENCES],
        answer: { benefits: ["agent-commissioning"] },
      },
      {
        id: "another-service-fatigue",
        title: "No appetite for another running service",
        situation:
          "The candidate tool wants a daemon, an account, a dashboard, and a subscription, and the person's stack already carries more moving parts than they want to operate.",
        alternative:
          "Decline the category entirely, or accept another service and the operational surface it brings.",
        cost:
          "Useful practice is rejected for its delivery mechanism rather than its content.",
        forces: ["anxiety", "habit"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["small-installation-footprint"] },
      },
      {
        id: "does-anyone-run-this",
        title: "Does the method survive its own medicine",
        situation:
          "Before adopting a methodology, the person wants evidence that its makers can stand working under it — not examples constructed for the documentation.",
        alternative:
          "Read the marketing, try a toy project, and extrapolate on faith.",
        cost:
          "Adoption decisions rest on staged demonstrations, and skepticism — usually earned — blocks practices that would have held.",
        forces: ["pull", "anxiety"],
        segments: ["experienced engineers"],
        evidence: [FROM_AUDIENCES],
        answer: { benefits: ["inspect-live-example"] },
      },
      {
        id: "discipline-tax-anxiety",
        title: "Will the discipline slow the agents down",
        situation:
          "The person wants the quality practice but fears its price: every check, gate, and question sounds like another wait inserted into a loop whose whole appeal is speed.",
        alternative:
          "Run without checks and review by feel, or adopt the discipline and abandon it the first week it feels slow.",
        cost:
          "Either speed comes with standing dread about what is slipping through, or the practice is adopted in name and bypassed in use.",
        forces: ["anxiety", "habit"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_AUDIENCES],
        answer: { benefits: ["useful-failures-sooner", "run-relevant-checks"] },
      },
      {
        id: "workspace-residue",
        title: "The experiments leave their equipment out",
        situation:
          "Months of task workspaces leave the machine littered with directories, ports, and databases from efforts nobody remembers, and cleaning up risks deleting a workspace that still holds unlanded work.",
        alternative:
          "Periodic manual sweeps performed nervously, or letting the residue accumulate.",
        cost:
          "The machine degrades as a working environment, and one wrong deletion turns cleanup into data loss.",
        forces: ["push", "anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["clean-abandoned-environments"] },
      },
    ],
  },
  {
    id: "stranded-investment",
    title: "Betting on a moving market",
    counterpart: "change-tools-without-starting-over",
    tension:
      "Model quality, pricing, and tooling shift monthly, and every hour invested in one provider's instruction files and workflow glue is an hour that may strand when the market moves.",
    heardAs: [
      "switching coding agents without losing my setup",
      "keep instruction files for different agents in sync",
      "locked into one provider",
      "the tool updated and broke my workflow",
    ],
    entries: [
      {
        id: "provider-churn",
        title: "Switching agents means re-teaching everything",
        situation:
          "A different coding agent becomes the better fit — or the current one becomes unavailable — but project knowledge and working conventions live in provider-specific surfaces the next agent does not automatically load.",
        alternative:
          "Maintain parallel instruction files by hand and reconstruct the private session memory whenever the provider changes.",
        cost:
          "Changing tools carries a continuity penalty, and every duplicated instruction file can drift.",
        forces: ["push", "habit"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [PROJECT_MEMORY_CORROBORATION],
        answer: { benefits: ["switch-providers"] },
      },
      {
        id: "per-stack-fragmentation",
        title: "A different way of working per repository",
        situation:
          "Each project — a different language, a different toolchain — evolves its own improvised agent workflow, and the person context-switches between the workflows as much as between the codebases.",
        alternative:
          "Accept the fragmentation, or impose one stack's tooling on projects it fits badly.",
        cost:
          "Lessons learned in one project do not transfer, and each new repository restarts the workflow design.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_POSITIONING],
        answer: { benefits: ["practice-across-stacks"] },
      },
      {
        id: "scripting-against-prose",
        title: "Automation that scrapes terminal prose",
        situation:
          "The person's scripts and integrations parse the tool's human-readable output, and every cosmetic release breaks them.",
        alternative:
          "Regular expressions over terminal output, pinned versions, and a repair session after each upgrade.",
        cost:
          "Integrations stay permanently fragile, and useful automation is abandoned as not worth the maintenance.",
        forces: ["push"],
        segments: ["experienced engineers"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["build-on-published-contracts"] },
      },
      {
        id: "surprise-upgrades",
        title: "The tool changed itself mid-task",
        situation:
          "A tool updates itself in the middle of project work and behaves differently before and after, and nobody chose the moment.",
        alternative:
          "Version pins where the ecosystem allows them, and reading changelogs after the surprise rather than before.",
        cost:
          "Behavior changes arrive without review at a moment nobody chose, sometimes mid-flight in an automated run.",
        forces: ["anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["planned-upgrades"] },
      },
      {
        id: "hostage-data-fear",
        title: "Trying it must not cost the leaving",
        situation:
          "Before adopting, the person prices the exit: whether instructions, documentation, and configuration survive as usable files if the tool goes away or gets uninstalled.",
        alternative:
          "Avoid tools whose value evaporates at uninstall, or adopt and accept the lock-in.",
        cost:
          "Every adoption is discounted by its exit risk, and some worthwhile tools are never tried.",
        forces: ["anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_AUDIENCES],
        answer: { benefits: ["retain-work-after-uninstall"] },
      },
    ],
  },
  {
    id: "control-anxiety",
    title: "Keeping your hands on the wheel",
    counterpart: "keep-control",
    tension:
      "Between the person and their own repository, each new layer — hosted control planes, extra models, opaque automation — dilutes their authority over what changes and who decided.",
    heardAs: [
      "does this tool send my code anywhere",
      "agent workflow without another API key",
      "what is this tool allowed to write to",
      "local-only agent workflow",
    ],
    entries: [
      {
        id: "another-model-another-bill",
        title: "No second model, no second bill",
        situation:
          "A workflow tool that adds its own model calls adds a second bill, a second key to manage, and a second party reading the code — costs the person did not set out to buy.",
        alternative:
          "Restrict such tools to unimportant repositories, or pay and accept the exposure.",
        cost:
          "Spend and exposure grow with the toolchain instead of with the work, and some repositories are off-limits to the workflow entirely.",
        forces: ["anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["local-without-another-model"] },
      },
      {
        id: "invisible-write-boundaries",
        title: "What is this thing allowed to touch",
        situation:
          "A new tool's write surface is unknown: whether it can reach the shared branch, the home directory, or another project's files, and what it would take for it to do so.",
        alternative:
          "Read the source, sandbox the tool, or extend trust and monitor for surprises.",
        cost:
          "Trust is granted blind or withheld entirely, and near-misses surface as incidents rather than refused operations.",
        forces: ["anxiety"],
        segments: ["experienced engineers", "new consequential builders"],
        evidence: [FROM_DISCOURSE],
        answer: { benefits: ["explicit-write-authority"] },
      },
    ],
  },
];

/**
 * Benefits deliberately answered by NO demand entry, each with the reason:
 * supply-side bets whose demand account has not been hypothesized yet. The
 * coverage guard holds every benefit to exactly one of: answered by an
 * entry, or recorded here. A record here is a named bet, not a defect — but
 * it should shrink as evidence arrives.
 */
export const SUPPLY_PUSH_RECORDS: Readonly<Record<string, string>> = {
  "judgment-at-the-change":
    "Built ahead of an identified struggle: checkpoints landed with their engine waves, and the demand account for judgment stops is authored with the launch story once the built-in set ships.",
  "export-project-briefing":
    "Built ahead of an identified struggle: ordered briefing export serves discern's own onboarding flow, and no independent struggling moment is hypothesized for it yet.",
};

/** One flattened demand entry with its territory. */
export interface FlattenedDemand {
  readonly territory: DemandTerritory;
  readonly entry: DemandEntry;
}

/** Every demand entry in authoring order, flattened with its territory. */
export function allDemandEntries(
  canon: readonly DemandTerritory[] = DEMAND_CANON,
): FlattenedDemand[] {
  const out: FlattenedDemand[] = [];
  for (const territory of canon) {
    for (const entry of territory.entries) out.push({ territory, entry });
  }
  return out;
}

/** The benefit titles by id, for resolving `answer` citations loudly. */
function benefitTitlesById(): Map<string, string> {
  return new Map(
    allHumanBenefitEntries().map(({ entry }) => [entry.id, entry.title]),
  );
}

/** Resolve one answering benefit id to its title, or throw on a stranded
 * citation. */
function answeringTitle(titles: Map<string, string>, id: string): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`demand canon cites unknown benefit: ${id}`);
  }
  return title;
}

/** The benefit-cluster titles and roles by id, for the counterpart labels. */
function clusterById(id: string): { title: string; role: string } {
  const cluster = HUMAN_BENEFIT_CANON.find((candidate) => candidate.id === id);
  if (cluster === undefined) {
    throw new Error(`demand territory counters unknown cluster: ${id}`);
  }
  return { title: cluster.title, role: cluster.role };
}

/** Render one entry's evidence rows as a single labelled line. */
function renderEvidence(evidence: readonly DemandEvidence[]): string {
  return evidence
    .map((row) => {
      const summary = `${row.class} — ${row.source} (recorded ${row.date})`;
      if (row.class !== "corroborated") return summary;
      const corpus = row.publicSources.map((source) =>
        `${source.venue}: [${source.title}](${source.url})`
      ).join("; ");
      return `${summary} Corpus: ${corpus}. Limits: ${row.limits}`;
    })
    .join("; ");
}

/** Route one rendered Demand Canon field through Canon Editor's provenance seam. */
function annotateDemand(
  entry: string,
  field: string,
  text: string,
): string {
  return annotateProse(text, { registry: "demand", entry, field });
}

/**
 * Render the demand-canon page: the demand center, the territories with
 * their evidence-tagged entries, and the coverage appendix. The brand
 * registry stamps the banner and resolves citation tokens.
 */
export function renderDemandCanonDoc(): string {
  const titles = benefitTitlesById();
  const flattened = allDemandEntries();
  const answered = new Set(
    flattened.flatMap(({ entry }) =>
      entry.answer.benefits !== undefined ? [...entry.answer.benefits] : []
    ),
  );
  const gaps = flattened.filter(({ entry }) => entry.answer.gap !== undefined);
  const benefitCount = allHumanBenefitEntries().length;
  const classCounts = new Map<DemandEvidenceClass, number>();
  for (const { entry } of flattened) {
    for (const row of entry.evidence) {
      classCounts.set(row.class, (classCounts.get(row.class) ?? 0) + 1);
    }
  }
  const classBreakdown = DEMAND_EVIDENCE_CLASS_NAMES.filter((name) =>
    classCounts.has(name)
  )
    .map((name) => `${name} ${classCounts.get(name)}`)
    .join(" · ");
  const counted = (count: number, singular: string): string =>
    `${count} ${singular}${count === 1 ? "" : "s"}`;
  const lines: string[] = [
    "# Demand canon",
    "",
    "_discern's internal account of the demand its benefits answer. It is the market-side counterpart of the [Human Benefit Canon](../feature-canon-human-benefits.md): where a benefit reasons forward from product facts to human value, a demand entry reasons backward from a struggling moment somebody is hypothesized to be in. Demand claims are empirical, so every entry carries dated evidence in the market classes of the {{doc:claims-and-evidence}} ledger, and nothing here is stronger than its class. The {{doc:audiences}} document holds the by-person account of the same ground._",
    "",
    `${DEMAND_CANON.length} territories · ${flattened.length} entries · ${answered.size} of ${benefitCount} benefits answered · ${
      counted(Object.keys(SUPPLY_PUSH_RECORDS).length, "supply-push record")
    } · ${counted(gaps.length, "recorded gap")} · evidence: ${classBreakdown}.`,
    "",
    "## How to use this canon",
    "",
    "- Read a territory's tension first; its entries are the specific, recurring forms of it. An entry names the benefits that answer the struggle — the mechanism account stays in the Human Benefit Canon.",
    "- Trust an entry no further than its evidence class. Demand evidence uses the claims ledger's market classes only — corroborated, observational, anecdotal, hypothesis; structural and demonstrated describe the product and can never describe the market. An entry is promoted by attaching stronger evidence; rewording changes nothing.",
    "- Forces name what the moment does to the person: push drives them to seek help, pull attracts them to a new practice, anxiety makes them hesitate over it, and habit holds them to the current way. Anxiety and habit entries are the objections public copy must answer.",
    "- A benefit no entry answers is recorded as a supply-push bet, neither deleted nor assumed wanted. An entry no benefit answers is a recorded gap, kept visible as roadmap signal and left out of public copy.",
    "- Dates mark the moment the evidence was recorded. Treat an old hypothesis as expired until it is re-confirmed or promoted.",
    "- The Heard as lines collect pre-contact market language: what the struggle sounds like before the person knows any product vocabulary. Public copy should meet people in these words; the lines are themselves hypotheses until observed in real queries.",
    "- Write public copy from the Human Benefit Canon and the claims ledger; use this canon to choose which benefits to lead with and which objections to answer.",
    "",
    "## Demand center",
    "",
    `**Situation:** ${DEMAND_CANON_SITUATION}`,
    "",
    `> ${DEMAND_CANON_TENSION}`,
    "",
    "Every territory below is a recurring form of that tension. Where the tension is real and felt, the counterpart benefits have a buyer; where it is not, they have a bet.",
    "",
    "## At a glance",
    "",
    "| Territory | Counterpart | Tension |",
    "| --- | --- | --- |",
  ];
  for (const territory of DEMAND_CANON) {
    const counterpart = clusterById(territory.counterpart);
    lines.push(
      `| **${territory.title}** | ${counterpart.title} | ${territory.tension} |`,
    );
  }
  lines.push("");
  for (const territory of DEMAND_CANON) {
    const counterpart = clusterById(territory.counterpart);
    lines.push(
      `## ${annotateDemand(territory.id, "title", territory.title)}`,
      "",
      `- **Counterpart:** ${
        annotateDemand(
          territory.id,
          "counterpart",
          `${counterpart.title} (${counterpart.role})`,
        )
      }`,
      `- **Tension:** ${
        annotateDemand(territory.id, "tension", territory.tension)
      }`,
      `- **Heard as:** ${
        annotateDemand(
          territory.id,
          "heardAs",
          territory.heardAs.map((phrase) => `“${phrase}”`).join(" · "),
        )
      }`,
      "",
    );
    for (const entry of territory.entries) {
      lines.push(
        `### ${annotateDemand(entry.id, "title", entry.title)}`,
        "",
        `- **Situation:** ${
          annotateDemand(entry.id, "situation", entry.situation)
        }`,
        `- **Today's alternative:** ${
          annotateDemand(entry.id, "alternative", entry.alternative)
        }`,
        `- **Cost:** ${annotateDemand(entry.id, "cost", entry.cost)}`,
        `- **Forces:** ${
          annotateDemand(entry.id, "forces", entry.forces.join(", "))
        }`,
        `- **Segments:** ${
          annotateDemand(entry.id, "segments", entry.segments.join(", "))
        }`,
        `- **Evidence:** ${
          annotateDemand(entry.id, "evidence", renderEvidence(entry.evidence))
        }`,
        entry.answer.benefits !== undefined
          ? `- **Answered by:** ${
            annotateDemand(
              entry.id,
              "answer.benefits",
              entry.answer.benefits
                .map((id) => answeringTitle(titles, id))
                .join(" · "),
            )
          }.`
          : `- **Recorded gap:** ${
            annotateDemand(entry.id, "answer.gap", entry.answer.gap)
          }`,
        "",
      );
    }
  }
  lines.push(
    "## Coverage and traceability",
    "",
    "Every benefit in the Human Benefit Canon is answered by at least one entry or recorded as a supply-push bet below, and every entry names the benefits that answer it or records a gap. The guard (`tests/demand_canon_test.ts`) holds both directions. Demand evidence stays within the claims ledger's market classes, so a struggling moment can never borrow the certainty of a product fact.",
    "",
    "### Supply-push records",
    "",
  );
  const supplyPush = Object.entries(SUPPLY_PUSH_RECORDS);
  if (supplyPush.length === 0) {
    lines.push("- None: every benefit is answered by at least one entry.");
  } else {
    for (const [id, reason] of supplyPush) {
      lines.push(`- \`${id}\` — ${reason}`);
    }
  }
  lines.push("", "### Recorded gaps", "");
  if (gaps.length === 0) {
    lines.push("- None: every entry is answered by at least one benefit.");
  } else {
    for (const { entry } of gaps) {
      if (entry.answer.gap !== undefined) {
        lines.push(`- \`${entry.id}\` — ${entry.answer.gap}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
