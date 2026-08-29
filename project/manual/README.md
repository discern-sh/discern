---
id: manual-home
title: "The discern manual"
description: "Learn discern, do real work with it, understand its evidence and authority model, and reach exact contracts and recovery."
order: 0
publish: true
kind: tutorial
aliases:
  - "manual-home"
  - "The discern documentation"
  - "docs"
  - "documentation"
  - "manual"
---

# The discern manual

discern installs an engineering practice into a Git repository: a final quality check the project defines (the Gate), an isolated workspace for each task, and shared instructions every coding agent inherits. The outcome is practical. You can hand more of the work to coding agents and still know what's ready, because each change returns with evidence for its exact commit and lands only with your authority.

This manual serves two readers. If you're deciding whether discern belongs in your project, [Evaluate discern](00-start/evaluate-discern.md) answers that without installing anything. If discern is already running in your project, start from what you're trying to do:

## Start here

<!-- BEGIN MANUAL FRONT DOORS -->

- [Install and set up discern](00-start/first-success.md)
- [Finish and land a change](10-guides/finish-and-land-a-change.md)
- [Understand Proof](20-understand/proof.md)
- [Look up an exact contract](30-reference/README.md)
- [Recover from a problem](40-troubleshooting/README.md)

<!-- END MANUAL FRONT DOORS -->

## The sections

Every published page lives in one section, and the sections are organized by the job you came with:

| Section                                         | Its job                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| [Start](00-start/README.md)                     | Evaluate discern, reach a first landed change, and understand what setup added. |
| [Guides](10-guides/README.md)                   | Accomplish one outcome from a named starting state and recognize the result.    |
| [Understand](20-understand/README.md)           | Build the mental models: states, evidence, and who holds which authority.       |
| [Reference](30-reference/README.md)             | Look up exact commands, configuration, formats, files, platforms, and defaults. |
| [Troubleshooting](40-troubleshooting/README.md) | Go from an observable symptom to a safe recovery and a clear stopping point.    |

## Read it anywhere

These pages are one manual with several deliveries. The website at [discern.sh/docs](https://discern.sh/docs) serves them with search. Append `.md` to any page's address for its raw Markdown. Installed, `discern docs` opens the same manual offline in a terminal reader: type to search, press Enter to open a page, press `q` to close it. `--raw`, `--pager`, and direct targets serve scripts. Coding agents read the same pages through the `discern_docs` MCP tool. Every published page is browsable and searchable on each of these surfaces; this front door is only a starting selection.

## The manual and the Map

This manual teaches the product. discern's own development also keeps a Map: the live account its coding agents maintain of its codebase, because discern is built under its own practice. You can inspect that Map [in the discern repository](https://github.com/jackwh/discern/tree/main/project/map). Read it as working evidence, and read the [decision records](https://discern.sh/docs/decisions) for why discern works the way it does; product guidance stays here in the manual.
