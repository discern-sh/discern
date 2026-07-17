# ADR 0108: One global timeout bounds every gate job

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `finish` → `done`; the decision and reasoning are unchanged.
>
> **Amended by [ADR 0133](0133-standards-join-the-gate.md):** the deferred per-job override shipped once standards joined the gate and supplied the real case the original decision waited for. A capability value now takes a table form (`{ run = "…", timeout = N }`), and `[checks.<name>]`, `[scopes.<name>]`, and `[standards.<name>]` accept the same optional `timeout` key — each replacing the global budget for that one job only (`0` disables its bound), with every sibling still under `[gate].timeout`. The global default and the uniform-by-construction watchdog are unchanged.

**Status**: accepted; reuses the tree-kill path from [ADR 0105](0105-interruption-reaches-detached-gate-jobs.md) (the detached process-group SIGTERM→SIGKILL escalation), serializes through [ADR 0028](0028-result-envelope-and-diagnostics.md) (the timeout is an ordinary diagnostic), and is guarded class-wide per [ADR 0051](0051-canonical-set-parity.md).

## Context

The gate spawned every job and awaited it with no upper bound. One never-exiting command therefore hung `discern done` forever, and — because `[gate].stream` defaults to buffered — silently: a pre-launch audit against real projects watched the gate print "Checking and testing…" and wait until it was killed by hand. An MCP `discern_done` call blocks the agent's tool call the same way, with no output at all.

This is not an exotic edge case; it is the **single worst first-hour failure** discern can produce. The everyday trigger is a test capability wired in its bare form — `test = "<runner>"` — where the runner chooses watch-vs-single-run by inspecting its environment. Under the gate's exact spawn conditions (stdin null, no TTY, piped output) many runners pick watch mode and wait for a file change that never comes. A dev server or any `--watch` command left in a capability does the same.

The companion fix exports `CI=1` in the job environment, which flips most such runners to single-run — but that is a mitigation, not a guarantee. Nothing structurally prevented a command from never returning, and the binding design rule forbids the obvious shortcut: discern **never** detects platform capabilities (no sniffing runner names, no framework detection). The bound has to be behavioural.

## Decision

**One configuration key, `[gate].timeout` (seconds, default `600`), caps every job the gate runs** — each capability, each check, each scope gate — with no exceptions and no per-job carve-outs.

- **Uniform by construction.** The budget rides in `RunOptions.timeoutS`, set once from `cfg.gate.timeout` in the gate's shared run context, and every stage executes through the one runner (`runParallel` / `runSerial` → `spawnJob`). A per-job watchdog in `spawnJob` arms a timer for the budget; there is no second spawn path to forget, so a new stage kind inherits the bound automatically.
- **Reuse the kill, not a second mechanism.** On expiry the watchdog calls the same `onAbort` the fail-fast/external-cancellation path uses — tree-kill the whole process group with SIGTERM, escalate to SIGKILL if it is ignored — so grandchildren (a backgrounded dev server) die too.
- **A genuine failure, not a cancelled sibling.** A timed-out job is recorded with `timedOutAfterS` (the budget it blew) and is explicitly excluded from the `cancelled` classification, so it keeps its diagnostic. That diagnostic is plain-language and names the likely cause and the two ways out: _"… timed out after Ns without exiting … A watch-mode test runner or a dev server that never exits will hang the gate; wire it in its single-run (CI) form, or raise [gate].timeout …"_ It is never SARIF-normalized (a hang is not a tool finding).
- **`0` disables** the bound for a legitimately unbounded job — documented as not recommended, since the gate can then hang again.

Two deliberate choices:

- **Seconds, one generous default.** 600s (ten minutes) is long enough for a real test suite yet short enough that a hang is diagnosed within a coffee rather than never. A number, not an integer, so a small budget is expressible in tests and by a user who wants a tight bound.
- **Global, not per-capability.** A single key is the whole feature; a slow suite raises the one number. Per-capability overrides are a config-value-shape question (the scalar-or-table precedent) deferred to `TODO.md`, not resolved here — the global bound already closes the hang, and a premature shape would be harder to walk back than to add.

## Consequences

- The gate **can never silently hang**. A command that never exits fails within the budget, its process group dead, with a bounded, plainly-worded diagnostic that names the usual culprit — the opposite of the observed silent wait.
- The guarantee is held class-wide (ADR 0051): a parameterized test drives a never-exiting command through every stage kind — fix, build, check, test, a custom check, and a scope gate — off the stage registry, so a new stage kind must time out too or the gate fails. The env contract (`CI=1`) is pinned by its own test, and a unit test proves the killed job's whole process group dies.
- The default is a policy, not a law: a project with a genuinely long job raises `[gate].timeout`; one that accepts the risk sets `0`. Neither can weaken the protection for anyone else, because the key is per-install and defaulted safe.
- `discern done` run against a checkout whose engine predates this key will reject the new `[gate].timeout` line as an unknown key — expected for any new config key; scaffold reconciliation backfills it into existing installs.

## Update — the kill path also bounds the pipe drains

The original watchdog killed the job's process group but still waited for the job's stdout/stderr to reach EOF before settling. A descendant that re-parented into its own session while inheriting those pipes — the standard self-daemonizing pattern — survived the group kill holding the write ends open, so the gate blocked for the daemon's whole lifetime (forever, for a never- exiting one), and a pending interrupt was absorbed with it (the signal watcher re-raises only once the run settles). Worse, when the direct shell had exited `0` before daemonizing, the settled result reported **ok** with the recorded `timedOutAfterS` silently swallowed.

Two invariants close the hole, both funnelled through the one kill path every cancellation source shares:

- **The drains are bounded after a kill.** Once `onAbort` fires (watchdog, fail-fast, external abort, or an interrupt), the pipe readers are cancelled after a grace just past the SIGTERM→SIGKILL escalation — long enough for a slow-but-cooperating child to flush and close naturally; only a pipe held by a process the tree-kill cannot reach is clipped.
- **`timedOutAfterS` forces a non-zero `code`** at the producer, so every consumer keying off the exit code (ok/failed, banners, fail-fast, diagnostics) reports a fired watchdog as the genuine failure it is, even when the direct child exited clean.

The class guard gained the escaped-descendant member: a detached, own-session pipe-holder driven through the runner (watchdog and external-abort variants) and through the full `done`, asserting the run stays bounded and the timeout is diagnosed, never swallowed.
