# Test runtime reduction ledger

Experiment recorded on 2026-09-29. The retained changes remove 78 fixture subprocesses, 19 duplicate status surveys, and one duplicate result call. The measured full-suite improvement is small; the 15% target is unmet.

Assigned worktree: `/Users/jack/Sites/discern.worktrees/consolidate-tests-257b01`. Starting commit: `4fcc3efc462d7232e6a61c55e5b4bb20eab11a0d`. Target: test-stage median at most 85% of baseline; complete-gate median must not increase. Exact overall covered lines and the full module coverage table must match. Production, selection, scheduling, instrumentation, concurrency and limits stay fixed.

## Measurement protocol

Retain the owner's uncontended complete `done` run as baseline sample 1. Add two complete `done --rerun --json` runs at the unchanged starting commit before editing. Run no focused tests or other builds beside timing samples. Use the operation journal's start/finish interval for complete-gate time, and the returned test step's duration for test time. The separate launcher wall time is diagnostic. Retain JUnit, producer cost lines, module coverage table and operation handle for each sample. JUnit parent time includes steps; count only parent time when ranking files.

Evidence directory: `/private/tmp/discern-runtime-reduction/` (raw local logs and repeatable measurement scripts).

## Baseline

| Sample       | Commit       | Test seconds | Complete gate seconds | Coverage                                                         | Handle          |
| ------------ | ------------ | -----------: | --------------------: | ---------------------------------------------------------------- | --------------- |
| 1 (retained) | 4fcc3efc462d |          780 |               798.041 | 128132 / 138848; 494 elected modules; zero module-floor failures | R1-KRPP-ECFQ-GQ |
| 2            | 4fcc3efc462d |          795 |               813.719 | exact total and all 491 numeric module entries equal             | R1-M5TW-JD8E-R4 |
| 3            | 4fcc3efc462d |          819 |               837.673 | exact total and module table equal                               | R1-VV18-N6DY-05 |

Sample 1: 144 partitions, 18 processes with one worker each; 4693 passed, one skipped. Instrumented suite 749.855 s; report 11.099 s; cleanup 15.944 s. Coverage processed 2,016,433 profiles / 5,004,977,649 bytes. These existing settings are not optimization candidates.

Baseline medians: **795 s test stage; 813.719 s complete gate**. Test target: **675.75 s**.

## Candidate ranking and decisions

- **Judgment / walk prerequisites (first requested inspection):** seven judgment scenarios (192.776 s parent total) and four walk scenarios (66.687 s) each repeat scaffold, config, Git init and refresh. Their counter script embeds a fresh absolute scratch path, so the full original fixture is not reusable. Chosen experiment: a named journey owns the external counter for the lifetime of one converged seed and its sequential independent copies. Cases remove the counter before the next step. Keep all `done`, `accept`, `await`, race injections, negative controls and counter assertions. Expected removal: nine scaffold/config/init/refresh sequences; retain eleven real scenario lifecycles. No new Git commits per case. Applied for focused before/after measurement.
- **Integration landing / recovery:** existing commit already copies compatible pristine installs. Remaining cases carry different configs, external flags, live worktrees or evidence. Copying completed/proven worktrees would require rebinding paths and authority; rejected as outside the documented pristine-copy boundary.
- **Worktree / prune default seeds:** 29 `mainWithWorktree`-family call sites in the worktree suite, similar repeated seed in prune. Main Git scaffolds are copyable before `addWorktree`; actual worktree creation and lifecycle operations must remain. Investigate after first timing experiment; expected saving is setup only, not all parent time.
- **Setup-completion prerequisite:** `readyForSetupDone` repeats scaffold, `setup begin`, config-set and refresh. The begin path writes setup state; cannot assume it is path-independent. Changing its real CLI boundaries wholesale is rejected. Investigate exact same-command seeds and ownership before considering copies.
- **Config and docs CLI matrices:** many calls explicitly test argument parsing, literal bytes, stream selection, exit status, invalid flag combinations and fresh-process behavior. Registration grouping or a warm multi-command subprocess would not preserve their boundary. Only genuinely duplicate observations or non-transport preparation are candidates.
- **Desk queue duplicate initial survey:** two tests total 189.646 s. The action fixture calls `statusResult` immediately before `runDesk` takes its own initial survey. The scripted application waits for the live view to finish loading before reading fixture data. Remove the fixture-only survey, retain every production initial/post-transition survey and real queue/acceptance effect, and assert that data exists when displayed. Expected saving: one status survey (and its Git reads) per action; native counters will establish the executed total. Unlike later reads, this initial observation has no intervening mutation and supplies no distinct assertion.

## Preservation checks

Keep original case names as native step names when pooling. Compare every retained scenario body against the starting source after removing only the old fixture prefix. The existing `engine_surface_fixture_test.ts` guard checks copy independence, preserved checkout basename, removal of case and sibling worktrees before the next step, and final seed/case cleanup. The journey owns the counter outside every committed repository. Each case removes the counter in `finally`; the next case asserts absence. The outer temporary-directory owner also removes the counter directory.

Counter-pooling alternatives prepared before editing:

- A: copy a seed without its counter script, then commit a case-specific script. This removes nine refresh calls but adds eleven script commits; benchmark only if B is unsuitable.
- B: a named journey owns one external counter for the seed and every sequential copied case. Each case awaits its producers and removes the counter in `finally`; the next case asserts absence. Every case still owns an independent repository, sibling worktrees and any failure-injection scratch. This saves the entire nine redundant convergences without new Git commits. It introduces explicit counter lifetime management, which needs an isolation/cleanup guard. Unlike copying a case-owned path, the embedded path remains valid for the whole seed lifetime.

## Focused experiments

- Syntax comparison: all eleven original integration scenario bodies and all nine original helper bodies are identical after removing only repeated fixture setup and replacing directory ownership. Original native case names remain step names.
- Before: the unchanged three-file instrumented queued run passed all thirteen scenarios in 171.453 s. Executed counts: judgment fixture 7; walk fixture 4; `scaffoldEngine` 13; `gitInit` 13; `writeConfig` 14; `runAgent` 118; helper `git` 193; helper `gitOut` 106; Desk action 19; `statusResult` 105; `runGit` 29020. The latter includes production queries from real lifecycles; it is not the direct fixture-process count.
- Preparation probe: five repeated, instrumented scaffold/init/refresh/copy samples, through the test queue. Raw samples are in `preparation-cost.log`. Typical scaffold 22–24 ms, Git initialization 53–59 ms, basic copy 3–4 ms, refresh plus convergence commit 663–684 ms, converged copy 10–12 ms. These isolated preparation times rank candidates; they do not replace complete-gate timing.
- Worktree/prune broad pooling is deferred: removing approximately fifty basic prefixes would save only about four seconds of isolated aggregate preparation while rewrapping dozens of distinct lifecycle cases. This has insufficient expected benefit for the added diff and fixture structure.

- After: the identical three-file command passed four native parents and all eleven original integration steps in **152.216 s**, versus **171.453 s** before (11.22% lower). This is a focused sample, not the complete-gate target. Executed preparations: judgment **7→1**, walk **4→1**; scaffold and Git-init calls **13→4**, config writes **14→5**. Direct helper subprocesses **417→345**: CLI `runAgent` **118→109**, Git writes **193→139**, Git reads **106→97**. All nine removed CLI calls are prerequisite refreshes; all scenario `done`, `accept`, `await`, worktree and failure-injection calls remain.
- Desk action calls stay **19→19**; status surveys **105→86**. Across the focused run, production `runGit` calls fall **29020→26477**. These additional saved reads come from removing duplicate preparation/surveys; production Git behavior is unchanged. Raw profiles fall **59016→55429**.
- The existing fixture test file now guards the counter as well as pristine-copy ownership, keeping the selected test-file set unchanged. Both guards pass. A deliberate negative control removed only counter cleanup: the guard failed at the next case's `fresh counter` assertion. The helper was restored byte-for-byte afterward.

## Additional boundary review

- CLI helper environment setup already caches the source-engine shim by repository. Replacing its live existence check or changing child execution options would alter the process contract; no useful duplicate construction remains there.
- Status JSON/human pairs often use different projection modes, verbosity, terminal widths, roots or ambient output modes. A compact serialized orientation result is not the full input to the terminal presenter. Retain the observed CLI boundaries rather than substituting incomplete data.
- The result-schema journeys distinguish preview/apply, healthy/failing, missing/present, and changed repository states. The repeated unconfigured `testResult` observation is now shared by both original schema assertions.
- Doctor's six known-job applicability writes prepare one doctor observation. A direct fixture now replaces those CLI calls after a byte-equivalence audit; the canonical CLI applicability matrix remains in `config_command_test.ts`. Other configuration calls explicitly exercise argument parsing, command ordering, literal bytes, repairs or recommended recovery; they are not interchangeable.
- Git confirms the native test-file set is unchanged (664 files). No production source, gate configuration, instrumentation, runner, scheduling or concurrency setting changed.

## Complete-gate experiments

| Sample                 | Commit       | Test seconds | Complete gate seconds | Coverage                                     | Handle          |
| ---------------------- | ------------ | -----------: | --------------------: | -------------------------------------------- | --------------- |
| After 1 (intermediate) | 90e39325c615 |          781 |               799.661 | exact total and all 494 module entries match | R1-MSE3-HKS2-9X |
| After 2                | dbe1a4c5974a |          780 |               798.500 | exact total and all 494 module entries match | R1-CW4R-EC3V-RW |
| After 3                | dbe1a4c5974a |          779 |               798.075 | exact total and all 494 module entries match | R1-B1HK-DKTH-YV |

All six complete runs passed every configured check. After 1 predates the doctor/schema changes and is excluded from the final-code median. After 2 and 3 have medians **779.5 s test stage and 798.2875 s complete gate**: observed reductions of **1.95% and 1.90%**, respectively, versus the three-run baseline medians. The original owner sample was 780 s, which these results essentially match. The 15% target remains unmet, and the small timing difference is within the baseline run-to-run spread.

A subsequent complete `done` run on the committed ledger supplies final-tree Proof and a third timing sample for the unchanged test implementation. Its retained operation journal and the final delivery report that sample; this table records the runs completed before the ledger commit.

Raw profile counts are 2,016,433 in each baseline, 2,012,847 in After 1, and 2,010,501 in both final-code samples. The final reduction is 5,932 profiles (0.294%). The complete module table is byte-identical in every completed run, including 491 numeric entries and three type-only entries. SHA-256: `320edc9730bd3b4137910fc19ca7c37136926afdfc701de4f9c2d3cef1e0b915`. These are the gate's reported module rates, rounded to one decimal place; the exact aggregate covered/found counts are preserved. This does not assert that an unretained line-by-line LCOV set was compared.

Preparation-probe samples (milliseconds; diagnostic only):

| Sample | Scaffold | Git init | Basic copy | Config | Refresh + commit | Converged copy |
| ------ | -------: | -------: | ---------: | -----: | ---------------: | -------------: |
| 0      |   50.574 |   64.085 |      3.973 |  0.450 |          685.467 |          9.222 |
| 1      |   21.971 |   52.715 |      3.112 |  0.271 |          684.015 |         11.900 |
| 2      |   23.566 |   59.048 |      3.374 |  0.308 |          683.020 |         12.419 |
| 3      |   21.817 |   52.508 |      3.911 |  0.288 |          663.492 |         12.262 |
| 4      |   23.006 |   53.923 |      3.511 |  0.265 |          672.107 |         10.135 |
| Median |   23.006 |   53.923 |      3.511 |  0.288 |          683.020 |         11.900 |

## Final small reuse experiments

| Focused sample                            | Before seconds | After seconds | Executed work before → after                                        |
| ----------------------------------------- | -------------: | ------------: | ------------------------------------------------------------------- |
| Doctor schema/job/probe parent (13 steps) |         13.690 |         9.021 | `runCli` 11→5; production Git calls 616→538; raw profiles 5026→2680 |
| Prepare/test schema parent                |          6.185 |         4.046 | `testResult` 3→2; production Git calls 95→88; raw profiles 991→991  |

These launcher times include focused type-check/startup overhead and are not full-gate estimates. Every focused sample passed. The doctor before run also asserted that the direct fixture and the original six CLI edits yield byte-identical complete config text. The retained fixture uses the canonical job registry and asserts the resulting applicability list; all doctor assertions remain. The schema edit retains both original validators and their messages against one result.

Across disjoint focused scopes, retained changes remove **78 direct fixture subprocesses**, **19 status surveys**, and **one duplicate unconfigured test observation**. Internal production Git calls fall by **2628** across those samples (2543 + 78 + 7); this is measured test workload reduction, not a production optimization.

## Remaining routes and stopping judgment

The expensive-file ranking comes from the retained baseline JUnit parent times, not registration counts. The top files are landing (343.1 s), worktree (283.4 s), MCP (202.6 s), status (197.9 s), setup completion (194.4 s), judgment (192.8 s), Desk queue (189.6 s), acceptance authority (189.6 s), config commands (181.7 s), recovery (178.3 s), and doctor (170.6 s). Their durations overlap across workers and cannot be added to predict wall-time savings.

The original consolidation already writes Git identity without three `git config` processes, caches source-engine shims, and pools compatible landing/recovery installs. The expensive remaining acceptance fixtures create a changed worktree and obtain real Proof for that exact path and commit. Reusing completed fixtures would change the ownership, authority, or lifecycle being tested. Landing race fixtures bind commands to their own scratch paths and mutate their own trunk while checks run. Those executions are necessary scenario transitions.

A remaining small candidate is the equal-command subset of `readyForSetupDone`: its prerequisite contains three CLI calls (`setup begin`, config wiring, refresh). The thirteen call sites in `engine_setup_done_test.ts` also vary commands, environment, marker-commit failure, hooks, and authoring state. A five-sample instrumented queued probe measured a 1.886 s median prefix and 6.822 ms median copy. Seven calls use `true` with the default environment, so pooling those could remove six prefixes, approximately 11.3 s of isolated aggregate preparation. That is a candidate estimate, not a complete-gate saving or proof that setup state is portable. Pooling a compatible subset would require checking setup-state portability and retaining independent cold-setup coverage. It does not remove the costly `setup done`, probe, rollback, retry, or force-completion transitions. It is not a demonstrated route to the requested 119.25 seconds of complete-suite savings. Likewise, broad basic-seed pooling would remove only roughly four seconds of isolated aggregate work for fifty cases, while restructuring dozens of lifecycle tests.

No investigated reuse candidate supports the requested 15% reduction within the retained execution boundaries. This is a bounded search result, not proof that no future optimization exists. Further substantial work needs a newly identified redundant workload of comparable size, or a separately scoped investigation of engine execution/startup costs. Runner scheduling, instrumentation, selection, concurrency, limits, and required lifecycle coverage are not proposed shortcuts.

## Setup-completion preparation probe

All five samples passed; launcher time 13.474 s. The copy check establishes equal config and Git HEAD bytes only. It does not establish lifecycle portability or replace cold-setup coverage.

| Sample | Full setup prefix ms | Copy ms |
| ------ | -------------------: | ------: |
| 0      |             1872.259 |   7.675 |
| 1      |             1997.556 |   7.222 |
| 2      |             1960.211 |   6.791 |
| 3      |             1885.826 |   6.784 |
| 4      |             1871.233 |   6.822 |
| Median |             1885.826 |   6.822 |

## Local commits and retained evidence

The starting consolidation remains an ancestor. No changes were pushed or landed.

- `e3f3bf833`: reuse counted pristine integration fixtures, with isolation guard and map contract.
- `90e39325c`: reuse the Desk initial survey in queue fixtures.
- `078a503de`: author doctor applicability prerequisites without six redundant CLI edits.
- `dbe1a4c59`: reuse the unconfigured test result across both schema assertions.

Native V8 function-entry counts come from the first range of each named function in the focused profiles. `runAgent`, `runCli`, and the fixture `git`/`gitOut` helpers each launch a child at these call sites. Production `runGit` counts are function calls, not a claim of equivalent operating-system process counts. The focused scopes are disjoint where their savings are summed. All original `addWorktree` calls in the three-file experiment remain: **36→36**.

Raw evidence is retained locally under `/private/tmp/discern-runtime-reduction/`: `measure.py`, `focused.py`, `count-profiles.py`, `check-counted-bodies.ts`, `summarize.py`, each sample's JSON/logs, the positive and negative fixture-guard logs, and preparation-probe logs. Operation journals are under the main checkout's `.git/discern/operations/`, keyed by the table's handles. Complete-gate launcher times, excluding the unavailable retained sample 1 launcher: baseline 2 **814.180 s**, baseline 3 **838.354 s**, After 1 **800.071 s**, After 2 **798.910 s**, After 3 **798.781 s**. Launcher time is not the complete-gate metric.
