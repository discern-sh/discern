# ADR 0434: Standard limit proposals keep the configured margin

**Status**: accepted on 2026-11-24. Amends the proposed-limit transaction in [ADR 0339](0339-proposed-standard-limits-and-shared-measurements.md) and its descendant renewal in [ADR 0354](0354-standard-proposals-renew-descendant-evidence.md). Extends the pin margin in [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md) and the growing-total guidance in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md).

## Context

A standard can declare a `margin`: headroom for a number that moves with unrelated changes, such as a byte count. `discern standards --pin` keeps it. ADR 0106 records why: a limit pinned to the measurement fails on the next unrelated commit.

A limit proposal ignored the margin. The transaction set the proposed limit to the measurement, so an approved raise left a drifting standard with no headroom, and the next change that moved the number needed a second owner decision for the same kind of growth. This repository met the pattern on its `binary_size` ceiling: two raises to the measured byte count within a day, then a third that added headroom by hand.

The exact proposal had three properties worth keeping. The owner decides one number. The record proves its own arithmetic, through `measurement === proposed_limit`. A reading that rose after the proposal failed the standard, because the limit sat on the measurement. Headroom removes the second and third unless something replaces them.

## Decision

A proposal for a standard with a `margin` sets the limit to the measured value with that margin kept as headroom. [`standardLimitWithHeadroom`](../../../src/engine/gate/standard_plan.ts) is the single definition: a floor at `value - margin`, a ceiling at `value + margin`, rounded to two decimals in the looser direction. The pin target and the proposed limit both come from it. The limit an owner approves is therefore the limit a pin would choose for the same measurement, and a later pin finds nothing to tighten.

A standard without a margin proposes the measurement itself, unrounded. Its record, identity, and rendered text are the ones it had before this decision.

The margin applied is the standard's configured value on the measured commit. No flag selects it and no second setting overrides it. A standard that should keep no headroom declares no margin.

The proposal record gains an optional `margin`, present only when the standard has one. It states the measurement, the margin, and the proposed limit as separate facts. The approval token still binds the standard, the proposed limit, and the reason: the owner approves the number that lands. [`standardLimitProposalFigures`](../../../src/shared/standard_limit_proposal_text.ts) renders the move once for Proof, the acceptance refusal, and the proposal result, as `1000 → 1090 (measured 1040; margin 50; delta +90)`.

The record's integrity rule becomes `proposed_limit === proposedStandardLimit(direction, measurement, margin)`, with the recorded margin equal to the configured one. Renewal on a descendant requires the fresh measurement to equal the recorded measurement. It no longer compares the measurement with the proposed limit.

The gate requires its own reading of a proposed standard to equal the proposal's recorded measurement. A reading that moved fails the gate as a stale proposal even when the proposed limit still holds it. `discern standards` applies the same rule. Headroom can let a moved reading pass the limit; it never lets the Proof quote a measurement the gate did not take.

The breach diagnostic for a standard with a margin names the limit a proposal would set. The agent asks the owner about that limit before proposing, so the number the owner agrees to is the number acceptance later serves.

The record's new field is optional and omitted when the standard has no margin. Every existing proposal store, journal, Gate Proof, acceptance journal, completion record, and Proof note still reads, and a proposal without a margin keeps its earlier bytes. No format version changes. An older discern that meets a record carrying `margin` in a strict local format treats it as malformed, which authorizes nothing. Proof notes tolerate additive fields.

A proposal that an earlier discern recorded for a standard with a margin reads as stale after the upgrade, because its limit no longer follows from its measurement and margin. The renewal refusal names the limit a replacement would record, and the owner decides that limit.

## Consequences

- One owner decision covers a breach and the ordinary movement that follows it, for standards that declared they move.
- A proposal can loosen a limit past the value the change demonstrated, by the margin. The owner sees that amount beside the measurement and approves the resulting limit.
- `margin` now sizes a proposal as well as a pin. A branch can still change it without owner approval, and a proposal on that branch applies the changed value. The limit that results needs the owner's exact approval, so the field gains no authority of its own.
- A proposal and a pin agree on where a limit belongs for one measurement. Rounding follows the pin: a proposed limit with a margin has at most two decimals.
- A measurement that changes on the bound commit now fails the gate immediately. Before, a reading that fell below the proposed limit passed, and only a later standalone measurement staled the proposal.
- Standards without a margin behave as before.

## Alternatives considered

- **Keep proposals exact, so the owner approves only the demonstrated breach.** Rejected because the breach is still what triggers a proposal, and the margin is the project's own statement that the number moves. An exact limit on such a number is the state ADR 0106 names as broken, and repeated small approvals teach an owner to stop reading them.
- **Apply the trunk's margin, or refuse a proposal when the branch changed it.** Rejected because the first breach is the natural moment to add a margin, and a second landing only to make it count adds a step with no new information. The owner already decides the resulting limit with the margin stated.
- **A flag or a separate setting for proposal headroom.** Rejected because it asks for a choice the configuration already answers.
- **Derive the headroom from `proposed_limit - measurement`.** Rejected because rounding makes that difference differ from the configured value, and a durable record should state the input it used.
- **A required `margin` field with new format versions.** Rejected because every record without a margin would lose byte identity and older binaries would refuse proposals that use no new behavior.
- **Bind the measurement and margin into the approval token.** Rejected because the token identifies the decision, which is the limit and its reason. Proof equality and the acceptance comparison already bind the complete record.
