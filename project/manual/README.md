---
id: manual-home
title: "The discern manual"
description: "Choose the shortest supported path for a first result, a task, understanding, exact lookup, or recovery."
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

Choose the shortest supported path for a first result, a task, understanding, exact lookup, or recovery.

## Start here

<!-- BEGIN MANUAL FRONT DOORS -->

- [Start with discern](00-start/README.md)
- [Finish and land a change](10-guides/finish-and-land-a-change.md)
- [Understand the Proof](20-understand/proof.md)
- [Look up an exact contract](30-reference/README.md)
- [Recover from a problem](40-troubleshooting/README.md)

<!-- END MANUAL FRONT DOORS -->

## The complete manual

_The same published pages reach discern.sh, `discern docs`, MCP, raw Markdown, search, export, and machine editions._

discern gives a repository a final quality check (the Gate), an isolated workspace for each change (a Git worktree), and shared project instructions supplied to every coding agent. Start with [orientation](00-start/evaluate-discern.md) for the concepts in plain English, then follow the [quickstart](00-start/first-success.md) from installation to your first gated change.

Already know the outcome you need? Use the [task index](10-guides/README.md) to jump to its procedure.

### The sections

| Section                                         | What's in it                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| [Start](00-start/README.md)                     | Evaluate discern, reach a first success, and understand what setup produced.      |
| [Guides](10-guides/README.md)                   | Complete a task from a named starting state and recognize its result.             |
| [Understand](20-understand/README.md)           | Learn the product states, evidence, and authority boundaries behind the workflow. |
| [Reference](30-reference/README.md)             | Look up exact commands, configuration, formats, files, platforms, and defaults.   |
| [Troubleshooting](40-troubleshooting/README.md) | Start from an observable symptom and recover through a bounded procedure.         |

Contributors can go deeper in the project's [engine](https://github.com/jackwh/discern/tree/main/project/map/50-engine-internals/), [development](https://github.com/jackwh/discern/tree/main/project/map/80-development/), and [site](https://github.com/jackwh/discern/tree/main/project/map/90-site/) Map sections. [Project decisions](https://discern.sh/docs/decisions) record the choices behind discern. Decision records remain outside the product manual and customer binaries.

### Browsing from the terminal

`discern docs [target]` browses this manual. Bare interactive `discern docs` opens a full-height, grouped picker. Type to search titles and paths, move with the arrow or Page keys, and press Enter to open a document. When the terminal has room, the picker stays above a document pane with its own scroll position; short terminals use one coherent pane at a time. Tab moves between panes, the arrow and Page keys scroll the focused pane, Home and End jump within it, and Escape or `q` closes the document without losing the picker state.

Use `[` and `]` to focus links and Enter to follow one. Admitted relative links and heading fragments stay inside the reader. HTTP and HTTPS links open through the system browser after discern restores the terminal. With mouse input enabled, the wheel scrolls the pane under the pointer, a click focuses a pane, and a link click follows it. Use your terminal's selection modifier when selecting terminal text while mouse tracking is active. Every mouse action has a keyboard equivalent.

Choose `Read the docs online` to open [discern.sh/docs](https://discern.sh/docs), or add `--pager` to read through `$PAGER` and return when it exits. If the terminal cannot run the browser, discern prints the document, waits for `Press Enter to continue.`, and restores the remembered selection. A direct target renders and exits without waiting. `--list`, `--json`, and `--raw` support scripts and Model Context Protocol (MCP) clients. `discern map` uses the same reader for your project's Map. `discern help [command]` mirrors `discern [command] --help` ([ADR 0218](https://discern.sh/docs/decisions/0218-docs-owns-the-manual-help-owns-cli-reference)).

### How the manual and Map differ

`project/manual/` is the product-manual source. Its published pages serve readers and external coding agents. The project's Map remains under `project/map/`: it records maintainer orientation, subsystem boundaries, and internal knowledge for agents working on discern itself. Both corpora use the same neutral Markdown engine, while their separate policy models decide admission, validation, and delivery.
