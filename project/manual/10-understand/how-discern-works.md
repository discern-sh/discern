---
id: explanation-practice-and-roles
title: "How discern works"
description: "See who does what, how a change goes from your request to landed, and how your project gets better with each task."
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
redirect_from:
  - "/docs/understand/practice-and-roles"
---

# How discern works

discern lets you hand coding agents substantial work without coordinating every step, explaining your project again each session, or working out afterwards what was tested. Your project gets better as the work goes on, too, because each gain you lock in holds for every change that follows.

It works by giving each part of the job a clear owner, so your time goes into the decisions only you can make.

## Who does what

**You set the direction and decide what lands.** You know who the software is for and what would make it better. "Help people find a saved item without scrolling through a long list" gives your agent a real problem to solve, and you can add limits, such as keeping the existing lists as they are and making it work on a phone. When the work comes back, you review it and decide whether it lands.

**Your agent does the work, and runs discern.** It studies the project, proposes an approach when there's a choice to make, makes the change, and runs the tests. When something fails, it investigates, and when a decision needs you, it brings you the question with a recommendation. You don't need to learn discern's commands, because your agent runs them for you. What it can read and run on your machine is up to your coding agent's own permission settings, since discern doesn't sandbox it.

**discern runs your project's commands and keeps the records.** It has no AI model of its own, so your agent does the thinking. discern gives each task its own copy of the project, runs your project's own commands, records which of them passed, and lands a change on your shared branch only with your permission.

**The project keeps what the next task needs.** Alongside the code, it holds the working rules, a guide to how the project works, reusable procedures, its quality limits, and a record of what passed for each change that landed. When your agent writes a lesson down there, every later session can use it. A lesson left in a conversation is gone when the conversation ends.

## One task, start to finish

Say you ask your agent:

> "Add a search box to the saved items page, so people can find an item by name. Show me the result on a phone-sized screen, and explain what you checked before I decide whether to land it."

**Your agent gets its own copy of the project.** It makes the change in a **worktree**, a separate copy of the project on its own branch, so your shared branch, the **trunk** (usually `main`), stays untouched while it works.

**It builds the search box and a test for it,** fixing whatever the tests or the project's code-quality tools, such as its linter and type checker, flag along the way.

**It runs the gate.** Once the final version is committed, your agent runs the **gate**, which runs your project's own commands, such as its formatter, linter, type checker, and test suite. The change counts as finished only when every one of them passes. A pass produces **Proof**, discern's record of which commands passed on exactly which commit, and your agent ends its report with a one-line summary:

> **Proof:** Gate passed for `agent/saved-items-search-965ee6` at `31eeb211f851` · 3 files changed (+20 −0) vs `main` · Standards held · View the full Proof: `discern status --verbose`

**You review.** Proof tells you the tests passed on that commit, but not whether search feels right, so you try it on your phone. Say a search for something you haven't saved leaves the page blank. You ask for a short message instead, and your agent adds it in the same worktree and runs the gate again, because Proof covers one exact commit, and any later edit makes it stale. [Proof](proof.md) explains how to read the line, and what it leaves for you to judge.

**The change lands.** When you're satisfied, you say "land it". discern checks that the Proof is current and that your permission covers the change, then moves the trunk to it. A passing gate never grants that permission: you can approve each change yourself, or pre-approve routine work within limits you set. Releasing it to your users stays a separate step in your own release process.

## Your project gets better, not just bigger

Agents can add code faster than anyone can read it, so quality can slip one small change at a time without anyone deciding to let it go. discern keeps what each task improves, so later work starts from those gains.

- **Quality limits only tighten.** A **standard** holds a measured limit, such as test coverage or how much someone has to download to open the app. A later change can't loosen the limit to make its own work pass; only you can approve that. When a change improves the measure, you can lock in the new level, and every change after it has to meet it.
- **Fixed bugs stay fixed.** discern ships a bug-fixing **skill**, a ready-made playbook your agent follows, that has it prove the real cause, fix every instance of it, and leave a test or lint rule that fails if the problem comes back.
- **Lessons carry forward.** Say that while reviewing search, you decide saved items must stay searchable without an internet connection. Your agent writes that rule and its reason into the project, and adds a test for it. From then on, every agent that changes the app reads the rule before it starts and runs the test before it finishes, so you don't have to explain it again.

Those rules don't belong to one coding agent. discern writes the same project instructions, from one source, into the files that Claude Code, Codex, Gemini, Cursor, and GitHub Copilot each read, so you can switch agents without rewriting them. Each tool's own features and conversation history stay with that tool.

## Built for your agent to operate

Most developer tools are designed for people at a keyboard. discern treats your coding agent as its main user.

- Every result is short and names the next step, so your agent doesn't have to work out where it is.
- When a test fails, the result names the step that failed, shows the first error from its output, and gives the command that reruns that step on its own.
- A fast loop runs the formatter, linter, and type checker without the test suite, so your agent fixes those errors before the full gate runs.
- For common jobs, such as splitting big work into tasks, discern ships a skill.
- When your agent needs documentation, a search returns the few pages that matter.

That leaves more of your agent's context, the limited amount it can hold in mind at once, for understanding and changing your project. For you, it means less time unblocking your agent, and more of its effort in the work you asked for.

## What discern gives you

| When you want to…                                       | discern gives you                                                                                                                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know what passed before a change lands                  | The gate runs your project's tests and other commands, and [Proof](proof.md) records what passed on that exact commit.                                                                                                |
| Give several agents work at once                        | [Worktrees](worktrees-and-trunk.md) give each task its own copy of the project, so one agent's edits never overwrite another's.                                                                                       |
| Put a question to your agent whenever a change needs it | [Checkpoints](checkpoints.md) ask your agent for a recorded answer, such as whether a new form explains what happens to the information it collects. Only you can approve landing a change your agent answered unmet. |
| Stop a hard-won improvement from slipping back          | [Standards](standards.md) hold a measured limit that later changes must meet.                                                                                                                                         |
| Make future sessions follow a rule or reuse a method    | [Instructions, skills, and the map](instructions-skills-and-map.md) store rules, reusable procedures, and the project's own account of how it works.                                                                  |

To try all this on a small task, follow [Make and review your first change](../00-start/first-real-change.md). For something bigger, [Delegate substantial work](../20-guides/delegate-work.md) shows how your agent can break it into pieces.
