## Isolated worktree workflow

discern keeps each task in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

- **`discern_start`** — from the main checkout, create your isolated worktree (branch prefix `{{branch_prefix}}`, forked from `{{main_branch}}`) and re-root into the returned path: cd in, or start a session there. Can't change your working root? Prefix every shell command with `cd <path> &&` and pass `path` to every discern tool. Already in a worktree? Stay there.
- **`discern_update`** brings `{{main_branch}}` into your branch when behind and reports upstream overlap. Idempotent — call it directly instead of pre-checking with git or hand-merging; it performs its own preconditions and gives the exact next step if it refuses. To build on unlanded work instead, `start` and `update` both take `from` (any ref) — work composes below the trunk; only `accept` lands on it.
- **`discern_await`** watches a sibling or the trunk in one longest-safe call and returns early when its condition holds. Never shorten the call to send progress reports. After a "not yet" result, run the returned `--resume` command. Repeat with no fixed retry limit until the condition holds, the user stops the watch, or the task no longer needs the dependency. An `ok: false` refusal has no continuation: do not resume it; follow its recovery hint. A met result's hint chooses `start` or `update` for your location.
- **`discern_accept`** lands only with explicit consent from this conversation or machine-verified authority from a recorded grant. After a green `discern done`, follow its authority-aware hint: either report the one-line receipt and stop, or land under the verified grant. Landing fast-forwards `{{main_branch}}` and removes the worktree and branch.

While iterating, use `discern_prepare`, `discern_test`, or a targeted project command, and commit each logical step — acceptance lands your branch history as-is. When the final tree is ready, commit it first, then run `discern_done` once on the clean HEAD — acceptance honors that receipt; a later commit invalidates it.

**Never edit a worktree from outside it without one of those moves, and never start work in one you didn't create.** A clean tree doesn't mean it's free; the ones `discern_status` lists are other efforts in flight, not a pool to claim from.
