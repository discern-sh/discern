# ADR 0249: Self-shims cache per engine identity; sweep pages stay budget-bounded

**Status**: accepted. Refines the self-shim cost model of [ADR 0182](0182-operator-commands-resolve-discern-to-the-running-engine.md) and the bounded retention of [ADR 0216](0216-temp-retention-is-repository-throttled-and-inspection-bounded.md).

## Context

ADR 0182 priced self-resolution at one OS-temp directory per engine process, reaped by the ADR 0117 TTL. ADR 0216 bounded retention to one page per repository per hour, 500 inspections and 500 removals each. Both bounds held individually and lost together: parallel test suites spawn thousands of short-lived engine processes, producing near 32,000 shim directories a day against a 12,000 drain ceiling. One user temp directory held 366,000 registered entries, 147,000 past the TTL.

The backlog made the sweep itself the load. Page selection buffered and sorted every matching name before the budgets applied — multi-second scans at that size. The hourly throttle is repository-scoped, and every scaffolded test project is a fresh repository whose sweep is always due, so one suite run performed hundreds of machine-wide scans. Two concurrent suites interleaving them flaked the timing-sensitive tests (pseudo-terminal reads, await deadlines, MCP startup, lock-visibility polls) — suites that once ran five abreast could no longer run two.

The retention design needs to hold by construction, not by tuning: production must scale with live engines rather than with process count, and a page must cost its budget rather than the population.

## Decision

**The self-shim lives under the repository's Git administrative directory — the registered worktree-scoped `selfShim` entry — at one content-addressed subdirectory per engine identity, shared by every process of that engine.** The script's bytes fully encode the engine identity, so their hash names the subdirectory: processes of one engine converge on one path, distinct engines operating on one worktree (the main checkout's MCP server acting by path beside the worktree's own CLI) each keep their own, and Git's worktree lifecycle removes the whole home with the worktree — no TTL, no prune pass. Creation writes aside and renames into place; reuse verifies the bytes. Every spawn site passes the repository root it already holds; a caller with none (a probe outside any repository, setup before init) keeps the per-process OS-temp directory of ADR 0182, whose reaper drains whatever those short-lived contexts leave.

This keeps the shim inside discern's day-one footprint — the repository, its Git administrative state, and OS temp — and inside the ADR 0165 registry, whose whole namespace uninstall now removes. The administrative directory is repo-owned, which is what makes the deterministic name safe.

**Sweep pages select candidates through bounded heaps.** A page keeps at most one inspection budget of names per side of the cursor while streaming the directory, so its memory, ordering work, metadata reads, and removals are bounded by the budgets. Directory enumeration itself remains proportional to the population — a directory stream cannot resume mid-listing, and fair cursor rotation needs every name considered — costing a prefix test per entry plus a bounded heap offer per matching name (about half a second against a 400,000-entry directory), paid at most once per repository per hour under the ADR 0216 coordinator lock, never per process. Cursor rotation, wrap-around, and both budgets are unchanged.

**The engine test suite injects a suite-scoped TMPDIR into every spawned engine.** Spawned-engine artifacts land inside suite-owned homes — themselves OS-temp entries, one per test module instance, removed at process exit — so a scaffolded project's always-due first sweep walks a small suite home instead of the machine-wide population, and the suite performs no temp-directory scan of its own. What a killed run leaves wears the `discern-test-` prefix, which the hourly sweep drains. The TMPDIR injection is a repository practice; the `discern-test-` directory family it relies on ships in the engine's artifact registry, inert outside discern's own development.

Explicit noes: no new write location outside the day-one footprint, no fixed-name artifact directory under shared OS temp, no raised budgets, no daemon, no change to the ADR 0182 PATH-resolution decision itself.

## Consequences

- Shim population is proportional to engine identities per repository, not processes, and each home dies with its worktree. A suite run that minted thousands of temp directories now touches one subdirectory per scaffold's `.git`.
- Spawn sites carry their repository root into `selfShimPath`, and uninstall removes the whole `discern/` namespace under Git's administrative directories — every registered runtime record exits with the tool, no hand-kept list to drift — after refusing while the resource ledger still records provisioned resources, whose entries hold their only frozen destroy commands.
- A sweep's mutation and metadata work can no longer exceed its budgets, whatever mess a machine carries; the residual per-page cost is one hourly, repository-locked name scan of the temp directory.
- Rootless callers keep the per-process temp cost. They are rare, short-lived, and were never the production source; the gate jobs that were are always rooted.

## Alternatives considered

**A content-addressed home under the user's cache directory (`XDG_CACHE_HOME`, `~/.cache/discern`).** Solves the same population math with no repository root — but it is a NEW persistent location outside discern's day-one footprint (repository, Git admin state, OS temp), invisible to the ADR 0104 uninstall contract until separately taught. Rejected by the owner on footprint grounds.

**A deterministic name inside per-user OS temp.** Same footprint class as today and the existing reaper covers it, but its safety rests on judging whether the temp directory is genuinely private (macOS `TMPDIR`, `XDG_RUNTIME_DIR`) — and a wrong yes on a shared `/tmp` is arbitrary code execution. The Git administrative directory needs no such judgment.

**A fixed-name `discern-artifacts` directory under OS temp for all families.** It would shrink scans the same way, but a predictable path in a shared temp directory reintroduces the pre-planting exposure ADR 0216 already rejected for its coordinator lock.

**Raising the budgets or shortening the TTL.** Constants lose to any production growth; the defect class is rate-versus-drain, and only removing the per-process production changes the rate.
