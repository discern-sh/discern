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

_Add a named `SKILL.md` under `[skills].dir`, then refresh so every configured agent can discover it._

Installed projects default to `discern/skills`. The discern repository configures the same source as `project/skills/`, where its voice-and-tone Skill lives. The path is project-owned: commit authored Skills and edit them in place.

## Create the Skill directory

Give one procedure one directory. The directory name is the Skill's identity.

```text
discern/skills/
└── verify-release/
    └── SKILL.md
```

Open `SKILL.md` with `name` and `description` frontmatter, `name` matching the directory. Write the description as a trigger-rich sentence: what the Skill does and when an agent reaches for it.

The block is YAML, and `discern done` holds every effective Skill to it: the block parses, `name` and `description` are non-empty strings, and `name` uses lowercase letters, digits, and hyphens. Quote a value containing `:`.

```markdown
---
name: verify-release
description: Verify a release candidate against the changelog, built artifacts, and smoke checks before publishing.
---

# Verify a release

Describe the evidence to gather, the ordered checks, the judgment points, and the observable conditions that mean the release is ready.
```

The body is a playbook for an agent with no memory of the session that authored it. Name real project commands and paths. Separate the fixed steps from decisions that need judgment. End with a falsifiable “done when” list.

## Materialize and inspect it

Run:

```sh
discern refresh
discern skills list
```

`refresh` links each authored Skill from `[skills].dir` into every configured agent's Skills directory. The listing reports it as `yours`.

## Current state & gotchas

- discern links authored Skills as relative symlinks, so edits reach every agent directory live. Commit the source directory; the materialized one stays ignored by git.
- discern does not template authored Markdown. A literal `{{token}}` stays literal. Only bundled Skill Markdown receives configured path substitutions.
- A generic description leaves a good Skill undiscovered. Put task language and trigger situations in it.
- Use an authored name that matches a bundled name only when you intend to [override it](customize-or-exclude.md).

## Where it lives in code

| Concern                           | Source                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `[skills].dir` default and schema | [`config_schema.ts`](../../../src/shared/config_schema.ts) (`skillsSection`)           |
| Authored resolution and links     | [`skills.ts`](../../../src/lib/skills.ts) (`resolveSkillsByName`, `materializeSkills`) |
| Frontmatter validation            | [`skills.ts`](../../../src/lib/skills.ts) (`skillFrontmatterIssues`)                   |
| This repo's authored example      | [`discern-voice-and-tone`](../../skills/discern-voice-and-tone/SKILL.md)               |
| Materialization coverage          | [`guidelines_test.ts`](../../../tests/guidelines_test.ts)                              |
