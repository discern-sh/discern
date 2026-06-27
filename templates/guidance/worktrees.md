## Isolated worktree workflow

discern keeps each line of work in its own **linked git worktree** so parallel
efforts never collide — when you start a task, you work in your own worktree, never
the main checkout.{{#if has_worktree_resources}} A project can declare per-worktree external **resources** (a
database, a container) that discern provisions and tears down per worktree; call
**`discern_help`** for the lifecycle.{{/if}}

- **`discern start`** — run from the main checkout — creates your own worktree on
  its own branch (prefixed `{{branch_prefix}}`) and returns the path to re-root into
  (it can't move you there). Run it once per line of work.
- **`discern integrate`** brings `{{main_branch}}` into your branch when it has
  fallen behind (the gate's merge check points here). It's safe and idempotent —
  just call it; on a conflict it reports the exact next step.
- **`discern graduate`** hands your branch back to the main checkout when the work
  is done — commit it first. By default it lands per `[worktree].graduate_to`
  (here `{{graduate_to}}`): `branch` leaves it checked out for review, `trunk`
  fast-forwards `{{main_branch}}` and deletes the merged branch. Override per-run
  with `--to`. It refuses if the branch is behind `{{main_branch}}` (run
  `discern integrate`) or the main checkout is dirty.

Resolve a worktree's identity (its port, branch, {{#if has_worktree_resources}}`--resource <name>`, {{/if}}…) with the
**`discern worktree-name`** CLI.

**Operate only in the worktree you were launched into, or the main checkout — never
start work in one you didn't create.** A clean working tree doesn't mean it's free;
the worktrees `discern_status` lists are other efforts in flight, not a pool to
claim from.
