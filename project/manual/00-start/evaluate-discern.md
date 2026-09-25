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

With discern, one person can hand coding agents substantial, complete pieces of work and keep more of the backlog moving at once, without coordinating every task or explaining the project again each session. Each finished change comes back with a record of which of your project's commands passed, so you don't have to take an agent's word that the tests ran.

This page helps you decide whether discern belongs in your project before you install anything.

## What working with discern looks like

Say you're building a reading-list app, and people want to find a book without scrolling. You ask your agent:

> "Add a search box to the reading list, so people can find a book by title or author. Show me how to try it, and tell me what you checked before I decide whether it lands."

Your agent makes the change in a **worktree**, a separate copy of the project on its own branch, so your project's shared branch, the **trunk** (usually `main`), stays untouched while it works. The search joins the trunk only when it **lands**. Several agents can work at once, each in its own worktree, and if another change lands first, discern checks the two changes together before the search lands.

When the search works, your agent commits it and runs the **gate**: your project's own commands, such as its build, linter, and test suite, which must all pass before a change counts as finished. If a test fails, your agent gets the failing command and its output, finds the cause, and fixes it. When everything passes, discern records **Proof**: which of those commands passed, and on which commit, a saved version of the code. Your agent ends its report with a line like this:

> **Proof:** Gate passed for `agent/reading-list-search-4e1f2a` at `9b3c71d0e5a2` · 4 files changed (+96 −8) vs `main` · View the full Proof: `discern status --verbose`

The line names the task's branch and the commit the commands ran on. A pass tells you those commands passed, and nothing more: whether the search helps people find their books is still your call. So you try it, type "Le Guin", and see her novels appear. If something's off, you ask for a fix, and your agent runs the gate again, because the first Proof covered only the first version. Here the search works, so you tell your agent to "land it", and discern lands the search on the trunk. [Proof](../10-understand/proof.md) explains how to read the line.

## Your project gets better with every task

Quality tends to slip in steps too small to notice: a skipped test, a slightly larger download, a fixed bug that comes back. discern turns each improvement into something later work has to keep, so the next task starts from a better project.

- **Quality limits only tighten.** A **standard** holds a limit on something your project can measure, such as test coverage or the size of the app's download. A change can't loosen a limit to get itself through, because raising one takes your approval. When a change improves the measure, you can lock in the new level for every change after it.
- **Fixed bugs stay fixed.** discern includes a bug-fixing **skill**, a ready-made playbook your agent follows when it fixes a bug: find the real cause, fix every instance, and add a test or lint rule that fails if the bug comes back.
- **Lessons carry forward.** Say you decide the reading list must work offline. Your agent writes that rule and its reason into the project's instructions, and adds a test where one can enforce it. Every later session reads the rule, whichever supported coding agent you use.

Your agents also keep a **map**: a guide to how the project works, written in ordinary files. You can read it to see what they understand, and correct what they got wrong.

## Built for your agent to operate

Your agent runs discern for you, so discern treats the agent as its main user. Each result is short and names the next step. When a test fails, your agent gets the failing command, its output, and a command that reproduces that failure on its own. A faster loop applies your formatter and runs quick checks, such as the linter and type checker, without the test suite, so simple mistakes surface before the full gate runs. For common jobs, such as splitting a big piece of work into tasks, your agent has a skill to follow.

That leaves more of your agent's attention for your project, which means less time unblocking it and more of its effort in the work you asked for. You don't need to learn discern's commands.

## What it asks of you

**A setup session.** Your agent sets discern up: it studies the project, connects your existing tests, linter, and other commands to the gate, and writes the instructions and map that later sessions will use. Expect roughly 20 to 40 minutes of agent time and a meaningful number of tokens. You confirm what setup may change and answer what only you can: what the project is for, and anything that involves cost, access, data, or new dependencies. Setup happens on a separate branch and comes back to you for review before it lands.

**Plain requests.** After setup, you ask for work the way you asked for search. Your agent follows discern's instructions and the next step each result names.

**Time to review.** You still try the results and make the decisions. For a small change you can see, trying it and reading the Proof is often enough. How far to go depends on what the change could affect. When a change touches something you can't judge yourself, such as security, ask for an independent review.

## What fits your project

discern works with any language and tools, because it runs the commands your project already uses. It needs Git, because each task gets its own branch, and if your project isn't in Git yet, your agent offers to set that up first. One setup covers a whole Git repository, even one that holds several apps.

It supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. It runs on macOS and Linux, and on Windows through WSL 2. [Platforms and providers](../30-reference/platforms-and-providers.md) has the details.

It helps most when you want agents to take on bigger pieces of work and want to know what passed before a change joins your project. Your agent runs discern day to day, so discern only helps if you work with a coding agent.

## Where the boundaries are

**It runs on your machine.** discern is one program with no AI model, account, or API key of its own, so there's nothing to sign up for and no service to keep running. It keeps a local activity record with metadata such as timings and outcomes, which leaves out your code and command output, and you can turn it off. There's no hosted dashboard: to see your tasks at a glance, you run `discern` in your project folder to open the **desk**, an interactive view in your terminal. Your agent still uses its own provider, and your project's commands can still reach the network. [What stays on your machine](../10-understand/local-control.md) explains more.

**Nothing lands without your permission.** A passing gate doesn't give permission to land. You approve each change yourself, or pre-approve routine areas, such as documentation, and everything else still comes back to you. Landing isn't releasing, either: getting a change to your users stays with your own release process.

**Your files stay yours.** The instructions, map, and other files you and your agents write are ordinary files in your repository. If you remove discern, `discern uninstall` takes out its wiring and keeps what you wrote. discern never updates itself, so you choose when to upgrade. discern is Fair Source software, and what it adds to your project, such as its built-in instructions and skills, comes under the Apache 2.0 license. [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md) and [Licenses](../30-reference/licenses.md) have the details.

## Decide

If this is how you'd like your agents to work, [install and set up discern](installation-and-setup.md). After setup, the next tutorial takes you through a small change you can try yourself.

For a closer look at who does what, read [How discern works](../10-understand/how-discern-works.md).
