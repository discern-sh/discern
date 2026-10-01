# ADR 0415: The Desk is an inbox on the application runtime

**Status**: accepted; amends [ADR 0398](0398-the-desk-is-a-live-human-control-panel.md) (its pages, regions and Tab between them) and puts [ADR 0413](0413-the-desk-offers-each-tasks-next-decision.md)'s next decisions in an inbox

## Context

The Desk was a stack of pages over the package's first application: an overview with a task list and `Desk commands`, then **Task controls**, **More actions**, **Task details** and readers, with Tab between two regions and Back between pages. Effects ran behind selection prompts and sequential forms that left the application. The page stack, the focus each page remembered and the routes between them were product code, so the Desk tracked selection, scroll and focus that the package also tracked.

The package's application model now owns a grouped list with a following detail, an empty state, a message line, key hints, and modal layers (sheets, menus, a palette, forms, readers) with a dismissal handshake: a view supplied inside a callback applies before the next key is decoded, and a layer disappears only when the caller's view stops declaring it. That model can hold the whole Desk on one screen.

## Decision

The Desk is one inbox session on the package's application runtime. The list groups tasks by status's decisions, and the inspector follows the selection without taking focus, so no key needs Tab to reach a task's facts or controls.

**Product state is the Desk's; screen state is the package's.** The package owns selection, focus, scroll, folds, zoom, filtering, field editing, message timing and painting. The Desk owns a pure state machine, `deskProduct(state, event) → { state, effects }`, over the latest observation, the layers that exist with their product subjects, pending reads, messages, preferences and the session's activity. Each package callback becomes one event and returns the next view synchronously; the Desk reads the package's state only from `context.state` and never stores it.

**Only the owner opens and closes a layer.** An observation never adds or removes one. A layer whose subject leaves the inbox says so: a menu offers nothing and names why, a review sheet turns `gone` with only its safe button, and a form's confirm stays disabled. A menu, the palette and the agent picker only route, so what they open replaces them; launcher layers close when their child starts, and readers and forms that lend the terminal survive it. The Desk's layer depth equals the package's.

**Observation is bounded.** One status survey runs at a time; a refresh during one queues exactly one follow-up, and the next survey starts five seconds after the last finishes. One failure reads Retrying; a second reads Offline with a persistent warning the owner may close, and the last good rows stay. A survey's generation must match the one requested.

**The selected item has one evidence slot.** Once the selection rests for 150 ms, the Desk reads that item's tier-two evidence (at most three Git reads, each with a two-second timeout, and the retained record of a failed run) beside its agent and script discovery. Results are kept per item, keyed by the head, the trunk head and the dirty stamp, for the 32 most recently used items.

**Reading is in session; effects lend the terminal.** Readers and the inspector paint from the last observation. A mutating action opens a review sheet that paints at once, reads its plan, and opens on its safe choice; its confirm returns a foreground command whose handoff line is painted before the effect takes the terminal through the shared executor. The return re-surveys, names what the child changed, and opens a result reader when the effect failed at length.

**Text reaches the view through one boundary.** Every single-line slot of a built view passes through the Desk's text module, except Markdown sources and multi-line field values, so observed line breaks and control characters can never fail the view's validation.

Repository preferences gain the mouse, details, sort and folded groups; version-one records keep their agent and drop their creation path.

## Consequences

The page stack, its focus memory and the per-page renderers are gone; a task's actions are a menu, Desk commands are a palette, and every registered key the key map gives an action now reaches it from the inbox. Behavior tests drive the real runtime on a fake terminal and a manual clock, and the state machine is tested event by event; real-terminal journeys wait on the package's state reports rather than prose.

Some generic needs are package requests with Desk-local workarounds: a section whose blocks render nothing still draws its heading, the content-sized split can drop a column it was sized for, and the lone-Escape window is not on the injected clock. Review sheets carry the existing plans and consequence lines; their content is not yet rebuilt around per-line sources.

## Alternatives considered

- **Keep the page stack on the new runtime.** Rejected: it would keep a second owner of focus and selection and the Tab route the inbox removes.
- **Let the Desk track selection and focus.** Rejected: the package already owns them, and two owners drift.
- **Sanitize text at each slot.** Rejected: a view has hundreds of slots fed by observed text; one boundary cannot miss one.
