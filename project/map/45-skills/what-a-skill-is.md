---
title: What a Skill is
description: How Skills give agents task-matched procedures, and when to use one instead of instructions, a script, or documentation.
order: 10
aliases:
  - skill
  - playbook
  - skill discovery
---

# What a Skill is

_A skill is a focused agent playbook that becomes available when its description matches the work._

Each skill lives in a named directory with a `SKILL.md`. Frontmatter gives it a name and description. The description defines its trigger: the requests, failures, or situations that call for the playbook. The body explains the procedure and the judgment needed to apply it.

discern makes the same effective set available to every configured coding agent. Its built-in instructions tell agents to load a skill when a task matches. Naming the skill in your request works across integrations even when their command syntax differs.

## Inspect the effective set

Run the listing from the project root:

```sh
discern skills list
discern skills list --json
```

The terminal listing marks each skill as built-in, yours, an override, or excluded. JSON returns the same catalog under `data.skills`, with `source`, `overrides_bundled`, `has_bundled`, and `excluded` on each row. Excluded skills remain visible in the listing so a missing playbook has an explanation.

## Choose the right home

Use a skill when the work has a repeatable sequence and still needs judgment. Specify when to pause, what evidence to gather, which branch to take, and which observable conditions mark completion.

| Knowledge to preserve                   | Put it here        | Reason                                         |
| --------------------------------------- | ------------------ | ---------------------------------------------- |
| A rule every session must follow        | Agent instructions | Each configured agent reads it from the start. |
| A repeatable procedure needing judgment | Skill              | The agent loads it when the task matches.      |
| A deterministic command sequence        | Project Script     | Executable steps stay executable.              |
| Durable facts about a subsystem         | Documentation Map  | Readers and agents use it as reference.        |
| A significant, hard-to-reverse decision | ADR                | The record preserves the reason and trade-off. |

A deterministic command does not need a skill. Put it in a Project Script. Durable project facts belong in [agent instructions](../40-agent-instructions/) or the map. This boundary keeps skills procedural and always-loaded instructions short.

## Make an operational procedure self-contained

An operational skill names its target, verification, stop, and recovery paths. Add the applicable root, authority check, or relay message.

An internal registry keeps classifications outside shipped skills and binds exact prose. The resolver, Markdown walk, lexical check, and materialization guard enroll future copy ([ADR 0267](../_adr/0267-operational-contracts-stay-outside-agent-copy.md)).

## Current state & gotchas

- discern controls resolution and materialization. Each coding agent controls when a matching Skill loads.
- Skill descriptions carry discovery cues. A vague description may not match the relevant request.
- Agent-specific invocation syntax is outside discern's contract. The name and description travel across every configured integration.
- Materialized directories are generated outputs. Edit the bundled or authored source, then refresh the set.

## Where it lives in code

| Concern                     | Source                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| Built-in discovery rule     | [`skills.md`](../../../templates/instructions/skills.md)                     |
| Effective-set listing       | [`skills.ts`](../../../src/lib/skills.ts) (`listSkills`, `skillsListResult`) |
| Operational classifications | [`agent_surface_contracts.ts`](../../../scripts/agent_surface_contracts.ts)  |
| Contract and prose bindings | [`agent_contract.ts`](../../../scripts/agent_contract.ts)                    |
| Listing result schema       | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                 |
| CLI behavior                | [`engine_skills_test.ts`](../../../tests/engine_skills_test.ts)              |
