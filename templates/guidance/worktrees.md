## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

- **`discern_start`** — only for an effort without a worktree. From the main checkout, create one (branch prefix `{{branch_prefix}}`, forked from `{{main_branch}}`) and re-root into the returned path: cd in, or start a session there. Continue there through later fixes and sessions. Can't change your working root? Prefix every shell command with `cd <path> &&` and pass `path` to every discern tool. Already there? Stay there.
- **`discern_update`** brings `{{main_branch}}` into your branch when behind and reports upstream overlap. Idempotent — call it directly instead of pre-checking with git or hand-merging; it performs its own preconditions and gives the exact next step if it refuses. To build on unlanded work instead, `start` and `update` both take `from` (any ref) — work composes below the trunk; only `accept` lands on it.
- **`discern_await`** watches a sibling or the trunk in one longest-safe call. Do not surface progress updates until it returns. If `data.met: false`, continue with `data.resume` without surfacing an update. Repeat without a fixed limit until the condition holds, or until stopped or unnecessary. An `ok: false` refusal has no continuation. Do not resume it. Follow its recovery hint. Report only when the condition holds, the watch is unnecessary, or a refusal/error needs action. Always respond to new user input. On success, follow its `start`/`update` hint.
- **`discern_accept`** lands only with explicit consent from this conversation or machine-verified authority from a recorded grant. After a green `discern done`, follow its authority-aware hint: either report the one-line receipt and stop, or land under the verified grant. Landing fast-forwards `{{main_branch}}` and removes the worktree and branch.

While iterating, use `discern_prepare`, `discern_test`, or a targeted project command, and commit each logical step — acceptance lands your branch history as-is. When the final tree is ready, commit it first, then run `discern_done` once on the clean HEAD — acceptance honors that receipt; a later commit invalidates it.

**Keep this effort's worktree.** Never adopt another effort's worktree because it is idle or clean. The `discern_status` fleet isn't a pool.
