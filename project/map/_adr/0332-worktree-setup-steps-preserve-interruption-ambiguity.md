# ADR 0332: Worktree setup steps preserve interruption ambiguity

**Status**: accepted. Extends the setup split in [ADR 0059](0059-worktree-setup-ensure.md) and uses the atomic replacement authority in [ADR 0326](0326-durable-replace-writes-use-one-atomic-writer.md). It remains separate from the top-level setup effect plans in [ADR 0320](0320-setup-plans-own-write-authority-and-activation-recovery.md).

## Context

`[worktree.setup].steps` contains project-authored shell commands intended for initial worktree setup. discern wrote the worktree-ready sentinel only after resource provisioning, setup steps, convergence commands, and refresh completed. If the process stopped after a setup command succeeded but before that final sentinel, re-entry ran the command again.

An arbitrary shell command may change a remote service, a local tool cache, or another system that discern cannot inspect. After interruption, local state cannot prove whether that command completed. Automatically replaying it can duplicate an effect. Automatically skipping it can leave setup incomplete.

Top-level `setup begin`, `setup done`, and `setup accept` already derive required write targets and resumable phase state from their `SetupEffectPlan`. Worktree-authored shell steps need interruption evidence without creating a competing model for those built-in setup effects.

## Decision

**Each configured worktree setup step carries a validated Git-admin journal entry with `not_started`, `running`, or `completed` state.**

discern derives the stable step identity from the command text and its occurrence among duplicate commands. Unrelated reordering does not change that identity. The shared atomic writer replaces the complete journal with private file permissions and requested file synchronization.

Before invoking a step, discern records `running`. It records `completed` only after the command exits successfully. A later setup skips completed identities even when the worktree-ready sentinel is absent. Setup checks the journal before resource, environment, or command effects.

A running entry leaves completion unresolved. Automatic setup refuses without replaying the command and serves these owner-confirmed choices after the owner observes the command's external state:

- `discern worktree setup --mark-step-complete <id> --confirmed` records the observed completion without replay;
- `discern worktree setup --retry-step <id> --confirmed` resets the step and runs it again.

Each choice is idempotent. Repeating mark-complete reports the existing completion. Repeating retry after success skips the completed step. A running identity removed from configuration remains a refusal until configuration restores the matching command and recovery resolves it.

A ready worktree that predates the journal enrolls its configured one-time steps as completed. This preserves the established no-replay meaning of its ready sentinel. The journal does not replace `SetupEffectPlan`, `preflightSetupEffects`, top-level setup phase state, or convergent `[worktree.setup].ensure` commands.

## Consequences

- Automatic replay is at most once across recorded completion. A crash during `running` requires an explicit decision. discern does not promise that an arbitrary shell effect occurs once.
- Completed setup steps survive later failures in convergence or refresh and do not run again.
- Recovery can preserve an effect that completed before interruption or authorize a retry when observation shows it did not.
- Existing ready worktrees need no migration command. Their first journal enrollment records the prior sentinel's meaning.
- Changing or removing a running command cannot erase unresolved evidence.
- The journal adds one atomic write before and after each successful setup command.

## Alternatives considered

- **Replay every step until the ready sentinel exists.** Rejected because a completed external effect can run twice.
- **Treat every running record as completed.** Rejected because a process can stop before the command starts or while it is incomplete.
- **Treat every running record as failed and retry it.** Rejected because local evidence cannot establish that the external effect did not complete.
- **Require project commands to be transactional.** Rejected because discern cannot impose rollback or commit semantics on arbitrary project tooling.
