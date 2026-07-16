---
title: The discern manual
description: The quality gate, isolated worktrees, agent guidance, config, and skills — one documentation tree, served on every surface.
aliases:
  - docs
  - documentation
  - manual
---

# The discern documentation

_The manual for discern: the same pages on discern.sh, in `discern help`, and in
your coding agent's MCP tools._

discern is documented once. This tree renders on the site, in your terminal, and
over MCP, and it describes only what exists in code today — present tense, no
"will eventually." When a change alters something these pages describe, the docs
change in the same commit; a stale page is treated as a defect, not a chore.

New here? Start with [orientation](00-orientation/): the concepts, the glossary,
and the shape of the system. Then follow the reading order below.

## The sections

| Section                                          | What's in it                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [00-orientation/](00-orientation/)               | The shape of the system in plain English: concepts, glossary, design principles. |
| [10-installer/](10-installer/)                   | Install and setup: quickstart, walkthrough, config reference, FAQ.               |
| [20-quality-gate/](20-quality-gate/)             | `discern done` and the fix · build · check · test model, scopes, and standards.  |
| [30-worktrees/](30-worktrees/)                   | The isolated-worktree workflow: lifecycle, per-worktree identity, resources.     |
| [40-agent-guidance/](40-agent-guidance/)         | Guidance authored once, compiled into every agent file, plus the bundled skills. |
| [60-agent-integrations/](60-agent-integrations/) | Per-agent integration guides: the files discern writes, trust gates, gotchas.    |

Three more trees serve contributors rather than users and stay out of
`discern help` ([ADR 0039](_adr/0039-bundled-help-docs.md)):
[50-engine-internals/](50-engine-internals/) documents the TypeScript engine,
[80-development/](80-development/) covers working on discern itself, and
[90-site/](90-site/) covers discern.sh. The records under [_adr/](_adr/) are the
project's decision history, published on the site's decisions pages and never
embedded in customer binaries
([ADR 0142](_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Browsing from the terminal

`discern help` serves these pages inside any project discern is installed in —
`discern help` for the index, `discern help config-reference` for one page,
`--list` / `--json` / `--raw` for scripts. `discern map` is a different verb for
a different tree: it opens the documentation map agents maintain for _your_
project's code, never this manual ([ADR 0120](_adr/0120-launch-verb-canon.md)).

## Who writes this

The coding agents that work on discern do, under the same gate as the code.
Terminology is defined once in the [glossary](00-orientation/glossary.md) and
used identically everywhere; claims link the source files they describe.
