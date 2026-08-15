/**
 * The practice registry and the generated practice canon — the practice's
 * tenets as DATA, rendered into the maintainer canon page the same way the
 * feature canon renders from its registry (the discipline of
 * `feature_registry.ts` and `glossary_registry.ts`).
 *
 * The practice canon is the middle layer of the canon triptych: the feature
 * canon owns the MECHANISM account (what exists), the benefit canon owns the
 * VALUE account (what it is worth), and this registry owns the OBLIGATIONS
 * between them — what the practice requires of every change, whichever
 * features implement it and whatever value follows. A tenet is statable
 * without naming a single feature; its `mechanisms` then cite today's
 * implementation and its `yields` the value it produces.
 *
 * Three consumers:
 *  - `scripts/codegen.ts` renders {@link renderPracticeCanonDoc} into the
 *    map's committed `_internal/practice-canon.md`; the `[generated.codegen]`
 *    group and the enrolment guard's sync assertion hold the committed page
 *    equal to the generator output.
 *  - the enrolment guard (`tests/practice_canon_enrolment_test.ts`) holds
 *    every bundled skill to a tenet claim (the taught stratum cannot lag the
 *    skill set), every citation to a live member, and the project inventory
 *    to full tenet coverage.
 *  - creative, technical, and marketing work reads {@link PRACTICE_CANON}
 *    (or the generated page) instead of re-deriving the practice by hand.
 *
 * This module lives under `scripts/`, not `src/`: its strings are map prose,
 * and no part of the shipped binary reads it.
 */

import { join } from "@std/path";
import {
  allFeatureNodes,
  BENEFIT_CANON,
  parseSurfaceKey,
} from "./feature_registry.ts";

/**
 * A rendering lens over the flat canon: `loop` tenets govern how work moves
 * through the practice, `craft` tenets govern what the work itself honors.
 * The canon stays one flat, numbered list; surfaces group by arc when the
 * presentation wants strata.
 */
export type PracticeArc = "loop" | "craft";

/**
 * How a tenet is held. Derived from its carriers, never stored: an engine
 * carrier (a verb or config table) means a machine boundary refuses the
 * violation; a skill carrier means a bundled skill teaches the discipline.
 */
export type TenetHold = "engine" | "taught";

/**
 * One item of the fixed project inventory — what the project holds for the
 * people and agents working in it. The public copy discipline keeps this
 * list verbatim wherever it appears; surfaces derive it from
 * {@link PROJECT_INVENTORY} instead of restating it.
 */
export type ProjectInventoryItem =
  | "guidance"
  | "working conditions"
  | "checks"
  | "evidence"
  | "decisions";

/** The fixed inventory, in its one canonical order. */
export const PROJECT_INVENTORY: readonly ProjectInventoryItem[] = [
  "guidance",
  "working conditions",
  "checks",
  "evidence",
  "decisions",
];

/** The inventory as the fixed public phrase: "its guidance, …, and its decisions". */
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
      "Coding agents operate the practice day to day: they inherit the project's guidance, carry the work, and answer to its checks.",
  },
  {
    id: "project",
    title: "The project",
    line:
      `The repository carries the practice — ${inventoryPhrase()} — across sessions, agents, and providers.`,
  },
];

/**
 * One tenet: an obligation the practice holds for every change, stated
 * without naming a feature, then tied to the features that implement it and
 * the value it yields.
 */
export interface PracticeTenet {
  /** Stable kebab-case id, unique across the canon. */
  id: string;
  /** The display headline — short enough to cite, plain enough to defend. */
  title: string;
  /** The obligation in one sentence: what holds for every change. */
  obligation: string;
  /** A short mechanism story in the product register: how the obligation is kept. */
  body: string;
  /** The rendering lens this tenet belongs to. */
  arc: PracticeArc;
  /**
   * The named holders, written `set:member` like the feature canon's
   * `surfaces` — `verb:done`, `config:standards`, `skill:discern-cure-a-bug`.
   * A carrier holds the obligation: an engine carrier refuses or defaults the
   * compliant path, a skill carrier teaches it. Advisory and read-only
   * surfaces serve a tenet without holding it — they belong in `mechanisms`
   * only. The enrolment guard holds every carrier to a live member, and
   * every bundled skill to a carrier here (or a recorded absence).
   */
  carriers: readonly string[];
  /** Feature-node ids implementing the tenet today — explicit citations. */
  mechanisms: readonly string[];
  /** Benefit-cluster ids naming the value the tenet yields. */
  yields: readonly string[];
  /** The project-inventory items this tenet maintains. */
  holds: readonly ProjectInventoryItem[];
}

/**
 * The practice canon. The order is the canon: tenets are numbered by
 * position (1-based), loop tenets in the order one change meets them, craft
 * tenets after. Nothing stores the number — a reordering is a canon change.
 */
export const PRACTICE_CANON: readonly PracticeTenet[] = [
  {
    id: "arrive-knowing",
    title: "Arrive knowing",
    obligation:
      "Every session starts with the project's guidance, understanding, and methods already in hand.",
    body:
      "One authored guidance body compiles into every configured agent's instruction file, the map carries the account of the project agents work from, and skills put the proven procedures where a session finds them. A fresh agent orients with one read-only call instead of an interrogation of the codebase.",
    arc: "loop",
    carriers: ["verb:refresh", "config:guidance"],
    mechanisms: [
      "guidance",
      "guidance-compile",
      "map",
      "discovery-funnel",
      "skills",
      "status",
    ],
    yields: ["keep-project-knowledge-working"],
    holds: ["guidance"],
  },
  {
    id: "one-task-one-place",
    title: "One task, one place",
    obligation:
      "Every effort works in its own isolated place: a separate checkout with its own identity, environment, and declared resources.",
    body:
      "Each effort forks from the trunk into a linked worktree with a deterministic identity — its own branch, port, environment values, and resources. Parallel agents cannot overwrite one another's tree, and the fleet view names cross-effort file collisions before either change lands.",
    arc: "loop",
    carriers: ["verb:start", "verb:worktree", "config:worktree"],
    mechanisms: [
      "worktrees",
      "start",
      "worktree-identity",
      "worktree-resources",
      "fleet",
    ],
    yields: ["build-further"],
    holds: ["working conditions"],
  },
  {
    id: "hand-over-whole-pieces",
    title: "Hand over whole pieces",
    obligation:
      "Work is delegated as complete, bounded briefs with declared dependencies, and the project carries status between tasks.",
    body:
      "The delegate-work skill turns discussed work into self-contained briefs (a purpose, a boundary, a definition of ready), each dispatched to its own worktree. A dependent task blocks on the repository's own state and composes below the trunk from the commit it needs, so nobody relays readiness between sessions.",
    arc: "loop",
    carriers: [
      "skill:discern-delegate-work",
      "skill:discern-await-the-fleet",
      "verb:await",
    ],
    mechanisms: [
      "skill-delegate-work",
      "await",
      "skill-await-the-fleet",
      "compose-below-trunk",
    ],
    yields: ["build-further"],
    holds: ["working conditions"],
  },
  {
    id: "done-is-deterministic",
    title: "Done is deterministic",
    obligation:
      "The project's declared checks decide when work is done; an agent's confidence stays advisory.",
    body:
      "The gate runs the project's full declared check: the jobs by stage, the scope gates the change woke, and the standards. The verdict is recomputed on every run, and a failure carries the command that produced it, so the fix starts at the cause.",
    arc: "loop",
    carriers: ["verb:done", "verb:prepare", "config:jobs", "config:gate"],
    mechanisms: [
      "gate",
      "jobs-table",
      "staged-pipeline",
      "diagnostics",
      "prepare",
    ],
    yields: ["know-what-is-ready"],
    holds: ["checks"],
  },
  {
    id: "only-better",
    title: "Only better",
    obligation:
      "Measured quality limits never loosen, captured gains become the new baseline, and the local record shows where to improve next.",
    body:
      "Standards hold each configured number at a limit compared against the trunk: a floor may only rise, a ceiling may only fall, and a branch that loosens either fails the gate. A pin captures an improvement as the new limit, while the advisory readers mine the local logbook for the next gain worth taking.",
    arc: "loop",
    carriers: [
      "verb:standards",
      "config:standards",
      "skill:discern-set-the-standard",
      "skill:discern-clear-the-decks",
    ],
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
    holds: ["checks", "evidence"],
  },
  {
    id: "proof-binds-to-the-change",
    title: "Proof binds to the change",
    obligation:
      "Finished work returns with evidence naming the exact committed tree it vouches for; any later edit expires it.",
    body:
      "A green gate over a clean, committed tree mints proof: the branch, the pinned commit, the changed files, the check results, and the held standards. Acceptance writes it to the landed commit as a durable note, so the evidence outlives the worktree that produced it.",
    arc: "loop",
    carriers: ["verb:done", "config:repository"],
    mechanisms: ["proof", "proof-notes", "unchanged-tree-rerun"],
    yields: ["know-what-is-ready"],
    holds: ["evidence"],
  },
  {
    id: "you-decide-what-lands",
    title: "You decide what lands",
    obligation:
      "A green gate makes a change eligible; landing takes fresh consent or a grant you recorded, checked against the exact changed paths.",
    body:
      "Acceptance resolves its authority per invocation (a conversation attestation, a standing scope grant, or a one-shot effort grant) and refuses without one. What lands is the tree the gate validated, fast-forwarded onto the trunk with nothing of the task left behind.",
    arc: "loop",
    carriers: ["verb:accept", "config:acceptance"],
    mechanisms: ["accept", "consent-attestations"],
    yields: ["know-what-is-ready", "keep-control"],
    holds: ["decisions"],
  },
  {
    id: "the-project-remembers",
    title: "The project remembers",
    obligation:
      "Lessons, decisions, and methods are written into the project, where the next session starts; staleness is a defect.",
    body:
      "A correction becomes guidance, a decision becomes a record with its reasons, a procedure becomes a skill, and the map keeps the account agents work from — its substance checked by every gate run. What one task teaches, the next inherits: the loop closes where it began.",
    arc: "loop",
    carriers: [
      "skill:discern-teach-the-project",
      "skill:discern-write-adr",
      "skill:discern-document-subsystem",
      "config:map",
    ],
    mechanisms: [
      "map",
      "adr-discipline",
      "docs-integrity",
      "map-freshness",
      "glossary-canon",
      "skill-teach-the-project",
      "skill-write-adr",
      "skill-document-subsystem",
    ],
    yields: ["keep-project-knowledge-working"],
    holds: ["guidance", "decisions"],
  },
  {
    id: "cure-the-class",
    title: "Cure the class",
    obligation:
      "A bug is fixed at its class, with a proven cause and a permanent guard, so the same defect cannot return unnoticed.",
    body:
      "The cure-a-bug skill requires the cause proven before the fix, the fix applied to every member of the class, and a guard driven from the class's single source left in the gate — so a future member enrols in the protection the moment it exists.",
    arc: "craft",
    carriers: ["skill:discern-cure-a-bug"],
    mechanisms: ["skill-cure-a-bug", "forcing-functions"],
    yields: ["make-improvement-accumulate"],
    holds: ["checks"],
  },
  {
    id: "write-it-once",
    title: "Write it once",
    obligation:
      "Every shared fact has one authority; copies are generated from it, and drift fails the gate.",
    body:
      "The write-it-once skill carries the construction discipline discern builds itself with: one source per fact with bound consumers, guards that enrol future members, and effects planned before they run. Declared generated artifacts regenerate from their sources, and the gate fails a copy that drifted.",
    arc: "craft",
    carriers: ["skill:discern-write-it-once", "config:generated"],
    mechanisms: [
      "skill-write-it-once",
      "generated-artifact-declarations",
      "canonical-sets",
    ],
    yields: ["keep-project-knowledge-working"],
    holds: ["checks"],
  },
];

/**
 * Bundled skills kept out of the tenet carriers, each with the reason. The
 * enrolment guard holds every bundled skill to exactly one of: claimed by a
 * tenet's carriers, or recorded here.
 */
export const PRACTICE_DELIBERATELY_ABSENT: Readonly<Record<string, string>> =
  {};

/** One property: what kind of thing the practice is, distinct from what it obliges. */
export interface PracticeProperty {
  /** Stable kebab-case id, unique across the canon. */
  id: string;
  title: string;
  /** The property in one sentence. */
  line: string;
  /** Feature-node ids grounding the property. */
  mechanisms: readonly string[];
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
  },
  {
    id: "no-model-inside",
    title: "No model inside",
    line:
      "discern contains no model and needs no API key; the agent supplies the intelligence, and the practice supplies the conditions.",
    mechanisms: ["no-model-inside"],
  },
  {
    id: "ordinary-files",
    title: "Ordinary files, yours",
    line:
      "The practice is files in the repository — one root configuration plus the guidance, methods, and decisions it records — all readable and all project-owned.",
    mechanisms: ["one-file-footprint", "ownership-buckets"],
  },
  {
    id: "stack-neutral",
    title: "Stack-neutral",
    line:
      "The practice ships none of the project's stack: the gate, scopes, standards, and resources run whatever commands the project declares.",
    mechanisms: ["stack-neutral"],
  },
  {
    id: "provider-neutral",
    title: "Provider-neutral",
    line:
      "Every supported agent works through the same project-owned practice, so changing providers never means starting the project over.",
    mechanisms: ["providers", "guidance-compile"],
  },
  {
    id: "reversible",
    title: "Reversible",
    line:
      "Leaving costs one command and loses no authored work: the wiring goes, and the practice's files stay.",
    mechanisms: ["uninstall"],
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

/** The holds a tenet's carriers derive — engine first when both apply. */
export function tenetHolds(tenet: PracticeTenet): readonly TenetHold[] {
  const holds = new Set<TenetHold>();
  for (const carrier of tenet.carriers) {
    holds.add(parseCarrier(carrier).set === "skill" ? "taught" : "engine");
  }
  return (["engine", "taught"] as const).filter((hold) => holds.has(hold));
}

/** Where the generated practice-canon page lives inside the map. */
export const PRACTICE_CANON_PAGE_REL: string = join(
  "_internal",
  "practice-canon.md",
);

/** The banner stamped atop the generated practice-canon page. */
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
  const cluster = BENEFIT_CANON.find((entry) => entry.id === id);
  if (cluster === undefined) {
    throw new Error(`practice canon cites unknown benefit cluster: ${id}`);
  }
  return cluster.title;
}

/** A tenet's carriers of one hold, as code spans: `done`, `[standards]`, the skill names. */
function carrierSpans(tenet: PracticeTenet, hold: TenetHold): string {
  const spans = tenet.carriers
    .map((carrier) => parseCarrier(carrier))
    .filter(({ set }) => (set === "skill") === (hold === "taught"))
    .map(({ set, member }) =>
      set === "config" ? `\`[${member}]\`` : `\`${member}\``
    );
  return spans.join(", ");
}

/** One tenet's "Held" line: each hold with its named carriers. */
function heldLine(tenet: PracticeTenet): string {
  const parts = tenetHolds(tenet).map((hold) =>
    hold === "engine"
      ? `by the engine (${carrierSpans(tenet, "engine")})`
      : `taught (${carrierSpans(tenet, "taught")})`
  );
  return parts.join("; ");
}

/**
 * Render the practice-canon page: the frame, the numbered tenets with their
 * holds, mechanisms, value, and inventory, the properties, the derived
 * inventory coverage, and the traceability appendix.
 */
export function renderPracticeCanonDoc(): string {
  const titles = featureTitlesById();
  const citedNodes = new Set(
    PRACTICE_CANON.flatMap((tenet) => [...tenet.mechanisms]).concat(
      PRACTICE_PROPERTIES.flatMap((property) => [...property.mechanisms]),
    ),
  );
  const citedClusters = new Set(
    PRACTICE_CANON.flatMap((tenet) => [...tenet.yields]),
  );
  const claimedSkills = new Set(
    PRACTICE_CANON.flatMap((tenet) => tenet.carriers)
      .map((carrier) => parseCarrier(carrier))
      .filter(({ set }) => set === "skill")
      .map(({ member }) => member),
  );
  const lines: string[] = [
    PRACTICE_DOCS_BANNER,
    "",
    "# Practice canon",
    "",
    "_The practice, enumerated: the obligations discern holds for every change, stated without naming a feature, then tied to the features that implement them and the value they yield. The [feature canon](feature-canon.md) owns the mechanism account and the [benefit canon](feature-canon-benefits.md) owns the human value; this canon owns the obligations between them. Surfaces that explain the practice (site pages, the machine edition, orientation prose) render or cite these tenets instead of re-deriving the practice._",
    "",
    `${PRACTICE_CANON.length} tenets · ${claimedSkills.size} bundled skills claimed · ${citedNodes.size} feature nodes cited · ${citedClusters.size} of ${BENEFIT_CANON.length} benefit clusters yielded · ${PRACTICE_PROPERTIES.length} properties.`,
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
    "Numbered by position; `loop` tenets govern how work moves, `craft` tenets govern what the work honors. A tenet marked _by the engine_ is held at a machine boundary — a verb or the gate refuses the violation; a tenet marked _taught_ is carried by a bundled skill and the compiled guidance.",
    "",
  );
  PRACTICE_CANON.forEach((tenet, index) => {
    const mechanisms = tenet.mechanisms
      .map((id) => citedFeatureTitle(titles, id))
      .join(" · ");
    const yields = tenet.yields.map(citedClusterTitle).join(" · ");
    lines.push(
      `### ${index + 1}. ${tenet.title}`,
      "",
      `> ${tenet.obligation}`,
      "",
      tenet.body,
      "",
      `- **Arc:** ${tenet.arc}`,
      `- **Held:** ${heldLine(tenet)}`,
      `- **Mechanisms:** ${mechanisms}.`,
      `- **Yields:** ${yields}.`,
      `- **Maintains:** ${
        tenet.holds.map((item) => `its ${item}`).join(", ")
      }.`,
      "",
    );
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
    lines.push(`- **${property.title}** — ${property.line} (${mechanisms}.)`);
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
    "## Coverage",
    "",
    "Every bundled skill is claimed by a tenet's carriers or recorded absent below; every carrier, mechanism, and yield names a live member; every inventory item has a maintainer. The guard (`tests/practice_canon_enrolment_test.ts`) holds all of it, and the loop closes structurally: what tenet 8 deposits, tenet 1 hands to the next session.",
    "",
    "### Recorded absences",
    "",
  );
  const absences = Object.entries(PRACTICE_DELIBERATELY_ABSENT);
  if (absences.length === 0) {
    lines.push("- None: every bundled skill is claimed by at least one tenet.");
  } else {
    for (const [skill, reason] of absences) {
      lines.push(`- \`${skill}\` — ${reason}`);
    }
  }
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
