---
title: Reclaiming contained worktrees
description: Prune and the desk offer to reclaim spent train stages whose commits travel inside a live branch — checkouts removed, branch refs always kept.
order: 130
aliases:
  - contained worktree
  - worktree prune --contained
  - reclaim a worktree
  - spent train stage
---

# Reclaiming contained worktrees

_A staged train tidies as it goes: reclaim a spent stage's checkout, keep its branch ref._

Composition below the trunk ([ADR 0110](../_adr/0110-the-landing-model.md)) leaves finished stages behind. `start --from` forks stage two from stage one, and only the final stack lands, so every earlier checkout stays until the end. discern calls that shape **contained**: the worktree's branch tip is a strict ancestor of another live branch's tip, its tree is clean, and it is idle. Every commit it holds already travels inside the next stage ([ADR 0225](../_adr/0225-contained-worktree-reclaim-is-offer-only.md)).

## The offer

`discern worktree prune` reports contained worktrees as their own plan section, the `status` fleet survey marks the rows, and the desk offers a per-worktree reclaim action. Each report names the nearest containing branch with tip hashes and its lead — evidence a human can check. Idleness follows the logbook's paired begin/finish events when the logbook is on. A logbook-off install falls back to a one-hour git-derived quiet period. The logbook only narrows the offer, and the human confirmation decides the action.

## The reclaim

Only a fresh, explicit confirmation reclaims anything: `discern worktree prune --contained` plus the ordinary prompt, or the desk action. A reclaim destroys the checkout and its per-worktree state, gate receipt included, so `discern await --green <stage>` refuses afterwards and points at the containing branch. The reclaim tears external resources down through the same lifecycle path acceptance uses. The branch ref **always survives**: it is the recovery path (`discern start --from <branch>`), and it self-cleans through the ordinary prune once the train finally lands. Until then, `status` and the desk list the kept ref as a calm fact beside its live container. Only a ref with no live container raises the abandoned-work warning.

## Where it lives in code

| Responsibility            | Source                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| The containment predicate | [`src/engine/worktree/containment.ts`](../../../src/engine/worktree/containment.ts)           |
| Prune offer and reclaim   | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)               |
| Desk action               | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                                 |
| Behavioural coverage      | [`tests/engine_worktree_contained_test.ts`](../../../tests/engine_worktree_contained_test.ts) |

## Current state and gotchas

- Offer-only by design: no configuration, grant, or hint may reclaim without a fresh confirmation naming the worktree.
- Equal tips are ambiguous twins and never qualify. An unreadable checkout stays off the list — unknown state fails safe.
- Apply re-checks each candidate's live state first. A stage that gained work while the prompt waited drops out of the reclaim.
