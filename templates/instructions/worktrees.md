## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.{{#if has_worktree_resources}} It provisions per-worktree external **resources**; read one with `discern identity --resource <name>`.{{else}}

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.{{/if}}

Keep one worktree for the whole effort, through review feedback and resumed sessions.

- **Resume the assigned worktree.** If this effort already has a worktree, continue at its recorded path and pass `path` to discern tools that accept it. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again.
- **Never adopt another effort's worktree**, even when it is idle or clean. Fleet rows in `discern_status` do not say which effort is yours.
- **Move your own file operations.** `discern_start` creates a worktree from `{{main_branch}}` with branch prefix `{{branch_prefix}}` and re-aims discern's tools. Your shell and editor must also use the returned path. If you can't change your working root, prefix shell commands with `cd <path> &&` and target file operations explicitly.
- **Update through `discern_update`.** Call it when behind `{{main_branch}}`; it checks its own preconditions, so no Git pre-check or hand-merge is needed. Re-read affected files named in its overlap report before continuing.
- **Wait through `discern_await`.** Use one longest-safe call when work depends on a sibling effort or the trunk, and follow its continuation or recovery instructions.
- **Run tests through the configured queue.** When `[gate].concurrent_test_runs` is positive, run direct test commands through `discern queue -- <command>`.

### Finishing an effort

1. Run **`discern_prepare`**, review its changes, and commit the intended work belonging to this effort. `prepare` may rewrite files; staging and committing remain your responsibility. Commit each logical change separately.
2. Run **`discern_done`** on the clean, committed final tree; it refuses uncommitted work, includes the complete test stage, and reuses passing evidence whose inputs are unchanged, so a final gate needs no standalone test preflight; `discern_test` runs the complete test stage on demand when that stage is itself the requested task. Before any expensive repeat, name what changed or what new evidence the run will obtain. Diagnose a timeout at the layer whose named budget fired; never raise a limit to pass.
3. Read the completion evidence and landing-authority result. **Proof** records what the configured gate established for the exact validated commit. Later edits require renewed verification.
4. Report what changed, what was verified, and anything still unresolved. End with the returned Proof line verbatim.

Ordinary successful completion releases the checkout for later validation and eligible cleanup. Completion does not itself merge the change into `{{main_branch}}`. To keep authoring control for further edits or anything else run in the checkout, use `retain_checkout: true` (CLI `--retain-checkout`); when that use ends without edits, stop it and run `discern done --release-checkout`, which reruns nothing. Follow the reported state when resuming a released checkout.

**`discern_accept` lands the validated change on `{{main_branch}}`.** A passing gate supplies evidence; landing also requires explicit owner consent or machine-verified authority. Follow `done`'s authority-aware next action: report and wait when consent is needed, or proceed under the verified authority. Acceptance lands approved efforts in queue order, so it may land efforts ahead of this one first or stop at one that needs approval; read the `Selected effort` line for this effort's own outcome and follow its next command rather than reordering or waiting by hand.
