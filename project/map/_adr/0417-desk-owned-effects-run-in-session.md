# ADR 0417: Desk-owned effects run in session

> **Amendments.**
>
> - **The manual on the Desk's screen:** the manual opens on the Desk's own screen as a nested application rather than taking the terminal as a foreground child ([ADR 0419](0419-the-manual-opens-inside-the-desk-session.md)).
> - **Pages opened beside the screen:** a control whose registry effect is `open` (Check for updates) hands its page to the system browser through a package background command with no progress sheet, and a reader shows what opening it left; the browser launch never needed the terminal.

**Status**: accepted; resolves the tension [ADR 0408](0408-project-code-holds-no-exclusion-boundary.md) left between a running effect and a terminal-owning child, and amends [ADR 0416](0416-desk-reviews-lead-with-consequences.md) (what confirming a change does), [ADR 0159](0159-inherited-terminal-children-have-one-owned-lifecycle.md) (which children inherit the terminal) and [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) (what the session reports)

## Context

After a review, the Desk handed the whole terminal to every effect: a painted handoff line, the alternate screen released, the lifecycle core's human output scrolling past, then the inbox repainted. A landing that runs its repository ensure commands and smoke jobs took a minute of the owner's terminal, and nothing could be done meanwhile: no second task, no look at another row, no agent opened while checks ran. The reviewed plan the owner had just read disappeared at the moment it started to matter.

Running effects beside the screen needs more than a package command. A Ctrl+C typed into a foreground child (an agent, a shell, a Project Script) is a SIGINT to the terminal's whole foreground process group, the Desk's process included. Every interrupt boundary in the engine listened for it: the shared tracked-run watcher would abort any run in flight, supervised children would be signalled, and a Git child still in the Desk's group would receive the signal itself. And every engine narration path wrote to the process's stdout, across the screen the Desk paints.

## Decision

**A control that changes project state runs beside the screen.** Its registry effect decides: `change` controls (checks, Land, Queue, Update, Park, Reclaim, Retry setup, Drop, Rename, Pre-authorize, Revoke, and creating a task) run as package background commands; `launch` controls (agents, shells, editors, the pager, the manual, Project Scripts) keep the terminal as foreground commands. A creation that opens an agent straight after runs in the foreground, since the agent takes the terminal anyway.

**One funnel runs them.** [`runDeskEffectInSession`](../../../src/engine/desk/execution.ts) runs the reviewed flow's apply under three scopes: the `operation` interrupt source, an output capture routed to the operation's progress channel, and a completion observer. `executeDeskOperation` takes the session's signal as its external signal, so the shared executor, its operation journal, locks and recovery are exactly the CLI's.

**Signals stay with their owners.** Under the `operation` source no interrupt boundary installs a process-signal listener and the shared watcher does not track the run, so the operation's `AbortSignal` is its only interrupt; every child it spawns has non-inherited standard streams and leads its own process group; a terminal-owning child refuses ([subprocess boundaries](../50-engine-internals/subprocess-boundaries.md)). Foreground children keep the process source and `resumeAfterInterrupt`, so a Ctrl+C in a Project Script stops the script and the Desk resumes while a landing beside it goes on. In-session work stops only through the Quit sheet, a progress sheet's Stop, or the Desk's own termination: SIGTERM, SIGHUP, or SIGINT on its owned screen end the session, which aborts each operation's signal and lets its journal record where it stopped before the process re-raises.

**The plan the owner reviewed is the progress.** The executors report each plan step as it starts and settles ([plan steps](../70-reference/progress-and-reconnect.md#plan-steps)); the progress sheet shows the reviewed plan's steps in `STEP_HUMAN_LABELS` words, the active step's running time, finished durations, the operation's total against its usual duration, waits as they happen, and the queue walk under Then. Escape hides it while the row shows the run and its Enter reopens it. `o` reads the captured output. Stop appears only while stopping leaves nothing half done: checks, setup and task creation whenever, a landing until the trunk starts to move, nothing else. A failure turns an open progress sheet into its result sheet, with the captured output under Full output; a hidden one leaves a message.

**The session reports how each ran.** Session activity lists each command exactly as it ran, when and how it ended (done, didn't complete, or stopped), its message, and the last lines a change beside the screen wrote. At exit the terminal's own screen keeps one line per command with how it ended; a change still running then is stopped through its journal and listed as stopped.

**Parallel across tasks, one at a time per task.** Operations on different tasks run together; a task shows its run on its row and refuses a second until the first ends, and landings still serialize through the landing turn. Quitting while any runs asks first: **Keep waiting** is focused and **Quit anyway** stops each through its journal.

## Consequences

- The Desk lends its terminal only to children that own it, so the terminal's own screen holds what those children wrote and, at exit, the commands the session ran.
- An effect's human output reaches the Desk through the six registered process-output boundaries; a new direct write under `src/` fails the census, and one that bypassed the capture would write across the screen.
- An agent can open in a task while a discern verb runs there, which [ADR 0408](0408-project-code-holds-no-exclusion-boundary.md) already allowed and the old handoff made impossible.
- A landing's progress depends on its executors reporting steps; a quick step that reports nothing shows as passed once a later step reports, and the result envelope stays the authority on how each step ended.

## Alternatives considered

- **Keep effects in the foreground behind a handoff line.** Rejected: the owner loses the screen and the reviewed plan for every effect, and nothing else can happen meanwhile.
- **Refuse foreground children while an operation runs.** Considered as the fallback if signal isolation could not be proven; rejected because the interrupt source and process groups make the isolation provable, and a person should be able to open an agent while checks run.
- **Isolate only the gate's jobs.** Rejected: Git, ensure, smoke and metadata children are spawned by the same effects, and the shared watcher would still abort the whole operation on the foreground child's Ctrl+C.
- **Redirect the process's stdout for the duration.** Rejected: the package paints the screen through the same stream, and a scope-local capture at the registered boundaries reaches exactly the effect's own output.
