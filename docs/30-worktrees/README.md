# The isolated-worktree workflow

_Throwaway git Worktrees so an agent never works in the main checkout._

This subtree covers the Worktree lifecycle. The `discern worktree*` verbs
provision and tear down an isolated `git worktree` (and its branch) per change,
each with a **deterministic dev-server port** and any number of project-declared
**resources** — external things (a database, an emulator, a container, a queue)
that must exist for exactly the life of the Worktree. The git mechanics are
generic; the resources are the only stack-specific part, declared as
`[worktree.resources.<name>]` tables in `discern.toml`. A fresh install declares
none, so a Worktree round is a clean no-op until a project wires one. The whole
workflow is the `worktrees` feature, which can be turned off in `[features]`
(ADR 0011, ADR 0025).

The lifecycle is driven by hooks in `.claude/settings.json`: `SessionStart` →
[`worktree:ensure`](../../src/engine/worktree/lifecycle.ts) (idempotent setup +
resource `ensure`), `WorktreeCreate` →
[`worktree`](../../src/engine/worktree/lifecycle.ts) (first-time setup creates
the resources), `WorktreeRemove` →
[`worktree:teardown`](../../src/engine/worktree/lifecycle.ts) (destroys them).
When a change is done, [`graduate`](../../src/engine/worktree/lifecycle.ts)
graduates the branch into the main repo and removes the Worktree;
[`worktree:prune`](../../src/engine/worktree/lifecycle.ts) sweeps stale
Worktrees and **reclaims the resources of any Worktree that vanished without a
clean teardown** (the garbage-collection safety net).
[`worktree-name`](../../src/engine/worktree/identity.ts) resolves a Worktree's
stable identity (id / site / branch / port / db / worktree / resource).

## Leaves

| File                                 | Covers                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [the-resources.md](the-resources.md) | Per-worktree resources: the config seam, the create/reuse/destroy lifecycle, the ledger + orphan GC, identity, ownership/namespacing, and the runtime-discovery contract. |

> **Status: partial.** `the-resources.md` is written; the remaining lifecycle /
> identity / integration leaves are still stubs — fill them with the
> [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md)
> skill.

## See also

- [concepts.md](../00-orientation/concepts.md) — where Worktrees sit in the
  loop.
- [ADR 0011](../_adr/0011-adopt-worktree-workflow.md) — why the harness adopted
  this workflow.
- [ADR 0025](../_adr/0025-worktree-resources.md) — generalizing the
  db/dev-server adapters into per-worktree resources with orphan GC.
