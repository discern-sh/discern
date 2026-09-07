# ADR 0385: Retain Git discovery within one operation

**Status**: accepted.

## Context

Every engine verb resolves the same repository facts many times: the checkout's Git administration directory, the shared common directory, a registered administrative path, the project root's position inside its work tree, and the trunk's configuration at a pinned commit. Each resolution was one git process. A traced proven-worktree journey, `done` then `accept` in a scaffolded fixture, spawned 1,381 git processes, 551 of them `rev-parse --git-common-dir`, and the engine's wall time was almost entirely the spawn count multiplied by the spawn gap. The test suite runs that journey about 1,000 times per gate.

Earlier work removed repeated discovery inside single publications and inventories by passing a resolved directory through one callback. That reuse deliberately ended with the callback. The remaining repeats cross callbacks: lock-spec resolution, boundary checks, record-store opens and identity resolution each rediscover the same directories for the same checkout within one verb.

Those facts change only when a worktree is added, moved, removed, pruned or repaired, or a repository is created. Within one operation the engine itself is the only actor that does so. Discovery is not evidence: the bytes a record holds, a claim, a fence, a status or diff, and the execution snapshot must still be observed afresh.

## Decision

`withOperationLock` opens one discovery scope for the operation it runs, on every surface: CLI, MCP tool call, desk action. `git_discovery.ts` owns the scope and carries it through the same async-local storage the operation locks use, with the storage constructor imported from the module-loading authority. Nothing is stored at module or process level.

Consumers declare the kind of fact they need. On a miss the scope runs git, batching the two administration directories into one process and the two work-tree positions into another. On a hit it replays the exact stdout git printed for the same query in the same directory; discovery never reinterprets git's output. A hit is served only after the checkout's real path still resolves and its administration directory still exists. A failed query is never retained. The registered administrative path resolver keeps the sole `--git-path` invocation and passes its declared query to the runner, so an injected runner is unaffected and the structural guard on that option is unchanged.

The scope ends when its operation returns, so nothing survives between calls of a long-lived process. Newly held exclusion, a publication's FIFO wait and environment restoration clear it, matching the boundaries the completion store already treats as fresh observations. The shared git runner clears it after any `git worktree`, `git init`, `git submodule` or `git clone` invocation, so no call site can forget. Outside a scope every query runs fresh with its single argument list, exactly as before.

Two pairs of reads that named one commit and its tree in separate processes now ask for both in one process.

## Consequences

- The traced journey spawns fewer git processes; the gate's test producer inherits the saving on every run of the journey, and a user's `done` gets faster on every platform.
- A per-verb ceiling on git processes for the journey guards the class. A change that spawns more fails the gate; a change that spawns fewer may lower the ceiling. Every engine verb is budgeted or a named exception, so a new verb must enrol.
- The execution snapshot, `symbolic-ref`, `worktree list`, ref verification, status and diff reads, doctor's probes and every injected runner still observe git directly.
- A consumer that needs a discovery fact must declare its kind; an undeclared query cannot be retained by accident.
- The scope is explicit at its two edges, the operation boundary and the invalidation points, rather than threaded through every call chain. The cost is that a consumer's reuse is visible at the boundary, not at the call.

## Alternatives considered

- Passing a discovery context through every call chain would make each reuse visible at the call, at the cost of touching more than 80 call sites across the engine and every future one.
- A process-wide cache keyed by path would serve the MCP server and the desk stale answers after another operation changed the topology.
- Batching alone, without retention, removes only the paired queries and leaves the repeated single-fact discoveries.
- Retaining across lock acquisition would remove a further 7% of the journey's spawns, at the cost of departing from the completion store's documented boundary that storage is resolved inside each held lock.
