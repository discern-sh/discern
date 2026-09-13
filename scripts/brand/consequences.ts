/**
 * The consequence canon — the second-order account above the benefit canons
 * (ADR 0370). Where a benefit reasons forward from product facts to
 * first-order value, a consequence reasons one step further: what changes
 * for the person or the coding agent once several benefits hold together,
 * over time, and in combination. Each entry keeps two halves apart. The
 * `consequence` is deductive: it rests on cited benefits and the claims that
 * bound their public wording, so it inherits their evidence classes and the
 * guards behind them. The `then` is empirical: what people or agents do
 * next, held to the claims ledger's market classes the way demand evidence
 * is, so a predicted behavior can never borrow the certainty of the
 * mechanism that makes it possible.
 *
 * The `headline` carries the line at the altitude ADR 0244 licenses for
 * headlines — identity words, aspiration allowed — and the `consequence`
 * carries the mechanism at body altitude, where it must survive a hostile
 * literal reading. A hypothesis several entries share is recorded once in
 * `SHARED_HYPOTHESES` and cited by id, so reuse stays one belief rather than
 * several. `tests/consequence_canon_test.ts` holds every citation live, the
 * evidence within its classes, and every hypothesis labelled and absent
 * from the public line inventory. The page compiles into
 * `project/map/_internal/brand/consequence-canon.md` through the brand
 * registry.
 */

import {
  allAgentBenefitEntries,
  allHumanBenefitEntries,
  HUMAN_BENEFIT_AUDIENCES,
  type HumanBenefitAudience,
} from "../feature_registry.ts";
import type { ClaimSlug } from "./claims.ts";
import {
  DEMAND_EVIDENCE_CLASS_NAMES,
  type DemandEvidence,
  type DemandEvidenceClass,
} from "./demand.ts";

/** Whose working life a consequence describes. */
export const CONSEQUENCE_AUDIENCES = ["person", "agent"] as const;

export type ConsequenceAudience = (typeof CONSEQUENCE_AUDIENCES)[number];

/**
 * The evidence classes a `then` may carry: the claims ledger's market
 * classes, shared with the demand canon. `structural` and `demonstrated`
 * describe the product; a predicted behavior can never carry them.
 */
export const CONSEQUENCE_EVIDENCE_CLASS_NAMES = DEMAND_EVIDENCE_CLASS_NAMES;

export type ConsequenceEvidenceClass = DemandEvidenceClass;

/**
 * A hypothesis several consequences rest on, recorded once and cited by id
 * so the page renders it once and reuse across entries stays one belief.
 */
export interface SharedHypothesis {
  /** The belief, as a complete sentence. */
  readonly statement: string;
  /** What the belief does not claim, and its public-wording rule. */
  readonly limits: string;
}

export const SHARED_HYPOTHESES = {
  "capable-operators-at-lower-cost": {
    statement:
      "Cheaper, smaller, local, or experimental models operate the practice viably for bounded work once the project carries the memory, the checks, and the correction signal.",
    limits:
      "It compares no models and ranks none; it says the practice lowers the memory and judgment the operator must supply. Commissioning still wants the strongest available model because that work compounds. No public wording carries it before validation.",
  },
} as const satisfies Readonly<Record<string, SharedHypothesis>>;

export type SharedHypothesisId = keyof typeof SHARED_HYPOTHESES;

/** A hypothesis-class row that cites a shared hypothesis instead of standing alone. */
export interface SharedHypothesisEvidence {
  readonly class: "hypothesis";
  /** Where the belief comes from, stated plainly — a complete sentence. */
  readonly source: string;
  /** The date the evidence was recorded, `YYYY-MM-DD`. */
  readonly date: string;
  readonly shared: SharedHypothesisId;
  readonly corpus?: never;
}

/** One dated piece of evidence behind a predicted behavior. */
export type ConsequenceEvidence =
  | (DemandEvidence & { readonly shared?: never })
  | SharedHypothesisEvidence;

/** What people or agents do once the consequence holds, with its evidence. */
export interface ConsequenceThen {
  /** The predicted behavior, as a complete sentence. */
  readonly statement: string;
  readonly evidence: ConsequenceEvidence;
}

interface ConsequenceBase<Slug extends string = string> {
  readonly id: string;
  /** The line at headline altitude: identity words, aspiration allowed. */
  readonly headline: string;
  /** The mechanism at body altitude: literal, and true under a hostile reading. */
  readonly consequence: string;
  readonly then: ConsequenceThen;
  /** The claim slugs whose strongest public form bounds the wording. */
  readonly claims: readonly [Slug, ...Slug[]];
  /** The nearest recorded forbidden inference, as complete sentences. */
  readonly boundary: string;
  /** Optional provenance or placement note; may carry code spans. */
  readonly note?: string;
}

/** A consequence for the person responsible for the project. */
export interface PersonConsequence<Slug extends string = string>
  extends ConsequenceBase<Slug> {
  readonly audience: "person";
  readonly segments: readonly [HumanBenefitAudience, ...HumanBenefitAudience[]];
  /** Human Benefit Canon entry ids the consequence rests on. */
  readonly restsOn: readonly [string, ...string[]];
}

/** A consequence for the coding agent operating the practice. */
export interface AgentConsequence<Slug extends string = string>
  extends ConsequenceBase<Slug> {
  readonly audience: "agent";
  /** Agent Benefit Canon entry ids the consequence rests on. */
  readonly restsOn: readonly [string, ...string[]];
}

export type Consequence<Slug extends string = string> =
  | PersonConsequence<Slug>
  | AgentConsequence<Slug>;

const RECORDED = "2026-09-04";

const BOTH_SEGMENTS = HUMAN_BENEFIT_AUDIENCES;

const ENGINEERS: readonly [HumanBenefitAudience] = ["experienced engineers"];

const NEW_BUILDERS: readonly [HumanBenefitAudience] = [
  "new consequential builders",
];

/** The canon, in reading order: the person's consequences, then the agent's. */
export const CONSEQUENCE_CANON: readonly Consequence<ClaimSlug>[] = [
  {
    id: "release-judgment-reaches-future-work",
    audience: "person",
    headline: "The care you bring to a release becomes part of the project",
    consequence:
      "When release questions become shared instructions, project checks, and change-triggered judgments, future agents encounter the expectations in the work itself. Completion evidence gives the person an account of what passed and what was declared for the change they are considering.",
    then: {
      statement:
        "The person takes on a larger release because more of their established practice can travel with the delegated work.",
      evidence: {
        class: "hypothesis",
        source:
          "The founder's Readiness account motivates this consequence; its effect on the size of work people undertake has not been measured.",
        date: "2026-09-13",
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "teach-project-once",
      "judgment-at-the-change",
      "project-defined-completion",
      "evidence-for-this-change",
    ],
    claims: [
      "installs-a-practice",
      "one-instruction-source",
      "proof-exact-tree",
    ],
    boundary:
      "The project retains the expectations people and agents establish. Evidence covers the declared checks and judgments for a change; choosing relevant questions and exercising the result still requires judgment.",
    note:
      "{{doc:readiness-canon}} connects the release questions to the existing features and benefits that carry them.",
  },
  {
    id: "evidence-outlives-the-agent",
    audience: "person",
    headline: "Confidence moves out of the conversation and into the change",
    consequence:
      "Once the Gate judges the exact committed tree, a Standard cannot loosen on a branch, and nothing lands without recorded authority, the agent's own report stops being the basis for a decision. For everything the declared Gate can see, the evidence belongs to the change, whichever agent produced it.",
    then: {
      statement:
        "Model choice becomes a price and capability decision for bounded work.",
      evidence: {
        class: "hypothesis",
        source:
          "Founder use across three providers is evidence for switching and says nothing about weaker or local models.",
        date: RECORDED,
        shared: "capable-operators-at-lower-cost",
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "project-defined-completion",
      "evidence-for-this-change",
      "retain-measured-gains",
      "explicit-release-decision",
    ],
    claims: [
      "proof-exact-tree",
      "standards-cannot-loosen",
      "gate-grants-no-authority",
      "reduced-review-burden",
    ],
    boundary:
      "Proof covers the declared Gate on one tree. What the Gate cannot see still needs a declared human or device check, and review depth still depends on the change; review remains part of the practice.",
  },
  {
    id: "cheap-failure-buys-bold-work",
    audience: "person",
    headline:
      "When failing is cheap, you start the work you used to talk yourself out of",
    consequence:
      "A failed attempt in its own worktree costs the compute it used and the worktree it occupied. Nothing reaches the shared branch, nothing else on the machine is touched, and a dropped branch keeps a bounded recovery ref.",
    then: {
      statement:
        "The person starts the large migration, runs several approaches in parallel and keeps one, and schedules the refactor that never made the list.",
      evidence: {
        class: "observational",
        source:
          "This repository's homepage selection ran five complete candidate pages in five worktrees for the owner to choose one, and a late-July landing combined 24 branches through a red-then-green combined tree.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "parallel-work-on-one-machine",
      "unfinished-work-stays-isolated",
      "compose-staged-work",
      "clean-abandoned-environments",
    ],
    claims: ["isolated-worktrees", "no-checkout-collisions"],
    boundary:
      "Compute cost is unmeasured inside discern, and the demand canon records that gap. Public copy prices no failed attempt.",
    note:
      "This is the dynamics form of the right-limits pillar: people hand over only as much work as they can afford to have go wrong at once.",
  },
  {
    id: "the-job-moves-up-a-level",
    audience: "person",
    headline: "Your job moves up a level",
    consequence:
      "With coordination carried by the project, the person's scarce skill is finding seams, writing complete briefs, and setting boundaries and authority. That skill lives in briefs, instructions, checkpoints, and grants, so it survives every supported provider change.",
    then: {
      statement:
        "Line-by-line review stops being the most valuable place for the person's judgment.",
      evidence: {
        class: "observational",
        source:
          "The founder's account records the move from line-by-line review to briefs, architecture, steering, standards, and acceptance.",
        date: RECORDED,
      },
    },
    segments: ENGINEERS,
    restsOn: [
      "shape-substantial-work",
      "judgment-at-the-change",
      "teach-project-once",
    ],
    claims: ["shaped-delegation", "switch-without-reteaching"],
    boundary:
      "Engineering judgment moves; it does not retire. Every provider means every supported, configured provider.",
    note:
      "Approved public form: The work comes back finished. What's left is the part only you can do.",
  },
  {
    id: "review-grows-slower-than-output",
    audience: "person",
    headline: "More work comes back than you have to read",
    consequence:
      "Proof removes the reconstruction of what ran, a checkpoint puts the judgment question at the moment a matching change exists, and a grant removes the approval given yesterday and due again tomorrow. Each takes a fixed toll off every returned task, so review load need not grow at the rate output does.",
    then: {
      statement: "Agent throughput rises faster than the person's review load.",
      evidence: {
        class: "observational",
        source:
          "Founder dogfooding supports the outcome, and the ledger's review-burden claim records that external validation remains limited.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "reduce-routine-review",
      "judgment-at-the-change",
      "bounded-standing-permission",
    ],
    claims: [
      "reduced-review-burden",
      "proof-exact-tree",
      "gate-grants-no-authority",
    ],
    boundary:
      "No exponent, ratio, or multiplier appears in public copy. Review depth depends on project risk, change type, and test quality.",
    note:
      "Fills a gap: the first demand-side account for the `judgment-at-the-change` supply-push record.",
  },
  {
    id: "autonomy-widens-by-record",
    audience: "person",
    headline: "Autonomy grows one recorded decision at a time",
    consequence:
      "A standing scope grant opens a lane of pre-approved landing, checked against the changed paths on every acceptance. Patterns reports repeated conversational landings in one scope and suggests the grant, then reports pre-authorized landings afterwards, so each widening follows evidence and leaves a record.",
    then: {
      statement:
        "Lanes open as the same decision keeps being made, and none opens by accident.",
      evidence: {
        class: "observational",
        source:
          "This repository records a standing grant for its map scope, and the Logbook's detectors report repeated conversational landings in one scope and pre-authorized landings.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "bounded-standing-permission",
      "explicit-release-decision",
      "improve-practice-from-evidence",
    ],
    claims: [
      "gate-grants-no-authority",
      "patterns-compare-cohorts",
      "local-logbook",
    ],
    boundary:
      "A grant covers paths and does not cover a declared-unmet checkpoint. The evidence shows a decision is routine; it does not certify the decision as safe, and a recorded grant is not unlimited autonomy.",
  },
  {
    id: "decisions-wait-for-the-person",
    audience: "person",
    headline:
      "The decisions that need you wait for you. Everything else keeps moving.",
    consequence:
      "Nothing lands without recorded authority, and a dependent task blocks on the repository's own state rather than on a person relaying readiness. Work runs between the person's decisions: everything that needs them is still waiting when they return, and nothing has landed on an agent's say-so.",
    then: {
      statement: "Overnight runs become ordinary.",
      evidence: {
        class: "observational",
        source:
          "The founder's account records thirteen worktrees landing as one integration train overnight.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "explicit-release-decision",
      "wait-without-relay",
      "unfinished-work-stays-isolated",
    ],
    claims: ["gate-grants-no-authority", "no-checkout-collisions"],
    boundary:
      "This consequence covers landing and waiting. What an agent may do inside its worktree, on the network, or on the machine stays with the provider's permission model; discern supplies no command filter and contains no process.",
  },
  {
    id: "a-project-that-only-gets-better",
    audience: "person",
    headline: "A project that only gets better",
    consequence:
      "A measured limit only tightens, so an earned gain is the floor every later branch inherits. What the project records is where the next session starts, and its mechanics are checked on every Gate run. A second ratchet on recorded knowledge sits beside the first on measured quality.",
    then: {
      statement: "The marginal cost of each further agent task falls.",
      evidence: {
        class: "hypothesis",
        source:
          "No measurement of per-task cost exists; the private residue records cycle-time medians and nothing finer.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "retain-measured-gains",
      "pin-new-baseline",
      "teach-project-once",
      "preserve-decision-reasons",
    ],
    claims: [
      "standards-cannot-loosen",
      "pin-measured-gains",
      "map-mechanically-checked",
      "one-instruction-source",
    ],
    boundary:
      "Only the measured limit is monotone. Some quality dimensions are unmeasured, and the map check judges mechanics; conceptual currency is beyond it.",
    note:
      "ADR 0244 sanctions this headline at brand altitude, and the TODO's project-gets-smarter positioning is this entry in canon form.",
  },
  {
    id: "institutional-memory-without-an-institution",
    audience: "person",
    headline: "Institutional memory, no institution required",
    consequence:
      "The map, decision records with their reasons, compiled instructions, and an exportable ordered briefing hold what a departing person would otherwise take with them.",
    then: {
      statement:
        "Handover, collaboration, sale, or open-sourcing becomes possible for a project one person built.",
      evidence: {
        class: "hypothesis",
        source:
          "No handover, sale, or open-sourcing of a discern project is recorded.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "inspect-agent-understanding",
      "preserve-decision-reasons",
      "export-project-briefing",
      "teach-project-once",
    ],
    claims: ["map-mechanically-checked", "one-instruction-source"],
    boundary:
      "The account is complete only as far as its checks reach. The word institution is a reading; it names no product object.",
    note:
      "Fills a gap: the first demand-side account for the `export-project-briefing` supply-push record.",
  },
  {
    id: "quality-that-shows-its-work",
    audience: "person",
    headline: "Quality that shows its work",
    consequence:
      "A limit that can only tighten is a figure with a date, a direction, and a history in committed configuration and the Logbook. A durable Proof note on the landed commit records which checks passed and which limits held for that exact tree. The project's quality story is on the record, and a stranger can read it.",
    then: {
      statement:
        "The person puts the trajectory in front of a client, a co-founder, or an acquirer, and answers what was verified for a commit from the repository.",
      evidence: {
        class: "observational",
        source:
          "The lint-suppressions Standard fell from 31 to 6 across 34 days, with the trajectory recorded in committed configuration and the Logbook and refreshed on August 31, 2026.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: ["retain-measured-gains", "evidence-that-lasts"],
    claims: [
      "standards-cannot-loosen",
      "pin-measured-gains",
      "proof-exact-tree",
    ],
    boundary:
      "Proof is scoped engineering evidence: which checks ran and which limits held. It is neither a compliance attestation nor a due-diligence answer, and it says nothing about production suitability. A suppression count is one measure among many.",
  },
  {
    id: "one-practice-every-project",
    audience: "person",
    headline: "One practice, every project you own",
    consequence:
      "The practice ships none of the project's stack and reads one root file, so the same gate, worktree, instruction, map, and skill disciplines run on every repository the person keeps, whatever it is written in.",
    then: {
      statement:
        "A portfolio becomes uniform to operate, and a lesson learned in one project transfers to the rest.",
      evidence: {
        class: "observational",
        source:
          "The founder runs discern, the donor knowledge-base project, and an Apple headset app migrated onto discern under one practice.",
        date: RECORDED,
      },
    },
    segments: ENGINEERS,
    restsOn: ["practice-across-stacks", "reuse-engineering-discipline"],
    claims: ["one-config-file", "installs-a-practice"],
    boundary:
      "Uniform operation does not mean uniform commands; each project declares its own jobs and context. Team and multi-machine editions sit outside the v1 promise.",
  },
  {
    id: "the-practice-keeps-its-own-notes",
    audience: "person",
    headline: "The practice keeps its own notes",
    consequence:
      "The local record shows where the practice loses time: red runs before the first green, one diagnostic class recurring across branches, a dominant stage, ignored hints, a documentation gap. Briefs, checkpoints, and instructions change on counted evidence.",
    then: {
      statement:
        "The distribution of outcomes shifts and the practice gets cheaper to run.",
      evidence: {
        class: "hypothesis",
        source:
          "No before-and-after comparison of a practice change driven by Patterns findings is recorded.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "improve-practice-from-evidence",
      "catch-related-files",
      "instructions-at-failure",
    ],
    claims: ["patterns-compare-cohorts", "local-logbook"],
    boundary:
      "The Logbook records verbs, outcomes, timings, names, and hints. It holds no code, no output, and nothing about the kind of work, so it cannot say what kind of work agents fail at. It grades no agent or person; cohorts may be compared and nothing is ranked.",
  },
  {
    id: "every-bug-fixed-once",
    audience: "person",
    headline: "Every bug you fix is a bug you never fix again",
    consequence:
      "A cure covers the class: the cause proven, every current member fixed, and a guard driven from the class's single source left in the Gate, so a future member enrols the moment it exists. Guards only accumulate, a third ratchet beside quality and knowledge.",
    then: {
      statement:
        "The same diagnosis is paid for once, and confidence in old fixes stops decaying.",
      evidence: {
        class: "observational",
        source:
          "Forcing-function guards hold this repository's closed sets, and every structural public claim names the test that holds it.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: ["remove-bug-class", "retire-old-pattern"],
    claims: ["runs-on-itself"],
    boundary:
      "Never again holds for the class the guard covers, driven from its canonical source. A defect outside any declared class needs its own cure.",
  },
  {
    id: "raising-the-bar-costs-one-line",
    audience: "person",
    headline: "Raising the bar costs one line",
    consequence:
      "Any command that prints one number can become a Standard, a checkpoint is a short configuration table, and a scope is a set of path globs. Raising the bar is an everyday move made the moment something is noticed, and the limit is held from the next Gate run onward.",
    then: {
      statement:
        "Quality initiatives dissolve into ordinary work, and the number of things the project holds itself to rises steadily.",
      evidence: {
        class: "observational",
        source:
          "This repository holds more than thirty Standards over its own code and prose, each a short table in the root configuration.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "standards-that-scale",
      "judgment-at-the-change",
      "pin-new-baseline",
    ],
    claims: ["standards-cannot-loosen", "pin-measured-gains"],
    boundary:
      "discern never picks a limit; the owner does. A poorly chosen metric stays a poor metric however cheaply it was added.",
  },
  {
    id: "taste-becomes-infrastructure",
    audience: "person",
    headline: "Your taste becomes infrastructure",
    consequence:
      "Conventions compile into every agent's instructions, the numbers the person cares about become Standards, and the questions only they would ask become repository-authored checkpoints served at the moment a matching change exists. The judgment that cannot be encoded stays with the person, and the project asks for it at the right time.",
    then: {
      statement:
        "Taste stops being the bottleneck resource and becomes the thing every agent works inside.",
      evidence: {
        class: "observational",
        source:
          "This repository's checkpoints, Standards, and instructions carry the founder's judgment in that form.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "teach-project-once",
      "judgment-at-the-change",
      "retain-measured-gains",
    ],
    claims: ["one-instruction-source", "installs-a-practice"],
    boundary:
      "discern holds no application taste of its own and supplies none the person lacks; the audiences document bars any suggestion that it supplies taste to engineers.",
    note:
      "The hero direction Your taste. Their speed. is recorded in ADR 0244.",
  },
  {
    id: "the-same-interview-for-every-agent",
    audience: "person",
    headline: "Every new agent walks into the same interview",
    consequence:
      "A new model, provider, or host reads the same compiled instructions, works in the same kind of isolated worktree, faces the same Gate, and returns the same Proof as its predecessor. Adopting a new agent is an audition against the project's own bar, and Patterns can compare provider cohorts afterward with their denominators.",
    then: {
      statement: "Trying a new model on real work stops being a leap.",
      evidence: {
        class: "observational",
        source:
          "This repository's Logbook shows three providers, each working from the same compiled instructions and Gate.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "switch-providers",
      "teach-project-once",
      "improve-practice-from-evidence",
    ],
    claims: [
      "switch-without-reteaching",
      "one-instruction-source",
      "patterns-compare-cohorts",
    ],
    boundary:
      "Cohorts are compared and none is ranked: no leaderboard, no benchmark, and no verdict on which agent is best.",
  },
  {
    id: "what-agents-learn-you-own",
    audience: "person",
    headline: "Everything your agents learn becomes something you own",
    consequence:
      "Instructions, skills, map pages, decision records, and configuration are ordinary versioned files in the repository. Uninstall removes wiring and keeps every authored file. The person's investment in agent work accrues to an asset they can back up, fork, hand over, or take elsewhere.",
    then: {
      statement: "The chat transcript stops being where the project lives.",
      evidence: {
        class: "observational",
        source:
          "The founder's account records a provider's private memory moved into repository sources, which seeded discern's first commit.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "retain-work-after-uninstall",
      "teach-project-once",
      "inspect-agent-understanding",
    ],
    claims: ["one-config-file", "switch-without-reteaching"],
    boundary:
      "Hidden conversational state and proprietary provider features stay where they are; what the project owns is what was written into it.",
  },
  {
    id: "documentation-stops-being-owed",
    audience: "person",
    headline: "Documentation stops being something you owe",
    consequence:
      "The map is written by the agents that touched the code, under the Gate, and a page whose links, anchors, commands, or metadata break fails the next run. Documentation debt stops accruing unseen, and the person reads a current account of what their agents understand instead of writing one.",
    then: {
      statement:
        "The person audits understanding rather than output, and misunderstandings surface as correctable text before they surface as defects.",
      evidence: {
        class: "observational",
        source:
          "This repository's map is agent-maintained under the Gate, and its integrity checks run on every completed change.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "inspect-agent-understanding",
      "catch-documentation-breakage",
      "orient-new-session",
    ],
    claims: ["map-mechanically-checked"],
    boundary:
      "Mechanics are checked and conceptual currency is not; a page can be mechanically sound and still wrong.",
  },
  {
    id: "parallel-by-default",
    audience: "person",
    headline: "Parallel stops being a special occasion",
    consequence:
      "Every task gets its own checkout, a port hashed from its identity, its own declared database or emulator, and a way to wait on a sibling without a person in between. Running three things at once costs no setup beyond running one, so the default plan becomes parallel and serial becomes a choice.",
    then: {
      statement: "The person plans in waves rather than queues.",
      evidence: {
        class: "observational",
        source:
          "The Logbook's measured peak is nine branches in flight, and the founder's record is thirteen.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "parallel-work-on-one-machine",
      "wait-without-relay",
      "shape-substantial-work",
    ],
    claims: [
      "isolated-worktrees",
      "no-checkout-collisions",
      "shaped-delegation",
    ],
    boundary:
      "Real seams are still required, and two efforts can still change the same file; status names the overlap and the later landing re-reads it.",
  },
  {
    id: "ci-confirms-what-you-know",
    audience: "person",
    headline: "By the time CI runs, you already know",
    consequence:
      "The declared Gate ran locally on the exact tree before anything was shared, and checkpoint report mode lets CI show the same questions without answering them. CI becomes confirmation of a known result rather than the place a person first learns the change failed.",
    then: {
      statement: "The feedback loop moves from the pipeline to the worktree.",
      evidence: {
        class: "observational",
        source:
          "This repository lands a change only with Proof from the local Gate, and its hosted lane runs the same declared checks.",
        date: RECORDED,
      },
    },
    segments: ENGINEERS,
    restsOn: [
      "project-defined-completion",
      "useful-failures-sooner",
      "judgment-at-the-change",
    ],
    claims: ["proof-exact-tree", "setup-proves-worktree"],
    boundary:
      "discern is not CI and does not replace it. CI still verifies the shared change after the fact and can run the Gate itself.",
  },
  {
    id: "rewrite-the-app-keep-the-practice",
    audience: "person",
    headline: "Rewrite the app. Keep the practice.",
    consequence:
      "The practice ships none of the stack: jobs, Standards, scopes, and resources are whatever commands the project declares. A change of language, framework, or toolchain changes the declared commands and leaves the instructions, worktrees, Gate, map, and acceptance model in place.",
    then: {
      statement: "A platform migration stops threatening the way of working.",
      evidence: {
        class: "hypothesis",
        source: "No stack migration under discern is recorded.",
        date: RECORDED,
      },
    },
    segments: ENGINEERS,
    restsOn: ["practice-across-stacks", "build-on-published-contracts"],
    claims: ["one-config-file", "installs-a-practice"],
    boundary:
      "The project still owes discern its new commands and authored context; stack neutrality means nothing is sniffed or prescribed.",
  },
  {
    id: "try-it-where-it-matters",
    audience: "person",
    headline: "Try it on the project that matters",
    consequence:
      "discern is one binary, one root file, and no running service. Leaving costs one command and keeps every authored file. The exit is priced before the trial begins, so the trial can happen on the real repository.",
    then: {
      statement: "Adoption risk collapses to the time spent commissioning.",
      evidence: {
        class: "hypothesis",
        source:
          "No external adoption is recorded, and the demand entry on exit cost is itself a hypothesis.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "small-installation-footprint",
      "retain-work-after-uninstall",
      "agent-commissioning",
    ],
    claims: ["one-config-file", "no-manual-configuration", "no-model-inside"],
    boundary:
      "Commissioning is real agent work and may ask the person questions; a project that needs a human-provisioned secret or service resolves that first.",
  },
  {
    id: "get-serious-when-it-gets-real",
    audience: "person",
    headline: "Get serious the week it gets real",
    consequence:
      "The consequence threshold arrives without warning: the first paying user, the first collaborator, the first business process that depends on the app. Commissioning is same-day work by the agent, proven in a throwaway worktree before it counts as done, so seriousness can be installed the week it becomes necessary rather than planned for a quarter.",
    then: {
      statement:
        "The prototype becomes the product without a rewrite of the way it is built.",
      evidence: {
        class: "hypothesis",
        source: "No consequence-threshold adoption is recorded.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: [
      "agent-commissioning",
      "small-installation-footprint",
      "inspect-live-example",
    ],
    claims: [
      "installs-a-practice",
      "setup-proves-worktree",
      "no-manual-configuration",
    ],
    boundary:
      "Installation is not cultural transformation; the practice is as serious as the checks the project declares and the decisions the person makes.",
  },
  {
    id: "discipline-before-expertise",
    audience: "person",
    headline: "Discipline arrives before expertise, and expertise can follow",
    consequence:
      "Commissioning installs professional defaults a new builder has not learned to ask for, and the practice then teaches by asking: a checkpoint names the question an experienced engineer would raise, a Standard names the number that matters, and the map shows what the agents understand. The builder lives inside the categories of judgment before they can name them.",
    then: {
      statement: "The new builder's own discernment grows with the project.",
      evidence: {
        class: "hypothesis",
        source:
          "No new-builder adoption is recorded; this is the grows-your-discernment angle from the TODO.",
        date: RECORDED,
      },
    },
    segments: NEW_BUILDERS,
    restsOn: [
      "agent-commissioning",
      "judgment-at-the-change",
      "inspect-agent-understanding",
    ],
    claims: ["installs-a-practice", "no-manual-configuration"],
    boundary:
      "Engineering expertise keeps its value; the practice carries discipline and confers no credential.",
  },
  {
    id: "the-parts-multiply",
    audience: "person",
    headline: "The parts multiply",
    consequence:
      "Isolation alone gives parallel work, deterministic done alone gives a verdict, and authority alone gives a veto. Together, in one project, they give unattended landing, review that grows slower than output, and widening autonomy, none of which any part gives alone. Every subsystem is core, so every install carries the complete set.",
    then: {
      statement:
        "The engineer who could assemble each piece from Git, CI, linters, and prompts gets the compounding only from the connected practice.",
      evidence: {
        class: "hypothesis",
        source:
          "The assemble-it-myself objection is untested outside this repository.",
        date: RECORDED,
      },
    },
    segments: ENGINEERS,
    restsOn: [
      "inspect-live-example",
      "explicit-release-decision",
      "parallel-work-on-one-machine",
    ],
    claims: [
      "runs-on-itself",
      "installs-a-practice",
      "gate-grants-no-authority",
    ],
    boundary:
      "The claim is about connection; no single mechanism is claimed to be unavailable elsewhere.",
  },
  {
    id: "every-promise-comes-with-its-test",
    audience: "person",
    headline: "Every structural promise comes with its test",
    consequence:
      "Every public claim carries an inspectable basis, every structural claim names at least one guard test, and the guard cites the claim back, so the ledger and the Gate move together. The marketing is held to the same discipline as the code.",
    then: {
      statement:
        "A reader evaluating discern verifies the pitch the way they would verify a change: from the repository.",
      evidence: {
        class: "hypothesis",
        source: "No external reader has yet run a guard from the ledger.",
        date: RECORDED,
      },
    },
    segments: BOTH_SEGMENTS,
    restsOn: ["inspect-live-example"],
    claims: ["runs-on-itself"],
    boundary:
      "Guards defend structural claims. Demonstrated, observational, and hypothesis claims carry their own class and no such test.",
    note: "Best home: the trust page.",
  },
  {
    id: "stopping-is-safe",
    audience: "agent",
    headline: "Stopping is safe",
    consequence:
      "Proof defines done, a refusal names the next valid action, and a green Gate is not permission to land. A proven green tree is reusable without paying for it again, and an unchanged red one needs an explicit rerun. There is nothing to hedge, re-verify, or continue past.",
    then: {
      statement:
        "Defensive verification and continuation past usefulness lose their reason.",
      evidence: {
        class: "observational",
        source:
          "The done-thrash and skipped-prepare detectors exist because agents still over-verify, so the behavior is moving rather than settled.",
        date: RECORDED,
      },
    },
    restsOn: [
      "prove-the-exact-tree",
      "recover-from-a-truthful-refusal",
      "land-only-with-release-authority",
    ],
    claims: ["proof-exact-tree", "gate-grants-no-authority"],
    boundary:
      "Stopping is safe because the decision waits. The work is not thereby finished in every sense.",
  },
  {
    id: "the-gate-remembers",
    audience: "agent",
    headline: "The Gate remembers, so you don't have to",
    consequence:
      "A forcing-function guard fails the moment a new member lacks its projection, and a hint or gotcha arrives inside the result that made it relevant. Recall leaves the critical path for everything the project has encoded.",
    then: {
      statement:
        "Larger changes fit one context window, and a model with less memory can carry work that once needed a stronger model's.",
      evidence: {
        class: "hypothesis",
        source:
          "Nothing measures the context saved or the model floor; the shared hypothesis records the belief once.",
        date: RECORDED,
        shared: "capable-operators-at-lower-cost",
      },
    },
    restsOn: [
      "let-new-members-enrol-themselves",
      "recover-from-a-truthful-refusal",
      "load-only-the-context-needed",
    ],
    claims: ["agent-as-operator", "map-mechanically-checked"],
    boundary:
      "A guard proves declared structural completeness; whether the prose or behavior is the right product decision stays with review.",
  },
  {
    id: "sessions-come-and-go",
    audience: "agent",
    headline: "Sessions come and go. The effort stays.",
    consequence:
      "The effort's branch, identity, setup state, and evidence live with its worktree. A later session on any configured provider orients from one status call and continues; what the previous session held only in conversation does not come along.",
    then: {
      statement: "The person restarts freely and switches provider mid-effort.",
      evidence: {
        class: "observational",
        source:
          "The founder's account records switching providers mid-project, and three providers appear in the Logbook.",
        date: RECORDED,
      },
    },
    restsOn: [
      "resume-after-interruption",
      "orient-from-one-bounded-result",
      "switch-supported-agent-hosts",
      "own-one-isolated-effort",
    ],
    claims: ["switch-without-reteaching", "agent-as-operator"],
    boundary:
      "Sessions are interchangeable and efforts are not: a session continues the effort assigned to it and adopts no sibling's worktree because it looks idle. Any provider means any supported, configured provider, and a host may need a restart or MCP reload.",
    note:
      "Sequencing cheaper and stronger models on one branch rests on the shared hypothesis `capable-operators-at-lower-cost`. The positioning grid already approves the public form: start a task with one provider and finish it with another.",
  },
  {
    id: "each-red-run-points-at-the-fix",
    audience: "agent",
    headline: "Each red run points at the fix",
    consequence:
      "Every failure carries the command that reproduces it, dependent work stops when its premise fails, and the diagnostics name the cause. Each iteration receives a correction signal, and the local record counts red runs before the first green.",
    then: {
      statement:
        "Sessions self-correct, which makes smaller and local models viable operators.",
      evidence: {
        class: "hypothesis",
        source:
          "The loops-to-green detector counts red runs before the first green, and no comparison across model sizes is recorded.",
        date: RECORDED,
        shared: "capable-operators-at-lower-cost",
      },
    },
    restsOn: [
      "recover-from-a-truthful-refusal",
      "run-the-relevant-gate-efficiently",
      "use-a-fast-inner-loop",
    ],
    claims: ["no-model-inside"],
    boundary: "A missing or weak project check gives nothing to converge on.",
  },
  {
    id: "not-sure-is-a-valid-answer",
    audience: "agent",
    headline: "Not sure is a valid answer",
    consequence:
      "Scope classification fails open and says so, a checkpoint accepts a declared-unmet conclusion and routes it to the owner, and a fail-open drop stays in Proof as recorded uncertainty. The agent never has to manufacture confidence, because uncertainty is a recorded state with a defined next step.",
    then: {
      statement: "Agents stop rounding doubt up to done.",
      evidence: {
        class: "hypothesis",
        source:
          "Whether declared-unmet conclusions and fail-open drops change agent behavior is untested.",
        date: RECORDED,
      },
    },
    restsOn: [
      "carry-judgment-as-judgment",
      "see-the-change-discern-sees",
      "land-only-with-release-authority",
    ],
    claims: ["gate-grants-no-authority", "proof-exact-tree"],
    boundary:
      "A declared-unmet conclusion lands only under an owner-authorized variance; uncertainty is routed and the machine resolves none of it.",
  },
  {
    id: "judgment-recorded-as-judgment",
    audience: "agent",
    headline: "Your judgment is recorded as judgment",
    consequence:
      "A checkpoint conclusion travels with Proof as its own kind of evidence, separate from machine results: neither discarded as opinion nor laundered as verification. The agent has a legitimate place to exercise judgment, and the person can see where judgment carried the change and where checks did.",
    then: {
      statement:
        "Agent judgment becomes an inspectable artifact rather than a line in a transcript.",
      evidence: {
        class: "observational",
        source:
          "Proof lines in this repository carry declared checkpoint conclusions beside machine results.",
        date: RECORDED,
      },
    },
    restsOn: ["carry-judgment-as-judgment", "prove-the-exact-tree"],
    claims: ["proof-exact-tree", "no-model-inside"],
    boundary:
      "discern verifies the declaration's presence and binding and never its truth.",
  },
  {
    id: "coordination-through-the-repository",
    audience: "agent",
    headline: "Coordination runs through the repository",
    consequence:
      "A dependent agent blocks on a sibling being green, landed, or the trunk moving, and composes below the trunk from an explicit ref. Readiness is a repository fact, so a fleet can be dispatched in dependency order and sequence itself without a person carrying messages.",
    then: {
      statement:
        "Fleets sequence themselves, and the human hub leaves the coordination topology.",
      evidence: {
        class: "observational",
        source:
          "The founder's account records thirteen worktrees landing as one integration train with no person relaying readiness.",
        date: RECORDED,
      },
    },
    restsOn: [
      "compose-without-adopting-sibling-work",
      "own-one-isolated-effort",
    ],
    claims: ["shaped-delegation", "no-checkout-collisions"],
    boundary:
      "Seeing a sibling as idle, green, or authorized grants no right to adopt, land, prune, or discard it.",
  },
  {
    id: "run-it-again-nothing-doubles",
    audience: "agent",
    headline: "Run it again. Nothing doubles.",
    consequence:
      "Convergent verbs re-run safely and own their preconditions, every effectful verb plans before it applies, and provisioning records its intent before acting. A retry after an interruption converges on the intended state instead of stacking effects or leaving an unknown one.",
    then: {
      statement:
        "Preflight rituals and defensive state checks leave the agent's loop.",
      evidence: {
        class: "hypothesis",
        source: "No token or retry measurement exists.",
        date: RECORDED,
      },
    },
    restsOn: ["preview-and-retry-effects-safely", "resume-after-interruption"],
    claims: ["isolated-worktrees", "agent-as-operator"],
    boundary:
      "A dry run predicts discern's effects at that moment; external state may still change, so execution rechecks its preconditions.",
  },
  {
    id: "no-second-model-to-argue-with",
    audience: "agent",
    headline: "No second model to argue with",
    consequence:
      "discern contains no model and no network path, so the only parties in the loop are the project's deterministic verdicts and the person's authority. There is no AI reviewer's opinion to negotiate with, and a refusal is a fact about the tree rather than a judgment about the agent.",
    then: {
      statement: "Opinion-versus-opinion loops never start.",
      evidence: {
        class: "hypothesis",
        source:
          "The absence of such loops is a reasoned expectation without a recorded comparison.",
        date: RECORDED,
      },
    },
    restsOn: [
      "operate-without-a-hidden-model",
      "recover-from-a-truthful-refusal",
    ],
    claims: ["no-model-inside", "local-logbook"],
    boundary:
      "The agent's own host may use a remote model; the guarantee covers discern's execution path.",
  },
  {
    id: "unwritten-knowledge-on-record",
    audience: "agent",
    headline: "What nobody wrote down is still on record",
    consequence:
      "Coupling mines the repository's own commit history for files that habitually change together, with no configuration, and names the partners missing from the current change. Tacit knowledge becomes something an agent can query.",
    then: {
      statement:
        "The migration, fixture, or doc that always travels with a change stops being caught at review.",
      evidence: {
        class: "hypothesis",
        source:
          "The demand entry on habitual companion files is itself a hypothesis.",
        date: RECORDED,
      },
    },
    restsOn: ["diagnose-workflow-friction-locally"],
    claims: ["local-logbook"],
    boundary:
      "Co-change history is evidence of habit and does not prove a required relationship.",
  },
];

/** The consequences for one audience, in canon order. */
export function consequencesFor(
  audience: ConsequenceAudience,
): readonly Consequence<ClaimSlug>[] {
  return CONSEQUENCE_CANON.filter((entry) => entry.audience === audience);
}

/** Benefit titles by id for the audience's canon. */
function benefitTitles(audience: ConsequenceAudience): Map<string, string> {
  const entries = audience === "person"
    ? allHumanBenefitEntries().map(({ entry }) => entry)
    : allAgentBenefitEntries().map(({ entry }) => entry);
  return new Map(entries.map((entry) => [entry.id, entry.title]));
}

/** The title of a cited benefit, or throw — citations are held live by the guard. */
function restingTitle(titles: Map<string, string>, id: string): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`consequence rests on an unknown benefit: ${id}`);
  }
  return title;
}

/** Render one behavior-evidence row: class, source, date, and what it cites. */
function renderEvidence(evidence: ConsequenceEvidence): string {
  const base =
    `${evidence.class} — ${evidence.source} (recorded ${evidence.date})`;
  if (evidence.class === "corroborated") {
    return `${base} · corpus \`${evidence.corpus}\``;
  }
  if (evidence.shared !== undefined) {
    return `${base} · shared hypothesis [\`${evidence.shared}\`](#${evidence.shared})`;
  }
  return base;
}

/** Render one consequence as its labelled scan lines. */
function renderEntry(
  entry: Consequence<ClaimSlug>,
  titles: Map<string, string>,
): string[] {
  const lines = [
    `### ${entry.headline}`,
    "",
    `- **Consequence:** ${entry.consequence}`,
    `- **Then:** ${entry.then.statement}`,
    `- **Evidence:** ${renderEvidence(entry.then.evidence)}`,
  ];
  if (entry.audience === "person") {
    lines.push(`- **Segments:** ${entry.segments.join(", ")}`);
  }
  lines.push(
    `- **Rests on:** ${
      entry.restsOn.map((id) => restingTitle(titles, id)).join(" · ")
    }.`,
    `- **Claims:** ${
      entry.claims.map((slug) => `{{claim:${slug}}}`).join(" · ")
    }`,
    `- **Boundary:** ${entry.boundary}`,
  );
  if (entry.note !== undefined) {
    lines.push(`- **Note:** ${entry.note}`);
  }
  lines.push("");
  return lines;
}

/**
 * Render the consequence-canon page: the frame, the at-a-glance table, the
 * person's and the agent's consequences, the shared hypotheses, and the
 * coverage appendix. The brand registry stamps the banner and resolves
 * citation tokens.
 */
export function renderConsequenceCanonDoc(): string {
  const person = consequencesFor("person");
  const agent = consequencesFor("agent");
  const benefitsCited = new Set(
    CONSEQUENCE_CANON.flatMap((entry) =>
      entry.restsOn.map((id) => `${entry.audience}:${id}`)
    ),
  );
  const claimsCited = new Set(
    CONSEQUENCE_CANON.flatMap((entry) => entry.claims),
  );
  const classCounts = new Map<ConsequenceEvidenceClass, number>();
  for (const entry of CONSEQUENCE_CANON) {
    const { class: name } = entry.then.evidence;
    classCounts.set(name, (classCounts.get(name) ?? 0) + 1);
  }
  const classBreakdown = CONSEQUENCE_EVIDENCE_CLASS_NAMES.filter((name) =>
    classCounts.has(name)
  )
    .map((name) => `${name} ${classCounts.get(name)}`)
    .join(" · ");
  const counted = (count: number, singular: string, plural: string): string =>
    `${count} ${count === 1 ? singular : plural}`;
  const sharedCount = Object.keys(SHARED_HYPOTHESES).length;
  const lines: string[] = [
    "# Consequence canon",
    "",
    "_discern's internal account of what changes once the benefits hold. The [Human Benefit Canon](../feature-canon-human-benefits.md) and the [Agent Benefit Canon](../feature-canon-agent-benefits.md) reason forward from product facts to first-order value; a consequence reasons one step further, to what several benefits do together, over time, and in combination, for the person and for the coding agent. Each entry keeps two halves apart: the consequence is deductive on the benefits and the {{doc:claims-and-evidence}} claims it cites, and the predicted behavior after it carries dated evidence in the ledger's market classes, the same rule the {{doc:demand-canon}} applies to a struggling moment._",
    "",
    `${CONSEQUENCE_CANON.length} consequences · ${person.length} for the person · ${agent.length} for the agent · ${benefitsCited.size} benefits and ${claimsCited.size} claims cited · ${
      counted(sharedCount, "shared hypothesis", "shared hypotheses")
    } · behavior evidence: ${classBreakdown}.`,
    "",
    "## How to use this canon",
    "",
    "- Take the headline at headline altitude and the consequence at body altitude. The brand decision record on the owner and the agents licenses identity words and aspiration in a headline while body copy carries mechanism words and survives a hostile literal reading; the two fields are that split, so a page lifts the headline and supports it with the consequence.",
    "- Trust the consequence as far as the claims it cites, and no further. It inherits their evidence classes, their forbidden inferences, and the guards behind them, so a structural consequence is one the Gate defends.",
    "- Trust the predicted behavior no further than its own class. It uses the ledger's market classes only; a hypothesis is labelled as one on this page and never reaches a fact line or a headline row. A behavior several entries share is recorded once under Shared hypotheses and cited by id.",
    "- Read the boundary before lifting a line. It names the nearest forbidden inference in the words the ledger and the boundary canon already use, so a headline never outgrows its claim.",
    "- Use this canon to decide what a page argues over time; use the benefit canons for the value of one mechanism and the demand canon for the struggle a page opens on.",
    "",
    "## At a glance",
    "",
    "| Consequence | For | Behavior evidence |",
    "| --- | --- | --- |",
  ];
  for (const entry of CONSEQUENCE_CANON) {
    lines.push(
      `| ${entry.headline} | ${entry.audience} | ${entry.then.evidence.class} |`,
    );
  }
  lines.push("", "## For the person", "");
  const personTitles = benefitTitles("person");
  for (const entry of person) lines.push(...renderEntry(entry, personTitles));
  lines.push("## For the agent", "");
  const agentTitles = benefitTitles("agent");
  for (const entry of agent) lines.push(...renderEntry(entry, agentTitles));
  lines.push(
    "## Shared hypotheses",
    "",
    "A belief several consequences rest on is recorded once and cited by id from every entry it reaches, so reuse across entries stays one hypothesis rather than several. Each carries the limits that hold until validation.",
    "",
  );
  for (
    const [id, hypothesis] of Object.entries<SharedHypothesis>(
      SHARED_HYPOTHESES,
    )
  ) {
    const citedBy = CONSEQUENCE_CANON.filter((entry) =>
      entry.then.evidence.shared === id
    );
    lines.push(
      `### \`${id}\``,
      "",
      `**Statement:** ${hypothesis.statement}`,
      "",
      `**Cited by:** ${citedBy.map((entry) => entry.headline).join(" · ")}.`,
      "",
      `**Limits:** ${hypothesis.limits}`,
      "",
    );
  }
  lines.push(
    "## Coverage and traceability",
    "",
    "Every consequence rests on at least one live benefit of its audience's canon and cites at least one claim from the ledger, every predicted behavior carries dated evidence within the ledger's market classes, every shared hypothesis is cited by at least one entry, and no hypothesis-class behavior appears in the messaging inventory's fact lines or headlines. The guard (`tests/consequence_canon_test.ts`) holds all of it. Coverage runs one way: a benefit with no consequence above it is an ordinary benefit, and needs no record here.",
    "",
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
