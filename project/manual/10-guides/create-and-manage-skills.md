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

Give your agent a tested method for a kind of task, and it uses that method whenever the task comes up, in every session and every coding tool. You explain the method once. When you improve it, every later task gets the improvement.

A **skill** is a short playbook your agent reads when a task matches it. discern ships skills you can use right after setup, and your project can add its own or adapt discern's.

## Try a bundled skill

Ask in your own words. You can name the skill, or describe the task and let your agent pick it.

| Ask your agent                                                                            | The skill and what you get back                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Help me divide this feature into tasks that several agents can work on."                 | `discern-delegate-work` writes a complete brief for each task, notes what depends on what, and offers an independent review. See [Delegate work](delegate-work.md). |
| "Wait for the saved-items task to land, then build search on top of it."                  | `discern-await-the-fleet` waits for the other task, then brings its work into this one. See [Wait for another task](wait-for-another-task.md).                      |
| "This bug keeps coming back. Find the cause and check for it everywhere it can occur."    | `discern-cure-a-bug` proves the cause, fixes every instance, and adds a check that fails if it returns.                                                             |
| "Clean up the unused and duplicated code without changing how the app works."             | `discern-clear-the-decks` proves each removal safe, makes small commits, and sets a limit so the clutter can't grow back.                                           |
| "We made the app's download smaller. Help us keep that improvement."                      | `discern-set-the-standard` picks a measure and sets a limit every change must meet. See [Set and raise standards](set-and-raise-standards.md).                      |
| "When a form changes, make sure someone considers whether its questions are clear."       | `discern-place-a-checkpoint` turns that concern into a review question for the right changes. See [Place and answer checkpoints](place-and-answer-checkpoints.md).  |
| "Remember what we learned here so the next session can use it."                           | `discern-teach-the-project` finds the right home for the lesson. See [Teach the project a lesson](#teach-the-project-a-lesson).                                     |
| "Record why we store saved lists on the device instead of on a server."                   | `discern-write-adr` records a significant architectural choice and its tradeoff in an Architecture Decision Record (ADR).                                           |
| "These parts of the app repeat the same list of choices. Give that information one home." | `discern-write-it-once` gives the shared fact one source, connects the places that use it, and adds checks to keep them in step.                                    |

A skill gives your agent a method. It still needs to understand your project to apply it well.

To see what's available, ask "Which skills does this project have?" Your agent runs `discern skills list`. It shows each skill, whether it's built in or yours, and any you've left out.

## Decide whether you need a new skill

Create a skill for a method you use again and again that takes judgment. Reviewing the wording on a new screen is a good example. It means understanding what the screen is for, trying its different states, and deciding whether the words help.

Other lessons have better homes:

- A rule every session should follow belongs in [project instructions](write-project-instructions.md).
- A fixed series of commands belongs in a project script the agent can run.

Before creating a skill, your agent checks whether an existing one already covers the work. One method is easier to keep current than two.

## Create a project skill

This section follows one example: a skill for reviewing the words people see in your app.

### Say when to use it and what it returns

Give your agent a request like this:

> Create a skill for reviewing the words people see in our app. Use it when we add or change labels, instructions, errors, or confirmation messages. Check the wording in context, and bring back the revised copy with any questions we need to decide.

Name the situations where it applies. Ask for a result you can review, rather than an open-ended instruction to improve everything.

### Review the playbook

Your agent creates a folder in your skills directory, `discern/skills/` by default. Inside is a `SKILL.md` file with:

- a `name` that matches the folder;
- a `description`, which your agent uses to decide when the skill applies;
- the procedure itself.

Read the procedure as a method you're choosing for every future review. It should say what the agent needs before it starts, which judgments to make, how to check the result, and what to do when information is missing. For the wording review, that might mean trying the screen's success and failure states before suggesting new text.

### Refresh and try it

The agent runs `discern refresh`, which copies the skill into each coding tool's skills folder, such as `.claude/skills/`. discern rebuilds those folders, so edits belong in `discern/skills/`. Then `discern skills list` should show the new skill once, marked as yours.

Next, try it in a new session, opened in the task's **worktree**: the separate copy of the project where the agent made the skill.

> Review the messages on our new saved-items screen using the wording-review skill.

The agent should read the playbook and return what it promises. Also try an ordinary request that should lead the agent to the skill without naming it. If the agent misses it, make the description clearer. If the skill turns up for unrelated work, narrow the situations it names.

### Check it and land it

A change to your skills folder triggers a built-in **checkpoint**, a review question your agent answers before the gate runs. The **gate** is the full set of checks your project requires. This checkpoint asks whether a new agent could follow the skill without filling in missing steps.

The agent answers the question, runs the gate, and brings the skill back for your review. A valid file can still describe a poor method, which is why trying it in a real session matters. [Finish and land a change](finish-and-land-a-change.md) covers landing.

## Adapt a bundled skill

When one of discern's skills needs a lasting change for your project, ask your agent to adapt it. The agent copies it into your skills folder:

```sh
discern skills eject discern-cure-a-bug
```

Your copy then replaces the bundled one in every coding tool. From then on, it no longer picks up discern's updates to the original, so your project owns its wording. The agent edits the copy, refreshes, and tries the changed method before landing it.

A preference for a single task doesn't need a new copy. Put it in that task's request.

## Leave out a skill you don't use

Every skill takes up a little room in each session. If your project never needs one, ask your agent to leave it out. It adds the name to `discern.toml`:

```toml
[skills]
exclude = ["discern-await-the-fleet"]
```

Then it refreshes and checks that `discern skills list` shows the skill as excluded. If refresh warns about an unknown name, the agent fixes the spelling. Excluding a skill doesn't delete any files you wrote. A session that's already open keeps the skill until you start a new one.

## Teach the project a lesson

You don't need to know which file a lesson belongs in. Ask:

> Capture the lesson from this task so future agents can use it. Update an existing source if it already belongs somewhere, and tell me where you recorded it.

The `discern-teach-the-project` skill picks the smallest home that fits: a line in the project instructions, a skill, a checkpoint, a project script, a map page, or an ADR. It updates an existing home rather than adding a second one. [Instructions, skills, and the map](../20-understand/instructions-skills-and-map.md) shows these choices through an example.

Your agent may also offer to capture a lesson it noticed, at a natural pause in the work. You decide whether it's worth keeping.

## When it's done

- `discern skills list` shows the new or changed skill once, from the right source.
- A real request in a new session gets the result the skill promises.
- The agent answered the skills checkpoint, the gate passed, and the change landed.

When your agent captures a lesson, its report says what it recorded, where, and how it checked it. From then on, every session in every coding tool can find it.
