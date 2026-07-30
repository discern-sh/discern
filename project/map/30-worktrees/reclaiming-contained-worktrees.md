---
title: Reclaiming contained worktrees
description: Prune and the desk offer to reclaim spent train stages whose commits travel inside a live branch — checkouts removed, branch refs always kept.
order: 65
aliases:
  - contained worktree
  - worktree prune --contained
  - reclaim a worktree
  - spent train stage
---

# Reclaiming contained worktrees

_A staged train tidies as it goes: reclaim a spent stage's checkout, keep its branch ref._

Composition below the trunk ([ADR 0110](../_adr/0110-the-landing-model.md)) leaves finished stages behind: `start --from` forks stage two from stage one, and only the final stack lands, so every earlier checkout stays until the end. discern calls that shape **contained**: the worktree's branch tip is a strict ancestor of another live branch's tip, its tree is clean, and it is idle — every commit it holds already travels inside the next stage ([ADR 0225](../_adr/0225-contained-worktree-reclaim-is-offer-only.md)).

## The offer

`discern worktree prune` reports contained worktrees as their own plan section, the `status` fleet survey marks the rows, and the desk offers a per-worktree reclaim action. Each report names the nearest containing branch with tip hashes and its lead — evidence to confirm against, not a bare name. Idleness follows the logbook's paired begin/finish events when the logbook is on; a logbook-off install falls back to a one-hour git-derived quiet period. The logbook only narrows the offer; the human confirmation decides the action.

## The reclaim

Nothing is reclaimed without a fresh, explicit confirmation: `discern worktree prune --contained` plus the ordinary prompt, or the desk action. A reclaim destroys the checkout and its per-worktree state — the gate receipt included, so `discern await --green <stage>` refuses afterwards and points at the containing branch. External resources are torn down through the same lifecycle path acceptance uses, and the branch ref is **always kept**: it is the recovery path (`discern start --from <branch>`), and it self-cleans through the ordinary prune once the train finally lands.

## Where it lives in code

| Responsibility            | Source                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| The containment predicate | [`src/engine/worktree/containment.ts`](../../../src/engine/worktree/containment.ts)           |
| Prune offer and reclaim   | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)               |
| Desk action               | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                                 |
| Behavioural coverage      | [`tests/engine_worktree_contained_test.ts`](../../../tests/engine_worktree_contained_test.ts) |

## Current state and gotchas

- Offer-only by design: no configuration, grant, or hint may reclaim without a fresh confirmation naming the worktree.
- Equal tips are ambiguous twins, never containment; an unreadable checkout is never offered — unknown state fails safe.
- Apply re-validates each candidate against live state, so a stage that gained work while the prompt waited is skipped, never force-reclaimed.
