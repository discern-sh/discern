# ADR 0249: Self-shims cache per engine identity; sweep pages stay budget-bounded

**Status**: accepted. Refines the self-shim cost model of [ADR 0182](0182-operator-commands-resolve-discern-to-the-running-engine.md) and the bounded retention of [ADR 0216](0216-temp-retention-is-repository-throttled-and-inspection-bounded.md).

## Context

ADR 0182 priced self-resolution at one OS-temp directory per engine process, reaped by the ADR 0117 TTL. ADR 0216 bounded retention to one page per repository per hour, 500 inspections and 500 removals each. Both bounds held individually and still lost together: parallel agent-driven test suites spawn thousands of short-lived engine processes, so shim production ran near 32,000 directories a day against a drain ceiling near 12,000. The population diverged — 366,000 registered entries were observed in one user temp directory, 147,000 of them past the TTL.

The backlog then made the sweep itself the load. Page selection buffered and sorted every matching name before the budgets applied, so each due page cost the full population in memory and sort work — multi-second scans at the observed size. And the hourly throttle is repository-scoped, while every project the engine test suite scaffolds is its own fresh repository whose sweep state is always due: one suite run performed hundreds of machine-wide scans. Two concurrent suites interleaving those scans flaked exactly the timing-sensitive tests (pseudo-terminal reads, await deadlines, MCP server startup, lock-visibility polls) — suites that had run five abreast before the shim family existed could no longer run two.

The retention design needs to hold by construction, not by tuning: production must scale with live engines rather than with process count, and a page must cost its budget rather than the population.

## Decision

**The self-shim lives at a deterministic, content-addressed path in the user's cache directory, shared by every process of one engine.** The cache root is `XDG_CACHE_HOME`, or `.cache` under the home directory; the shim sits at `discern/shims/<sha256 of its bytes>/discern`. The script's bytes fully encode the engine identity, so processes of one engine converge on one directory and distinct engines cannot collide on one. Creation writes aside and renames into place; reuse verifies the bytes and refreshes the directory's mtime; minting a new identity prunes stale siblings, so the churn that grows the population funds its cleanup. When no cache root resolves, the OS-temp family of ADR 0182 remains as the fallback, and its reaper drains the historical population.

**Sweep pages select candidates through bounded heaps.** A page keeps at most one inspection budget of names per side of the cursor while streaming the directory, so its memory and sort work are O(budget) against any population. Cursor rotation, wrap-around, and both budgets are unchanged.

**The engine test suite injects a per-run TMPDIR into every spawned engine.** Suite production leaves the shared OS temp directory entirely, and a scaffolded project's always-due first sweep walks the small suite home instead of the machine-wide population. This is a repository practice rather than an engine behavior; it is recorded here because it closes the remaining production source of the same class.

Explicit noes: no fixed-name artifact directory under shared OS temp, no raised budgets, no daemon, no change to the ADR 0182 PATH-resolution decision itself.

## Consequences

- Shim population is proportional to engine identities (checkouts and binaries), not processes. A suite run that minted thousands of directories now touches a handful of cached ones.
- The cache directory is user-private, which is what makes the deterministic name safe; the same name under a shared temp directory would be pre-plantable by another local user.
- A sweep can no longer be slower than its budgets allow, whatever mess a machine carries.
- Stale cached shims are pruned only when a new identity is minted. A machine where no new engine ever appears keeps a few idle kilobyte-sized directories until one does.
- An environment without HOME still works and still pays the old per-process cost — acceptable for the rare launcher that strips the environment.

## Alternatives considered

**A fixed-name `discern-artifacts` directory under OS temp for all families.** It would shrink scans the same way, but a predictable path in a shared temp directory reintroduces the pre-planting exposure ADR 0216 already rejected for its coordinator lock — and for the shim it would be arbitrary code execution, not just tampering.

**Raising the budgets or shortening the TTL.** Constants lose to any production growth; the defect class is rate-versus-drain, and only removing the per-process production changes the rate.

**Homing the shim under the Git administrative directory.** Per-worktree lifecycle cleanup would come free, but the shim is resolved from call sites that have no repository root (command-existence probes, verbs outside a repository), and forking the mechanism by context would leave two homes for one fact.
