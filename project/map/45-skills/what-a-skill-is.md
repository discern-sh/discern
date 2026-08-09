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

Each Skill lives in a named directory with a `SKILL.md`. Frontmatter gives it a name and description. The description defines its trigger: the requests, failures, or situations that call for the playbook. The body explains the procedure and the judgment needed to apply it.

discern makes the same effective set available to every configured coding agent. Its built-in Guidance instructs agents to load a Skill when a task matches. Naming the Skill in your request works across integrations even when their command syntax differs.

## Inspect the effective set

Run the listing from the project root:

```sh
discern skills list
discern skills list --json
```

The human listing marks each Skill as built-in, yours, an override, or excluded. JSON returns the same catalog under `data.skills`, with `source`, `overridesBundled`, `hasBundled`, and `excluded` on each row. Excluded Skills remain visible in the listing so a missing playbook has an explanation.

## Choose the right home

Use a Skill when the work has a repeatable sequence and still needs judgment. Specify when to pause, what evidence to gather, which branch to take, and which observable conditions mark completion.

| Knowledge to preserve                   | Put it here       | Reason                                         |
| --------------------------------------- | ----------------- | ---------------------------------------------- |
| A rule every session must follow        | Agent Guidance    | Each configured agent reads it from the start. |
| A repeatable procedure needing judgment | Skill             | The agent loads it when the task matches.      |
| A deterministic command sequence        | Project Script    | Executable steps stay executable.              |
| Durable facts about a subsystem         | Documentation Map | Readers and agents use it as reference.        |
| A significant, hard-to-reverse decision | ADR               | The record preserves the reason and trade-off. |

A deterministic command does not need a Skill. Put it in a Project Script. Durable project facts belong in [Guidance](../40-agent-guidance/) or the Map. This boundary keeps Skills procedural and always-loaded instructions short.

## Make an operational procedure self-contained

An operational Skill must let a fresh agent act without inventing a boundary. Name the root, path, or stable target; put action before verification; state when to stop; and give recovery steps. For cross-worktree, authority-sensitive, or relay-bearing work, provide the corresponding root, authority check, or ready-to-send message.

discern's repository keeps classification metadata outside the Skills it ships. The guard derives the effective Skill set from the same resolver that materializes it, then joins each surface to an internal registry whose required fields cite exact excerpts in the agent-facing prose. A new or overriding Skill joins without another test-owned filename list. Supporting Markdown joins evidence and lexical review; payloads under `skeleton/` remain excluded because an agent copies them rather than follows them in place. A materialization test prevents internal contract metadata from entering end-user Skill files ([ADR 0267](../_adr/0267-operational-contracts-stay-outside-agent-copy.md)).

## Current state & gotchas

- discern controls resolution and materialization. Each coding agent controls when a matching Skill loads.
- Skill descriptions carry discovery cues. A vague description may not match the relevant request.
- Agent-specific invocation syntax is outside discern's contract. The name and description travel across every configured integration.
- Materialized directories are generated outputs. Edit the bundled or authored source, then refresh the set.

## Where it lives in code

| Concern                     | Source                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| Built-in discovery rule     | [`skills.md`](../../../templates/guidance/skills.md)                         |
| Effective-set listing       | [`skills.ts`](../../../src/lib/skills.ts) (`listSkills`, `skillsListResult`) |
| Operational classifications | [`agent_surface_contracts.ts`](../../../scripts/agent_surface_contracts.ts)  |
| Contract and prose bindings | [`agent_contract.ts`](../../../scripts/agent_contract.ts)                    |
| Listing result schema       | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                 |
| CLI behavior                | [`engine_skills_test.ts`](../../../tests/engine_skills_test.ts)              |
