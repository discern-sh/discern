---
id: guide-wait-for-another-task
title: "Wait for another task"
description: "Wait for a sibling's green Proof, its landing, or any trunk move, then compose the result without polling or human relay."
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

Wait for a sibling's green Proof, its landing, or any trunk move, then compose the result without polling or human relay.

Use `discern await` when your next step depends on a repository state that another task will create. It holds one call until that state appears and returns the next composition step. You do not need to poll `discern status` or ask a person to carry status between agents.

`await` blocks only its caller. It holds no Gate or landing lock. Do not use it for your own branch, a sub-agent inside the same session, or a review, credential, or decision that only a person can supply.

## 1. Choose the outcome you need

Pass one condition per call.

| Your dependency                                               | Condition           | Observable completion                                                                         |
| ------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| You need to build on a sibling's proven tree before it lands. | `--green <branch>`  | The sibling has current Proof for its clean commit. A later landing also satisfies the watch. |
| You need the sibling's work to arrive through trunk.          | `--landed <branch>` | The branch's observed work is reachable from trunk.                                           |
| Any change to trunk is enough to unblock your next check.     | `--trunk-moved`     | The trunk ref differs from where it stood when the watch began.                               |

Green and landed answer different questions. Green says the sibling's declared Gate passed for a proven tree. Landed says its work has reached trunk. A newly created branch already points at trunk, so `--landed` waits until the branch has work and that work later becomes reachable.

Use the literal branch returned by `discern start` or shown by `discern status`, including its uniqueness suffix. Do not guess a friendly prefix.

## 2. Start one wait

Suppose a report task in an external project needs the contract from `agent/export-contract-a1b2c3`, and can compose it before landing. From the dependent worktree, the terminal call is:

```sh
discern await --green agent/export-contract-a1b2c3
```

A coding agent uses the same condition through `discern_await`: pass the current checkout's absolute `path` and `green: "agent/export-contract-a1b2c3"`. For `landed`, pass the exact branch as `landed`; for any trunk move, pass `trunk_moved: true`.

Omit the timeout. discern uses the longest reliable call for the surface and returns as soon as the condition holds.

## 3. Continue the same watch when it says “not yet”

A bounded call may return before the dependency arrives. Read the result as a normal unfinished wait:

- `ok: true` means the call succeeded;
- `data.met: false` means the condition is not true yet;
- `data.resume` identifies the same watch across the next call.

For an agent tool call, call `discern_await` again with the same `path` and `resume: <data.resume>`. Omit `green`, `landed`, and `trunk_moved`. At a terminal, run the continuation command in the returned hint.

Keep using the newest continuation without a fixed retry count. Stay quiet between calls. Stop only when the condition is met, the user stops the watch, or the dependency is no longer needed.

### Handle a refusal separately

A refusal has `ok: false`. It means the watch as posed cannot be answered. A valid watch whose bounded call ended first returns `ok: true` with `data.met: false`. A refusal has no continuation to resume.

Follow the refusal's recovery hint. For example, a green watch whose checkout has been reclaimed may point to a containing branch or to a landed watch. Do not restart the same condition blindly, and do not infer success from an unrelated trunk change.

## 4. Follow the successful composition hint

When `data.met` is `true`, the result names the state it observed and the next action.

- **Live green Proof:** the hint uses the immutable observed commit. In an existing worktree it calls `discern update --from <commit>`; from the main checkout it calls `discern start --from <commit>`.
- **Landed work or moved trunk:** the hint uses ordinary `discern update` in an existing worktree or `discern start` from the main checkout.
- **Overlapping files:** an update hint names files both sides changed. Re-read those paths after the update, even when the merge is clean.

Run the hint's composition step. Then verify that the file, interface, or behavior your task depends on is present in your tree. The guide is complete when the wait reports `data.met: true`, the composition command succeeds, and the expected dependency is present.

The [CLI reference](../30-reference/cli-reference.md#discern-await) lists every flag. [MCP and results](../30-reference/mcp-and-results.md) holds the continuation fields, transport bounds, and exit-code contract. [Proof](../20-understand/proof.md) explains why green and landed remain separate states.
