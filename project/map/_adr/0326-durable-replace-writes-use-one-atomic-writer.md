# ADR 0326: Durable replace-writes use one atomic writer

**Status**: accepted. Extends the canonical-set forcing functions in [ADR 0051](0051-canonical-set-parity.md) and the structural-guard universe contract in [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md).

## Context

Small state stores had independently implemented the same apparent sequence: write a temporary sibling, then rename it over the standing path. The resemblance hid different live contracts. Private continuation and retired-path records used `0600` creation modes and collision-resistant names. Checkpoint open questions wrote every byte and synchronized the temporary file. Several advisory JSON stores used PID siblings without file synchronization or failure cleanup. Maintainer CLI placement applied exact executable permissions. The ignored-file baseline still overwrote its standing path directly.

That duplication left each new store to choose its own short-write, collision, cleanup, mode, and synchronization behavior. Consolidating it carelessly would be worse: syncing every writer would invent a durability cost and promise, while dropping the checkpoint sync or executable mode would weaken behavior.

A ban on rename outside one module would also conflate distinct filesystem operations. Acceptance claims a grant by moving it, Logbook lifecycle actions detach a directory, migrations relocate paths, write preflight probes rename authority, self-shim convergence resolves a same-content race, a signal handler restores an executable synchronously, and tests move fixtures to construct the state they exercise. The acceptance journal's create-once hard-link publication is deliberately outside replacement semantics.

## Decision

**Every ordinary asynchronous replace-write uses [`src/shared/atomic_write.ts`](../../../src/shared/atomic_write.ts).**

The module exposes byte, UTF-8 text, and JSON wrappers over one implementation. Every caller chooses its creation mode and file-sync policy explicitly. Executable placement can request exact mode bits after creation; JSON callers choose indentation and the final newline. The capability opens a UUID-named sibling in the target directory with `createNew`, advances through partial writes until all bytes are staged, optionally syncs that file, closes it, and performs the single replacement rename. A failed operation attempts to remove the sibling without obscuring the original error.

The capability does not create or synchronize the parent directory. Before the rename, an interrupted process leaves the old target intact and may leave an orphan sibling. After a successful atomic rename, readers see the complete replacement on file systems that provide same-directory atomic replacement. Survival of the renamed directory entry across host or power failure remains the host file system's guarantee, not discern's.

[`tests/atomic_write_enrolment_test.ts`](../../../tests/atomic_write_enrolment_test.ts) scans the Git-derived Deno source universe by syntax, including executable fixture modules. The capability must contain exactly one asynchronous `Deno.rename`. Every other `Deno.rename` or `renameSync` call is registered by repository-relative path and enclosing function with a specific one-line reason. A missing registration fails, and a registration whose call disappears also fails. The registry holds moves, claims, detachment, convergence, probing, synchronous restoration, and fixture manipulation; it does not authorize an ordinary replace-write.

Durable JSON is validated at its read boundary. The Logbook epoch sidecar and ignored-file baseline use Zod schemas rather than casts. Invalid epoch state reads as absent. An unreadable, malformed, or older ignored baseline reads as absent and is replaced through the same atomic capability, preserving its existing upgrade behavior.

## Consequences

- A new rename-based state writer cannot invent a replacement policy unnoticed. It either uses the shared capability or introduces a reviewed registry reason that must describe a genuinely different operation.
- Existing stores retain their byte layout, trailing newline, creation mode, file-sync choice, best-effort behavior, bounds, and invalid-state recovery. Only checkpoint open questions request file sync; no caller acquires a directory-fsync promise.
- Refactoring a registered move across a module or function boundary requires updating its enrollment in the same change. Stale checking keeps the reason list coupled to live syntax rather than line numbers.
- The exact executable path reads the source bytes into memory before replacement instead of streaming through `copyFile`. The maintainer binary is small enough for that trade-off; the synchronous signal-handler restore stays separate.
- The guard recognizes direct Deno rename calls. Introducing another filesystem rename API requires extending the syntax detector before that API becomes an authored bypass.
- Process crashes can leave shared-policy temporary siblings. The capability exposes their filename predicate so bounded stores that already reap crash debris can continue doing so.

## Alternatives considered

- **Keep one carefully reviewed helper per store.** Rejected because modes and sync choices remain scattered while collision handling, complete writes, and cleanup continue to drift.
- **Synchronize every temporary file and its parent directory.** Rejected because it changes the cost and documented durability of advisory state that does not currently request synchronization, and portable parent-directory synchronization is not a promise discern currently makes.
- **Ban every rename outside the capability.** Rejected because claims, directory detachment, migrations, probes, convergence, synchronous restoration, and fixture moves are not replace-writes.
- **Register current replace-writers as exceptions.** Rejected because an exception list would document the duplication without removing the divergent safety policies that motivated the decision.
