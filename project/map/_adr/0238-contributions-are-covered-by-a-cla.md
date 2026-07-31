# ADR 0238: Contributions are covered by a contributor license agreement

**Status**: accepted

## Context

Under Apache-2.0 the contribution terms were inbound-equals-outbound: a Developer Certificate of Origin sign-off certified the right to submit, and every contribution arrived under the same license the project shipped. [ADR 0237](0237-ship-under-the-functional-source-license.md) breaks that symmetry. The project now distributes under the Functional Source License, publishes each release's Apache-2.0 conversion two years on, and must be able to offer commercial terms over the whole work. A DCO grants none of the rights that model needs: it certifies provenance, and it says nothing about licensing the work under other terms. AI-assisted contributions also raise a provenance question the DCO's 2004 text never contemplated.

The project has no external contributors yet, so the agreement can be set before anyone's terms change midstream.

## Decision

Every contribution is covered by a contributor license agreement, recorded in `CLA.md` at the repository root: an individual agreement, plus a corporate agreement for work an employer owns. Both adapt The Apache Software Foundation's ICLA v2.2 and CCLA, with three substantive changes:

- the grant runs to the project's owner and the owner's successors and assigns, so the project can pass to a legal entity without re-papering every contribution;
- the copyright license spells out sublicensing, relicensing, dual licensing, and commercial licensing of the work;
- the provenance representation covers AI-assisted output: the contributor directed and reviewed it and is entitled to submit it.

Contributors keep their copyright, and the grant is non-exclusive. A plain-English preamble states the purpose before the terms. Signatures are collected by the CLA assistant workflow on a contributor's first pull request and recorded in the repository. The DCO sign-off requirement is retired, and the pull-request template's attestation points at the CLA.

The explicit noes: no copyright assignment — contributors keep ownership — and no bespoke legal language where an established template serves.

## Consequences

- The project can license the complete work, the owner's code and contributions alike, under the FSL, the Apache-2.0 conversions, and commercial terms, without per-contributor renegotiation.
- Contributing gains a one-time signature step; per-commit sign-offs disappear.
- A contribution owned by an employer needs the corporate agreement signed — heavier than a DCO, and the real price of the licensing model.
- The CLA's stated purpose constrains the owner too: the preamble and the non-exclusive grant are public commitments any future licensing change has to honor.

## Alternatives considered

- **Keep the DCO.** Rejected: it certifies the right to submit and grants nothing beyond it — insufficient for future conversions and commercial terms.
- **Copyright assignment.** Rejected: taking ownership of community work is a heavier ask than the model requires; a broad non-exclusive grant suffices.
- **License-back terms buried in CONTRIBUTING.** Rejected: a grant nobody explicitly signs invites disputes; a short signed agreement is clearer for both sides.
