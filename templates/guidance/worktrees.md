## Isolated worktree workflow

discern keeps each line of work in its own **linked git worktree** so parallel efforts
never collide.{{#if has_worktree_resources}} It provisions per-worktree external
**resources** (e.g. a database); read one with `discern worktree-name --resource <name>`.{{/if}}

- **`discern_start`** — on the main checkout and starting a new task? Create your own
  worktree for it (on its own branch, prefixed `{{branch_prefix}}`) and re-root into the
  path it returns (it can't move you there). Already in a worktree? That's your
  workspace — don't start another.
- **`discern_integrate`** brings `{{main_branch}}` into your branch when it falls
  behind, and reports exactly what changed beneath your work. Idempotent — just call it
  (no need to `git diff` first).
- **`discern_graduate`** hands your branch back to the main checkout when the work is
  done. It lands on `{{graduate_to}}` by default; options are `branch` (checked out for
  review) or `trunk` (fast-forwarded, the merged branch deleted).

**Operate only in the worktree you were launched into, or the main checkout — never
start work in one you didn't create.** A clean working tree doesn't mean it's free;
the worktrees `discern_status` lists are other efforts in flight, not a pool to
claim from.
