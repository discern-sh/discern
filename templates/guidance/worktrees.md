## Isolated worktree workflow

discern keeps each task in its own **linked git worktree** so parallel work
doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external
**resources**; read one with `discern identity --resource <name>`.{{/if}}

- **`discern_start`** — from the main checkout (`{{main_branch}}`), create your
  isolated worktree (branch prefix `{{branch_prefix}}`) and re-root into the
  returned path: cd in, or start a session there. Can't change your working root?
  Prefix every shell command with `cd <path> &&` and pass `path` to every discern
  tool. Already in a worktree? Stay there.
- **`discern_integrate`** brings `{{main_branch}}` into your branch when behind
  and reports upstream overlap. Idempotent — call it directly instead of
  pre-checking with git or hand-merging; it performs its own preconditions and
  gives the exact next step if it refuses.
- **`discern_graduate`** is only for an explicit user handoff/land request. After
  a green finish, unless the user specifically asked you to graduate without
  review, stop and wait for their confirmation.
  It lands on `{{graduate_to}}` by default; options are `branch` (checked out for
  review) or `trunk` (fast-forwarded, the merged branch deleted), and refreshes
  the checkout it leaves behind.

While iterating on uncommitted work, use `discern_prepare`, `discern_test`, or a
targeted project command. When the final tree is ready, commit it first, then run
`discern_finish` once on the clean HEAD — that recorded pass is the one graduation
honors; a finish before the final commit doesn't vouch for it.

Graduation requires a clean worktree and lands committed branch history only.

**Never edit a worktree from outside it without one of those moves, and never
start work in one you didn't create.** A clean tree doesn't mean it's free; the ones
`discern_status` lists are other efforts in flight, not a pool to claim from.
