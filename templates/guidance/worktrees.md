## Isolated worktree workflow

discern keeps each line of work in its own **linked git worktree** so parallel efforts
never collide.{{#if has_worktree_resources}} It provisions per-worktree external
**resources** (e.g. a database); read one with `discern worktree-name --resource <name>`.{{/if}}

- **`discern_start`** — run from the main checkout — creates your own worktree on its
  own branch (prefixed `{{branch_prefix}}`) and returns the path to re-root into (it
  can't move you there). Run it once per task.
- **`discern_integrate`** brings `{{main_branch}}` into your branch when it falls
  behind. Idempotent — just call it.
- **`discern_graduate`** hands your branch back to the main checkout when the work is
  done — commit it first. It lands per `{{graduate_to}}`: `branch` (checked out for
  review) or `trunk` (fast-forwarded, the merged branch deleted).

**Operate only in the worktree you were launched into, or the main checkout — never
start work in one you didn't create.** A clean working tree doesn't mean it's free;
the worktrees `discern_status` lists are other efforts in flight, not a pool to
claim from.
