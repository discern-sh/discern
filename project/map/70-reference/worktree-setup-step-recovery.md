---
title: Worktree setup-step recovery
description: Journal states and owner-confirmed choices for an interrupted project-authored setup command.
order: 190
aliases:
  - worktree setup recovery
  - setup step journal
  - ambiguous setup step
---

# Recover an interrupted worktree setup step

_discern preserves uncertainty instead of automatically replaying a command whose outcome it cannot observe._

Each configured `[worktree.setup].steps` command has a stable identity and a `not_started`, `running`, or `completed` state. `discern worktree setup` atomically records `running` before invocation and `completed` after success in the worktree's Git administration area. Re-entry skips completed identities even if a later setup phase never reached the worktree-ready sentinel.

A `running` identity means the process stopped after invocation began but before completion was recorded. Automatic setup refuses before any other setup effect. Observe the command's external state, then choose one recovery.

If the step completed, preserve that observation without replaying it:

```sh
discern worktree setup --mark-step-complete <id> --confirmed
```

If it did not complete, or another run is appropriate, authorize a retry:

```sh
discern worktree setup --retry-step <id> --confirmed
```

Both choices are idempotent. `--confirmed` records the owner's decision for that observed step. The shell command's outcome remains an observation rather than machine Proof. A running state blocks automatic replay until the owner chooses retry ([ADR 0332](../_adr/0332-worktree-setup-steps-preserve-interruption-ambiguity.md)).

Top-level `setup begin`, `setup done`, and `setup accept` retain their plan-derived write checks and resumable phase state; [Setup command boundaries](setup-command-boundaries.md) defines that separate contract.
