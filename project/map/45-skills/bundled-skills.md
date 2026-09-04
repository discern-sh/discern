---
title: Bundled Skills
description: The registry-checked catalog of task playbooks bundled with discern and materialized for coding agents.
order: 20
aliases:
  - built-in skills
  - bundled playbooks
  - skill catalog
---

# Bundled Skills

_Bundled Skills are task playbooks that discern ships in the binary and adds to a project's effective set._

Every bundled name carries the `discern-` prefix, so it remains identifiable beside project-authored and vendor-provided skills. Run the live listing to see the bundled catalog together with this project's overrides and exclusions:

```sh
discern skills list
```

## The bundled catalog

| Skill                                                                                         | Reach for it when…                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`discern-await-the-fleet`](../../../templates/skills/discern-await-the-fleet/SKILL.md)       | A task depends on another effort. Hold one `await` call for green or landing, then compose what arrived.                                              |
| [`discern-clear-the-decks`](../../../templates/skills/discern-clear-the-decks/SKILL.md)       | Duplicated helpers, dead code, or leftover scaffolding need a behavior-preserving sweep.                                                              |
| [`discern-cure-a-bug`](../../../templates/skills/discern-cure-a-bug/SKILL.md)                 | A bug needs diagnosis, a class-level cure, or the suite needs auditing for guards weaker than they look.                                              |
| [`discern-delegate-work`](../../../templates/skills/discern-delegate-work/SKILL.md)           | Work needs a self-contained handoff, parallel fan-out, or staged briefs.                                                                              |
| [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md) | A documentation subtree needs a grounded README and leaves.                                                                                           |
| [`discern-place-a-checkpoint`](../../../templates/skills/discern-place-a-checkpoint/SKILL.md) | A recurring review judgment should be served when a matching change completes — trigger, mode, and question wired as a `[checkpoints.<id>]` entry.    |
| [`discern-set-the-standard`](../../../templates/skills/discern-set-the-standard/SKILL.md)     | A quality number needs a non-regressing floor or ceiling, or a legacy pattern needs outlawing to zero.                                                |
| [`discern-teach-the-project`](../../../templates/skills/discern-teach-the-project/SKILL.md)   | A session produced a durable lesson future agents need to inherit.                                                                                    |
| [`discern-write-adr`](../../../templates/skills/discern-write-adr/SKILL.md)                   | A significant decision needs its context and reasoning recorded.                                                                                      |
| [`discern-write-it-once`](../../../templates/skills/discern-write-it-once/SKILL.md)           | A request concerns agent-written code practices, a fact spans consumers, a set outgrows its guards, or an effectful workflow needs repeatable reruns. |

The table summarizes each live `SKILL.md` description. Open a skill for its triggers, procedure, and completion conditions. A Skill can contain deeper procedures as files inside its directory. For example, `discern-cure-a-bug` contains the diagnose and suite-audit procedures, `discern-set-the-standard` contains the outlaw procedure, and `discern-write-it-once` contains the bind-the-fact and plan-the-effects procedures.

## Current state & gotchas

- Bundled Skills ship inside the binary. Their source appears in this repository under `templates/skills/`; an installed project receives materialized copies instead of that source tree.
- Bundled Markdown renders configured project paths when discern materializes it. The source remains generic across stacks and repository layouts.
- A registry-driven Gate test reads the same bundled directory set as the materialization code and fails when this catalog omits a name. Adding a bundled Skill therefore enrolls it in the documentation check.
- The catalog reached seven Skills through reductions, then added `discern-write-it-once` and `discern-await-the-fleet` to reach nine ([ADR 0173](../_adr/0173-trim-the-bundled-skills-to-seven.md), [ADR 0191](../_adr/0191-an-eighth-bundled-skill-write-it-once.md), [ADR 0263](../_adr/0263-a-ninth-bundled-skill-await-the-fleet.md)). Two `[standards.skills]` ceilings hold the count and total description budget.

## Where the catalog stays current

| Concern                         | Source                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| Canonical bundled directory set | [`skills.ts`](../../../src/lib/skills.ts) (`bundledSkillNames`)         |
| Bundled source                  | [`templates/skills/`](../../../templates/skills/)                       |
| Catalog coverage guard          | [`skills_wellformed_test.ts`](../../../tests/skills_wellformed_test.ts) |
