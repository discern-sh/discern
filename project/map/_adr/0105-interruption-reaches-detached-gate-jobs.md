# ADR 0105: Interruption reaches the gate's detached job groups

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `finish` → `done`, `graduate` → `accept`; the decision and reasoning are unchanged.

**Status**: accepted; follows [ADR 0028](0028-result-envelope-and-diagnostics.md) (the result envelope the cancelled run still serializes into) and [ADR 0051](0051-canonical-set-parity.md) (the guards are parameterized off the single signal list).

## Context

Gate jobs are spawned `detached`, each leading its own process group, so the runner can tree-kill a whole job — grandchildren included — with one group signal. That mechanism had exactly one trigger: a fail-fast sibling failure inside `runParallel`. No externally-initiated shutdown reached it:

- **MCP request cancellation.** A client cancelling a `discern_done` call (`notifications/cancelled`) aborted nothing — the tool handlers dropped the SDK's per-request abort signal, so the gate ran invisibly to completion inside the still-alive server. Cancel twice and retry, and three concurrent gates raced one another over the same build caches — an observed failure on a project whose gate takes minutes.
- **OS interrupts.** The detachment that enables tree-killing also removes the free delivery a foreground child gets: the terminal's Ctrl-C reaches discern and never its jobs. With no signal listener anywhere, an interrupted `discern done` orphaned every in-flight job.
- **Server shutdown.** stdin EOF closed the transport and exited the process, leaving an in-flight call's detached jobs running.

`runSerial` (the fix stage) passed no signal at all, so a serial job could not be cancelled by anything.

## Decision

**Every shutdown path funnels into the run's one abort controller** — the single source the tree-kill already listens to.

- The runner accepts an external `AbortSignal` (`RunOptions.signal`), chained into the run's controller; `runSerial` gains the same controller and stops between jobs after an abort. Jobs killed this way report `cancelled`, like a fail-fast-killed sibling.
- The gate cores (`finishResult` / `prepareResult` / `testResult`) accept and forward that signal. The MCP tool contract carries it: each handler forwards the SDK's per-request signal merged (`AbortSignal.any`) with a server-level controller aborted on stdin EOF — so a cancelled call and a dying server both kill the jobs before the process exits.
- OS interrupts are the runner's own concern: a reference-counted watcher (`jobs/interrupt.ts`) installs SIGINT/SIGTERM/SIGHUP listeners only while at least one stage run is in flight, aborts every active run's controller on an interrupt, and — once the last run has settled and reaped its children — re-raises the signal with the default disposition restored, so the process still dies with the conventional killed-by-signal status. Living in the runner, it covers every gate caller (the CLI verbs, setup's probes, the gate re-run inside `accept`, the MCP server process) with no per-entry-point wiring to forget.

SIGKILL is explicitly out of scope: no handler runs, so its orphans are unpreventable; the covered paths are every interruption a user or agent actually performs.

## Consequences

- Cancelling an MCP gate call, interrupting the CLI, or killing the MCP server now stops the gate's processes instead of orphaning them.
- An interrupted CLI run prints its `cancelled` banners, then dies by the signal — scripts observe the conventional status, not a fabricated exit code. The full result tail may not render; an interrupt asked the process to stop, not to report.
- The guards are class-shaped (ADR 0051): the E2E interrupt test iterates the exported `INTERRUPT_SIGNALS`, so a newly watched signal auto-enrols; the MCP tests drive the real stdio server through a cancellation and a mid-call shutdown and assert the recorded job PID dies.
- While a gate run is in flight the default signal disposition is overridden (restored the moment the last run settles); a second interrupt during the brief reap window is coalesced rather than escalating.
