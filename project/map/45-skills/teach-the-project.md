---
title: Teach the project
description: Capture a durable lesson from an agent session in instructions, a Skill, a script, documentation, or an ADR.
order: 50
aliases:
  - remember this
  - capture a lesson
  - project memory
---

# Teach the project

_Record a durable correction, procedure, or decision in a project source that future agent sessions inherit._

The bundled `discern-teach-the-project` Skill provides the procedure for recording a lesson from a conversation in the repository. Ask your agent to “remember this,” “add this to the instructions,” or “capture this,” and the Skill selects the smallest durable source for that lesson.

discern's built-in instructions also tell agents to offer this capture at a natural pause after a user correction, a durable procedure, or an unrecorded decision. The user remains the editor of what the project records. The instruction postpones the offer until active work reaches a natural pause.

## Record each lesson once

The Skill checks for an existing source before adding anything. Update the current rule, playbook, or page instead of creating a second authority.

| The lesson is…                          | Its home                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| A standing rule every session needs     | The [Instruction source](../40-agent-instructions/write-project-instructions.md) |
| A repeatable procedure needing judgment | An [authored Skill](author-a-skill.md)                                           |
| A deterministic command sequence        | A Project Script                                                                 |
| Durable subsystem facts                 | The documentation Map                                                            |
| A significant decision and its reason   | An ADR                                                                           |

Record each lesson in one authoritative source. An instruction can link to the ADR that explains it, while the rule and rationale retain separate purposes.

## Follow the capture loop

1. **Catch the lesson.** Keep corrections and procedures that remain useful beyond the current session. Drop facts the code already records or details that expire with the task.
2. **Offer at a pause.** When the user did not request capture, ask after implementation or during review. Batch related lessons into one offer.
3. **Route it.** Choose the smallest home for the knowledge and check for an existing entry first.
4. **Match the destination.** Instructions stay short and imperative. A Skill carries a full playbook. A script executes deterministically. Documentation states current facts. An ADR records a decision's context and trade-off.
5. **Update generated surfaces.** Refresh Agent files, verify a new Skill with the catalog, or run the relevant documentation and script checks. Report what changed and where it lives.

## Current state & gotchas

- Proactive capture remains an offer. The user decides whether an observation is durable project knowledge.
- The Skill routes lessons; it does not make every lesson a Skill. Always-on rules, executable actions, current facts, and decisions have their own homes.
- A declined lesson leaves no note or half-created file.
- A new authored Skill becomes available after `discern refresh`; instruction changes also need refresh before agent files become current.

## Where it lives in code

| Concern                 | Source                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Capture playbook        | [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md) |
| Proactive offer rule    | [`skills.md`](../../../templates/instructions/skills.md)                                    |
| Instruction compilation | [`instructions.ts`](../../../src/engine/instructions.ts)                                    |
| Skill discovery         | [`skills.ts`](../../../src/lib/skills.ts)                                                   |
