---
aliases:
  - expensive test fixtures
  - test consolidation
  - test execution cost
---

# Test execution review

Each expensive test execution should establish a necessary state, exercise a necessary boundary, or observe a distinct transition. A shared helper removes source duplication; calling that helper for every assertion can still repeat expensive work.

## When the question applies

The `test-execution-cost` entry in [discern.toml](../../../discern.toml) asks for judgment when changed test code adds expensive call sites or expands repetition around them. The [syntax analysis](../../../scripts/test_execution_analysis.ts) owns the boundary set and comparison rules. It resolves named imports, aliases, re-exports, and fixture wrappers within test sources. The [checkpoint host](../../../scripts/test_execution_checkpoint.ts) reads the governing Git tree and candidate files without executing test code.

Comments, formatting, assertion-only edits, and moving a call within a file do not grow the indicators. Local literal arrays supply their sizes; changing a case value alone does not expand a matrix. Changes to shared fixtures can affect many callers and deserve review even when test registrations stay unchanged. The matcher names only changed subjects; unchanged dependencies help resolve calls.

This is bounded syntax evidence. It does not predict elapsed time or count actual processes. Runtime-generated matrices, higher-order callback arguments, wrappers outside test sources, and new process boundaries outside the declared set may need review without a firing. Moving calls between files can fire, as can adding preparation that makes later execution cheaper. Explain that benefit when answering. A pass means the selector found no growth in its supported indicators.

The command has the checkpoint protocol's time limit and bounded source reads. Unavailable or malformed evidence produces an indeterminate result, which requires judgment over the selected test files. It never substitutes missing evidence with a cost estimate.

## Choose the smallest sufficient execution

Read the nearby journeys and shared fixtures before arranging another installation or completed gate. Use the first compatible approach:

- **Reuse an observation.** Several assertions about the same result can inspect one execution. Render output variants through the production presenter when transport behavior is already covered.
- **Pool read-only checks.** Share an expensive starting state when each refusal preserves it. Restore every temporary perturbation and assert the relevant state before continuing.
- **Chain compatible transitions.** A preview can precede a landing; a completed state can precede its rerun. Keep alternatives separate when a failed attempt, moved ref, or consumed authority changes the next case's preconditions.
- **Copy a pristine fixture.** Build an installation once and copy it for independent mutations before it contains path-bound worktrees or recorded evidence. Resolve paths consistently with the process boundary under test.
- **Run logic matrices in-process.** Exercise production cores and keep real subprocess cases for argument parsing, streams, exit status, process-local state, and session lifecycle. Derive case membership from the canonical registry.

Keep each top-level test's repository ownership independent. Sharing state belongs within a named journey, whose steps retain meaningful failure diagnostics. Avoid stretching journeys so far that a failure becomes hard to isolate.

Place shared helpers in modules without test registrations. Importing another native test module registers its cases in the importing worker as well as its own worker. The [registration guard](../../../tests/test_registration_guard_test.ts) scans the authored Deno source universe for runtime imports and re-exports of native test filenames, including literal dynamic imports. Type-only uses remain inert. Its shared [import parser](../../../tests/import_specifiers.ts) also serves the existing architectural graph guards.

## Preserve detection strength

Check that each retained assertion still reaches its intended condition. A refusal caused by a missing prerequisite does not exercise a later policy check. A gate result from another state may contain the same text without testing the same behavior.

Assert relevant state preservation between pooled refusals, including refs and recorded evidence where the contract requires it. A final successful operation can provide additional evidence that earlier refusals consumed nothing. A passing gate and unchanged coverage floors support the result; they do not establish equivalent defect detection. Use a focused known-bad perturbation when that equivalence remains uncertain.

Representative patterns live in the [acceptance journey](../../../tests/engine_worktree_test.ts), [pristine-copy fixture](../../../tests/engine_surface_fixture.ts), [checkpoint projections](../../../tests/engine_checkpoints_surfaces.ts), and [doctor tests](../../../tests/doctor_test.ts). Their separate fixtures also show where sharing would change the contract.

## Cost evidence and tuning

The [Git command budget test](../../../tests/engine_git_command_budget_test.ts) holds engine work independently of machine contention. Ordinary gate timings help locate expensive files. Controlled comparisons belong to substantial optimization work; daily development need not suspend other projects for timing evidence. JUnit parent durations already include their steps, so summing parent and step rows double-counts work.

Review the checkpoint's firing rate and declarations after its first 20 landed efforts using `discern checkpoints` and `discern patterns`. Inspect misses as well as firings. Narrow or soften a noisy selector before adding thresholds based on wall time. Extend the boundary set only when the new boundary performs work this question should cover, and add a focused selector case with it.
