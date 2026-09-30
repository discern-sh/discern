---
id: explanation-instructions-skills-and-map
title: "Instructions, skills, and the map"
description: "Teach your agents something once, and every later session starts out knowing it, whichever coding agent you use."
order: 70
publish: true
kind: explanation
aliases:
  - "explanation-instructions-skills-and-map"
  - "What a skill is"
  - "skill"
  - "playbook"
  - "skill discovery"
  - "map"
---

# Instructions, skills, and the map

Teach your agent something, have it write the lesson into your project, and every later session starts out knowing it. You don't have to explain it again next week, or to a different agent.

A lesson left in one conversation doesn't reach the next session, which may make the same mistake again. So your project keeps its lessons in ordinary files beside the code: **instructions** hold the rules every session needs, **skills** hold methods for particular jobs, and the **map** explains how the project works. Your agents write and maintain these files, so each task leaves the next one better informed.

## Follow one lesson into the next session

Say people use your app to save articles to read later, and on a train you find that saved lists won't open offline. Your agent fixes that and adds a test that opens a saved list with the network off. Then you ask:

> "Make sure future agents know saved lists have to open without an internet connection, and why."

Your agent writes the rule into the project instructions and the reason into the map. The next session reads the rule first and finds the reason when it needs it, without the story of your train ride. The test catches a change that breaks offline reading, and the rule tells later agents why the test matters.

## Instructions: what every session needs

A rule such as "saved lists must open offline" belongs in the project instructions, `discern/instructions.md` by default. discern writes your rules, with its own built-in instructions, into the file each coding agent reads, such as `AGENTS.md` or `CLAUDE.md`. So every agent gets the same rules, even after you switch agents.

Every session reads the instructions in full when it starts, so keep each rule short, with the longer reasoning in the map. [Write project instructions](../20-guides/write-project-instructions.md) shows how to add one.

## Skills: methods your agent loads when needed

Say you've found a good way to review a new screen: try each of its states, such as empty, loading, and failed, and check that people can tell what happened and what to do next.

A **skill** holds a method like that. Your agent sees only its short description until a job calls for it, then reads the full steps.

discern ships skills for jobs such as fixing a bug for good or splitting big work into tasks. Your project can add its own or adapt discern's, as [Create and manage skills](../20-guides/create-and-manage-skills.md) shows. Write each skill to stand on its own, because "review it like last time" sends the next session looking for a conversation it can't see.

## The map: how your project works

The **map** is your project's own guide, in `discern/map/` by default, and your agents keep it current. For saved lists, it might explain where the app keeps them, what uses them, and why offline reading matters. Each point links to the code and tests behind it.

Reading the map shows you what your agents understand, so you can correct a misunderstanding before it turns into code. Ask:

> "What does the project's guide say about saved lists? Does it still match the app after this change?"

Before a change can finish, discern checks the map's links and command examples and points your agent to the pages that link to the code the change touched. None of that proves a page is true, so your agent still checks each explanation against the code. [Maintain the project map](../20-guides/maintain-project-map.md) shows how to review a page.

## ADR: the reason behind a big decision

Say you decide people can keep a reading list without an account, even though that limits syncing between devices. An **Architecture Decision Record**, or **ADR**, keeps what you decided, why, and the cost you accepted. A later agent then understands the choice before it proposes undoing it. Your agent writes one for a choice that's hard to reverse, surprising without context, and a real trade-off. An ADR only records a decision, so it can't excuse an agent from a requirement you've agreed to.

## Pick the right home

You don't need to know where each thing goes. Ask your agent to "capture this lesson", and it picks the smallest home that fits, updating an existing one instead of adding another.

| What you want to keep                                                 | Where it goes                       |
| --------------------------------------------------------------------- | ----------------------------------- |
| A rule: saved lists open offline.                                     | The project instructions.           |
| A method: review a new screen in each of its states.                  | A skill.                            |
| A question to ask when a change touches saving: is offline use clear? | A [checkpoint](checkpoints.md).     |
| A fixed series of steps: load sample articles for a preview.          | A project script the agent can run. |
| How it works: where saved lists live and what uses them.              | The map.                            |
| A big decision: why accounts are optional.                            | An ADR.                             |

A measurable gain, such as a smaller download, belongs in a [standard](standards.md), so ask for that one directly.

Your agent also offers to capture a lesson at a natural pause, such as after you correct it, and you decide what the project keeps.

## Whose writing is which

Your project's README and its own docs stay yours. This manual explains discern itself, and [discern's own map](https://discern.sh/map) shows what a map looks like.
