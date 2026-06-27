# ADR 0062: `discern doctor` prints the execution model — facts, not judgments

**Status**: accepted. Adds an `execution_model` section to `doctor` (human + the
`--json` `data.execution_model`), derived from the same plan builders the gate runs
([ADR 0027](0027-plan-apply-engine-execution.md)) and the engine's `STEP_KINDS`
vocabulary ([ADR 0028](0028-result-envelope-and-diagnostics.md)), pinned by forcing
functions in the spirit of [ADR 0051](0051-canonical-set-parity.md).

## Context

discern's power — one gate, an isolated-worktree workflow, an author-once→compile
pipeline — comes with opacity. Tracing _what runs when_ took a full debugging session
even for someone fluent in the codebase. Shipped to end-users, the predictable
support questions are "why did this command run **here**?", "why is the formatter so
slow?", and "why did `graduate` wipe my database?!" — each rooted in not seeing the
ordered sequence of steps behind a verb, which of them are the user's own configured
commands versus discern's built-ins, and which can lose data.

The facts already exist, scattered: the gate verbs are pure functions of config
(`buildGatePlan`, `preparePlanGroups`, `stageGroup`, `buildRatchetPlan`); the worktree
lifecycle executors encode a fixed-but-conditional sequence; each `PlanStep.kind`
already distinguishes a user-configured step (`job`, `scope-gate`, `ratchet`,
resource/setup commands) from a built-in one (`merge-check`, `git`, `refresh`, …).
What was missing was a single, honest, annotated rendering a confused human — or their
coding agent — could read to answer "what runs when I call X, in what order, which
parts are mine, what must be idempotent or fast, and what could destroy data?"

## Decision

**`doctor` renders the execution model explicitly, derived from the SSOT, and annotates
each step with the class-level expectation — but it does NOT judge the configuration.**

- **Form factor: a section in `doctor`, in the default output.** A clearly-delimited
  "Execution model" block follows the checks (human, on stderr like the rest of
  doctor's narration); the structured `execution_model` rides in `data` under `--json`.
  Both the CLI command and the read-only MCP `discern_doctor` inherit it automatically
  (one `doctorResult`). This makes a support issue template — "paste `discern doctor`"
  — a shared ground truth, and lets a consuming agent read the facts itself.
- **Derive from the SSOT, never hand-write.** The gate verbs' step lists are built by
  walking the REAL plan builders (with a synthetic "all scopes changed" so scope gates
  render as conditional, not skipped), so they cannot drift from what the gate runs. A
  test asserts they are **byte-derived** label-for-label. The worktree verbs' plans need
  live runtime state (a resolved identity, the ledger), so they can't render statically;
  for those we author a small **conditional** model that mirrors the lifecycle executor
  and pulls the _user_ commands (resource `create`/`destroy`, `[worktree.setup]` steps)
  **live from config**, so the command text is never stale or invented.
- **The hint registry is a forcing function.** A single `Record<StepKind, …>` of
  annotations (actor + hint + destructive) is TOTAL over `STEP_KINDS`, so a newly-added
  engine step kind is a **compile error** until it is documented — the same shape as
  `finish`'s total `Record<FailedStage, string>` fail-message table. A sibling
  `Record<Stage, …>` does the same for the per-stage job hints. A coverage test asserts
  every `STEP_KIND` appears in at least one verb's model. The hint _text_ is sourced
  from canonical prose (the config-template comments, the worktree docs, the ADRs) and
  kept domain-neutral — it ships to every project.
- **discern renders facts and expectations; it does not draw conclusions.** The model
  states that the check stage is "the fast inner loop you run constantly" and that a
  resource `destroy` is "DESTRUCTIVE"; it does NOT decide that _your_ slow linter is
  misfiled into that loop. That conclusion is the consuming agent's to draw from the
  honest model. discern does not become a semantic-lint engine.

## Consequences

- **A confused user (or their agent) can self-serve.** `discern doctor` answers the
  ordering / ownership / idempotency / destructiveness questions directly, and the
  `--json` form lets an agent spot a real misconfiguration (a slow command in the fast
  inner loop) without discern hard-coding that verdict.
- **The model cannot silently rot.** A new gate stage, step kind, or capability flows
  into the model from the SSOT it already extends; a new `STEP_KIND` fails the compile
  and the coverage test until annotated; a reordered gate plan fails the byte-derive
  test until the model tracks it. The forcing functions are the regression guard.
- **Two derivation styles, by necessity.** Gate verbs are byte-derived (pure functions
  of config); worktree verbs are an authored conditional model (their real plans need
  runtime state). The coverage test spans both; only the gate verbs carry the stronger
  byte-derive guarantee. The worktree authoring is tied to reality by sourcing every
  user command live from config and mirroring the lifecycle executor.
- **No behaviour changes.** This is a purely explanatory, read-only addition. No verb's
  execution path is altered; `execution_model` is omitted gracefully when no config can
  be read (the failing checks are the actionable report there).

## Alternatives considered

- **A standalone `discern explain <verb>` command.** Rejected: the issue-template goal
  wants one paste-able artifact a user already reaches for when something looks wrong,
  and `doctor` is exactly that surface. A separate verb is one more thing to discover.
- **Judge the configuration (flag the slow linter, the misfiled check).** Rejected as a
  scope boundary: a semantic-lint engine is a large, opinionated surface that would
  bake discern's judgments into every project. Rendering the honest, annotated model is
  the smaller, composable primitive — the consuming agent supplies the judgment.
- **Hand-write the per-verb sequences.** Rejected on the project's single-source-of-truth
  rule: a parallel copy of the gate's order is precisely the thing that drifts. Deriving
  from the plan builders (and proving it with the byte-derive test) makes drift a test
  failure rather than a stale doc.
