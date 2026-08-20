# ADR 0306: Status defaults to a bounded orientation projection

**Status**: accepted

## Context

`statusResult` observes complete local and fleet state once, then the terminal, JSON, Markdown, resource, and Model Context Protocol (MCP) surfaces project that result. The structured projection removed repeated Proof pages, but it retained every fleet row and every repeated collection. Its size therefore grew with unrelated efforts. MCP hosts that expose both authored Markdown and `structuredContent` charged the caller for both representations.

Fleet maintenance hints also shared the `next-step` category with actions for the current effort. A stale, dirty, broken, unreadable, review-ready, or authorized sibling could therefore occupy the final action position. Landing and discarding remain owner decisions, and one effort's agent must not adopt another effort's worktree.

## Decision

**Structured status defaults to a bounded agent-orientation projection, with one explicit full-detail mode. Cross-effort decisions have their own owner-attention channel.**

- `statusResult` continues to observe the complete state. The shared status wire projector is the single policy for CLI JSON, MCP `structuredContent`, and the live status resource.
- The default projection caps every repeated collection at six. Fleet keeps the main row plus six non-main samples. `data.fleet_total` records the complete non-main count, and `data.projection.omitted` records every hidden remainder. Landing history is full-detail evidence and stays out of orientation.
- `discern status --verbose --json` and `discern_status` with `verbose: true` select `data.projection.mode = "full"`. Default results advertise the appropriate command or tool call in `hints`. Full structured status restores complete collections and landing history while retaining the wire boundary's compact Proof facts; rendered Proof pages remain a terminal concern.
- `owner-attention` is a registered hint category. Cross-effort lifecycle judgments route through a checked `fireOwnerAttention` seam, so a newly added sibling hint cannot be emitted there while classified as the caller's `next-step`.
- Authored Markdown orders the optional sections as current state, evidence, authority and boundaries, Owner attention, Other actions, then Next action. The immediate caller action remains at the context tail without the labels “Later” or “Do this next”.

## Consequences

- Routine orientation has a stable context cost even as the fleet and configured sets grow. Exact totals survive sampling, so the bounded view never implies that the sample is complete.
- Agents see sibling conditions without receiving authority to land, discard, resume, or otherwise maintain those efforts. The Desk and interactive terminal keep their human action routes.
- Consumers that depended on complete default status collections must request verbose structured detail. The projection mode makes that choice inspectable.
- A deliberately requested full MCP result can still be large and can still arrive beside Markdown. That cost is explicit rather than paid by every session.

## Alternatives considered

- **Bound only MCP.** Rejected: CLI JSON, MCP, and the live resource would acquire separate contracts for the same result.
- **Remove fleet evidence from agent status.** Rejected: collisions, ownership, and worktree continuity are orientation facts; a bounded sample plus exact totals preserves them.
- **Keep owner decisions as next steps with softer wording.** Rejected: presentation order still turns the first next-step hint into the caller's immediate instruction.
