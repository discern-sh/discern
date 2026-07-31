# ADR 0237: discern ships under the Functional Source License with an Apache-2.0 future license

**Status**: accepted

## Context

discern's repository carried Apache-2.0 while private, and the project is approaching its first public release with no external users or contributors yet. The license has to serve two goals at once: keep the product free to adopt, inspect, and run — the trust surface the product depends on — and keep a commercial path open so stewardship can be funded for the long term. A permissive license forecloses the second, and retracting permissions after strangers have adopted under them breaks faith in a way no later generosity repairs. Pre-launch, with nobody depending on the current terms, is the one moment a license change costs nothing.

## Decision

discern is licensed under the Functional Source License, Version 1.1, with the Apache License, Version 2.0 as its future license (SPDX: `FSL-1.1-ALv2`). Anyone may use, copy, modify, and redistribute discern for any purpose except offering a competing commercial product or service; internal use, commercial included, is free, permanently. Each release irrevocably converts to Apache-2.0 on the second anniversary of that release.

The vocabulary follows the license. discern describes itself as "Fair Source" or "source-available". It is not described as "open source" until a release's conversion date passes, because until then the definition does not hold. `LICENSE` carries the canonical FSL text from the maintained template at fsl.software, `deno.json` declares the SPDX identifier, and `NOTICE` states that the files discern renders into a user's repository — compiled agent files, scaffolded configuration, materialized skills, and other generated outputs — belong to that repository, unencumbered by discern's license.

The explicit noes: no copyleft license, no closed source, and no marketing claim the license text cannot back.

## Consequences

- Every release carries a built-in openness guarantee: two years after it ships it is Apache-2.0, whatever happens to the project or its owner.
- Teams adopting discern for their own development, commercial teams included, are unaffected; only offering discern itself as a competing product or service is reserved.
- The project can offer commercial licenses over the same codebase, with no second edition and no license migration.
- An "open source" claim on the site, in the README, or in metadata is now a defect. The landing chip reads "Free and Fair Source", and the site test outlaws the retired phrase.
- Contribution terms need their own instrument, because inbound-equals-outbound no longer works when the project must license the work flexibly ([ADR 0238](0238-contributions-are-covered-by-a-cla.md)).

## Alternatives considered

- **Stay on Apache-2.0.** Rejected: it forecloses commercial licensing of the product itself, and the moment to change is before external users exist, not after.
- **A copyleft license such as AGPL-3.0.** Rejected: it burdens the users discern wants — companies adopting it internally — while doing little against a hosted competitor that never distributes.
- **BUSL-1.1.** Rejected in favor of FSL-1.1: the FSL is shorter, maintained, SPDX-registered, and fixes the conversion at two years per release instead of leaving the change license and date as parameters to negotiate.
- **Closed source.** Rejected: discern's adoption story depends on being inspectable and free to run, and its agents-read-everything design assumes users can audit what the tool does.
