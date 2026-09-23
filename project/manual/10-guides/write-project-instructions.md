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

Use this guide for a rule that every session should know. For a longer method that only some tasks need, [create a skill](create-and-manage-skills.md) instead.

## Ask your agent to record the rule

Say you find an error message in your app that leaves people stuck. You fix it, and you want every future change to get this right. Tell your agent:

> Remember this for every future session, in every coding tool we use: when an action fails, say what happened and give the person a useful next step. Add it to our project instructions.

That request is all you need to give. If you're not sure of the wording yet, ask the agent to propose it first.

## What your agent does

You don't need to run any of these commands yourself. They're here so you know what's happening.

**It works in its own worktree.** A worktree is a separate copy of the project on its own branch. The agent keeps using the task's worktree if it already has one.

**It edits the source.** Your project's rules live in one source file, `discern/instructions.md` by default. Each coding tool reads its own file, such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. discern builds those files from the source, so an edit made only to one of them is lost at the next refresh. If a rule on the same subject already exists, the agent updates it. A second copy would give later sessions a different answer.

**It refreshes the tool files.** `discern refresh --dry-run` shows what refresh would write, and `discern refresh` writes it. `discern prepare`, the agent's quick check while it works, refreshes too. Refresh also keeps skills and each tool's connection settings current, so the agent tells you about anything in the preview you didn't expect. If refresh can't finish, its result names what failed and how to fix it.

**It commits and runs the gate.** The **gate** is the full set of checks your project requires. It fails if a generated instruction file doesn't match its source, so no tool is left reading an old copy. A pass produces **Proof**, discern's record of which checks passed on exactly which commit.

**It brings the change to you.** Instruction changes wait for your review unless you've pre-approved them. That keeps you in charge of what every future session is told. [Finish and land a change](finish-and-land-a-change.md) covers review and landing.

## Check the wording

A good rule says when it applies and what to do. It makes sense to a session that never saw your conversation. For the error-message example, the agent might write:

> When a user action fails, explain what happened and offer a useful next step. Only suggest a step the app supports.

The second sentence matters. A cheerful suggestion the app can't carry out leaves people worse off than before.

Read the rule the way the next agent will. Does it belong in every session, or only in some tasks? Does it keep the distinction you care about? "Make errors better" leaves the next agent to guess what you meant.

Keep each rule short. Every session reads every instruction, so a long one costs every task. Put the fuller reasons in the project map, the guide your agents keep to how the project works, and link to them from the rule. [Instructions, skills, and the map](../20-understand/instructions-skills-and-map.md) explains which home fits which kind of lesson.

## Check that a new session follows it

Once the change lands, open a new session in any of your coding tools and ask:

> What do our project instructions say about messages shown when an action fails?

The answer should quote your rule, and you shouldn't need to paste it in. A session reads its instructions when it starts, so a session that was already open still has the old version.

If a new session can't find the rule, ask your agent to check how that tool loads its files. [Connect a coding agent](connect-a-coding-agent.md) covers the recovery.

## When it's done

- One source holds the rule.
- The gate passed on the committed change, so every tool's file matches that source.
- The change has landed with your permission.
- A new session finds the rule without your help.

From now on, every session in every configured tool starts with that rule. If you switch coding tools later, the rule comes with the project.

The [configuration reference](../30-reference/config-reference.md#instructions) lists the source settings, and [Files and ownership](../30-reference/files-and-ownership.md) shows which files discern generates.
