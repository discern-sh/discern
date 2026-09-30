---
id: explanation-practice-and-roles
title: "How discern works"
description: "Decide whether discern fits your project, and see who does what as a change goes from your request to your shared branch."
order: 20
publish: true
kind: explanation
aliases:
  - "explanation-practice-and-roles"
  - "Concepts: how discern fits together"
  - "concepts"
  - "overview"
  - "mental model"
  - "Practice and roles"
  - "Design principles"
  - "principles"
  - "philosophy"
  - "design"
  - "why"
  - "practice"
  - "start-evaluate-discern"
  - "Evaluate discern"
  - "What is discern?"
  - "orientation"
  - "introduction"
  - "start here"
  - "is discern right for me"
redirect_from:
  - "/docs/understand/practice-and-roles"
  - "/docs/understand/how-discern-works"
  - "/docs/start/evaluate-discern"
---

# How discern works

discern lets you hand coding agents substantial work, and keep several tasks moving at once, without coordinating every step or explaining your project again each session. Each finished change comes back with a record of which of your project's commands passed, so you don't have to take an agent's word that the tests ran.

Your project also gets better as the work goes on, because each gain you lock in holds for every change that follows.

## Who does what

Each part of the job has one owner, so your time goes into the decisions only you can make.

- **You** set the direction, try what comes back, and decide what lands.
- **Your agent** does the work and runs discern for you, so you don't need to learn discern's commands.
- **discern** runs your project's own commands, records which passed, and lands a change on your shared branch only with your permission. It has no AI model of its own, so the thinking stays with your agent.

## One task, from request to landing

Say people using your reading-list app want to find a book without scrolling. You ask your agent:

> "Add search to the reading list, so people can find a book by title or author. Show me how to try it, and tell me what you checked before I decide whether it lands."

Your agent makes the change in a **worktree**, a separate copy of the project on its own branch, so your shared branch, the **trunk** (usually `main`), stays untouched while it works. Several agents can work at once, each in its own worktree. Running `discern` in your project folder opens the **desk**, a view in your terminal that [shows which tasks need your decision](../20-guides/coordinate-parallel-tasks.md#decide-from-the-desk).

When the search works, your agent commits it and runs the **gate**: your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. When they pass, discern records **Proof** of which commands passed on that exact commit, the saved version of the code they ran on. Your agent's report ends with a line like this:

> **Proof:** Gate passed for `agent/reading-list-search-4e1f2a` at `9b3c71d0e5a2` · 4 files changed (+96 −8) vs `main` · View the full Proof: `discern status --verbose`

A pass means those commands passed on that commit, and nothing more, so whether the search helps people is still your call. You try it: "Le Guin" brings up her novels, but a search with no match leaves the page blank. You ask for a short message instead. Your agent adds it in the same worktree and runs the gate again, because any later edit makes Proof stale. [Proof](../10-understand/proof.md) explains how to read the line.

When you're satisfied, you say "land it". discern checks that the Proof is current and that your permission covers the change. Then the search **lands**: it joins the trunk. If another task landed first, discern [checks the two changes together](../20-guides/finish-and-land-a-change.md#when-other-work-lands-first) and lands exactly what passed, so the search doesn't go back to the start.

## Your project gets better with every task

Agents can add code faster than anyone can read it, so quality can slip in steps too small to notice: a skipped test, a slightly larger download, a fixed bug that comes back. discern turns each improvement into something later work has to keep.

- **Quality limits only tighten.** A **standard** is a measured limit your project holds, such as its test coverage or download size. No change can loosen it without your approval. When a measure improves, you can lock in the new level for every change after it.
- **Fixed bugs stay fixed.** discern's bug-fixing **skill**, a playbook your agent follows for that job, has it find the real cause, fix every instance, and add a test or lint rule that fails if the bug comes back.
- **Lessons carry forward.** Say you decide the reading list must work offline. Your agent writes that rule into the project's instructions and adds a test for it, so every later agent reads the rule and every later change has to pass the test. The reason goes into the **map**, your project's guide to how it works, which your agents keep current, so you can see what they understand.

## Built for your agent to operate

Because your agent runs discern, discern treats the agent as its main user, so each result is short and names the next step. A failing test comes with its output and a command that reruns it on its own, so your agent goes straight to the cause. For common jobs, such as splitting big work into tasks, your agent has a skill to follow, and discern's documentation search returns the few pages a task needs.

That leaves more of your agent's context, the limited amount it can hold in mind at once, for understanding and changing your project. For you, it means less time unblocking your agent, and more of its effort in the work you asked for.

## What it asks of you

**A setup session.** Your agent studies the project, connects its existing commands to the gate, and writes the instructions and map that later sessions use. Expect 20 to 40 minutes of agent time and a meaningful number of tokens. You answer what only you can, such as what the project is for, and review the setup before it lands.

**Time to review.** For a small change you can see, trying it and reading the Proof is often enough. When a change touches something you can't judge yourself, such as security, ask for an independent review.

## What fits your project

discern is for people who build with a coding agent, and it helps most when you want agents to take on bigger pieces of work. It works with any language and tools, because it runs the commands your project already uses. It needs Git, which your agent offers to set up if your project doesn't use it yet. One setup covers a whole repository, even one that holds several apps.

It supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot, on macOS, Linux, and Windows through WSL 2. discern writes the same project instructions into the files each of those agents reads, so your rules come with you when you switch agents. [Platforms and providers](../30-reference/platforms-and-providers.md) has the details.

## Where the boundaries are

**It runs on your machine.** discern is one program: there's no account, API key, or service to set up. Its local record of what its commands did holds metadata such as timings, never your code or command output, and you can turn it off. discern doesn't sandbox your agent, so your agent's own settings decide what it can read and run. Your agent still uses its own model provider, and your project's commands can still reach the network. [What stays on your machine](../10-understand/local-control.md) explains more.

**Nothing lands without your permission.** A passing gate never grants it. You approve each change yourself, or pre-approve routine areas, such as documentation, and everything else comes back to you. No pre-approval covers a looser limit or an unmet answer to a **checkpoint**, a review question your agent answers when a change touches certain files. Those need your decision each time. Landing isn't releasing, either: shipping to your users stays with your own release process.

**Your files stay yours.** What you and your agents write stays in ordinary files in your repository, and `discern uninstall` keeps them when it removes discern's wiring. discern never updates itself, so you choose when to upgrade. discern is Fair Source software, and what it adds to your project, such as its built-in instructions and skills, comes under the Apache 2.0 license. [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md) and [Licenses](../30-reference/licenses.md) have the details.

## Where to go next

To try it, [install and set up discern](installation-and-setup.md). To go deeper, read about [Proof](../10-understand/proof.md), [worktrees](../10-understand/worktrees-and-trunk.md), [checkpoints](../10-understand/checkpoints.md), [standards](../10-understand/standards.md), and [instructions, skills, and the map](../10-understand/instructions-skills-and-map.md).
