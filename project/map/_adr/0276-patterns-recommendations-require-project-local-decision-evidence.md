# ADR 0276: Patterns recommendations require project-local decision evidence

**Status**: accepted. Builds on the advisory boundary in [ADR 0160](0160-local-logbook-advisory-readers.md), setup-equality comparisons in [ADR 0224](0224-trend-comparability-is-setup-equality.md), and the structured evidence contract in [ADR 0274](0274-validation-findings-separate-matched-and-cross-context-divergence.md).

## Context

A recurring percentage or favorable trajectory is an observation, not yet a decision. A necessary test can dominate Gate time, cancelling siblings can save more work than a later failure costs, and a Standard can be eligible to pin while its recent values remain volatile. Treating those shapes as recommendations would substitute discern's repository experience for the project's own tradeoff.

Standards also had two possible authorities. Gate pinning already owned direction, rounding, current limit, and configured margin, while Patterns could derive a similar target from recorded values. Two implementations could disagree at equality or rounding boundaries, and old Logbook events do not carry enough information to reconstruct the current decision safely.

## Decision

Gate owns one pure mechanical Standard-pin decision. Given direction, measured value, margin, and current limit, it returns either ineligible or the exact strictly tighter target. Gate and standalone Standards execution use that function and add `margin`, `pin_eligible`, and, when eligible, `pin_target` to measured or replayed Standard readings. The Logbook records those additive fields. Patterns consumes them and performs no pin arithmetic.

Mechanical eligibility is not a recommendation. `standard-trajectory` recommends a pin only for an active Standard whose latest comparable entry is measured or replayed, whose last 3 comparable readings all carry current Gate eligibility, and whose latest 5 comparable readings contain no direction reversal or same-Standard regression. A deferred on-demand entry routes to `discern standards`. Missing current fields suppress advice as legacy or stale evidence. A retired Standard remains a historical trajectory with no live action.

Gate-time share remains descriptive. `dominant-stage` and `generator-gate-share` give optimization advice only when the same comparable history records separate avoidable-cost evidence. The implemented evidence is a named scope gate running outside its scope, repeated execution on one complete unchanged validation state, or material queue contention. There is no universal stage-duration floor.

Fail-fast analysis is an observed-and-estimated ledger. It counts cancelled and never-started jobs, distinct failures in later comparable red rounds, the additional rounds, and their recorded elapsed time. Cancelled-tail savings use the median of at least 3 completed durations for the same job and setup, less any recorded partial cancellation duration. The basis labels that value as estimated and states that adjacency does not prove when or why the later failure arose.

For a conservative configuration trial, every cancelled job must have enough samples and later-round elapsed time must exceed 1.5 times a second estimate built from the maximum comparable completed duration for each cancelled job. The finding then recommends a controlled local `fail_fast = false` trial before adoption. When the median saved-tail estimate exceeds later-round cost by 1.5 times, it recommends keeping fail-fast. Every other shape remains unresolved and routes to a controlled experiment.

Decision findings use the additive structured `basis` from ADR 0274. It names the comparable count and denominator, setup conditions and exclusions, limitations, and whether every numerical value is observed or estimated. Active and sealed Logbook sources run the same reader arithmetic.

## Consequences

- Patterns can report a dominant percentage or eligible Standard without proposing a change.
- Gate pinning, recorded eligibility, and Patterns agree at rounding, equality, and margin boundaries by construction.
- Volatility, recent regression, stale on-demand evidence, and retirement suppress recommendation without rewriting history or denying a recorded mechanical fact.
- Fail-fast findings expose both sides of the tradeoff and never claim that cancellation caused a later failure.
- Older events remain readable but cannot support a recommendation that depends on fields they never recorded.
- The fixed sample floors and 1.5 multiplier are deliberately conservative starting rules. Later tuning must preserve project-local samples, explicit estimates, and the advisory boundary.

## Alternatives considered

- **Recommend from Gate-time percentage or one duration floor.** Rejected because necessary work and project feedback budgets differ.
- **Recompute pin targets in Patterns.** Rejected because it creates a second authority and makes rounding or margin drift possible.
- **Recommend every mechanically eligible pin.** Rejected because eligibility says nothing about freshness, persistence, variance, recent failure, or retirement.
- **Count later failures as fail-fast cost without estimating cancelled work.** Rejected because it measures only one side and implies an unsupported causal relationship.
- **Automatically edit `fail_fast` or pin a Standard.** Rejected because Patterns is advisory and the recorded evidence still requires an owner decision.

## Amendment: compare equivalent costs before recommending failure policy

The fail-fast ledger retains its observed later rounds and estimated cancelled job tails. It no longer compares a sum of concurrent job durations with whole-invocation elapsed time through the 1.5 multiplier above. Those quantities have different units of work, and the largest observed duration is not a guaranteed upper bound. Neither ratio establishes which policy reaches green sooner.

A policy recommendation needs a controlled comparison of the same required repair journey, including producer counts, seeds, cache and load, with elapsed time separated from concurrent work. Missing clocks and incomplete reports remain explicit. The report offers a bounded investigation and never changes failure policy, queue capacity or environment rules. This amendment supersedes the fixed multiplier and its keep/change recommendations; the other evidence and pinning boundaries remain in force.
