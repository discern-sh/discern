---
id: guide-delegate-work
title: "Delegate substantial work"
description: "Turn a large idea into clear tasks, give agents what they need, and review what comes back."
order: 50
publish: true
kind: guide
aliases:
  - "guide-delegate-work"
  - "The desk"
  - "interactive worktree manager"
  - "fleet dashboard"
  - "worktree picker"
  - "desk tips"
  - "tip line"
  - "Bundled Skills"
  - "built-in skills"
  - "bundled playbooks"
  - "skill catalog"
---

# Delegate substantial work

A substantial idea often needs more than a longer prompt. You might want to add several features, refresh every help page, or improve an app before sharing it. The useful first step is to turn that ambition into tasks with results you can recognize.

Your agent can help you make that plan. discern's delegation skill guides it through finding work that can run together, writing complete briefs, and arranging an independent review. You can spend your attention on what the work should achieve while the briefs carry the detail into fresh sessions.

## Starting state

Use this guide once discern is set up in the project and you have an outcome in mind. You do not need a file list or an engineering plan: the planning agent inspects the project and proposes those.

Give it the context only you can supply, such as who needs the change, what already frustrates them, and anything you want to preserve.

## 1. Ask the agent to use the delegation skill

Imagine you have an app that keeps a reading list. Finding a book is awkward, the phone layout needs attention, and new readers need clearer instructions. You could ask:

> Use discern-delegate-work to plan these improvements: make books easy to find, make the reading list comfortable to use on a phone, and improve the getting-started help. Suggest which tasks can run together. Keep the existing features, explain any decisions you need from me, and show me the briefs before starting the work.

The skill is a playbook for your agent. It helps the agent turn the request into specific outcomes and decide how to hand them off. It does not launch an extra model inside discern; the work runs in your coding-agent environment.

## 2. Decide which tasks can run together

Your agent should bring back a small plan you can assess. For the reading-list example, a proposal might look like this:

| Task                    | What you will be able to review                             | What may affect the split                                      |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Find a book             | Search the list by title or author.                         | Search and layout might change the same screen.                |
| Use the list on a phone | Read titles and reach the controls at a narrow screen size. | Shared screen changes may belong with search.                  |
| Improve the help        | Follow the instructions to add and find a first book.       | The final instructions depend on the finished search behavior. |

This is an illustrative plan; your agent needs to check the actual project before recommending it. Features that sound independent may rely on the same code.

Each task should have a result you can describe and review. If the split makes a simple change harder to explain, ask the agent to combine it. A single task can still use sub-agents for independent research or review while keeping one workspace and one finished change.

For genuinely separate tasks, each agent receives its own **worktree**: a workspace and branch for that effort. Where one task needs another's result, the plan can put them in stages. The later agent can [wait for the earlier task](wait-for-another-task.md) without asking you to carry progress messages between sessions.

## 3. Make every brief stand alone

A fresh agent does not inherit the planning conversation. Your planning agent writes a complete brief for each task, including the context, relevant files, expected behavior, exclusions, and checks. It also records any dependency and the worktree the task should use.

Read each brief as if it were the only instruction the next agent would receive. Check that it explains:

- **A visible result.** “Search finds books by title or author” gives you something to try.
- **A meaningful boundary.** “Keep the way books are added” preserves a part of the app you already like.
- **A review plan.** The brief explains how the result will be checked and who will review it.

You can leave technical choices to the receiving agent and ask it to explain their consequences. Product choices need enough direction to avoid guesswork: for example, whether search should include books you have already read.

A useful follow-up is:

> Read these briefs as a fresh agent. What would you have to guess? Fill in what you can learn from the project, and bring me the remaining product decisions.

## 4. Arrange dependencies and landing

Decide whether you want to review separate improvements as they finish, or review a combined result. To **land** a change is to add it to the project's shared branch, usually `main`.

Independent tasks can land separately. A staged change can build on earlier checked work before it lands. In the reading-list example, the help writer could use the completed search feature to write accurate instructions while you review the feature itself.

The planning agent records that arrangement in the briefs and gives each dependent task the exact branch identity returned when its prerequisite starts. You do not need to coordinate the moment of handover yourself.

Starting work and approving its landing are separate decisions, and review before landing is a choice you make per task rather than a turn every task owes you. A task whose scope you have already granted can finish its checks and land on its own; a task you want to see first stops at its Proof—the evidence for its exact checked commit—and waits. Ask the planning agent to state which is which in each brief. A later task's approval does not automatically approve earlier work included in it. [Proof, review, and authority](../20-understand/proof.md) explains how those decisions accompany the completed change.

The agents coordinate the rest without you. A finished task submits its proven commit for landing, an agent waiting for a sibling holds one call until the sibling is ready, and a task you pre-authorized can land when its agent starts acceptance on a green commit. Explicit queue-only submission waits for an active or later acceptance walk. A brief does not need to ask for a separate test run before the full check, a message to you when an independent task is ready to land, or a preview kept open until landing; none of them changes what the checks prove or what acceptance decides.

## 5. Start the agreed tasks

Before launch, you should have copyable briefs and a clear account of how many sessions will run, which tasks wait for others, and how their results come back for review. The agent should also flag limits in your environment that affect the plan, such as available agent slots or test capacity.

Launch the briefs yourself, or accept the agent's offer to launch the described set where your environment supports it. If the proposed set changes, review the revised arrangement before starting the additional work.

The agent records each returned branch and path so feedback reaches the same effort later. [Coordinate parallel tasks](coordinate-parallel-tasks.md) covers following the work once it is running.

## 6. Review what comes back

Try the result against the request. For search, find a book by title, find another by author, and try a search with no matches. Ask your agent to show what the project's checks established and what still needs judgment.

An independent reviewing agent can examine the code, compare the implementation with the brief, and investigate concerns you cannot assess yourself:

> Review this task against its brief and current Proof. Try the promised behavior, inspect the changed code, and tell me what falls short or still needs my decision.

Use the review to decide whether the result serves your readers. Passing checks supply evidence about the configured requirements; they do not decide whether the feature is useful or pleasant to use.

Send any corrections back to the same effort. Its agent follows the reported worktree state, makes the changes, and renews completion evidence. See [Finish and land a change](finish-and-land-a-change.md) for reviewing and accepting the result.

## Completion

The handoff is ready when you understand the proposed tasks, each fresh agent has a complete brief, and the review and landing arrangements are clear. The work is complete when those results have been reviewed and the landing result says what reached the shared branch and what remains pending.

## Inspect decisions from the desk

From the main checkout, bare `discern` opens the desk. It lists the fleet—the project's worktrees—in a stable order and keeps task controls available while observations refresh. Use `discern status --verbose` when you need the full evidence behind a row. A clean worktree still belongs to its effort.

The selected task opens its main controls. More actions contains secondary operations; Proof and details holds evidence. Activation checks current state and explains any refusal. The table below follows the live desk registry.

Read the manual opens the same offline document browser as `discern docs`. Search for a page, follow its links, and return to the desk with the same task selected. In action reviews, Tab moves between the reading region and choices; Escape returns without activating a choice.

### Queue a proven task

On the selected task, **Accept and land now** submits the reviewed revision and starts the existing landing path. It may wait for another landing or check the combination with newer shared work. It then considers other authorized submissions.

Join the landing queue records that proven revision without running checks or starting a landing. The flow reuses a grant or asks you to pre-authorize the effort explicitly. An active or later acceptance walk may pick it up. Use “Accept and land now” to start a walk when none is running; queueing schedules no background run and promises no delay.

Pre-authorizing an effort alone does not queue a revision. After the agent has stopped, grant permission if needed, then explicitly choose **Join the landing queue**. Revoking permission keeps the submission visible awaiting authority. A later commit or green `done` does not replace the queued commit; review and submit the new revision explicitly. Unmet checkpoints and changed standard limits still require your separate, exact approval.

A later edit makes the current Proof stale because the work no longer matches the checked commit. The agent renews that evidence before the new revision can be submitted.

The command-line equivalent is `discern accept --queue-only` from the proven worktree. Use `discern accept --queue-only --dry-run` to review its revision and authority.

<!-- BEGIN DESK ACTION REGISTRY -->

| Id             | Group  | Contextual label                                                       | Command evidence                     | Confirmation                                                     |
| -------------- | ------ | ---------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `recovery`     | Work   | Show recovery steps                                                    | `discern status --all`               | None                                                             |
| `retry_setup`  | Manage | Retry setup                                                            | `discern worktree setup`             | No by default; Retry                                             |
| `done`         | Work   | Run final checks                                                       | `discern done`                       | No by default; Run                                               |
| `accept`       | Review | Accept and land now                                                    | `discern accept`                     | No by default; Land                                              |
| `submit`       | Review | Join the landing queue                                                 | `discern accept --queue-only`        | No by default; Queue                                             |
| `update`       | Manage | Update branch from &lt;trunk&gt;                                       | `discern update`                     | No by default; Update                                            |
| `agent`        | Work   | Start or resume agent                                                  | `<configured-agent>`                 | None                                                             |
| `follow_up`    | Work   | Start a follow-up from this task                                       | `discern start --from <branch>`      | None                                                             |
| `scripts`      | Work   | Project Scripts                                                        | `discern scripts <name>`             | No by default; Run                                               |
| `jump`         | Work   | Open a shell                                                           | `<user-shell>`                       | None                                                             |
| `inspect`      | Review | Review changes                                                         | `git diff`                           | None                                                             |
| `rename`       | Manage | Change task title                                                      | `discern worktree rename <title>`    | No by default; Change                                            |
| `grant`        | Manage | Pre-authorize landing once green                                       | `discern desk`                       | No by default; Allow                                             |
| `revoke_grant` | Manage | Revoke pre-authorization                                               | `discern desk`                       | No by default; Revoke                                            |
| `reclaim`      | Manage | Reclaim checkout, keep branch (work contained in &lt;later-branch&gt;) | `discern worktree prune --contained` | No by default; Reclaim                                           |
| `park`         | Manage | Park checkout, keep branch                                             | `discern worktree park <path>`       | No by default; Park                                              |
| `drop`         | Danger | Drop                                                                   | `discern worktree drop <path>`       | No by default; Drop, then type the branch before discarding work |

<!-- END DESK ACTION REGISTRY -->

Grant and revoke are actions you perform inside `discern desk`. Every lifecycle action rechecks current state after confirmation. For a task that cannot continue, **Show recovery steps** explains the observed problem and the next action; **Retry setup** appears when its recorded setup can be replayed.

**Park** keeps a task's branch and wording while removing its clean checkout. **Reclaim** keeps an earlier stage's branch when a later branch contains its work. **Drop** discards an effort you have decided to abandon. [Worktree recovery](../40-troubleshooting/worktrees-and-resources.md) explains these choices in more detail.

## Bundled skills

Delegation is one of discern's reusable playbooks. You can also ask for help curing a recurring bug, documenting part of the project, or preserving a lesson for future sessions. [Create and manage skills](create-and-manage-skills.md) shows useful requests and how to adapt the available skills. `discern skills list` lists bundled and project-authored skills and marks exclusions.
