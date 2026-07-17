---
title: The discern manual
description: The quality gate, isolated worktrees, agent guidance, config, and skills.
aliases:
  - docs
  - documentation
  - manual
---

# The discern documentation

_The manual for discern: the same pages on discern.sh, in `discern help`, and in your coding agent's MCP tools._

discern gives a repository one quality gate, an isolated worktree per change, and one set of instructions every coding agent reads. New here? Start with [orientation](00-orientation/) for the concepts in plain English, then the [quickstart](10-getting-started/quickstart.md) to go from install to your first gated change.

## The sections

| Section                                          | What's in it                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [00-orientation/](00-orientation/)               | How discern fits together, in plain English: concepts, glossary, design principles. |
| [10-getting-started/](10-getting-started/)       | Install, setup, a first gated change, troubleshooting, and upgrades.                |
| [20-quality-gate/](20-quality-gate/)             | `discern done` and the fix · build · check · test model, scopes, and standards.     |
| [30-worktrees/](30-worktrees/)                   | The isolated-worktree workflow: lifecycle, per-worktree identity, resources.        |
| [40-agent-guidance/](40-agent-guidance/)         | Guidance authored once, compiled into every agent file, plus the bundled skills.    |
| [60-agent-integrations/](60-agent-integrations/) | Per-agent integration guides: the files discern writes, trust gates, gotchas.       |

The remaining trees serve contributors rather than users and stay out of `discern help` ([ADR 0039](_adr/0039-bundled-help-docs.md)): [50-engine-internals/](50-engine-internals/) documents the TypeScript engine, [80-development/](80-development/) covers working on discern itself, and [90-site/](90-site/) covers discern.sh. The records under [_adr/](_adr/) are the project's decision history, published on the site's decisions pages and never embedded in customer binaries ([ADR 0142](_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Browsing from the terminal

`discern help` serves these pages inside any project discern is installed in: bare for the index, `discern help config-reference` for one page, `--list` / `--json` / `--raw` for scripts. `discern map` is a different verb for a different tree: the documentation map agents maintain for _your_ project's code, while this manual stays under `discern help` ([ADR 0120](_adr/0120-launch-verb-canon.md)).

## Who writes this

The coding agents that work on discern do, under the same gate as the code. Every page describes what exists in code today, and when a change alters documented behavior, the page changes in the same commit — the gate treats a stale page as a defect. Terminology is defined once in the [glossary](00-orientation/glossary.md) and used identically everywhere; claims link the source files they describe.
