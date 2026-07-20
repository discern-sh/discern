# ADR 0161: The logbook records its full vocabulary from day one, as evidence rather than inference

**Status**: accepted

## Context

ADR 0160 decided the logbook substrate. The first implementation recorded a lean event: verb, surface, branch, `HEAD`, cleanliness, a binary outcome, durations, diagnostic classes, and the config epoch. Reviewing it against the readers to come (waves 2–3) surfaced a structural fact about timing. The event schema is loose and versioned, so any field can arrive later without breaking a reader. But a field added after launch means every early adopter's first months of history can never carry it, and that early corpus is exactly what the first detectors tune on. The launch window is therefore the one moment "record it later" and "record it never" are the same decision for the data that matters most. The product ships in days.

Each specific gap was unanswerable retroactively. ADR 0160 promises the limit trajectory "reads straight back out of the logbook", yet pins recorded no values anywhere. Measured standard values evaporated after each gate run. Nothing distinguished a refusal from a red gate — the dogfood corpus shows `done` refusals indistinguishable from failures. `surface` cannot separate human from agent, because agents drive the CLI per the guidance. No event named the discern version that wrote it. Nothing recorded the scale of the change, so every longitudinal number lacked its denominator. And rotation deleted months wholesale, killing any trend longer than the retention window.

## Decision

**Fill the vocabulary before the first release, and record evidence, never inference.** Every event names its `writer` (the discern version). Verb events gain raw driver signals: a `session` hint, `--json`, terminal, CI. These are facts a reader scores, never a stored "was this an agent?" verdict — a stored verdict would fossilize the day-one heuristic into immutable history. They also gain a three-way `outcome`, where a verb that declined (an envelope error slug) is `refused`, distinct from work that ran red. The gate's `failed_stage` and touched `scopes` land beside it. So do the change's scale against the trunk merge-base, a dirty-diff fingerprint, the verb's `target` (a help topic, a map page — what agents look up is the purest guidance-gap signal), flag names (never values), per-standard readings (limit and measured value — the metric trajectory), and an update's counts. A `standards --pin` lands one first-class `pin` event per tightened limit, carrying the old bound, the new bound, and the measured value. That is the trajectory the epoch machinery masks, delivered through its own door as ADR 0160 promised. Retention doubles to 24 months. Pruning digests each removed month (totals by verb and outcome) into the `prune` event, so coarse trends outlive the raw lines.

Everything lifts from existing machinery — the envelope's steps, `GateData`, and the standards verb's new `data.standards`/`data.pinned` payload. The recorder measures nothing itself, and lifts by shape rather than verb name. The metadata bar is unmoved: every field is a name, a number, or a slug, safe to read aloud.

The explicit *no*s hold. No vendor attribution — a neutral session hint is not a vendor guess, there is still no cheap honest signal for vendors, and a wrong guess poisons the corpus worse than none. No payloads. No derived scores in the store. No env harvesting beyond the conventional CI marker.

## Consequences

- **The early corpus is complete.** Day-one adopters accumulate the fields the wave-2 detectors need. Nothing about the launch cohort's history is second-class.
- **The compatibility surface grows once, at the cheapest possible moment** — before any released reader exists. The substrate-era minimal line remains readable forever (pinned by test), and fields only accrete.
- **Readers own interpretation.** Driver scoring, task segmentation, and flake detection are reader logic over raw signals, revisable across the whole history. This is the substrate/reader split of ADR 0160, applied to the schema itself.
- **The trust page's read-aloud bar now covers more fields** — all still names and numbers. The no-network guard and footprint inventory are untouched.

## Alternatives considered

- **Ship the lean schema, enrich in a point release.** Rejected: additive fields are technically free later, but the launch cohort's missing months are unrecoverable, and the first corpus is the one the first detectors are tuned on.
- **Store a driver confidence score.** Rejected: a stored inference freezes the scoring heuristic at write time. Raw signals let a better future reader re-score all accumulated history.
- **A `pin` field on the verb event instead of its own kind.** Rejected: the trajectory is a first-class series (one row per tightened limit), and a dedicated kind keeps it readable without unpacking verb events.
