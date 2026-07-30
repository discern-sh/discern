# ADR 0229: Bragging rights are counted, local, and never comparative

**Status**: accepted

## Context

The logbook records the practice's whole history — landings, gate runs, cycle times, pins — and the `patterns` readers mine it for what needs attention. Nothing read it back for the human driving the practice: the owner who wants to show, or just enjoy, what the agents shipped under their direction. That is a social and psychological surface, and social surfaces invite a specific failure mode: scores, grades, percentiles, and rankings, which start as motivation and end as targets. The logbook's own rules also bind any new reader: metadata only, nothing leaves the machine (ADR 0160), and evidence over inference — a baked-in score would fossilize the day it shipped exactly the way a baked-in driver inference would (ADR 0162).

## Decision

`discern patterns --brag` computes bragging rights as **plain counts and durations only**, from the same analysis population the detectors read (CI, previews, and setup-era events excluded). Each number carries its denominator where one exists. The payload is flag-gated: `data.brag` is present exactly when the invocation asked for it, so the default report and MCP surface stay lean. The MCP tool takes `brag: true` so an owner can ask their agent for the card.

The explicit *no*s:

- **No scores, grades, tiers, or rankings** — not even a composite "practice score". The counts are the product.
- **No comparisons to anyone else's numbers.** The logbook never leaves the machine, so there is no corpus to rank against; the card never pretends otherwise. Sharing is the owner's move, outside the tool.
- **No steering.** The card recommends nothing and gates nothing; the advisory boundary stays with the detector findings, and enforcement stays with standards.

## Consequences

- Every number on the card can be re-derived from the checkout, so a shared card can be checked rather than taken on faith — the counts are worth exactly the evidence behind them.
- The card stays honest on a bad week: streaks of one and empty sections go quiet instead of being dressed up, and a young logbook says there is nothing to brag about yet.
- Anyone proposing points, badges, streak freezes, or percentile ranks is proposing to reverse this record, not to extend it.
- The wire shape (`PatternsBragSchema`) is additive and optional, so the published results schema stays compatible; holding the no-scores line means future additions must arrive as new counts, not as judgments over the existing ones.

## Alternatives considered

- **A separate verb** (`discern brag`). Rejected: the read is the `patterns` read — same logbook, same population, same tolerant stream — and a verb implies a new subsystem where a rendering of an existing one is the truth.
- **Always computing `data.brag`.** Rejected: every MCP `patterns` call would pay the payload for a surface aimed at humans; flag-gating keeps the default result focused on findings.
- **Scores for sharing** ("top 5% of gates"). Rejected outright: with a local-only corpus any percentile would be invented, and the logbook's read-aloud bar has no room for numbers the evidence cannot defend.
