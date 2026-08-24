## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

The `discern_status` fleet isn't a pool. Never adopt another effort's worktree because it is idle or clean.

- **`discern_start`** — only for an effort without a worktree. From the main checkout, create one (branch prefix `{{branch_prefix}}`, forked from `{{main_branch}}`) and re-root into the returned path using your native worktree-entering tool when available; otherwise cd in, or start a session there. Continue in the worktree throughout the entire effort. Already there? Stay there. If you can't change your working root, prefix every shell command with `cd <path> &&` and pass `path` to every discern tool. Starting re-aims the discern tools at the new worktree, but your own file operations move only when you move them — edits made from the old root land on the trunk while the gate runs in the worktree, and the two quietly diverge.
- **`discern_update`** brings `{{main_branch}}` into your branch when behind and reports upstream overlap — re-read any of your files it names, since a merge that applies cleanly can still conflict in meaning. Idempotent — call it directly instead of pre-checking with git or hand-merging; it performs its own preconditions and gives the exact next step if it refuses. To build on unlanded work instead, `start` and `update` both take `from` (any ref) — work composes below the trunk; only `accept` lands on it.
- **`discern_await`** watches a sibling or the trunk in one longest-safe call. Do not surface progress updates until it returns. If `data.met: false`, continue with `data.resume` without surfacing an update. Repeat without a fixed limit until the condition holds, or until stopped or unnecessary. An `ok: false` refusal has no continuation. Do not resume it. Follow its recovery hint. Report only when the condition holds, the watch is unnecessary, or a refusal/error needs action. Always respond to new user input. On success, follow its `start`/`update` hint.
- **`discern_accept`** lands only with explicit consent from this conversation or machine-verified authority from a recorded grant. A green gate is evidence your work is ready, but the owner decides what to do with it. After a green `discern done`, follow its authority-aware hint: either report the one-line proof and stop, or land under the verified grant. Landing fast-forwards `{{main_branch}}` and removes the worktree and branch.

While iterating, use `discern_prepare`, a diagnostic's reproduce command, or a targeted project command, and commit each logical step. Use `discern_test` when the complete test stage is the intended standalone result. Acceptance lands your branch history as-is.

**Finishing an effort.** Proof binds to one exact commit, so the order matters:

1. Run `discern_prepare` and commit everything, so the final tree is committed and the fixers have nothing left to rewrite.
2. Then run `discern_done` once on the clean HEAD — acceptance reuses that proof. A later edit invalidates it, and `done` runs again on the new tree.
3. Report completion in your own words — what changed and why, plus anything the gate did not cover (a deferred standard, a decision the owner still holds) — and end with the proof line verbatim. Never paste the full proof page; the owner retrieves it with `discern status --verbose`.
