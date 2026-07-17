# ADR 0089: Machine-local provider settings stay ignored

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `graduate` → `accept`, `integrate` → `update`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

discern's provider integrations write shared project config into the repository: `.claude/settings.json` carries Claude Code hooks and permission defaults, `.codex/config.toml` carries Codex MCP and sandbox-workspace settings, and the other provider files follow the same shared-config rule. Those files are meant to be reviewed and committed.

Some providers also create machine-local files while an agent session is running. Claude Code uses `.claude/settings.local.json` for local permission grants and overrides. That file is not shared project policy; it is per-user state. The old `.gitignore` fragment ignored `/.claude/*` and then un-ignored both `.claude/settings.json` and `.claude/settings.local.json`, leaving the local file untracked but visible in `git status`. In real setup and acceptance runs, that porcelain noise was enough to defeat predicates that meant "no tracked work to protect": `setup done` skipped its marker auto-commit, `update` refused a merge, `accept` refused because the main checkout looked dirty.

The same class is not Claude-specific. Codex and other agents can leave provider-local scratch or permission state around while discern is checking whether it is safe to stage one known file, merge into a worktree, or move the main checkout. Those checks need a tracked-clean predicate, not a pristine-tree predicate. Other places need the ordinary Git-clean view: `discern status` answers whether a worktree has any tracked changes or untracked non-ignored files, and worktree pruning must not delete a checkout that contains untracked user work. Gate receipts stay stricter still because they vouch for the exact tree `accept` may land.

## Decision

Machine-local provider settings stay ignored. The shipped `.gitignore` fragment keeps `/.claude/*` ignored, un-ignores only the shared `.claude/settings.json`, and leaves `.claude/settings.local.json` ignored. Schema 14 removes the old `!/.claude/settings.local.json` exception from existing installs during upgrade.

Cleanliness predicates are explicit about what they protect:

- `setup done` auto-commits the completion marker by checking the `discern.toml` diff against `HEAD`, staging only `discern.toml`, and committing only that path. Unrelated tracked, staged, or untracked changes neither block the marker commit nor get swept into it.
- `update` and `accept`'s main-checkout precondition use tracked-only porcelain. Untracked local scratch is left alone because those operations do not stage or remove it.
- `discern status` and its fleet survey use ordinary Git-clean porcelain: tracked changes and untracked non-ignored files make a worktree dirty. Ignored provider-local files stay invisible because `.gitignore` marks them disposable, not because status hides all untracked files.
- Scope classification still includes untracked files, because it answers "which paths changed?" for the gate.
- Gate receipts, acceptance's worktree-clean precondition, and `worktree prune` stay stricter, because they guard exact-tree validation or possible data loss.

The explicit no: discern does not add a broad provider-local denylist. A provider file is ignored only when the provider's own convention makes it machine-local; shared project config remains tracked.

## Consequences

- Claude Code permission grants in `.claude/settings.local.json` no longer create permanent porcelain noise or block setup/acceptance.
- The fix is vendor-neutral at the predicate level: ignored provider-local scratch does not make status dirty, while untracked project work still does.
- Existing installs converge on upgrade through schema 14 instead of requiring users to hand-edit `.gitignore`.
- Shared provider config remains reviewable. If a tracked provider file changes locally, discern treats that as real project work; the setup marker commit is pathspec-limited so it can still record only `discern.toml` without hiding the provider edit.
- The stricter predicates remain strict where untracked files are semantically load-bearing: a gate receipt does not vouch for a tree with untracked work, and prune does not remove a worktree just because its branch is merged.

## Alternatives considered

- **Keep tracking `.claude/settings.local.json`.** Rejected: provider convention treats it as local override state, not shared project policy.
- **Ignore all provider directories broadly.** Rejected: it would hide the shared config discern intentionally seeds or co-manages, such as `.claude/settings.json` and `.codex/config.toml`.
- **Keep pristine-tree checks and ask agents to stash local files.** Rejected: it makes routine provider runtime state part of discern's control flow, causing setup and acceptance to fail for reasons unrelated to the safety invariant.
