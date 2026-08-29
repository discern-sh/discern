---
id: guide-wait-for-another-task
title: "Wait for another task"
description: "Hold until another agent's worktree is green, its work lands, or the trunk moves — then build on what arrived without polling or relaying status by hand."
order: 70
publish: true
kind: guide
aliases:
  - "guide-wait-for-another-task"
  - "Awaiting the fleet"
  - "await a sibling"
  - "wait for a branch"
  - "fleet coordination"
redirect_from:
  - "/docs/worktrees/awaiting-the-fleet"
---

# Wait for another task

When one task depends on work another coding agent is still finishing, you shouldn't have to watch both sessions and carry the news between them. That coordination absorbs the time parallel work was meant to save.

`discern_await` gives the waiting agent a repository condition to wait for: a sibling becomes green, its work lands, or the trunk moves. The call returns when that condition holds and names the next step. If the reliable call window ends first, it provides a continuation for the same watch rather than leaving the agent to invent a polling loop.

This means you can start a dependent task without arranging the precise moment when your agent should return. And although the wait is one long blocking call, it doesn't make your agent unresponsive: agent harnesses generally deliver your messages mid-watch, so you can still redirect them early when plans change. Waiting is appropriate when repository state controls the next action; [some dependencies still need a person](#when-waiting-is-the-wrong-tool).

## Before starting

- Resolve an exact stable selector for the task: its worktree id, absolute path, local branch, or full local ref. `discern_status` from the main checkout lists the fleet; from a worktree, request the fleet view or run `discern status --all`. Do not use a display title or guessed prefix.
- Run the wait from the waiting agent's own worktree when they already have one, or from the main checkout when the dependent task hasn't started.
- Call `discern_await` even when the dependency may already be ready. An already-met condition returns immediately, so a separate pre-check only adds work.

## Choose the condition

Pass one condition per call, chosen from what the agent's task needs:

| The agent's task needs                         | Condition             | It holds when                                                                                                                                     |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| To build on the target's work before it lands  | `--green <worktree>`  | The target's worktree holds current [Proof](../20-understand/proof.md) for a clean commit. Landing that work also satisfies the condition.        |
| To receive the target's work through the trunk | `--landed <worktree>` | The target's changes have reached the [trunk](../20-understand/worktrees-and-trunk.md) through acceptance.                                        |
| To react to any trunk movement                 | `--trunk-moved`       | The trunk differs from where it stood when the watch began. Any commit on the trunk can satisfy it, whether it arrived through acceptance or not. |

Green and landed answer different questions:

- `--green` says the target's exact commit passed its Gate. Its agent may still be working in that worktree, so the successful result identifies the commit to build on.
- `--landed` says the target's work has reached the trunk through the separate acceptance step.

A landing observed mid-watch satisfies `--green` too, so a dependency that finishes and lands while the agent watches isn't missed.

`--landed` watches for arrival. It follows the branch's tip, so start the watch while the dependency is in flight. The watch survives branch deletion (acceptance removes a landed branch), and a fresh call can still recover a finished landing from its durable proof note.

`--trunk-moved` is satisfied by any landing or by a direct commit to the trunk. Use it when the agent needs to respond to whatever arrives next rather than to one named dependency.

## Start the wait

Suppose a task in an external project needs the retry helper being added on `agent/upload-retry-b41f2c`, and its agent can build on that helper before it lands. The agent starts one wait through the primary agent surface, `discern_await`, passing the dependent worktree's absolute `path` and the condition:

```
discern_await
  path:  /absolute/path/to/the/worktree
  green: agent/upload-retry-b41f2c
```

The same wait through the command line, from inside the dependent worktree, is:

```sh
discern await --green agent/upload-retry-b41f2c
```

Omit the timeout on either surface: discern chooses the longest reliable window for the caller. The call returns early as soon as the condition holds, and canceling it is safe if the dependency stops mattering.

## Continue an unresolved call

A call can reach the end of its reliable window before the condition holds. It then returns `ok: true` with `data.met: false`. This is an unfinished wait, not a refusal and not a reason to choose an arbitrary delay.

Follow the continuation in the result. Through MCP, the agent calls `discern_await` again with the same `path` and the supplied `resume` value, without repeating a condition. The command-line result likewise provides the exact command to run: `discern await --resume C1-7K3M-PQ9D-YM`, for example. That continuation preserves the original branch transition or trunk baseline, including a change that happened between calls.

Continue with the newest handle until `data.met` is `true` or the dependency no longer matters.

## Handle a refusal

An `ok: false` result means the watch as posed can't be answered. It has no continuation, so follow its recovery instead of resuming it. Common cases include:

- **A green watch whose worktree is gone.** Current Proof lives with the worktree, so a [reclaimed](../40-troubleshooting/worktrees-and-resources.md) branch can't later become green there. The refusal points to a branch that now contains the work, when one exists, or suggests a landed watch for the arrival question.
- **A worktree selector that doesn't resolve.** The task may never have started, the selector may be a display title rather than stable identity, or it may have landed and been cleaned up before this watch began. The refusal explains the observed state; an exact branch can recover a completed landing from its proof note.

## Compose what arrived

A successful result names the agent's next step. Follow that hint directly:

- **Green, while the branch is still live:** build on the exact commit in the hint with `discern update --from <commit>` in an existing worktree, or `discern start --from <commit>` for a new one. The commit is stable even if acceptance later deletes the branch name.
- **Landed, or the trunk moved:** bring the trunk into an existing worktree with `discern_update`, or use `discern_start` when the dependent task still needs a worktree.

The result also names incoming files that overlap with the agent's changes. Re-read those files after updating, because a merge can apply cleanly while combining incompatible assumptions.

The wait is complete when the dependency is present in the agent's tree, meaning the files or behavior the task builds on exist where expected. Verify that, then continue the task.

## When waiting is the wrong tool

- **The agent's own branch.** The agent should run the Gate or do the work. Awaiting themselves will never return.
- **A helper or sub-task inside the same session.** `discern_await` watches other worktrees and the trunk. The session already tracks its own work.
- **A decision only a person can make,** such as review or approval. Report the needed decision and stop. A held call can't hurry a human.
- **A dependency cut mid-wait.** The plan changed, so say so and move on. Ending the watch there is valid.

Coding agents receive this procedure as the bundled `discern-await-the-fleet` [Skill](delegate-work.md#bundled-skills), so a task brief can name the Skill instead of restating these instructions. The [CLI reference](../30-reference/cli-reference.md#discern-await) lists every flag. [MCP and results](../30-reference/mcp-and-results.md) holds the result fields, the transport timeout bounds, and the exit-code contract. [Proof](../20-understand/proof.md) explains why green and landed stay separate states.
