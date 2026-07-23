# ADR 0179: Every spawn surface declares its interrupt contract

**Status**: accepted; extends [ADR 0054](0054-subprocess-single-source.md)'s subprocess funnels with an interrupt-coverage contract, applying the [ADR 0051](0051-canonical-set-parity.md)/[ADR 0176](0176-the-closed-sets-are-a-closed-set.md) registry discipline to process spawning.

## Context

The engine's spawned children carry an invariant nothing stated in one place: **a signal delivered to the engine's PID must stop and reap every potentially long-running child's whole process tree.** Two of the three long-running spawners honored it, each with its own machinery and its own hand-written E2E — gate jobs (detached groups, the refcounted run watcher) and the owned-child boundary behind Project Scripts. The third, the worktree lifecycle runner (`runShellRouted`, behind `[worktree.setup].steps`/`ensure`, `[repository].ensure`, and resource `create`/`destroy`/`ensure`), had none of it: a SIGTERM mid-step — a dependency install, a database provision — killed the engine and orphaned the command's tree against a half-created worktree, still burning CPU, still holding ports and locks.

The audit that surfaced the orphan also surfaced why it could exist unnoticed. [ADR 0054](0054-subprocess-single-source.md)'s guard matches literal `"git"`/`"sh"` spawns and deliberately excluded dynamically named binaries — a residual the docs pager already inhabited. Nothing recorded what each spawner owed on interrupt, so interrupt E2Es existed for exactly the two surfaces someone had once thought about, and a new spawner joined the codebase owing nothing.

## Decision

**One supervision core.** `superviseSpawn` (engine/owned_child.ts) owns the interrupt lifecycle for a long-running child: scoped signal listeners for the child's lifetime, the same signal delivered to the child — its whole process group when it leads one — SIGKILL escalation after a grace period, a group sweep once the leader is reaped, and a re-raise so the engine dies with the conventional killed-by-signal status unless the caller resumes (the desk does). `runOwnedChild` and `runShellRouted` are its callers; the grace durations live once in `process_signals.ts` beside the other signal conventions. A lifecycle command's child is never interactive (stdin is null), so on POSIX it always leads its own group.

**A spawn-surface registry.** `tests/spawn_surfaces.ts` declares every file permitted to construct `Deno.Command`, with an exact constructor-site count and the interrupt contract the home owes: either the E2E `surfaces` that prove the invariant black-box, or a written `exempt` justification a reviewer can audit (a bounded git subcommand, a probe, the terminal-foreground pager). The subprocess guard now scans `src/` for every constructor site — any binary, literal or variable, plus `node:child_process` — and fails on an unregistered home or a stale count; the git/`sh` funnel guards derive their sanctioned sets from the same registry.

**A suite typed over the registry.** The interrupt E2Es are one parameterized suite whose scenario table is a `Record` over the registry's declared surface union: declaring a surface without a scenario, or orphaning a scenario, fails `deno check`. Five surfaces are proven per watched signal — gate jobs, Project Scripts, worktree lifecycle commands, the `with-gotchas` wrapper, and the desk's launch wiring, whose contract inverts: the child tree dies while the desk session survives. Each scenario plants a leader plus a forked descendant (the script one also holds a server port) and proves the whole tree dies.

A fourth spawner therefore auto-enrols from both ends: it cannot exist unregistered, and it cannot register without either an interrupt E2E or a reviewed exemption. The registry is itself an entry in the canonical-sets meta-registry, claimed by the `interruption-safety` canon node.

## Consequences

- **The orphan class is cured, not patched.** The worktree runner got the machinery, and the guard that would have caught it now watches every spawn surface — including ones added by an author who never saw this bug.
- **Exemptions are auditable prose in one diff-reviewed place**, not silence. `runShell`'s entry states its condition explicitly: no engine caller today; supervision and a surface before an operator command routes through it.
- **A new spawn site anywhere costs a registry edit.** Deliberate friction — the moment a spawner is born is the moment its interrupt story is decided.
- **The residual is named.** The scan covers `Deno.Command` and `node:child_process` under `src/`; a child spawned through some other mechanism (FFI, a future runtime API) is invisible to it, as are `tests/` (the harness itself) and `templates/` (which run under other projects' stacks). Windows has no process groups, so tree-reap assertions hold on POSIX; Windows keeps direct-child kill semantics.
