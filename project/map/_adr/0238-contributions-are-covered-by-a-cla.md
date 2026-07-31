# ADR 0238: Contributions are covered by a contributor license agreement

**Status**: accepted

## Context

Under Apache-2.0 the contribution terms were inbound-equals-outbound: a Developer Certificate of Origin sign-off certified the right to submit, and contributions arrived under the license the project shipped. [ADR 0237](0237-ship-under-the-functional-source-license.md) breaks that symmetry. The project needs enough rights to distribute and commercially license the complete work; a DCO does not provide them.

The project has no external contributors yet, so it can establish the terms before contributor intake opens. Its first acceptance workflow depended on an archived action and broad exemptions, so the acceptance path also needs replacing.

## Decision

Every individual contributor accepts the agreement in root `CLA.md`. It gives the owner the non-exclusive rights the licensing model requires while contributors retain their copyright. The agreement itself, rather than this record, is the authority for its terms.

Individual acceptance uses SAP's hosted CLA Assistant and is recorded against an authenticated GitHub account and an immutable, numeric CLA version. Changing the agreement advances that version and requires acceptance again. The service has no owner, organization, contribution-size, or blanket bot exemption.

Employer-owned work also requires the separate corporate agreement in root `CCLA.md`, completed privately by an authorized representative. Each designated contributor still accepts the individual agreement. The contributor guide owns the privacy notice and intake instructions; the pull-request template points contributors to that guide. The DCO sign-off requirement is retired.

## Consequences

- The project can license the complete work without renegotiating with each contributor.
- An individual agrees once per CLA version through an authenticated service.
- Employer-owned work adds a private corporate-agreement step.
- Individual intake depends on the hosted service and cannot open until its acceptance path and records have been tested. Corporate intake cannot open until its private records path is active.

## Alternatives considered

- **Keep the DCO.** Rejected: it does not grant the rights the licensing model requires.
- **Copyright assignment.** Rejected: a non-exclusive grant is sufficient and leaves contributors' ownership intact.
- **Put the terms only in the contributor guide.** Rejected: explicit, recorded acceptance is clearer for both sides.
- **Keep the repository workflow.** Rejected: its action is archived and its permissions and exemptions are unnecessary with the hosted service.
- **Combine the individual and corporate agreements.** Rejected: the parties, acceptance paths, and revision lifecycles differ.
