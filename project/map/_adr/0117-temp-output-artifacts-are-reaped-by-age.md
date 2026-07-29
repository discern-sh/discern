# ADR 0117: Temp output artifacts are reaped by age, from one registry

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `finish` → `done`; the decision and reasoning are unchanged.
>
> **Concurrency refinement ([ADR 0216](0216-temp-retention-is-repository-throttled-and-inspection-bounded.md)):** The registry, TTL, and gate-entry placement stand. The hourly throttle now lives in repository-shared Git-admin state, and each cursor-backed page bounds inspections as well as removals.

**Status**: accepted; refines [ADR 0096](0096-passing-jobs-keep-output-artifacts.md) and [ADR 0083](0083-normalize-and-offload-diagnostic-output.md)

## Context

ADR 0096 persists every gate job's full output as an OS-temp artifact — successful jobs included — and ADR 0083 offloads truncated diagnostic text the same way. Both decisions considered where the artifact lives (OS temp, never a repo-local log dir) but not how long: nothing in discern ever deleted one, on the presumption the OS's periodic temp cleanup would.

That presumption failed empirically. Gate runs are agent-frequency events (one file per job, per `done`/`prepare`/`test`), and on discern's own development machine the temp dir accumulated over thirty thousand orphaned `discern-job-*.log` files (hundreds of MB) spanning many days — the OS cleanup demonstrably not keeping pace. On a Linux host where `/tmp` is a size-limited tmpfs, sustained agent-driven runs with a verbose suite consume RAM-backed space until unrelated programs fail. Unbounded growth is a resource-exhaustion class, not a hygiene nit.

## Decision

**Every temp artifact family is registered in one module, and every gate run reaps expired ones.**

- `src/shared/temp_artifacts.ts` is the registry: the artifact kinds (today `job` and `diag`), their filename prefixes, the shared `.log` suffix, and the TTL (24 hours — long enough to inspect a result envelope hours later, short enough that steady traffic carries at most a day of logs).
- `makeTempArtifact(kind)` is the only way `src/` mints a temp file; an architectural test bans `Deno.makeTempFile`/`makeTempDir` elsewhere in `src/`, so a future artifact family cannot silently opt out of retention — adding a kind to the registry enrols it in naming and reaping at once.
- The sweep runs at the gate-verb entries (`done`/`prepare`/`test`) before any job spawns — never inside artifact creation, which sits between a job's spawn and its abort wiring, where even a bounded sweep would delay the kill path (ADR 0105). It fires at most once per hour per process and removes at most 500 files per pass, so a huge pre-retention backlog drains across runs instead of stalling a gate startup (an unbounded first sweep measured minutes against the observed backlog). Matching is narrow (registered prefix AND suffix, regular files only) so nothing foreign is ever touched, and every step is best-effort: retention can never decide a job or verb outcome.

The explicit noes, unchanged from ADR 0096: no repo-local log directory, and no deletion at run end — the artifact must outlive the run so the envelope's `output_path` stays inspectable. Retention bounds lifetime, not existence.

## Consequences

- A developer machine now carries at most ~a day of gate logs; tmpfs `/tmp` hosts stop accumulating unbounded RAM-backed state.
- Envelope `output_path` entries older than the TTL dangle once reaped. That was always true under OS temp cleanup — the paths were best-effort local state from the start — but it now happens predictably at 24 hours.
- Concurrent discern processes may sweep the same dir; raced deletions are swallowed (a missing file is the desired state).

## Alternatives considered

**Delete artifacts when the run ends.** Rejected: ADR 0096 persists them precisely so an agent can inspect a loud-but-passing job after the fact.

**Prune only on a threshold (file count / total size).** Rejected: measuring the dir costs as much as sweeping it, and a threshold leaves the failure mode in place until the threshold trips. Age is the honest contract — the artifact is a run-scoped inspection aid, not an archive.

**A background/unawaited sweep.** Rejected: an unawaited op is truncated at process exit and leaks into test sanitizers; the bounded inline sweep costs milliseconds steady-state and stays deterministic.
