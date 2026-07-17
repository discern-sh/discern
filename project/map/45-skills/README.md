---
title: Skills
description: Use discern's bundled playbooks, add project-specific ones, customize the set, and preserve lessons from agent sessions.
aliases:
  - agent skills
  - playbooks
  - SKILL.md
---

# Skills

_Give coding agents focused playbooks for work that needs more than a standing rule._

A Skill is a directory centered on `SKILL.md`. Its description tells an agent when the playbook applies; its body carries the steps, judgment points, and finish condition. Agents discover the effective set for the project and reach for a Skill when the request matches. You can also name a Skill in your request when you want that procedure followed.

discern ships a [bundled catalog](bundled-skills.md) of development playbooks. A project adds its own under `[skills].dir`, which defaults to `discern/skills`. `discern refresh` materializes the effective set into every configured agent's Skills directory, alongside the compiled [agent guidance](../40-agent-guidance/).

The distinction keeps agent context useful. Put a short rule every session needs in guidance. Put a repeatable procedure with several steps in a Skill, where the agent loads it for relevant work. [What a Skill is](what-a-skill-is.md) covers that boundary.

The set remains yours to tune. [Author a Skill](author-a-skill.md) for project-specific work, [customize or exclude](customize-or-exclude.md) a bundled one, and use [Teach the project](teach-the-project.md) to route a durable lesson from one session into the smallest project surface that can carry it.

| Read next                                       | What it helps you do                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| [What a Skill is](what-a-skill-is.md)           | Decide when a procedure belongs in a Skill.                        |
| [Bundled Skills](bundled-skills.md)             | Find the playbooks discern ships.                                  |
| [Author a Skill](author-a-skill.md)             | Add a project-specific playbook and make it discoverable.          |
| [Customize or exclude](customize-or-exclude.md) | Override a built-in or remove a Skill from the effective set.      |
| [Teach the project](teach-the-project.md)       | Preserve a correction, procedure, or decision for future sessions. |
