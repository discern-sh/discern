/**
 * The practice registry and the generated practice canon — the practice's
 * tenets as DATA, rendered into the maintainer canon page and the public
 * orientation leaf the same way the feature canon renders from its registry
 * (the discipline of `feature_registry.ts` and `glossary_registry.ts`).
 *
 * The practice canon is the middle layer of the canon triptych: the feature
 * canon owns the MECHANISM account (what exists), the Human Benefit Canon owns
 * the VALUE account (what it is worth to people), the Agent Benefit Canon owns
 * coding-agent OUTCOMES, and this registry owns the OBLIGATIONS between them.
 * A tenet is statable without naming a single feature; its `mechanisms` cite
 * today's implementation, `yields` cite human value, and `agentYields` cite
 * the coding-agent outcomes it enables. Each tenet records how it is UPHELD:
 * enforced (a boundary refuses the violation), automated (the machinery
 * performs it unasked), or taught (a bundled skill carries it) — explicit
 * per tenet, never derived from a carrier's kind, because one verb enforces
 * for one tenet and automates for another.
 *
 * Three consumers:
 *  - `scripts/codegen.ts` renders {@link renderPracticeCanonDoc} and
 *    {@link renderPracticePublicDoc} into their committed map pages; the
 *    `[generated.codegen]` group and the enrolment guard's sync assertions
 *    hold the committed pages equal to the generator output.
 *  - the enrolment guard (`tests/practice_canon_enrolment_test.ts`) holds
 *    every bundled skill to a tenet claim, every citation to a live member,
 *    every feature pillar, human-benefit cluster, and coding-agent outcome to
 *    a claim or a recorded absence, the project inventory to full coverage,
 *    and each deferred consumer to its recorded fingerprint.
 *  - creative, technical, and marketing work reads {@link PRACTICE_CANON}
 *    (or the generated pages) instead of re-deriving the practice by hand.
 *
 * This module lives under `scripts/`, not `src/`: its strings are map prose,
 * and no part of the shipped binary reads it.
 */

import { join } from "@std/path";
import {
  allAgentBenefitEntries,
  allFeatureNodes,
  HUMAN_BENEFIT_CANON,
  parseSurfaceKey,
} from "./feature_registry.ts";
import { annotateProse } from "./canon_editor/annotation.ts";

/**
 * A rendering lens over the flat canon: `loop` tenets govern how work moves
 * through the practice, `craft` tenets govern what the work itself honors,
 * and `conduct` tenets govern how the practice behaves toward its operators.
 * The canon stays one flat, numbered list; surfaces group by arc when the
 * presentation wants strata.
 */
export type PracticeArc = "loop" | "craft" | "conduct";

/** The ways a tenet is upheld, in canonical rendering order. */
export const UPHELD_TIERS = ["enforced", "automated", "taught"] as const;
export type UpheldTier = (typeof UPHELD_TIERS)[number];

/**
 * How a tenet is upheld, per carrier key. Keys are written `set:member` like
 * the feature canon's `surfaces` — `verb:done`, `config:standards`,
 * `skill:discern-cure-a-bug`. Advisory and read-only surfaces serve a tenet
 * without upholding it — they belong in `mechanisms` only.
 */
export interface TenetUpheld {
  /** Boundaries that refuse the violation — `verb:` or `config:` keys. */
  enforced?: readonly string[];
  /** Machinery that performs the obligation unasked — `verb:` or `config:` keys. */
  automated?: readonly string[];
  /** Bundled skills that teach the discipline — `skill:` keys. */
  taught?: readonly string[];
}

/** The fixed project inventory, in its one canonical order. */
export const PROJECT_INVENTORY = [
  "instructions",
  "working conditions",
  "checks",
  "evidence",
  "decisions",
] as const;

/**
 * One item of the fixed project inventory — what the project holds for the
 * people and agents working in it. The public copy discipline keeps this
 * list verbatim wherever it appears; surfaces derive it from
 * {@link PROJECT_INVENTORY} instead of restating it.
 */
export type ProjectInventoryItem = (typeof PROJECT_INVENTORY)[number];

/** The inventory as the fixed public phrase: "its instructions, …, and its decisions". */
export function inventoryPhrase(): string {
  const items = PROJECT_INVENTORY.map((item) => `its ${item}`);
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** One role in the practice's frame: who holds what. */
export interface PracticeRole {
  id: "human" | "agent" | "project";
  title: string;
  /** What this participant holds or does, in one sentence. */
  line: string;
}

/**
 * The frame the tenets operate inside — the practice's constitutional
 * preamble: the human holds authority, agents operate, the project carries.
 */
export const PRACTICE_FRAME: readonly PracticeRole[] = [
  {
    id: "human",
    title: "The human",
    line:
      "You set the direction, make the calls only you can make, and hold the authority over what becomes shared.",
  },
  {
    id: "agent",
    title: "The agents",
    line:
      "Coding agents operate the practice: they inherit the project's instructions, carry the work, and answer to its checks.",
  },
  {
    id: "project",
    title: "The project",
    line:
      `The repository carries the practice — ${inventoryPhrase()} — across sessions, agents, and providers.`,
  },
];

/**
 * One tenet: an obligation the practice holds, stated without naming a
 * feature, then tied to how it is upheld, the features that implement it,
 * and the value it yields.
 */
export interface PracticeTenet {
  /** Stable kebab-case id, unique across the canon. */
  id: string;
  /** The display headline — short enough to cite, plain enough to defend. */
  title: string;
  /**
   * The belief the obligation follows from: one or two plain sentences that
   * name no carrier and no identifier. It reads at body altitude, so it must
   * survive a hostile literal reading, and it is the line that transfers to
   * the case no rule covers.
   */
  why: string;
  /** The obligation in one sentence. */
  obligation: string;
  /** A short mechanism story in the product register: how the obligation is kept. */
  body: string;
  /** The rendering lens this tenet belongs to. */
  arc: PracticeArc;
  /**
   * How the tenet is upheld, per carrier key. The enrolment guard holds
   * every key to a live member, skill keys to the `taught` tier alone, and
   * every bundled skill to a claim here (or a recorded absence).
   */
  upheld: TenetUpheld;
  /** Feature-node ids implementing the tenet today — explicit citations. */
  mechanisms: readonly string[];
  /** Human Benefit Canon cluster ids naming the value the tenet yields for people. */
  yields: readonly string[];
  /** Agent Benefit Canon entry ids naming the outcomes the tenet enables. */
  agentYields: readonly string[];
  /** The project-inventory items this tenet maintains; conduct tenets may maintain none. */
  holds: readonly ProjectInventoryItem[];
}

/**
 * The practice canon. The order is the canon: tenets are numbered by
 * position (1-based) — loop tenets in the order one change meets them, then
 * craft, then conduct. Nothing stores the number — a reordering is a canon
 * change.
 */
export const PRACTICE_CANON: readonly PracticeTenet[] = [
  {
    id: "arrive-knowing",
    title: "Arrive knowing",
    why:
      "Orientation is a cost every session pays, and the project can pay it once for all of them.",
    obligation:
      "Every session starts with the project's instructions, understanding, and methods already in hand.",
    body:
      "One authored instruction body compiles into every configured agent's instruction file, the map carries the project account, and skills hold the proven procedures. A fresh agent orients with one read-only call.",
    arc: "loop",
    upheld: {
      automated: ["verb:refresh", "config:instructions"],
    },
    mechanisms: [
      "instructions",
      "instructions-compile",
      "map",
      "discovery-funnel",
      "skills",
      "status",
    ],
    yields: ["keep-project-knowledge-working"],
    agentYields: [
      "orient-from-one-bounded-result",
      "inherit-current-agent-instructions",
      "recover-the-project-mental-model",
      "invoke-curated-project-procedures",
    ],
    holds: ["instructions"],
  },
  {
    id: "one-task-one-place",
    title: "One task, one place",
    why:
      "Efforts that share a checkout share a failure. Isolation is what makes running several at once safe.",
    obligation:
      "Every effort works in its own place: a separate checkout with its own identity, environment, and declared resources.",
    body:
      "Each effort forks from the trunk into a linked worktree with its own branch, port, environment values, and resources. Parallel agents cannot overwrite one another's tree, and the fleet view names file collisions before either change lands.",
    arc: "loop",
    upheld: {
      automated: ["verb:start", "verb:worktree", "config:worktree"],
    },
    mechanisms: [
      "worktrees",
      "start",
      "worktree-identity",
      "worktree-resources",
      "fleet",
    ],
    yields: ["build-further"],
    agentYields: ["own-one-isolated-effort"],
    holds: ["working conditions"],
  },
  {
    id: "hand-over-whole-pieces",
    title: "Hand over whole pieces",
    why:
      "A half-brief makes the person the courier. A complete one lets the work go without them.",
    obligation:
      "Work is delegated as complete, bounded briefs with declared dependencies, and the project carries status between tasks.",
    body:
      "The delegate-work skill turns discussed work into self-contained briefs (a purpose, a boundary, a definition of ready), each dispatched to its own worktree. A dependent task blocks on the repository's own state and composes below the trunk, so nobody relays readiness between sessions.",
    arc: "loop",
    upheld: {
      automated: ["verb:await"],
      taught: ["skill:discern-delegate-work", "skill:discern-await-the-fleet"],
    },
    mechanisms: [
      "skill-delegate-work",
      "await",
      "skill-await-the-fleet",
      "compose-below-trunk",
    ],
    yields: ["build-further"],
    agentYields: ["compose-without-adopting-sibling-work"],
    holds: ["working conditions"],
  },
  {
    id: "done-is-deterministic",
    title: "Done is deterministic",
    why: "An account of the work is not evidence of it, whoever gives it.",
    obligation:
      "The project's declared checks decide when work is done; an agent's confidence stays advisory.",
    body:
      "The gate runs the project's full declared check: the jobs by stage, the scope gates the change woke, and the standards. Agent conclusions remain separate from verified results. Every verdict is recomputed, and a failure carries the command that produced it, so the fix starts at the cause.",
    arc: "loop",
    upheld: {
      enforced: ["verb:done", "config:jobs", "config:gate"],
      automated: ["verb:prepare"],
    },
    mechanisms: [
      "gate",
      "jobs-table",
      "staged-pipeline",
      "scope-gates",
      "checkpoints",
      "diagnostics",
      "prepare",
    ],
    yields: ["know-what-is-ready"],
    agentYields: [
      "see-the-change-discern-sees",
      "run-the-relevant-gate-efficiently",
      "use-a-fast-inner-loop",
      "carry-judgment-as-judgment",
    ],
    holds: ["checks"],
  },
  {
    id: "only-better",
    title: "Only better",
    why: "A gain nothing holds is on loan, and the next change will spend it.",
    obligation:
      "Measured limits never loosen, captured gains become the new baseline, and the local record shows the next improvement.",
    body:
      "Standards hold each measured number at a limit compared against the trunk: a floor may only rise, a ceiling may only fall, and a branch that loosens either fails the gate. A pin captures a gain as the new limit; the advisory readers mine the local logbook for the next one.",
    arc: "loop",
    upheld: {
      enforced: ["config:standards"],
      automated: ["verb:standards"],
      taught: [
        "skill:discern-set-the-standard",
        "skill:discern-clear-the-decks",
      ],
    },
    mechanisms: [
      "standards",
      "standards-direction",
      "standards-pin",
      "logbook",
      "patterns",
      "improvement",
      "skill-set-the-standard",
      "skill-clear-the-decks",
    ],
    yields: ["make-improvement-accumulate"],
    agentYields: [
      "retain-earned-quality",
      "diagnose-workflow-friction-locally",
    ],
    holds: ["checks", "evidence"],
  },
  {
    id: "proof-binds-to-the-change",
    title: "Proof binds to the change",
    why:
      "Evidence is about one thing. Evidence that survives an edit is reassurance.",
    obligation:
      "Finished work returns with evidence naming the exact committed tree; any later edit expires it.",
    body:
      "A green gate over a clean, committed tree mints proof: the pinned commit, the changed files, the check results, the held standards. Acceptance writes it to the landed commit as a durable note, so the evidence outlives the worktree.",
    arc: "loop",
    upheld: {
      enforced: ["verb:done"],
      automated: ["config:repository"],
    },
    mechanisms: ["proof", "proof-notes", "unchanged-tree-rerun"],
    yields: ["know-what-is-ready"],
    agentYields: ["prove-the-exact-tree"],
    holds: ["evidence"],
  },
  {
    id: "you-decide-what-lands",
    title: "You decide what lands",
    why:
      "Ready and permitted are different questions, and only one of them belongs to a machine.",
    obligation:
      "A green gate makes a change eligible; landing takes fresh consent or a recorded grant, checked against the changed paths.",
    body:
      "Acceptance resolves its authority per invocation (a conversation attestation, a standing scope grant, or a one-shot effort grant) and refuses without one. What lands is the tree the gate validated, fast-forwarded onto the trunk.",
    arc: "loop",
    upheld: {
      enforced: ["verb:accept", "config:acceptance"],
    },
    mechanisms: ["accept", "consent-attestations"],
    yields: ["know-what-is-ready", "keep-control"],
    agentYields: ["land-only-with-release-authority"],
    holds: ["decisions"],
  },
  {
    id: "the-project-remembers",
    title: "The project remembers",
    why:
      "A lesson kept in a conversation is a lesson the next session learns again.",
    obligation:
      "Lessons, decisions, and methods are written into the project, where the next session starts; staleness is a defect.",
    body:
      "A correction becomes instructions, a decision becomes a record with its reasons, a procedure becomes a skill, and the map keeps the account agents work from, checked by every gate run. What one task teaches, the next inherits: the loop closes where it began.",
    arc: "loop",
    upheld: {
      enforced: ["config:map"],
      taught: [
        "skill:discern-teach-the-project",
        "skill:discern-write-adr",
        "skill:discern-document-subsystem",
        "skill:discern-place-a-checkpoint",
      ],
    },
    mechanisms: [
      "map",
      "adr-discipline",
      "docs-integrity",
      "map-freshness",
      "glossary-canon",
      "skill-teach-the-project",
      "skill-write-adr",
      "skill-document-subsystem",
      "skill-place-a-checkpoint",
    ],
    yields: ["keep-project-knowledge-working"],
    agentYields: [
      "recover-the-project-mental-model",
      "invoke-curated-project-procedures",
    ],
    holds: ["instructions", "decisions"],
  },
  {
    id: "cure-the-class",
    title: "Cure the class",
    why:
      "A bug is one member of a pattern, and fixing the member leaves the pattern alive.",
    obligation:
      "A bug is fixed at its class, with a proven cause and a permanent guard, so it cannot return unnoticed.",
    body:
      "The cure-a-bug skill requires the cause proven, the fix applied to every member of the class, and a guard driven from the class's single source left in the gate, so a future member enrols the moment it exists.",
    arc: "craft",
    upheld: {
      taught: ["skill:discern-cure-a-bug"],
    },
    mechanisms: ["skill-cure-a-bug", "forcing-functions"],
    yields: ["make-improvement-accumulate"],
    agentYields: [
      "invoke-curated-project-procedures",
      "let-new-members-enrol-themselves",
    ],
    holds: ["checks"],
  },
  {
    id: "write-it-once",
    title: "Write it once",
    why:
      "A fact kept in two places will disagree with itself, and the only question is when.",
    obligation:
      "Every shared fact has one authority; copies are generated from it, and a declared copy that drifts fails the gate.",
    body:
      "The write-it-once skill carries the discipline discern builds itself with: one authority per fact with bound consumers, guards that enrol future members, effects planned before they run. Generated artifacts regenerate from their sources, and the gate fails a copy that drifted.",
    arc: "craft",
    upheld: {
      enforced: ["config:generated"],
      taught: ["skill:discern-write-it-once"],
    },
    mechanisms: [
      "skill-write-it-once",
      "generated-artifact-declarations",
      "canonical-sets",
    ],
    yields: ["keep-project-knowledge-working"],
    agentYields: ["let-new-members-enrol-themselves"],
    holds: ["checks"],
  },
  {
    id: "no-dead-ends",
    title: "No dead ends",
    why: "A refusal that names no next step leaves the operator guessing.",
    obligation:
      "Every result is structured and bounded, every refusal names the next valid action, and advice never blocks.",
    body:
      "Every verb returns one structured result: the state, the diagnostics with the command that reproduces each failure, and the hints that apply at that moment. A refusal names its recovery instead of leaving a dead end, and advisory surfaces inform without changing a verdict.",
    arc: "conduct",
    upheld: {
      automated: ["verb:mcp"],
    },
    mechanisms: [
      "interfaces",
      "result-envelope",
      "idempotent-verbs",
      "forgiving-cli",
      "diagnostics",
      "hints",
      "gotchas-pointer",
      "relay-messages",
      "agent-is-user",
      "context-budget",
      "mcp-surface",
    ],
    yields: ["return-human-attention"],
    agentYields: [
      "orient-from-one-bounded-result",
      "recover-from-a-truthful-refusal",
      "load-only-the-context-needed",
      "operate-as-the-primary-user",
    ],
    holds: [],
  },
  {
    id: "plan-then-apply",
    title: "Plan, then apply",
    why:
      "An effect the operator cannot preview is one they cannot trust, and an interruption must leave a state they can return to.",
    obligation:
      "Nothing mutates without a plan; writes land only where placement licenses them, and an interruption leaves a recoverable state.",
    body:
      "Every effectful verb computes a plan a thin executor applies, so a dry run is a faithful preview. Writes land only where placement licenses them, provisioning records its intent before acting, and a crash or kill leaves a machine you would still want to work on.",
    arc: "conduct",
    upheld: {
      enforced: ["verb:done"],
      automated: ["verb:worktree"],
    },
    mechanisms: [
      "plan-apply",
      "placement-consent",
      "write-preflight",
      "strand-detection",
      "crash-safe-provisioning",
      "drop-recovery",
      "worktree-prune",
      "interruption-safety",
      "ignored-drift",
    ],
    yields: ["keep-control"],
    agentYields: [
      "resume-after-interruption",
      "preview-and-retry-effects-safely",
    ],
    holds: [],
  },
];

/**
 * Bundled skills kept out of the tenets' taught tiers, each with the reason.
 * The enrolment guard holds every bundled skill to exactly one of: claimed
 * by a tenet, or recorded here with a non-blank reason.
 */
export const PRACTICE_DELIBERATELY_ABSENT: Readonly<Record<string, string>> =
  {};

/**
 * Feature pillars no tenet or property cites, each with the reason. A pillar
 * counts as claimed when any tenet or property mechanism cites the pillar or
 * one of its descendants.
 */
export const PRACTICE_PILLAR_ABSENCES: Readonly<Record<string, string>> = {};

/**
 * Benefit clusters no tenet or property yields, each with the reason. The
 * enrolment guard holds every cluster to a yield or a recorded absence.
 */
export const PRACTICE_CLUSTER_ABSENCES: Readonly<Record<string, string>> = {
  "put-practice-in-place":
    "the commissioning corollary: the setup conversation is the loop applied to its own installation, so this value follows from the practice existing rather than from a separate obligation",
};

/**
 * Agent-benefit outcomes no tenet or property enables, each with the reason.
 * The enrolment guard holds every outcome to a yield or a recorded absence.
 */
export const PRACTICE_AGENT_BENEFIT_ABSENCES: Readonly<
  Record<string, string>
> = {};

/** One property: what kind of thing the practice is, distinct from what it obliges. */
export interface PracticeProperty {
  /** Stable kebab-case id, unique across the canon. */
  id: string;
  title: string;
  /** The property in one sentence. */
  line: string;
  /** Feature-node ids grounding the property. */
  mechanisms: readonly string[];
  /** Human-benefit cluster ids the property produces, where the value is the nature itself. */
  yields?: readonly string[];
  /** Agent-benefit outcome ids the property produces through its nature. */
  agentYields?: readonly string[];
}

/**
 * The properties around the tenets — the practice's nature rather than its
 * obligations. Trust surfaces render from these; none is a tenet because
 * none obliges a change to anything.
 */
export const PRACTICE_PROPERTIES: readonly PracticeProperty[] = [
  {
    id: "local",
    title: "Local",
    line:
      "The practice runs on the machine: verdicts come from the project's own commands, and the working record never leaves it.",
    mechanisms: ["local-evidence", "logbook"],
    agentYields: ["diagnose-workflow-friction-locally"],
  },
  {
    id: "no-model-inside",
    title: "No model inside",
    line:
      "discern contains no model and needs no API key; the agent supplies the intelligence, and the practice supplies the conditions.",
    mechanisms: ["no-model-inside"],
    agentYields: ["operate-without-a-hidden-model"],
  },
  {
    id: "ordinary-files",
    title: "Ordinary files, yours",
    line:
      "The practice lives in repository files: one root configuration plus the instructions, methods, and decisions it records, all readable and all project-owned.",
    mechanisms: ["one-file-footprint", "ownership-buckets"],
    agentYields: ["recover-the-project-mental-model"],
  },
  {
    id: "stack-neutral",
    title: "Stack-neutral",
    line:
      "The practice ships none of the project's stack: the gate, scopes, standards, and resources run whatever commands the project declares.",
    mechanisms: ["stack-neutral"],
    yields: ["change-tools-without-starting-over"],
    agentYields: ["apply-one-practice-to-any-stack"],
  },
  {
    id: "provider-neutral",
    title: "Provider-neutral",
    line:
      "Every supported agent works through the same project-owned practice, so changing providers never means starting the project over.",
    mechanisms: ["providers", "instructions-compile"],
    yields: ["change-tools-without-starting-over"],
    agentYields: ["switch-supported-agent-hosts"],
  },
  {
    id: "reversible",
    title: "Reversible",
    line:
      "Leaving costs one command and loses no authored work: the wiring goes, and the practice's files stay.",
    mechanisms: ["uninstall"],
    agentYields: ["manage-the-installation-lifecycle"],
  },
];

/** One public surface that still hand-carries practice prose, pinned by fingerprint. */
export interface DeferredConsumer {
  /** Stable kebab-case id. */
  id: string;
  /** Repo-relative file the practice prose lives in. */
  file: string;
  /** What the pinned slice is, in one phrase. */
  what: string;
  /** SHA-256 (hex) of the pinned slice; the guard recomputes and compares. */
  sha256: string;
  /** The condition that retires the deferral. */
  until: string;
}

/**
 * Surfaces that explain the practice but do not yet render or cite this
 * canon. Each pins its practice prose by fingerprint: changing the prose
 * without aligning it with the canon (or re-recording the fingerprint with
 * the change) fails the enrolment guard, so a deferral cannot be forgotten.
 */
export const PRACTICE_DEFERRED_CONSUMERS: readonly DeferredConsumer[] = [
  {
    id: "brand-concept-row",
    file: "scripts/brand/bridge.ts",
    what: "the practice row of the brand concept map",
    sha256: "3b10f7c90a12f5d12e2390e590c8ca955364243b9ea1edab46ca959036c28b71",
    until: "the brand registry derives its practice row from this canon",
  },
  {
    id: "machine-edition-loop",
    file: "site/text/discern.txt",
    what: "the practice block of the machine edition",
    sha256: "aa6651f9d54237450e47041ad2b7c26dc565bb506ffd9638d02bc8173bfa8c90",
    until: "the machine edition renders its practice block from this canon",
  },
];

/** Split a carrier key, or throw: the registry is data the guards depend on. */
export function parseCarrier(key: string): { set: string; member: string } {
  const parsed = parseSurfaceKey(key);
  if (parsed === undefined) {
    throw new Error(`malformed practice carrier key: ${key}`);
  }
  return parsed;
}

/** A tenet's upheld tiers with their keys, present tiers only, in canonical order. */
export function upheldEntries(
  tenet: PracticeTenet,
): readonly { tier: UpheldTier; keys: readonly string[] }[] {
  return UPHELD_TIERS
    .map((tier) => ({ tier, keys: tenet.upheld[tier] ?? [] }))
    .filter(({ keys }) => keys.length > 0);
}

/** Every carrier key a tenet claims, across its tiers. */
export function allUpheldKeys(tenet: PracticeTenet): readonly string[] {
  return upheldEntries(tenet).flatMap(({ keys }) => [...keys]);
}

/** Where the generated practice-canon page lives inside the map. */
export const PRACTICE_CANON_PAGE_REL: string = join(
  "_internal",
  "practice-canon.md",
);

/** Where the generated public practice page lives inside the map. */
export const PRACTICE_PUBLIC_PAGE_REL: string = join(
  "00-orientation",
  "the-practice.md",
);

/** The banner stamped atop the generated practice pages. */
const PRACTICE_DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the practice registry (scripts/practice_registry.ts) — do NOT edit by hand. Change a tenet there and regenerate. -->";

/** The feature-node titles by id, for resolving `mechanisms` citations loudly. */
function featureTitlesById(): Map<string, string> {
  return new Map(
    allFeatureNodes().map(({ node }) => [node.id, node.title]),
  );
}

/** Resolve one cited feature id to its title, or throw on a stranded citation. */
function citedFeatureTitle(titles: Map<string, string>, id: string): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`practice canon cites unknown feature node: ${id}`);
  }
  return title;
}

/** Resolve one cited benefit-cluster id to its title, or throw. */
function citedClusterTitle(id: string): string {
  const cluster = HUMAN_BENEFIT_CANON.find((entry) => entry.id === id);
  if (cluster === undefined) {
    throw new Error(`practice canon cites unknown benefit cluster: ${id}`);
  }
  return cluster.title;
}

/** The coding-agent outcome titles by id, for resolving practice yields loudly. */
function agentBenefitTitlesById(): Map<string, string> {
  return new Map(
    allAgentBenefitEntries().map(({ entry }) => [entry.id, entry.title]),
  );
}

/** Resolve one cited coding-agent outcome id to its title, or throw. */
function citedAgentBenefitTitle(
  titles: Map<string, string>,
  id: string,
): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`practice canon cites unknown agent benefit: ${id}`);
  }
  return title;
}

/** A key rendered as a code span: `done`, `[standards]`, `discern-cure-a-bug`. */
function carrierSpan(key: string): string {
  const { set, member } = parseCarrier(key);
  return set === "config" ? `\`[${member}]\`` : `\`${member}\``;
}

/** One tenet's "Upheld" line: each present tier with its named carriers. */
function upheldLine(tenet: PracticeTenet): string {
  const phrasing: Record<UpheldTier, string> = {
    enforced: "enforced via",
    automated: "automated via",
    taught: "taught by",
  };
  return upheldEntries(tenet)
    .map(({ tier, keys }) =>
      `${phrasing[tier]} ${keys.map(carrierSpan).join(", ")}`
    )
    .join(" · ");
}

/**
 * Route one tenet field through Canon Editor's provenance channel; outside
 * Canon Editor the text passes through unchanged.
 */
function tenetProse(tenet: PracticeTenet, field: string, text: string): string {
  return annotateProse(text, { registry: "practice", entry: tenet.id, field });
}

/** The 1-based number of a tenet id; throws on an id the canon does not carry. */
function tenetNumber(id: string): number {
  const index = PRACTICE_CANON.findIndex((tenet) => tenet.id === id);
  if (index === -1) throw new Error(`practice canon has no tenet: ${id}`);
  return index + 1;
}

/**
 * Render the practice-canon page: the frame, the numbered tenets with their
 * upheld tiers, mechanisms, value, and inventory, the properties, the
 * derived inventory coverage, and the traceability appendix.
 */
export function renderPracticeCanonDoc(): string {
  const titles = featureTitlesById();
  const agentBenefitEntries = allAgentBenefitEntries();
  const agentBenefitTitles = agentBenefitTitlesById();
  const citedNodes = new Set(
    PRACTICE_CANON.flatMap((tenet) => [...tenet.mechanisms]).concat(
      PRACTICE_PROPERTIES.flatMap((property) => [...property.mechanisms]),
    ),
  );
  const yieldedClusters = new Set(
    PRACTICE_CANON.flatMap((tenet) => [...tenet.yields]).concat(
      PRACTICE_PROPERTIES.flatMap((property) => [...(property.yields ?? [])]),
    ),
  );
  const yieldedAgentBenefits = new Set(
    PRACTICE_CANON.flatMap((tenet) => [...tenet.agentYields]).concat(
      PRACTICE_PROPERTIES.flatMap((property) => [
        ...(property.agentYields ?? []),
      ]),
    ),
  );
  const claimedSkills = new Set(
    PRACTICE_CANON.flatMap((tenet) => allUpheldKeys(tenet))
      .map((key) => parseCarrier(key))
      .filter(({ set }) => set === "skill")
      .map(({ member }) => member),
  );
  const lines: string[] = [
    PRACTICE_DOCS_BANNER,
    "",
    "# Practice canon",
    "",
    "_The practice, enumerated: the obligations discern holds for every change and for its own conduct, stated without naming a feature, then tied to the features that implement them and the outcomes they produce. The [feature canon](feature-canon.md) owns the mechanism account, the [Human Benefit Canon](feature-canon-human-benefits.md) owns the human value, and the [Agent Benefit Canon](feature-canon-agent-benefits.md) owns coding-agent outcomes; this canon owns the obligations between them. Surfaces that explain the practice (site pages, the machine edition, orientation prose) render or cite these tenets instead of re-deriving the practice._",
    "",
    `${PRACTICE_CANON.length} tenets · ${claimedSkills.size} bundled skills claimed · ${citedNodes.size} feature nodes cited · ${yieldedClusters.size} of ${HUMAN_BENEFIT_CANON.length} human-benefit clusters yielded · ${yieldedAgentBenefits.size} of ${agentBenefitEntries.length} coding-agent outcomes enabled · ${PRACTICE_PROPERTIES.length} properties.`,
    "",
    "## The frame",
    "",
    "The tenets operate inside one relationship:",
    "",
  ];
  for (const role of PRACTICE_FRAME) {
    lines.push(`- **${role.title}** — ${role.line}`);
  }
  lines.push(
    "",
    "## The tenets",
    "",
    "Numbered by position. `loop` tenets govern how work moves, `craft` tenets govern what the work honors, and `conduct` tenets govern how the practice behaves toward its operators. A tenet is **enforced** (a boundary refuses the violation), **automated** (the machinery performs it without being asked), **taught** (a bundled skill carries it), or a combination.",
    "",
  );
  PRACTICE_CANON.forEach((tenet, index) => {
    const mechanisms = tenet.mechanisms
      .map((id) => citedFeatureTitle(titles, id))
      .join(" · ");
    const yields = tenet.yields.map(citedClusterTitle).join(" · ");
    const agentYields = tenet.agentYields
      .map((id) => citedAgentBenefitTitle(agentBenefitTitles, id))
      .join(" · ");
    lines.push(
      `### ${index + 1}. ${tenetProse(tenet, "title", tenet.title)}`,
      "",
      tenetProse(tenet, "why", tenet.why),
      "",
      `> ${tenetProse(tenet, "obligation", tenet.obligation)}`,
      "",
      tenetProse(tenet, "body", tenet.body),
      "",
      `- **Arc:** ${tenet.arc}`,
      `- **Upheld:** ${upheldLine(tenet)}`,
      `- **Mechanisms:** ${mechanisms}.`,
      `- **Human value:** ${yields}.`,
      `- **Agent outcomes:** ${agentYields}.`,
    );
    if (tenet.holds.length > 0) {
      lines.push(
        `- **Maintains:** ${
          tenet.holds.map((item) => `its ${item}`).join(", ")
        }.`,
      );
    }
    lines.push("");
  });
  lines.push(
    "## Properties",
    "",
    "What kind of thing the practice is — its nature rather than its obligations. None is a tenet, because none obliges a change to anything.",
    "",
  );
  for (const property of PRACTICE_PROPERTIES) {
    const mechanisms = property.mechanisms
      .map((id) => citedFeatureTitle(titles, id))
      .join(" · ");
    const humanYields = (property.yields ?? []).map(citedClusterTitle);
    const agentYields = (property.agentYields ?? []).map((id) =>
      citedAgentBenefitTitle(agentBenefitTitles, id)
    );
    lines.push(
      `### ${property.title}`,
      "",
      property.line,
      "",
      `- **Mechanisms:** ${mechanisms}.`,
    );
    if (humanYields.length > 0) {
      lines.push(`- **Human value:** ${humanYields.join(" · ")}.`);
    }
    if (agentYields.length > 0) {
      lines.push(`- **Agent outcomes:** ${agentYields.join(" · ")}.`);
    }
    lines.push("");
  }
  lines.push(
    "",
    "## The inventory",
    "",
    `The project holds ${inventoryPhrase()} — the fixed list public copy repeats verbatim. Each item is maintained by the tenets that claim it:`,
    "",
  );
  for (const item of PROJECT_INVENTORY) {
    const maintainers = PRACTICE_CANON
      .map((tenet, index) => ({ tenet, index }))
      .filter(({ tenet }) => tenet.holds.includes(item))
      .map(({ tenet, index }) => `${index + 1}. ${tenet.title}`)
      .join(" · ");
    lines.push(`- **its ${item}** — ${maintainers}`);
  }
  lines.push(
    "",
    "## Coding-agent outcome index",
    "",
    "Each Agent Benefit Canon outcome points back to the tenets or properties that produce it. A new outcome enters this index from the Agent Benefit Canon and fails the enrolment guard until the practice claims it or records why it does not follow from the practice.",
    "",
  );
  for (const { entry } of agentBenefitEntries) {
    const carriers = [
      ...PRACTICE_CANON.map((tenet, index) => ({ tenet, index }))
        .filter(({ tenet }) => tenet.agentYields.includes(entry.id))
        .map(({ tenet, index }) => `${index + 1}. ${tenet.title}`),
      ...PRACTICE_PROPERTIES
        .filter((property) => property.agentYields?.includes(entry.id) ?? false)
        .map((property) => `Property: ${property.title}`),
    ];
    const absent = PRACTICE_AGENT_BENEFIT_ABSENCES[entry.id];
    if (carriers.length === 0 && absent === undefined) {
      throw new Error(
        `practice canon has no carrier or absence for agent benefit: ${entry.id}`,
      );
    }
    lines.push(
      `- **${entry.title}** — ${
        carriers.length > 0
          ? carriers.join(" · ")
          : `recorded absent: ${absent ?? ""}`
      }`,
    );
  }
  lines.push(
    "",
    "## Coverage",
    "",
    `Every bundled skill is claimed by a tenet or recorded absent; every carrier, mechanism, and yield names a live member; every tenet enables a coding-agent outcome; every feature pillar, human-benefit cluster, and agent-benefit outcome is claimed or recorded absent; every inventory item has a maintainer; and each deferred consumer is pinned by fingerprint. The guard (\`tests/practice_canon_enrolment_test.ts\`) holds all of it, and the loop closes structurally: what tenet ${
      tenetNumber("the-project-remembers")
    } deposits, tenet ${
      tenetNumber("arrive-knowing")
    } hands to the next session.`,
    "",
    "### Recorded absences",
    "",
  );
  const absenceGroups: readonly {
    label: string;
    record: Readonly<Record<string, string>>;
    none: string;
  }[] = [
    {
      label: "Bundled skills",
      record: PRACTICE_DELIBERATELY_ABSENT,
      none: "every bundled skill is claimed by at least one tenet",
    },
    {
      label: "Feature pillars",
      record: PRACTICE_PILLAR_ABSENCES,
      none: "every pillar is cited by a tenet or property, at some resolution",
    },
    {
      label: "Human-benefit clusters",
      record: PRACTICE_CLUSTER_ABSENCES,
      none: "every cluster is yielded by a tenet or property",
    },
    {
      label: "Agent-benefit outcomes",
      record: PRACTICE_AGENT_BENEFIT_ABSENCES,
      none: "every outcome is enabled by a tenet or property",
    },
  ];
  for (const group of absenceGroups) {
    const entries = Object.entries(group.record);
    if (entries.length === 0) {
      lines.push(`- **${group.label}** — none: ${group.none}.`);
    } else {
      for (const [member, reason] of entries) {
        lines.push(`- **${group.label}** — \`${member}\`: ${reason}.`);
      }
    }
  }
  lines.push(
    "",
    "### Deferred consumers",
    "",
    "Surfaces that still hand-carry practice prose, pinned by fingerprint until they render or cite this canon:",
    "",
  );
  for (const consumer of PRACTICE_DEFERRED_CONSUMERS) {
    lines.push(
      `- \`${consumer.file}\` — ${consumer.what}; deferred until ${consumer.until}.`,
    );
  }
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Render the public practice page: the tenets in the documentation register,
 * for the manual's orientation section. The public projection of the same
 * canon — frame, numbered tenets with their obligations and bodies, and the
 * inventory line — without the maintainer page's traceability.
 */
export function renderPracticePublicDoc(): string {
  const lines: string[] = [
    "---",
    "title: The practice",
    "description: The tenets discern holds for every change, numbered and citable.",
    "order: 50",
    "aliases:",
    "  - the practice",
    "  - practice",
    "  - tenets",
    "---",
    "",
    PRACTICE_DOCS_BANNER,
    "",
    "# The practice",
    "",
    "_The [practice](glossary.md#practice) discern installs, as numbered tenets: the obligations that hold for every change, and for the practice's own conduct. The [concepts page](concepts.md) tours the mechanisms; this page states what they add up to._",
    "",
    "The tenets operate inside one relationship:",
    "",
  ];
  for (const role of PRACTICE_FRAME) {
    lines.push(`- **${role.title}** — ${role.line}`);
  }
  lines.push("");
  PRACTICE_CANON.forEach((tenet, index) => {
    lines.push(
      `### ${index + 1}. ${tenetProse(tenet, "title", tenet.title)}`,
      "",
      tenetProse(tenet, "why", tenet.why),
      "",
      `> ${tenetProse(tenet, "obligation", tenet.obligation)}`,
      "",
      tenetProse(tenet, "body", tenet.body),
      "",
    );
  });
  lines.push(
    `The tenets maintain what the project holds: ${inventoryPhrase()}.`,
    "",
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
