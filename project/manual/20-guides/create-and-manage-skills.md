---
id: guide-create-and-manage-skills
title: "Create and manage skills"
description: "Use discern's ready-made skills, and give your agent your own tested methods that every later session and coding tool can reuse."
order: 90
publish: true
kind: guide
aliases:
  - "Skills"
  - "guide-create-and-manage-skills"
  - "Author a project skill"
  - "create a skill"
  - "authored skills"
  - "project skills"
  - "Customize or exclude a skill"
  - "eject skill"
  - "override skill"
  - "exclude skill"
  - "Teach the project"
  - "remember this"
  - "capture a lesson"
  - "project memory"
---

# Create and manage skills

Give your agent a tested method for a kind of task, and it uses that method whenever the task comes up, in every session and coding tool. When you improve the method, every later task gets the improvement.

A **skill** is a playbook your agent reads when a task matches it. discern ships skills, and your project can add its own or adapt discern's.

## Try a bundled skill

Describe the task in your own words, and your agent picks the skill that fits. You can also name the skill to be sure.

| Ask your agent                                                   | The skill and what you get back                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "Split this feature into tasks that several agents can work on." | [`discern-delegate-work`](delegate-work.md): a brief for each task, and an independent review.           |
| "Wait for the saved-items task to land, then build on it."       | [`discern-await-the-fleet`](wait-for-another-task.md): the other task's work, brought into this one.     |
| "This bug keeps coming back. Fix it for good."                   | `discern-cure-a-bug`: the proven cause, every instance fixed, and a guard against its return.            |
| "Remove unused and duplicated code without changing behavior."   | `discern-clear-the-decks`: removals proven safe, in small commits, and a limit so clutter can't return.  |
| "We made the download smaller. Keep it that way."                | [`discern-set-the-standard`](set-and-raise-standards.md): a limit every change must meet.                |
| "When a form changes, check that its questions are clear."       | [`discern-place-a-checkpoint`](place-and-answer-checkpoints.md): a review question on the right changes. |
| "Record why we store saved lists on the device."                 | `discern-write-adr`: an Architecture Decision Record (ADR) of the choice and its tradeoff.               |
| "These screens repeat one list of choices. Give it one home."    | `discern-write-it-once`: one source for the fact, with tests that keep every use in step.                |

`discern skills list` shows every skill, whether it's built in or yours, and any you've left out.

## Decide whether you need a new skill

Say you keep asking your agent to review the words on each new screen of your app. Each review takes judgment: what the screen is for, how each state reads, and whether the words help. A repeated method like that is what a skill is for.

A rule for every session belongs in [project instructions](write-project-instructions.md) instead, and a fixed series of commands in a project script, as [Pick the right home](../10-understand/instructions-skills-and-map.md#pick-the-right-home) explains. First, your agent checks whether an existing skill covers the work, because one method is easier to keep current than two.

## Create a project skill

### Say when to use it and what it returns

Name the situations and the result you want:

> "Create a skill for reviewing the words people see in our app whenever we change labels, errors, or other messages. Bring back revised copy with any questions for us."

### Review the playbook

Your agent writes the skill as a `SKILL.md` file in its own folder under your skills directory, `discern/skills/` by default:

```markdown
---
name: wording-review
description: "Review the words people see in the app: labels, instructions, errors, and confirmation messages. Use when a change adds or edits any of them."
---
```

Your agent reads the `description` to decide when the skill applies. Read the procedure below it as the method you're choosing for every future review. It should say what the agent needs first, which judgments to make, how to check the result, and what to do when information is missing.

### Refresh and try it

The agent runs `discern refresh`, which links the skill into each coding tool's skills folder, such as `.claude/skills/`. discern rebuilds those folders, so edits belong in `discern/skills/`.

Then try it in a new session, opened in the task's **worktree**, the separate copy of the project where the agent made it:

> "Review the messages on our new saved-items screen using the wording-review skill."

The agent should follow the playbook and return what it promises. Also try a request that doesn't name the skill, such as "Do these messages read well?" If the agent misses the skill, sharpen the description. If the skill turns up for unrelated work, narrow the situations it names.

### Check it and land it

A change to your skills folder triggers a built-in **checkpoint**, a review question your agent answers when a change touches certain files. This one asks whether a new agent could follow the skill without filling in missing steps. The agent answers it and runs the **gate**, your project's own commands such as its linter and tests. Then it brings the skill back for review, as in [Finish and land a change](finish-and-land-a-change.md).

## Eject a bundled skill to adapt it

Say discern's bug-fixing skill should also run your wording review when a fix changes an error message. Your agent copies it into your skills folder:

```sh
discern skills eject discern-cure-a-bug
```

Your copy replaces the bundled one in every coding tool, and discern's later updates to the original no longer reach it. The agent edits and tries the copy like a new skill. A preference for one task needs no copy: say it in that task's request.

## Exclude a skill you don't use

Each skill's description takes a little room in every session, so ask your agent to leave out skills your project never needs. It adds the name to `discern.toml`, your project's discern configuration, and refreshes:

```toml
[skills]
exclude = ["discern-await-the-fleet"]
```

An open session keeps the skill until you start a new one.

## Teach the project a lesson

When a wording review turns up something every later change should know, ask:

> "Make sure future agents learn what we found here, and tell me where you recorded it."

The bundled `discern-teach-the-project` skill puts the lesson in the smallest home that fits, such as an instruction line, a skill, or a map page. It updates an existing home instead of adding another. Your agent may also offer to capture a lesson at a natural pause, and you decide what's worth keeping.

## When it's done

- `discern skills list` shows the new or changed skill once, from the right source.
- A real request in a new session gets the result the skill promises.
- The agent answered the skills checkpoint, the gate passed, and the change landed.

A captured lesson is done when your agent reports what it recorded, where, and how it checked it.
