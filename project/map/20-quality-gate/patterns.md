---
title: Practice patterns
description: "Read what the Logbook shows about local workflow patterns: command loops, Gate fit, funnel flow, and each Standard's trajectory."
order: 90
aliases:
  - discern patterns
  - patterns
  - detectors
  - practice health
  - logbook reader
  - agent cohorts
  - guidance parity
---

# Practice patterns

_`discern patterns` reads the [Logbook](../70-reference/the-logbook.md) and reports recurring local evidence, with the counts behind each finding and a recommended next step._

The diagnostic verbs ask different questions. `discern doctor` checks whether the install is valid. `discern improvement` checks whether the setup follows the declared practices. `discern patterns` looks for recurring workflow evidence, Gate fit, and changes in measured values over time ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). It is an [advisory](../00-orientation/glossary.md#advisory). Findings carry counts and durations, with no scores or severity tiers ([ADR 0063](../_adr/0063-doctor-execution-model.md)).

## Run it

```sh
discern patterns
discern patterns --json
```

The human report uses a stable order: trajectory, Gate fit, agent behavior, then the task funnel. Within a section, the strongest detector block comes first. A detector's title appears once, followed by one row per finding and one recommended next step. Each block keeps its strongest 3 findings and notes what it omitted; `discern patterns --all` reports the full set ([ADR 0256](../_adr/0256-patterns-findings-bounded-per-detector.md)). `✓`, `·`, and `!` distinguish favorable, neutral, and attention-worthy evidence. `tone` never changes ranking or the advisory boundary ([ADR 0206](../_adr/0206-patterns-finding-tone-is-presentation-only.md)).

The header gives the day span, event and branch counts, driver split, detector scoreboard, and landing audit's count, share, and source split. `Worth your attention` lists the strongest 3 attention findings by glyph, detector, and subject, with the full blocks below.

Standard trajectories render a `▁▂▃▄▅▆▇█` sparkline with exact endpoints and equal-duration interior means; the wire series caps at 24 points.

The closing account names clear and young detectors. `--json` keeps findings ranked with their observation, scope, counts, next step, and optional `series`; `data.findings_total` joins when the bound elided findings. `data.detectors` accounts for the registry; `data.population` carries the driver split.

`patterns` runs every detector, including batch detectors that need longitudinal history. Inline detectors also appear on the working command named by their scope: branch findings appear after a qualifying green Proof, session findings join `status` hints, and project findings form the advisory history group in `improvement`. The Proof waits for 1 event beyond the registry threshold and prints no more than 1 finding line ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

An empty Logbook is a normal state, and the report identifies it. A repository that never recorded, or opted out with `[project].logbook = false`, still gets a readable answer.

`discern patterns --stats` reads the same Logbook for what went well and renders [practice stats](practice-stats.md) instead of the detector report: changes accepted, green streaks, cycle times, Standards trends, and agent cohorts in a shareable card of plain counts.

## What the detectors watch

Registry detectors run over the event stream, grouped by family:

| Family     | Watches for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trajectory | Each Standard's measured value over time beside its limit's own history (read from pin events), and the monthly red rate, extended past rotation by prune digests.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Gate fit   | One job or the generated family dominating gate time, material test-run slot contention, duration creep on an unchanged setup, an idle fix stage, one diagnostic class across branches, divergent verdicts on an identical tree, and failures discovered a run late after an early stop.                                                                                                                                                                                                                                                                                   |
| Behavior   | Red `done` streaks, repeated refusals with one slug, `done`-only iteration with no `prepare`, hint follow-through by declared family, tip adoption by registry entry, dirty-tree churn, edits on the trunk, recurring `--force`, recurring `done --confirmed` reruns, missed doc lookups, worktrees started but never green, out-of-protocol orderings, recurring drivers the identity catalogue can't name, a returning agent whose native integration isn't configured, red streaks split by driver cohort, and a guidance-parity read of gaps one cohort keeps hitting. |
| Funnel     | Red runs before the first green per branch and per driver cohort, start-to-accept cycle time, single giant-commit landings, update friction trending up.                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Test-run slot contention

After 6 capped runs, `slot-contention` reads the latest 20. It reports when median wait reaches 30 seconds and 25% of median execution. Raise the cap when the machine has spare capacity. Lower concurrent test demand when the machine is saturated.

Hint follow-through derives three families from the hint registry: branch update, red-gate remedy, and main-session worktree start. It reports `fired`, `followed`, `not_followed`, and `censored` after 3 resolved episodes; missing correlation stays censored. `skipped-prepare` uses done-heavy iteration without a hint ([ADR 0207](../_adr/0207-hint-follow-through-is-declared-and-episode-based.md)).

Tip adoption derives its measured entries and invited verbs from the tip registry. A showing opens an episode for that tip. The invited verb can run on any branch, session, or surface. The next showing without that run resolves not followed. Missing setup evidence and the end of history stay censored. Each tip needs 3 resolved episodes, so sparse tips never pool their evidence. The finding gives that tip's raw `fired`, `followed`, `not_followed`, and `censored` counts. Fully followed tips stay visible with favorable tone. A family with not-followed evidence names the tip to reword or retire first ([ADR 0234](../_adr/0234-tips-are-the-desks-human-advisory-channel.md), [ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)).

### Landing authority findings

After 8 consent-recorded landings, 3 granted, `pre-authorized-landings` reports count, share, source and scope splits, runs of 4, and 30-point half shifts.

`grant-suggestion` names `[acceptance].pre_authorized` after the latest 12 accepts land conversationally in one scope. A refusal, another source, missing scope, or second scope resets it. The owner edits the trunk; discern writes no grants.

## How the evidence is handled

Every detector declares an evidence threshold; below it the report says "insufficient evidence" rather than extrapolating: a young logbook produces a short report.

The recorder stores raw driver signals; readers score them fresh on every read, so improved scoring covers accumulated history without a migration. CI runs and `--dry-run` previews reach no detector. Agent-practice behavior detectors exclude runs that look interactively driven, so exploratory human runs do not enter agent-driven workflow evidence. Tip adoption keeps human-driven runs because the detector measures what a person did after seeing the tip ([ADR 0162](../_adr/0162-logbook-day-one-vocabulary.md), [ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)). Setup-branch events describe a project being configured and stay outside analysis ([ADR 0224](../_adr/0224-trend-comparability-is-setup-equality.md)).

Identity evidence follows its recorded lifetime ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)). A signal scoped to the invocation, such as a process marker or recognized MCP client, can mark a run as agent-driven. Persistent host state remains supporting context and cannot determine a reading. A signal on an interactive-looking run makes that run ambiguous. Evidence naming two different agents attributes nothing. Corroboration strengthens a reading, while disagreement voids it. A finding built on identity evidence proposes an action: the provider-fit detector asks the owner to consider a configuration, and no detected condition changes setup, guidance, or output on its own.

Trend detectors compare runs sharing one setup: one config epoch, one discern release, and one dominant-MCP-client version. The agent's own releases move the practice too. Setup equality keeps a setup's runs in one series however many other runs interleave ([ADR 0224](../_adr/0224-trend-comparability-is-setup-equality.md)). Beside a too-short series, the report attributes excluded runs by count and setup ([ADR 0190](../_adr/0190-cohort-findings-lift-the-provider-comparison-deferral.md)). A corpus with no client declarations has no client dimension.

## What a cohort finding claims

Where the corpus holds enough attributed evidence, three detectors segment their findings by driver identity: `cohort-done-thrash`, `cohort-loops-to-green`, and `guidance-parity`. A cohort finding lays each population's counts beside their denominators ("Claude Code 1 of 30 branches, Codex 1 of 25") and always states the unattributed remainder. It claims nothing beyond those counts: task mixes differ by cohort, so the report never ranks one agent over another, and drawing the comparison stays your call ([ADR 0190](../_adr/0190-cohort-findings-lift-the-provider-comparison-deferral.md)).

A cohort key follows the same lifetime rule as the driver split, so a persistent host marker can never mint a cohort, and a branch two agents drove counts for neither. Splits speak only past recorded minimums (two qualifying cohorts, each holding a floor of runs and a share of the attributed corpus); below them the detector reports insufficient evidence. The minimums are recorded beside the seam in the registry source, tuned so a balanced corpus speaks and a trace second cohort stays quiet.

`guidance-parity` closes a loop specific to discern: one authored source compiles to every provider's guidance file, so a refusal or missing-page lookup that one population keeps hitting while its peers sit at zero points at that provider's compiled surface. The finding's next step names the file to check (`CLAUDE.md`, `GEMINI.md`, the canonical `AGENTS.md`), and a gap every cohort hits stays un-split: a shared gap is a shared fix.

## Reset the history

```sh
discern patterns reset --dry-run
discern patterns reset
```

The reset deletes the Logbook directory, including each month file and the epoch sidecar, and prints what it removed. `--dry-run` lists the same plan without touching anything. It detaches the directory before deleting its files, so a recorder arriving mid-cleanup starts a new directory and new activity remains available. This destructive action lives on the CLI because deleting recorded history is an owner's local decision; no MCP tool exposes it ([ADR 0163](../_adr/0163-patterns-reset-cli-only.md)). Recording starts again unless `[project].logbook = false`.

Result fields and Model Context Protocol arguments are in [MCP tools & results](../70-reference/mcp-and-results.md). [The Logbook](../70-reference/the-logbook.md) covers the recording substrate.

## Where it lives in code

| Concern                                  | Source                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| The detector registry and every detector | [`detectors.ts`](../../../src/engine/logbook/detectors.ts)             |
| Driver scoring and the cohort seam       | [`cohorts.ts`](../../../src/engine/logbook/cohorts.ts)                 |
| The verb core, rendering, and the reset  | [`patterns.ts`](../../../src/engine/logbook/patterns.ts)               |
| Shared terminal wrapping and alignment   | [`text.ts`](../../../src/lib/text.ts)                                  |
| The tolerant stream reader               | [`read.ts`](../../../src/engine/logbook/read.ts)                       |
| Scope and tier routing                   | [`routing.ts`](../../../src/engine/logbook/routing.ts)                 |
| Bounded working-command reader           | [`surfaces.ts`](../../../src/engine/logbook/surfaces.ts)               |
| Wire vocabulary and data schemas         | [`patterns_vocabulary.ts`](../../../src/shared/patterns_vocabulary.ts) |
| Registry-driven fixtures and behavior    | [`patterns_test.ts`](../../../tests/patterns_test.ts)                  |
| Cohort-seam rules at their home          | [`cohorts_test.ts`](../../../tests/cohorts_test.ts)                    |
| Routing and outcome guards               | [`logbook_routing_test.ts`](../../../tests/logbook_routing_test.ts)    |
| Black-box CLI coverage                   | [`engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts)    |

## Current state & gotchas

- A detector's `tier` and `scope` determine every working route. Batch findings stay under this verb.
- Ranking mixes count-based strengths across detector kinds; treat the order as a reading order and the `evidence` counts as the facts.
- Events written before the current release may lack newer fields (a step's gate stage, for example); detectors count such runs out rather than guessing. Identity signals exist only on events recorded since their introduction, so the driver split starts sparse and fills in with use.
- A torn or foreign line is skipped and counted in `data.logbook.unparsed`; reading continues.
