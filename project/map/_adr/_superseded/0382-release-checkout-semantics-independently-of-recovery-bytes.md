# ADR 0382: Release checkout semantics independently of recovery bytes

> **Superseded by [ADR 0389](../0389-the-workspace-contract.md).** Under the workspace contract no checkout is released, captured, or restored, so release identity and recovery-byte matching have no subject; the modules that owned them are removed.

**Status**: superseded by [ADR 0389](../0389-the-workspace-contract.md) on 2026-09-12; previously accepted. Amends [ADR 0378](../0378-landing-completion-survives-checkout-retirement.md).

## Context

A released checkout must preserve the author's source, local files and resources until an eligible actor claims or retires it. Recovery also needs the exact captured Git index. Git can refresh that index's cached file timestamps during a clean status check, including the final checks that record Proof. Those bytes can change while the checkout's source, staging and local data remain identical.

## Decision

Native checkout release identity binds the captured logical Git state and complete local file inventory, together with environment ownership, declaration, identity and resource restoration contract. It omits only the raw index bytes. Native capture continues to refuse index flags and layouts whose meaning it cannot preserve. Other workspace adapters keep their snapshot digest as the release identity.

Recovery artifacts retain the exact index bytes and their full snapshot digest. Release matching never substitutes a semantic digest for recovery verification. Older releases match only their original exact-byte subject; an unreadable or changed historical subject cannot acquire broader validity.

Completion finishes its source checks and retains its Proof presentation under checkout exclusion before publishing the author's release. An unsuccessful finalization retains authoring control. Changes to ignored files after release remain protected, just like other captured local data. Setup's optional ignored-file comparison is a separate advisory.

The `subjects.ts` module owned release identity and matching; `snapshot.ts` owned the captured Git semantics and unsupported-state refusals. Both were removed with the release model.

## Consequences

Read-only Git cache refreshes do not strand an otherwise eligible checkout. Recovery can still restore the exact state it captured. Supporting another index layout requires a restoration contract and release semantics together; removing unsupported-state refusals alone would weaken this boundary.

A legacy checkout whose exact release no longer matches stays retained for owner-led reconciliation. This decision does not rewrite historical releases or grant new cleanup authority.
