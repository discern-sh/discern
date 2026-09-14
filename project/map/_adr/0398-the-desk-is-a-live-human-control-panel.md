# ADR 0398: The Desk is a live human control panel

**Status**: accepted on 2026-09-14. Supersedes the transactional presentation and deferred persistence assumptions in [ADR 0119](0119-bare-discern-opens-the-operators-desk.md), the urgency grouping and recommendation policy in [ADR 0318](0318-the-desk-adapts-status-into-one-human-decision.md), and the exhaustive evidence boards and terminal-history assumptions in [ADR 0352](0352-desk-decisions-cross-a-pure-responsive-presentation-boundary.md). Their lifecycle, identity and consent contracts remain in force.

## Context

A person needs to recognize changing work and reach its controls without reading an agent's evidence inventory. A report followed by a picker loses controls above short viewports. Gathering the whole fleet's agents and scripts before selection also makes navigation wait for unrelated work. Urgency grouping conflates advisory overlap, Proof validity and permission.

## Decision

The normal Desk uses the public package application boundary established in [ADR 0397](0397-terminal-applications-and-test-transports-stay-package-owned.md). The package owns geometry, search editing, reading position, input, repainting and foreground restoration. Discern supplies immutable views and synchronous navigation over the last observation. It adds no terminal runtime or text editor.

The overview sorts by case-folded display title then stable identity. A selected task opens its primary controls before technical evidence. Details and secondary actions remain intentional routes. Overlap is advisory; no urgency ranking or recommended action is derived from it. Accept retains its product name. Activity, Proof, landing authority and the status-projected submission revision remain independent. Granting permission neither submits nor accepts work.

Background observations are bounded and coalesced. Expensive selected-task capabilities have their own single slot. Stale views remain useful after recoverable failure, with Retry. Generation checks discard obsolete completions. Effect activation captures identity, branch and path and observes authoritative state again before the existing plan/apply flow. Cancellation never authorizes a replacement target.

The session retains selection, filters, focus and reading position across updates, Back, resize and foreground return. The package chooses a surviving neighbor after removal; Discern describes only observed landing or checkout closure. One Tip is selected and recorded per session and fitted quietly, with a route to its full text.

## Consequences

Navigation continues while discovery is slow. Small terminals expose one active region with Tab access to the other, and the package owns the minimum-size notice. Current observations can be stale, so a menu cannot be authorization. Every effect pays for fresh validation.

Foreground action bodies retain their existing contracts while the serial programme refines their presentation and shared execution. Submission choices belong to that later stage. The retained package source remains a development dependency through its assigned final integration stage; this decision does not authorize publication or landing.
