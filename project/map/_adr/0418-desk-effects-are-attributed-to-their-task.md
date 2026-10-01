# ADR 0418: Desk effects are attributed to their task

**Status**: accepted; extends [ADR 0160](0160-local-logbook-advisory-readers.md) (which invocations the logbook records) and builds on [ADR 0417](0417-desk-owned-effects-run-in-session.md) (Desk effects run in session)

## Context

The logbook recorded one event for a whole Desk session: the `desk` invocation itself. A gate, a landing, or a park the owner ran from the Desk left no begin event on the task's branch while it ran and no verb event when it ended. Status derives a row's running verb, its last action and its last activity from those per-branch events, so a second Desk, `discern status`, and the Desk's own next survey all showed the task as idle while the Desk ran its checks, and as unchanged afterwards. The owner's own work was the one activity the fleet could not see.

## Decision

**Every Desk effect records through the shared recorder.** `executeDeskOperation` begins a recording in the task's checkout, the same `beginRecording` the CLI action wrapper and the MCP server use: a begin event as the effect starts, with the operation registry's exclusion boundary, and a verb event when it ends, with the effect's result envelope, duration and outcome. Desk events carry surface `cli` and the driver session `desk`, so a reader can tell them apart without a new surface.

**A Desk-started effect looks like any other run.** The begin event lands on the task's branch, so status and a second Desk see the gate or landing running with the verb's usual duration, and the verb event becomes the row's last action exactly as the CLI's would.

**Reads and previews record nothing.** The Desk's surveys, evidence reads and review previews never pass through the recorder, so they are never activity and never a duration sample. A dry-run invocation through the executor, such as the queue preview, records nothing either.

**Sessions are activity, not runs.** An agent, shell or editor session the Desk opens records its begin and verb events like an effect, so the row's last activity moves when the owner works there. Status leaves an open session out of the running verb: nothing waits for it, and no action is refused because one is open. Its verb event is `ok` whatever the child's exit status, since a shell's last command says nothing about the task.

## Consequences

- Rows reflect what the owner just did: a Desk-started gate shows as running, then passed or failed, to every reader of status.
- Duration priors gain real samples from Desk runs of the same verbs, never from previews or sessions.
- Concurrent Desk effects share the process-wide checkpoint and merge observation mailboxes; an observation can attach to a sibling effect's event. These observations stay advisory, as on the long-lived MCP server.
- An interactive session's events count as last activity, so a task's age reads from when its agent last opened.

## Alternatives considered

- **A new `desk` logbook surface.** Rejected: the surface enum is part of the on-disk format, older readers would refuse the events, and the driver session already separates them.
- **Record only the verb event.** Rejected: without the begin event a second observer cannot see the run while it lasts, which is the case the owner asked for.
- **Treat an open session as a running verb.** Rejected: it would make a row read as running for as long as an agent stays open, and refuse other actions on the task for no reason the checkout has.
