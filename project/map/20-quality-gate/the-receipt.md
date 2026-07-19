---
title: The receipt
description: Read the review summary a clean green gate records for the exact commit that passed.
order: 30
aliases:
  - gate receipt
  - review receipt
  - proof of done
---

# The receipt

_A clean green gate records what ran and identifies the exact branch state ready for review._

`discern done` emits a receipt when the run passes on a clean, committed branch that is ahead of trunk. The receipt is discern's review summary. It lists the branch and trunk, each capability, check, and scope gate that ran, standard outcomes, commits, changed files, and the command that opens the full diff ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

The receipt gives the reviewer a stable account of the gate run. The agent relays it and waits for approval. When the owner accepts, `discern accept --confirmed` lands the reviewed branch.

## When a receipt is recorded

The gate pins `HEAD` and the worktree's cleanliness before any job starts. It checks both again before recording the receipt. A receipt is withheld when:

- the worktree had staged, uncommitted, or untracked changes;
- `HEAD` moved while the gate was running;
- the current branch is trunk, detached, or has no commits ahead of trunk;
- the git facts needed for the review summary could not be read.

The gate can still pass when a review receipt is withheld for one of those identity or summary reasons. Its result explains why no receipt was emitted and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

Trunk currency remains live state outside the receipt. Linked worktrees share branch refs, so another worktree can advance the trunk while a gate runs. `discern done` rechecks at stamp time. If the branch fell behind during a green run, it records the receipt for the pinned `HEAD` and warns you to run `discern update`, then `discern done` again before `discern accept`. Acceptance checks the refs again at the landing boundary.

Write authority is different. Before any capability, check, test, or standard measurement starts, Discern performs a tiny real create/write/rename/remove probe beside its Git-admin marker files. If a sandbox or filesystem permission blocks that later write, `done` fails immediately with `failed_stage = "write_access"` and a diagnostic naming the path. That early refusal prevents a complete green gate from being discarded merely because its receipt could not be saved ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

## How later commands use it

discern stores the validated commit and receipt markdown in the worktree's git administration directory. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

| Surface          | What it does with the receipt                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `discern done`   | Prints the markdown on a qualifying green run and returns it in `data.receipt`.                                     |
| `discern status` | Reports whether the marker still matches the clean current `HEAD` and returns the stored markdown when honored.     |
| `discern accept` | Uses an honored marker to avoid repeating the gate, then returns the landing receipt. Otherwise it reruns the gate. |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. `discern standards --pin` is the narrow exception: when it creates a limits-only commit from an honored state, it carries the gate receipt forward ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md)).

The public result fields are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                        | Source                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| Marker identity and validation | [`receipt.ts`](../../../src/engine/gate/receipt.ts)               |
| Write-authority probe          | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)    |
| Receipt facts and markdown     | [`receipt_render.ts`](../../../src/engine/gate/receipt_render.ts) |
| Gate integration               | [`finish.ts`](../../../src/engine/gate/finish.ts)                 |
| Landing validation             | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)       |

## Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_receipt.status` before claiming the branch is ready.
- The marker is a cache of a real gate result. If it is missing, stale, or unreadable, acceptance validates the tree again.
- A receipt vouches for the pinned `HEAD`. It does not promise that the trunk will stay at the commit the gate checked.
- The preflight is a point-in-time proof. Receipt writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_receipt`.
- The receipt code contains no unfinished-work markers for this behavior.
