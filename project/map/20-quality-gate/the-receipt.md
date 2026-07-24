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

`discern done` emits a receipt when the run passes on a clean, committed branch that is ahead of trunk. The receipt is discern's review summary. It lists the branch and trunk, each declared job and scope gate that ran, standard outcomes, commits, changed files, and the command that opens the full diff ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

The receipt gives the reviewer a stable gate result for that `HEAD`. The trunk may advance. The agent relays it and waits. On approval, `discern accept --confirmed` checks the live refs and lands the branch.

After a qualifying receipt, `done` can print one `Logbook:` advisory line. It counts the branch findings that cleared the unsolicited-presentation bar, states the strongest observation, and points to `discern patterns` for the evidence and next steps. The detector needs 1 qualifying event beyond its normal threshold before this line appears. A red run, an unfinished setup, a disabled logbook, or a branch with no qualifying finding gets no line ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

The line travels in the result envelope's `hints[]`. It does not enter the stored receipt markdown, change `ok`, or affect whether `accept` honors the receipt.

## When a receipt is recorded

The gate pins `HEAD` and worktree cleanliness before jobs, then checks both before recording. It also rechecks the trunk. Movement warns you to update and rerun. A receipt is withheld when:

- the worktree had staged, uncommitted, or untracked changes;
- `HEAD` moved while the gate was running;
- the current branch is trunk, detached, or has no commits ahead of trunk;
- the git facts needed for the review summary could not be read.

The gate can still pass when a review receipt is withheld for one of those identity or summary reasons. Its result explains why no receipt was emitted and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

Write authority is different. Before any declared job or standard measurement starts, Discern performs a tiny real create/write/rename/remove probe beside its Git-admin marker files. If a sandbox or filesystem permission blocks that later write, `done` fails immediately with `failed_stage = "write_access"` and a diagnostic naming the path. That early refusal prevents a complete green gate from being discarded merely because its receipt could not be saved ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

## How later commands use it

discern stores the validated commit and receipt markdown in the worktree's git administration directory. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

| Surface          | What it does with the receipt                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `discern done`   | Prints the markdown on a qualifying green run, returns it in `data.receipt`, then prints at most 1 branch finding.  |
| `discern status` | Reports whether the marker still matches the clean current `HEAD` and returns the stored markdown when honored.     |
| `discern accept` | Uses an honored marker to avoid repeating the gate, then returns the landing receipt. Otherwise it reruns the gate. |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. `discern standards --pin` is the narrow exception: when it creates a limits-only commit from an honored state, it carries the gate receipt forward ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md)).

## Re-running an unchanged tree

Beside the receipt, every completed run — red included — records the exact tree it judged and the verdict in a last-run marker. Ask `discern done` to run again on that identical tree and it refuses read-only before any job or fixer runs: an unchanged tree expects an unchanged verdict, so a green rerun repays full gate time for the answer `discern status` already shows, and a red one retried until it passes hides a flake. `discern done --confirmed` re-runs it as a deliberate, recorded probe; any edit, commit, or `--dry-run` runs as normal ([ADR 0185](../_adr/0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md)).

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
- The preflight is a point-in-time proof. Receipt writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_receipt`.
- A logbook hint is advice beside the receipt. The stored markdown and its commit identity remain unchanged.
