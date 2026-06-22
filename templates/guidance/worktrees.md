## Isolated worktree workflow

discern runs each line of work in its own **linked git worktree**, so concurrent
efforts never collide. The git mechanics are generic; the project declares any
per-worktree external **resources** it needs (a database, an emulator, a
container, a queue) as `[worktree.resources.<name>]` tables, each with a `create`
command (run at setup) and a `destroy` (run at teardown).

- A worktree is created on its own branch (the `[project].branch_prefix`). The
  create hook runs `discern worktree` to set it up: it creates the declared
  resources (a `required` create failure aborts setup), records a deterministic
  dev-server port + the resource handles into `.env`, inherits env vars, runs the
  configured setup steps, and freshly materializes skills + guidance.
- A resource is created **once** and reused by every later command for the life of
  the worktree — pay an expensive readiness cost once, never per-invocation.
  Discover a resource's handle at runtime with `discern worktree-name --resource
  <name>` or the `DISCERN_RESOURCE_<NAME>` variable in the worktree's `.env`.
- **`discern graduate`** graduates the current worktree's branch back into the
  main checkout — commit your work first; it refuses to run if the branch is behind
  the integration branch (run `discern finish` to integrate) or if the main
  checkout is dirty.
- **`discern worktree:teardown`** destroys a worktree's resources without
  graduating.
- **`discern worktree:prune`** sweeps stale worktrees and fully-merged branches,
  and reclaims the resources of any worktree that vanished without a clean teardown
  (the garbage-collection safety net). `--dry-run` reports without acting.

Resolve a worktree's stable identity with **`discern worktree-name`**
(`--id`/`--site`/`--branch`/`--port`/`--db`/`--worktree`/`--resource <name>`). Do
your work inside the worktree, not the main checkout.
