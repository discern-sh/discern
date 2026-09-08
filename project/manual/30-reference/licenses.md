---
id: reference-licenses
title: "Licenses"
description: "Check the licenses for files discern adds to your project and what you need to keep when sharing them."
order: 90
publish: true
kind: reference
aliases:
  - "reference-licenses"
  - "Licenses for project payloads"
  - "generated output license"
  - "emitted payload license"
  - "Apache-2.0"
---

# Licenses

The material discern adds to your project has a different license from discern itself. This page explains which terms apply to each part, so you can identify what you are using or redistributing.

## What goes into your project

The portions discern supplies are available immediately under the [Apache License, Version 2.0](https://github.com/jackwh/discern/blob/main/LICENSES/Apache-2.0.txt). These include setup scaffolding, built-in instructions and skills, generated framing, and the entries or marked regions discern maintains in shared configuration.

Your own instructions, map pages, skills, configuration, and other authored material keep their existing terms. Provider and third-party material also keep their own terms. For example, an agent file can contain both discern's built-in instructions and your project's instructions: the Apache-2.0 grant applies to the portions discern supplied.

The [files and ownership inventory](files-and-ownership.md#registered-project-paths) identifies those portions for each registered destination. [`NOTICE`](https://github.com/jackwh/discern/blob/main/NOTICE) states the legal scope and attribution.

## What stays under discern's software license

discern itself uses the Functional Source License, [`FSL-1.1-ALv2`](https://github.com/jackwh/discern/blob/main/LICENSE). The project-payload grant does not relicense the executable, source repository, or manual. It also excludes user-selected documentation exports, Git-admin records, temporary output, and provider-local state. discern's software license does not extend into your project's own material.

## Where to find the license texts

Run `discern licenses` to read discern's software license, the project-payload license, `NOTICE`, and notices for third-party software bundled into the binary.

discern does not add a license file, notice, or legal header to your repository. If you redistribute discern-authored portions, you are responsible for the Apache-2.0 redistribution conditions, including giving recipients a copy of the license and preserving applicable notices.
