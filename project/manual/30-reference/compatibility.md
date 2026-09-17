---
id: reference-compatibility
title: "Compatibility"
description: "Know what a discern release may change: the durable and session promises, evolving members, vocabularies, retirements, and schema pinning."
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
  - "retired command"
  - "pin a schema"
  - "version axes"
---

# Compatibility

Use this page to answer one question before an upgrade: can this release break my repository, my scripts, or my agent's tool calls?

The short answer has two halves. The files that live in your repository keep working across every 1.x release: your `discern.toml`, the Proof notes on your landed commits, and the scripts that speak discern's published protocols. The surfaces your agent re-reads each session — commands, MCP tools, and result fields — carry a softer promise: a stable member is retired only in a minor release, the release notes name it, and the refusal names its successor.

The rest of this page is the full contract: which surface sits under which promise, what a release may add, what counts as a break, which members are still evolving, and what sits outside the contract entirely.

## The two promises

discern publishes eight contract surfaces, each with a published schema (see [published schemas and types](mcp-and-results.md#published-schemas-and-types)). They divide by where the cost of a break would land.

**The durable promise** covers what lives in repositories: `discern.toml`, the setup config document, the landing Proof note, the conventions manifest, and the release comparison JSON that `discern releases` points external tooling at. A repository can sit untouched for a year; whatever discern release opens it next must still read it. Within a major, these surfaces only gain members. A break needs a new schema major.

**The session promise** covers what an agent reads fresh every session: the command grammar, the MCP tool catalog, and the result contracts. Because nothing durable depends on yesterday's reading, these surfaces may retire a stable member in a minor release — with notice, and with the successor named. [Retirements](#retirements) below states the exact rule.

## What each release may change

Within schema major 1, each surface accepts the additions in the middle column. Everything in the right column is a break: on a durable surface it needs a new schema major, and on a session surface it needs a recorded retirement in a minor release.

| Surface                                                                                | Safe in any 1.x release                                                                                 | Needs a new schema major or a recorded retirement                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`discern.toml`](https://discern.sh/schema/v1/discern-config.schema.json)              | New optional keys and sections; a required key becoming optional; new values in an enum.                | Removing or renaming a key; changing a type or a default; making an optional key required; removing an enum value.                      |
| [Setup config document](https://discern.sh/schema/v1/discern-setup-config.schema.json) | The same additions as `discern.toml`.                                                                   | The same breaks as `discern.toml`. The document's own version equals its schema major.                                                  |
| [Landing Proof note](https://discern.sh/schema/v1/discern-proof-note.schema.json)      | New optional fields; new members of its open vocabularies.                                              | Removing or renaming a field; changing a type; a new member of a closed vocabulary. The schema major is also the note's format version. |
| [Release comparison](https://discern.sh/schema/v1/discern-releases.schema.json)        | New optional fields; new members of its open vocabularies.                                              | Removing or renaming a field; changing a type; a new member of its `status` or `publication` vocabularies.                              |
| [Conventions manifest](https://discern.sh/schema/v1/discern-conventions.json)          | New names.                                                                                              | Changing or removing any published value.                                                                                               |
| [CLI grammar](https://discern.sh/schema/v1/discern-cli.json)                           | New commands, aliases, flags, and flag spellings; new optional trailing arguments; new accepted values. | Removing or renaming a stable command, flag, or spelling; changing an existing input's type, default, or accepted values.               |
| [MCP tools](https://discern.sh/schema/v1/discern-mcp-tools.json)                       | New tools; new optional inputs.                                                                         | Removing or renaming a stable tool; removing an input; making an optional input required; changing an input's type.                     |
| [Result contracts](https://discern.sh/schema/v1/discern-results.schema.json)           | New optional fields; new result contracts; new members of any open vocabulary.                          | Removing or renaming a stable field; changing a type; making an optional field required; changing a closed vocabulary.                  |

Adding a value to an input enum is always compatible, whether it is a `discern.toml` enum, a setup-document enum, a flag's accepted values, or an MCP tool input. Removing one is always a break. Output values follow the [vocabulary rule](#open-and-closed-vocabularies) below.

## Evolving members

A small set of members is marked **evolving**. Evolving means complete and supported: the command works and is documented. What it does not yet promise is shape — an evolving member's flags, inputs, and result fields may change in any release, without a retirement notice and without a schema major.

Evolving in this release:

- the `desk`, `enter`, `improvement`, `coupling`, and `tidy` commands;
- `patterns`, with `patterns reset`, `patterns seal`, and `patterns archives`;
- `worktree park` and `worktree rename`;
- the hidden `triangle` command;
- the `[coupling]` section of `discern.toml`.

Everything else is stable.

The mark covers a member's command paths, its MCP tool, and its result schema together; a configuration key carries the same fact through its schema metadata. When an evolving member settles, it graduates to stable; graduation adds to the promise and breaks nothing. A stable member cannot move the other way; demoting one is a break.

You will not find the mark in CLI help or MCP descriptions. Your agent reads those surfaces fresh each session, so a label there would tell it nothing it can act on. The published schemas and this page carry the fact.

## Open and closed vocabularies

Result output carries two kinds of vocabulary, and they grow differently.

An **open vocabulary** is published as a string, with the currently known members listed as schema metadata. New members arrive in ordinary releases. Open at launch: error slugs, advisory kinds, step kinds, step dispositions, checkpoint drop reasons, Proof status, consent source, and every other output value discern only carries or displays. Treat an unknown member of an open vocabulary as opaque: keep it, show it, and keep going. Code that rejects a slug it has not seen before will break on a compatible release.

A **closed vocabulary** is one your code is expected to branch on, so its member list is the contract. Closed at launch: validation mode, step outcome, diagnostic severity, proposal direction, evidence purpose, requirement kind, checkpoint mode, exception state, landing-authority kind, and the release comparison's `status` and `publication` values. A new member of a closed vocabulary is a break for that artifact alone: a new schema major for the Proof note or the release comparison, a recorded retirement on a session surface.

## Retirements

The durable promise: **an upgrade never leaves a repository unreadable.** A renamed configuration key is migrated by `discern upgrade`, and the old spelling is refused with its successor named. A Proof-note format change bumps the note's own version, carried inside the note. A copy of a durable-tier schema pinned at any 1.x release validates every later 1.x document.

The session promise: a stable command, flag, tool input, or result field is retired only in a **minor** release, never a patch, and the release notes name it. A retired command or flag refuses with its successor named, so the correction is one edit away. That refusal does break a script that still hard-codes the old spelling. discern accepts that cost knowingly: agents re-read the command grammar and the tool catalog every session, so they meet the new spelling the first time they look, and holding every old spelling forever would leave two names for every concept. This is a departure from strict semantic versioning, and it applies to the session surfaces only.

Evolving members may change in any release, patch releases included.

## Script protocols

Standards producers and checkpoint `when` commands live in your repository and are written against discern's script protocols, so the protocols are durable. Every 1.x release honors:

- the `DISCERN_METRIC <name> <number>` output line a [standards producer](config-reference.md) emits;
- the `DISCERN_MATCH <path>` output line a checkpoint matcher emits;
- the `DISCERN_CHECKPOINT_INPUT` document a `when` command receives — its version and its field names;
- the meaning of a `when` command's exit statuses: `0` fires the checkpoint, `10` passes it.

The conventions manifest records these protocols, together with the public environment variables, bundled skill names, built-in checkpoint and question ids, and the other repository facts it freezes. The exact `when` input fields are documented in the [checkpoint `when` protocol](proof-and-checkpoint-formats.md#checkpoint-when-protocol).

## Pinning a schema

Each published schema's `$id` is a real URL: `https://discern.sh/schema/v1/<name>`. That URL serves the current 1.x schema for its surface, and the [schema table](mcp-and-results.md#published-schemas-and-types) links every one.

To pin, save a copy. A pinned copy validates the stable members it knew when you saved it. Refresh the copy before validating anything that uses an addition — a configuration file with a newer optional key, a result from a newer contract.

A breaking change never edits `/v1/` in place. It adds `/v2/` beside it, and `/v1/` stays served, so a pinned consumer keeps a working reference while it migrates.

## The version axes

Several version numbers move independently. None of them is derived from another:

- **The package version** — the release number itself (`discern --version`). It never appears in a schema `$id`.
- **Each publication's schema major** — the `v1` in its `$id`. Each of the eight surfaces majors independently, per surface, and a package release forces no schema major.
- **The install schema** — `[meta].schema_version` in `discern.toml`, advanced only by a configuration migration.
- **The setup config document version** — equal to that document's schema major.
- **The checkpoint `when` input version** — the `version` field inside `DISCERN_CHECKPOINT_INPUT`.
- **`[meta].managed_version`** — the release whose managed material your project last adopted through setup or upgrade. It records adoption; it makes no compatibility promise.

## Outside the contract

The following may change in any release, and tooling should not depend on them:

- descriptive prose everywhere: CLI help text, MCP titles and descriptions, and JSON Schema documentation keywords;
- the listing order of commands, tools, and resources;
- Markdown and terminal output, including the rendered forms of results and Proof;
- hint text;
- the bundled instructions and skill bodies — their names are frozen, their content is not;
- this manual and the project map;
- private on-disk formats and their locations, which version themselves independently.

If a fact is not in a published schema and not named on this page, treat it as free to change.
