# ADR 0006: Opt-in streamed output and fail-fast cancellation for the parallel runner

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `finish` → `done`, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged.

> **Current-state note.** The `[gate].stream` and `fail_fast` config flags defined here still ship (`fail_fast` defaults on since 1.0). The POSIX-shell runner and its `set -f`/signal machinery were replaced by the TypeScript job runner ([ADR 0019](0019-single-binary-ts-engine.md)), and the slot/phase framing by capabilities/checks ([ADR 0017](0017-capabilities-model.md)).

**Status**: accepted; **amended by the 1.0 redesign** — see _Update (1.0)_ below.

## Update (1.0)

`fail_fast` now **defaults ON**. For an agent-driven gate, aborting the moment a job fails is the behaviour you almost always want; running a slow test suite to completion after the linter has already failed is pure latency. Set `[gate].fail_fast = false` to restore run-to-completion. `stream` still defaults off (interleaved live output trades legibility for immediacy — opt in per project), so the original decision below now reads "stream opt-in; fail_fast opt-out".

Because `done` reads the flag once and exports it, it applies uniformly to every parallel stage **including side gates** — which therefore now abort on the first failing gate by default, superseding the run-all default ADR 0002 chose under the old opt-in regime. A monorepo that wants every side-gate failure in one pass sets `fail_fast = false`. (`run_serial`, used by the `fix` stage, is inherently fail-fast: a failed fixer stops the chain regardless of this flag.)

## Context

`run_parallel` (in `lib/jobs.sh`) runs a phase's jobs concurrently, but:

- **It buffers.** Each job's combined output is captured to a file and printed, grouped under a banner, only _after_ every job in the phase finishes. For a slow `build` or `test` slot this means a long silence — no live feedback while the work runs.
- **It runs every job to completion.** If the `check` job fails in 5 seconds, the parallel `test` job still runs to its full two minutes before the phase reports failure. For an agent-driven gate that just wants "is it green?", that wasted wall-clock is pure latency.

The buffered-and-grouped default exists for a reason — concurrent jobs interleave, and grouped output is far more legible than tangled live output. So the goal is not to change the default, but to offer the two ergonomic behaviours as opt-ins for projects with slow gates.

Both are fiddly in portable POSIX sh. Live output of concurrent jobs interleaves; cancelling a sibling means killing a backgrounded job _and its child process_, and POSIX sh has no portable per-job process group (`setsid` isn't on macOS, `set -m` job control isn't reliable in scripts). So both must "degrade gracefully" rather than promise perfection.

## Decision

Add two **opt-in, default-off** behaviours to `run_parallel`, configured under a new `[gate]` section and passed to the runner as environment flags (the same side-channel pattern as `DISCERN_JOBS_RESULTS`):

```toml
[gate]
stream    = false   # stream slot output live (line-prefixed) instead of buffering
fail_fast = false   # cancel in-flight siblings when one job fails
```

- **`stream`** → `DISCERN_GATE_STREAM=1`. Each job's output is piped live through a line-prefixer (`── <label> │ …`) so concurrent jobs are still attributable. The job's exit code is captured _before_ the pipe (so it's the command's status, not the prefixer's), and the post-run dump is skipped (the output already streamed).
- **`fail_fast`** → `DISCERN_GATE_FAIL_FAST=1`. The runner polls the per-job result files (1-second granularity — portable `sleep`) and, on the first non-zero exit, sends `SIGTERM` to the still-running jobs. Each job runs its command as a backgrounded child under a `TERM` trap that forwards the signal to that child, so cancellation reaches the actual slot command, not just the wrapping subshell.
- **Default unchanged.** With neither flag set (every existing install, and every caller other than `done`), `run_parallel` behaves exactly as before: buffered, grouped, wait-for-all. The new code lives behind the flags.
- **`done` reads the config and exports the flags.** `tidy`/`test` run serially via `eval` and are unaffected; side-gates (which use `run_parallel`) inherit the same behaviour as the slot phases.

### Honest limitations (degrade gracefully)

- **Streamed output interleaves.** Lines from concurrent jobs are line-prefixed but not grouped. That's the trade for live feedback; the default stays grouped.
- **Cancellation is best-effort.** `SIGTERM` reaches each job's direct command via the trap, but a command's _own_ grandchildren may briefly linger — POSIX sh has no portable per-job process group to kill atomically. The gate still aborts promptly (it stops waiting); a lingering grandchild is a documented caveat, not a hang.
- **Poll latency.** Fail-fast detects a failure within ~1 second (portable integer `sleep`), not instantly. Fine for a gate whose jobs run for seconds.

## Consequences

- A project with slow build/test slots can opt into live progress and/or fail-fast, cutting feedback latency and wasted wall-clock on a failing run — the win is largest exactly where the buffered default hurts most.
- The default experience is untouched, so nothing regresses for existing installs until they opt in.
- `run_parallel` grows three modes (buffered / streamed × wait-all / fail-fast). The added complexity is contained to one function and gated behind env flags; the engine-test harness covers each combination.
- Cancellation's best-effort nature is on the record, so no one expects atomic process-tree kills from portable sh.

## Alternatives considered

- **Always stream / always fail-fast.** Rejected: streaming tangles concurrent output and fail-fast changes long-standing semantics; both belong behind a flag so the legible, complete-information default is preserved.
- **Stream only when a phase has a single job.** A clean way to dodge interleaving, but it makes the behaviour depend on slot count in a surprising way. An explicit `stream` flag is more predictable; interleaving is an accepted, documented trade.
- **`setsid`/process-group kills for exact cancellation.** Not portable (absent on macOS); the `TERM`-trap-forwarding approach is the portable best-effort that works everywhere discern runs.
- **A non-portable `wait -n` poll.** `wait -n` (bash 4.3+) would avoid the 1-second poll, but it isn't POSIX. Integer-`sleep` polling keeps the engine dependency-free.
