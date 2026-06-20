# The isolated-worktree workflow

_Throwaway git Worktrees so an agent never works in the main checkout._

This subtree covers the Worktree lifecycle. The `icculus worktree*` verbs
provision and tear down an isolated `git worktree` (and its branch) per change,
each with its **own database** and a **deterministic dev-server port** so
concurrent Worktrees never collide. The git mechanics are generic; the two
stack-specific seams — the database and dev-server **worktree settings** — are
empty config in `.icculus/config.toml` until a project wires them, so a Worktree
round is a clean no-op until then (ADR 0007, ADR 0018).

The lifecycle is driven by hooks in `.claude/settings.json`: `SessionStart` →
[`worktree:ensure`](../../src/engine/worktree/lifecycle.ts) (idempotent setup),
`WorktreeCreate` → [`worktree`](../../src/engine/worktree/lifecycle.ts)
(first-time setup), `WorktreeRemove` →
[`worktree:teardown`](../../src/engine/worktree/lifecycle.ts). When a change is
done, [`worktree:exit`](../../src/engine/worktree/lifecycle.ts) **graduates**
the branch into the main repo and removes the Worktree;
[`worktree-name`](../../src/engine/worktree/identity.ts) resolves a Worktree's
stable identity (id / site / branch / port / db).

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.icculus/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_     | What it will cover                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `the-lifecycle.md`         | create → ensure → exit → teardown → prune, and the hooks that fire each.                  |
| `worktree-identity.md`     | How a Worktree's id, site, branch, port, and db name are derived and read.                |
| `the-worktree-settings.md` | The database and dev-server seams, their runtime tokens, and how to wire them (ADR 0007). |
| `integration.md`           | Graduating a branch into `main`, and the prune/sweep of stale Worktrees.                  |

## See also

- [concepts.md](../00-orientation/concepts.md) — where Worktrees sit in the
  loop.
- [ADR 0011](../_adr/0011-adopt-worktree-workflow.md) — why the harness adopted
  this workflow for its own development.
