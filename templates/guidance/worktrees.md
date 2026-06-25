## Isolated worktree workflow

discern runs each line of work in its own **linked git worktree**, so concurrent
efforts never collide.{{#if has_worktree_resources}} A project can declare per-worktree external
**resources** (a database, an emulator, a container) that discern provisions and
tears down per worktree; for the lifecycle and how to discover a resource's
handle, call **`discern_help`**.{{/if}}

- A worktree is created on its own branch (prefixed `{{branch_prefix}}`). The
  create hook (`discern worktree:create`) adds it and sets it up:{{#if has_worktree_resources}} it provisions the declared
  resources,{{/if}} records a deterministic
  dev-server port{{#if has_worktree_resources}} + the resource handles{{/if}} into `.env`, inherits env vars, runs the
  configured setup steps, and freshly materializes skills + guidance.
- **`discern graduate`** graduates the current worktree's branch back into the
  main checkout — commit your work first; it refuses to run if the branch is behind
  `{{main_branch}}` (run `discern finish` to integrate) or if the main
  checkout is dirty.
- **`discern worktree:prune`** sweeps stale worktrees and fully-merged branches{{#if has_worktree_resources}} (reclaiming the resources of any that vanished without a clean teardown){{/if}}. `--dry-run` reports without acting.

Resolve a worktree's stable identity with **`discern worktree-name`**
(`--id`/`--site`/`--branch`/`--port`/`--db`/`--worktree`{{#if has_worktree_resources}}/`--resource <name>`{{/if}}). Do
your work inside the worktree, not the main checkout.
