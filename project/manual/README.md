---
id: manual-home
title: "The discern manual"
description: "Learn to hand coding agents real work, review what comes back, and decide what joins your project."
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

discern lets you hand coding agents substantial work, such as a whole feature, without coordinating every task yourself, explaining your project again each session, or taking an agent's word that the tests passed. Your project also gets better as the work goes on, because each gain you lock in, such as higher test coverage or a smaller download, holds for every change that follows.

Your agent runs discern for you, so this manual covers your side of the work: asking for what you want, reading what comes back, and deciding what joins your project. If you're still deciding whether discern fits, start with [Evaluate discern](00-start/evaluate-discern.md).

## Start here

<!-- BEGIN MANUAL FRONT DOORS -->

- [Set up discern in your project](00-start/installation-and-setup.md)
- [Split a big idea into tasks your agents can finish](20-guides/delegate-work.md)
- [See which checks a finished change passed](10-understand/proof.md)
- [Teach every future session a rule or a method](10-understand/instructions-skills-and-map.md)
- [Get help when something goes wrong](40-troubleshooting/README.md)

<!-- END MANUAL FRONT DOORS -->

## Find your next task

Ask your agent in your own words. Each guide shows what your agent does with the request and what to look for in what comes back.

| What you want to do                                                 | Where to begin                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Review a change and add it to your project.                         | [Finish and land a change](20-guides/finish-and-land-a-change.md)         |
| Keep several tasks moving at once.                                  | [Coordinate parallel tasks](20-guides/coordinate-parallel-tasks.md)       |
| Stop a hard-won improvement from slipping back.                     | [Set and raise standards](20-guides/set-and-raise-standards.md)           |
| Have your agent answer a review question when certain files change. | [Place and answer checkpoints](20-guides/place-and-answer-checkpoints.md) |
| Pick up a task after a session ends.                                | [Recover an interrupted task](20-guides/recover-an-interrupted-task.md)   |
| Give your agents a reusable method for work that repeats.           | [Create and manage skills](20-guides/create-and-manage-skills.md)         |

[Understand](10-understand/README.md) explains the ideas behind discern, and the [guides](20-guides/README.md) put them to work on everyday tasks. [Reference](30-reference/README.md) has the exact commands, settings, supported coding tools, and formats.

## Read it anywhere

Search the manual at [discern.sh/docs](https://discern.sh/docs), or run `discern docs` to read it offline in your terminal. There, type to search, press Enter to open a page, and press `q` to close it. Your agent reads the same pages through `discern_docs`, so you and your agent work from the same text.

Add `.md` to the end of a page's web address to get its raw Markdown. The [CLI reference](30-reference/cli-reference.md#interactive-documentation-reader) covers the reader's other keys, opening a page directly, raw output, and paging.

## See discern at work on itself

discern is built with discern. Its agents work in the same separate workspaces and hold the same kind of quality limits discern sets up for your project. Before a change lands, they run the project's formatter, linter, type checker, and tests. The [map of the codebase](https://discern.sh/map) those agents keep shows the project knowledge they work from, and the [decision records](https://discern.sh/docs/decisions) explain why the product works the way it does.
