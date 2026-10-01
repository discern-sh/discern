# ADR 0420: The Desk is an inbox with a following inspector and modal layers

**Status**: accepted; supersedes the remaining presentation clauses of [ADR 0398](0398-the-desk-is-a-live-human-control-panel.md) and completes the screen [ADR 0415](0415-the-desk-is-an-inbox-on-the-application-runtime.md) moved onto the application runtime; amends [ADR 0399](0399-acceptance-can-queue-without-starting-landing.md) (what queueing asks and says), [ADR 0234](0234-tips-are-the-desks-human-advisory-channel.md) (where the tip appears), [ADR 0151](0151-the-desk-starts-tasks-and-opens-agents.md) and [ADR 0157](0157-the-desk-owns-launched-child-sessions.md) (how a task starts)

## Context

ADR 0398 described a control panel of pages: a selected task opened its primary controls before its evidence, details and secondary actions were intentional routes, a small terminal showed one active region with Tab to reach the other, and a tip line was fitted quietly into the header. ADR 0413 replaced its ordering and its refusal to recommend, and ADR 0415 replaced its page stack with one session on the package's application runtime. What the screen is made of, and how a person reaches each part of it, was still described piecemeal: by 0398 clauses that no longer held, by the package's own rules, and by the Desk's code.

The redesign settled those questions together. The owner reads the inbox to find what needs them, acts on one task, and returns. Each of the three moves must work from the list without a mode switch, at every terminal size down to the package minimum, with the keyboard alone, and with a pointer when the owner wants one.

## Decision

**One focus owner; Tab is never required.** The list holds focus on the inbox. The inspector follows the selection and never takes focus, so a task's facts need no key at all. Enter runs the selected task's next step; `.` or Right opens its **Actions** menu; Ctrl+K or `:` opens the command palette; Space zooms the inspector to fill the body; `?` opens the keys reader. Tab moves between groups and never between regions. While a layer is open it owns every key and the inbox recedes beneath it; Escape closes the top layer, or clears the filter, and never quits.

**The list sizes itself to its content.** A master-detail inbox gives the list the width its titles and fixed columns need, clamped between the package's minimum list width and the inspector's minimum. When a title would fall below its minimum, columns drop by declared priority, the overlap flag first and then the age; the state label never drops. Below the split width the list takes the full width and a summary strip under it carries the selection's headline facts, with Space to zoom. Quieter groups fold first on a short screen; Ready for review and Needs attention never fold. The package's 32 by 10 minimum is the Desk's: below it the screen says how much room it needs, and Quit still answers.

**The inspector is read-only and complete.** It shows the selection's state and status's explanation, then the facts status keeps separate (checks, main, landing, queue, changes, overlaps, setup, the last error), the next step and its keyed alternatives on wide screens and in zoom, and the selected item's evidence once the selection rests. The same blocks build the strip, the zoom and the inspector, so a narrow screen loses room, never a fact.

**Everything else is a modal layer, at most two deep.** A menu lists a task's actions in reading order with their keys, the next step highlighted and unavailable actions folded with their reasons. The palette lists what needs the owner, then every Desk command by section, then every task and parked branch to go to. Sheets review, show progress and report results; forms collect values and preview what confirming does; readers show the queue, the main checkout, recovery steps, changes and the session's activity. A menu, the palette and the agent picker only route, so whatever they open replaces them, and a review never sits two routes deep. The manual opens as the package's Markdown browser nested on the same screen ([ADR 0419](0419-the-manual-opens-inside-the-desk-session.md)).

**Product state is the Desk's; screen state is the package's.** Restating ADR 0415's split as the presentation's rule: the package owns selection, focus, scroll, folds, zoom, filtering, field values, read progress and painting, and the Desk never stores them. The dismissal handshake keeps one owner of each layer: a view returned inside a callback applies before the next key is decoded, and a layer leaves the screen only when the Desk's view stops declaring it. An observation never opens or closes a layer.

**The footer has two clusters.** The left cluster is the selection's next step and its keyed alternatives, and it drops first on a narrow screen; **Actions** (`.`) and **Commands** (Ctrl+K) stay pinned on the right at every width. The message line between the body and the footer carries toasts, persistent warnings, and the tip.

**The mouse is the owner's opt-in.** Pointer input is off by default. The palette's mouse toggle turns it on for the repository, and the Desk remembers the choice with its other preferences. While it is on, clicks select and activate, the wheel scrolls, a confirm button takes two clicks, and Shift-drag selects terminal text.

### Amendment to ADR 0399

The Desk names the action **Queue for landing…**. When unattended landing needs permission, it asks the grant question first as its own confirmed review, and Keep there queues nothing. The queue review says the queued version lands with any landing, or when the owner chooses Land…, and that nothing starts now. The grant review says the grant covers later versions whose checks pass and ends when the task lands, is parked or is dropped. Queue admission still records no exception and starts no walk.

### Amendment to ADR 0234

The tip appears on the message line of the first frame that has the fleet's survey, and the first key dismisses it. For the rest of the session **Tip of the session**, in the palette's Help section, opens it in full. One tip is still chosen and recorded per session.

### Amendment to ADR 0151 and ADR 0157

**New task…**, **Start follow-up…** and **Resume…** are forms inside the Desk session: the title and options are fields, the preview is the start core's own dry run, and Create applies that plan and selects the new task once a survey lists it. The session marker, the refusal of a nested Desk, and the rule that the Desk runs from the main checkout are unchanged.

## Consequences

- Every registered key reaches its action from the inbox, and the inbox, its footer, the keys reader and the manual's Key column project one key map.
- The screen has one layout per size tier, so the gallery and the geometry tests pin each tier rather than each page.
- A task's actions and the Desk's commands take one more keystroke than a page of buttons did; the next step stays one key, Enter.
- Behaviour that 0398 placed in the Desk (where focus goes after a removal, how a region scrolls, what a folded group says) now follows the package's rules, and changes with the package's releases rather than the Desk's code.
- Terminals without pointer support lose nothing, and the pointer never becomes the only way to reach a control.

## Alternatives considered

- **Keep a page per task.** Rejected: it hides the inbox while the owner acts, and every return costs a route back.
- **Two regions that each take focus, with Tab between them.** Rejected: a second focus owner is a second place for keys to mean something, and it made the inspector a destination instead of a view.
- **A fixed split, such as half the width each.** Rejected: short titles waste the inspector's room, and long ones lose their columns.
- **Mouse on by default.** Rejected: pointer reporting takes over the terminal's own text selection, which owners use to copy commands from the Desk.
