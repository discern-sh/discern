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

Tell your agent a rule once, and every later session starts with it, in every coding tool your project uses. You stop repeating the same correction, and a new agent follows the rule without ever seeing the conversation where you made it.

Use this guide for a rule every session should know. For a longer method that only some tasks need, [create a skill](create-and-manage-skills.md) instead.

## Ask your agent to record the rule

Say saving a recipe in your app fails, and all people see is "Something went wrong," with no hint of what to do next. You fix the message, and you want every future change to get this right. Tell your agent:

> "From now on, whenever an action fails, the message should say what happened and give people a useful next step. Make sure every future session knows that, in every coding tool we use."

That's all your agent needs to record the rule. If you're not sure of the wording yet, ask it to show you the rule first.

## What your agent does

You don't need to run any of these commands yourself. They're here so you know what's happening.

**It works in its own worktree.** A **worktree** is a separate copy of the project on its own branch, so the rule reaches your shared branch only when you land it. If the task already has a worktree, the agent keeps using it.

**It edits the source.** Your project's rules live in one source file, `discern/instructions.md` by default, and discern builds each coding tool's own file from it, such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. An edit made only to one of those is lost at the next refresh, so the agent edits the source. If a rule on the same subject already exists, the agent updates it instead of adding a second one that would give later sessions a different answer.

**It refreshes the tool files.** `discern refresh` rebuilds each tool's file from the source, and `discern refresh --dry-run` previews what it would write. `discern prepare`, which the agent runs for fast feedback while it works, refreshes too. Refresh also keeps skills and each tool's connection settings current, so the agent tells you about anything in the preview you didn't expect. If refresh can't finish, its result names what failed and how to fix it.

**It commits and runs the gate.** The **gate** runs your project's own commands, such as its linter and tests, and fails if any tool's file doesn't match the source, so no tool is left reading an old copy of your rules. A pass produces **Proof**, discern's record of which commands passed on exactly which commit.

**It brings the change to you.** A pass doesn't land the rule: instruction changes wait for your review unless you've pre-approved them, which keeps you in charge of what every future session is told. [Finish and land a change](finish-and-land-a-change.md) covers review and landing.

## Check the wording

A good rule says when it applies and what to do, in words that make sense to a session that never saw your conversation. For the failed save, the agent might add this line to the source:

```markdown
- When a user action fails, explain what happened and offer a useful next step. Only suggest a step the app supports.
```

The second sentence matters, because a cheerful suggestion the app can't carry out leaves people worse off than before.

Read the rule the way the next agent will. Does it belong in every session, or only in some tasks? Does it keep the distinction you care about? "Make errors better" leaves the next agent to guess what you meant.

Keep each rule short. Every session reads every instruction, so a long one costs every task. Put the fuller reasons in the project map, the guide your agents keep to how the project works, and link to them from the rule. [Instructions, skills, and the map](../10-understand/instructions-skills-and-map.md) explains which home fits which kind of lesson.

## Check that a new session follows it

Once the change lands, open a new session in any of your coding tools and ask:

> "What do our project instructions say about the message people see when an action fails?"

The answer should quote your rule without you pasting it in. A session reads its instructions when it starts, so one that was already open still has the old version.

If a new session can't find the rule, ask your agent to check how that tool loads its files. [Connect a coding agent](connect-a-coding-agent.md) covers the recovery.

## When it's done

- One source holds the rule.
- The gate passed on the committed change, so every tool's file matches that source.
- The change has landed with your permission.
- A new session finds the rule without your help.

From now on, every session in every configured tool starts with that rule, and if you switch coding tools later, the rule comes with the project.

The [configuration reference](../30-reference/config-reference.md#instructions) lists the source settings, and [Files and ownership](../30-reference/files-and-ownership.md) shows which files discern generates.
