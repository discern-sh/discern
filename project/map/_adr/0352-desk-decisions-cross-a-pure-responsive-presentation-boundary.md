# ADR 0352: Desk decisions cross a pure responsive presentation boundary

> **Amendments.**
>
> - **[ADR 0398](0398-the-desk-is-a-live-human-control-panel.md) — presentation:** supersedes urgency grouping, recommendations, the transactional list/pick loop and scrollback-dependent boards with a bounded live application. Lifecycle truth, identity, action safety and consent remain in force.

**Status**: presentation superseded by [ADR 0398](0398-the-desk-is-a-live-human-control-panel.md); lifecycle and consent contracts retained. Extends the external terminal boundary from [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md), the Desk's canonical decision model from [ADR 0318](0318-the-desk-adapts-status-into-one-human-decision.md), and the human advisory channel from [ADR 0234](0234-tips-are-the-desks-human-advisory-channel.md).

## Context

The Desk's interactive loop previously owned status mapping, row padding, ANSI treatment, and output effects together. Root rows padded every task to the longest JavaScript string length. One long or wide-character title could push state beyond the terminal, while headings, orphan facts, action labels, and confirmations had no shared width policy. The selected task competed with a permanently strong `Start a task` treatment, and decision-bearing summaries could be dim-only.

The canonical Desk decision now carries state, headline, activity, Proof, landing authority, collisions, action availability, and one recommended action. The design-system CLI package owns terminal capabilities, text measurement, wrapping, truncation, semantic roles, Component frames, and interaction fitting. A product boundary is still required between those authorities: it chooses which decided facts belong on the triage board, which belong in task detail, and how the composition responds to a live viewport.

## Decision

`src/engine/desk/view.ts` (retired) is the Desk's pure product presentation boundary. It accepts complete `DeskDecision` and `DeskBoardDecision` values, action offers, an explicit terminal context, and an explicit viewport. It maps those values into public design-system Components and selection entries. It performs no process observation, filesystem reads, effects, action-legality checks, or status classification. [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts) retains surveys, prompts, dispatch, and lifecycle effects.

The root board is a triage queue. It shows project and main-checkout state, task totals, counts needing a person or ready to review, static refresh age, and bounded fleet notices. Tasks follow canonical human-decision order. Each row carries its display title, headline, one relevant detail, and its recommended action when space permits. Desk and session commands occupy separate groups.

The product breakpoints are 96 columns for the three-column task/state/activity-or-action row, 56 columns for the two-column task/state row, and a stacked row below 56. Every row receives its own bounded width; fleet-wide title padding is forbidden. Package descriptions carry secondary facts. Truncation always has the selected task's full-detail route.

Task detail precedes the action picker. It shows the full display title and decision headline, then semantic evidence groups for location, activity, Git facts, landing authority, collisions, containment, and agent or Project Script availability. The Proof section carries currency and the recorded line. Empty evidence groups do not render.

Static composition retains at most one third of the live terminal height. The package interaction fitter owns exact measurement of the remaining prompt, groups, descriptions, options, overflow cues, and key help. This policy keeps the board visible on ordinary screens and lets short screens scroll earlier static evidence into terminal history so the active picker remains coherent.

Focus belongs to the active interaction item. Color adds semantic roles while explicit group and state wording remains the authority in no-color and ASCII modes. The brand mark and accents remain present without competing with focus or decision state.

A worktree path may preserve display characters that Git's internal worktree key removes. The richer path basename supplies the display label only when the canonical identity sanitizer proves it resolves to the status-reported id. A mismatched path cannot rename the task.

## Consequences

- A view change can alter hierarchy or breakpoints without changing orchestration or lifecycle effects. A model change must supply any new meaning before the view can present it.
- Discern contains no second ANSI palette, Unicode-width implementation, wrapping algorithm, or copied Component frame for the Desk.
- Long titles remain bounded even on wide boards because state and next action retain their columns. Task detail preserves the complete identity.
- Short task-detail screens place earlier evidence in terminal history. The current package-backed prompt flow remains unchanged; pinned headers and a custom input loop remain separate work.
- Real-terminal journeys cover 40, 60, 80, and 120 columns; short and tall heights; 0, 1, 9, and 50 tasks; long ASCII and Unicode display; live resize; color, no-color, and ASCII output; unique focus; and width after ANSI projection.
- The presentation boundary adds one module and focused tests. That indirection is intentional because it prevents product composition, process observation, and semantic classification from recombining in the interactive loop.

## Alternatives considered

- **Keep presentation in the interactive loop.** Rejected because prompts and effects would continue to obscure the pure decision-to-Component mapping and make responsive tests require orchestration fixtures.
- **Render every status fact in every root row.** Rejected because routine fleet scans become a wall of repeated evidence. Selection supplies the complete-detail route.
- **Align every row to the fleet's longest title.** Rejected because one member would continue to determine every other member's available state width.
- **Maintain local ANSI styles and width helpers.** Rejected because those capabilities already belong to the adopted package and would drift across terminal modes.
- **Reserve every static preamble row.** Rejected because a wrapped detail frame can leave too little height for a coherent interaction. The bounded retention policy preserves both evidence and a usable picker through the terminal's native history.
