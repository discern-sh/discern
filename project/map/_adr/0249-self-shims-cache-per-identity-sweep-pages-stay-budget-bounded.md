# ADR 0249: Self-shims cache per engine identity; sweep pages stay budget-bounded

**Status**: accepted. Refines the self-shim cost model of [ADR 0182](0182-operator-commands-resolve-discern-to-the-running-engine.md) and the bounded retention of [ADR 0216](0216-temp-retention-is-repository-throttled-and-inspection-bounded.md).

## Context

ADR 0182 priced self-resolution at one OS-temp directory per engine process, reaped by the ADR 0117 TTL. ADR 0216 bounded retention to one page per repository per hour, 500 inspections and 500 removals each. Both bounds held individually and still lost together: parallel agent-driven test suites spawn thousands of short-lived engine processes, so shim production ran near 32,000 directories a day against a drain ceiling near 12,000. The population diverged — 366,000 registered entries were observed in one user temp directory, 147,000 of them past the TTL.

The backlog then made the sweep itself the load. Page selection buffered and sorted every matching name before the budgets applied, so each due page cost the full population in memory and sort work — multi-second scans at the observed size. And the hourly throttle is repository-scoped, while every project the engine test suite scaffolds is its own fresh repository whose sweep state is always due: one suite run performed hundreds of machine-wide scans. Two concurrent suites interleaving those scans flaked exactly the timing-sensitive tests (pseudo-terminal reads, await deadlines, MCP server startup, lock-visibility polls) — suites that had run five abreast before the shim family existed could no longer run two.

The retention design needs to hold by construction, not by tuning: production must scale with live engines rather than with process count, and a page must cost its budget rather than the population.

## Decision

**The self-shim lives under the repository's Git administrative directory — the registered worktree-scoped `selfShim` entry — at one content-addressed subdirectory per engine identity, shared by every process of that engine.** The script's bytes fully encode the engine identity, so their hash names the subdirectory: processes of one engine converge on one path, distinct engines operating on one worktree (the main checkout's MCP server acting by path beside the worktree's own CLI) each keep their own, and Git's worktree lifecycle removes the whole home with the worktree — no TTL, no prune pass. Creation writes aside and renames into place; reuse verifies the bytes. Every spawn site passes the repository root it already holds; a caller with none (a probe outside any repository, setup before init) keeps the per-process OS-temp directory of ADR 0182, whose reaper drains whatever those short-lived contexts leave.

This keeps the shim inside discern's day-one footprint — the repository, its Git administrative state, and OS temp — and inside the ADR 0165 registry that doctor and uninstall already govern. The administrative directory is repo-owned, which is what makes the deterministic name safe.

**Sweep pages select candidates through bounded heaps.** A page keeps at most one inspection budget of names per side of the cursor while streaming the directory, so its memory and sort work are O(budget) against any population. Cursor rotation, wrap-around, and both budgets are unchanged.

**The engine test suite injects a per-run TMPDIR into every spawned engine.** Suite production leaves the shared OS temp directory entirely, and a scaffolded project's always-due first sweep walks the small suite home instead of the machine-wide population. This is a repository practice rather than an engine behavior; it is recorded here because it closes the remaining production source of the same class.

Explicit noes: no new write location outside the day-one footprint, no fixed-name artifact directory under shared OS temp, no raised budgets, no daemon, no change to the ADR 0182 PATH-resolution decision itself.

## Consequences

- Shim population is proportional to engine identities per repository, not processes, and each home dies with its worktree. A suite run that minted thousands of temp directories now touches one subdirectory per scaffold's `.git`.
- The spawn sites carry their repository root into `selfShimPath`, so the shim's home is an ordinary registered admin-state entry — inventoried, doctor-visible, and covered by the existing uninstall surface.
- A sweep can no longer be slower than its budgets allow, whatever mess a machine carries.
- Rootless callers keep the per-process temp cost. They are rare, short-lived, and were never the production source; the gate jobs that were are always rooted.

## Alternatives considered

**A content-addressed home under the user's cache directory (`XDG_CACHE_HOME`, `~/.cache/discern`).** Solves the same population math and needs no repository root — but it is a NEW persistent location outside discern's day-one footprint (repository, Git admin state, OS temp), invisible to the uninstall contract of ADR 0104 until separately taught, and that expectation has held since the first release. Rejected by the owner on footprint grounds.

**A deterministic name inside per-user OS temp.** Same footprint class as today and the existing reaper covers it, but its safety rests on judging whether the temp directory is genuinely private (macOS `TMPDIR`, `XDG_RUNTIME_DIR`) — and a wrong yes on a shared `/tmp` is arbitrary code execution. The Git administrative directory needs no such judgment.

**A fixed-name `discern-artifacts` directory under OS temp for all families.** It would shrink scans the same way, but a predictable path in a shared temp directory reintroduces the pre-planting exposure ADR 0216 already rejected for its coordinator lock.

**Raising the budgets or shortening the TTL.** Constants lose to any production growth; the defect class is rate-versus-drain, and only removing the per-process production changes the rate.
