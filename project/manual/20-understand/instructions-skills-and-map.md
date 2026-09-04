---
id: explanation-instructions-skills-and-map
title: "Instructions, skills, and the map"
description: "Distinguish always-loaded project rules, focused skills, the project's existing human docs, and inspectable agent map understanding."
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

# Instructions, Skills, and the Map

You correct an agent's approach on Tuesday, and Thursday's session makes the same mistake. You explain the deploy procedure again, to a different agent this time. The knowledge exists, in transcripts and in your head, but no future session starts with it.

The practice gives project knowledge durable, project-owned homes, each matched to when the knowledge is needed: **instructions** that every session loads, **skills** that load when a task matches, and the **map** that agents consult while navigating the project. All are ordinary files in the repository, versioned with the code and held current by the same gate.

## Instructions: what every session must know

The project's standing rules live in one authored source, by default `discern/instructions.md`. `discern refresh` compiles that source, together with discern's built-in operating advice, into each configured coding agent's own instruction file: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and the rest. You write the rules once; every agent, from any provider, starts each session with the same page in view. A compiled file that no longer matches its source fails the gate, so a stale copy can't survive review.

The compiled result also matches the project in front of it: a project that declares no worktree resources, for example, hands its agents no instructions about resources.

Instructions have a cost model worth respecting. They are always loaded, so every sentence charges every session's limited context before any work begins. That keeps them short by design: rules an agent must know before its first action belong here, and everything else belongs in a home that loads at need.

## Skills: procedures that load at need

A Skill is a focused playbook: one directory with a `SKILL.md` whose description says when it applies and whose body carries the procedure, including the judgment it takes to apply well. `discern refresh` places the effective set where each configured agent expects to find skills, so the collection is declared once and identical for every agent.

The set combines discern's bundled skills, which teach the practice's own methods (delegating work, waiting on another task, curing a bug at its class), with any the project authors under its skills directory. A project skill with a bundled skill's name replaces it, and `[skills].exclude` drops named entries.

Skills answer the cost problem instructions can't: only the name and description occupy a session by default, and the body loads when the task matches. A hard-won procedure captured as a skill stops costing every session its length and starts being available to the sessions that need it.

### Make an operational procedure self-contained

A Skill that performs effects should carry its own boundaries: the target it operates on, how to verify the result, the conditions that mean stop, and the recovery when a step fails. A fresh session has no memory of the session that authored the skill, so the playbook has to stand alone. Once it does, a task brief can name the skill instead of restating the method.

## The Map: what the agents understand

The Map is the account of your project that agents maintain: the architecture, the boundaries and conventions, where to start reading, and the decisions behind them. Agents write it, navigate by it, and keep it current under the gate — an out-of-date page is treated as a defect of the change that outdated it.

For you, the map is an audit surface. Delegating more work usually makes a project less legible to its owner; the map reverses that by making the agents' working understanding readable. What your agents believe about the project stops being hidden in session history.

The checking comes in layers. Mechanical checks run in every gate: links and anchors must resolve, command examples must match the live command set, and metadata must be valid, so renaming something breaks the affected pages in the same change rather than a month later. Freshness ships as file-linked facts (which source files a page covers, and when they last moved) pointing you and the agents at the pages most likely to need attention. Whether a sentence is still conceptually true remains the agents' maintained obligation; the checks tell you where to look, and the gate makes updating the map part of finishing a change.

Significant decisions get their own record: an ADR (Architecture Decision Record) preserves the context, the choice, and the alternatives considered, so a settled question doesn't get reopened by accident a year later.

## Whose writing is which

Nearby kinds of writing tend to blur together, and keeping them apart is part of the model:

- **Your project's own documentation** — its README, docs site, and comments — belongs to the project and its authors. discern doesn't touch documentation outside the paths the project supplies to it.
- **The Map** is the agents' maintained account of your project, kept at the path your config names.
- **This manual** is discern's product documentation. It describes discern, ships with the install, and is readable offline with `discern docs`.
- **discern's own map** is the live example: discern is developed under its own practice, and its map is published [at discern.sh/map](https://discern.sh/map), so you can inspect what its agents understand about it — the same inspection your project's map offers you.

When a session produces a lesson worth keeping (a correction, a procedure that took real effort to derive, a decision nothing records), the bundled teach-the-project skill routes it to the smallest durable home: an instruction line, a skill, a map page, or a decision record. That loop is what makes the practice accumulate: the next session starts where this one left off.

[Write project instructions](../10-guides/write-project-instructions.md) and [Create and manage skills](../10-guides/create-and-manage-skills.md) are the working procedures. [Files and ownership](../30-reference/files-and-ownership.md) lists where each file lives and who may write it.
