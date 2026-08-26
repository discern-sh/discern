---
title: Standards
description: Hold a stable quality claim at a floor or ceiling that branches can tighten but not redefine.
order: 20
aliases:
  - quality metrics
  - metric floors
  - metric ceilings
  - discern standards
---

# Standards

_Hold a quality measure at a floor or ceiling that later branches cannot weaken._

A quality measure that can only improve (a Standard) is a measured floor or ceiling in `discern.toml`. Every entry declares its direction: `direction = "up"` holds a floor; `direction = "down"` holds a ceiling. Omitting it is invalid. Before expensive work, `discern done` rejects a branch that redefines the quality claim, weakens its bound, or deletes it ([ADR 0133](../_adr/0133-standards-join-the-gate.md), [ADR 0323](../_adr/0323-standards-hold-normalized-enforcement-definitions.md)).

## Add a Standard

```toml
[standards.coverage]
direction = "up"
limit = 89
run = "deno task coverage"
inputs = ["src/**", "tests/**"]
```

The measurement command reports its value on stdout:

```text
DISCERN_METRIC coverage 91.4
```

`metric` overrides the emitted metric name. `timeout` sets this measurement's budget. `margin` leaves headroom when pinning.

## Keep its meaning stable

An existing Standard holds three field roles:

| Role                 | Fields                                                            | Branch policy                                                          |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Enforcement meaning  | `metric`, `direction`, `run`, `per`, `scale`, `measure`, `inputs` | Must match normalized trunk; controls the claim or evidence freshness. |
| Monotonic bound      | `limit`                                                           | May only tighten: floors rise; ceilings fall.                          |
| Execution or pinning | `margin`, `timeout`                                               | May change without redefining the claim.                               |

Comparison applies schema defaults and equivalent scalar/list command forms, so omitted historical defaults match explicit current spelling. The policy is keyed by `StandardConfig`; new fields require a code policy and normalization.

`margin` changes only a future pin target. `timeout` bounds the same command; a timeout records no green evidence. Neither changes the measured claim.

Intentional redefinition or recalibration requires owner approval on trunk, followed by `discern update`. Branch reasons and measured-breach overrides cannot waive it.

## Choose a number that survives growth

Choose a coherent risk metric; leave broader inventories advisory. Then ask whether the metric moves with healthy project growth.

- An **invariant** never moves with growth, such as lint suppressions or uses of a banned pattern. Hold the raw count and drive it to zero.
- A **quality that scales** rises with the tree, such as coverage or alert density. Hold the rate: `per` and `scale` divide the metric, so a per-1,000-word ceiling holds density without penalizing proportional growth ([ADR 0057](../_adr/0057-rate-standards.md)).
- A **growing total** rises with each shipped feature, such as an asset size or word count. A ceiling pinned at today's value fails the next legitimate change. The resulting pressure can shrink unrelated content or trade readability for bytes while the Gate remains green. Prefer the rate that states the real claim. Where only the total will do, set a `margin` and treat raising the limit as a routine owner decision.

Report a breach the work itself caused instead of engineering the number back down. A fresh measured breach can become a Standard limit proposal that reaches the owner through Proof and acceptance. Ordinary never-loosen enforcement remains in force without that exact proposal ([ADR 0161](../_adr/0161-growth-proof-standards-and-breach-escalation.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

## Duplication holds normalized clone lines

The `duplicated_lines` Standard measures maximal clone groups from [`duplication_census.ts`](../../../scripts/duplication_census.ts). Fixed token windows nominate candidates; they are never findings. The detector collapses exact and small-edit matches, orders the resulting groups by size, and admits each exact source range to at most one group. Its held value charges formatting-independent statement and block boundaries for every occurrence after the first. A third paste therefore increases debt even when it joins an existing group, while one copied routine cannot inflate into a pile of overlapping windows.

Each diagnostic names a stable semantic fingerprint and every path/range to consolidate. Comments, formatting, local identifier names, and literal values do not define the fingerprint. Import and re-export declarations, type-only declarations, syntax-declared top-level registry tables, and files owned by the generated-artifact registry stay outside the population. The advisory `duplicate_clone_groups` metric reports the number of groups; the falling ceiling holds `duplicated_lines` because it tracks both clone size and additional copies.

The census has no cache. Its declared `inputs` cover the Git-derived authored JavaScript/TypeScript universe, generated ownership, parser dependency, and runner configuration. A matching source or ownership change measures it in the Gate; an unrelated change may replay the recorded value. See [Maintenance](../80-development/maintenance.md) for reducing and pinning the census.

## What the Gate does

The Gate checks normalized definitions and limits, then measures with checks and tests. It replays unchanged declared `inputs` and sends `measure = "on-demand"` to `discern standards`. Definition and limit checks never defer. A Standard with a live proposed limit measures fresh even when ordinary policy would replay or defer it. The reading must equal the proposal. `discern prepare` skips measurement.

Package StandardMeter views retain each reading, limit, headroom, trajectory, measurement source, margin, and pin eligibility. Deferred and skipped facts invent no value. [`presentation.ts`](../../../src/engine/gate/presentation.ts) only maps `GateStandard` facts; the Gate still decides comparisons and pin eligibility.

One pure Gate function decides mechanical pin eligibility from direction, measured value, configured `margin`, and current limit. A measured or replayed result carries `margin`, `pin_eligible`, and the exact `pin_target` when eligible. Gate pinning and advisory Patterns therefore consume the same answer. Eligibility means only that the target is strictly tighter and still holds the measurement; [Patterns decision evidence](patterns-decision-evidence.md#standard-trajectory-decisions) applies separate freshness, persistence, variance, failure, and retirement evidence before recommending a pin ([ADR 0276](../_adr/0276-patterns-recommendations-require-project-local-decision-evidence.md)).

## Run standards directly

`discern standards` freshly measures every Standard, including `measure = "on-demand"`. First it checks branch definitions, limits, and trunk-only entries from one trunk snapshot. A redefined or loosened Standard skips its command. Deleted entries and malformed trunk config fail without suppressing valid measurements.

Runnable measurements share one parallel group without fail-fast. Standards with the same command, checkout root, and timeout use one process, then select their metrics and receive independent verdicts and evidence. Replayed and deferred Standards stay outside the group. A missing metric fails only its consumer; a process failure fails every consumer.

Coverage shares one run across its aggregate rate, zero-ceiling module failures, and ratcheted exception count. Diagnostics preserve the failed set that a minimum percentage would hide ([ADR 0342](../_adr/0342-git-elects-module-coverage-membership.md)).

The gate runner supplies timeouts, process-tree kill, durations, interruption, and Model Context Protocol cancellation. Output stays buffered until the result renders ([ADR 0155](../_adr/0155-standalone-standards-share-the-gate-job-pipeline.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

## Propose a new limit

`discern standards propose <name> --reason "…"` records a Standard breach for an owner decision. The transaction requires:

- a clean worktree branch at a committed `HEAD`;
- a fresh process-backed breach from `discern standards` or the Gate on that commit;
- the unchanged trunk definition and limit;
- configured `inputs`; and
- at least one changed path that matches those inputs.

discern records the reason verbatim. It must contain 1–500 visible characters on one line and no obvious secret. The command changes the limit to the measured value in a config-only commit. Its worktree-local record contains the Standard, both commits, definition fingerprint, trunk baseline, measurement, delta, reason, and responsible paths. `--dry-run` shows this plan without changing the config, Git history, Proof, or proposal state.

Repeating the same request changes nothing. Replacing only the reason updates the proposal record and invalidates prior Proof without adding a commit. A moved commit, trunk, definition, limit, responsible-input boundary, or fresh measurement makes the record stale. A stale proposal authorizes nothing and restores ordinary enforcement.

`discern done` remeasures a live proposal and records the Standard limit proposal prominently in Proof. `discern accept` then refuses read-only and serves one approval token per proposal. The token is a 64-character lowercase hexadecimal digest of the exact Standard, value, and reason. It makes a copied approval command stale when any of those facts changes; it is not a separate source of authority. Relay each Standard, proposed value, delta, reason, and responsible path to the owner. After the owner approves those tuples in the current conversation, run the complete command returned by the refusal:

```sh
discern accept --confirmed --approve-standard <token>
```

Repeat `--approve-standard` for every proposal. The supplied tokens must equal the current proposal set. Standing grants, effort grants, generic landing consent, checkpoint variances, and earlier tokens do not approve Standard limit proposals. Acceptance lands the proposal commit that passed the Gate. It does not edit the limit or create a later commit.

If the owner declines, leave acceptance stopped, restore the trunk limit in the branch, commit that restoration, and run `discern done` under ordinary enforcement.

## Respond to a failure

A failure puts its reason, value, limit, and command in `diagnostics[]`. [Tool result contracts](../70-reference/mcp-and-results.md) defines the public shape.

| Failure                                    | Response                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The metric regressed                       | Move it the right way within the task's scope. When the change caused the breach, measure the clean commit and run `discern standards propose <name> --reason "…"`. |
| The branch redefined an existing Standard  | Restore the trunk definition. For an intentional change, ask the owner to change trunk, then update the worktree.                                                   |
| The branch weakened or deleted a limit     | Restore the trunk value. Tell the owner if the old limit is no longer valid.                                                                                        |
| The measurement emitted no matching metric | Make the command print `DISCERN_METRIC <name> <number>` and rerun it.                                                                                               |
| The measurement is too slow                | Add accurate `inputs`, set a per-job `timeout`, or use `measure = "on-demand"` when it cannot fit the final gate.                                                   |

An owner may loosen a limit directly on trunk ([ADR 0003](../_adr/0003-named-metric-standards.md)).

## Capture an improvement

`discern standards --pin coverage` reuses a Proof or measures, uses `margin`, tightens `coverage`, and commits `discern.toml`. The commit keeps your Git identity and adds `discern` as a co-author because discern composed the diff ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)). A write-access probe runs first. A denial returns `error = "write_access"` ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

Pin records a clean `HEAD` before reading values and rechecks before editing. A mismatch writes nothing. Restore a stable `HEAD` and rerun. You can pin behind trunk. A hint says the values describe that tree, the limit may fail after `discern update`, and recommends updating first.

## Where it lives in code

| Concern                                   | Source                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Config fields and validation              | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                                                   |
| Pure standard plan                        | [`standard_plan.ts`](../../../src/engine/gate/standard_plan.ts)                                                                                              |
| Shared trunk definition and limit check   | [`standard_limits.ts`](../../../src/engine/gate/standard_limits.ts)                                                                                          |
| Proposed limit plan and transaction       | [`standard_proposal_plan.ts`](../../../src/engine/gate/standard_proposal_plan.ts), [`standard_proposals.ts`](../../../src/engine/gate/standard_proposals.ts) |
| Shared measurement and pin execution      | [`standards.ts`](../../../src/engine/gate/standards.ts)                                                                                                      |
| Gate replay and deferral policy           | [`standards_gate.ts`](../../../src/engine/gate/standards_gate.ts)                                                                                            |
| Human Standard presentation               | [`presentation.ts`](../../../src/engine/gate/presentation.ts)                                                                                                |
| Parallel scheduling and process-tree kill | [`runner.ts`](../../../src/engine/jobs/runner.ts)                                                                                                            |
| Built-in write probes                     | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)                                                                                               |

## Current state & gotchas

- `inputs` is a correctness boundary: omitting a file the metric reads can replay a stale value.
- A Standard limit proposal requires `inputs` because its owner decision names the responsible changed paths.
- An unreadable trunk produces a prominent `UNVERIFIED` warning; the gate records it in the result and proof. Fetch trunk where standards run.
