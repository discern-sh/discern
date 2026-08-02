# ADR 0212: The fleet test-run cap is N OS-file-lock slots under the git common dir

> **Resource-boundary and telemetry amendment ([ADR 0252](0252-fleet-test-run-cap-at-test-command-boundary.md)):** Direct test commands now enrol through `discern queue`, and the clause “The begin event precedes the wait, and the recorded duration includes it” is superseded. Begin still precedes the wait and `duration_ms` remains end-to-end; optional `waited_ms` separates queue time, and duration priors use execution time.

**Status**: accepted. Extends the git-admin-state registry ([ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md)); consumes the begin events and duration priors of [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md); bound by the advisory-only logbook boundary of [ADR 0160](0160-local-logbook-advisory-readers.md).

## Context

The owner runs parallel agents in sibling worktrees on one machine, and each gate's test job already saturates it: this repository's suite spends roughly 2,500 CPU-seconds across all cores for its ~3-minute wall, so a second concurrent gate cannot borrow idle capacity — it can only thrash the first. The local logbook shows contended `done` runs at a ~258s median against ~158s solo on the same day. No per-project knob can fix this: a test runner's own concurrency setting neither sees the sibling worktrees nor composes across them. discern is the layer that knows the fleet, so discern carries the cap. From two concurrent gates up, queued-at-solo-speed is the predictability optimum; from three up it is also the throughput optimum.

The cap must never wedge the fleet. Runs are killed mid-flight routinely (an agent interrupted, a session closed), so any coordination state that outlives its process would need a daemon, heartbeats, or a reclamation sweep — machinery discern does not want and the trust posture does not need.

## Decision

**`[gate] concurrent_test_runs = N` bounds how many test-stage runs may be in flight across every checkout of the repository, with each in-flight run holding one exclusive OS advisory file lock on one of N content-free slot files under `discern/test-slots/` in the git common directory.** `0`, the default, builds no slot machinery at all: existing installs see no change.

- **The common git dir is the fleet scope.** Every linked worktree shares it, which is exactly the population that shares the machine; the slot files register in the git-admin-state registry (common scope), enrolling them in the containment and reset guards. Cross-repository capping is out of scope.
- **OS lock release is the crash-safety.** The kernel releases an advisory lock when its holding process dies, however it dies. There is no daemon, no heartbeat, no reclamation, and no state beyond held-ness — a killed gate frees its slot by ceasing to exist. Slot files are created on demand and never deleted: an unlink would split the lock domain (a re-created name is a new file identity, so two holders could share one slot); files left behind by a lowered cap are inert. A slot file that cannot be opened fails open with a notice — the cap protects throughput, and a run that would otherwise be green must not fail over a lock file.
- **Slots are uniform, and the standards measurement pass takes one.** A coverage measurement re-runs the entire suite under instrumentation, so `discern standards` is often the heaviest run of all. One primitive with one number stays predictable.
- **Enrolment derives from a group's jobs, not from a verb list.** The shared group executor takes a slot for any group carrying a firing test-stage job or a standard's measurement. `done`, `test`, and `standards` enrol by construction, as does acceptance's landing-checkout smoke; `prepare` (fix + check) and replay-only standards groups never match. A future gate verb that plans test jobs through the shared planner cannot miss the cap.
- **Fail-fast stays cheap.** Under a cap, `done` plans the check stage as its own group ahead of the test group, so a broken lint fails before the run queues for anything. This trades the check∥test overlap (seconds — the check stage is lint and typecheck) for the guarantee; the uncapped plan is byte-identical to before.
- **Acquisition probes, then re-probes on a capped backoff with jitter (~150ms to ~2s).** A kernel-blocking wait was rejected twice over: Deno cannot cancel a pending lock operation, so an aborted wait would strand the op and pin a long-lived MCP server's event loop; and with N > 1 a waiter blocked on one slot ignores another slot freeing. The worst-case wake latency (~2s) is noise against minutes-scale runs.
- **The wait says why, once, calmly.** The queued run prints one line (and carries it as a result hint for `--json`/MCP callers) naming the cap and, when the logbook is on, decorating with what is in flight and a typical-duration prior. The logbook is never read to decide whether a run may proceed — the lock files are the only authority — so a logbook-off install keeps the whole feature minus the estimate (ADR 0160 stands).
- **The begin event precedes the wait, and the recorded duration includes it.** A queued gate reads as running on fleet rows, never dormant. The completion event's `duration_ms` is the end-to-end number the agent experienced — the honest figure for an owner asking "how long do gates take here" — accepting that duration priors drawn from contended history fold wait time into future estimates.

The explicit *no*s: no daemon or polling loop against the logbook; no per-job or weighted slots; no scope-gate enrolment; no machine-wide (cross-repository) cap; no queue fairness — waiters wake in no guaranteed order, so under heavy contention a waiter can be overtaken; the cap bounds concurrency, not arrival order.

## Consequences

- With `concurrent_test_runs = 1`, several parallel agents each run their test phase at solo speed, one after another, each told what it is waiting for and roughly how long — and a killed gate never wedges the fleet.
- The cap spans processes and surfaces: CLI runs, MCP-server in-process runs, and mixes of both contend correctly, because advisory locks exclude across separate open file descriptions even within one process.
- A capped `done` loses the check∥test overlap — a few seconds per run, judged worth the fail-fast guarantee.
- Worktrees whose branches carry different `concurrent_test_runs` values probe different slot-file counts, so during a config transition the effective cap is the loosest in flight. Self-resolving as branches converge on the trunk's value.
- Two hints, a config key, a git-admin-state entry, and the split-plan shape become compatibility surfaces.

## Alternatives considered

- **A hard max-1 for the standards pass regardless of N.** Rejected by the owner: a hidden second cap would serialize even trivial standards passes (most standards are one-line commands measured in milliseconds — only suite-running measurements are heavy), and the observed problem is CPU oversubscription, which uniform slots already solve. An owner who wants standards fully serialized sets `concurrent_test_runs = 1`.
- **Default-on with a guessed cap.** Rejected: the right N depends on the machine and the suite; a wrong default would queue runs on hardware with headroom. `0` follows the `timeout = 0` disable precedent beside it.
- **A lease/heartbeat file protocol instead of OS locks.** Rejected: it reintroduces stale-state reclamation, timing heuristics, and a wedged-fleet failure mode — work the kernel's own lock release already covers.
- **Waiting inside the combined check∥test group.** Rejected: the check jobs would queue behind the slot too, so a broken lint could wait minutes to report a failure that took seconds to find.
