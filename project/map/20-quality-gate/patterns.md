---
title: Practice patterns
description: "Read what the Logbook shows about local workflow patterns: command loops, Gate fit, funnel flow, and each Standard's trajectory."
order: 100
aliases:
  - discern patterns
  - patterns
  - detectors
  - practice health
  - logbook reader
  - agent cohorts
  - instruction parity
---

# Practice patterns

_`discern patterns` reads the [logbook](../70-reference/the-logbook.md) and reports recurring local evidence, with the counts behind each finding and a recommended next step._

The diagnostic verbs ask different questions. `discern doctor` checks whether the install is valid. `discern improvement` checks whether the setup follows the declared practices. `discern patterns` looks for recurring workflow evidence, Gate fit, and changes in measured values over time ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). It is an [advisory](../00-orientation/glossary.md#advisory). Findings and their additive investigation paths carry counts and durations, with no scores or severity tiers ([ADR 0063](../_adr/0063-doctor-execution-model.md), [ADR 0277](../_adr/0277-patterns-investigations-preserve-source-findings.md)).

## Run it

```sh
discern patterns
discern patterns --json
discern patterns archives
discern patterns --logbook-file logbook-20260811T143015Z.jsonl
```

The human report presents bounded investigation paths before the raw finding blocks, whose stable order remains trajectory, Gate fit, workflow behavior, then the task funnel. A detector's title appears once, followed by one row per finding and one recommended next step. Each row gives the plain `summary` first and the concrete `observed` evidence directly below it. Each block keeps its strongest 3 findings and notes what it omitted; `discern patterns --all` reports the full set ([ADR 0256](../_adr/0256-patterns-findings-bounded-per-detector.md)). `✓`, `·`, and `!` distinguish favorable, neutral, and attention-worthy evidence. `tone` controls presentation. The evidence and advisory boundary stay unchanged ([ADR 0206](../_adr/0206-patterns-finding-tone-is-presentation-only.md)).

The header gives the day span, event and branch counts, driver split, detector scoreboard, and landing audit summary. The detailed landing block holds its count, denominator, share, and source split. `Worth your attention` projects the same summaries for up to 3 attention findings, with their full evidence blocks below.

Standard trajectories render a `▁▂▃▄▅▆▇█` sparkline with exact endpoints and equal-duration interior means; the wire series caps at 24 points.

The closing account names detectors with no finding and those with insufficient evidence. `--json` carries each finding's `summary`, `observed`, exact subject and scope, counts, next step, optional `series`, and optional structured `basis`. `--markdown` presents bounded findings and next actions as prioritized prose. `data.findings_total` joins when the bound elided findings. `data.investigations` is always present and uses the same `summary`-then-`observed` layers. Investigations cite the visible source findings without removing them. `data.detectors` accounts for the registry; `data.population` carries the driver split.

`patterns` runs every detector, including batch detectors that need longitudinal history. Inline detectors also appear on the working command named by their scope: branch findings project the canonical summary after a qualifying green Proof, session findings project that summary beside the next step in `status`, and project findings keep the complete two-layer shape in `improvement`. Short surfaces never author parallel wording. The Proof waits for 1 event beyond the registry threshold and prints no more than 1 finding line ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

An empty logbook is a normal state, and the report identifies it. A repository that never recorded, or opted out with `[project].record_logbook = false`, still gets a readable answer.

`discern patterns --stats` reads the same logbook for what went well and renders [practice stats](practice-stats.md) instead of the detector report: accepted changes, validation routes, green streaks, cycle times, Standards trends, per-checkpoint economics, and agent cohorts in a card of plain counts.

The active logbook is the default source. `discern patterns archives` lists each sealed archive's filename, event count, date span, skipped-line count, and bytes. `--logbook-file <filename>` selects one listed basename for the detector report or `--stats`; it also composes with `--all` and `--json`. `data.logbook.source` identifies `active` or the selected `archive`, and the terminal presentation names historical reads. The read-only `discern_patterns` MCP tool accepts `logbook_file` with the same basename rule. Historical reads never modify the archive; their own completion event, when recording is on, goes to the active logbook. Operational readers such as `status`, Proof hints, queue estimates, and work-in-flight checks always read active activity ([ADR 0272](../_adr/0272-logbook-lifecycle-actions-require-terminal-confirmation.md)).

## What the detectors watch

Registry detectors run over the event stream, grouped by family:

| Family            | Watches for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trajectory        | Each Standard's measured value over time beside its limit's own history (read from pin events), its current Gate-recorded pin eligibility, and the monthly red rate, extended past rotation by prune digests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Gate fit          | One job or the generated family dominating Gate time, material test-run slot contention, duration creep on an unchanged setup, an idle fix stage, one diagnostic class across branches, per-job verdict divergence under matched recorded conditions, verdict divergence between controlled execution contexts, the observed-and-estimated tradeoff around failures discovered after an early stop, and checkpoint hygiene: a configured checkpoint that never fires, one that fires on most efforts, and one that often lands under an owner-authorized variance.                                                                                                                                               |
| Workflow behavior | Red `done` streaks, repeated refusals with one slug, repeated clean-Gate work that recorded fix or regeneration preflight could have prevented, hint follow-through by declared family, tip adoption by registry entry, dirty-tree churn, edits on the trunk, recurring `--force`, recurring explicit same-tree Gate reruns (`--rerun`, plus historical `confirmed` Logbook evidence), missed doc lookups, inactive branches without a recorded green Gate, validation and acceptance ordering, recurring drivers the identity catalogue cannot name, a returning agent whose native integration is not configured, red streaks split by driver cohort, and instructions gaps split by attributed driver cohort. |
| Funnel            | Red runs before the first green per branch and per driver cohort, start-to-accept cycle time, single giant-commit landings, update friction trending up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Recurring merge conflicts

`recurring-merge-conflicts` identifies authored files that conflict across distinct revision pairs and multiple efforts. It includes updates and acceptance's integration merges, attributing temporary integration checkouts to their authoring effort. Successful merges enter the denominator. Unchanged retries count once across routes; contradictory outcomes and incomplete observations stay outside the denominator.

The finding suggests inspecting whether independent entries can become separate sources for a generated artifact. Declare the output `paths` and regeneration `run` in a `[generated.<name>]` group, keeping the authored entries outside those paths. Updates and acceptance rebuild declared outputs and resolve conflicts confined to generated files. Authored-source conflicts still require review.

Conflict recovery can show the same finding for a currently conflicting file using bounded recent history and the current observation. Patterns reads its selected history, including sealed archives. Missing older evidence cannot establish a conflict rate, and recurrence in a file does not establish recurrence in the same section. The [detector](../../../src/engine/logbook/merge_conflicts.ts) owns thresholds and counting; [ADR 0393](../_adr/0393-merge-observations-connect-conflict-recurrence-across-surfaces.md) records the evidence and recovery boundary.

### Test-run slot contention

After 6 capped runs, `slot-contention` reads the latest 20. It reports when median wait reaches 30 seconds and 25% of median execution. Raise the cap when the machine has spare capacity. Lower concurrent test demand when the machine is saturated.

### Decision evidence

Gate-time percentages, fail-fast tradeoffs, and standard pin trajectories remain observations until comparable project-local history supports an action. [Patterns decision evidence](patterns-decision-evidence.md) defines the separate avoidable-cost signals, labelled estimates, controlled-experiment rule, and mechanical-eligibility boundary ([ADR 0276](../_adr/0276-patterns-recommendations-require-project-local-decision-evidence.md)).

### Investigation paths

Related findings can form additive [Pattern investigations](pattern-investigations.md) with their source observations, evidence boundaries, diagnostic action, and falsifier. Raw findings stay visible, and incomplete or conflicting evidence produces no relationship ([ADR 0277](../_adr/0277-patterns-investigations-preserve-source-findings.md)).

### Validation verdict comparisons

Validation findings compare explicit per-job verdicts. `same-tree-flake` retains its published id for divergence under matched recorded conditions; `execution-context-divergence` names differences between controlled contexts. [Validation findings](validation-findings.md) defines their comparison keys, legacy boundary, denominators, and structured evidence.

Hint follow-through derives its families from the hint registry: branch update, red-gate remedy, main-session worktree start, and checkpoint declaration. It reports `fired`, `followed`, `not_followed`, and `censored` after 3 resolved episodes; missing correlation stays censored ([ADR 0207](../_adr/0207-hint-follow-through-is-declared-and-episode-based.md)). The checkpoint-declaration family walks the events' recorded checkpoint observations per checkpoint id, so every configured checkpoint enrols without naming itself: a declaration after a relevant in-scope revision resolves followed, one on the unchanged subject not followed; a missing block, missing revision flag, or a serving the history ends on censors. Declared-unchanged records the subject's history; the agent may have reviewed before invoking the gate.

`skipped-prepare` retains its stable id with evidence-dependent semantics. It recommends `discern prepare` only after at least 2 distinct clean HEADs under the same recorded config stop on stale declared regeneration or on fix-stage tree drift reached before later gate work. The finding states those eligible failures beside all `done` runs in that branch/config denominator. A missing `prepare` invocation does not establish a finding. Successful done-first entry and generic build/check/test failures do not establish this pattern. Ordinary dirty `done` refuses before producers; historical dirty runs and explicit standalone diagnostics remain in the workflow evidence. Additional runs on one HEAD do not establish the workflow pattern and remain available to the validation-divergence readers ([ADR 0275](../_adr/0275-validation-workflows-use-stream-bounded-change-cycles.md)).

Tip adoption derives its measured entries and invited verbs from the tip registry. A showing opens an episode for that tip. The invited verb can run on any branch, session, or surface. The next showing without that run resolves not followed. Missing setup evidence and the end of history stay censored. Each tip needs 3 resolved episodes, so sparse tips never pool their evidence. The finding gives that tip's raw `fired`, `followed`, `not_followed`, and `censored` counts. Fully followed tips stay visible with favorable tone. A family with not-followed evidence names the tip to reword or retire first ([ADR 0234](../_adr/0234-tips-are-the-desks-human-advisory-channel.md), [ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)).

### Checkpoint hygiene

`checkpoint-dead`, `checkpoint-noisy`, and `checkpoint-varied` read the shared economics tallies and advise on configuration fit; no finding evaluates an agent. The first two count gate-run efforts since the newest `[checkpoints]` config change, so a revised definition earns fresh evidence: after 8, a checkpoint that never fired reads as mis-scoped, and one served on at least 80% reads as taxing every change. `checkpoint-varied` speaks after 3 landed efforts where the checkpoint fired, at least half under owner-authorized variance. Findings give counts beside denominators and recommend a trigger, question, or mode review.

### Landing authority findings

After 8 consent-recorded landings, 3 granted, `pre-authorized-landings` reports count, share, source and scope splits, runs of 4, and 30-point half shifts.

`grant-suggestion` names `[acceptance].pre_authorized` after the latest 12 accepts land conversationally in one scope. A refusal, another source, missing scope, or second scope resets it. The owner edits the trunk; discern writes no grants.

## How the evidence is handled

Every detector declares an evidence threshold; below it the report says "insufficient evidence" rather than extrapolating. A short logbook produces a short report.

Every raw finding and investigation has two explicit text layers. `summary` states the condition in plain language. `observed` names the object and conditions, then gives the concrete count and denominator, an estimate label where relevant, and only material limitations. Interpretation follows the condition; neither layer establishes causality that the evidence does not record. The terminal, JSON, MCP, inline findings, and hints all project these same fields.

Validation and decision findings add a structured `basis` beside compatible numerical evidence. It carries the comparable count and denominator, setup conditions and exclusions, limitations, and an `observed` or `estimated` label for every value. Investigations preserve those distinctions in each cited observation and their shared `evidence_boundary`. The full source-evidence contract and bounds are in [Validation findings](validation-findings.md) and [patterns decision evidence](patterns-decision-evidence.md).

The recorder stores raw driver signals; readers classify them fresh on every read, so catalogue improvements cover accumulated history without a migration. `--json` and `--markdown` remain recorded format facts, but neither determines who invoked the CLI. CI runs and `--dry-run` previews reach no detector. Workflow-behavior detectors exclude runs that look interactively driven, so exploratory human runs do not enter agent-driven evidence. Tip adoption keeps human-driven runs because the detector measures what a person did after seeing the tip ([ADR 0162](../_adr/0162-logbook-day-one-vocabulary.md), [ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)). Setup-branch events describe a project being configured and stay outside analysis ([ADR 0224](../_adr/0224-trend-comparability-is-setup-equality.md)).

Identity evidence follows its recorded lifetime ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)). A signal scoped to the invocation, such as a process marker or recognized MCP client, can mark a run as agent-driven. Persistent host state remains supporting context and cannot determine a reading. A signal on an interactive-looking run makes that run ambiguous. Evidence naming two different agents attributes nothing. Corroboration strengthens a reading, while disagreement voids it. A finding built on identity evidence proposes an action: the provider-fit detector asks the owner to consider a configuration, and no detected condition changes setup, instructions, or output on its own.

Trend detectors compare runs sharing one setup: one config epoch, one discern release, and one dominant-MCP-client version. The agent's own releases move the practice too. Setup equality keeps a setup's runs in one series however many other runs interleave ([ADR 0224](../_adr/0224-trend-comparability-is-setup-equality.md)). Beside a too-short series, the report attributes excluded runs by count and setup ([ADR 0190](../_adr/0190-cohort-findings-lift-the-provider-comparison-deferral.md)). A corpus with no client declarations has no client dimension.

## What a cohort finding claims

Where the corpus holds enough attributed evidence, three detectors segment their findings by driver identity: `cohort-done-thrash`, `cohort-loops-to-green`, and `instruction-parity`. A cohort finding lays each population's counts beside their denominators ("Claude Code 1 of 30 branches, Codex 1 of 25") and always states the unattributed remainder. Automation runs ([marked child invocations](../70-reference/the-logbook.md#possible-agent-identity-signals) and conventional CI) join neither cohort nor remainder; `data.population` reports the volume. It claims nothing beyond those counts: task mixes differ by cohort, so the report never ranks one agent over another, and drawing the comparison stays your call ([ADR 0190](../_adr/0190-cohort-findings-lift-the-provider-comparison-deferral.md)).

A cohort key follows the same lifetime rule as the driver split, so a persistent host marker can never mint a cohort, and a branch two agents drove counts for neither. Splits speak only past recorded minimums (two qualifying cohorts, each holding a floor of runs and a share of the attributed corpus); below them the detector reports insufficient evidence. The minimums are recorded beside the seam in the registry source, tuned so a balanced corpus speaks and a trace second cohort stays quiet.

`instruction-parity` closes a loop specific to discern: one authored source compiles to every provider's instruction file, so a refusal or missing-page lookup that one population keeps hitting while its peers sit at zero directs the next check to that provider's compiled surface. The finding's next step names the file to check (`CLAUDE.md`, `GEMINI.md`, the canonical `AGENTS.md`), and a gap every cohort hits stays un-split: a shared gap is a shared fix.

## Manage the active history

```sh
discern patterns reset --dry-run
discern patterns seal --dry-run
discern patterns reset
discern patterns seal
```

Both lifecycle actions are CLI-only owner operations. Their `--dry-run` forms render the complete event count, date span, source-file list, bytes, and destination or deletion scope without requesting confirmation or changing files; add `--json` for the same structured plan or `--markdown` for its Markdown presentation. Apply requires terminal stdin and stdout, operation outside CI and global `--plain`, and an explicit Yes to a confirmation that defaults to No. Pipes, `--json`, and `--markdown` apply refuse. There is no confirmation flag or environment bypass. This supersedes the earlier unattended-reset choice ([ADR 0272](../_adr/0272-logbook-lifecycle-actions-require-terminal-confirmation.md)).

Reset removes only active history. Archive seals it and starts a fresh active logbook. [Logbook lifecycle](../70-reference/logbook-lifecycle.md) specifies the transaction, recovery path, recorder boundary, and historical-read commands. Recording starts again after either action unless `[project].record_logbook = false`.

Result fields and Model Context Protocol arguments are in [MCP tools & results](../70-reference/mcp-and-results.md). [The logbook](../70-reference/the-logbook.md) covers the recording substrate.

## Where it lives in code

| Concern                                  | Source                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| The detector registry and every detector | [`detectors.ts`](../../../src/engine/logbook/detectors.ts)                     |
| The investigation relationship registry  | [`investigations.ts`](../../../src/engine/logbook/investigations.ts)           |
| Validation comparison projections        | [`validation_findings.ts`](../../../src/engine/logbook/validation_findings.ts) |
| Driver scoring and the cohort seam       | [`cohorts.ts`](../../../src/engine/logbook/cohorts.ts)                         |
| The verb core, reports, and lifecycle    | [`patterns.ts`](../../../src/engine/logbook/patterns.ts)                       |
| Active/archive storage transactions      | [`store.ts`](../../../src/engine/logbook/store.ts)                             |
| Shared terminal wrapping and alignment   | [`text.ts`](../../../src/lib/text.ts)                                          |
| The tolerant stream reader               | [`read.ts`](../../../src/engine/logbook/read.ts)                               |
| Scope and tier routing                   | [`routing.ts`](../../../src/engine/logbook/routing.ts)                         |
| Bounded working-command reader           | [`surfaces.ts`](../../../src/engine/logbook/surfaces.ts)                       |
| Wire vocabulary and data schemas         | [`patterns_vocabulary.ts`](../../../src/shared/patterns_vocabulary.ts)         |
| Registry-driven fixtures and behavior    | [`patterns_test.ts`](../../../tests/patterns_test.ts)                          |
| Investigation registry and matrix        | [`investigations_test.ts`](../../../tests/investigations_test.ts)              |
| Cohort-seam rules at their home          | [`cohorts_test.ts`](../../../tests/cohorts_test.ts)                            |
| Routing and outcome guards               | [`logbook_routing_test.ts`](../../../tests/logbook_routing_test.ts)            |
| Black-box CLI coverage                   | [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts)            |

## Current state & gotchas

- A detector's `tier` and `scope` determine every working route. Batch findings stay under this verb.
- Ranking mixes count-based strengths across detector kinds; treat the order as a reading order and the `evidence` counts as the facts.
- Events written before the current release may lack newer fields (a step's gate stage, for example); detectors count such runs out rather than guessing. Identity signals exist only on events recorded since their introduction, so the driver split starts sparse and fills in with use.
- A torn or foreign line is skipped and counted in `data.logbook.unparsed`; reading continues.
