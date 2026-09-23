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

A substantial idea can become several tasks that fresh agents carry on their own. Each task gets a complete brief, its own copy of the project, and a result you can try. You decide what the work should achieve. The agents handle the handovers between them.

This guide follows one idea from plan to review, for a reading-list app. Books should be easier to find, the list should work on a phone, and new readers need clearer help.

## Before you start

You need discern set up in your project and an outcome in mind. You don't need a file list or a technical plan. The planning agent reads the project and proposes those.

Bring the context only you have: who the change is for, what bothers them today, and what must stay as it is.

## Ask your agent for a plan

Ask for a plan before any work starts:

> Use discern-delegate-work to plan these improvements: make books easier to find, make the reading list comfortable on a phone, and improve the getting-started help. Suggest which tasks can run at the same time. Keep the existing features, tell me what you need me to decide, and show me the briefs before anything starts.

`discern-delegate-work` is a **skill**: a ready-made playbook your agent follows. It has the agent find where the work divides cleanly, write a brief each fresh agent can act on, and review each result. The skill runs inside your coding agent. discern adds no model of its own.

## Check how the work splits

Your agent comes back with a short plan. For the reading list, it might look like this:

| Task                    | What you'll be able to try                             | What might change the split                                     |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Find a book             | Search the list by title or author.                    | Search and the phone layout may change the same screen.         |
| Use the list on a phone | Read titles and reach the controls on a narrow screen. | Changes to that shared screen may belong with search.           |
| Improve the help        | Follow the steps to add and find a first book.         | The help should describe search as it works once it's finished. |

The agent checks the real code before it recommends a split, because two features that sound separate can change the same files. Tasks that would edit the same files either merge into one task or run one after the other. That way they don't collide when they land.

Each task should end in something you can try. If a split makes a simple change harder to explain, ask the agent to combine the tasks. One task can still use helper agents for research or review inside its own workspace.

Each separate task gets its own **worktree**: a separate copy of the project on its own branch. When one task needs another's result, the plan puts them in order. Here, the help task needs search, so it can describe what search does. The help task's agent [waits for search by itself](wait-for-another-task.md), so you never carry "search is ready" from one session to another.

## Read each brief as a stranger would

A fresh agent never sees your planning conversation. It starts with its brief and a new copy of the project. So the planning agent writes each brief to stand alone. It covers the background, the files involved, the behavior you expect, what's out of bounds, and which checks the work must pass. It also names the worktree the task should use and any task it waits for.

Check that each brief gives:

- **A result you can try.** "Search finds books by title or author" tells you what to test.
- **A clear boundary.** "Keep the way books are added" protects something you already like.
- **A way to check it.** The brief says which checks must pass and who reviews the result.

Leave technical choices to the receiving agent, and ask it to explain what they mean for you. Product choices need your direction. For example, should search include books you've already read?

To find gaps before anyone starts, ask:

> Read these briefs as a fresh agent would. What would you have to guess? Fill in what you can learn from the project, and bring me the decisions only I can make.

Each brief also carries your project's standing rules. The agent runs the full set of checks before calling its work done. When it fixes a bug, it fixes the cause and adds a check that fails if the bug comes back. It writes down decisions a later session will need. So each delegated task leaves its gains in place for the tasks that follow.

## Decide what lands without you

To **land** a change is to add it to your project's shared branch, usually `main`. Starting a task and letting it land are separate decisions. Make the second one now, for each task, and the planning agent writes your answer into its brief:

- **Review first.** The task passes its checks, then stops at its **Proof**, discern's record of which checks passed on exactly which commit. It waits there for you.
- **Land when green.** You give permission in advance. When the task's checks pass, its agent lands it without asking you.

You can give that permission from the **desk**, the interactive view that opens when you run `discern` in your main checkout. A standing grant in your project's settings can also cover areas such as documentation. [Proof](../20-understand/proof.md) explains where permission to land can come from. No grant covers an unmet checkpoint, a change to a standard's limit, or an emergency landing. Those always come back to you.

Approving one task doesn't approve another. If the help task builds on search before search lands, landing the help task brings search's code with it. So approve it only once you're happy with both.

After that, the agents coordinate the rest. A finished task submits its exact checked commit for landing. If another task lands first, discern checks the two changes together and lands the version that passed, so the later task doesn't start over. A task that depends on another holds until that work is ready. Your briefs don't need to ask for extra test runs, a message before each landing, or a preview left open until the end.

## Start the tasks

Before anything starts, you should have:

- a brief for each task that you can copy as it is;
- how many sessions will run, and which run at the same time;
- which tasks wait for others;
- any limit that affects the plan, such as how many test runs your machine can handle at once.

Nothing starts until you say so. Launch the briefs yourself, or accept your agent's offer to launch them. If the plan changes after that, the agent shows you the new plan before it starts anything more.

The agent records each task's branch and worktree, so later feedback reaches the right task. [Coordinate parallel tasks](coordinate-parallel-tasks.md) covers following the work while it runs.

## Review what comes back

Try each result against what you asked for. For search, find a book by title and another by author, then search for something that isn't there. Ask your agent what the checks covered and what still needs your judgment.

A second agent can review the work on its own. It reads the actual changes and compares them with the brief:

> Review this task against its brief and its current Proof. Try the promised behavior, read the changed code, and tell me what falls short or still needs my decision.

A pass means the project's checks passed on that commit. It can't tell you whether search feels right to use. That judgment is yours.

Send any changes back to the same task. Its agent makes them in the same worktree, commits, and runs the checks again. The old Proof covered the old version, so the new version comes back with new Proof. [Finish and land a change](finish-and-land-a-change.md) covers review and landing in detail.

## You're done when

The handoff is ready when you understand the tasks, each brief stands alone, and you've decided which tasks may land without you. The work is done when you've reviewed each result, and each landing result says what reached `main` and what's still waiting. A task that passed its checks is only ready. It isn't on `main` until it lands.

Delegation is one of the skills that come with discern. [Create and manage skills](create-and-manage-skills.md) covers the rest.
