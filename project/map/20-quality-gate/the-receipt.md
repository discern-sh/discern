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

`discern done` emits a structured receipt when the run passes on a clean, committed branch that is ahead of trunk. It renders in two forms from that one object ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md), [ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)):

- **The line** (`data.receipt.line`) — one sentence naming the branch, validated commit, diffstat, standards state, and page command. Agents quote it verbatim after their account. `status` stores it as `data.gate_receipt.receipt_line`; `accept` derives its line from it and appends the recorded consent source.
- **The page** (`data.receipt.markdown`) — standards, declared jobs and scope gates, then the diff command. `status --verbose` prints an honored receipt. Git owns commit and per-file lists; `Inspect:` names the command.

`done` and `prepare` share the TTY job table: planned rows move from `pending` through `running` to outcomes and durations. `done` highlights its receipt. `prepare` states build and test did not run and produces no review evidence. `[gate].stream = true` streams output. `--plain` is static. Pipes get the `done` receipt page. `--no-color` removes styling.

The receipt pins a reviewable `HEAD` even if trunk advances. The agent reports and waits unless a runtime result verifies a recorded grant. `discern accept --confirmed` attests conversation consent; a standing or effort grant needs no flag. After landing, the agent ends with the returned line.

A qualifying receipt may carry one `Logbook:` advisory from `hints[]`. `discern patterns` holds its evidence and next step. The advisory changes neither the stored receipt, `ok`, nor acceptance ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## When a receipt is recorded

The gate pins `HEAD` and worktree cleanliness before jobs, then checks both before recording. It also rechecks the trunk. Movement warns you to update and rerun. A receipt is withheld when:

- the worktree had staged, uncommitted, or untracked changes;
- `HEAD` moved while the gate was running;
- the current branch is trunk, detached, or has no commits ahead of trunk;
- the git facts needed for the review summary could not be read.

The gate can still pass when a review receipt is withheld for one of those identity or summary reasons. Its result explains why no receipt was emitted and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

Write authority is different. Before any declared job or standard measurement starts, Discern performs a tiny real create/write/rename/remove probe beside its Git-admin marker files. If a sandbox or filesystem permission blocks that later write, `done` fails immediately with `failed_stage = "write_access"` and a diagnostic naming the path. That early refusal prevents a complete green gate from being discarded merely because its receipt could not be saved ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

## How later commands use it

discern stores the validated commit, structured receipt, and both renderings in the worktree's git administration directory. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

| Surface          | What it does with the receipt                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`   | Prints the job table and line at a TTY, or the page when piped; returns `data.receipt` (`line` + `markdown`) and may print at most 1 branch finding beside it.                                                                                 |
| `discern status` | Reports whether the marker still matches the clean current `HEAD`; returns the stored object, page, and line when honored. It also reads a landed trunk-tip receipt from the local or fetched notes ref as `data.landed_receipt`.              |
| `discern accept` | Uses an honored marker to avoid repeating the gate, then returns the page in `data.receipt` and derives `data.receipt_line` by appending the recorded consent source. After the fast-forward, it records the structured receipt as a Git note. |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. `discern standards --pin` is the narrow exception: when it creates a limits-only commit from an honored state, it carries the gate receipt forward ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md)).

## After landing

Acceptance copies the structured receipt to `refs/notes/discern` after the trunk fast-forward. Its Dead Simple Signing Envelope (DSSE) boundary preserves the payload bytes and full commit id. `signatures: []` is discern's unsigned extension. The local record is default-on and fail-open, while fetch transport is opt-in. [Receipt notes](receipt-notes.md) covers the format, inspection, publication, and cross-clone recovery.

## Re-running an unchanged tree

Beside the receipt, every completed run records the exact tree it judged and the verdict in a last-run marker, including red runs. Ask `discern done` to run again on that identical tree and it refuses read-only before any job or fixer runs. An unchanged tree expects an unchanged verdict. A green rerun repays full gate time for the answer `discern status` already shows; retrying a red run until it passes hides a flake. `discern done --confirmed` re-runs it as an attested, recorded probe. Any edit, commit, or `--dry-run` runs as normal ([ADR 0185](../_adr/0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md)).

The public result fields are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                        | Source                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| Marker identity and validation | [`receipt.ts`](../../../src/engine/gate/receipt.ts)               |
| Write-authority probe          | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)    |
| Receipt facts and markdown     | [`receipt_render.ts`](../../../src/engine/gate/receipt_render.ts) |
| Shared gate-job TTY projection | [`gate_tty.ts`](../../../src/engine/gate/gate_tty.ts)             |
| `done` receipt panel           | [`done_tty.ts`](../../../src/engine/gate/done_tty.ts)             |
| `done` integration             | [`finish.ts`](../../../src/engine/gate/finish.ts)                 |
| `prepare` integration          | [`prepare.ts`](../../../src/engine/gate/prepare.ts)               |
| Landing validation             | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)       |

## Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_receipt.status` before claiming the branch is ready.
- The marker is a cache of a real gate result. If it is missing, stale, or unreadable, acceptance validates the tree again.
- The preflight is a point-in-time proof. Receipt writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_receipt`.
- A logbook hint is advice beside the receipt. The stored markdown and its commit identity remain unchanged.
