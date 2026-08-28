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

When an agent's task depends on work another agent is still finishing, `discern_await` holds the session until that change is ready, then names the next step for the agent to take.

As a project grows, agents can often find themselves with a task which depends on work that's still in progress. Maybe another worktree is still running its Gate, or a branch hasn't landed on the trunk yet. Without a way to wait, an agent is forced to either poll `discern_status` on a guessed interval indefinitely, or the project owner has to keep track of which agents need to an update between sessions.

`discern_await` solves both. It holds one long blocking call open until the dependency resolves, then names the next step — so the agent can hit the ground running when they're able to get back to work.

Most agent harnesses allow the agent to remain responsive during blocking calls, so a human can still update the agent early if needed. A few situations look like waits but call for something else — [When waiting is the wrong tool](#when-waiting-is-the-wrong-tool) lists them.

## Before starting

- Resolve the exact branch name to watch. `discern_status` lists every active worktree, if it's not already known.
- Run the wait from the agent's own worktree when they have one already, or from the main checkout otherwise.
- If the dependency may already have resolved, call `discern_await` anyway. When a condition is already true, discern returns it met immediately. This allows the call to also provide the check, saving the need for additional tool calls.

## Choose the condition

Pass one condition per call, chosen from what the agent's task needs:

| The agent's task needs                         | Condition           | It holds when                                                                                                                                  |
|------------------------------------------------| ------------------- |------------------------------------------------------------------------------------------------------------------------------------------------|
| To build on the target's work before it lands  | `--green <branch>`  | The target's worktree holds current [Proof](../20-understand/proof.md) for a clean commit. Landing the worktree also satisfies this condition. |
| To receive the target's work through the trunk | `--landed <branch>` | The target worktree's changes are accepted and land on the [trunk](../20-understand/worktrees-and-trunk.md).                                   |
| To react to any trunk movement                 | `--trunk-moved`     | The trunk differs from where it stood when the watch began. Satisfied by any commit on the trunk, whether landed through acceptance or not.    |

Green and landed answer different questions:

- `--green` says the target's exact commit passed its Gate. There may still be an agent actively modifying files in the worktree. 
- `--landed` says its work has reached the trunk, following acceptance by the project owner.

A landing observed mid-watch satisfies `--green` too, so a dependency that finishes and lands while the agent watches isn't missed.

`--landed` watches for arrival. It follows the branch's tip, so start the watch while the dependency is in flight. The watch survives branch deletion (acceptance removes a landed branch), and a fresh call can still recover a finished landing from its durable proof note.

`--trunk-moved` is satisfied by _anyone_'s landing, or even a project owner committing directly to the trunk themselves. Use it when the agent needs to pick up whatever arrives next, rather than one named dependency.

## Start the wait

Suppose the agent's task needs the retry helper that `agent/upload-retry-b41f2c` is adding, and the agent needs to build on it before it lands:

1. Call `discern_await` via the MCP tool, passing the worktree's absolute `path` and one of `green`, `landed`, or `trunk_moved`. Alternatively, run `discern await --green agent/upload-retry-b41f2c` from the CLI inside the worktree.
2. Sit back and relax. discern will let you know when something changes.

### Waiting effectively

* Scripts can chain on the exit status, which is `0` only when the condition is met, so `discern await --landed agent/upload-retry-b41f2c && discern update` proceeds only on arrival.
* Omit `--timeout`. discern holds the call for the longest window the coding agent's vendor transport reliably supports, and returns as soon as the condition holds. An explicit `--timeout 0` checks once and returns straight away.
* Canceling a held call ends it immediately, and starting the same condition again later is safe.

## Continue an unresolved call

* A call can reach the end of its window before the condition holds. When this happens, it responds with `ok: true` and `data.met: false`.
* This isn't a refusal — the dependency simply isn't ready yet.
* The result carries a continuation handle in `data.resume` and the exact command that continues the same watch. Through MCP, call `discern_await` again with the same `path` and the `resume` token provided. To resume on the CLI, pass the handle alone without condition flags: `discern await --resume C1-7K3M-PQ9D-YM`, for example.
* Passing the resume handle allows discern to report if something happened between calls, ensuring the condition is still satisfied and no information gets lost between the gap.
* Keep continuing with the newest handle until the condition holds or the dependency stops mattering.

## Handle a refusal

When the response contains `ok: false`, this means the watch as posed can't be answered, and it won't offer a continuation to resume. Follow the recovery named in the result instead of retrying. The common cases:

- **A `--green` watch on a branch whose worktree is gone.** Proof lives in the branch's worktree and is removed with it, after a [reclaim](../40-troubleshooting/worktrees-and-resources.md) for example, so the condition can't become true anymore. The refusal points at the branch that now holds the work, or at `--landed` for the plain arrival question.
- **A branch that doesn't resolve at all.** Either it was never started, or it landed and was cleaned up before the watch began. The refusal says which reading is likely. For a finished dependency, `--landed` can recover the landing from its proof note.

## Compose what arrived

A met result names the agent's next step. The named step should be followed directly:

- **Green, and the branch is still live:** build on the exact commit the hint names, with `discern update --from <commit>` in the agent's worktree or `discern start --from <commit>` to create one. Compose from the commit rather than the branch name, as the branch is deleted after acceptance lands its changes.
- **Landed, or the trunk moved:** bring the trunk in to the worktree with `discern_update`, or start a new worktree from it with `discern_start`.

The met result also names incoming files that overlap with files the agent changed. The agent is instructed to re-read them after updating, as a merge that applies cleanly can still conflict in meaning.

The wait is complete when the dependency is present in the agent's tree, meaning the files or behavior the task builds on exist where expected. Verify that, then continue the task.

## When waiting is the wrong tool

- **The agent's own branch.** The agent should run the Gate or do the work. Awaiting themselves will never return.
- **A helper or sub-task inside the same session.** `discern_await` watches other worktrees and the trunk. The session already tracks its own work.
- **A decision only a person can make,** such as a review or an approval. Report the needed decision and stop. A held call can't hurry a human.
- **A dependency cut mid-wait.** The plan changed, so say so and move on. Ending the watch there is valid.

Coding agents receive this procedure as the bundled `discern-await-the-fleet` [Skill](delegate-work.md#bundled-skills), so a task brief can name the Skill instead of restating these instructions. The [CLI reference](../30-reference/cli-reference.md#discern-await) lists every flag. [MCP and results](../30-reference/mcp-and-results.md) holds the result fields, the transport timeout bounds, and the exit-code contract. [Proof](../20-understand/proof.md) explains why green and landed stay separate states.
