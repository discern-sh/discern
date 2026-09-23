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

When you teach your agent something, discern keeps the lesson in your project, so every later session starts out knowing it. You don't have to explain it again next week, or to a different agent.

Your project keeps what it learns in ordinary files beside the code. **Instructions** hold the rules every session needs. **Skills** hold methods for particular jobs. The **map** explains how the project works. Your agents write and maintain these files, so each task leaves the next one better informed.

## Follow one lesson into the next session

Say you're building an app where people save articles to read later. You try it on a train and find that saved lists won't open without an internet connection. Your agent fixes that and adds checks. Then you ask:

> Record that saved lists must open without an internet connection, and explain why in the map. Future agents need to know this when they change the app.

The next session finds both the rule and the reason. It doesn't need the story of your train ride. The checks catch a change that breaks offline reading. The rule tells every later agent why it matters, before it writes any code.

Without this, the lesson stays in one conversation. A new session has no way to find it, and may make the same mistake again.

## Instructions: what every session needs

A rule such as "saved lists must open offline" belongs in the project instructions. By default, their source is `discern/instructions.md`.

Your agent edits that source and runs `discern refresh`. discern combines your rules with its own built-in instructions and writes the file each coding agent reads, such as `AGENTS.md` or `CLAUDE.md`. You write the rules once, and every agent your project uses gets them. If you switch agents, the rules come with you.

The **gate**, your project's full set of checks, confirms that those files still match their source. If they don't, the agent runs `discern refresh` again. A session that's already running may still have the old version loaded, so start a new one to be sure it reads the change.

Every session reads the instructions in full, so keep each rule short. Put the longer reasoning in the map, and link to it from the rule.

## Skills: methods your agent loads when needed

Say you've found a good way to review a new screen. Try it with no saved articles, with several, while it loads, and when something fails. In each case, check that people can tell what happened and what to do next.

A **skill** holds a method like that. Its short description tells the agent when the skill applies, and the agent reads the full steps only when it does. So a session carries only that short description until the job needs the rest.

discern ships skills for jobs such as fixing a bug so it stays fixed, splitting big work into tasks, and recording a lesson. Your project can add its own. A skill you write with the same name as a bundled one replaces it. [Create and manage skills](../10-guides/create-and-manage-skills.md) shows how.

Write a skill so it stands on its own. Say what the method needs, which choices to make, what to hand back, and when to stop and ask. "Review it like last time" sends the next session looking for a conversation it can't see.

## The map: how your project works

The **map** is your project's own guide, which your agents write and keep current. For saved lists, it might explain where lists are stored, which parts of the app use them, and why offline reading matters. It links to the code and tests behind each point. It sums up how the code works where that helps, and it doesn't copy out every file or function.

You can read it too. It shows you what your agents understand about the project. Ask:

> Show me the map's account of saved lists. Does it still match how the app works after this change?

That lets you correct a misunderstanding before it turns into code.

The gate checks the map's mechanics, such as links, headings, and command examples. When code changes, a built-in [checkpoint](checkpoints.md), a review question discern puts to your agent, suggests which map pages to review. None of that proves a page is true. Your agent still reads the code and judges each explanation. [Maintain the project map](../10-guides/maintain-project-map.md) shows how to review a page and where new material belongs.

## Keep the reason behind a big decision

Some choices need more than a rule. Say you decide people can keep a reading list without making an account, even though that limits syncing between devices. The options you turned down, and the cost you accepted, matter to future work.

An **Architecture Decision Record**, or **ADR**, keeps that account: what you decided, why, and what follows from it. The map and the instructions can link to it. A later agent can then understand the choice before it proposes undoing it.

The bundled `discern-write-adr` skill helps your agent write one for a choice that's hard to reverse, surprising without context, and a real trade-off. Everyday detail belongs in the map, and tests protect behavior. An ADR records a decision you made. It can't let an agent skip a requirement you've agreed to.

## Pick the right home

You don't need to know where each thing goes. Ask your agent to "capture this lesson", and the bundled `discern-teach-the-project` skill picks the smallest home that does the job. It checks for an existing one first and updates it instead of adding another.

| What you want to keep                                          | Where it goes                                          |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| A rule: saved lists open offline.                              | The project instructions, linked to the fuller reason. |
| A method: review a new screen in each of its states.           | A skill.                                               |
| A question to ask when a change happens: is offline use clear? | A [checkpoint](checkpoints.md).                        |
| A fixed series of steps: load sample articles for a preview.   | A project script the agent can run.                    |
| How it works: where saved lists live and what uses them.       | The map, linked to the code.                           |
| A big decision: why accounts are optional.                     | An ADR.                                                |

A gain you can measure, such as a smaller download, belongs in a [standard](standards.md). Ask for that one directly.

Your agent also offers to capture a lesson at a natural pause, such as after you correct it or make a decision no file records. You decide what the project keeps.

## Whose writing is which

Your project's README and its own docs stay yours. The map lives where your project's configuration puts it, `discern/map/` by default.

This manual explains discern itself, and your agent can read it offline with `discern docs`. Your map explains your project. [discern's own map](https://discern.sh/map) is an example: the account its agents keep while they build discern.

What lasts is what you and your agents write down. A conversation doesn't turn into project knowledge on its own. [Write project instructions](../10-guides/write-project-instructions.md) and [Create and manage skills](../10-guides/create-and-manage-skills.md) show how to turn your next lesson into something every session can use.
