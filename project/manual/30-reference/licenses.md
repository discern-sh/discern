---
id: reference-licenses
title: "Licenses"
description: "See which license covers the material discern adds to your project, which covers discern itself, and what to keep when you redistribute it."
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

The material discern adds to your project comes under a different license from discern itself, and your own code and documents keep the terms they already had. This page shows which license covers each part, and what you're responsible for when you redistribute it.

Say you hand your recipe app's repository to a client, with discern's built-in instructions compiled into its `AGENTS.md`. The sections below answer the questions that raises: which license covers discern's part of that file, which covers yours, and what handing it over asks of you.

## Apache-2.0 covers what discern adds to your project

The portions discern supplies to your project are available immediately under the [Apache License, Version 2.0](https://github.com/discern-sh/discern/blob/main/LICENSES/Apache-2.0.txt). They include:

- setup scaffolding;
- built-in instructions and [skills](glossary.md#skill);
- generated framing;
- the entries or marked regions discern maintains in shared configuration.

Your own instructions, [map](glossary.md#map) pages, skills, configuration, and other authored material keep their existing terms, and so does material from coding-tool providers and other third parties.

One file can mix the two. The recipe app's `AGENTS.md` holds discern's built-in instructions beside your project's own, and the Apache-2.0 grant applies only to the portions discern supplied.

The [files and ownership inventory](files-and-ownership.md#registered-project-paths) shows, for each path discern registers, the license of the portions discern authored. [`NOTICE`](https://github.com/discern-sh/discern/blob/main/NOTICE) states the legal scope and attribution.

## The Functional Source License covers discern itself

discern itself is Fair Source software, under the Functional Source License, [`FSL-1.1-ALv2`](https://github.com/discern-sh/discern/blob/main/LICENSE). The Apache-2.0 grant for project material doesn't relicense discern's executable, its source repository, or this manual. It also doesn't cover:

- documentation you choose to export;
- discern's records inside Git's administrative directory;
- temporary output;
- provider-local state, such as a coding tool's machine-local settings.

In the other direction, discern's software license doesn't extend into your project's own material.

## Read the license texts

`discern licenses` prints discern's software license, the Apache-2.0 license for project material, `NOTICE`, and the notices for third-party software bundled into the binary.

discern doesn't add a license file, notice, or legal header to your repository, so meeting Apache-2.0's redistribution conditions is your step. If you redistribute the portions discern authored, as you do when you hand the recipe app to your client, you're responsible for those conditions. They include giving recipients a copy of the license and keeping the notices that apply.
