---
title: Reclaiming contained worktrees
description: Prune and the Desk offer to reclaim spent train stages whose commits travel inside a live branch while keeping their branch refs.
order: 150
aliases:
  - contained worktree
  - worktree prune --contained
  - reclaim a worktree
  - spent train stage
---

# Reclaiming contained worktrees

_Reclaim a completed stage's checkout while keeping its branch ref for recovery._

Composition below the trunk ([ADR 0110](../_adr/0110-the-landing-model.md)) leaves finished stages behind. `start --from` forks a later stage from an earlier one, and the composed branch lands after the stages finish. Earlier checkouts therefore remain. discern calls a worktree **contained** when its branch tip is a strict ancestor of another live branch's tip, its tree is clean, and it is idle ([ADR 0225](../_adr/0225-contained-worktree-reclaim-is-offer-only.md)).

## The offer

`discern worktree prune` reports contained worktrees as their own plan section, the `status` fleet survey marks the rows, and the desk offers a reclaim action. Each report names the nearest containing branch with tip hashes and its lead. Idleness follows the logbook's paired begin/finish events when the logbook is on. An install with recording off falls back to a 1-hour inactivity period. The Logbook narrows the offer. Human confirmation decides whether reclaim runs.

## The reclaim

Reclaiming requires a fresh, explicit confirmation through `discern worktree prune --contained` and its terminal interaction, or through the desk action. A reclaim destroys the checkout and its per-worktree state, including the gate Proof, so `discern await --green <stage>` then refuses and points at the containing branch. The reclaim tears resources down through the same lifecycle path acceptance uses. The branch ref survives the reclaim as its recovery path (`discern start --from <branch>`). Ordinary prune removes that ref after the composed branch lands. Until then, `status` and the desk list the kept ref beside its container; refs with no container warn as abandoned.

## Where it lives in code

| Responsibility            | Source                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| The containment predicate | [`src/engine/worktree/containment.ts`](../../../src/engine/worktree/containment.ts)           |
| Prune offer and reclaim   | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)               |
| Desk action               | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                                 |
| Behavioral coverage       | [`tests/engine_worktree_contained_test.ts`](../../../tests/engine_worktree_contained_test.ts) |

## Current state and gotchas

- No configuration, grant, or hint can reclaim a worktree without a fresh confirmation naming it.
- Equal tips are ambiguous twins and never qualify. An unreadable checkout stays off the list because unknown state does not qualify.
- Apply re-checks each candidate's live state immediately before acting. A stage that gained work drops out.
