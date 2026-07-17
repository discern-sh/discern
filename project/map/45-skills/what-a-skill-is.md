---
title: What a Skill is
description: How Skills give agents task-matched procedures, and when to use one instead of guidance, a script, or documentation.
order: 10
aliases:
  - skill
  - playbook
  - skill discovery
---

# What a Skill is

_A Skill is a focused agent playbook that becomes available when its description matches the work._

Each Skill lives in a named directory with a `SKILL.md`. Frontmatter gives it a name and a description. The description carries the trigger: the kinds of request, failure, or situation that call for the playbook. The body explains the procedure and the judgment needed to apply it.

discern makes the same effective set available to every configured coding agent. Its built-in guidance tells agents to reach for a Skill when a task matches. Naming the Skill in your request is the most portable explicit invocation because provider-specific command syntax varies.

## Inspect the effective set

Run the listing from the project root:

```sh
discern skills list
discern skills list --json
```

The human listing marks each Skill as built-in, yours, an override, or excluded. JSON returns the same catalog under `data.skills`, with `source`, `overridesBundled`, `hasBundled`, and `excluded` on each row. Excluded Skills remain visible in the listing so a missing playbook has an explanation.

## Choose the right home

Use a Skill when the work has a repeatable sequence and still needs judgment. A good Skill tells an agent when to pause, what evidence to gather, which branch to take, and what observable condition means done.

| Knowledge to preserve                   | Put it here       | Reason                                         |
| --------------------------------------- | ----------------- | ---------------------------------------------- |
| A rule every session must follow        | Agent guidance    | Every agent reads it from the start.           |
| A repeatable procedure needing judgment | Skill             | The agent loads it when the task matches.      |
| A deterministic command sequence        | Project Script    | Executable steps stay executable.              |
| Durable facts about a subsystem         | Documentation map | Readers and agents use it as reference.        |
| A significant, hard-to-reverse decision | ADR               | The record preserves the reason and trade-off. |

A single command does not need a Skill. Put it in a Project Script. A paragraph of project truth belongs in [guidance](../40-agent-guidance/) or the map. This boundary keeps Skills procedural and keeps always-on instructions short.

## Current state & gotchas

- discern controls resolution and materialization. The coding agent controls when a matching Skill loads.
- Skill descriptions carry discovery cues. A vague description makes a complete playbook hard to find.
- Agent-specific invocation syntax is outside discern's contract. The name and description travel across every configured integration.
- Materialized directories are generated outputs. Edit the bundled or authored source, then refresh the set.

## Where it lives in code

| Concern                 | Source                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| Built-in discovery rule | [`skills.md`](../../../templates/guidance/skills.md)                         |
| Effective-set listing   | [`skills.ts`](../../../src/lib/skills.ts) (`listSkills`, `skillsListResult`) |
| Listing result schema   | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                 |
| CLI behavior            | [`engine_skills_test.ts`](../../../tests/engine_skills_test.ts)              |
