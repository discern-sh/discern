## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

Keep one worktree for the whole effort, through review feedback and resumed sessions.

- **Resume the assigned worktree.** If this effort already has a worktree, continue at its recorded path and pass `path` to discern tools that accept it. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again.
- **Never adopt another effort's worktree**, even when it is idle or clean. Fleet rows in `discern_status` do not say which effort is yours.
- **Move your own file operations.** `discern_start` creates a worktree from `{{main_branch}}` with branch prefix `{{branch_prefix}}` and re-aims discern's tools. Your shell and editor must also use the returned path. If you can't change your working root, prefix shell commands with `cd <path> &&` and target file operations explicitly.
- **Update through `discern_update`.** Call it when behind `{{main_branch}}` mid-work; no Git pre-check or hand-merge is needed. Re-read files named in its overlap report. A proven revision needs no update: `discern_accept` composes the moved trunk itself.
- **Wait through `discern_await`.** Use one longest-safe call when work depends on a sibling effort or the trunk; follow its continuation or recovery instructions.{{#if has_test_run_cap}}
- **Use the test queue.** Limit: {{concurrent_test_runs}} concurrent test run{{#if single_test_run}}{{else}}s{{/if}} across checkouts (`[gate].concurrent_test_runs`). Run direct tests through `discern queue -- <command>`.{{/if}}

### Finishing an effort

1. Run **`discern_prepare`**, review its changes, and commit the intended work for this effort. `prepare` may rewrite files; staging and committing remain your responsibility. Commit each logical change separately.
2. After the final commit, call **`discern_done`** directly on the clean, committed final tree. `discern_done` includes the complete test stage; the final gate needs no standalone test preflight. Use `discern_test` only when its complete test stage is the requested result; it publishes no reusable completion evidence. Before an expensive repeat, name what changed or what it will prove. Diagnose a timeout at the named budget; never raise a limit to pass.
3. Read the completion evidence and landing-authority result. **Proof** records what the configured gate established for the exact validated commit. Later edits require renewed verification.
4. Report what changed, what was verified, and anything still unresolved. End with the returned Proof line verbatim.

`discern_done` proves this worktree's committed tip and records Proof for that exact commit. It lands nothing; the worktree stays yours.

**`discern_accept` submits and lands.** It records the submission — the exact proven commit — and lands it on `{{main_branch}}`. A passing gate is evidence; landing requires explicit owner consent or machine-verified authority (`--confirmed` attests the conversation; recorded grants are checked automatically), and a task brief or handoff is never consent. Follow `done`'s authority-aware next action: report and wait when consent is needed, or proceed under the verified authority. Without authority it refuses read-only and the submission waits; relay the Proof line and stop. Landing removes the worktree, resources, and branch once nothing beyond the landed submission remains. If `{{main_branch}}` moved after your Proof, `accept` proves the combination in a disposable integration worktree and lands that exact result, waiting behind another landing. A conflict or failed combined check names the cause, lands nothing: run `discern_update`, resolve, commit, `discern_done`, `discern_accept` again. Never adopt an `integration/` worktree — discern's disposable copy.
