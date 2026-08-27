---
id: reference-licenses
title: "Licenses"
description: "Look up the license and provenance contract for discern-emitted project payloads."
order: 110
publish: true
kind: reference
aliases:
  - "reference-licenses"
  - "Licenses for project payloads"
  - "generated output license"
  - "emitted payload license"
  - "Apache-2.0"
redirect_from:
  - "/docs/reference/project-payload-license"
---

# Licenses

Look up the license and provenance contract for discern-emitted project payloads.

# Licenses for project payloads

_The license boundary for discern-authored material written into your project._

discern itself is Fair Source under [`FSL-1.1-ALv2`](https://github.com/jackwh/discern/tree/main/LICENSE). An installation also writes discern-authored material into your repository. Those portions are available immediately under the [Apache License, Version 2.0](https://github.com/jackwh/discern/blob/main/LICENSES/Apache-2.0.txt), so discern's Functional Source License does not extend into your project's own material.

The additional grant covers discern's setup skeletons, built-in instructions and skills, generated framing, and the entries or marked regions it maintains in shared configuration. [`NOTICE`](https://github.com/jackwh/discern/tree/main/NOTICE) states the legal scope and attribution.

Copyright and license follow authorship. Project instructions, map edits, brief text, environment values, neighboring configuration, authored skills, and third-party material keep their existing terms. Provider-local state receives no discern payload. User-selected documentation exports, Git-admin records, temporary output, the executable, the manual, and discern's source repository remain outside this grant.

Many destinations mix those sources. An agent file can combine built-in and project instructions. A provider config can combine discern's entry with the project's neighboring entries. Apache-2.0 applies only to the portions discern supplied.

The [Files and ownership](files-and-ownership.md#registered-project-paths) inventory derives its `Discern-authored portions` column from the same registry as the write boundary. The registry assigns the Apache-2.0 answer to every non-provider-local entry. A guard uses a synthetic future entry to verify that a new registered destination receives the same answer without joining another list ([ADR 0240](https://discern.sh/docs/decisions/0240-discern-authored-project-payloads-use-apache-2-0)).

discern does not add a license file, notice, or legal header to your repository. If you redistribute discern-authored portions, you are responsible for the Apache-2.0 redistribution conditions, including giving recipients a copy of the license and preserving applicable notices. Run `discern licenses` to print discern's software license, the project-payload license, `NOTICE`, and notices for third-party software bundled into the binary.
