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

| Skill                                                                                             | Reach for it when…                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`discern-audit-the-suite`](../../../templates/skills/discern-audit-the-suite/SKILL.md)           | Tests cover named examples but may leave the underlying invariant open.            |
| [`discern-cure-a-bug`](../../../templates/skills/discern-cure-a-bug/SKILL.md)                     | A bug needs every instance fixed and a permanent class-level guard.                |
| [`discern-delegate-work`](../../../templates/skills/discern-delegate-work/SKILL.md)               | Work needs a self-contained handoff, parallel fan-out, or staged briefs.           |
| [`discern-diagnose-a-bug`](../../../templates/skills/discern-diagnose-a-bug/SKILL.md)             | A failure's cause needs reproduction and falsifying experiments before a fix.      |
| [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md)     | A documentation subtree needs a grounded README and leaves.                        |
| [`discern-outlaw-a-pattern`](../../../templates/skills/discern-outlaw-a-pattern/SKILL.md)         | A legacy pattern needs a detector, a falling ceiling, and a permanent ban.         |
| [`discern-prove-it-works`](../../../templates/skills/discern-prove-it-works/SKILL.md)             | A completed change needs evidence from the real running artifact.                  |
| [`discern-prune-the-overgrowth`](../../../templates/skills/discern-prune-the-overgrowth/SKILL.md) | Duplicated helpers, dead code, or leftover scaffolding need a proven-safe cleanup. |
| [`discern-shape-the-work`](../../../templates/skills/discern-shape-the-work/SKILL.md)             | A non-trivial request needs decisions and observable acceptance criteria first.    |
| [`discern-standard-a-metric`](../../../templates/skills/discern-standard-a-metric/SKILL.md)       | A quality number needs a never-loosen floor or ceiling.                            |
| [`discern-survey-the-fleet`](../../../templates/skills/discern-survey-the-fleet/SKILL.md)         | Several worktrees need one status, intent, staleness, and collision report.        |
| [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md)       | A session produced a durable lesson future agents need to inherit.                 |
| [`discern-write-adr`](../../../templates/skills/discern-write-adr/SKILL.md)                       | A significant decision needs its context and reasoning recorded.                   |

The table summarizes each live `SKILL.md` description. Open a Skill for its triggers, procedure, and finish condition.

## Current state & gotchas

- Bundled Skills ship inside the binary. Their source appears in this repository under `templates/skills/`; an installed project receives materialized copies instead of that source tree.
- Bundled Markdown renders configured project paths when discern materializes it. The source remains generic across stacks and repository layouts.
- A registry-driven gate test reads the same bundled directory set as the materialization code and fails when this catalog omits a name. Adding a bundled Skill therefore enrolls it in the documentation check automatically.

## Where the catalog stays current

| Concern                         | Source                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| Canonical bundled directory set | [`skills.ts`](../../../src/lib/skills.ts) (`bundledSkillNames`)         |
| Bundled source                  | [`templates/skills/`](../../../templates/skills/)                       |
| Catalog coverage guard          | [`skills_wellformed_test.ts`](../../../tests/skills_wellformed_test.ts) |
