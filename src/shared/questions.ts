/**
 * The canonical **question vocabulary** — the judgment prose an agent evaluates
 * when discern cannot decide a question mechanically. One question is a stable
 * id, the question prose itself, a `teach` describing what good looks like, and
 * optional reference material.
 *
 * Questions are pure vocabulary: they carry no trigger, no schedule, and no
 * severity. WHERE a question is evaluated is a separate **membership**
 * decision, and there are two:
 *
 *   - the **improvement membership** (`engine/improve/rules.ts`): the subjective
 *     rules of the improvement catalog reference questions by id for project-wide
 *     review — the audit of what already exists.
 *   - the **checkpoint membership** (`shared/checkpoints.ts`): a built-in
 *     checkpoint pairs a question with a deterministic diff trigger, so the
 *     question is served at the moment a change makes it relevant.
 *
 * "This question blocks `done`" is therefore an explicit membership decision,
 * never a side effect of a field on the question itself. Parity guards
 * (`tests/questions_registry_test.ts`) hold both directions: every membership
 * reference resolves here, and no question is orphaned by every membership.
 *
 * Each question also declares HOW its violations arise ({@link
 * QUESTION_VIOLATION_MODES}) — the **conversion rule**'s input: a question may
 * pair with a checkpoint trigger only when a diff introduces its violations;
 * one whose violations accrue by time or absence stays audit-side. The parity
 * guards enforce that on the checkpoint membership, so "which side of the
 * stock-versus-flow line a question sits on" is recorded data, not lore.
 *
 * One entry interpolates {@link diagnosticFormatList} so the prose names exactly
 * the machine formats the gate's normalizer recognizes — citing the live
 * registry instead of a copy that would drift when a format is added.
 */

import { diagnosticFormatList } from "../engine/gate/diagnostics.ts";

/**
 * How a question's violations arise — the conversion rule's closed vocabulary:
 *   - `diff-introduced`: a change brings the violation with it, so a
 *     deterministic trigger can serve the question at the moment the change
 *     completes; the question is eligible for the checkpoint membership.
 *   - `accrued`: the violation builds up by time or absence (staleness, lost
 *     navigability, a protection nobody has declared yet); no diff marks the
 *     moment, so the question belongs to the improvement review only.
 */
export const QUESTION_VIOLATION_MODES = [
  "diff-introduced",
  "accrued",
] as const;

/** One violation mode ({@link QUESTION_VIOLATION_MODES}). */
export type QuestionViolationMode = (typeof QUESTION_VIOLATION_MODES)[number];

/** One canonical question: the judgment prose and its teaching. */
export interface Question {
  /** Stable slug, namespaced by subject area (e.g. `gate.test-depth`). */
  readonly id: string;
  /** How violations arise — the conversion rule's input ({@link QUESTION_VIOLATION_MODES}). */
  readonly violations: QuestionViolationMode;
  /** The judgment prose the agent evaluates. */
  readonly question: string;
  /** Why the question matters and what good looks like. */
  readonly teach: string;
  /** Optional pointer to reference material carried into renderings. */
  readonly reference?: string;
}

/**
 * The **placement ladder** — where a quality rule belongs, from the cheapest
 * always-loaded rung to the most expensive owner ceremony. The coach
 * (`discern improvement`) teaches it and the graduation loop cites it, both by
 * interpolating {@link placementLadderProse} so the rungs can never drift
 * between surfaces.
 */
export const PLACEMENT_LADDER: readonly { home: string; when: string }[] = [
  {
    home: "the instructions",
    when: "prose an agent needs while shaping most decisions",
  },
  { home: "a skill", when: "a recurring method worth a playbook" },
  {
    home: "a checkpoint",
    when: "a judgment catchable as a narrow change completes",
  },
  { home: "a gate job or a standard", when: "a rule a machine can decide" },
  {
    home: "consent or a recorded grant",
    when: "a decision only the owner may make",
  },
];

/** The ladder as one teaching sentence fragment: "when → home; when → home; …". */
export function placementLadderProse(): string {
  return PLACEMENT_LADDER.map((rung) => `${rung.when} → ${rung.home}`)
    .join("; ");
}

/**
 * The canonical questions, in catalog order. The single source every membership
 * references by id; prose lives here ONCE, so the improvement catalog and any
 * checkpoint serving the same question can never drift apart.
 */
export const QUESTIONS: readonly Question[] = [
  {
    id: "gate.fast-feedback",
    violations: "accrued",
    question:
      "Given the test command below, and that `discern done` runs it on every " +
      "acceptance and whenever a change is called done — does the gate stay fast " +
      "as the suite grows, and is the runner using the parallelism it offers? " +
      "Parallel execution depends on isolated tests: each owning its own temp dir, " +
      "environment, ports, and fixtures, mutating no process-global state another " +
      "test could observe. A slow or order-flaky gate trains people to skip it or " +
      "rerun until green.",
    teach:
      "Isolated, order-independent tests are the precondition for parallel " +
      "execution and a trustworthy green. Give each test its own temp dir / env / " +
      "fixtures, avoid shared global state, then enable your runner's parallel mode.",
  },
  {
    id: "gate.test-depth",
    violations: "accrued",
    question:
      "Inspect representative tests behind the configured command. Do they protect " +
      "observable behaviour at important boundaries — including failure paths and " +
      "edge cases — or mostly mirror implementation details and prove that happy-path " +
      "code runs? Would a plausible regression fail for a useful reason?",
    teach:
      "A strong suite buys confidence, not just test count. Prefer externally visible " +
      "outcomes, boundary conditions, and past failure modes; keep assertions specific " +
      "enough that a red test explains the broken promise without coupling every test " +
      "to internal structure.",
  },
  {
    id: "gate.structured-diagnostics",
    violations: "accrued",
    question:
      "Inspect the reporter and output options for the configured check and test " +
      "jobs below. Where a tool can emit a format discern recognizes " +
      `(${diagnosticFormatList()}), does its command ` +
      "request that format in captured stdout or stderr while preserving a failing " +
      "exit status? A report written only to a file does not reach discern's " +
      "structured normalization.",
    teach:
      "On a failed job, discern turns recognized tool output into one diagnostic " +
      "per finding or failing test. Prefer a supported reporter the tool already " +
      "offers. Unrecognized output remains available as one raw diagnostic.",
  },
  {
    id: "setup.failure-memory",
    violations: "diff-introduced",
    question:
      "Read the configured gotchas document. Does each entry capture a recurring, " +
      "non-obvious failure with the symptom, likely cause, and proven recovery — or " +
      "is it generic advice, stale history, or a list that still makes the next agent " +
      "rediscover the diagnosis?",
    teach:
      "Good failure memory shortens the next incident. Record only traps the code and " +
      "ordinary tool output do not make obvious; make each entry searchable from the " +
      "observed symptom and concrete enough to verify the fix, then remove it when " +
      "the underlying trap is eliminated.",
  },
  {
    id: "instructions.project-specific",
    violations: "accrued",
    question:
      "Do the instructions below teach project-specific knowledge an agent " +
      "could NOT infer from the code itself — the testing philosophy, the architectural " +
      "boundaries that must hold, the non-obvious gotchas, the 'we tried X, it failed' " +
      "lessons? Or is it generic filler that restates what the code already shows?",
    teach:
      "Strong instructions are specific and load-bearing: they change what an agent does. " +
      "If a line would be true of any project in the language, cut it. If a real " +
      "constraint isn't written down, add it. Edit your instruction source and run `discern refresh`.",
  },
  {
    id: "instructions.economy",
    violations: "diff-introduced",
    question:
      "This change touches the always-loaded agent instructions — prose every " +
      "future session pays for before its first decision. Does each added or " +
      "reworded line shape most sessions' behaviour, or does it belong on a " +
      "cheaper rung: a skill invoked on demand, a documentation page found " +
      "when relevant, a checkpoint served on a matching change, or a machine " +
      "check?",
    teach:
      "Always-loaded prose is the most expensive home a rule can have. The " +
      `placement ladder: ${placementLadderProse()}. Keep the instructions ` +
      "for what shapes most decisions, and give everything else the cheapest " +
      "rung that still catches its moment.",
  },
  {
    // Diff-introduced: a page goes stale only when the code it describes
    // changes without it — the diff marks the moment; time alone never
    // creates the violation. The improvement review still audits the accumulated
    // backlog through the improvement membership.
    id: "map.current",
    violations: "diff-introduced",
    question:
      "Take code that changed recently. Does the documentation describing it " +
      "still say how the code actually behaves now — present tense, no drift — " +
      "or does a page describe a previous design? A stale doc is a bug.",
    teach:
      "Docs are only worth trusting if they track the code. When a change alters " +
      "documented behaviour, update the page in the same change. The discern-document-subsystem " +
      "skill refreshes a subtree; `discern map --list` shows the tree.",
  },
  {
    id: "map.navigation",
    violations: "accrued",
    question:
      "Starting at the configured map root's README.md, can a new contributor find the system overview, " +
      "the relevant subsystem, and its detailed pages without already knowing their " +
      "filenames? Do subtree READMEs explain scope and link their leaves, or is the " +
      "tree merely a collection of documents?",
    teach:
      "Good documentation has a map as well as accurate pages. Keep the root index " +
      "small and oriented around reader journeys, give each subsystem an overview, " +
      "and link detail from the nearest useful context so discoverability does not " +
      "depend on repository archaeology.",
  },
  {
    id: "map.focus",
    violations: "diff-introduced",
    question:
      "Read the changed documentation as its future reader. Does each changed " +
      "entry reduce the repository reading needed to make a correct decision — " +
      "behaviour, boundaries, intent, where to start — or does it restate what " +
      "the code already says: symbol inventories, file-by-file summaries, " +
      "change history?",
    teach:
      "Documentation earns its place by what a reader no longer has to open. " +
      "Record what the code cannot say, in the present tense, and cut anything " +
      "a reader could regenerate mechanically from the code — derivable " +
      "content is stale the day after it is written.",
  },
  {
    id: "worktrees.resources",
    violations: "accrued",
    question:
      "Does this project need per-worktree external resources to develop in isolation " +
      "— a database, an emulator, a container, a queue, a dev-server vhost? If so, are " +
      "they all declared under [worktree.resources.<name>] so each worktree gets its own?",
    teach: "Anything two concurrent worktrees would fight over belongs in " +
      "[worktree.resources.<name>] with a create/destroy pair, so discern " +
      "provisions and reclaims it per worktree. If the project needs none, this is a " +
      "clean pass — but verify nothing shared was missed.",
  },
  {
    id: "standards.opportunity",
    violations: "accrued",
    question:
      "Is there a measurable quality signal in this project you only ever want to " +
      "improve — test coverage, bundle/binary size, type-error count, a performance " +
      "budget, lint-warning count — that is NOT yet protected by a standard?",
    teach: "Find the number you'd be unhappy to see regress, emit it as " +
      "`DISCERN_METRIC <name> <value>` from a command, and add a [standards.<name>] " +
      "with that floor/ceiling. Every `discern done` run then verifies the limit " +
      "against the trunk and measures the metric alongside the tests.",
  },
  {
    id: "standards.normalize",
    violations: "accrued",
    question:
      "Do any ceiling standards count items over a tree that grows over time — lint " +
      "alerts, TODOs, type errors, doc nits? A raw count rises with the project, so it " +
      "fails on growth, not regressions, and the only way to pass is to loosen it. Hold " +
      "a rate instead: add `per` to divide by a built-in extent (files|lines|words|bytes).",
    teach:
      "A count is safe to hold only when it doesn't scale with project size (a true " +
      "budget, like shipped bytes). If it grows as you add code or docs, normalize it: " +
      '`per = { words = "${map.dir}**" }` holds docs alerts-per-word, so growth alone never ' +
      "breaches the ceiling — only a real quality regression does.",
  },
  {
    id: "checkpoints.opportunity",
    violations: "accrued",
    question:
      "Review where this project's quality rules live. Is there a judgment a " +
      "reviewer keeps raising that a narrow, deterministic change could trigger " +
      "— a candidate for a [checkpoints.<id>] entry? And has any configured " +
      "checkpoint's question become mechanically decidable, so a check could " +
      "replace the judgment?",
    teach:
      "Place each rule at the cheapest rung that still catches its violations: " +
      `${placementLadderProse()}. A question earns a checkpoint only when its ` +
      "violations arrive with a diff; one that accrues by time or absence " +
      "belongs to the improvement review like this one. When a checkpoint's question " +
      "becomes mechanically decidable, move it down the ladder: the " +
      "discern-set-the-standard skill's outlaw procedure turns it into a " +
      "measured ceiling, then a permanent gate rule.",
  },
  {
    id: "skills.opportunity",
    violations: "accrued",
    question:
      "Is there a multi-step task that recurs in this project and would benefit from a " +
      "written playbook an agent can follow each time — a release dance, a data reset, a " +
      "subsystem-specific workflow? Authored skills under the skills dir capture exactly that.",
    teach:
      "When you find yourself (or an agent) re-deriving the same procedure, capture it " +
      "as a skill: a directory with a SKILL.md under [skills].dir. It then becomes " +
      "discoverable to every agent. Eject a built-in to customise it.",
  },
  {
    id: "skills.executable",
    violations: "diff-introduced",
    question:
      "Inspect the authored skills. Does each say when to use it, what context or " +
      "preconditions it needs, the concrete sequence to follow, how to verify success, " +
      "and how to recover or clean up when the workflow can fail? Could a fresh agent " +
      "execute it without inventing the missing half?",
    teach:
      "A good skill packages judgement, not just reminders. Give it a sharp trigger, " +
      "progressively disclose only the needed references, make effects and stop " +
      "conditions explicit, and end with observable proof that the task succeeded.",
  },
  {
    id: "change.deletion-safety",
    violations: "diff-introduced",
    question:
      "This change removes clearly more than it adds. Is every cut proven " +
      "safe — no remaining callers, references, or configuration reaching the " +
      "removed code, tests and docs moved in step — and is what was removed " +
      "recoverable from history rather than silently lost?",
    teach:
      "A substantial cut is often right — unused code is a liability — but " +
      "'unused' must be proved, not assumed: check dynamic references, " +
      "configuration-driven call sites, and external consumers before " +
      "trusting a quiet search. Put the proof in the commit body so the " +
      "review reads as evidence.",
  },
  {
    id: "change.parallel-implementation",
    violations: "diff-introduced",
    question:
      "This change adds a file whose name closely resembles an existing " +
      "sibling — the signature of a second implementation growing beside the " +
      "original. Should the original have been changed in place? If a sibling " +
      "is genuinely needed, does its name state its distinct purpose rather " +
      "than its vintage?",
    teach:
      "Parallel copies fork every future fix: callers drift between variants " +
      "and neither stays authoritative. Evolve the original in place and let " +
      "the tests protect the change; when two must exist, name each for its " +
      "role and record why both are needed.",
  },
  {
    id: "change.effort-scope",
    violations: "diff-introduced",
    question:
      "This diff has grown wide. Is it still one coherent effort a reviewer " +
      "can hold in their head, or have unrelated fixes and opportunistic " +
      "cleanups ridden along? Would any part land more safely as its own " +
      "change?",
    teach:
      "One effort per change keeps review sharp and reversion cheap. Park " +
      "drive-by discoveries in the deferred-work ledger or their own " +
      "worktree instead of widening this change — a diff whose scope needs " +
      "explaining is usually two.",
  },
  {
    id: "change.commit-story",
    violations: "diff-introduced",
    question: "This change is large enough that its history is part of the " +
      "deliverable. Could the owner reconstruct the why of the work from the " +
      "commit messages alone — decision by decision — or does the story live " +
      "only in this session's context?",
    teach:
      "Commit messages are the only narration that survives the session. " +
      "Keep commits atomic, with imperative subjects and bodies that say " +
      "why, so review, archaeology, and selective reversion work without " +
      "you.",
  },
];

/** The canonical question ids, in catalog order. */
export const QUESTION_IDS: readonly string[] = QUESTIONS.map((c) => c.id);

/** Look one question up by id, or undefined for an unknown id. */
export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((c) => c.id === id);
}
