# ADR 0375: Source authority survives declared composition

**Status**: accepted on 2026-09-05; implementation pending. Amends [ADR 0110](0110-the-landing-model.md), [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md), and [ADR 0247](0247-generated-artifacts-regenerate-never-merge.md).

## Context

A queue can prove a source revision against its expected predecessors before those predecessors land. The resulting commit differs from the author's source commit. Binding approval only to the original checkout tip prevents mechanical composition; treating every descendant as approved grants authority over unrelated additions.

Routine completion also needs to survive the original conversation. Required source, authority, and composition facts must therefore live in repository state.

## Decision

Consent covers the approved source revision integrated through the declared composition procedure with authorized predecessors. The source revision and candidate are separate identities.

Authority does not cover arbitrary descendants. The candidate must contain the recorded source revisions through the recorded procedure, with each predecessor covered by applicable authority. New authored edits and substantive conflict resolutions require new source evidence and authority. Approval of a successor never implies approval of its predecessor.

Declared generated outputs may be regenerated from the composed sources under the applicable generation rules. The Git composition and generated convergence remain separate commits. The resulting bytes must be present in the exact proven candidate. The generated-file merge driver alone provides no evidence of successful regeneration. Generator definitions and ownership declarations remain authored, protected inputs.

Landing authority, checkpoint judgment, checkpoint variance, and standard proposals remain distinct decisions. A grant cannot manufacture a judgment, approve an unmet variance, or approve a standard proposal. Changed review subjects are re-evaluated. Exact approved tuples and their applicable predecessor policy remain recorded.

An effort can resume from durable source, candidate, authority, and recovery records. A replacement session requires no fact held only in its predecessor's conversation. An executor may carry out a recorded decision; it cannot infer an unrecorded one.

## Consequences

- A new composition can require new validation without requiring a repeated source approval.
- Revocation, changed sources, changed judgment subjects, and conflict edits invalidate the relevant eligibility.
- A real source dependency cannot be skipped to promote an approved successor.
- Standard failures against a predecessor's tighter policy use the owner's proposal mechanism. Revising an unlanded pin is another explicit owner decision. Scheduling cannot select a permissive order to evade policy.
- Source authorship, approving authority, and executing actor remain separately attributable.
