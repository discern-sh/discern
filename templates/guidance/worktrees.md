## Isolated worktree workflow

icculus runs each line of work in its own **linked git worktree**, so concurrent
efforts never collide. The git mechanics are generic; the project wires the two
seams it needs (a per-worktree database and dev-server) in `[worktree]`.

- A worktree is created on its own branch (the `[project].branch_prefix`). The
  create hook runs `icculus worktree` to set it up: a deterministic dev-server
  port, any inherited env vars, the configured setup steps, and freshly
  materialized skills + guidance.
- **`icculus worktree:exit`** graduates the current worktree's branch back into the
  main checkout — commit your work first; it refuses to run if the branch is behind
  the integration branch (run `icculus finish` to integrate) or if the main
  checkout is dirty.
- **`icculus worktree:teardown`** discards a worktree's database and dev-server
  link without graduating.
- **`icculus worktree:prune`** sweeps stale worktrees and fully-merged branches.

Resolve a worktree's stable identity with **`icculus worktree-name`**
(`--id`/`--site`/`--branch`/`--port`/`--db`). Do your work inside the worktree, not
the main checkout.
