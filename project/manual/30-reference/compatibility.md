---
id: reference-compatibility
title: "Compatibility"
description: "What stays the same when you upgrade discern, what can change, and how a schema you pinned keeps working."
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

An upgrade never leaves your repository unreadable. This page says what stays the same across discern 1.x releases, what can change, and how to tell the two apart in discern's published schemas.

It matters most when you build on discern's formats: a script that reads `discern status --json`, a tool that checks Proof notes, or a check that validates `discern.toml`.

## Each schema has its own version

discern publishes its contracts as schemas and manifests, listed in the [schema table](mcp-and-results.md#published-schemas-and-types). Each one has its own major version, the `v1` in its `$id`, separate from discern's release number. Each one also records its compatibility policy inside the file.

- Within a major version, a schema only gains members. [Evolving members](#evolving-members-can-change-in-any-release) are the exception.
- A breaking change publishes the schema under `/v2/`, and discern keeps serving `/v1/`. A copy you pinned keeps working.
- A pinned copy validates the stable members it knows. Fetch the current copy before you validate documents that use newer additions.

## Configuration, records, and protocols stay valid

These contracts stay valid across every 1.x release:

- `discern.toml`, and the setup config document that `discern setup begin --config` reads;
- Proof notes on landed commits;
- the conventions your scripts rely on, such as the `DISCERN_METRIC` line a standard's command prints and the checkpoint `when` protocol;
- the release comparison: the release history discern publishes for other tools to read.

When discern renames a setting, `discern upgrade` migrates it for you. discern refuses the old spelling and names the new one.

## Commands, tools, and results can retire a member in a minor release

Your agent reads commands, flags, Model Context Protocol (MCP) tool inputs, and result fields fresh in each session. discern can retire a stable one in a minor release, never in a patch release, and the release notes name it. A retired command or flag refuses and names its replacement.

This departs from strict semantic versioning. A script that still uses a retired spelling stops working, and the refusal tells you what to use instead.

## Evolving members can change in any release

discern marks a few newer commands, tools, results, and settings as **evolving**. They're complete and supported, but their flags, inputs, and result shapes can change in any release. Everything unmarked is stable.

The published schemas carry the marker:

| Where                                                | Marker                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A command in the CLI grammar manifest                | `stability: "evolving"`                                                                                   |
| A tool in the MCP tools manifest                     | `stability: "evolving"`                                                                                   |
| A result contract in the result schema               | `stability: "evolving"` on its `x-discern-contracts` record, and `x-discern-stability` on its definitions |
| A section in the `discern.toml` configuration schema | `x-discern-stability`                                                                                     |

## Result values come from open or closed vocabularies

Where a result value comes from a fixed set, the schema marks that set with `x-discern-vocabulary`.

- An **open vocabulary** gains members in ordinary releases. The schema publishes it as a string and lists its known members at the schema root, under the same key. Treat a value you don't recognize as opaque, and keep going.
- A **closed vocabulary** changes only with a new major version of its schema. The schema publishes it as an enum.

[MCP and results](mcp-and-results.md#result-vocabularies) lists which result vocabularies are closed.

## Inputs only gain values

Within a major version:

- an input enum, such as a flag's accepted values or an MCP tool input, only gains values;
- a new positional argument is optional, so it always comes last;
- the MCP tools manifest lists every resource and resource template by name, kind, and URI. New ones can appear, and existing ones keep their name, kind, and URI.

## What isn't part of the contract

Don't build on these. They can change in any release:

- descriptive text, such as CLI help, MCP tool titles and descriptions, and schema descriptions;
- the order in which commands, tools, and resources are listed;
- rendered Markdown and terminal output, and hint text;
- the text of bundled instructions and skills, though their names are fixed;
- this manual;
- private file formats and locations on disk.

To upgrade a project, follow [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md#upgrade-the-project).
