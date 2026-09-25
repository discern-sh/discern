---
id: start-first-real-change
title: "Make and review your first change"
description: "Ask for a small change, try it, see what was checked, and decide whether it joins your project."
order: 40
publish: true
kind: tutorial
aliases:
  - "start-first-real-change"
  - "first real change"
  - "review my first change"
---

# Make and review your first change

A small change you can see is the quickest way to learn the everyday workflow: you ask for it, try the result, see which of your project's commands passed, and decide whether it joins your project. You don't need to read every line of code to do that.

Say a search in your reading-list app that finds nothing says only "No results", and you'd like the message to help people try again. The same steps work for a clearer button label or a short hint beside a form.

## Before you begin

Finish [setup](installation-and-setup.md), and open a fresh session with your coding agent. Use a project you can run and try on your own machine. If it has no search, pick another small wording change you can see in the app or its documentation.

How long this takes depends on your project's tests. Allow time for your agent to make the change and run them, plus a few minutes of your own to try the result.

## 1. Give the request

Tell your agent:

> "Make the message shown when a search finds nothing more helpful. Suggest wording that tells people they can try a different search. Keep the search itself the same. Show me how to try the result, explain what you checked, and wait for my review before landing it."

The request gives the agent a purpose and a limit: you want to help someone carry on after an empty search, and the search itself stays as it is. For any feature, say what should get better, what should stay the same, and how you want to review it.

## 2. Let your agent prepare the change

Your agent makes the change in a **worktree**, a separate copy of the project on its own branch, so your shared branch, the **trunk** (usually `main`), stays untouched while it works. The change joins the trunk only when it **lands**, after your review.

When the new message works, the agent commits it and runs the **gate**: your project's own commands, such as its linter, type checker, and test suite, which must all pass before a change counts as finished. The gate only runs on committed work, so its results describe a version that can land. Say your search test still expects "No results". It fails, and the agent gets the failing command, its output, and a command that reproduces that failure on its own. It updates the test to expect the new message, commits, and runs the gate again. [Fix a red gate](../20-guides/fix-a-red-gate.md) explains that path.

When the gate passes, you get the new wording, a way to try this version of the app, an account of what the agent checked, and a **Proof line**. **Proof** is discern's record of which of your project's commands passed on one exact commit, a saved version of the code, so you can match the agent's report to the version you're about to try:

> **Proof:** Gate passed for `agent/empty-search-message-a18caf` at `c57fa9751cf5` · 2 files changed (+4 −3) vs `main` · View the full Proof: `discern status --verbose`

The change touches the message and its test.

<!-- discern-workflow:procedure -->

## 3. Try the result

Trying the change connects your request to something you can judge. Use the search the way someone using your app would.

**Before you start:**

- Your agent has prepared the changed app and told you how to open it.
- What you open shows this task's version of the app, from its worktree.

**Steps:**

1. **Find something that's there.** Search for a book you know is on the list, and check that the usual results still appear.
2. **Search for something that isn't.** Read the new message, and ask yourself whether you'd know what to do next.
3. **Follow the suggestion.** Change the search, and check that you get back to useful results.

**You are done when:** you've seen the new message in context and can say whether it helps someone carry on.

<!-- /discern-workflow -->

A message such as "No books match that search. Try a different word or a shorter search." gives people a next step. Whether it's right depends on your app: your search also finds books by author, so the message could say that too.

This part of the review is yours. You know the people who use your app, so you'll notice what the tests don't cover.

## 4. See what was checked

Ask:

> "Walk me through what was checked. Which tests cover the search, what did you try yourself, and what's left for me to judge?"

Your agent can show the full Proof with `discern status --verbose`, and its answer should keep the gate's results apart from what it tried by hand. The updated test confirms the new message appears, but it can't tell you whether the message is clear.

Your project may also have **checkpoints**: review questions your agent answers when certain files change. If one applies, the Proof shows the agent's answer. If the agent answers that a question isn't met, the Proof keeps its reason, and the change can land only if you decide to accept that gap.

For a small change like this, you now have the result, your own experience of it, and the record of what passed. If any of those is missing, ask for it before you decide. Bigger changes may call for a code review, an independent review, or a try on another device, so match the depth of your review to what the change could affect.

## 5. Ask for a revision or land it

If the wording still isn't right, say what you want:

> "The message should mention that people can also search by author. Please revise it and bring back the checked result."

Your agent keeps working in the same worktree. It commits the new version and runs the gate again, because the old Proof covered the old version.

When the result is right, say:

> "I've reviewed the change. Land it."

Your agent asks discern to land the change, and discern checks the Proof and your permission before it adds the change to the trunk. A passing gate doesn't land anything by itself, because landing needs your permission.

If another task landed while you were reviewing, that doesn't send your change back to the start: discern checks the two changes together and lands exactly what passed. If they conflict, or the gate fails on the combined code, nothing lands and your agent gets the details to fix. If another landing is already running, yours waits its turn and then carries on by itself.

The first sentence of the result says whether your change landed and what happened to its worktree, or, if it didn't land, what comes next:

```text
Landed agent/empty-search-message-a18caf at 836e25a02ef7 on main; its checkout, branch, and resources are gone.
```

The landed commit, `836e25a02ef7`, is your revision, which the gate checked again before it could land. Landing makes the change part of your shared project. Getting it to your users is a separate step in your own release process.

## What you now have

Your improvement is on the trunk, with a record of the commands that passed on it. You've also practiced the loop that stays useful as the work grows: you give a clear purpose, try the result, understand what was checked, and decide what lands.

<!-- discern-workflow:branch-choice -->

**Choose your next task**

- **Build another improvement:** [Finish and land a change](../20-guides/finish-and-land-a-change.md) covers the everyday workflow and review feedback.
- **Save a lesson:** [Write project instructions](../20-guides/write-project-instructions.md) shows how to carry a rule into future sessions.
- **Understand the record:** [Proof](../10-understand/proof.md) explains what a pass means and how it stays with the code.

<!-- /discern-workflow -->
