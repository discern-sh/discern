---
title: Customize or exclude Skills
description: Eject a bundled Skill into project ownership, override by name, or exclude a bundled or authored Skill from materialization.
order: 40
aliases:
  - eject skill
  - override skill
  - exclude skill
---

# Customize or exclude a Skill

_Copy a built-in into project ownership when its procedure needs editing, or exclude an unused Skill._

## Eject a bundled Skill

`discern skills eject` copies a bundled source into `[skills].dir/<name>`, renders its configured path tokens, makes the copy writable, and materializes it for every configured agent.

```sh
discern skills eject discern-write-adr
discern skills list
```

The listing now reports `discern-write-adr` as `yours (overrides built-in)`. The authored directory wins because Skill resolution uses the directory name as its key. Edit that source as you would any [project Skill](author-a-skill.md).

Eject does not overwrite an authored directory. If the destination already exists, the command refuses and names the path. It also refuses a name that is absent from the bundled set and lists the available names.

To return to the bundled version, move or remove the authored directory and run `discern refresh`. The bundled source becomes effective again on the next resolution.

## Exclude a Skill

Add bundled or authored names to `[skills].exclude`:

```toml
[skills]
exclude = ["discern-write-adr"]
```

Then reconcile and inspect the set:

```sh
discern refresh
discern skills list
```

Resolution first chooses an authored override when one exists, then applies the exclusion list. The named Skill disappears from every discern-managed agent directory. The listing keeps the row and marks it excluded, so you can distinguish a configured exclusion from a missing source.

An unknown exclusion warns during materialization and excludes nothing. The warning does not fail `refresh`; use the listing to check the spelling.

## Current state & gotchas

- `eject` copies the bundled Skill at the discern version currently installed. Later upgrades do not replace the project-owned override.
- An exclusion applies to the name after override resolution. The same entry excludes either the bundled source or an authored source with that name.
- Materialization reconciles every configured agent directory and prunes discern-owned entries that are no longer effective. Foreign entries remain untouched and produce a warning.

## Where it lives in code

| Concern                    | Source                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| Override and exclude rules | [`skills.ts`](../../../src/lib/skills.ts) (`resolveEffectiveSkills`)         |
| Ejection behavior          | [`skills.ts`](../../../src/lib/skills.ts) (`ejectSkill`)                     |
| Configuration schema       | [`config_schema.ts`](../../../src/shared/config_schema.ts) (`skillsSection`) |
| Full command-path coverage | [`engine_skills_test.ts`](../../../tests/engine_skills_test.ts)              |
