---
aliases:
  - expensive test fixtures
  - test consolidation
  - test execution cost
---

# Test execution review

Each expensive test execution should establish a necessary state, exercise a necessary boundary, or observe a distinct transition. A shared helper removes source duplication; calling that helper for every assertion can still repeat expensive work.

## When the question applies

The `test-execution-cost` entry in [discern.toml](../../../discern.toml) asks for judgment when changed test code adds expensive call sites or expands repetition around them. The [syntax analysis](../../../scripts/test_execution_analysis.ts) owns the boundary set and comparison rules. It resolves named imports, callable aliases, re-exports, and fixture wrappers within test sources, including callbacks passed through call-count adapters. The boundary set includes in-process status, prepare, and test results as well as CLI execution. The [checkpoint host](../../../scripts/test_execution_checkpoint.ts) reads the governing Git tree and candidate files without executing test code.

Comments, formatting, assertion-only edits, and moving a call within a file do not grow the indicators. Local literal arrays supply their sizes; changing a case value alone does not expand a matrix. Changes to shared fixtures can affect many callers and deserve review even when test registrations stay unchanged. Runtime imports and re-exports, including literal dynamic imports, enroll helpers under `tests/fixtures/`; specimens without runtime imports stay inert. A changed dependency also rechecks its unchanged callers and is named when their indicators grow. Static named-case arrays passed to the pristine pool helpers count expensive callbacks separately from the one-time seed.

This is bounded syntax evidence. It does not predict elapsed time or count actual processes. Runtime-generated matrices, arbitrary higher-order helpers, child entrypoints referenced only by paths, wrappers outside test sources, and new process boundaries outside the declared set may need review without a firing. Moving calls between files can fire, as can adding preparation that makes later execution cheaper. Explain that benefit when answering. A pass means the selector found no growth in its supported indicators.

The command has the checkpoint protocol's time limit and bounded source reads. Unavailable or malformed evidence produces an indeterminate result, which requires judgment over the selected test files. It never substitutes missing evidence with a cost estimate.

## Choose the smallest sufficient execution

Read the nearby journeys and shared fixtures before arranging another installation or completed gate. In the checkpoint answer, name the closest existing helper or scenario. For each additional execution, identify the necessary state or boundary and why an existing observation, pristine seed, or compatible journey cannot provide it.

Use this chooser before adding setup:

| What the assertion needs                                     | Reuse first                                                                                                                                 | Isolation or boundary to preserve                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Another assertion or schema over one result                  | Keep the result and inspect it again; use the production presenter for output variants                                                      | Execute again only when the state or transport under test changes                                          |
| Related logic inputs                                         | [Named case tables](../../../tests/assert_cases.ts) over the production core                                                                | Keep async state ownership explicit; derive membership from its registry                                   |
| Independent mutations of one installed baseline              | [Pristine installs](../../../tests/engine_surface_fixture.ts)                                                                               | Seed before worktrees or Proof; preserve the basename and avoid case-specific absolute paths               |
| Copied repositories with producer observations               | [Counted pristine installs](../../../tests/engine_integration_fixture.ts)                                                                   | The journey owns the external counter; each case awaits producers and resets it                            |
| Refusals that preserve state, or compatible transitions      | Extend a nearby [acceptance journey](../../../tests/engine_worktree_test.ts)                                                                | Assert preserved refs, evidence, and authority; separate alternatives that consume or change prerequisites |
| Argument parsing, streams, exit status, or process lifecycle | [Engine helpers](../../../tests/engine_helpers.ts), [CLI helpers](../../../tests/helpers.ts), or [MCP client](../../../tests/mcp_client.ts) | Retain the real process boundary that the assertion exercises                                              |

Use [named case tables](../../../tests/assert_cases.ts) for related inputs to one contract. The helper runs every row and retains each failed row's name and original error. Its synchronous callback rejects asynchronous work at the type boundary. Use `assertCasesAsync` for ordered read-only observations or injected runtimes whose cases own their state. Keep process, repository, and host-timing journeys in native tests or steps so their lifecycle boundaries remain visible. Reusing an observation removes repeated execution; a case table retains its scenarios. Report those changes separately when measuring test reduction.

Keep each top-level test's repository ownership independent. Sharing state belongs within a named journey, whose steps retain meaningful failure diagnostics. Avoid stretching journeys so far that a failure becomes hard to isolate.

[Counted integration fixtures](../../../tests/engine_integration_fixture.ts) keep their producer counter outside every repository copy. The named journey owns that path until all steps finish. Each step awaits its producers and removes the counter in `finally`; the next step checks that it is absent. This permits a seed to name a journey-owned path without inheriting another case's observations. The [counter guard](../../../tests/engine_surface_fixture_test.ts) checks reset and final cleanup alongside the pristine-copy isolation guard.

Place shared helpers in modules without test registrations. Importing another native test module registers its cases in the importing worker as well as its own worker. The [registration guard](../../../tests/test_registration_guard_test.ts) scans the authored Deno source universe for runtime imports and re-exports of native test filenames, including literal dynamic imports. Type-only uses remain inert. Its shared [import parser](../../../tests/import_specifiers.ts) also serves the existing architectural graph guards.

## Preserve detection strength

Check that each retained assertion still reaches its intended condition. A refusal caused by a missing prerequisite does not exercise a later policy check. A gate result from another state may contain the same text without testing the same behavior.

Assert relevant state preservation between pooled refusals, including refs and recorded evidence where the contract requires it. A final successful operation can provide additional evidence that earlier refusals consumed nothing. A passing gate and unchanged coverage floors support the result; they do not establish equivalent defect detection. Use a focused known-bad perturbation when that equivalence remains uncertain.

Representative patterns live in the [acceptance journey](../../../tests/engine_worktree_test.ts), [pristine-copy fixture](../../../tests/engine_surface_fixture.ts), [checkpoint projections](../../../tests/engine_checkpoints_surfaces.ts), and [doctor tests](../../../tests/doctor_test.ts). Their separate fixtures also show where sharing would change the contract.

## Cost evidence and tuning

[Scoped call budgets](../../../tests/counted_calls.ts) protect fixed work inside existing observations. They retain the real effects of each function, reject excess calls before execution, and keep concurrent observations independent. The [doctor case](../../../tests/doctor_test.ts) configures applicability without a CLI call; the [schema case](../../../tests/result_schemas_test.ts) shares one unconfigured result across both validators; the [Desk fixture](../../../tests/engine_desk_queue_test.ts) permits exactly the surveys requested by the production desk. Extra surveys requested by the desk remain legal. Calls outside a budgeted observation remain unrestricted.

Keep measured imports behind their local counting adapter. These budgets cover calls through that adapter, not every process or result core in the suite. The [pristine-copy guards](../../../tests/engine_surface_fixture_test.ts) separately enforce one scaffold and isolated copies. Change a budget only when the observation's necessary state or boundary changes, and explain that change alongside the assertions. Additional independent scenarios do not justify raising an existing observation's allowance.

The [Git command budget test](../../../tests/engine_git_command_budget_test.ts) holds engine work independently of machine contention. Ordinary gate timings help locate expensive files. Controlled comparisons belong to substantial optimization work; daily development need not suspend other projects for timing evidence. JUnit parent durations already include their steps, so summing parent and step rows double-counts work.

Review the checkpoint's firing rate and declarations after its first 20 landed efforts using `discern checkpoints` and `discern patterns`. Inspect misses as well as firings. Narrow or soften a noisy selector before adding thresholds based on wall time. Extend the boundary set only when the new boundary performs work this question should cover, and add a focused selector case with it.
