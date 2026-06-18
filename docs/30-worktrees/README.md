# The isolated-worktree workflow

_Throwaway git Worktrees so an agent never works in the main checkout._

This subtree covers the Worktree lifecycle. The `agent worktree*` Recipes
provision and tear down an isolated `git worktree` (and its branch) per change,
each with its **own database** and a **deterministic dev-server port** so
concurrent Worktrees never collide. The git mechanics are generic; the two
stack-specific seams — the database and dev-server **Adapters** — are empty
config in `icculus.toml` until a project wires them, so a Worktree round is a
clean no-op until then (ADR 0007).

The lifecycle is driven by hooks in `.claude/settings.json`: `SessionStart` →
[`worktree:ensure`](../../templates/.icculus/engine/worktree-ensure) (idempotent
setup), `WorktreeCreate` →
[`worktree`](../../templates/.icculus/engine/worktree) (first-time setup),
`WorktreeRemove` →
[`worktree:teardown`](../../templates/.icculus/engine/worktree-teardown). When a
change is done, [`worktree:exit`](../../templates/.icculus/engine/worktree-exit)
**graduates** the branch into the main repo and removes the Worktree;
[`worktree-name`](../../templates/.icculus/engine/worktree-name) resolves a
Worktree's stable identity (id / site / branch / port / db).

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.ai/skills/document-subsystem/SKILL.md) skill.

## Planned leaves

| File _(to be written)_    | What it will cover                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `the-lifecycle.md`        | create → ensure → exit → teardown → prune, and the hooks that fire each.                  |
| `worktree-identity.md`    | How a Worktree's id, site, branch, port, and db name are derived and read.                |
| `the-adapter-contract.md` | The database and dev-server seams, their runtime tokens, and how to wire them (ADR 0007). |
| `integration.md`          | Graduating a branch into `main`, and the prune/sweep of stale Worktrees.                  |

## See also

- [concepts.md](../00-orientation/concepts.md) — where Worktrees sit in the
  loop.
- [ADR 0011](../_adr/0011-adopt-worktree-workflow.md) — why the harness adopted
  this workflow for its own development.
