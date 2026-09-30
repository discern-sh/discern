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

A small change you can see is the quickest way to learn the everyday workflow: you ask for it, try the result, see which of your project's commands passed, and decide whether it joins your project. You don't need to read the code to do that.

Say your reading-list app shows only "No results" when a search finds nothing, and you'd like the message to help people try again.

## Before you begin

Finish [setup](installation-and-setup.md), then open a fresh session with your coding agent, in a project you can run yourself. If it has no search, pick another small wording change you can see. Allow time for your tests to run, plus a few minutes to try the result.

## 1. Give the request

Tell your agent:

> "When a search finds nothing, make the message more helpful, so people know to try a different search. Keep the search itself the same. Show me how to try it, explain what you checked, and wait for my review before landing it."

Any request works this way: say what should get better, what should stay the same, and how you'll review it.

## 2. Let your agent prepare the change

Your agent makes the change in a **worktree**, a separate copy of the project on its own branch, so your shared branch, the **trunk** (usually `main`), stays untouched while it works.

When the new message works, your agent commits it and runs the **gate**: your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. If a test still expects "No results", it fails, so your agent updates it and runs the gate again, as [Fix a red gate](../20-guides/fix-a-red-gate.md) explains.

When the gate passes, your agent brings back a way to try the new message, what it checked, and a **Proof line**. **Proof** is discern's record of which commands passed on one exact commit, so you can match the report to the version you try:

> **Proof:** Gate passed for `agent/empty-search-message-a18caf` at `c57fa9751cf5` · 2 files changed (+4 −3) vs `main` · View the full Proof: `discern status --verbose`

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

Say the new message reads "No books match that search. Try a different word." You know your search also finds books by author, so the message could say that too.

## 4. See what was checked

Ask:

> "Which tests cover the search, what did you try yourself, and what's left for me to judge?"

Your agent's answer should keep the gate's results apart from what it tried by hand. The updated test confirms the new message appears, but it can't tell you whether the message is clear.

If your project has **checkpoints**, review questions your agent answers when certain files change, the Proof shows the answers. If your agent answers that a question isn't met, only you can let the change land, as [Checkpoints](../10-understand/checkpoints.md#declared-unmet-and-your-variance) explains.

A bigger change may call for a code review, depending on what it could affect.

## 5. Ask for a revision or land it

Ask for the revision:

> "Mention that people can also search by author, and bring back the checked result."

Your agent commits the new version in the same worktree and runs the gate again, because the old Proof covered the old version. When it's right, say:

> "I've reviewed the change. Land it."

discern checks the Proof and your permission before the change **lands**, joining the trunk, because a passing gate doesn't land anything by itself. If another task lands first, that doesn't send your change back to the start: discern [checks the two changes together](../20-guides/finish-and-land-a-change.md#when-other-work-lands-first) and lands exactly what passed.

The result's first sentence says whether it landed, and if not, what comes next:

```text
Landed agent/empty-search-message-a18caf at 836e25a02ef7 on main; its checkout, branch, and resources are gone.
```

The landed commit, `836e25a02ef7`, is your revision, which the gate checked again. Releasing it to your users stays with your own release process.

## What you now have

Your improvement is on the trunk, with a record of what passed on it, and you've practiced the loop that stays useful as the work grows.

<!-- discern-workflow:branch-choice -->

**Choose your next task**

- **Build another improvement:** [Finish and land a change](../20-guides/finish-and-land-a-change.md) covers the everyday workflow and review feedback.
- **Save a lesson:** [Write project instructions](../20-guides/write-project-instructions.md) shows how to carry a rule into future sessions.
- **Understand the record:** [Proof](../10-understand/proof.md) explains what a pass means and how it stays with the code.

<!-- /discern-workflow -->
