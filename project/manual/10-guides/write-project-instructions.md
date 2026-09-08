---
id: guide-write-project-instructions
title: "Write project instructions"
description: "Record a working rule once, supply it to your configured coding tools, and confirm a fresh session can use it."
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

A useful correction should last longer than the conversation where you made it. Project instructions let you record a working rule once and supply it to every configured coding tool, so you can build on the lesson in later sessions.

Use this guide for a rule agents should know whenever they work on the project. For a longer method used only on certain tasks, [a skill](create-and-manage-skills.md) is a better home.

## Starting state

The project has completed discern setup. You have a rule you want future work to follow, and your agent will make the instruction change in the current effort's worktree or start one if this is a new task.

For example, after reviewing an unhelpful message in your app, you might say:

> Remember this for future sessions, including when I switch coding tools: when an action fails, explain what happened and give the person a useful next step. Add it to our shared project instructions.

That request authorizes recording the rule. You can also ask your agent to propose wording first if you are still deciding what the rule should be.

## 1. Find the authored source

Your agent checks `discern.toml` to find the project instruction source. The default is `discern/instructions.md`; `[instructions].sources` can name other files or groups of files.

Ask the agent to update an existing rule if one already covers the subject. Keeping one version avoids giving future sessions slightly different instructions in different places.

Files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are generated entry points for coding tools. Your agent edits the source and lets discern update those files. A change made only to a generated copy would be overwritten at the next refresh.

## 2. Write the rule for a fresh reader

A good instruction states when it applies and what the agent should do. It should still make sense to a session that has never seen your conversation.

For the message example, the source might contain:

> When a user action fails, explain what happened and offer a useful next step. Keep the wording accurate to the recovery the app supports.

The second sentence matters: a cheerful suggestion that the app cannot fulfill would make the experience worse.

Read the proposed rule for its effect on future work. Does it apply broadly enough to belong in every session? Does it preserve the distinction you care about? Wording such as “make errors better” leaves the next agent to guess what you meant.

Keep longer explanations in the project guide and link to them when needed. Instructions stay useful when a session can find the important rules quickly. [Instructions, skills, and the map](../20-understand/instructions-skills-and-map.md) explains the placement choices.

## 3. Preview and refresh the agent files

Your agent previews the change with discern's refresh tool in dry-run mode, or `discern refresh --dry-run`. The preview lists the files discern plans to update.

Refresh covers more than the instruction text: it can also update generated skills, provider integration files, and other managed artifacts. The agent should inspect the plan and explain any change that needs your attention before applying it.

The agent then applies refresh. A successful result can say nothing changed if the files were already current. A partial result means some work remains, even if several files were written. The result names the affected part and the supported recovery, so the agent can repair it and retry.

## 4. Review and verify the change

Ask to see the source rule and the wording a configured coding tool will receive. Some providers use the full generated file and others a pointer to it; they should all lead back to the same authored rule.

Your agent runs the preparation checks, reviews any generated changes, and commits the source together with the tracked outputs. It then runs the full gate on that saved version and returns Proof with its report. [Finish and land a change](finish-and-land-a-change.md) covers the landing step.

The gate checks that generated instruction files agree with their sources. That establishes the files are current; it does not establish that an already-running session has reloaded them.

## 5. Confirm future sessions receive it

After landing, open a fresh session in a configured coding tool and ask:

> What do our project instructions say about messages shown when an action fails?

The agent should find the recorded rule through its project instructions. You should not need to paste the rule into that session yourself.

If the source and generated files are current but the session cannot find the rule, ask the agent to check the tool's activation and loading steps. [Connect a coding agent](connect-a-coding-agent.md) explains that recovery. Refreshing files and loading them into a session are separate steps.

## Completion

You have one source for the rule, current generated files, a passing gate for the committed change, and a fresh session that can find the instruction. The lesson is now available to future work, rather than depending on your memory of this conversation.

[Configuration reference](../30-reference/config-reference.md) holds the source syntax and ordering rules; [Files and ownership](../30-reference/files-and-ownership.md) identifies the generated paths.
