# ADR 0282: Self-invocations carry recorded provenance

**Status**: accepted. Extends [ADR 0162](0162-logbook-day-one-vocabulary.md) and the population reporting in [ADR 0160](0160-local-logbook-advisory-readers.md).

## Context

The gate's job runner exports `CI=1` to every job it spawns — the honest signal for a local CI run, and the switch that keeps watch-mode test runners in single-run form. A job that itself invokes `discern` (the tidy step, documentation and reference checks) therefore records a Logbook event whose environment says CI, whose format flag says `--json`, and whose identity markers are whatever the outer session leaked in.

Measured over this repository's Logbook, those self-invocations are a large population: roughly a third of all recorded verb events are gate children. Under format-flag scoring they inflated the agent tally; under the current signal scoring they land in `unknown`; when the outer session was an agent's, their inherited markers attribute them to that agent's cohort, inflating run counts with plumbing nobody chose to run. Reading `ci` as the automation marker would conflate two different facts the moment a project runs discern in real CI: an externally scheduled gate run and a gate's own child are both `ci=true`.

discern knows precisely when it is spawning itself. Inferring that fact back out of ambient environment evidence discards knowledge the runner holds first-hand.

## Decision

The job runner declares itself. Alongside `CI=1`, it stamps `DISCERN_SPAWNED_BY=<invocation id>` — the Logbook invocation id of the verb whose gate is running, published across the process by the recorder. The CLI driver-fact gatherer records the marker verbatim as `driver.spawned_by`. The recorder stores evidence, never inference: the field is the raw marker, and scoring stays reader work.

Readers gain a fourth driver kind, `automation`: `spawned_by` present, or — for history recorded before this marker and for genuine external automation — `ci` set without it. Population accounts report `{agent, human, automation, unknown}`. The cohort seam excludes automation events from identity attribution and run denominators, so cohorts compare what a driver chose to run; the excluded share stays visible in the population account rather than disappearing.

A CLI process records one verb, so the stamped id is exact there. The long-lived MCP server could in principle overlap two effectful verbs; the published id is last-write-wins, making the link advisory evidence — like every driver signal — never authority.

## Consequences

- Gate children stop counting as anyone's decision: cohort denominators drop roughly the plumbing third, and per-verb cohort findings stop double-counting `tidy` and documentation checks under whichever agent ran the gate.
- ADR 0162's re-scoring promise pays retroactively: accumulated history reclassifies through the `ci` fallback with no migration, and the conflation of external CI with gate children in that fallback resolves itself as newly recorded events carry the explicit marker.
- A project running discern inside real CI reads honestly: externally driven runs are `automation` too, which is what they are.
- One more `DISCERN_*` variable rides the process-internals registry; children of a job can read it, and a shell opened inside a job would inherit it. The blast radius is one advisory Logbook field.

## Alternatives considered

- **Classify `ci=true` as automation with no new marker.** Rejected: it permanently conflates external CI with self-invocation, and it misreads any project whose developers export `CI` locally.
- **Thread the invocation id through the call chain to the runner.** Rejected as invasive: the recorder already owns the id; a process-scoped seam carries it with one setter and one reader.
- **Suppress Logbook recording in gate children entirely.** Rejected: the events are real work with real durations and failures; the honest fix is classification, not silence.
