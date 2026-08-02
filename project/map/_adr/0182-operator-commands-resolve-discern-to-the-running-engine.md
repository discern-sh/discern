# ADR 0182: Operator commands resolve `discern` to the running engine

> **Identity refinement ([ADR 0249](0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded.md)):** The PATH decision stands. The shim now lives at a content-addressed path in the user's cache directory — one directory per engine identity, reused by every process of that engine — and the per-process OS-temp directory described below remains only as the fallback when no cache root resolves.

**Status**: accepted

## Context

Fresh installs seed the format job with `discern tidy` ([ADR 0178](0178-discern-tidy-is-the-embedded-convention-for-discern-owned-surfaces.md)) — the first configured command that names discern itself. A job command is a shell string handed to `sh -c` through the engine's spawn funnel ([ADR 0054](0054-subprocess-single-source.md)), so until now every word in it, including `discern`, resolved against the ambient `PATH` of whatever process happened to be running the gate.

`discern` is unlike every other command a project configures: it names the program that is already running. Ambient resolution makes that self-reference environment-dependent, and three environments prove it. CI drives this repo's gate from source with no wrapper installed, so the seeded format job died with `sh: discern: not found` (exit 127). An MCP server spawned by a GUI agent can inherit a stripped `PATH` in a perfectly healthy real install, breaking the same job for an end user. And a developer machine can hold an older or different install than the engine gating the tree, silently running two versions in one gate.

The resolution logic already existed twice outside the engine — the test suite's `PATH` shim and the local-dev wrapper — each covering one environment by hand. The engine itself, the one process that always knows its own identity, was the only place not supplying it.

## Decision

**Every operator command the engine spawns runs with a `PATH` whose first entry is a self-shim directory: one `discern` executable that re-invokes the running engine.** A compiled binary re-executes its own executable; a from-source run re-invokes its own checkout's entrypoint. The shim covers the gate job runner, the worktree lifecycle and resource commands, and the buffered shell runner; the command-existence probe behind doctor uses the same `PATH`, so its advisory verdict always matches what execution would do.

The shim is prepended, not appended. `discern` inside an operator command means the engine running that command — a worktree's gate runs that worktree's engine — never a different install that happens to sit earlier on the ambient `PATH`. The rest of the `PATH` passes through untouched, so every other command resolves exactly as before.

Explicit noes: no opt-out knob; no rewriting of command strings (the shim is ordinary `PATH` mechanics — the shell's own semantics stay untouched); no change to how a user invokes discern from their own shell, where the installed binary still resolves normally.

## Consequences

- Self-invocations are environment-independent: CI running the engine from source, a stripped-`PATH` MCP spawn, and a bare fresh install all run the seeded `format = "discern tidy"` without any wrapper or install step.
- The gate can never split versions: the engine checking the tree and the `discern` its jobs invoke are one program by construction.
- A deliberately different discern earlier on `PATH` is ignored inside operator commands. That is the point of the decision, but it forecloses pointing a job at another install.
- The test suite's separate shim collapsed into the shared module, leaving one definition of "re-invoke this engine"; the local-dev wrapper remains, serving interactive shells rather than engine-spawned commands.
- The mechanism costs one OS-temp directory per engine process, minted through the temp-artifact registry: a live engine refreshes it on every use, the reaper collects only abandoned ones, and a shim removed by a system cleaner is recreated on the next spawn.
- The guard (`tests/engine_self_shim_test.ts`) scrubs every discern off the base `PATH` and proves both the shim itself and a full gate job that invokes `discern`.

## Alternatives considered

- **Put the dev wrapper on `PATH` in CI.** Rejected as an instance fix: every future environment rediscovers the gap, and it does nothing for a real install whose MCP server was spawned with a stripped `PATH`.
- **Append the shim as a fallback instead of prepending.** Rejected because it only fixes "not found": with a different install on `PATH`, the gate would still run a version other than the engine that spawned it.
- **Rewrite `discern …` command strings to absolute invocations.** Rejected because the engine deliberately treats operator commands as opaque shell strings; parsing and editing them re-implements shell semantics, while `PATH` is the resolution mechanism shells already provide.
