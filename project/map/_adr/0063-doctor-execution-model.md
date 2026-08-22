# ADR 0063: `discern doctor` prints the execution model — facts, not judgments

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** current spellings are `standards` (formerly `ratchets`), `done` (formerly `finish`), `accept` (formerly `graduate`), and known/custom `job` (formerly gate `capability` / custom `check`); the decisions below are unchanged.

**Status**: accepted; **amended** — see the _Update_ sections below. Adds an `execution_model` section to `doctor` (human + the `--json` `data.execution_model`), derived from the same plan builders the gate runs ([ADR 0027](0027-plan-apply-engine-execution.md)) and the engine's `STEP_KINDS` vocabulary ([ADR 0028](0028-result-envelope-and-diagnostics.md)), pinned by forcing functions in the spirit of [ADR 0051](0051-canonical-set-parity.md).

## Update (destructive labelling removed)

This ADR shipped a per-step `destructive` flag: a ⚠ on a resource `destroy`, with "what could destroy data?" among the questions the model answered. That flag is gone. discern cannot know whether a project-configured command is destructive — a `check` stage wired to `rm -rf build/` runs without a warning, while only a declared resource `destroy` ever carried one. Flagging some steps and not others is worse than flagging none: it invites the reader to treat a step that carries no warning as safe.

Dropping it is truer to this ADR's own thesis. The title is "facts, not judgments", and whether a step is destructive is exactly a judgment — one discern is not positioned to make for an arbitrary user command. The model still answers the motivating "why did `accept` tear down my database?", but by showing the `destroy` command verbatim as a `[project]` step rather than labelling it. The reader draws the destructive conclusion from the command, as they already do for every other judgment the model leaves to them.

## Update (checks render after the human model)

The execution model remains in `discern doctor`'s default human output, but the human render now places the long model before the actionable doctor checks. A terminal usually leaves the tail of the command visible, so ending with `Doctor checks` and the pass/fail summary makes the user's next action clearer without hiding the model. The structured `--json` shape is unchanged: `data.checks` and `data.execution_model` remain separate keyed fields for agents and MCP clients.

## Update (hints are opt-in in the human render)

When the checks still rendered before the model, the per-step hints proved long enough to bury them on a normal terminal, and inline between the step lines they broke a quick read of the sequence. The human render hides hints by default and shows a pointer — at the top and the foot of the section — to `discern doctor --verbose`, which prints the hint on every step it applies to, repeats included. The structured `--json` `execution_model` is unchanged: it always carries every step's hint, so an agent reading the model is unaffected. The steps themselves (their order and actors) still render by default; only the explanatory hints moved behind the flag.

## Update (stateful lifecycle cores derive from their plans)

The original conditional worktree model still left one lifecycle sequence in two places: a new `update` or `accept` step could enter the real plan without entering `doctor`. That happened when tracked-refresh convergence added generated auto-resolution, regeneration commit/report behavior, and a current-engine acceptance check. The gate model also compressed its initial and receipt-boundary refresh checks into one line.

Where a pure plan projection exists, `doctor` now feeds it representative runtime identity and config-derived commands, then annotates the projected steps. `done`, `update`, and `accept` therefore share their ordered cores with dry-run rendering. Acceptance expands the plan's generic teardown into the configured resource commands, preserving the useful project-specific detail. A label-for-label forcing-function test binds all three projections, including both `done` checkpoints and the pre-fast-forward `accept` checkpoint.

## Context

discern's power — one gate, an isolated-worktree workflow, an author-once→compile pipeline — comes with opacity. Tracing _what runs when_ took a full debugging session even for someone fluent in the codebase. Shipped to end-users, the predictable support questions are "why did this command run **here**?", "why is the formatter so slow?", and "why did `accept` tear down my database?" — each rooted in not seeing the ordered sequence of steps behind a verb, which of them are the user's own configured commands versus discern's built-ins, and which can lose data.

The facts already exist, scattered: the gate verbs are pure functions of config (`buildGatePlan`, `preparePlanGroups`, `stageGroup`, `buildStandardPlan`); the worktree lifecycle executors encode a fixed-but-conditional sequence; each `PlanStep.kind` already distinguishes a user-configured step (`job`, `scope-gate`, `standard`, resource/setup commands) from a built-in one (`merge-check`, `git`, `refresh`, …). What was missing was a single, honest, annotated rendering a confused human — or their coding agent — could read to answer "what runs when I call X, in what order, which parts are mine, what must be idempotent or fast, and what could destroy data?"

## Decision

**`doctor` renders the execution model explicitly, derived from the SSOT, and annotates each step with the class-level expectation — but it does NOT judge the configuration.**

- **Form factor: a section in `doctor`, in the default output.** A clearly-delimited "Execution model" block renders in the human output (stderr like the rest of doctor's narration), before the actionable checks so the terminal tail ends on the health report; the structured `execution_model` rides in `data` under `--json`. Both the CLI command and the read-only MCP `discern_doctor` inherit it automatically (one `doctorResult`). This makes a support issue template — "paste `discern doctor`" — a shared ground truth, and lets a consuming agent read the facts itself.
- **Derive from the SSOT, never hand-write an available plan core.** The gate verbs' step lists are built by walking the real plan builders (with a synthetic "all scopes changed" so scope gates render as conditional, not skipped). `update` and `accept` pass representative runtime identity into their real pure plan projections and pull generators, resources, smoke, and convergence commands live from config. Tests assert those ordered cores are **byte-derived** label-for-label. Worktree operations without a complete pure projection retain a small conditional model whose project commands still come directly from config.
- **The hint registry is a forcing function.** A single `Record<StepKind, …>` of annotations (actor + hint) is TOTAL over `STEP_KINDS`, so a newly-added engine step kind is a **compile error** until it is documented — the same shape as `done`'s total `Record<FailedStage, string>` fail-message table. A sibling `Record<Stage, …>` does the same for the per-stage job hints. A coverage test asserts every `STEP_KIND` appears in at least one verb's model. The hint _text_ is sourced from canonical prose (the config-template comments, the worktree docs, the ADRs) and kept domain-neutral — it ships to every project.
- **discern renders facts and expectations; it does not draw conclusions.** The model states that the check stage is "the fast inner loop you run constantly" and shows a configured resource `destroy` command verbatim; it does NOT decide that the command is destructive or that _your_ slow linter is misfiled into that loop. Those conclusions belong to the reader. discern does not become a semantic-lint engine.

## Consequences

- **A confused user (or their agent) can self-serve.** `discern doctor` answers ordering, ownership, idempotency, and teardown questions directly, and the `--json` form lets an agent spot a real config mistake (a slow command in the fast inner loop) without discern hard-coding that verdict.
- **The model cannot silently rot.** A new gate stage, step kind, or known job flows into the model from the SSOT it already extends; a new `STEP_KIND` fails the compile and the coverage test until annotated; a reordered gate plan fails the byte-derive test until the model tracks it. The forcing functions are the regression guard.
- **Two derivation styles remain, by necessity.** Gate verbs and the projected `update`/`accept` cores are byte-derived from pure plans. Other stateful worktree operations retain an authored conditional model. The coverage test spans both, and all project commands come live from config.
- **No behaviour changes.** This is a purely explanatory, read-only addition. No verb's execution path is altered; `execution_model` is omitted gracefully when no config can be read (the failing checks are the actionable report there).

## Alternatives considered

- **A standalone `discern explain <verb>` command.** Rejected: the issue-template goal wants one paste-able artifact a user already reaches for when something looks wrong, and `doctor` is exactly that surface. A separate verb is one more thing to discover.
- **Judge the configuration (flag the slow linter, the misfiled check).** Rejected as a scope boundary: a semantic-lint engine is a large, opinionated surface that would bake discern's judgments into every project. Rendering the honest, annotated model is the smaller, composable primitive — the consuming agent supplies the judgment.
- **Hand-write the per-verb sequences.** Rejected on the project's single-source-of-truth rule: a parallel copy of the gate's order is precisely the thing that drifts. Deriving from the plan builders (and proving it with the byte-derive test) makes drift a test failure rather than a stale doc.
