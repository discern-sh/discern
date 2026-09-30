---
id: guide-delegate-work
title: "Delegate substantial work"
description: "Turn a big idea into tasks that fresh agents can carry on their own, then review what comes back."
order: 50
publish: true
kind: guide
aliases:
  - "guide-delegate-work"
  - "Bundled Skills"
  - "built-in skills"
  - "bundled playbooks"
  - "skill catalog"
---

# Delegate substantial work

A substantial idea can become several tasks that fresh agents carry on their own, each with a complete brief, its own copy of the project, and a result you can try. You decide what the work should achieve, and the agents handle the handoffs.

## Before you start

Say you want your reading-list app to make books easier to find, work well on a phone, and give new readers clearer help. With discern set up, that outcome is enough, because the planning agent reads the project and proposes a file list and plan. Bring what only you know: who it's for, what bothers them, and what must stay as it is.

## Ask your agent for a plan

Ask for a plan first:

> "Plan how to split these improvements into tasks, keeping the existing features. Show me the briefs and any decisions you need from me before anything starts."

Your agent follows discern's `discern-delegate-work` **skill**, a playbook for this job. The skill has your agent find where the work divides cleanly, write a brief each fresh agent can act on, and review each result. To be sure your agent uses it, name the skill in your request.

## Check how the work splits

The plan might look like this:

| Task                    | What you'll be able to try                     | What might change the split               |
| ----------------------- | ---------------------------------------------- | ----------------------------------------- |
| Find a book             | Search by title or author.                     | May share a screen with the phone layout. |
| Use the list on a phone | Reach every control on a narrow screen.        | May belong with search.                   |
| Improve the help        | Follow the steps to add and find a first book. | Needs search finished first.              |

Your agent checks the real code before suggesting a split, because features that sound separate can change the same files. Tasks that would share files become one task or run in order, so they don't collide. If a split makes a simple change harder to explain, ask to combine the tasks.

Each task gets its own **worktree**, a separate copy of the project on its own branch. The help task's agent [waits for search by itself](wait-for-another-task.md), so you never carry "search is ready" between sessions.

## Read each brief as a stranger would

A fresh agent never sees your planning conversation, only its brief and a new copy of the project. So the planning agent writes each brief to stand alone. Check that each brief gives:

- **A result you can try.** "Search finds books by title or author" tells you what to test.
- **A clear boundary.** "Keep the way books are added" protects something you already like.
- **A way to check it.** The brief names the tests and other checks that must pass, and who reviews the result.

Leave technical choices to the receiving agent, and settle product ones yourself: should search include books you've already read? To find gaps before anyone starts, ask:

> "Read these briefs as a fresh agent would. What would you have to guess? Fill in what the project tells you, and bring me the decisions only I can make."

Each brief also carries your project's standing rules, such as adding a test for every bug it fixes, so each task leaves its gains in place for the next.

## Decide what lands without you

A change **lands** when it joins your shared branch, usually `main`. Starting a task and letting it land are separate decisions. Make the second now, for each task, and the planning agent writes it into the brief:

- **Review first.** The task passes its checks, then waits for you with its **Proof**: discern's record of which of your project's commands passed on one exact commit.
- **Land when green.** You give permission in advance, so its agent lands it once its checks pass.

[Pre-approve routine work](finish-and-land-a-change.md#pre-approve-routine-work) explains how. No permission given in advance covers an unmet [review question](../10-understand/checkpoints.md), a looser limit on a measured standard, or an emergency landing. Those always come back to you. Approving one task doesn't approve another. Because the help task builds on search, landing it first would bring search's code too, so approve it only once you're happy with both.

The agents coordinate the rest. If another task lands first, discern checks the two changes together and lands what passed, so the later task doesn't start over. Briefs don't need to ask for extra test runs or a message before each landing.

## Start the tasks

Before anything starts, you should have:

- a brief for each task, ready to copy;
- which tasks run at once, and which wait;
- any limit on the plan, such as how many test runs your machine can handle.

Nothing starts until you say so. Launch the briefs yourself, or let your agent launch them. Your agent records each task's branch and worktree, so later feedback reaches the right task. [Coordinate parallel tasks](coordinate-parallel-tasks.md) covers following the work while it runs.

## Review what comes back

Try each result against what you asked for. Find a book by title and another by author, then search for something that isn't there. A pass means your project's commands passed on that commit, so it can't tell you whether search feels right to use.

A second agent can review the work independently against the brief:

> "Review this task against its brief and its current Proof. Try the promised behavior, read the changed code, and tell me what falls short or still needs my decision."

Send any changes back to the same task. Its agent makes them in the same worktree. Any new commit makes the old Proof stale, so the new version comes back with new Proof. [Finish and land a change](finish-and-land-a-change.md) covers review and landing.

## You're done when

The handoff is ready when you understand the tasks, each brief stands alone, and you've decided what may land without you. The work is done when you've reviewed each result and its landing says what reached `main`. A task that passed its checks is ready, and it isn't on `main` until it lands. [Create and manage skills](create-and-manage-skills.md) covers discern's other skills.
