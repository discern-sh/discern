# ADR 0216: Temp retention is repository-throttled and inspection-bounded

**Status**: accepted. Refines the age-based artifact registry and sweep of [ADR 0117](0117-temp-output-artifacts-are-reaped-by-age.md) and extends the Git-admin-state lifetime registry of [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md).

## Context

ADR 0117 limited a sweep to 500 removals and at most one run per hour **per process**. That bound covered a stale backlog in one long-lived process. It did not cover the workload that now dominates discern development: each parallel test suite starts many short-lived engine processes, and every process begins with an empty in-memory timestamp.

Three concurrent suites exposed the result. The shared OS temp directory held roughly 105,000 registered output files and self-shim directories. Every fresh engine walked that population, and the removal budget did not help: fresh entries did not increment the removal count, so each process performed metadata reads across the whole set. Repeated scans drove system CPU and I/O contention high enough that readiness and timeout tests missed their outer harness deadlines even though the behavior under test remained correct.

Retention stays best-effort and outside the job kill path. Output artifacts still live in OS temp and outlive their producing run. The cleanup work must remain bounded against both stale and entirely fresh populations, make progress across the bound, compose across linked worktrees, and never need a daemon or a stale-lease recovery protocol.

## Decision

**One repository-wide OS lock and persisted cursor schedule bounded temp-artifact sweep pages.**

- `discern/temp-artifact-sweep` is a common-scope entry in the Git-admin-state registry. The main checkout and every linked worktree resolve the same file.
- A gate verb opens that file and takes a non-blocking advisory lock before checking whether the hourly interval is due. A held or unavailable lock skips retention quietly; cleanup cannot decide the gate's result.
- The file records the last sweep time and the last matching entry inspected. The due stamp is written before the scan, so a process killed during cleanup does not trigger an immediate repeat storm when the kernel releases its lock.
- One page enumerates matching registered names, orders them, resumes after the cursor, and performs at most 500 metadata inspections and 500 removals. The next due page continues from that cursor, so a fresh prefix cannot starve later stale entries.
- The registry still supplies every eligible file and directory family. New families auto-enrol in the same bounded rotation.

The coordination scope is a repository fleet, not the whole machine. Independent repositories may each pay for one hourly name scan of the shared OS temp directory. Discern adds no predictable machine-global lock under a shared `/tmp`, no daemon, no heartbeat, and no cleanup failure in a result envelope.

## Consequences

- A burst of short-lived CLI and test processes from one repository pays for one hourly scan, not one scan per process.
- One due process still enumerates and orders the matching names, but it performs at most 500 `stat` calls and 500 removals. Large stale populations drain over successive hours instead of delaying a gate start.
- The 24-hour TTL marks eligibility, not a promise of immediate deletion. A backlog can survive longer while bounded pages rotate through it.
- The coordinator file is inert Git-admin state. It persists with the repository, and the kernel releases its lock on every process exit.
- A run outside a Git repository cannot resolve the shared coordinator and skips retention. Discern's repository workflows retain cleanup; the best-effort side effect does not invent a second coordination scope.

## Alternatives considered

**Keep the process-local timestamp and raise test deadlines.** Rejected: the repeated scan is real machine work, and larger deadlines hide the contention without removing it.

**Use only a removal budget.** Rejected: an entirely fresh population removes nothing and therefore leaves metadata work unbounded.

**Use a machine-global lock file in OS temp.** Rejected: a predictable path in a shared temp directory needs ownership, symlink, and cross-platform trust machinery. The Git common directory already provides a private, registered scope for the worktree fleet producing the observed burst.

**Restart every page at the first matching name.** Rejected: fresh entries at the front can consume every inspection budget forever while stale entries later in the directory never become visible.
