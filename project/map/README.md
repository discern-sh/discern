---
title: The discern manual
description: "The public manual agents maintain under discern's own gate, covering quality checks, worktrees, guidance, skills, and reference."
aliases:
  - docs
  - documentation
  - manual
---

# The discern documentation

_The manual for discern: the same pages on discern.sh, in `discern help`, and in your coding agent's MCP tools._

discern gives a repository one quality gate, an isolated worktree per change, and one set of instructions every coding agent reads. New here? Start with [orientation](00-orientation/) for the concepts in plain English, then the [quickstart](10-getting-started/quickstart.md) to go from install to your first gated change.

Already know the outcome you need? Use the [task index](10-getting-started/tasks.md) to jump to its procedure.

## The sections

| Section                                          | What's in it                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [00-orientation/](00-orientation/)               | How discern fits together, in plain English: concepts, glossary, design principles.  |
| [10-getting-started/](10-getting-started/)       | Install, setup, a first gated change, troubleshooting, and upgrades.                 |
| [20-quality-gate/](20-quality-gate/)             | `discern done` and the fix · build · check · test model, scopes, and standards.      |
| [30-worktrees/](30-worktrees/)                   | The isolated-worktree workflow: lifecycle, per-worktree identity, resources.         |
| [40-agent-guidance/](40-agent-guidance/)         | Guidance authored once and compiled into every agent file.                           |
| [45-skills/](45-skills/)                         | Bundled and project-authored playbooks that agents load when the work calls for one. |
| [60-agent-integrations/](60-agent-integrations/) | Per-agent integration guides: the files discern writes, trust gates, gotchas.        |
| [70-reference/](70-reference/)                   | Exact CLI, configuration, MCP, ownership, and platform contracts.                    |

Contributors can go deeper in [engine internals](50-engine-internals/), [development](80-development/), and [site](90-site/). [Project decisions](_adr/) record the choices behind discern. They are history, outside the manual and customer binaries ([ADR 0142](_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Browsing from the terminal

`discern help` serves these pages: bare for the index, with a page name for one page, and with `--list`, `--json`, or `--raw` for scripts. `discern map` browses the agent-maintained documentation for your project. This manual stays under `discern help` ([ADR 0120](_adr/0120-launch-verb-canon.md)).

## How agents maintain the manual

These pages are both discern's public manual and the agent-maintained map of its code. The coding agents that change discern update the map under the same gate as the product. What you read is what they read, checked as part of the work it describes.
