---
id: explanation-worktrees-and-trunk
title: "Worktrees and trunk"
description: "Understand where separate tasks work, how their results come together, and what reaches the shared branch."
order: 40
publish: true
kind: explanation
aliases:
  - "explanation-worktrees-and-trunk"
  - "the trunk"
  - "trunk branch"
  - "landing branch"
  - "worktree"
---

# Worktrees and trunk

Suppose you want to add search to your app and improve its phone layout at the same time. Each agent needs room to change the project, try an approach, and correct mistakes. Meanwhile, you want the shared version of the project to remain available.

discern gives each separate task an isolated workspace called a **worktree**. The **trunk** is the shared branch that accepted work joins, usually `main`. Work can continue in several worktrees while the decision to add those changes to the trunk remains separate.

## A worktree is a task's own place

A worktree contains a separate working copy of the project and has its own branch, where the task's commits are recorded. The search agent edits its copy; the phone-layout agent edits another. Their saved files do not overwrite each other.

A new task normally starts from the trunk through `discern start`. discern also prepares the environment the project declares for it, such as a development-server port and a separate test database. This matters because two agents need more than separate source files if their tests would otherwise change the same data.

The worktree stays with the effort through implementation, review, and resumed sessions. If you ask for a change to search after reviewing it, the agent continues that effort. A fresh conversation does not mean the work must start again.

The main checkout is the original project directory from which you oversee the tasks. Agents do their task edits in worktrees, so that directory can stay available for inspecting the shared project.

## The trunk is what the project agrees on

The trunk is the common version that new work builds from. In discern's normal workflow, a task reaches it through **acceptance**: the step that checks the evidence and permission for landing.

Finishing a feature does not add it to the trunk automatically. The agent commits its work and runs `discern done`, which records [Proof](proof.md) for the validated change. You can review the result before it joins the shared project, or use a recorded permission for work you have already authorized.

Finished tasks wait in a queue and land in a stable order: a task that was built on another lands after it, an order you chose is kept, and the rest follow the order in which they became ready. Approving one task approves only that task.

Think of the reading-list search as an example. You can try it in its worktree, discover that it should search authors as well as titles, and ask for that improvement. Those iterations can happen while the trunk continues to hold the previously accepted version.

This is a working practice, not a sandbox around the agent. It separates checkouts and declared resources; your coding-agent host still governs what commands the agent may run on your machine.

## How work and evidence move

These commands connect a task to other work:

| Operation       | What it does                                                                       | In the reading-list example                                                |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Update**      | Brings the latest trunk into an existing worktree.                                 | The search task receives a phone-layout improvement that has landed.       |
| **Composition** | Builds a task on an explicit commit or branch, including work that has not landed. | A help-writing task tries the checked search feature before you accept it. |
| **Accept**      | Lands validated, authorized work on the trunk.                                     | The shared app receives the approved search improvement.                   |

For an update, `discern_update` reports files changed on both sides so the agent knows what to re-read. For composition, the agent uses `discern start --from <ref>` or `discern update --from <ref>`. It can [wait for another task](../10-guides/wait-for-another-task.md) to supply the checked commit it needs.

With several tasks ready, discern can validate a **candidate** that combines the task's committed work with earlier ready changes. Proof identifies the exact candidate checked. Acceptance validates each candidate's evidence and permission before landing it; one task's permission does not automatically cover another's work.

You do not need to manage that record by hand. The completion and landing results explain what was verified, what reached the trunk, and what is still waiting. [Finish and land a change](../10-guides/finish-and-land-a-change.md) shows how to review those results.

## What isolation covers, and what it can't

Separate worktrees prevent agents from overwriting the same working copy. They cannot make two features agree about how the app should behave.

The search task might add a search box above the reading list. The phone-layout task might use that same space for a menu. Both changes could work in their own copies, but the combined screen still needs review. discern's fleet view reports files changed by more than one task, and update reports incoming overlap. The agent uses those signals to investigate the combination.

The same care applies to resources. A database declared separately for each worktree can keep test data apart. A shared external service that was never included in that setup remains shared.

## What happens to a finished workspace

Ordinary successful completion releases the checkout from authoring control. discern can then use eligible released environments for further validation and remove eligible checkouts after landing. If more local editing is planned, `discern done --retain-checkout` keeps authoring control.

Release does not make a workspace available for another agent to adopt. Resumed work follows the reported state of its own effort. After a landing, the workspace goes when nothing else holds it. When it stays, the result says why in one sentence: it was never released, it is still in use, its branch or files changed, or its ownership could not be verified. The landing stands either way, and the result names the command that finishes cleanup.

For a longer pause, parking can remove a clean checkout while keeping the task's branch, committed work, and wording. You can return to the branch later. [Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md#park-a-task-you-will-return-to) covers that choice; [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) covers a session or operation that stopped unexpectedly.

Use [Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md) to put this model to work. The [worktrees and status reference](../30-reference/worktrees-and-status.md) lists the exact identity, environment, and status fields.
