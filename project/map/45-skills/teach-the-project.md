---
title: Teach the project
description: Capture a durable lesson from an agent session in guidance, a Skill, a script, documentation, or an ADR.
order: 50
aliases:
  - remember this
  - capture a lesson
  - project memory
---

# Teach the project

_Turn a correction, hard-won procedure, or unrecorded decision into a project source future agent sessions inherit._

The bundled `discern-teach-the-project` Skill is the capture path from a conversation into the repository. Ask your agent to “remember this,” “add this to the guidance,” or “capture this,” and the Skill routes the lesson to its smallest durable home.

discern's built-in guidance also asks agents to offer this capture at a natural pause after a user correction, a hard-won procedure, or an unrecorded decision. The offer keeps the user as editor of what the project teaches. An agent does not interrupt active work to file every observation.

## Route each lesson once

The Skill checks for an existing home before adding anything. Update the current rule, playbook, or page instead of creating a second source.

| The lesson is…                          | Its home                                                              |
| --------------------------------------- | --------------------------------------------------------------------- |
| A standing rule every session needs     | The [guidance source](../40-agent-guidance/write-project-guidance.md) |
| A repeatable procedure needing judgment | An [authored Skill](author-a-skill.md)                                |
| A deterministic command sequence        | A Project Script                                                      |
| Durable subsystem facts                 | The documentation map                                                 |
| A significant decision and its reason   | An ADR                                                                |

One lesson gets one home. A guidance rule can link to the ADR that explains it, but the rule and the rationale retain separate jobs.

## Follow the capture loop

1. **Catch the lesson.** Keep corrections and procedures that remain useful beyond the current session. Drop facts the code already records or details that expire with the task.
2. **Offer at a pause.** When the user did not request capture, ask after implementation or during review. Batch related lessons into one offer.
3. **Route it.** Choose the smallest home for the knowledge and check for an existing entry first.
4. **Write to that home's bar.** Guidance stays short and imperative. A Skill carries a real playbook. A script executes deterministically. Documentation states current facts. An ADR records a decision's context and trade-off.
5. **Make it live.** Refresh compiled guidance, verify a new Skill with the catalog, or run the relevant documentation and script checks. Report what the project learned and where it lives.

## Current state & gotchas

- Proactive capture is an offer. The user decides whether an observation is durable project knowledge.
- The Skill routes lessons; it does not make every lesson a Skill. Always-on rules, executable actions, current facts, and decisions have their own homes.
- A declined lesson leaves no note or half-created file.
- A new authored Skill becomes discoverable after `discern refresh`; guidance changes also need refresh before compiled agent files become current.

## Where it lives in code

| Concern              | Source                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Capture playbook     | [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md) |
| Proactive offer rule | [`skills.md`](../../../templates/guidance/skills.md)                                        |
| Guidance compilation | [`guidelines.ts`](../../../src/engine/guidelines.ts)                                        |
| Skill discovery      | [`skills.ts`](../../../src/lib/skills.ts)                                                   |
