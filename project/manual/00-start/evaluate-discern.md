---
id: start-evaluate-discern
title: "Evaluate discern"
description: "See what discern does for you and your agents, what it asks of you, and where its limits are, before you install it."
order: 20
publish: true
kind: explanation
aliases:
  - "start-evaluate-discern"
  - "orientation"
  - "introduction"
  - "start here"
  - "is discern right for me"
---

# Evaluate discern

With discern, one person can give coding agents substantial, complete pieces of work. You don't have to coordinate every task, explain your project again each session, or work out afterwards which checks passed. More of your backlog can move at once, and each finished change comes back with a record of what passed.

This page helps you decide whether discern belongs in your project, before you install anything.

## What working with discern looks like

Say you're building a reading-list app, and people want to find a book without scrolling. You ask your agent:

> Add a search box to the reading list, so people can find a book by title or author. Show me how to try it, and tell me what you checked before I decide whether it lands.

Your agent works in a **worktree**, a separate copy of the project on its own branch. Your project's shared branch, the **trunk** (usually `main`), stays untouched. The search joins the trunk only when it **lands**. Several agents can work at once, each in its own worktree. If another change lands first, discern checks the two changes together before the search lands.

When the search works, your agent commits it and runs the **gate**, the checks your project requires before a change counts as finished. These might build the app and run its tests. If a check fails, the agent investigates and fixes the cause. When every check passes, discern records **Proof**: which checks passed, on exactly which version of the code. The agent ends its report with a line like this:

> **Proof:** Gate passed for `agent/reading-list-search-4e1f2a` at `9b3c71d0e5a2` · 4 files changed (+96 −8) vs `main` · View the full Proof: `discern status --verbose`

The line names the task's branch and the commit, a saved version of the code, that the checks ran on. You don't have to take the agent's word for it. A pass tells you those checks passed. Whether the search helps people find their books is still your call, so you try it, ask what the checks don't cover, and decide whether it lands. If you ask for a change, the agent runs the gate again, because the first Proof covered only the first version. [Proof](../10-understand/proof.md) explains how to read the line.

## Your project gets better with every task

discern turns each improvement into something later work has to keep, so the next task starts from a better project.

- **Quality limits only tighten.** A **standard** holds a limit on something your project can measure, such as test coverage or the size of the app's download. A later change can't loosen it to make its own work pass unless you approve. When a change improves the measure, you can lock in the new level for every change after it.
- **Fixed bugs stay fixed.** discern includes a bug-fixing **skill**, a ready-made playbook your agent follows. It has the agent find the real cause, fix every instance, and add a check that fails if the bug comes back.
- **Lessons carry forward.** Say you decide the reading list must work offline. Your agent writes that rule and its reason into the project's instructions, and adds checks where it can. Every later session reads the rule, whichever supported coding agent you use.

Your agents also keep a **map**: a guide to how the project works, written in ordinary files. You can read it to see what they understand, and correct what they got wrong.

## Built for your agent to operate

Your agent runs discern for you, so discern treats the agent as its main user. Each result is short and names the next step. When a check fails, the agent gets its output and the command that reproduces it. A quick check loop catches simple mistakes, such as formatting and type errors, before the full gate runs. For common jobs, such as splitting a big piece of work into tasks, the agent has a skill to follow.

That leaves more of the agent's attention for your project. For you, it means less time unblocking your agent, and more of its effort in the work you asked for. You don't need to learn discern's commands.

## What it asks of you

**A setup session.** Your agent sets discern up. It studies the project, connects the checks your project already runs, and writes the instructions and map that later sessions will use. Expect roughly 20 to 40 minutes of agent time and a meaningful number of tokens. You confirm what setup may change, and you answer what only you can: what the project is for, and anything that involves cost, access, data, or new dependencies. Setup happens on a separate branch and comes back to you for review before it lands.

**Plain requests.** After setup, you ask for work the way you asked for search. Your agent follows discern's instructions and the next step each result names.

**Time to review.** You still try the results and make the decisions. For a small change you can see, trying it and reading the Proof may be enough. How far to go depends on what the change could affect. When a change touches something you can't judge yourself, such as security, ask for an independent review.

## What fits your project

discern works with any language and tools, because it runs the commands your project already uses. It needs Git, which keeps each task on its own branch. If your project isn't in Git yet, your agent offers to set that up first. One setup covers a whole Git repository, even one that holds several apps.

It supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. It runs on macOS and Linux, and on Windows through WSL 2. [Platforms and providers](../30-reference/platforms-and-providers.md) has the details.

It helps most when you want agents to take on bigger pieces of work, and you want to know which checks passed before a change joins your project. Your agent runs discern day to day, so discern only helps if you work with a coding agent.

## Where the boundaries are

**It runs on your machine.** discern is one program with no AI model, account, or API key of its own. It keeps a local activity record with metadata such as timings and outcomes. That record leaves out your code and command output, and you can turn it off. There's no hosted dashboard. To see your tasks at a glance, you run `discern` in your project folder to open the **desk**, an interactive view in your terminal. Your agent still uses its own provider, and your project's commands can still reach the network. [What stays on your machine](../10-understand/local-control.md) explains more.

**Nothing lands without your permission.** A passing gate doesn't give permission to land. You approve each change yourself, or pre-approve routine areas, such as documentation, and everything else still comes back to you. Landing isn't releasing, either. Getting a change to your users stays with your own release process.

**Your files stay yours.** The instructions, map, and other files you and your agents write are ordinary files in your repository. If you remove discern, `discern uninstall` takes out its wiring and keeps what you wrote. discern never updates itself, so you choose when to upgrade. discern is Fair Source software, and the material it writes into your project comes under the Apache 2.0 license. [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md) and [Licenses](../30-reference/licenses.md) have the details.

## Decide

If this is how you'd like your agents to work, [install and set up discern](installation-and-setup.md). After setup, the next tutorial takes you through a small change you can try yourself.

For a closer look at who does what, read [How discern works](../10-understand/how-discern-works.md).
