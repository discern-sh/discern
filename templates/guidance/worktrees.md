## Isolated worktree workflow

discern keeps each task in its own **linked git worktree** so parallel work
doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external
**resources**; read one with `discern identity --resource <name>`.{{/if}}

- **`discern_start`** — from the main checkout, create your isolated worktree
  (branch prefix `{{branch_prefix}}`, forked from `{{main_branch}}`) and re-root
  into the returned path: cd in, or start a session there. Can't change your
  working root? Prefix every shell command with `cd <path> &&` and pass `path`
  to every discern tool. Already in a worktree? Stay there.
- **`discern_integrate`** brings `{{main_branch}}` into your branch when behind
  and reports upstream overlap. Idempotent — call it directly instead of
  pre-checking with git or hand-merging; it performs its own preconditions and
  gives the exact next step if it refuses. To build on unlanded work instead,
  `start` and `integrate` both take `from` (any ref) — work composes below the
  trunk; only `graduate` lands on it.
- **`discern_graduate`** is only for an explicit user handoff/land request. After
  a green `discern done` run on a completed task, relay the receipt to your owner and stop;
  graduate only once they accept (unless they pre-authorized landing).
  It lands on the trunk (`{{main_branch}}`) — fast-forwarded, the worktree
  removed, the merged branch deleted — and refreshes the trunk checkout it
  leaves behind.

While iterating on uncommitted work, use `discern_prepare`, `discern_test`, or a
targeted project command. When the final tree is ready, commit it first, then run
`discern_done` once on the clean HEAD — that recorded receipt is the one
graduation honors; a later commit invalidates it.

Graduation requires a clean worktree and lands committed branch history only.

**Never edit a worktree from outside it without one of those moves, and never
start work in one you didn't create.** A clean tree doesn't mean it's free; the ones
`discern_status` lists are other efforts in flight, not a pool to claim from.
