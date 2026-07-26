---
title: Bundled Skills
description: The complete, guard-checked catalog of task playbooks bundled with discern and materialized for coding agents.
order: 20
aliases:
  - built-in skills
  - bundled playbooks
  - skill catalog
---

# Bundled Skills

_The task playbooks discern ships in the binary and adds to each project's effective Skill set._

Every bundled name carries the `discern-` prefix, so it remains identifiable beside project-authored and vendor-provided Skills. Run the live listing to see the bundled catalog together with this project's overrides and exclusions:

```sh
discern skills list
```

## The bundled catalog

| Skill                                                                                         | Reach for it when…                                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`discern-clear-the-decks`](../../../templates/skills/discern-clear-the-decks/SKILL.md)       | Duplicated helpers, dead code, or leftover scaffolding need a proven-safe sweep.                         |
| [`discern-cure-a-bug`](../../../templates/skills/discern-cure-a-bug/SKILL.md)                 | A bug needs diagnosis, a class-level cure, or the suite needs auditing for guards weaker than they look. |
| [`discern-delegate-work`](../../../templates/skills/discern-delegate-work/SKILL.md)           | Work needs a self-contained handoff, parallel fan-out, or staged briefs.                                 |
| [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md) | A documentation subtree needs a grounded README and leaves.                                              |
| [`discern-set-the-standard`](../../../templates/skills/discern-set-the-standard/SKILL.md)     | A quality number needs a never-loosen floor or ceiling — or a legacy pattern needs outlawing to zero.    |
| [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md)   | A session produced a durable lesson future agents need to inherit.                                       |
| [`discern-write-adr`](../../../templates/skills/discern-write-adr/SKILL.md)                   | A significant decision needs its context and reasoning recorded.                                         |
| [`discern-write-it-once`](../../../templates/skills/discern-write-it-once/SKILL.md)           | A shared fact spans several consumers, a growing set needs parity, or generated output keeps drifting.   |

The table summarizes each live `SKILL.md` description. Open a Skill for its triggers, procedure, and finish condition. A merged Skill carries its absorbed procedures as files inside its directory — `discern-cure-a-bug` holds the diagnose and suite-audit procedures, `discern-set-the-standard` holds the outlaw procedure.

## Current state & gotchas

- Bundled Skills ship inside the binary. Their source appears in this repository under `templates/skills/`; an installed project receives materialized copies instead of that source tree.
- Bundled Markdown renders configured project paths when discern materializes it. The source remains generic across stacks and repository layouts.
- A registry-driven gate test reads the same bundled directory set as the materialization code and fails when this catalog omits a name. Adding a bundled Skill therefore enrolls it in the documentation check automatically.
- Before launch, the project reduced the set from thirteen to seven through merges, renames, and hint migrations ([ADR 0173](../_adr/0173-trim-the-bundled-skills-to-seven.md)). The owner later approved `discern-write-it-once` as the eighth member after it cleared that record's bar ([ADR 0189](../_adr/0189-an-eighth-bundled-skill-write-it-once.md)). Two `[standards.skills]` ceilings hold the count and the total description budget.

## Where the catalog stays current

| Concern                         | Source                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| Canonical bundled directory set | [`skills.ts`](../../../src/lib/skills.ts) (`bundledSkillNames`)         |
| Bundled source                  | [`templates/skills/`](../../../templates/skills/)                       |
| Catalog coverage guard          | [`skills_wellformed_test.ts`](../../../tests/skills_wellformed_test.ts) |
