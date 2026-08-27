---
id: explanation-evidence-and-improvement
title: "Evidence and improvement"
description: "Understand what local patterns and validation findings can support, and where comparison stops short of causation or ranking."
order: 90
publish: true
kind: explanation
aliases:
  - "explanation-evidence-and-improvement"
  - "Practice patterns"
  - "patterns"
  - "detectors"
  - "logbook reader"
  - "agent cohorts"
  - "instruction parity"
  - "Validation findings"
  - "same-tree-flake"
  - "execution-context-divergence"
  - "validation evidence basis"
  - "Patterns decision evidence"
  - "decision-grade patterns"
  - "fail-fast tradeoff"
  - "Standard pin recommendation"
  - "Pattern investigations"
  - "finding synthesis"
  - "investigation paths"
  - "validation instability"
  - "Standard variance"
redirect_from:
  - "/docs/quality-gate/patterns"
  - "/docs/quality-gate/validation-findings"
  - "/docs/quality-gate/patterns-decision-evidence"
  - "/docs/quality-gate/pattern-investigations"
---

# Evidence and improvement

Understand what local patterns and validation findings can support, and where comparison stops short of causation or ranking.

## Practice patterns

_`discern patterns` reads the [Logbook](../30-reference/logbook.md) and reports recurring local evidence, with the counts behind each finding and a recommended next step._

The diagnostic verbs ask different questions. `discern doctor` checks whether the install is valid. `discern improvement` checks whether the setup follows the declared practices. `discern patterns` looks for recurring workflow evidence, Gate fit, and changes in measured values over time ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)). It is an [advisory](../30-reference/glossary.md#advisory). Findings and their additive investigation paths carry counts and durations, with no scores or severity tiers ([ADR 0063](https://discern.sh/docs/decisions/0063-doctor-execution-model), [ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

### Run it

```sh
discern patterns
discern patterns --json
discern patterns archives
discern patterns --logbook-file logbook-20260811T143015Z.jsonl
```

The human report presents bounded investigation paths before the raw finding blocks, whose stable order remains trajectory, Gate fit, workflow behavior, then the task funnel. A detector's title appears once, followed by one row per finding and one recommended next step. Each row gives the plain `summary` first and the concrete `observed` evidence directly below it. Each block keeps its strongest 3 findings and notes what it omitted; `discern patterns --all` reports the full set ([ADR 0256](https://discern.sh/docs/decisions/0256-patterns-findings-bounded-per-detector)). `✓`, `·`, and `!` distinguish favorable, neutral, and attention-worthy evidence. `tone` controls presentation. The evidence and advisory boundary stay unchanged ([ADR 0206](https://discern.sh/docs/decisions/0206-patterns-finding-tone-is-presentation-only)).

The header gives the day span, event and branch counts, driver split, detector scoreboard, and landing audit summary. The detailed landing block holds its count, denominator, share, and source split. `Worth your attention` projects the same summaries for up to 3 attention findings, with their full evidence blocks below.

Standard trajectories render a `▁▂▃▄▅▆▇█` sparkline with exact endpoints and equal-duration interior means; the wire series caps at 24 points.

The closing account names detectors with no finding and those with insufficient evidence. `--json` carries each finding's `summary`, `observed`, exact subject and scope, counts, next step, optional `series`, and optional structured `basis`. `--markdown` presents bounded findings and next actions as prioritized prose. The published `brief` field remains an exact compatibility alias of `summary`; it is not a second claim. `data.findings_total` joins when the bound elided findings. `data.investigations` is always present and uses the same `summary`-then-`observed` layers; its published `interpretation` is an exact compatibility alias of `summary`. Investigations cite the visible source findings without removing them. `data.detectors` accounts for the registry; `data.population` carries the driver split.

`patterns` runs every detector, including batch detectors that need longitudinal history. Inline detectors also appear on the working command named by their scope: branch findings project the canonical summary after a qualifying green Proof, session findings project that summary beside the next step in `status`, and project findings keep the complete two-layer shape in `improvement`. Short surfaces never author parallel wording. The Proof waits for 1 event beyond the registry threshold and prints no more than 1 finding line ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

An empty Logbook is a normal state, and the report identifies it. A repository that never recorded, or opted out with `[project].logbook = false`, still gets a readable answer.

`discern patterns --stats` reads the same Logbook for what went well and renders [practice stats](../30-reference/logbook.md) instead of the detector report: accepted changes, validation routes, green streaks, cycle times, Standards trends, per-checkpoint economics, and agent cohorts in a card of plain counts.

The active Logbook is the default source. `discern patterns archives` lists each sealed archive's filename, event count, date span, skipped-line count, and bytes. `--logbook-file <filename>` selects one listed basename for the detector report or `--stats`; it also composes with `--all` and `--json`. `data.logbook.source` identifies `active` or the selected `archive`, and the terminal presentation names historical reads. The read-only `discern_patterns` MCP tool accepts `logbook_file` with the same basename rule. Historical reads never modify the archive; their own completion event, when recording is on, goes to the active Logbook. Operational readers such as `status`, Proof hints, queue estimates, and work-in-flight checks always read active activity ([ADR 0272](https://discern.sh/docs/decisions/0272-logbook-lifecycle-actions-require-terminal-confirmation)).

### What the detectors watch

Registry detectors run over the event stream, grouped by family:

| Family            | Watches for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trajectory        | Each Standard's measured value over time beside its limit's own history (read from pin events), its current Gate-recorded pin eligibility, and the monthly red rate, extended past rotation by prune digests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gate fit          | One job or the generated family dominating Gate time, material test-run slot contention, duration creep on an unchanged setup, an idle fix stage, one diagnostic class across branches, per-job verdict divergence under matched recorded conditions, verdict divergence between controlled execution contexts, the observed-and-estimated tradeoff around failures discovered after an early stop, and checkpoint hygiene: a configured checkpoint that never fires, one that fires on most efforts, and one that often lands under an owner-authorized variance.                                                                                                                                              |
| Workflow behavior | Red `done` streaks, repeated refusals with one slug, repeated clean-Gate work that recorded fix or regeneration preflight could have prevented, hint follow-through by declared family, tip adoption by registry entry, dirty-tree churn, edits on the trunk, recurring `--force`, recurring explicit same-tree Gate reruns (`--rerun` and the compatibility `--confirmed` spelling), missed doc lookups, inactive branches without a recorded green Gate, validation and acceptance ordering, recurring drivers the identity catalogue cannot name, a returning agent whose native integration is not configured, red streaks split by driver cohort, and instructions gaps split by attributed driver cohort. |
| Funnel            | Red runs before the first green per branch and per driver cohort, start-to-accept cycle time, single giant-commit landings, update friction trending up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### Test-run slot contention

After 6 capped runs, `slot-contention` reads the latest 20. It reports when median wait reaches 30 seconds and 25% of median execution. Raise the cap when the machine has spare capacity. Lower concurrent test demand when the machine is saturated.

#### Decision evidence

Gate-time percentages, fail-fast tradeoffs, and Standard pin trajectories remain observations until comparable project-local history supports an action. [Patterns decision evidence](evidence-and-improvement.md) defines the separate avoidable-cost signals, labelled estimates, controlled-experiment rule, and mechanical-eligibility boundary ([ADR 0276](https://discern.sh/docs/decisions/0276-patterns-recommendations-require-project-local-decision-evidence)).

#### Investigation paths

Related findings can form additive [Pattern investigations](evidence-and-improvement.md) with their source observations, evidence boundaries, diagnostic action, and falsifier. Raw findings stay visible, and incomplete or conflicting evidence produces no relationship ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

#### Validation verdict comparisons

Validation findings compare explicit per-job verdicts. `same-tree-flake` retains its published id for divergence under matched recorded conditions; `execution-context-divergence` names differences between controlled contexts. [Validation findings](evidence-and-improvement.md) defines their comparison keys, legacy boundary, denominators, and structured evidence.

Hint follow-through derives its families from the hint registry: branch update, red-gate remedy, main-session worktree start, and checkpoint declaration. It reports `fired`, `followed`, `not_followed`, and `censored` after 3 resolved episodes; missing correlation stays censored ([ADR 0207](https://discern.sh/docs/decisions/0207-hint-follow-through-is-declared-and-episode-based)). The checkpoint-declaration family walks the events' recorded checkpoint observations per checkpoint id, so every configured checkpoint enrols without naming itself: a declaration after a relevant in-scope revision resolves followed, one on the unchanged subject not followed; a missing block, missing revision flag, or a serving the history ends on censors. Declared-unchanged records the subject's history; the agent may have reviewed before invoking the gate.

`skipped-prepare` retains its stable id with evidence-dependent semantics. It recommends `discern prepare` only after at least 2 distinct clean HEADs under the same recorded config stop on stale declared regeneration or on fix-stage tree drift reached before later Gate work. The finding states those eligible failures beside all `done` runs in that branch/config denominator. A missing `prepare` invocation does not establish a finding. Successful done-first entry, generic build/check/test failures, and dirty `done` runs remain valid; dirty `done` intentionally returns full Gate feedback. Additional runs on one HEAD do not establish the workflow pattern and remain available to the validation-divergence readers ([ADR 0275](https://discern.sh/docs/decisions/0275-validation-workflows-use-stream-bounded-change-cycles)).

Tip adoption derives its measured entries and invited verbs from the tip registry. A showing opens an episode for that tip. The invited verb can run on any branch, session, or surface. The next showing without that run resolves not followed. Missing setup evidence and the end of history stay censored. Each tip needs 3 resolved episodes, so sparse tips never pool their evidence. The finding gives that tip's raw `fired`, `followed`, `not_followed`, and `censored` counts. Fully followed tips stay visible with favorable tone. A family with not-followed evidence names the tip to reword or retire first ([ADR 0234](https://discern.sh/docs/decisions/0234-tips-are-the-desks-human-advisory-channel), [ADR 0236](https://discern.sh/docs/decisions/0236-tip-adoption-clears-evidence-per-tip-across-setups)).

#### Checkpoint hygiene

`checkpoint-dead`, `checkpoint-noisy`, and `checkpoint-varied` read the shared economics tallies and advise on configuration fit; no finding evaluates an agent. The first two count gate-run efforts since the newest `[checkpoints]` config change, so a revised definition earns fresh evidence: after 8, a checkpoint that never fired reads as mis-scoped, and one served on at least 80% reads as taxing every change. `checkpoint-varied` speaks after 3 landed efforts where the checkpoint fired, at least half under owner-authorized variance. Findings give counts beside denominators and recommend a trigger, question, or mode review.

#### Landing authority findings

After 8 consent-recorded landings, 3 granted, `pre-authorized-landings` reports count, share, source and scope splits, runs of 4, and 30-point half shifts.

`grant-suggestion` names `[acceptance].pre_authorized` after the latest 12 accepts land conversationally in one scope. A refusal, another source, missing scope, or second scope resets it. The owner edits the trunk; discern writes no grants.

### How the evidence is handled

Every detector declares an evidence threshold; below it the report says "insufficient evidence" rather than extrapolating. A short Logbook produces a short report.

Every raw finding and investigation has two explicit text layers. `summary` states the condition in plain language. `observed` names the object and conditions, then gives the concrete count and denominator, an estimate label where relevant, and only material limitations. Interpretation follows the condition; neither layer establishes causality that the evidence does not record. The terminal, JSON, MCP, inline findings, and hints all project these same fields.

Validation and decision findings add a structured `basis` beside compatible numerical evidence. It carries the comparable count and denominator, setup conditions and exclusions, limitations, and an `observed` or `estimated` label for every value. Investigations preserve those distinctions in each cited observation and their shared `evidence_boundary`. The full source-evidence contract and bounds are in [Validation findings](evidence-and-improvement.md) and [Patterns decision evidence](evidence-and-improvement.md).

The recorder stores raw driver signals; readers classify them fresh on every read, so catalogue improvements cover accumulated history without a migration. `--json` and `--markdown` remain recorded format facts, but neither determines who invoked the CLI. CI runs and `--dry-run` previews reach no detector. Workflow-behavior detectors exclude runs that look interactively driven, so exploratory human runs do not enter agent-driven evidence. Tip adoption keeps human-driven runs because the detector measures what a person did after seeing the tip ([ADR 0162](https://discern.sh/docs/decisions/0162-logbook-day-one-vocabulary), [ADR 0236](https://discern.sh/docs/decisions/0236-tip-adoption-clears-evidence-per-tip-across-setups)). Setup-branch events describe a project being configured and stay outside analysis ([ADR 0224](https://discern.sh/docs/decisions/0224-trend-comparability-is-setup-equality)).

Identity evidence follows its recorded lifetime ([ADR 0166](https://discern.sh/docs/decisions/0166-agent-identity-is-advisory-logbook-evidence)). A signal scoped to the invocation, such as a process marker or recognized MCP client, can mark a run as agent-driven. Persistent host state remains supporting context and cannot determine a reading. A signal on an interactive-looking run makes that run ambiguous. Evidence naming two different agents attributes nothing. Corroboration strengthens a reading, while disagreement voids it. A finding built on identity evidence proposes an action: the provider-fit detector asks the owner to consider a configuration, and no detected condition changes setup, instructions, or output on its own.

Trend detectors compare runs sharing one setup: one config epoch, one discern release, and one dominant-MCP-client version. The agent's own releases move the practice too. Setup equality keeps a setup's runs in one series however many other runs interleave ([ADR 0224](https://discern.sh/docs/decisions/0224-trend-comparability-is-setup-equality)). Beside a too-short series, the report attributes excluded runs by count and setup ([ADR 0190](https://discern.sh/docs/decisions/0190-cohort-findings-lift-the-provider-comparison-deferral)). A corpus with no client declarations has no client dimension.

### What a cohort finding claims

Where the corpus holds enough attributed evidence, three detectors segment their findings by driver identity: `cohort-done-thrash`, `cohort-loops-to-green`, and `instruction-parity`. A cohort finding lays each population's counts beside their denominators ("Claude Code 1 of 30 branches, Codex 1 of 25") and always states the unattributed remainder. Automation runs (gate children and conventional CI) join neither cohort nor remainder; `data.population` reports the volume. It claims nothing beyond those counts: task mixes differ by cohort, so the report never ranks one agent over another, and drawing the comparison stays your call ([ADR 0190](https://discern.sh/docs/decisions/0190-cohort-findings-lift-the-provider-comparison-deferral)).

A cohort key follows the same lifetime rule as the driver split, so a persistent host marker can never mint a cohort, and a branch two agents drove counts for neither. Splits speak only past recorded minimums (two qualifying cohorts, each holding a floor of runs and a share of the attributed corpus); below them the detector reports insufficient evidence. The minimums are recorded beside the seam in the registry source, tuned so a balanced corpus speaks and a trace second cohort stays quiet.

`instruction-parity` closes a loop specific to discern: one authored source compiles to every provider's instruction file, so a refusal or missing-page lookup that one population keeps hitting while its peers sit at zero directs the next check to that provider's compiled surface. The finding's next step names the file to check (`CLAUDE.md`, `GEMINI.md`, the canonical `AGENTS.md`), and a gap every cohort hits stays un-split: a shared gap is a shared fix.

### Manage the active history

```sh
discern patterns reset --dry-run
discern patterns archive --dry-run
discern patterns reset
discern patterns archive
```

Both lifecycle actions are CLI-only owner operations. Their `--dry-run` forms render the complete event count, date span, source-file list, bytes, and destination or deletion scope without requesting confirmation or changing files; add `--json` for the same structured plan or `--markdown` for its Markdown presentation. Apply requires terminal stdin and stdout, operation outside CI and global `--plain`, and an explicit Yes to a confirmation that defaults to No. Pipes, `--json`, and `--markdown` apply refuse. There is no confirmation flag or environment bypass. This supersedes the earlier unattended-reset choice ([ADR 0272](https://discern.sh/docs/decisions/0272-logbook-lifecycle-actions-require-terminal-confirmation)).

Reset removes only active history. Archive seals it and starts a fresh active Logbook. [Logbook lifecycle](../30-reference/logbook.md) specifies the transaction, recovery path, recorder boundary, and historical-read commands. Recording starts again after either action unless `[project].logbook = false`.

Result fields and Model Context Protocol arguments are in [MCP tools & results](../30-reference/mcp-and-results.md). [The Logbook](../30-reference/logbook.md) covers the recording substrate.

### Where it lives in code

| Concern                                  | Source                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| The detector registry and every detector | [`detectors.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/detectors.ts)                     |
| The investigation relationship registry  | [`investigations.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/investigations.ts)           |
| Validation comparison projections        | [`validation_findings.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/validation_findings.ts) |
| Driver scoring and the cohort seam       | [`cohorts.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/cohorts.ts)                         |
| The verb core, reports, and lifecycle    | [`patterns.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/patterns.ts)                       |
| Active/archive storage transactions      | [`store.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/store.ts)                             |
| Shared terminal wrapping and alignment   | [`text.ts`](https://github.com/jackwh/discern/blob/main/src/lib/text.ts)                                          |
| The tolerant stream reader               | [`read.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/read.ts)                               |
| Scope and tier routing                   | [`routing.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/routing.ts)                         |
| Bounded working-command reader           | [`surfaces.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/surfaces.ts)                       |
| Wire vocabulary and data schemas         | [`patterns_vocabulary.ts`](https://github.com/jackwh/discern/blob/main/src/shared/patterns_vocabulary.ts)         |
| Registry-driven fixtures and behavior    | [`patterns_test.ts`](https://github.com/jackwh/discern/blob/main/tests/patterns_test.ts)                          |
| Investigation registry and matrix        | [`investigations_test.ts`](https://github.com/jackwh/discern/blob/main/tests/investigations_test.ts)              |
| Cohort-seam rules at their home          | [`cohorts_test.ts`](https://github.com/jackwh/discern/blob/main/tests/cohorts_test.ts)                            |
| Routing and outcome guards               | [`logbook_routing_test.ts`](https://github.com/jackwh/discern/blob/main/tests/logbook_routing_test.ts)            |
| Black-box CLI coverage                   | [`engine_patterns_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_patterns_test.ts)            |

### Current state & gotchas

- A detector's `tier` and `scope` determine every working route. Batch findings stay under this verb.
- Ranking mixes count-based strengths across detector kinds; treat the order as a reading order and the `evidence` counts as the facts.
- Events written before the current release may lack newer fields (a step's gate stage, for example); detectors count such runs out rather than guessing. Identity signals exist only on events recorded since their introduction, so the driver split starts sparse and fills in with use.
- A torn or foreign line is skipped and counted in `data.logbook.unparsed`; reading continues.
## Validation findings

_Patterns separates repeated per-job divergence under matched recorded conditions from differences between controlled execution contexts._

### Matched conditions

`same-tree-flake` retains its published id. It compares a job's red and green outcomes only within one complete, same-version validation state and execution envelope. The outcome-free key covers capture boundary, evidence version, mode, writer, config, setup, job identity and definition, concurrency, and the planned sibling set. Skipped, cancelled, unavailable, and incomplete outcomes cannot establish divergence; eligible exclusions remain in the denominator. Unrecorded external context remains a limitation ([ADR 0273](https://discern.sh/docs/decisions/0273-validation-comparisons-require-complete-keyed-semantic-evidence)).

### Controlled context differences

`execution-context-divergence` holds state, job definition, writer, config, setup, and evidence versions fixed. Capture boundary, mode, concurrency, and sibling context may differ; the finding lists every differing dimension. A context containing red and green outcomes belongs to `same-tree-flake` and suppresses the cross-context finding. Resource contention, ordering, and environment sensitivity remain investigation paths ([ADR 0274](https://discern.sh/docs/decisions/0274-validation-findings-separate-matched-and-cross-context-divergence)).

### Legacy boundary

Legacy history never joins current evidence. Clean events may share an explicit job label, mode, and recorded clean start at one HEAD. Dirty events may share only an explicit job label, mode, HEAD, and tracked start fingerprint. Clean and dirty bases stay separate. Neither records a job definition or complete execution conditions; dirty evidence also lacks index/worktree and untracked-input distinctions. Event-level red or green cannot replace a missing job step.

### Result contract

The optional `basis` carries comparable count and denominator, validation version and completeness, matched and differing conditions, legacy and excluded-event counts, limitations, and an `observed` or `estimated` label for every flat evidence value. Flat and structured numerical values must agree. A condition displays at most 16 values and reports its full `distinct` and `omitted` counts. Comparison keys remain complete. The contract has no confidence score.

Complete `same-tree-flake` evidence can join recurring confirmed unchanged-state Gate reruns in the additive validation-instability investigation. Legacy or incomplete validation identity cannot support that relationship. The investigation cites both source findings and retains the comparison boundary; it does not claim that reruns caused the divergence or hide either finding ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

The detector registry is in [`detectors.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/detectors.ts); pure comparison projections are in [`validation_findings.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/validation_findings.ts); registry and surface guards are in [`patterns_test.ts`](https://github.com/jackwh/discern/blob/main/tests/patterns_test.ts), [`logbook_routing_test.ts`](https://github.com/jackwh/discern/blob/main/tests/logbook_routing_test.ts), and [`engine_patterns_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_patterns_test.ts).
## Patterns decision evidence

_Percentages, estimates, and mechanical eligibility become recommendations only when comparable local history supports the action._

`discern patterns` remains advisory. Its decision findings carry the comparable count and denominator, matched setup conditions, excluded events, limitations, and an `observed` or `estimated` label for every numerical value. Active and sealed Logbook sources use the same arithmetic.

### Gate-time share

A dominant job or generated-family percentage is a statistic. It produces optimization advice only when comparable local history also records avoidable cost: a named scope gate running outside its scope, repeated execution on one complete unchanged validation state, or material queue contention. There is no universal duration floor. A necessary test can dominate the Gate and remain quiet.

### Fail-fast tradeoff ledger

`masked-failures` retains its compatibility id and reports observations separately: cancelled and never-started jobs, distinct failures in later comparable red rounds, additional Gate rounds, and those rounds' elapsed time. Adjacent rounds do not establish when or why a later failure arose.

Saved tail is an estimate: the median of at least 3 completed durations for the same job and setup, less recorded partial cancellation time. The finding states the sample, exclusions, and assumption.

If later-round time exceeds 1.5 times a fully sampled maximum-duration saved-tail estimate, the finding recommends a controlled project-local `fail_fast = false` trial before adoption. If the median saved-tail estimate exceeds later-round time by 1.5 times, it recommends keeping fail-fast. Otherwise it calls the tradeoff unresolved and routes to a controlled experiment.

When unresolved later distinct failures coincide with long-running or queued validation under one recorded setup, the additive validation-scheduling investigation proposes one bounded comparison. It preserves recorded time and queue observations separately from saved-tail estimates and makes no causal claim.

### Standard trajectory decisions

The Gate records whether a measured or replayed Standard is mechanically eligible to pin and the exact target under its margin. Patterns reads that authority; it does not repeat direction, rounding, or margin arithmetic. Eligibility remains visible even when no pin is recommended.

A recommendation additionally requires a current active Standard, measured or replayed evidence, Gate eligibility across the latest 3 comparable readings, and no direction reversal or same-Standard regression in the latest 5. A deferred on-demand reading routes to `discern standards`. Missing current fields stay historical or stale. A retired Standard remains a trajectory without a live pin action.

When current mechanical eligibility instead coincides with recent comparable reversals or failures, the additive Standard-variance investigation replaces no finding and offers no pin advice. It directs the owner to test whether the headroom is durable ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

The thresholds and authority boundary are recorded for future changes ([ADR 0276](https://discern.sh/docs/decisions/0276-patterns-recommendations-require-project-local-decision-evidence)). [Practice patterns](evidence-and-improvement.md) covers the report, detector families, evidence handling, and historical selection.
## Pattern investigations

_An investigation connects already-visible findings that clear one registered evidence rule. It proposes what to diagnose next without claiming a cause or changing the project._

### Result contract

`data.investigations` is always present beside `data.findings`. Each entry has a stable id, source finding ids, each source observation and denominator, shared setup and evidence limitations, one bounded interpretation, one preferred diagnostic action, and a falsifier. Numerical values retain their `observed` or `estimated` labels. An investigation has no strength, score, rank, or automatic setup change.

The terminal report presents investigation paths before the unchanged raw finding blocks. JSON and Model Context Protocol (MCP) return the same structured entries. Active and sealed Logbook sources use the same arithmetic. Inline command surfaces continue to show their routed raw findings.

### Registered relationships

One registry owns relationship order, finding requirements, evidence version and completeness, setup comparability, minimums, suppressors, cohort policy, and the pure producer. The first members are:

- complete same-state verdict divergence plus recurring confirmed unchanged-state Gate reruns: validation instability;
- repeated full-Gate failures plus record-proven preflight-preventable work on the same branch and setup: feedback loop;
- later distinct failures plus long-running or queued validation under one setup: a validation-scheduling experiment; and
- current mechanical pin eligibility plus recent comparable reversals or failures: Standard variance, with no pin advice.

Missing, mixed, legacy, incomplete, or conflicting evidence suppresses the relationship that needs it. Source findings remain visible. Identity-dependent validation synthesis requires complete current validation evidence. Cohort findings do not create or alter pooled investigations. Registry order and subject order make the result deterministic ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

The authority and pure projection are in [`investigations.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/investigations.ts). [`investigations_test.ts`](https://github.com/jackwh/discern/blob/main/tests/investigations_test.ts) enrolls every registry member in the valid, near-miss, conflict, setup, evidence-provenance, cohort, deduplication, and order matrix.
