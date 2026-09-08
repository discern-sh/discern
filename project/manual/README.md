---
id: manual-home
title: "The discern manual"
description: "Set up discern, direct your agents, review their work, and recover when something goes wrong."
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

You have something you want to build, and coding agents can help carry the work. discern gives that work a shared practice: instructions the project keeps, a separate workspace for each task, and checks that record what passed before a change is ready for your decision.

Your agent operates discern. This manual helps you direct the work, understand what comes back, and decide what belongs in your project. If you're still considering it, [evaluate discern](00-start/evaluate-discern.md) explains what adoption involves and where its promises stop.

## Start here

<!-- BEGIN MANUAL FRONT DOORS -->

- [Get your project ready for coding agents](00-start/first-success.md)
- [Turn a larger idea into tasks agents can carry](10-guides/delegate-work.md)
- [Understand the evidence behind finished work](20-understand/proof.md)
- [Make future sessions remember a rule or procedure](20-understand/instructions-skills-and-map.md)
- [Get help when something goes wrong](40-troubleshooting/README.md)

<!-- END MANUAL FRONT DOORS -->

## Find your next task

You can give your agent a request in your own words. These guides explain what happens next and what to look for in the result.

| What you want to do                                           | Where to begin                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Review a change and make it part of the project.              | [Finish and land a change](10-guides/finish-and-land-a-change.md)         |
| Keep several tasks moving at once.                            | [Coordinate parallel tasks](10-guides/coordinate-parallel-tasks.md)       |
| Keep an improvement from slipping away.                       | [Set and raise standards](10-guides/set-and-raise-standards.md)           |
| Have agents ask an important review question when it matters. | [Place and answer checkpoints](10-guides/place-and-answer-checkpoints.md) |
| Resume work after a session ends.                             | [Recover an interrupted task](10-guides/recover-an-interrupted-task.md)   |
| Find a ready-made procedure for recurring work.               | [Create and manage skills](10-guides/create-and-manage-skills.md)         |

The [guides](10-guides/README.md) cover everyday tasks. [Understand](20-understand/README.md) explains the ideas behind them, and [Reference](30-reference/README.md) has commands, settings, supported coding tools, and exact formats.

## Read it anywhere

The website at [discern.sh/docs](https://discern.sh/docs) includes search. You can also run `discern docs` to read the same manual offline in your terminal: type to search, press Enter to open a page, and press `q` to close it. Your agent can retrieve these pages through `discern_docs`.

Append `.md` to a web page's address for its raw Markdown. The [CLI reference](30-reference/cli-reference.md#interactive-documentation-reader) covers direct targets, raw output, and paging.

## See the practice in use

discern is developed using its own checks, workspaces, and project instructions. Its agents maintain a [map of the codebase](https://discern.sh/map), which you can read to see the project knowledge they work from. The [decision records](https://discern.sh/docs/decisions) explain why the product works the way it does.
