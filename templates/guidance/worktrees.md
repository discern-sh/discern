## Isolated worktree workflow

discern keeps each task in a **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. `[worktree.resources]` can isolate shared state such as databases or ports.{{/if}}

- **`discern_start`** — from the main checkout, create your worktree (branch prefix `{{branch_prefix}}`, forked from `{{main_branch}}`) and re-root into its returned path. Otherwise prefix shell commands with `cd <path> &&` and pass `path` to discern tools. Already in a worktree? Stay there.
- **`discern_update`** brings `{{main_branch}}` into your branch and reports overlap. Call it directly; it checks its own preconditions. To build on unlanded work, `start` and `update` take `from` — work composes below the trunk.
- **`discern_await`** watches a sibling or the trunk in one longest-safe call and returns as soon as the condition holds. Do not shorten it for progress reports. After "not yet", follow `--resume` until the condition holds, the user stops, or the task no longer needs it; never impose a retry count. An `ok: false` refusal has no continuation: follow its recovery hint. Met hints choose `start` from main or `update` from a worktree.
- **`discern_accept`** lands only with explicit consent from this conversation or machine-verified authority from a recorded grant. After a green `discern done`, follow its authority-aware hint: either report the one-line receipt and stop, or land under the verified grant. Landing fast-forwards `{{main_branch}}` and removes the worktree and branch.

Iterate with `discern_prepare`, `discern_test`, or targeted commands, and commit logical steps. Commit the final tree before `discern_done`; a later commit invalidates its receipt.

**Never edit a worktree from outside it or use one you didn't create.** A clean tree is not free; `discern_status` lists other efforts in flight.
