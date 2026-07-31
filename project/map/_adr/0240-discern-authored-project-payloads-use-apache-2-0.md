# ADR 0240: Discern-authored project payloads use Apache-2.0

**Status**: accepted

## Context

discern itself ships under the Functional Source License with an Apache-2.0 future license ([ADR 0237](0237-ship-under-the-functional-source-license.md)). Installation also places discern-authored text and configuration into another repository: setup skeletons, built-in guidance and skills, generated framing, and maintained entries in shared files. Applying the Functional Source License to those portions would carry discern's product license into a user's project. The previous blanket statement that generated output was "unencumbered" avoided that outcome but did not identify a standard license or define the boundary precisely.

Many destinations mix authors. An agent file combines built-in and project guidance; a provider configuration combines discern's entry with neighboring project entries. File ownership already records which paths discern may edit or overwrite, but that operational contract does not decide copyright.

The grant also has to preserve discern's small project footprint. Writing legal files or headers into every installed repository would make the boundary visible at the cost of adding machinery users did not ask for.

## Decision

Discern-authored portions of every canonical project artifact are licensed immediately under the Apache License, Version 2.0. Project-authored, user-authored, provider-authored, and third-party portions keep their own terms. The grant does not apply to discern's executable, source repository, manual, or other material unless another notice says so.

The canonical project-artifact registry is the forcing function. Every non-provider-local entry receives the Apache-2.0 answer from the same rule, including configured worktree environment paths; a future registered destination joins without entering a second list. Provider-local state receives no grant because discern supplies no payload there. `NOTICE` scopes the grant, and `LICENSES/Apache-2.0.txt` carries the standard text.

File ownership remains operational vocabulary for edit and overwrite authority. It does not assign copyright or replace the authorship-based license boundary.

discern does not place a license file, notice, or legal header in user projects. Its own distribution carries the legal package, and `discern licenses` exposes it to an installed user. A person who redistributes discern-authored portions is responsible for satisfying Apache-2.0's redistribution conditions.

## Consequences

- Users can keep discern-authored project material, including built-in guidance and bundled skills, without waiting for the Functional Source License conversion date.
- Apache-2.0 preserves attribution and notice duties when those portions are redistributed.
- Mixed files need an authorship-aware reading: Apache-2.0 covers discern's portions, not neighboring project or third-party material.
- The project footprint stays unchanged. Redistribution compliance is discoverable through discern rather than materialized into every repository.
- Adding a project artifact to the canonical registry automatically gives discern-authored bytes at that destination the same license answer.

## Alternatives considered

- **Keep a bespoke generated-output exception.** Rejected: it invents a project-specific permission, leaves the covered set ambiguous, and asks recipients to interpret it instead of using a standard license.
- **Use 0BSD.** Rejected: it is simpler, but it would let the built-in guidance and skills be republished without attribution. Apache-2.0 keeps a familiar permissive grant while preserving notice duties.
- **Keep the Functional Source License on project payloads.** Rejected: it would make the product's commercial restriction relevant to material installed into an otherwise unrelated repository.
- **Materialize legal files or headers into every project.** Rejected: discern can make the terms available from its own distribution without expanding the installed footprint.
