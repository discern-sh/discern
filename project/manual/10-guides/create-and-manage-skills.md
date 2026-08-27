---
id: guide-create-and-manage-skills
title: "Create and manage skills"
description: "Author, customize, exclude, use, and teach a focused Skill without bloating always-loaded instructions."
order: 110
publish: true
kind: guide
aliases:
  - "Skills"
  - "guide-create-and-manage-skills"
  - "Author a project Skill"
  - "create a skill"
  - "authored skills"
  - "project skills"
  - "Customize or exclude a Skill"
  - "eject skill"
  - "override skill"
  - "exclude skill"
  - "Teach the project"
  - "remember this"
  - "capture a lesson"
  - "project memory"
redirect_from:
  - "/docs/skills/author-a-skill"
  - "/docs/skills/customize-or-exclude"
  - "/docs/skills/teach-the-project"
---

# Create and manage skills

Author, customize, exclude, use, and teach a focused Skill without bloating always-loaded instructions.

## Author a project Skill

_Add a named `SKILL.md` under `[skills].dir`, then refresh to make it available to every configured agent._

Installed projects default to `discern/skills`; this repository points the same source at `project/skills/`. The project owns this path. Commit authored Skills and edit them in place.

### Create the Skill directory

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

For operational requirements, follow [Make an operational procedure self-contained](../20-understand/instructions-skills-and-map.md#make-an-operational-procedure-self-contained). Portable validation still covers only `name` and `description`.

### Materialize and inspect it

Run:

```sh
discern refresh
discern skills list
```

`refresh` links each authored Skill into every configured agent's Skills directory; the listing reports it as `yours`.

### Current state & gotchas

- discern links authored Skills as relative symbolic links, so source edits appear in every agent directory immediately. Commit the source directory. Git ignores the materialized directory.
- discern does not template authored Markdown. A literal `{{token}}` stays literal. Only bundled Skill Markdown receives configured path substitutions.
- A generic description may not match the relevant work. Include task language and trigger situations.
- Use an authored name that matches a bundled name only when you intend to [override it](create-and-manage-skills.md).

### Where it lives in code

| Concern                               | Source                                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[skills].dir` default and schema     | [`config_schema.ts`](https://github.com/jackwh/discern/blob/main/src/shared/config_schema.ts) (`skillsSection`)                                                                                                        |
| Authored resolution and links         | [`skills.ts`](https://github.com/jackwh/discern/blob/main/src/lib/skills.ts) (`resolveSkillsByName`, `materializeSkills`)                                                                                              |
| Frontmatter validation                | [`skills.ts`](https://github.com/jackwh/discern/blob/main/src/lib/skills.ts) (`skillFrontmatterIssues`)                                                                                                                |
| This repo's example in `[skills].dir` | [`discern-product-voice`](https://github.com/jackwh/discern/blob/main/project/skills/discern-product-voice/SKILL.md) (generated from [`voice.ts`](https://github.com/jackwh/discern/blob/main/scripts/brand/voice.ts)) |
| Materialization coverage              | [`instructions_test.ts`](https://github.com/jackwh/discern/blob/main/tests/instructions_test.ts)                                                                                                                       |

## Customize or exclude a Skill

_Copy a built-in Skill into project ownership when its procedure needs editing, or exclude a Skill the project does not use._

### Eject a bundled Skill

`discern skills eject` copies a bundled source into `[skills].dir/<name>`, renders its configured path tokens, makes the copy writable, and materializes it for every configured agent.

```sh
discern skills eject discern-write-adr --dry-run
discern skills eject discern-write-adr
discern skills list
```

`--dry-run` lists the authored tree, optional config edit, and each configured agent's target. It validates the bundled template and writes nothing.

The listing now reports `discern-write-adr` as `yours (overrides built-in)`. Skill resolution uses the directory name as its key, so the authored directory becomes effective. Edit that source as you would any [project Skill](create-and-manage-skills.md).

Eject does not overwrite an authored directory. If the destination already exists, the command refuses and names the path. It also refuses a name that is absent from the bundled set and lists the available names.

To return to the bundled version, move or remove the authored directory and run `discern refresh`. The bundled source becomes effective again on the next resolution.

### Exclude a Skill

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

### Current state & gotchas

- `eject` copies the bundled Skill at the discern version currently installed. Later upgrades do not replace the project-owned override.
- An exclusion applies to the name after override resolution. The same entry excludes either the bundled source or an authored source with that name.
- Materialization reconciles every configured agent directory and removes discern-owned entries that are no longer effective. Entries discern does not own remain unchanged and produce a warning.

### Where it lives in code

| Concern                    | Source                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Override and exclude rules | [`skills.ts`](https://github.com/jackwh/discern/blob/main/src/lib/skills.ts) (`resolveEffectiveSkills`)         |
| Ejection behavior          | [`skills.ts`](https://github.com/jackwh/discern/blob/main/src/lib/skills.ts) (`ejectSkill`)                     |
| Configuration schema       | [`config_schema.ts`](https://github.com/jackwh/discern/blob/main/src/shared/config_schema.ts) (`skillsSection`) |
| Full command-path coverage | [`engine_skills_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_skills_test.ts)              |

## Teach the project

_Record a durable correction, procedure, or decision in a project source that future agent sessions inherit._

The bundled `discern-teach-the-project` Skill provides the procedure for recording a lesson from a conversation in the repository. Ask your agent to “remember this,” “add this to the instructions,” or “capture this,” and the Skill selects the smallest durable source for that lesson.

discern's built-in instructions also tell agents to offer this capture at a natural pause after a user correction, a durable procedure, or an unrecorded decision. The user remains the editor of what the project records. The instruction postpones the offer until active work reaches a natural pause.

### Record each lesson once

The Skill checks for an existing source before adding anything. Update the current rule, playbook, or page instead of creating a second authority.

| The lesson is…                          | Its home                                                |
| --------------------------------------- | ------------------------------------------------------- |
| A standing rule every session needs     | The [Instruction source](write-project-instructions.md) |
| A repeatable procedure needing judgment | An [authored Skill](create-and-manage-skills.md)        |
| A review judgment a diff makes relevant | A [checkpoint](../20-understand/checkpoints.md)         |
| A deterministic command sequence        | A Project Script                                        |
| Durable subsystem facts                 | The documentation Map                                   |
| A significant decision and its reason   | An ADR                                                  |

Record each lesson in one authoritative source. An instruction can link to the ADR that explains it, while the rule and rationale retain separate purposes.

### Follow the capture loop

1. **Catch the lesson.** Keep corrections and procedures that remain useful beyond the current session. Drop facts the code already records or details that expire with the task.
2. **Offer at a pause.** When the user did not request capture, ask after implementation or during review. Batch related lessons into one offer.
3. **Route it.** Choose the smallest home for the knowledge and check for an existing entry first.
4. **Match the destination.** Instructions stay short and imperative. A Skill carries a full playbook. A checkpoint serves a judgment when a matching change completes. A script executes deterministically. Documentation states current facts. An ADR records a decision's context and trade-off.
5. **Update generated surfaces.** Refresh Agent files, verify a new Skill with the catalog, or run the relevant documentation and script checks. Report what changed and where it lives.

### Current state & gotchas

- Proactive capture remains an offer. The user decides whether an observation is durable project knowledge.
- The Skill routes lessons; it does not make every lesson a Skill. Always-on rules, executable actions, current facts, and decisions have their own homes.
- A declined lesson leaves no note or half-created file.
- A new authored Skill becomes available after `discern refresh`; instruction changes also need refresh before agent files become current.

### Where it lives in code

| Concern                 | Source                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Capture playbook        | [`discern-teach-the-project`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-teach-the-project/SKILL.md) |
| Proactive offer rule    | [`skills.md`](https://github.com/jackwh/discern/blob/main/templates/instructions/skills.md)                                    |
| Instruction compilation | [`instructions.ts`](https://github.com/jackwh/discern/blob/main/src/engine/instructions.ts)                                    |
| Skill discovery         | [`skills.ts`](https://github.com/jackwh/discern/blob/main/src/lib/skills.ts)                                                   |
