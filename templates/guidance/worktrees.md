## Isolated worktree workflow

discern keeps each task in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

- **`discern_start`** — from the main checkout, create your isolated worktree (branch prefix `{{branch_prefix}}`, forked from `{{main_branch}}`) and re-root into its returned path. Can't change your working root? Prefix shell commands with `cd <path> &&` and pass `path` to discern tools. Already in a worktree? Stay there.
- **`discern_update`** brings `{{main_branch}}` in when behind and reports overlap. Idempotent — call it directly; it checks preconditions and gives the next step if it refuses. To build on unlanded work, `start` and `update` take `from`; only `accept` lands on the trunk.
- **`discern_await`** watches a sibling or the trunk in one longest-safe call and returns early. Never shorten it for progress reports. After "not yet", follow `--resume` without a fixed retry limit until met, stopped by the user, or no longer needed. A refusal has no continuation; follow its recovery hint. Met hints choose `start` or `update` for your location.
- **`discern_accept`** lands only with explicit consent from this conversation or machine-verified authority from a recorded grant. After a green `discern done`, follow its authority-aware hint: either report the one-line receipt and stop, or land under the verified grant. Landing fast-forwards `{{main_branch}}` and removes the worktree and branch.

While iterating, use `discern_prepare`, `discern_test`, or a targeted command, and commit each logical step. Commit the final tree before `discern_done`; a later commit invalidates its receipt.

**Never edit a worktree from outside it, and never start work in one you didn't create.** A clean tree isn't free; `discern_status` lists other efforts in flight.
