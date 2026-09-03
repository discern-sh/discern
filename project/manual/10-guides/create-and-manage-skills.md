---
id: guide-create-and-manage-skills
title: "Create and manage Skills"
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
---

# Create and manage Skills

Use this guide when a recurring coding-agent task needs a focused playbook with decisions, steps, and a testable completion condition. Project-authored Skills join discern's bundled set and become available to every configured provider without making their full procedure part of every session's instructions.

The person decides which practices the project should carry. The coding agent authors the smallest durable playbook, verifies discovery, and keeps one source for each Skill.

## Starting state

- The project has completed setup and `[skills].dir` points to the authored Skill directory. Its default is `discern/skills`.
- The proposed content is a recurring multi-step method. A universal rule belongs in instructions; a deterministic action belongs in a project script; a change-triggered judgment belongs in a Checkpoint.
- The coding agent has checked `discern skills list` for an existing Skill that should be updated or customized.

## Author a project Skill

### 1. Define the trigger and outcome

**Coding agent:** Name the requests and situations that should load the Skill. State the user-visible outcome and the decisions an agent must make along the way. If the procedure is one fixed command sequence, create a project script instead.

Use the `skill-creator` Skill when the current agent provides it. It checks the package structure and helps keep the instructions scoped.

### 2. Create one Skill directory

Under `[skills].dir`, add `<skill-name>/SKILL.md` with lower-kebab-case `name` and a description rich in real trigger phrases:

```md
---
name: review-data-migration
description: Review a data migration before landing. Use when a task adds or changes a migration, alters stored data, or needs a rollback and lock-safety review.
---

# Review a data migration

## Starting state

...

## Procedure

...

## Done when

...
```

Write for a capable agent with no memory of the authoring session. Put prerequisites, decision points, safe failure routes, and a falsifiable “Done when” in the file. Keep deterministic helper logic in scripts beside the Skill and link deeper theory or exhaustive contracts instead of copying them.

### 3. Preview and materialize

**Coding agent:** Run:

```sh
discern refresh --dry-run
discern refresh
discern skills list
```

The dry run should name the expected materialization targets. The applied result should make the Skill appear once in the effective list, with its authored source. Project-authored Skills override bundled Skills with the same name.

### 4. Exercise discovery and procedure

Start a representative request in a fresh configured-provider session. The agent should select the Skill from its description, read the full `SKILL.md`, follow its decisions, and recognize the declared completion condition.

If it does not load, strengthen the description with the phrases people and agents use for that task. If it loads for unrelated requests, narrow the triggers. If the steps leave a real decision undefined, revise the procedure and rerun the same scenario.

Run `discern prepare`, commit the authored Skill, and run the full Gate. Materialized Skill directories are generated and commonly gitignored; the authored directory is the project authority.

## Customize a bundled Skill

**Coding agent:** Preview ejection, then copy the built-in into the authored directory:

```sh
discern skills eject discern-skill-name --dry-run
discern skills eject discern-skill-name
```

Edit that authored copy. Its matching name overrides the bundled version, so there is no second selection rule to maintain. Run `discern refresh`, inspect `discern skills list`, and exercise the changed path before committing.

Use this route only when the project needs a lasting difference. A one-task instruction belongs in the task brief.

## Exclude an unused Skill

**Person:** Decide that the project should no longer load the named Skill. **Coding agent:** add its exact name to config:

```toml
[skills]
exclude = ["discern-skill-name"]
```

Run `discern refresh --dry-run`, apply it, and confirm the name is absent from `discern skills list`. An unknown exclusion warns because it may be a stale name; resolve that warning rather than treating it as a successful removal.

## Teach a durable lesson

When a session produces a correction, hard-won procedure, or unrecorded decision, **coding agent:** offer at a natural pause to use `discern-teach-the-project`.

That Skill routes the lesson to one smallest authority:

- instructions for a rule every session needs;
- a Skill for a recurring method;
- a Checkpoint for a judgment made relevant by a diff;
- a project script for a deterministic action;
- documentation for durable context;
- an ADR for a significant decision and its rationale.

**Person:** approve whether the lesson should persist. **Coding agent:** update an existing authority when one already owns it, then compile or verify that surface. Do not leave a second copy in session notes or an unrelated page.

## Completion

A Skill change is complete when one authored `SKILL.md` owns the method, `discern skills list` shows the intended effective set, a representative request exercises selection and completion, refresh reports no pending materialization, and the full Gate passes. A taught lesson is complete only when the chosen project surface is live and the person knows where it was recorded.

Read [Instructions, Skills, and the Map](../20-understand/instructions-skills-and-map.md) for placement tradeoffs, [Config reference](../30-reference/config-reference.md) for Skill settings, and [Connect a coding agent](connect-a-coding-agent.md) when one provider cannot see a materialized Skill.
