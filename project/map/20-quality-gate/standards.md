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

A quality measure that can only improve (a standard) is a measured floor or ceiling in `discern.toml`. Every entry declares its direction: `direction = "up"` holds a floor; `direction = "down"` holds a ceiling. Omitting it is invalid. Before expensive work, `discern done` rejects a branch that redefines the quality claim, weakens its bound, or deletes it ([ADR 0133](../_adr/0133-standards-join-the-gate.md), [ADR 0323](../_adr/0323-standards-hold-normalized-enforcement-definitions.md)).

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

`metric` overrides the emitted metric name. The marker and name must be whole whitespace-delimited tokens; the last matching marker wins. A finite non-negative decimal is the verdict input. A failed producer fails its consumers even if it prints a usable marker. A clean exit without the required marker also fails. Recognized diagnostic reports carry data: their messages and test names cannot supply metric readings. Emit measurements outside the report. [Diagnostic-format recognition](../../../src/engine/gate/diagnostics.ts) owns this boundary for every supported format. A `per.metric` denominator uses the same last-marker rule. `timeout` sets this measurement's budget. `margin` leaves headroom when pinning.

## Keep its meaning stable

An existing standard holds three field roles:

| Role                 | Fields                                                    | Branch policy                                                           |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Enforcement meaning  | Metric, extraction, producer dependency graph, and inputs | Equivalent recipes may share a producer; observed inputs cannot weaken. |
| Monotonic bound      | `limit`                                                   | May only tighten: floors rise; ceilings fall.                           |
| Execution or pinning | `margin`, `timeout`                                       | May change without redefining the claim.                                |

Comparison resolves producer aliases through the execution graph. The same command can move to a shared producer without redefining a held metric. Observed environment/toolchain facts may be added, while declared input sets may widen. Omitted inputs bind evidence to its commit. A referenced job cannot change a standard’s command or dependency meaning. The policy is keyed by `StandardConfig`; new fields require a code policy and normalization.

`margin` changes only a future pin target. `timeout` bounds the same command; a timeout records no green evidence. Neither changes the measured claim.

Intentional redefinition or recalibration requires owner approval on trunk, followed by `discern update`. Branch reasons and measured-breach overrides cannot waive it.

## Choose a number that survives growth

Choose a coherent risk metric; leave broader inventories advisory. Then ask whether the metric moves with healthy project growth.

- An **invariant** never moves with growth, such as lint suppressions or uses of a banned pattern. Hold the raw count and drive it to zero.
- A **quality that scales** rises with the tree, such as coverage or alert density. Hold the rate: `per` and `scale` divide the metric, so a per-1,000-word ceiling holds density without penalizing proportional growth ([ADR 0057](../_adr/0057-rate-standards.md)).
- A **growing total** rises with each shipped feature, such as an asset size or word count. A ceiling pinned at today's value fails the next legitimate change. The resulting pressure can shrink unrelated content or trade readability for bytes while the Gate remains green. Prefer the rate that states the real claim. Where only the total will do, set a `margin` and treat raising the limit as a routine owner decision.

Report a breach the work itself caused instead of engineering the number back down. After the intended tree is committed, a targeted measured breach can become a standard limit proposal that reaches the owner through Proof and acceptance. Ordinary never-loosen enforcement remains in force without that proposal ([ADR 0161](../_adr/0161-growth-proof-standards-and-breach-escalation.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md), [ADR 0354](../_adr/0354-standard-proposals-renew-descendant-evidence.md)).

discern's own [duplication census](../80-development/duplication-census.md) is a down-only standard. It charges the non-overlapping normalized lines contributed by each additional source occurrence.

Process-egress, ambient-read, clock, scheduler, jitter, and secure-entropy standards use exact operation registries. Their structural commands bind each live primitive to one row before emitting falling counts, so new and stale entries fail even when totals remain level. Secure-entropy rows also record the required security property. The metric remains unavailable when parity or metadata validation fails ([ADR 0344](../_adr/0344-process-egress-and-termination-have-exact-boundaries.md), [ADR 0347](../_adr/0347-clock-scheduler-and-jitter-are-explicit-capabilities.md), [ADR 0348](../_adr/0348-secure-entropy-is-a-webcrypto-capability.md)).

The `detached_promise_boundaries` Standard follows the same validate-then-measure shape. Its task first type-checks every promise-like expression statement in the Git-derived production universe, then binds each registered `detachPromise` call to one row naming lifecycle, rejection, and shutdown ownership. Only a clean type scan and exact two-way registry parity emit the falling population ([ADR 0345](../_adr/0345-promise-effects-have-typed-owners.md)).

## What the Gate does

The gate checks protected definitions and limits against the trunk's committed policy, then assembles all required evidence. Reuse verifies the complete applicability tuple, including policy, producer dependencies, inputs, toolchain, environment and seed. A newer failed attempt for the same subject blocks an older success. Every standard is required; measurement deferrals are refused. `discern prepare` requests no measurement. See [Complete evidence](complete-evidence.md).

Package StandardMeter views retain each reading, limit, headroom, trajectory, measurement source, margin, and pin eligibility. Deferred and skipped facts invent no value. [`presentation.ts`](../../../src/engine/gate/presentation.ts) only maps `GateStandard` facts; the gate still decides comparisons and pin eligibility.

One pure gate function decides mechanical pin eligibility from direction, measured value, configured `margin`, and current limit. A measured or replayed result carries `margin`, `pin_eligible`, and the exact `pin_target` when eligible. Gate pinning and advisory patterns therefore consume the same answer. Eligibility means only that the target is strictly tighter and still holds the measurement; [Patterns decision evidence](patterns-decision-evidence.md#standard-trajectory-decisions) applies separate freshness, persistence, variance, failure, and retirement evidence before recommending a pin ([ADR 0276](../_adr/0276-patterns-recommendations-require-project-local-decision-evidence.md)).

## Run standards directly

`discern standards` requests every standard through the shared dependency planner. Positional names narrow an ordinary run and a pin to the validated named set; no names selects every standard, and an unknown name refuses before measurement. `data.standards` contains the selected set. A partial run never creates the reusable full-project measurement cache. First the command still checks branch definitions, limits, and trunk-only entries from one trunk snapshot. A redefined or loosened standard skips its command. Deleted entries and malformed trunk config fail without suppressing valid selected measurements.

Runnable measurements share the canonical producer graph. Consumers can read captured output or use `extract` on a declared immutable artifact. Equal recipes and prerequisites share one physical execution within the same validation attempt; equal command text alone does not establish compatibility. The executor and producer diagnostics use [`producerRecipeKey`](../../../src/engine/validation/catalog.ts) as that common boundary. Explicit producer references give a shared command one configured owner, whose input declaration must cover the complete command. Each extractor becomes eligible when its own producer settles. Valid component receipts may be reused for pin and proposal operations. A missing metric fails its consumer; a process failure fails every consumer. A cancelled measurement has no completed verdict, and stale evidence has no applicable verdict. Results name those states, carry no value or pin eligibility, and keep `unrun` dependencies skipped. Cancellation does not become a failed reading requiring a deliberate retry. Earlier applicable failed verdicts still require `done --rerun`.

Coverage shares one run across its aggregate rate, zero-ceiling module failures, and ratcheted exception count. Diagnostics preserve the failed set that a minimum percentage would hide ([ADR 0342](../_adr/0342-git-elects-module-coverage-membership.md)).

The gate runner supplies timeouts, process-tree kill, durations, interruption, and Model Context Protocol cancellation. Output stays buffered until the result renders ([ADR 0155](../_adr/0155-standalone-standards-share-the-gate-job-pipeline.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

## Propose a new limit

The MCP `discern_standards` tool's `action: "propose"` records an ordered batch of unique `{ name, reason }` standard breaches for one owner decision. `discern standards propose <name> --reason "…"` remains the terminal-compatible scalar form. A proposal transaction requires:

- a clean worktree branch at a committed `HEAD`;
- the unchanged trunk definition and limit;
- configured `inputs`; and
- at least one changed path that matches those inputs.

Treat proposal creation as a finalization step. Complete every required preview, review, regeneration, edit, `discern prepare` run, and ordinary commit first. Then record every simultaneously approved breach in one proposal action. The batch measures every selected standard against the same clean final `HEAD` through the shared measurement planner, so standards with one producer execute it once. A prior process-backed value for the same clean `HEAD` can be reused. Each reason is recorded verbatim as technical justification only; it must contain 1–500 visible characters on one line, contain no obvious secret, and must not claim approval, consent, or landing authority. Aim below 400 characters to leave relay headroom.

The initial transaction changes every selected limit to its measured value in one config-only commit. Every record binds to that same final commit and separates the immutable proposal origin from the renewable live binding: proposal commit and measured parent, current bound commit, definition fingerprint, trunk baseline, measurement, delta, reason, and responsible paths. A proposal preview shows the selected measurements and possible write without running a producer or changing config, Git history, Proof, or proposal state.

Repeating an identical complete batch on its bound commit changes nothing. A later descendant can renew the complete existing set by repeating the same MCP batch, or renew one proposal through the scalar terminal form, without another Git commit when each original proposal commit remains in its ancestry, the current trunk is contained, and every standard definition, trunk limit, reason, proposed value, fresh measurement, and responsible input attribution remains unchanged. Batch renewal shares producers and updates the set atomically. Renewal changes only the worktree-local bound commit, current trunk commit, and responsible paths; it invalidates prior Proof so the gate judges the descendant. A different value or reason is a different decision: the refusal reports the changed facts and requires the agent to present the new value, delta, and technical reason for fresh owner agreement before replacement. A stale proposal authorizes nothing and restores ordinary enforcement. Until atomic reconciliation is implemented, the batch action refuses to create any new proposal while the branch has existing active or stale proposal state; it does so before measuring or writing anything.

`discern done` remeasures a live proposal and records the standard limit proposal prominently in Proof. `discern accept` then refuses read-only and serves one approval token per proposal. The token is a 64-character lowercase hexadecimal digest of the exact standard, value, and reason. It makes a copied approval command stale when any of those facts changes; it is not a separate source of authority. Relay each standard, proposed value, delta, reason, and responsible path to the owner. After the owner approves those tuples in the current conversation, run the complete command returned by the refusal:

```sh
discern accept --confirmed --approve-standard <token>
```

Repeat `--approve-standard` for every proposal. The supplied tokens must equal the current proposal set. Standing grants, effort grants, generic landing consent, checkpoint variances, and earlier tokens do not approve standard limit proposals. Acceptance lands the proposal commit that passed the gate. It does not edit the limit or create a later commit. An [emergency landing](../30-worktrees/emergency-integration.md#exact-owner-decision) serves the same tokens in its plan, and its confirmation carries them the same way.

If the owner declines, leave acceptance stopped, restore the trunk limit in the branch, commit that restoration, and run `discern done` under ordinary enforcement.

## Respond to a failure

A failure puts its reason, value, limit, and command in `diagnostics[]`. [Tool result contracts](../70-reference/mcp-and-results.md) defines the public shape.

| Failure                                    | Response                                                                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The metric regressed                       | Move it the right way within the task's scope. When the change caused the breach, finish and commit the clean tree, then record every approved breach in one MCP proposal batch; the scalar CLI command remains available for one breach. |
| The branch redefined an existing Standard  | Restore the trunk definition. For an intentional change, ask the owner to change trunk, then update the worktree.                                                                                                                         |
| The branch weakened or deleted a limit     | Restore the trunk value. Tell the owner if the old limit is no longer valid.                                                                                                                                                              |
| The measurement emitted no matching metric | Make the command print `DISCERN_METRIC <name> <number>` and rerun it.                                                                                                                                                                     |
| The measurement is too slow                | Share a declared producer, reuse complete input evidence, and set justified producer and outer-job budgets.                                                                                                                               |

An owner may loosen a limit directly on trunk ([ADR 0003](../_adr/0003-named-metric-standards.md)).

## Capture an improvement

`discern standards --pin coverage` uses `margin`, tightens `coverage`, and commits `discern.toml`. It reuses every available same-commit value and measures selected values that are still missing. A named pin narrows execution to its targets only when an honored gate Proof already validates the complete clean tree. Without that Proof, every standard still validates before discern changes only the named limit. The commit keeps your Git identity and adds `discern` as a co-author because discern composed the diff ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)). The pin commit moves `HEAD`, so any earlier Proof goes stale. Run `discern done` before `discern accept` ([ADR 0368](../_adr/0368-local-durable-formats-declare-forward-skew.md)). A write-access probe runs first. A denial returns `error = "write_denied"` ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md), [ADR 0354](../_adr/0354-standard-proposals-renew-descendant-evidence.md)).

Pin records a clean `HEAD` before reading values and rechecks before editing. A mismatch writes nothing. Restore a stable `HEAD` and rerun. You can pin behind trunk. A hint says the values describe that tree, the limit may fail after `discern update`, and recommends updating first.

## Where it lives in code

| Concern                                     | Source                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config fields and validation                | [`config_schema.ts`](../../../src/shared/config_schema.ts)                                                                                                                                                                                        |
| Pure standard plan                          | [`standard_plan.ts`](../../../src/engine/gate/standard_plan.ts)                                                                                                                                                                                   |
| Shared trunk definition and limit check     | [`standard_limits.ts`](../../../src/engine/gate/standard_limits.ts)                                                                                                                                                                               |
| Proposed limit plan, state, and transaction | [`standard_proposal_plan.ts`](../../../src/engine/gate/standard_proposal_plan.ts), [`standard_proposal_state.ts`](../../../src/engine/gate/standard_proposal_state.ts), [`standard_proposals.ts`](../../../src/engine/gate/standard_proposals.ts) |
| Shared measurement and pin execution        | [`standards.ts`](../../../src/engine/gate/standards.ts)                                                                                                                                                                                           |
| Read-only standard preview                  | [`standards_gate.ts`](../../../src/engine/gate/standards_gate.ts)                                                                                                                                                                                 |
| Human Standard presentation                 | [`presentation.ts`](../../../src/engine/gate/presentation.ts)                                                                                                                                                                                     |
| Parallel scheduling and process-tree kill   | [`runner.ts`](../../../src/engine/jobs/runner.ts)                                                                                                                                                                                                 |
| Built-in write probes                       | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)                                                                                                                                                                                    |

## Current state & gotchas

- `inputs` is a correctness boundary: omitting a file the metric reads can replay a stale value.
- A Standard limit proposal requires `inputs` because its owner decision names the responsible changed paths.
- Proposal creation belongs after the intended tree is committed. Eligible descendant renewal exists for required follow-up work; it is not an intermediate commit loop.
- An unreadable trunk produces a prominent `UNVERIFIED` warning; the gate records it in the result and proof. Fetch trunk where standards run.
