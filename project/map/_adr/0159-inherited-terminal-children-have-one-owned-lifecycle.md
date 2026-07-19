# ADR 0159: Inherited-terminal children have one owned lifecycle

**Status**: accepted; extends [ADR 0105](0105-interruption-reaches-detached-gate-jobs.md), [ADR 0137](0137-project-scripts-live-under-the-script-command.md), and [ADR 0157](0157-the-desk-owns-launched-child-sessions.md)

## Context

Three command boundaries launched arbitrary user code with inherited stdin, stdout, and stderr: Project Scripts, desk children, and the `with-gotchas` wrapper. Each spawned its direct child and awaited its status. None installed signal handlers or treated descendants as part of the launched session.

That was sufficient while the wrapper stayed alive and the terminal delivered Ctrl-C to the whole foreground process group. It failed when a caller signaled discern's PID alone. Discern exited before its child, and a long-running Project Script could remain under the operating system's process supervisor with its server port still occupied. A Project Script often delegates through a task runner or shell, so stopping only the direct child does not cover the class.

The gate job runner already owns detached process groups, but arbitrary inherited-terminal code has a different constraint. An interactive child must stay in the terminal's foreground process group. Always detaching it can suspend terminal reads with SIGTTIN. The desk also differs from a direct CLI invocation: after its launched child stops, it should resume its survey rather than terminate itself.

## Decision

**Every boundary that launches arbitrary user code with inherited terminal streams uses one owned-child lifecycle.**

- `runOwnedChild` is the only source location allowed to configure inherited stdin, stdout, and stderr. A source-wide architectural test scans the complete `src/` tree, so a new launcher auto-enrolls regardless of its file or function name.
- On POSIX with terminal stdin, the child remains in discern's foreground process group. Terminal input and terminal-generated signals retain their native behavior. When stdin is not a terminal, the child leads a detached process group so discern can signal its descendants as one unit. Windows retains direct-child signaling.
- Scoped SIGINT, SIGTERM, and SIGHUP listeners forward the first interrupt and keep discern alive while the child settles. After two seconds, discern sends SIGKILL. Once a non-terminal group leader has been reaped, discern also sends SIGKILL to any group survivor, covering descendants that inherited an ignored SIGINT from a non-interactive shell.
- A direct CLI invocation re-raises the interrupt after cleanup, preserving killed-by-signal behavior and conventional exit status. The desk asks the boundary to return after cleanup so its owning interaction can resume.
- The gate runner reuses the shared process-signal primitives but keeps its abort-controller lifecycle from ADR 0105. Captured-output commands and pagers are not arbitrary inherited-terminal sessions and stay outside this boundary.

SIGKILL delivered to discern remains impossible to handle. A parent that disappears without sending a supported signal is also outside the contract: portable child APIs do not report that event, and discern does not poll parent identity or become a background service supervisor. A caller that backgrounds `discern script` owns that job and must signal or wait for it.

## Consequences

- Interrupting discern during a Project Script, desk-launched agent, shell, or script stops the owned child before discern exits or resumes. Non-terminal descendants in the owned process group stop with it.
- Foreground prompts and terminal reads continue to work because interactive children are not detached.
- The CLI may take up to two seconds to stop a child that ignores graceful shutdown. This bounded delay prevents the wrapper from abandoning that child.
- The architecture test turns inherited terminal streams into a closed launch boundary. A new arbitrary-code launcher cannot bypass cleanup through a different filename or subsystem.
- Self-daemonizing programs that leave the owned process group remain responsible for their own lifecycle. Detecting and killing unrelated processes by command name or open port would risk affecting another worktree or user process.

## Alternatives considered

- **Always launch in a detached process group.** Rejected because an interactive child outside the terminal's foreground group can be suspended when it reads input.
- **Forward signals only to the direct child.** Rejected because Project Scripts commonly delegate through shells and task runners, leaving the actual workload alive.
- **Scan the process table or occupied ports during worktree teardown.** Rejected because neither command names nor ports prove ownership, and teardown is not the only way a launching session ends.
- **Watch the parent PID from the child boundary.** Rejected because parent identity and parent-process changes are platform-specific, and polling would turn a synchronous command runner into a partial service manager.
