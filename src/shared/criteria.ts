/**
 * The canonical **criterion vocabulary** — the judgment prose an agent evaluates
 * when discern cannot decide a question mechanically. One criterion is a stable
 * id, the criterion prose itself, a `teach` describing what good looks like, and
 * optional reference material.
 *
 * Criteria are pure vocabulary: they carry no trigger, no schedule, and no
 * severity. WHERE a criterion is evaluated is a separate **membership**
 * decision, and there are two:
 *
 *   - the **improvement membership** (`engine/improve/rules.ts`): the subjective
 *     rules of the improvement catalog reference criteria by id for estate-wide
 *     review — the audit of what already exists.
 *   - the **checkpoint membership** (`shared/checkpoints.ts`): a built-in
 *     checkpoint pairs a criterion with a deterministic diff trigger, so the
 *     criterion is served at the moment a change makes it relevant.
 *
 * "This criterion blocks `done`" is therefore an explicit membership decision,
 * never a side effect of a field on the criterion itself. Parity guards
 * (`tests/criteria_registry_test.ts`) hold both directions: every membership
 * reference resolves here, and no criterion is orphaned by every membership.
 *
 * One entry interpolates {@link diagnosticFormatList} so the prose names exactly
 * the machine formats the gate's normalizer recognizes — citing the live
 * registry instead of a copy that would drift when a format is added.
 */

import { diagnosticFormatList } from "../engine/gate/diagnostics.ts";

/** One canonical criterion: the judgment prose and its teaching. */
export interface Criterion {
  /** Stable slug, namespaced by subject area (e.g. `gate.test-depth`). */
  readonly id: string;
  /** The judgment prose the agent evaluates. */
  readonly criterion: string;
  /** Why the criterion matters and what good looks like. */
  readonly teach: string;
  /** Optional pointer to reference material carried into renderings. */
  readonly reference?: string;
}

/**
 * The canonical criteria, in catalog order. The single source every membership
 * references by id; prose lives here ONCE, so the improvement catalog and any
 * checkpoint serving the same criterion can never drift apart.
 */
export const CRITERIA: readonly Criterion[] = [
  {
    id: "gate.fast-feedback",
    criterion:
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
    criterion:
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
    criterion:
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
    criterion:
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
    criterion:
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
    id: "map.current",
    criterion:
      "Pick a subsystem that changed recently. Does its documentation page still " +
      "describe how the code actually behaves now — present tense, no drift — or does " +
      "it describe a previous design? A stale doc is a bug.",
    teach:
      "Docs are only worth trusting if they track the code. When a change alters " +
      "documented behaviour, update the page in the same change. The discern-document-subsystem " +
      "skill refreshes a subtree; `discern map --list` shows the tree.",
  },
  {
    id: "map.navigation",
    criterion:
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
    id: "worktrees.resources",
    criterion:
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
    criterion:
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
    criterion:
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
    id: "skills.opportunity",
    criterion:
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
    criterion:
      "Inspect the authored skills. Does each say when to use it, what context or " +
      "preconditions it needs, the concrete sequence to follow, how to verify success, " +
      "and how to recover or clean up when the workflow can fail? Could a fresh agent " +
      "execute it without inventing the missing half?",
    teach:
      "A good skill packages judgement, not just reminders. Give it a sharp trigger, " +
      "progressively disclose only the needed references, make effects and stop " +
      "conditions explicit, and end with observable proof that the task succeeded.",
  },
];

/** The canonical criterion ids, in catalog order. */
export const CRITERION_IDS: readonly string[] = CRITERIA.map((c) => c.id);

/** Look one criterion up by id, or undefined for an unknown id. */
export function criterionById(id: string): Criterion | undefined {
  return CRITERIA.find((c) => c.id === id);
}
