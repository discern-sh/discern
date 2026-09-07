## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

Keep one worktree for the whole effort. Its branch, identity, and recorded authority preserve continuity through review feedback and resumed sessions.

- **Resume the assigned worktree.** If this effort already has a worktree, continue at its recorded path and pass `path` to discern tools that accept it. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again.
- **Never adopt another effort's worktree**, even when it is idle or clean. The fleet reported by `discern_status` lists separate efforts; its rows do not establish which effort belongs to this conversation.
- **Move your own file operations.** `discern_start` creates a worktree from `{{main_branch}}` with branch prefix `{{branch_prefix}}` and re-aims discern's tools. Your shell and editor must also use the returned path. If you can't change your working root, prefix shell commands with `cd <path> &&` and target file operations explicitly.
- **Update through `discern_update`.** Call it when behind `{{main_branch}}`; it checks its own preconditions, so no Git pre-check or hand-merge is needed. Re-read affected files named in its overlap report before continuing.
- **Wait through `discern_await`.** Use one longest-safe call when work depends on a sibling effort or the trunk, and follow its continuation or recovery instructions.
- **Run tests through the configured queue.** When `[gate].concurrent_test_runs` is positive, run direct test commands through `discern queue -- <command>`.

### Finishing an effort

1. Run **`discern_prepare`**, review its changes, and commit the intended work belonging to this effort. `prepare` may rewrite files; staging and committing remain your responsibility. Commit each logical change separately.
2. Run **`discern_done`** on the clean, committed final tree. `discern_done` includes the complete test stage, so a final gate needs no standalone test preflight. `discern_test` runs the complete test stage on demand when that stage is itself the requested task.
3. Read the completion evidence and landing-authority result. **Proof** records what the configured gate established for the exact validated commit. Later edits require renewed verification.
4. Report what changed, what was verified, and anything still unresolved. End with the returned Proof line verbatim. The owner can retrieve the full Proof page with `discern status --verbose`.

Ordinary successful completion releases the checkout from authoring control so discern can use it for later validation and eligible cleanup. If further local edits are planned, use `retain_checkout: true` (CLI `--retain-checkout`) to keep authoring control. Completion does not itself merge the change into `{{main_branch}}`. Follow the reported state when resuming a released checkout; an unavailable checkout uses the recovery rule above.

**`discern_accept` lands the validated change on `{{main_branch}}`.** A passing gate supplies evidence; landing also requires explicit owner consent or machine-verified authority. Follow `done`'s authority-aware next action: report and wait when consent is needed, or proceed under the verified authority. Acceptance may remove eligible released worktrees and their resources.
