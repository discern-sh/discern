---
id: start-first-real-change
title: "Make and review your first change"
description: "Ask for a small improvement, try the result, understand its evidence, and decide whether to make it part of your project."
order: 40
publish: true
kind: tutorial
aliases:
  - "start-first-real-change"
  - "first real change"
  - "review my first change"
---

# Make and review your first change

A small improvement is a good way to learn discern's complete workflow. You can see whether the result helps, understand what your agent checked, and make a landing decision without needing to follow every line of code.

This tutorial uses a search page that says “No results” when it finds nothing. You will ask your agent to make that message more helpful, try the result, and decide whether to add it to the shared project. The same pattern works for a clearer button label or a short explanation beside a form.

## Before you begin

Finish [setup](first-success.md) and open a fresh coding-agent session that can call discern's tools. Use a project where you can try a small change locally. If it has no search page, choose another small wording improvement you can see in the app or its documentation.

The time depends on your project's checks. Allow for your agent to make the change and run those checks, with a few minutes of your own time to try the result.

## 1. Give the request

Tell your agent:

> Make the message shown when search finds nothing more helpful. Suggest wording that tells people they can try a different search. Keep the search behavior the same. Show me how to try the result, explain what you checked, and wait for my review before landing it.

This request gives the agent a purpose and a clear limit. You want to help someone continue after an empty search; you are not asking for a new search system.

For another feature, keep those same ingredients: what should improve, what should stay the same, and how you want to review it.

## 2. Let your agent prepare the change

Your agent checks the project state, creates an isolated workspace called a **worktree**, and makes the change there. The project's shared branch, called the **trunk**, stays apart from the unfinished work.

The agent then runs the project's configured checks, collectively called the **gate**. A check might confirm that the app builds or that searching still returns the expected items. If a check fails, the agent investigates and fixes the cause before reporting completion. [Fix a red gate](../10-guides/fix-a-red-gate.md) explains that path.

You should receive the changed wording, a way to try the right version, an account of the checks, and a **Proof line**. Proof records that the gate passed for one exact saved version of the change. It lets you connect the agent's report to the work that was checked.

<!-- discern-workflow:procedure -->

## 3. Try the result

Trying the changed experience connects your request with something you can judge. For the search example, follow the same small journey a person using your app would take.

**Before you start:**

- Your agent has prepared the changed app and given you a way to open it.
- The preview shows this task's version rather than the unchanged shared project.

**Steps:**

1. **Find a known item.** Search for something that is present and confirm the usual results still appear.
2. **Try an empty search result.** Search for something that is absent, read the new message, and consider whether you know what to do next.
3. **Follow the suggestion.** Change the search and check that you can get back to useful results.

**You are done when:** you have seen the changed message in context and can say whether it helps someone continue.

<!-- /discern-workflow -->

A message such as “No results. Try a different word or a shorter search” offers a next step. Its usefulness still depends on your app: if it only searches exact item names, the wording should reflect that.

This is a review of the experience you requested. Your knowledge of the people using the app helps you notice things an automated check may not capture.

## 4. Understand what was checked

Ask:

> Explain the Proof for this change. What checks cover the search behavior, what did you try directly, and what remains for me to assess?

Your agent can retrieve the full Proof through discern's status tool or `discern status --verbose`. The answer should distinguish checks recorded by the gate from observations the agent made separately. A passing build, for example, does not tell you whether a message is clear.

For this small change, you now have the requested result, your own experience of it, and the evidence available. If any of those are missing, ask for them before deciding. Larger changes may call for code review, independent review, or checks on another device; the depth should fit the consequences of the change.

## 5. Ask for a revision or land it

If the wording is still unclear, give specific feedback:

> The message should say that search only looks at saved items. Please revise it and bring the checked result back.

The agent continues the same task. Its revised files need fresh verification because the previous Proof covered a different version.

When the result is right, say:

> I've reviewed the change. Land it.

Your agent uses discern's acceptance operation, which checks the evidence and your permission before moving the change onto the trunk. It reports the landing result and any cleanup still needed. If the shared project has changed in the meantime, the agent follows discern's instructions to bring the work together and verify it.

Landing makes the change part of the shared project. Publishing it to users is a separate step in your project's release process.

## What you now have

The small improvement is on the trunk, with a record of the checks that covered it. You have also practiced the part of the workflow that will stay useful as the work grows: give a clear purpose, try the result, understand the evidence, and decide what becomes shared.

<!-- discern-workflow:branch-choice -->

**Choose your next task**

- **Build another improvement:** [Finish and land a change](../10-guides/finish-and-land-a-change.md) covers the daily workflow and review feedback.
- **Save a lesson:** [Write project instructions](../10-guides/write-project-instructions.md) shows how to carry a convention into future sessions.
- **Understand the evidence:** [Proof](../20-understand/proof.md) explains what completion establishes and how it stays attached to the work.

<!-- /discern-workflow -->
