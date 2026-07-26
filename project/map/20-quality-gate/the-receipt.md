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

`discern done` emits a receipt when the run passes on a clean, committed branch that is ahead of trunk. It renders in two forms from one derivation ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md), [ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)):

- **The line** (`data.receipt.line`) — one sentence naming the branch, the validated commit, the diffstat vs trunk, the standards state, and the command that prints the page. This is the only receipt content an agent puts in a message: its report ends with the line, and the body of the report stays the agent's own account of the change.
- **The page** (`data.receipt.markdown`) — the full summary: standard outcomes first, then each declared job and scope gate that ran, then the command that opens the diff. You pull it from discern directly — `discern done` prints it at the terminal, and `discern status --verbose` reprints it any time the receipt is honored. Terminals dim the page, so the quoted Markdown reads as secondary beside the narration. Commit and per-file lists are git's to show; `Inspect:` names the command.

The receipt gives the reviewer a stable gate result for that `HEAD`. The trunk may advance. The agent reports, ends with the line, and waits. The commit in the line matches the recorded marker, so the claim is checkable with `discern status` rather than taken on trust. On approval, `discern accept --confirmed` checks the live refs and lands the branch.

After a qualifying receipt, `done` can print one `Logbook:` advisory line. It counts the branch findings that cleared the unsolicited-presentation bar, states the strongest observation, and points to `discern patterns` for the evidence and next steps. The detector needs 1 qualifying event beyond its normal threshold before this line appears. A red run, an unfinished setup, a disabled logbook, or a branch with no qualifying finding gets no line ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

That advisory travels in the result envelope's `hints[]`. It does not enter the stored receipt, change `ok`, or affect whether `accept` honors the receipt.

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

| Surface          | What it does with the receipt                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`   | Prints the page on a qualifying green run, returns `data.receipt` (`line` + `markdown`), then prints at most 1 branch finding.                                                                          |
| `discern status` | Reports whether the marker still matches the clean current `HEAD`; returns the stored page and line when honored (`data.gate_receipt`, and per ready fleet row), and prints the page under `--verbose`. |
| `discern accept` | Uses an honored marker to avoid repeating the gate, then returns the landing receipt. Otherwise it reruns the gate.                                                                                     |

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
- The preflight is a point-in-time proof. Receipt writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_receipt`.
- A logbook hint is advice beside the receipt. The stored markdown and its commit identity remain unchanged.
