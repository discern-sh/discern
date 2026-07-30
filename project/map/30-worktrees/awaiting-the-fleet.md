---
title: Awaiting the fleet
description: Block until a sibling branch is green, its work lands, or the trunk moves — one call instead of guessed polling.
order: 60
aliases:
  - discern await
  - await a sibling
  - wait for a branch
  - fleet coordination
---

# Awaiting the fleet

_Hold one call for the work you need. If the transport must return first, continue the same watch without losing what happened between calls._

`discern await` replaces guessed `discern status` polling and human relays. It blocks until a fleet condition holds, then reports the observation and next step.

## The three conditions

Pass one condition per call:

| Condition           | Holds when                                                                                                | Grounded in               |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| `--green <branch>`  | The worktree holds an honored gate receipt, or a landed receipt note proves acceptance.                   | Gate and landing receipts |
| `--landed <branch>` | The branch has work and its latest observed tip is reachable from the trunk.                              | Git ancestry              |
| `--trunk-moved`     | The trunk ref differs from its position when the watch began. Any trunk move satisfies this broad signal. | The trunk ref itself      |

Verdicts come from authoritative state. The logbook wakes the wait but never decides truth ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). A separate decision records the original condition contract ([ADR 0213](../_adr/0213-await-blocks-on-authoritative-fleet-conditions.md)).

Start a branch watch while it exists. `--landed` retains its observed tip, so an active watch survives branch deletion. After cleanup, a new call can recover accepted work from its trunk receipt note. Without one, it refuses.

Use `--green` for work in flight and `--landed` when only arrival matters. `--green` does not treat a freshly forked branch's reachable tip as proof. If that branch commits and lands between evaluations, its durable receipt note identifies the validated work after cleanup.

`--green` refuses when no checkout holds the branch at call start. Its per-worktree gate receipt dies with the checkout, so a [reclaimed](reclaiming-contained-worktrees.md) stage cannot present one. The refusal points at the nearest containing branch and `--landed`.

## Spend one call

Omit `timeout` and let discern use the longest reliable call for the configured surface:

- The CLI and known configurable Model Context Protocol (MCP) clients use 3,300 seconds — 55 minutes.
- Cursor's shared IDE-and-CLI MCP entry and an undeclared MCP client use 45 seconds. The Cursor CLI/ACP path stops at 60 seconds, so the shared entry uses that shortest verified surface.
- Configurable clients receive a one-hour MCP tool timeout, leaving five minutes of delivery and cancellation headroom around the 55-minute wait.

The condition returns immediately when it holds. A longer bound does not delay success, so do not split a supported long call into heartbeat-sized calls for progress reporting. Client cancellation still ends it promptly.

An explicit smaller MCP timeout remains exact. Discern caps a larger request at the transport-safe limit and records it in `data.requested_timeout_seconds`. The CLI has no MCP deadline, so it keeps an explicit timeout intact. `--timeout 0` checks once.

The effective bound and source are `data.timeout_seconds` and `data.timeout_basis`. A separate decision records the vendor evidence ([ADR 0232](../_adr/0232-await-continuations-spend-the-transport-budget.md)).

## Continue without a gap

A timed-out call returns a usable continuation. Its envelope carries `ok: true`, `data.met: false`, the authoritative observation, and an opaque `data.resume` token. The hint returns the next call:

```sh
discern await --resume <token> --timeout 45
```

Pass the token by itself, without another condition flag. It restores the branch's latest observed tip and landing transition, or the original trunk baseline. A change in the round-trip gap can still satisfy the watch. If the result is still not met, follow its next `--resume` command. Do not restart the condition or stop after an arbitrary retry count. Continue until the condition holds, the user stops the watch, or the task no longer needs the dependency. An `ok: false` refusal carries no continuation. Follow its recovery hint or resolve the blocker.

The CLI exits `0` when met, `1` on refusal, and `124` on "not yet":

```sh
discern await --landed agent/upload-retry
```

## Compose the dependency

The landing model's pull axis makes `await` the coordination half of multi-wave work ([ADR 0110](../_adr/0110-the-landing-model.md)). Resolve the sibling's exact branch from `discern start` or `discern status`. Human-friendly names gain a collision-resistant suffix.

If the dependent already has a worktree, wait there:

```sh
discern await --green agent/upload-retry-a1b2c3
```

If the dependent has no worktree yet, wait from the main checkout:

```sh
discern await --green agent/upload-retry-a1b2c3
```

Follow the returned met hint. A live green receipt uses its immutable commit with `update --from` in an existing worktree or `start --from` on main, so later branch deletion cannot race the composition. Green satisfied by a landing uses the trunk instead. Landing and trunk-move hints choose plain `update` in a worktree or `start` on main. A met landing also previews the incoming hot zone.

## Where it lives in code

| Responsibility                         | Source                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Conditions, continuations, and waiting | [`src/engine/await/await.ts`](../../../src/engine/await/await.ts)               |
| Provider timeout capabilities          | [`src/shared/mcp_timeout_policy.ts`](../../../src/shared/mcp_timeout_policy.ts) |
| Behavioral coverage                    | [`tests/engine_await_test.ts`](../../../tests/engine_await_test.ts)             |

## Current state and gotchas

- `await` blocks only its caller. It gates nothing, holds no locks, and writes no state.
- The logbook can be off; polling still evaluates every condition.
- Provider timeout changes take effect after `discern refresh` rewrites the MCP entry and the client restarts it.
- A failed landing-receipt-note write can make a green landing hidden entirely inside a retry gap unprovable. `await` stays not met instead of inferring from an unrelated trunk move.
