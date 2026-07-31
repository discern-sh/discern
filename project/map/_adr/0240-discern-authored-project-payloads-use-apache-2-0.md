# ADR 0240: Discern-authored project payloads use Apache-2.0

**Status**: accepted

## Context

discern itself ships under the Functional Source License with an Apache-2.0 future license ([ADR 0237](0237-ship-under-the-functional-source-license.md)), but installation also places discern-authored material into user repositories. Applying the product license there would burden unrelated projects. The previous promise that generated output was "unencumbered" avoided that result without defining either a standard license or a precise boundary.

The boundary must also work for mixed-author files and preserve discern's small installed footprint.

## Decision

Discern-authored portions of every canonical project artifact are licensed immediately under the Apache License, Version 2.0. Other authors' portions keep their own terms. `NOTICE` defines the scope and `LICENSES/Apache-2.0.txt` carries the license text.

The canonical project-artifact registry is the forcing function: registering a destination gives discern-authored material there the same answer without maintaining a second list. Provider-local state is excluded because discern supplies no payload there. File ownership remains a separate operational classification.

discern does not add legal files or headers to user projects. The terms ship with discern and remain available through `discern licenses`.

## Consequences

- Users can keep discern-authored project material without waiting for the Functional Source License conversion date.
- Apache-2.0 preserves attribution when that material is redistributed.
- In mixed files, the grant covers only discern-authored portions.
- The installed footprint stays unchanged, and future registered project artifacts inherit the same treatment automatically.

## Alternatives considered

- **Keep a bespoke exception.** Rejected: a standard license gives recipients a clearer answer.
- **Use 0BSD.** Rejected: Apache-2.0 preserves attribution for built-in guidance and skills.
- **Keep the Functional Source License.** Rejected: its product restriction should not follow installed material into another project.
- **Add legal files to every project.** Rejected: the terms can remain discoverable without expanding the installed footprint.
