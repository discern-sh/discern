# ADR 0238: Contributions are covered by a contributor license agreement

**Status**: accepted

## Context

Under Apache-2.0 the contribution terms were inbound-equals-outbound: a Developer Certificate of Origin sign-off certified the right to submit, and every contribution arrived under the same license the project shipped. [ADR 0237](0237-ship-under-the-functional-source-license.md) breaks that symmetry. The project now distributes each version under the Functional Source License, grants that version an Apache-2.0 license on the second anniversary of the date it was first made available, and must be able to offer commercial terms over the whole work. A DCO certifies provenance but grants none of the additional rights that model needs. AI-assisted contributions also raise a provenance question the DCO's 2004 text never contemplated.

The project has no external contributors yet. It can establish the agreement and acceptance path before anyone relies on different terms. The first automation draft used the archived `contributor-assistant/github-action`, wrote acceptances to a repository branch, reacted to exact issue comments, and exempted the owner plus every `bot*` account.

## Decision

Every contributor accepts the individual agreement in root `CLA.md`. It adapts The Apache Software Foundation's Individual Contributor License Agreement, version 2.2. The grant runs to Jack Webb-Heller and a successor or permitted assign that acquires all or substantially all of Jack Webb-Heller's rights in the Work. It permits sublicensing, relicensing, dual licensing, and commercial licensing, and covers AI-assisted provenance. Contributors retain any copyright they hold in their Contributions. The grant is non-exclusive and makes no copyright assignment.

Individual acceptance uses SAP's hosted CLA Assistant. Its form records this affirmation through the contributor's authenticated GitHub account:

> I have read and agreed to the discern Contributor License Agreement, version 1.0

The hosted payload contains byte-for-byte copies of root `CLA.md` and the generated `.github/cla-assistant/metadata` file. A numeric version identifies one immutable byte sequence. Any byte change advances the agreement version and requires acceptance again. The repository runs no privileged CLA workflow and keeps no acceptance ledger. There is no owner, organization, contribution-size, or blanket bot exemption.

An individual's acceptance cannot bind an employer. Root `CCLA.md` is therefore a separate corporate agreement, adapted from the Apache corporate agreement. It covers only the named entity, requires sufficient authority to grant every license, and requires an authorized representative's signature. Corporate details and signatures use a private route and never appear in an issue, pull request, or hosted Gist. Each designated contributor still accepts the individual agreement.

The contributor guide carries the privacy notice for both paths. CLA Assistant links directly to that section. The pull-request template asks contributors to read and follow the guide; the legal acceptance remains in CLA Assistant.

The DCO sign-off requirement is retired.

## Consequences

- The project can license the complete work under the Functional Source License, each version's Apache-2.0 future license, and commercial terms without per-contributor renegotiation.
- An individual agrees once per byte-pinned CLA version through an authenticated service.
- A contribution owned by an employer needs the contributor's individual acceptance and a privately executed corporate agreement.
- The hosted service is an external dependency and stores the acceptance ledger. Before contributor intake opens, the owner must publish the two-file Gist, link the repository, configure its privacy link, leave all exemptions empty, test the full acceptance path, make its status required, and retain ledger exports.
- Corporate intake remains closed until its private mailbox and storage path are active and documented.

## Alternatives considered

- **Keep the DCO.** Rejected: it certifies the right to submit and grants nothing beyond it, which is insufficient for future-license and commercial terms.
- **Copyright assignment.** Rejected: taking ownership of copyright a contributor holds is a heavier ask than the model requires. A broad non-exclusive grant suffices.
- **License-back terms buried in CONTRIBUTING.** Rejected: a grant nobody explicitly accepts invites disputes. A versioned agreement with an authenticated acceptance record is clearer for both sides.
- **Keep the repository workflow and signatures branch.** Rejected: the action is archived, the workflow needs elevated permissions, and its broad exemptions weaken the rule.
- **Combine the individual and corporate agreements.** Rejected: they have different parties, acceptance methods, and revision lifecycles. A corporate-only change must not force every individual contributor to agree again.
