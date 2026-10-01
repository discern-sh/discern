# ADR 0398: The Desk is a live human control panel

> **Amendments.**
>
> - **[ADR 0413](0413-the-desk-offers-each-tasks-next-decision.md) — next decisions:** tasks list by status's decision group, then title; each task opens on its row state's next step from the action registry; the Desk names landing Land…. Package ownership, bounded observation, revalidation, retained session state and the independence of activity, Proof, landing authority and submission remain in force.
> - **[ADR 0415](0415-the-desk-is-an-inbox-on-the-application-runtime.md) — the inbox:** one inbox session with a following inspector and modal layers replaces the pages, the two regions and Tab between them; the Desk keeps product state in a pure state machine and reads screen state only from the package. Bounded observation, revalidation and package ownership remain in force.
> - **[ADR 0420](0420-the-desk-is-an-inbox-with-a-following-inspector-and-modal-layers.md) — the screen:** supersedes the remaining presentation clauses: primary controls before evidence, details and secondary actions as separate routes, one active region with Tab on small terminals, and the quietly fitted tip. One focus owner, a content-sized split, a following read-only inspector, modal layers at most two deep, and an opt-in mouse replace them. Bounded observation, generation discards, revalidation at activation, cancellation that never authorizes a replacement, and the independence of activity, Proof, landing authority and submission remain in force.

**Status**: accepted on 2026-09-14; ordering, recommendation and the Accept name amended by [ADR 0413](0413-the-desk-offers-each-tasks-next-decision.md); pages, regions and Tab amended by [ADR 0415](0415-the-desk-is-an-inbox-on-the-application-runtime.md); remaining presentation superseded by [ADR 0420](0420-the-desk-is-an-inbox-with-a-following-inspector-and-modal-layers.md). Supersedes the transactional presentation and deferred persistence assumptions in [ADR 0119](0119-bare-discern-opens-the-operators-desk.md), the urgency grouping and recommendation policy in [ADR 0318](0318-the-desk-adapts-status-into-one-human-decision.md), and the exhaustive evidence boards and terminal-history assumptions in [ADR 0352](0352-desk-decisions-cross-a-pure-responsive-presentation-boundary.md). Their lifecycle, identity and consent contracts remain in force.

## Context

A person needs to recognize changing work and reach its controls without reading an agent's evidence inventory. A report followed by a picker loses controls above short viewports. Gathering the whole fleet's agents and scripts before selection also makes navigation wait for unrelated work. Urgency grouping conflates advisory overlap, Proof validity and permission.

## Decision

The normal Desk uses the public package application boundary established in [ADR 0397](0397-terminal-applications-and-test-transports-stay-package-owned.md). The package owns geometry, search editing, reading position, input, repainting and foreground restoration. Discern supplies immutable views and synchronous navigation over the last observation. It adds no terminal runtime or text editor.

The overview sorts by case-folded display title then stable identity. A selected task opens its primary controls before technical evidence. Details and secondary actions remain intentional routes. Overlap is advisory; no urgency ranking or recommended action is derived from it. Accept retains its product name. Activity, Proof, landing authority and the status-projected submission revision remain independent. Granting permission neither submits nor accepts work.

Background observations are bounded and coalesced. Expensive selected-task capabilities have their own single slot. Stale views remain useful after recoverable failure, with Retry. Generation checks discard obsolete completions. Effect activation captures identity, branch and path and observes authoritative state again before the existing plan/apply flow. Cancellation never authorizes a replacement target.

The session retains selection, filters, focus and reading position across updates, Back, resize and foreground return. The package chooses a surviving neighbor after removal; Discern describes only observed landing or checkout closure. One Tip is selected and recorded per session and fitted quietly, with a route to its full text.

## Consequences

Navigation continues while discovery is slow. Small terminals expose one active region with Tab access to the other, and the package owns the minimum-size notice. Current observations can be stale, so a menu cannot be authorization. Every effect pays for fresh validation.

Foreground actions use the shared executor under their own command identity. Bounded readers show plans, results, and Proof. Submission choices use the shared queue-only acceptance operation described in [ADR 0399](0399-acceptance-can-queue-without-starting-landing.md). The retired static renderers and priority model have no live fallback. The retained package source remains a development dependency through its assigned final integration stage; this decision does not authorize publication or landing.
