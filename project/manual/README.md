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

discern lets you hand coding agents substantial work without coordinating every task, explaining your project again, or working out afterwards which checks passed. Your project also gets better as the work goes on, because you can lock in each gain for the changes that follow.

Your agent runs discern for you. This manual shows you how to direct the work, read what comes back, and decide what joins your project. If you're still deciding whether discern fits, start with [Evaluate discern](00-start/evaluate-discern.md).

## Start here

<!-- BEGIN MANUAL FRONT DOORS -->

- [Set up discern in your project](00-start/installation-and-setup.md)
- [Split a big idea into tasks your agents can finish](10-guides/delegate-work.md)
- [See which checks a finished change passed](20-understand/proof.md)
- [Teach every future session a rule or a method](20-understand/instructions-skills-and-map.md)
- [Get help when something goes wrong](40-troubleshooting/README.md)

<!-- END MANUAL FRONT DOORS -->

## Find your next task

Ask your agent in your own words. These guides show what happens next and what to look for in the result.

| What you want to do                                                 | Where to begin                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Review a change and add it to your project.                         | [Finish and land a change](10-guides/finish-and-land-a-change.md)         |
| Keep several tasks moving at once.                                  | [Coordinate parallel tasks](10-guides/coordinate-parallel-tasks.md)       |
| Stop a hard-won improvement from slipping back.                     | [Set and raise standards](10-guides/set-and-raise-standards.md)           |
| Have your agent answer a review question when certain files change. | [Place and answer checkpoints](10-guides/place-and-answer-checkpoints.md) |
| Pick up a task after a session ends.                                | [Recover an interrupted task](10-guides/recover-an-interrupted-task.md)   |
| Give your agents a reusable method for work that repeats.           | [Create and manage skills](10-guides/create-and-manage-skills.md)         |

The [guides](10-guides/README.md) cover everyday tasks. [Understand](20-understand/README.md) explains the ideas behind them. [Reference](30-reference/README.md) has the exact commands, settings, supported coding tools, and formats.

## Read it anywhere

You can search this manual at [discern.sh/docs](https://discern.sh/docs). To read it offline, run `discern docs` in your terminal. Type to search, press Enter to open a page, and press `q` to close it. Your agent reads the same pages through `discern_docs`.

Add `.md` to the end of a page's web address to get its raw Markdown. The [CLI reference](30-reference/cli-reference.md#interactive-documentation-reader) covers the reader's other keys, opening a page directly, raw output, and paging.

## See discern at work on itself

discern's own development runs on discern. It uses the same separate workspaces, checks, and quality limits it sets up for your project. The agents that build it keep a [map of the codebase](https://discern.sh/map), where you can read the project knowledge they work from. The [decision records](https://discern.sh/docs/decisions) explain why the product works the way it does.
