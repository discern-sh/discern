---
title: The discern project Map
description: "Maintainer orientation, subsystem boundaries, working practices, and decisions for agents changing discern itself."
aliases:
  - project map
  - maintainer documentation
  - repository documentation
---

# The discern project Map

_The knowledge tree for coding agents and maintainers changing discern itself._

This map explains the boundaries and intent that the code cannot express alone. It is the configured source behind `discern map`; it is not the product manual. Readers learning or using discern start in [`project/manual/`](../manual/README.md) or at [discern.sh/docs](https://discern.sh/docs). The separation is recorded in [ADR 0314](_adr/0314-separate-public-manual-and-project-map.md).

## Where to start

Start with [orientation](00-orientation/) for the product model and vocabulary. Move to [engine internals](50-engine-internals/) for subsystem boundaries, [development](80-development/) for contributor practice, or [the site](90-site/) for discern.sh. [Architecture Decision Records](_adr/) preserve significant choices and their trade-offs.

## The sections

| Section                                          | What it helps a contributor understand                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| [00-orientation/](00-orientation/)               | The product model, vocabulary, principles, and repository orientation. |
| [10-getting-started/](10-getting-started/)       | The installed workflow and the path to a first complete change.        |
| [20-quality-gate/](20-quality-gate/)             | Gate stages, scopes, Standards, checkpoints, and Proof.                |
| [30-worktrees/](30-worktrees/)                   | Worktree lifecycle, identity, resources, and landing.                  |
| [40-agent-instructions/](40-agent-instructions/) | Author-once instruction compilation and agent context boundaries.      |
| [45-skills/](45-skills/)                         | Bundled and project-authored procedural playbooks.                     |
| [50-engine-internals/](50-engine-internals/)     | Engine architecture and durable subsystem boundaries.                  |
| [60-agent-integrations/](60-agent-integrations/) | Provider integrations, trust gates, and materialized files.            |
| [70-reference/](70-reference/)                   | Exact repository and product contracts used during implementation.     |
| [80-development/](80-development/)               | Building, testing, reviewing, and releasing discern.                   |
| [90-site/](90-site/)                             | The website, product manual delivery, and design-system consumption.   |

## Browsing and maintenance

`discern map [target]` browses this repository's configured map. `discern docs [target]` browses the separately sourced product manual. Both commands use the same neutral document reader, renderer, target resolver, and search model; their corpus policies decide what is admitted and delivered.

Update the map when a change alters a durable boundary, supported workflow, or maintainer mental model. Link the implementation authority instead of copying facts that code or registries already make mechanically derivable. Update the manual only when the reader-facing product contract changes. The gate validates both corpora with distinct integrity, checkpoint, and prose policies.
