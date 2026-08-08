---
title: Skills
description: Use discern's bundled playbooks, add project-specific ones, customize the set, and preserve lessons from agent sessions.
aliases:
  - agent skills
  - playbooks
  - SKILL.md
---

# Skills

_A Skill is a reusable agent playbook for work that needs a focused procedure._

A Skill is a directory centered on `SKILL.md`. Its description states when the playbook applies. Its body contains the steps, judgment points, and completion conditions. Each configured agent receives the project's effective set and can load a Skill when the request matches. You can also name a Skill in your request to require that procedure.

discern ships a [bundled catalog](bundled-skills.md) of development playbooks. A project adds its own under `[skills].dir`, which defaults to `discern/skills`. `discern refresh` materializes the effective set into each configured agent's Skills directory, alongside the compiled [Guidance](../40-agent-guidance/).

Put a short rule every session needs in Guidance. Put a repeatable procedure with several steps in a Skill, where it loads for relevant work. [What a Skill is](what-a-skill-is.md) explains that boundary.

You control the effective set. [Author a Skill](author-a-skill.md) for project-specific work, [customize or exclude](customize-or-exclude.md) a bundled one, and use [Teach the project](teach-the-project.md) to record a durable lesson in its smallest project-owned source.

| Read next                                       | What it helps you do                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| [What a Skill is](what-a-skill-is.md)           | Decide when a procedure belongs in a Skill.                        |
| [Bundled Skills](bundled-skills.md)             | Find the playbooks discern ships.                                  |
| [Author a Skill](author-a-skill.md)             | Add a project-specific playbook and make it discoverable.          |
| [Customize or exclude](customize-or-exclude.md) | Override a built-in or remove a Skill from the effective set.      |
| [Teach the project](teach-the-project.md)       | Preserve a correction, procedure, or decision for future sessions. |
