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

When you upgrade discern within 1.x, your `discern.toml`, the [Proof notes](proof-and-checkpoint-formats.md#proof-notes) on your landed commits, and the conventions your scripts rely on stay valid. This page says what stays the same, what a release can change, and how discern's published schemas tell the two apart.

It matters most when you build on discern's formats. Say your recipe app's CI runs a script that reads `discern status --json` and posts each task's state to your team's chat. The sections below say which parts of that output the script can depend on, what to check before an upgrade, and what to do with a value it has never seen.

## Each schema has its own version

discern publishes its contracts as schemas and manifests, listed in the [schema table](mcp-and-results.md#published-schemas-and-types). Each one has its own major version, the `v1` in its `$id`, separate from discern's release number, and records its compatibility policy inside the file. The `discern.toml` that setup writes names its schema on the first line:

```toml
#:schema https://discern.sh/schema/v1/discern-config.schema.json
```

The major version changes only for a breaking change, so a copy you pinned keeps working:

- Within a major version, a schema only gains members. [Evolving members](#evolving-members-can-change-in-any-release) are the exception.
- A breaking change publishes the schema under `/v2/`, and discern keeps serving `/v1/`.
- A pinned copy validates the stable members it knows. Fetch the current copy before you validate documents that use newer additions.

## Configuration, records, and protocols stay valid

These contracts stay valid across every 1.x release:

- `discern.toml`, and the setup config document that `discern setup begin --config` reads;
- Proof notes on landed commits;
- the conventions your scripts rely on, such as the `DISCERN_METRIC` line a [standard](glossary.md#standard)'s command prints and the [checkpoint `when` protocol](proof-and-checkpoint-formats.md#checkpoint-when-protocol);
- the release comparison: the release history discern publishes for other tools to read.

When discern renames a setting, `discern upgrade` migrates your `discern.toml` for you. discern refuses the old spelling and names the new one.

## Commands, tools, and results can retire a member in a minor release

Your agent reads commands, flags, Model Context Protocol (MCP) tool inputs, and result fields fresh in each session, so it picks up a new name without any change from you. That's why discern can retire a stable one in a minor release, though never in a patch release, and the release notes name each one it retires. A retired command or flag refuses and names its replacement.

This departs from strict semantic versioning, and it's where a script of yours can break: one that still uses a retired spelling stops working, and the refusal tells you what to use instead. Before you upgrade the discern that runs the chat script, check the minor release's notes for anything the script uses.

## Evolving members can change in any release

discern marks a few newer commands, tools, results, and settings as **evolving**. They're complete and supported, but their flags, inputs, and result shapes can change in any release. Everything unmarked is stable, so check for the marker before a script depends on a member. The published schemas carry it:

| Where                                                | Marker                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A command in the CLI grammar manifest                | `stability: "evolving"`                                                                                   |
| A tool in the MCP tools manifest                     | `stability: "evolving"`                                                                                   |
| A result contract in the result schema               | `stability: "evolving"` on its `x-discern-contracts` record, and `x-discern-stability` on its definitions |
| A section in the `discern.toml` configuration schema | `x-discern-stability`                                                                                     |

## Result values come from open or closed vocabularies

Where a result value comes from a fixed set, the schema marks that set with `x-discern-vocabulary`:

- An **open vocabulary** gains members in ordinary releases. The schema publishes it as a string and lists its known members at the schema root, under the key the marker names. A result's `error` slug is one:

  ```json
  "error": {
    "type": "string",
    "x-discern-vocabulary": "x-discern-error-slugs"
  }
  ```

  When the chat script meets a value it doesn't recognize, it should treat the value as opaque and keep going.

- A **closed vocabulary** changes only with a new major version of its schema, and the schema publishes it as an enum. A step's `outcome` is one:

  ```json
  "outcome": {
    "type": "string",
    "enum": ["ok", "failed", "skipped", "cancelled"],
    "x-discern-vocabulary": "x-discern-step-outcomes"
  }
  ```

[MCP and results](mcp-and-results.md#result-vocabularies) lists which result vocabularies are closed.

## Inputs only gain values

Within a major version, the inputs a script sends keep working:

- an input enum, such as a flag's accepted values or an MCP tool input, only gains values;
- a new positional argument is optional, so it always comes last;
- the MCP tools manifest lists every resource and resource template by name, kind, and URI. New ones can appear, and existing ones keep their name, kind, and URI.

## What isn't part of the contract

These can change in any release, so don't build on them:

- descriptive text, such as CLI help, MCP tool titles and descriptions, and schema descriptions;
- the order in which commands, tools, and resources are listed;
- rendered Markdown and terminal output, and hint text;
- the text of bundled instructions and [skills](glossary.md#skill), though their names are fixed;
- this manual;
- private file formats and locations on disk.

That's why the chat script reads `--json` fields instead of parsing the Markdown or terminal report. To upgrade a project, follow [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md#upgrade-the-project).
