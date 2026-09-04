---
title: Skills
description: Use discern's bundled playbooks, add project-specific ones, customize the set, and preserve lessons from agent sessions.
aliases:
  - agent skills
  - playbooks
  - SKILL.md
---

# Skills

_A skill is a reusable agent playbook for work that needs a focused procedure._

A skill is a directory centered on `SKILL.md`. Its description states when the playbook applies. Its body contains the steps, judgment points, and completion conditions. Each configured agent receives the project's effective set and can load a skill when the request matches. You can also name a skill in your request to require that procedure.

discern ships a [bundled catalog](bundled-skills.md) of development playbooks. A project adds its own under `[skills].dir`, which defaults to `discern/skills`. `discern refresh` materializes the effective set into each configured agent's skills directory, alongside the compiled [agent instructions](../40-agent-instructions/).

Put a short rule every session needs in the agent instructions. Put a repeatable procedure with several steps in a skill, where it loads for relevant work. [What a skill is](what-a-skill-is.md) explains that boundary.

You control the effective set. [Author a skill](author-a-skill.md) for project-specific work, [customize or exclude](customize-or-exclude.md) a bundled one, and use [Teach the project](teach-the-project.md) to record a durable lesson in its smallest project-owned source.

| Read next                                       | What it helps you do                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| [What a Skill is](what-a-skill-is.md)           | Decide when a procedure belongs in a Skill.                        |
| [Bundled Skills](bundled-skills.md)             | Find the playbooks discern ships.                                  |
| [Author a Skill](author-a-skill.md)             | Add a project-specific playbook and make it discoverable.          |
| [Customize or exclude](customize-or-exclude.md) | Override a built-in or remove a Skill from the effective set.      |
| [Teach the project](teach-the-project.md)       | Preserve a correction, procedure, or decision for future sessions. |
