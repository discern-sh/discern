---
title: Licenses for project payloads
description: Which discern-authored material enters a project under Apache-2.0, what keeps its existing terms, and what redistribution requires.
order: 50
publish: true
aliases:
  - generated output license
  - emitted payload license
  - Apache-2.0
---

# Licenses for project payloads

_The license boundary for discern-authored material written into your project._

discern itself is Fair Source under [`FSL-1.1-ALv2`](../../../LICENSE). An installation also writes discern-authored material into your repository. Those portions are available immediately under the [Apache License, Version 2.0](../../../LICENSES/Apache-2.0.txt), so discern's Functional Source License does not extend into your project's own material.

The additional grant covers discern's setup skeletons, built-in guidance and skills, generated framing, and the entries or marked regions it maintains in shared configuration. [`NOTICE`](../../../NOTICE) states the legal scope and attribution.

Copyright and license follow authorship. Project guidance, map edits, brief text, environment values, neighboring configuration, authored skills, and third-party material keep their existing terms. Provider-local state receives no discern payload. User-selected documentation exports, Git-admin records, temporary output, the executable, the manual, and discern's source repository remain outside this grant.

Many destinations mix those sources. An agent file can combine built-in and project guidance. A provider config can combine discern's entry with the project's neighboring entries. Apache-2.0 applies only to the portions discern supplied.

The [Files & ownership](artifact-ownership.md#registered-project-paths) inventory derives its `Discern-authored portions` column from the same registry as the write boundary. Every non-provider-local entry receives the Apache-2.0 answer automatically. The guard uses a synthetic future entry to prove that a new registered destination receives the same answer without joining another list ([ADR 0240](../_adr/0240-discern-authored-project-payloads-use-apache-2-0.md)).

discern does not add a license file, notice, or legal header to your repository. If you redistribute discern-authored portions, you are responsible for the Apache-2.0 redistribution conditions, including giving recipients a copy of the license and preserving applicable notices. Run `discern licenses` to print discern's software license, the project-payload license, `NOTICE`, and notices for third-party software bundled into the binary.
