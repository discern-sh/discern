---
id: reference-licenses
title: "Licenses"
description: "Which license covers the material discern adds to your project, which covers discern itself, and what to keep when you redistribute it."
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

The material discern adds to your project has a different license from discern itself. This page shows which terms apply to each part, so you know what you're using or redistributing.

## Apache-2.0 covers what discern adds to your project

The portions discern supplies to your project are available immediately under the [Apache License, Version 2.0](https://github.com/discern-sh/discern/blob/main/LICENSES/Apache-2.0.txt). They include:

- setup scaffolding;
- built-in instructions and skills;
- generated framing;
- the entries or marked regions discern maintains in shared configuration.

Your own instructions, map pages, skills, configuration, and other authored material keep their existing terms. Material from coding-tool providers and other third parties also keeps its own terms.

One file can mix the two. For example, an agent file can contain discern's built-in instructions and your project's instructions. There, the Apache-2.0 grant applies only to the portions discern supplied.

The [files and ownership inventory](files-and-ownership.md#registered-project-paths) shows, for each path discern registers, the license of the portions discern authored. [`NOTICE`](https://github.com/discern-sh/discern/blob/main/NOTICE) states the legal scope and attribution.

## The Functional Source License covers discern itself

discern itself uses the Functional Source License, [`FSL-1.1-ALv2`](https://github.com/discern-sh/discern/blob/main/LICENSE). The Apache-2.0 grant for project material doesn't relicense discern's executable, its source repository, or this manual. It also doesn't cover:

- documentation you choose to export;
- discern's records inside Git's administrative directory;
- temporary output;
- provider-local state, such as a coding tool's machine-local settings.

discern's software license doesn't extend into your project's own material.

## Read the license texts

`discern licenses` prints discern's software license, the Apache-2.0 license for project material, `NOTICE`, and the notices for third-party software bundled into the binary.

discern doesn't add a license file, notice, or legal header to your repository. If you redistribute the portions discern authored, you're responsible for Apache-2.0's redistribution conditions. They include giving recipients a copy of the license and keeping the notices that apply.
