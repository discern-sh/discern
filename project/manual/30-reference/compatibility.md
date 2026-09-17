---
id: reference-compatibility
title: "Compatibility"
description: "How discern versions its published contracts and what can change between releases."
order: 140
publish: true
kind: reference
aliases:
  - "reference-compatibility"
  - "compatibility"
  - "stability"
  - "evolving"
  - "deprecation"
  - "breaking change"
  - "schema major"
---

# Compatibility

Use this page to decide what to rely on across discern releases.

discern versions its published contracts by schema, not by package release. Each published schema carries its own major — the `v1` in its `$id` — and records its compatibility policy inside the artifact; the [schema table](mcp-and-results.md#published-schemas-and-types) links every one. Within a major, surfaces only gain members. A breaking change moves a schema to `/v2/` while `/v1/` stays served, so a pinned copy keeps working; refresh it before validating documents that use newer additions.

What lives in your repository — configuration, Proof notes, and the script protocols — stays valid across every 1.x release, and an upgrade handles any renames for you. The surfaces an agent reads each session — commands, flags, tool inputs, and result fields — may retire a stable member in a minor release, named in the release notes, with the refusal naming its replacement: a deliberate departure from strict semantic versioning.

A few newer commands and settings are marked evolving in their published schemas: complete and supported, but their flags, inputs, and result shapes may still change in a minor release. Everything unmarked is stable.

Result values come in two kinds, and the schema shows which is which. An open vocabulary — error slugs, advisory kinds, and similar — publishes as a string with the known members as metadata, and grows in ordinary releases; don't reject a value you don't recognize. A closed vocabulary, such as step outcomes, publishes as an enum and changes only with that artifact's own major.

Descriptive text, listing order, and rendered Markdown or terminal output are not contract surfaces.
