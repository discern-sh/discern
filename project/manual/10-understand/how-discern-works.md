---
id: explanation-practice-and-roles
title: "How discern works"
description: "Who does what, how a change goes from request to landed, and how your project gets better with every task."
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

discern lets you hand coding agents substantial work without coordinating every step, re-explaining your project each session, or working out afterwards what was checked. Your project also gets better as the work goes on. Each improvement can be locked in for every change that follows.

It works by giving each part of the job a clear owner. You decide what to build and what ships. Your agent does the work, and discern is built for it to operate, so its effort goes into your project. The project remembers what the next task needs to know.

## Who does what

**You set the direction.** You know who the software is for and what would make it better. "Help people find a saved item without scrolling through a long list" gives the agent a real problem to solve. You can add limits too: keep the existing lists as they are, and make it work on a phone. When the work comes back, you review it and decide whether it lands.

**Your agent does the work, and runs discern.** It studies the project, proposes an approach when there's a choice to make, makes the change, and runs the checks. When something fails, it investigates. When a decision needs you, it brings you the question with a recommendation. You don't need to learn discern's commands. The agent runs them for you.

**The project remembers.** Alongside the code, the project keeps its working rules, a guide to how it works, reusable procedures, its quality limits, and a record of completed checks. When an agent writes a lesson down there, every later session can use it. A lesson left in a conversation is lost when the conversation ends.

## One task, start to finish

Say you ask:

> Add a search box to the saved items page, so people can find an item by name. Show me the result on a phone-sized screen, and explain what you checked before I decide whether to land it.

1. **The agent gets its own workspace.** It creates a **worktree**, a separate copy of the project on its own branch. Your shared branch, the **trunk** (usually `main`), stays untouched while the work is in progress.
2. **The agent makes the change and checks it,** fixing whatever fails along the way.
3. **The agent runs the gate.** It commits the final version and runs the **gate**, the full set of checks your project requires. A pass produces **Proof**: a record of which checks passed, on exactly which commit.
4. **You review.** The agent shows you the result and explains the Proof. You try finding an item, check the layout, and ask what happens when nothing matches. If you want changes, the agent makes them in the same worktree and runs the gate again.
5. **The change lands.** When you're satisfied, you give permission, and discern checks both the Proof and your permission before the change **lands** on the trunk. Releasing it to your users stays a separate step in your own release process.

## Your project gets better, not just bigger

Agents can add code faster than anyone can read it. discern keeps what each task improves, so later work starts from those gains.

- **Quality limits only tighten.** A **standard** holds a measured limit, such as test coverage or how much someone has to download to open the app. A later change can't loosen the limit on its own to make its work pass; only you can approve that. When a change improves the measure, you can lock in the new level, and every change after it has to meet it.
- **Fixed bugs stay fixed.** discern's bug-fixing skill has your agent find the real cause, fix every instance of it, and add a check that fails if the problem comes back.
- **Lessons carry forward.** Say you decide that saved lists must open without an internet connection. Your agent writes the rule and its reason into the project, and adds checks for what it can test. From then on, every agent that changes the app reads the rule and faces the same checks, and you never have to explain it again.

The lessons survive a change of tools, too. discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot, and gives each one the same project instructions from a single source. You can switch agents without rewriting your rules. Each tool's own features and conversation history stay with that tool.

## Built for your agent to operate

Most developer tools are designed for people at a keyboard. discern treats your coding agent as its main user.

- Every result is short and names the next step, so the agent doesn't have to work out where it is.
- When something fails, the result says what failed and gives the command that reproduces it.
- A quick check loop catches formatting, lint, and type errors before the full gate runs.
- For common jobs, such as splitting big work into tasks, discern provides a ready-made playbook called a **skill**.
- When the agent needs documentation, a search returns the few pages that matter.

That leaves more of the agent's context, the limited amount it can hold in mind at once, for understanding and changing your project. For you, it means less time unblocking your agent, and more of its effort in the work you asked for.

## What discern gives you

| When you want to…                                       | discern gives you                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know what was checked before a change lands             | The gate runs your project's checks, and [Proof](proof.md) records what passed on that exact commit.                                                    |
| Give several agents work at once                        | [Worktrees](worktrees-and-trunk.md) give each task its own copy of the project, so one agent's edits never overwrite another's.                         |
| Have a question asked whenever a certain change happens | [Checkpoints](checkpoints.md) ask the agent for a recorded answer. For example: does this new form explain what happens to the information it collects? |
| Stop a hard-won improvement from slipping back          | [Standards](standards.md) hold a measured limit that later changes must meet.                                                                           |
| Make future sessions follow a rule or reuse a method    | [Instructions, skills, and the map](instructions-skills-and-map.md) store rules, reusable procedures, and the project's own account of how it works.    |

discern has no AI model of its own. Your coding agent does the thinking. discern runs the process around it: the workspaces, the checks, and the records.

## What stays with you

A passing gate means your project's checks passed. It can't tell you whether a feature helps people or whether a design is right. Ask your agent what the checks don't cover, and ask for more checks or an independent review when the change warrants it.

You also decide how much to delegate. You can approve every change before it lands, or pre-approve routine work within limits you set. Passing checks never grants permission to land. [Proof](proof.md) explains how permission works.

discern doesn't sandbox your agent. Your agent's own permission settings govern what it can read and run. [What stays on your machine](local-control.md) explains what discern itself runs, records, and writes.

To try all this on a small task, follow [Make and review your first change](../00-start/first-real-change.md). For something bigger, [Delegate substantial work](../20-guides/delegate-work.md) shows how your agent can break it into pieces.
