# ADR 0282: Self-invocations carry recorded provenance

**Status**: accepted. Extends [ADR 0162](0162-logbook-day-one-vocabulary.md) and the population reporting in [ADR 0160](0160-local-logbook-advisory-readers.md).

## Context

The gate's job runner exports `CI=1` to every job it spawns — the honest signal for a local CI run, and the switch that keeps watch-mode test runners in single-run form. A job that itself invokes `discern` therefore records a Logbook event whose environment says CI, whose format flag says `--json`, and whose identity markers are whatever the outer session leaked in.

Measured over this repository's Logbook, roughly a third of all recorded verb events are gate children. Under format-flag scoring they inflated the agent tally; under signal scoring they land in `unknown`; when the outer session was an agent's, their inherited markers credit that agent's cohort with plumbing nobody chose to run. Reading `ci` alone as the automation marker would conflate an externally scheduled gate run with a gate's own child: both are `ci=true`.

discern knows precisely when it is spawning itself. Inferring that fact back out of ambient environment evidence discards knowledge the runner holds first-hand.

## Decision

The job runner declares itself. Alongside `CI=1`, it stamps `DISCERN_SPAWNED_BY=<invocation id>` — the running verb's Logbook invocation id, published across the process by the recorder. The CLI driver facts record the marker verbatim as `driver.spawned_by`; scoring stays reader work.

Readers gain a fourth driver kind, `automation`: `spawned_by` present, or — covering pre-marker history and genuine external automation — `ci` set without it. Population accounts report `{agent, human, automation, unknown}`. The cohort seam excludes automation events from identity attribution and run denominators, so cohorts compare what a driver chose to run; the excluded share stays visible in the population account.

A CLI process records one verb, so the stamped id is exact there. The long-lived MCP server could overlap two effectful verbs; the published id is last-write-wins, advisory evidence like every driver signal, never authority.

## Consequences

- Gate children stop counting as anyone's decision: cohort denominators drop the plumbing share, and per-verb findings stop crediting `tidy` and documentation checks to whichever agent ran the gate.
- ADR 0162's re-scoring promise pays retroactively: accumulated history reclassifies through the `ci` fallback with no migration, and the conflation of external CI with gate children in that fallback resolves itself as newly recorded events carry the explicit marker.
- A project running discern inside real CI reads honestly: externally driven runs are `automation` too, which is what they are.
- One more `DISCERN_*` variable rides the process-internals registry; a job's children inherit it. The blast radius is one advisory Logbook field.

## Alternatives considered

- **Classify `ci=true` as automation with no new marker.** Rejected: it permanently conflates external CI with self-invocation, and it misreads any project whose developers export `CI` locally.
- **Thread the invocation id through the call chain to the runner.** Rejected as invasive: the recorder already owns the id; a process-scoped seam carries it with one setter and one reader.
- **Suppress Logbook recording in gate children.** Rejected: the events are real work with real durations and failures; the honest fix is classification, not silence.
