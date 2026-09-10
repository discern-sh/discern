# ADR 0388: Rank priority partitions by committed duration hints

**Status**: accepted.

## Context

A complete macOS gate runs the suite as native partitions with one process per logical processor. Changed test files and the resolved importers of changed source form explicit priority partitions, and the checkout seed orders their admission ahead of the ordinary shards. Membership is fixed before any partition starts; only the order of admission is free.

The retained instrumented gate on `6864c4e63309` admitted 84 priority partitions in seeded order. Its last two substantial priority partitions started at roughly 822 and 849 seconds and then ran for 402 and 365 seconds, so the suite's tail was two known-expensive groups that had waited behind cheaper ones. Replaying that run's recorded partition durations under the same 18 slots reproduces its native elapsed time within six seconds: 1,224 seconds against 1,229.880 observed. Ranking only the 84 explicit priority partitions by the summed per-file test durations of the same run, and leaving the 60 ordinary shards in their seeded order, brings the replay to 1,054 seconds. Ranking them by the per-file durations of the earlier main run, which had no priority partitions, instead gives 1,055 seconds, so the gain does not depend on knowing the run's own timings in advance. Shortest-first ordering makes the replay worse, at 1,294 seconds.

The replay holds observed durations fixed while the overlap between partitions changes, and most duration-to-partition matches are inferred from ordered body durations. It is a model of one run, not a measured result of a changed order.

## Decision

A committed, versioned hint document, `scripts/test_duration_hints.json`, records seconds per test file: the sum of top-level test-body durations per reporting test module from one complete instrumented run. Nested steps are excluded by the registration line in the recorded source, never by their names. The document carries its provenance: the source commit, completion invocation, shuffle seed, the digest of the producer's standard output, and the completion time. A commit and a seed therefore reproduce an admission exactly.

The runner reads the document once per run. `costAwareAdmission` in `scripts/test_partitions.ts` ranks only the already-explicit priority selections by descending estimated cost after `partitionSelections` has fixed their membership. The seeded order breaks ties, so the comparator is a strict total order over finite numbers. Ordinary shards keep their seeded relative order and still run after every priority partition. The seeded shuffle of files into priority groups is untouched.

An unrecorded file is charged the most expensive recorded file. Under longest-first scheduling, underestimating a heavy group forms a tail while overestimating a light one costs at most that group's own short run, so unknown work is admitted early rather than assumed free. A missing or invalid hint document keeps seeded admission and reports the reason on standard error.

Refreshing the hints is a deliberate commit derived from complete retained evidence, with the provenance fields updated together. The runner never reads the logbook, a latest-run cache, or any timing produced by the gate it is running.

## Consequences

- Prioritised worktree gates admit their expensive priority partitions first. The modelled opportunity on the retained run is about 170 seconds of native suite time; the measured effect belongs to the retained gate of the change that introduced this decision and to later gates.
- A run without priority partitions, such as a clean trunk gate, keeps its existing seeded admission. Ordinary shard membership stays inside native discovery, so ranking it would require recreating Deno's discovery or reading cache-sensitive check output, which an earlier decision removed from the allocation.
- Hints age gracefully. A renamed or new file falls back to the pessimistic estimate, and the order degrades towards seeded admission as more files go unrecorded. Tests registered by a helper module are attributed to the helper module, so the files importing it are estimated low.
- Guards keep the selection identical with and without hints, admit every partition exactly once, keep priority before ordinary and ordinary in seeded order, hold ties and determinism, reject invalid documents with a reason, and demonstrate on a skewed fixed workload that seeded admission leaves a tail the ranked admission removes.
- A future refresh must come from one complete instrumented run whose producer output digest is recorded in the document, keeping the parent-only measure and the sorted, rounded entries.

## Alternatives considered

- Ranking with the running gate's own timings is impossible before the run and would make admission depend on the previous run of the same machine.
- Learning durations from each gate through a mutable cache or the logbook would stop a commit and seed from reproducing admission, and would couple the gate's order to its own history.
- Charging an unrecorded file nothing would place every new or renamed test at the tail, exactly where a heavy one hurts most.
- Ranking the ordinary shards too reaches roughly 1,029 seconds in the replay, but their membership is unavailable without repeating native discovery.
- Increasing concurrency or changing partition count was outside the authorised change and does not address ordering.
