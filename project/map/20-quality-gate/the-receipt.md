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
- git or the marker file could not be read.

The gate can still pass when a receipt is withheld. Its result explains why no receipt was recorded and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

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
| Receipt facts and markdown     | [`receipt_render.ts`](../../../src/engine/gate/receipt_render.ts) |
| Gate integration               | [`finish.ts`](../../../src/engine/gate/finish.ts)                 |
| Landing validation             | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)       |

## Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_receipt.status` before claiming the branch is ready.
- The marker is a cache of a real gate result. If it is missing, stale, or unreadable, acceptance validates the tree again.
- The receipt code contains no unfinished-work markers for this behavior.
