# ADR 0095: Standardize the prelaunch CLI vocabulary

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** The current read-only question is `impact`; the intermediate `scopes` spelling was retired. The remaining decision and reasoning are unchanged.

**Status**: accepted

## Context

The prelaunch CLI had accumulated multiple names for the same jobs. The worktree lifecycle had both colon and spaced forms, the setup flow still had legacy alias names, and several verbs used implementation-shaped names rather than the words a user would naturally reach for. The surface was still small enough to fix before release, but leaving both old and new spellings would make the first public contract harder to teach.

This project also has an unusual documentation constraint: coding agents read the whole repository, including historical ADRs, fixtures, TODOs, and private planning notes. Normally a historical ADR should stay point-in-time accurate, but retired command names in history become live suggestions when an agent mines them for examples. For command vocabulary, history is part of the instruction surface.

## Decision

The launched CLI has one canonical spelling for each job:

- `identity` replaces `worktree-name`.
- `preset` replaces `add-preset`.
- `impact` replaces `changed-scopes` (and the intermediate `scopes` spelling).
- `worktree setup` is the explicit setup action; bare `worktree` is a help-only command group.
- The worktree colon forms are removed; the spaced subcommands are the only forms.
- `migrate` is removed. `upgrade --check` and `upgrade --dry-run` are the read-only upgrade surfaces.
- The setup aliases are removed; `setup` is the only setup verb.

The repository is rewritten to teach only the canonical vocabulary, including historical ADRs and fixtures. This ADR is the record that the historical rewrite was deliberate. Compatibility code may still recognize legacy on-disk artifacts that real old installs need upgraded, but docs, guidance, tests, and user-facing strings do not present retired commands as available choices.

A development guard in `tests/dev_vocab_guard_test.ts` bans the retired command spellings and deleted source/test paths everywhere except this ADR, so the old surface cannot quietly re-enter through examples or comments.

## Consequences

The public surface is smaller and more conventional: command groups use spaces, read-only previews live on the mutating verb through `--check`/`--dry-run`, and setup has one name. This is intentionally breaking for any prelaunch checkout or script still using the retired spellings.

Historical ADRs are less literal than usual. That is a conscious trade-off: in an agent-read codebase, stale command examples are operationally harmful. The new ADR plus the guard preserve the fact of the rewrite while keeping the rest of the repo safe to use as current instruction material.

The guard is now part of changing the command surface. A future rename must edit the command registry, docs, MCP/tool surfaces, tests, and the retired-vocabulary list together, or the gate fails.
