---
title: The discern manual
description: "The public manual agents maintain under discern's own gate, covering quality checks, worktrees, instructions, skills, and reference."
aliases:
  - docs
  - documentation
  - manual
---

# The discern documentation

_discern's manual, shared by discern.sh, `discern docs`, and agent tools._

discern gives a repository a final quality check (the Gate), an isolated workspace for each change (a Git worktree), and shared project instructions supplied to every coding agent. Start with [orientation](00-orientation/) for the concepts in plain English, then follow the [quickstart](10-getting-started/quickstart.md) from installation to your first gated change.

Already know the outcome you need? Use the [task index](10-getting-started/tasks.md) to jump to its procedure.

## The sections

| Section                                          | What's in it                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [00-orientation/](00-orientation/)               | How discern fits together, in plain English: concepts, glossary, design principles.  |
| [10-getting-started/](10-getting-started/)       | Install, setup, a first gated change, troubleshooting, and upgrades.                 |
| [20-quality-gate/](20-quality-gate/)             | `discern done`, its fix · build · check · test model, scopes, and Standards.         |
| [30-worktrees/](30-worktrees/)                   | The isolated-worktree workflow: lifecycle, per-worktree identity, resources.         |
| [40-agent-instructions/](40-agent-instructions/) | Instructions authored once and compiled into every agent file.                       |
| [45-skills/](45-skills/)                         | Bundled and project-authored playbooks that agents load when the work calls for one. |
| [60-agent-integrations/](60-agent-integrations/) | Per-agent integration guides: the files discern writes, trust gates, gotchas.        |
| [70-reference/](70-reference/)                   | Exact CLI, configuration, MCP, ownership, and platform contracts.                    |

Contributors can go deeper in [engine internals](50-engine-internals/), [development](80-development/), and [site](90-site/). [Project decisions](_adr/) record the choices behind discern. The decision archive sits outside the manual and customer binaries ([ADR 0142](_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Browsing from the terminal

`discern docs [target]` browses this manual. The interactive browser renders a selected document inside discern; `Press Enter to continue.` returns to the remembered selection. Choose `Read the docs online` to open [discern.sh/docs](https://discern.sh/docs) in the system browser, or add `--pager` to read through `$PAGER` and return when it exits. A direct target renders and exits without waiting. `--list`, `--json`, and `--raw` support scripts and Model Context Protocol (MCP) clients. `discern map` browses your project's Map. `discern help [command]` mirrors `discern [command] --help` ([ADR 0218](_adr/0218-docs-owns-the-manual-help-owns-cli-reference.md)).

## How agents maintain the manual

These pages form discern's public manual and the agent-maintained Map of its code. Coding agents update the Map under the same Gate as the product. The same source pages serve readers and agents, and the Gate checks them with the changes they describe.
