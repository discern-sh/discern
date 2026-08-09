---
title: Author a Skill
description: Create a project-specific SKILL.md, make its trigger discoverable, and materialize it for every configured agent.
order: 30
aliases:
  - create a skill
  - authored skills
  - project skills
---

# Author a project Skill

_Add a named `SKILL.md` under `[skills].dir`, then refresh to make it available to every configured agent._

Installed projects default to `discern/skills`; this repository points the same source at `project/skills/`. The project owns this path. Commit authored Skills and edit them in place.

## Create the Skill directory

Create one directory for each procedure. The directory name is the Skill's identity.

```text
discern/skills/
└── verify-release/
    └── SKILL.md
```

Open `SKILL.md` with `name` and `description` frontmatter, with `name` matching the directory. Write one description sentence that states what the Skill does and when it applies.

The block uses YAML. The `discern done` Gate checks every effective Skill: the block must parse, `name` and `description` must be non-empty strings, and `name` must use lowercase letters, digits, and hyphens. Quote a value containing `:`.

```markdown
---
name: verify-release
description: Verify a release candidate against the changelog, built artifacts, and smoke checks before publishing.
---

# Verify a release

Describe the evidence to gather, the ordered checks, the judgment points, and the observable conditions that mean the release is ready.
```

The body is a playbook for an agent with no memory of the session that authored it. Name real project commands and paths. Separate the fixed steps from decisions that need judgment. End with observable completion conditions.

For operational requirements, follow [Make an operational procedure self-contained](what-a-skill-is.md#make-an-operational-procedure-self-contained). Portable validation still covers only `name` and `description`.

## Materialize and inspect it

Run:

```sh
discern refresh
discern skills list
```

`refresh` links each authored Skill into every configured agent's Skills directory; the listing reports it as `yours`.

## Current state & gotchas

- discern links authored Skills as relative symbolic links, so source edits appear in every agent directory immediately. Commit the source directory. Git ignores the materialized directory.
- discern does not template authored Markdown. A literal `{{token}}` stays literal. Only bundled Skill Markdown receives configured path substitutions.
- A generic description may not match the relevant work. Include task language and trigger situations.
- Use an authored name that matches a bundled name only when you intend to [override it](customize-or-exclude.md).

## Where it lives in code

| Concern                               | Source                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `[skills].dir` default and schema     | [`config_schema.ts`](../../../src/shared/config_schema.ts) (`skillsSection`)                                                          |
| Authored resolution and links         | [`skills.ts`](../../../src/lib/skills.ts) (`resolveSkillsByName`, `materializeSkills`)                                                |
| Frontmatter validation                | [`skills.ts`](../../../src/lib/skills.ts) (`skillFrontmatterIssues`)                                                                  |
| This repo's example in `[skills].dir` | [`discern-product-voice`](../../skills/discern-product-voice/SKILL.md) (generated from [`voice.ts`](../../../scripts/brand/voice.ts)) |
| Materialization coverage              | [`guidelines_test.ts`](../../../tests/guidelines_test.ts)                                                                             |
