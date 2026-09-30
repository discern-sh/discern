---
id: guide-write-project-instructions
title: "Write project instructions"
description: "Tell your agent a rule once, and every later session starts with it, in every coding tool your project uses."
order: 80
publish: true
kind: guide
aliases:
  - "instructions"
  - "guide-write-project-instructions"
  - "instruction sources"
  - "instructions.md"
  - "project instructions"
  - "remember this rule"
  - "Compile and check agent instructions"
  - "refresh instructions"
  - "agent files"
  - "generated instructions"
---

# Write project instructions

Tell your agent a rule once, and every later session starts with it, in every coding tool your project uses. You stop repeating the same correction. A new agent follows the rule without ever seeing the conversation where you made it.

For a method that only some tasks need, [create a skill](create-and-manage-skills.md) instead.

## Ask your agent to record the rule

Say saving a recipe in your app fails, and all people see is "Something went wrong." You fix the message, and you want every future change to get this right:

> "From now on, whenever an action fails, the message should say what happened and give people a useful next step. Make sure every future session knows that, in every coding tool we use."

If you're unsure of the wording, ask to see the rule first.

## What your agent does

You don't need to run any of these commands yourself.

**It edits the source and refreshes.** Your project's rules live in one source file, `discern/instructions.md` by default. `discern refresh` builds each coding tool's own file from it, such as `AGENTS.md` or `CLAUDE.md`, so an edit made only to one of those is lost at the next refresh. If a rule on the same subject exists, the agent updates it instead of adding a second rule that could contradict it.

**It commits and runs the gate.** The **gate** runs your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. It also fails if any tool's file doesn't match the source, so no tool reads an old copy of your rules. A change to the source triggers a built-in **checkpoint**, a review question your agent answers: does each new line earn its place in every session?

**It brings the change to you.** A pass doesn't land the rule. Instruction changes wait for your review unless you've pre-approved them, so you decide what every future session is told. An unmet checkpoint answer needs your decision either way. [Finish and land a change](finish-and-land-a-change.md) covers landing.

## Check the wording

A good rule says when it applies and what to do. It makes sense to a session that never saw your conversation. For the failed save, the agent might add this line:

```markdown
- When a user action fails, explain what happened and offer a useful next step. Only suggest a step the app supports.
```

The second sentence matters, because a suggestion the app can't carry out leaves people worse off. "Make errors better" would leave the next agent guessing.

Keep each rule short, because every session reads every instruction. Put the fuller reasons in the **map**, your project's guide to how it works, and link to them from the rule. [Pick the right home](../10-understand/instructions-skills-and-map.md#pick-the-right-home) shows which kind of lesson belongs where.

## Check that a new session follows it

Once the change lands, open a new session in any coding tool and ask:

> "What do our project instructions say about the message people see when an action fails?"

The answer should quote your rule without you pasting it in. A session reads its instructions when it starts, so one that was already open still has the old version. If a new session can't find the rule, ask your agent to check how that tool loads its files, as [Connect a coding agent](connect-a-coding-agent.md) describes.

## When it's done

- One source holds the rule, and the gate confirmed that every tool's file matches it.
- The change has landed with your permission.
- A new session finds the rule without your help.

If you switch coding tools later, the rule comes with the project. The [configuration reference](../30-reference/config-reference.md#instructions) lists the source settings. [Files and ownership](../30-reference/files-and-ownership.md) shows which files discern generates.
