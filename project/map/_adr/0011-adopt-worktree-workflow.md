# ADR 0011: Adopt the isolated-worktree workflow for discern's own development

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged. **Current-state note.** The worktree workflow is still how discern develops itself, but the mechanics moved on: the hooks parse their payload inside the binary rather than shelling out to `bin/agent worktree lifecycle helpers` ([ADR 0040](0040-worktree-hooks-in-the-binary.md)), the `db`/`dev_server` seams became per-worktree resources ([ADR 0025](0025-worktree-resources.md)), placement is the configurable sibling default ([ADR 0052](0052-worktree-sibling-placement.md)), and `.discern/` is dissolved ([ADR 0020](0020-dissolve-discern-dir.md)). **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** The older Recipe reference below describes the then-current command implementation; the decision and reasoning are unchanged.

**Status**: accepted

## Context

[ADR 0010](_superseded/0010-self-host-the-harness.md) installed discern into this repo and made `discern done` the gate, but it deliberately **deferred** one piece: whether to develop discern inside discern's own isolated git worktrees. The `SessionStart`/`WorktreeCreate`/`WorktreeRemove` hooks shipped scaffolded but dormant, and the open question was parked in `TODO.md`.

Two things make the call easy now. First, the configuration is already in place: `[worktree] enabled = true`, with both adapter seams (`db`, `dev_server`) empty — which is exactly right for a Deno CLI that has no database and no dev-server, so a worktree round is pure git mechanics with nothing to clone or link. Second, the only real obstacle was portability: the `WorktreeCreate`/`WorktreeRemove` hook commands invoked `zsh -c`, which assumes a login shell that is absent on a stock Linux box and in CI. The hook bodies are already POSIX-clean, so moving them to `sh -c` removes the one thing standing between "scaffolded" and "usable".

## Decision

Adopt the worktree workflow as the way discern is developed: each line of work gets its own isolated worktree under `.claude/worktrees/`, created and torn down by discern hooks.

- **The hooks run under `/bin/sh`, not `zsh`.** Both the root `.claude/settings.json` and the shipped `templates/.claude/settings.json.tmpl` now use `sh -c`; the command bodies were already portable. This is a straight portability fix that also benefits every downstream install, not just this repo, so it is not gated behind the adoption decision.
- **No further configuration.** `[worktree] enabled = true` and the empty `db`/`dev_server` adapters stay as they are; a worktree round for this repo is the git-and-gate path only.
- The `SessionStart` `worktree ensure` hook and the `WorktreeCreate`/`WorktreeRemove` hooks are now **load-bearing**, not dormant.

## Consequences

- Branch work is isolated by default: a worktree per line of work, its own checkout, no stomping on the main tree mid-session. This is the workflow the discern exists to provide, now exercised by its own author — the same validation argument as ADR 0010.
- The hooks are live, so a breakage in them now affects day-to-day development, not only downstream users. They stay deliberately thin (a few lines of POSIX sh that shell out to `bin/agent worktree lifecycle helpers`); the real logic lives in the engine recipes, which the test suite covers hermetically.
- `port = true` still derives a per-worktree port that nothing in this repo consumes (there is no dev-server). It is harmless and left on rather than carrying a special-case; a project that wires a dev-server adapter would want it.
- The `TODO.md` "decide whether to adopt" item is closed by this record.

## Alternatives considered

- **Keep developing on `main` directly.** Simplest, but it leaves the most-distinctive part of discern unexercised by its own author and forgoes the isolation the tool is built to give. The dormant-hooks status quo was only ever meant to be temporary (ADR 0010 parked it in `TODO.md`); leaving it parked indefinitely is the non-decision this ADR exists to end.
- **Enable the hooks but leave the choice informal.** That is effectively the dormant state — live config, no committed practice — which is exactly what produced a lingering TODO item. Recording the decision is the point.
