# ADR 0338: Operation policy enrolls every discern-owned Git writer in preflight

**Status**: accepted. Extends the real-operation write proof in [ADR 0152](0152-slow-workflows-prove-write-authority-first.md), setup's effect-derived targets in [ADR 0320](0320-setup-plans-own-write-authority-and-activation-recovery.md), and the total command policy in [ADR 0330](0330-every-command-path-declares-its-operation-effects.md).

## Context

Sandbox permission metadata is not reliable evidence that Git can create and rename its lock files. Gate, Standards, and setup already use tiny real writes against their exact planned targets, but the rule is local to those workflows. A lifecycle command can therefore reach a different Git mutation before proving authority. Worktree creation demonstrates the failure: `git worktree add` can fail while creating the branch reference, and cleanup can then describe resource teardown for a checkout that Git never created.

A command-by-command repair would leave the next Git-writing verb dependent on someone remembering this incident. A single unconditional probe for every Git-reading command is broader in the wrong dimension: it would make `status`, dry runs, and other observations perform writes, and a successful observation would say nothing about a later invocation's process authority. File-only discern mutations and opaque project commands also must not demand unrelated Git access.

The live command tree already has one total operation-policy registry shared by CLI and MCP. It can enroll the class if Git mutation becomes an explicit effect rather than an inference from lock scope or ordinary checkout writes.

## Decision

**Every applied command path that declares a discern-owned Git mutation proves write authority at the shared operation boundary before its command body runs.**

- `OPERATION_EFFECTS` carries the `discern-git-mutation` effect and a `gitWriteAuthority` strategy. The strategy is either the shared boundary plan alone or that plan plus an exact command effect plan. Project-authored and external effects remain opaque; observation and file-only paths carry no Git authority.
- CLI and MCP reach `withOperationLock`. After it acquires the declared exclusion boundary, the interceptor performs the shared create/write/rename/remove probe in Git's common administration directory. A Git writer that also mutates checkout files probes its checkout administration and project root.
- Dry runs and inactive observational forms take no writer lock and perform no probe. Commands outside a discern project retain their ordinary not-initialized path unless their policy explicitly supports pre-project writes.
- Gate, Standards, and setup retain their exact effect-derived targets. Worktree creation adds an exact preflight for branch references, reference logs, linked-worktree administration, and the dynamic destination tree before `git worktree add`. Exact plans supplement the registry-wide boundary; they never opt a Git writer out of it.
- A denial returns the existing `write_access` error and `write-access` diagnostic, names the denied path, preserves the caller's CLI retry when available, and never enters the command body.
- Failed worktree creation distinguishes attempted from completed creation. Cleanup may remove partial Git/path debris after a failed add, but it tears resources down and deletes the owned branch only after this invocation successfully created the worktree.
- The policy guard holds Git-effect membership and preflight enrollment equal in each direction. A synthetic unrelated Git writer must auto-enroll; a synthetic file-only writer must be rejected if it demands Git authority.

## Consequences

Sandbox denials at the broad Git boundary fail consistently across lifecycle, validation, setup, and Logbook commands, regardless of whether the caller uses CLI or MCP. A future command path cannot declare a discern-owned Git mutation without joining the preflight contract.

The broad probe adds a few transient filesystem operations to every applied discern-owned Git writer. It can surface a whole-Git-administration denial before a deeper command-specific precondition, while argument parsing and ordinary not-initialized routing remain earlier. Exact subdirectory denials still surface at the command's planned boundary.

The probe proves only one point in time. Git or the operating system may still refuse the real effect later, so mutation and cleanup errors remain first-class results. Project-authored commands can hide arbitrary Git effects and remain outside discern's predictive boundary.

## Alternatives considered

- **Probe every command that reads Git.** Rejected because observations and dry runs must remain read-only, and authority belongs to the later effectful invocation.
- **Probe only exact per-command targets.** Rejected as the enrollment rule because each new Git-writing container could omit its local probe. Exact plans remain valuable supplements for narrower denied surfaces.
- **Probe one fixed sentinel path during session orientation.** Rejected because process authority can differ between MCP and CLI invocations, and one successful path does not prove a later operation's boundary.
