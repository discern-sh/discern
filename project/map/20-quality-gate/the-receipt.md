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
- **The page** (`data.receipt.markdown`) — standards, declared jobs and scope gates, then the diff command. `done` prints it; `status --verbose` reprints an honored receipt. Terminals dim it beside the narration. Git owns commit and per-file lists; `Inspect:` names the command.

The receipt pins a reviewable `HEAD` even if trunk advances. The agent reports and waits unless a runtime result verifies a recorded grant. `discern accept --confirmed` attests conversation consent; a standing or effort grant needs no flag. After landing, the agent ends with the returned line.

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

discern stores the validated commit, structured receipt, and both renderings in the worktree's git administration directory. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

| Surface          | What it does with the receipt                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`   | Prints the page on a qualifying green run, returns `data.receipt` (`line` + `markdown`), then prints at most 1 branch finding.                                                                                                                 |
| `discern status` | Reports whether the marker still matches the clean current `HEAD`; returns the stored object, page, and line when honored. It also reads a landed trunk-tip receipt from the local or fetched notes ref as `data.landed_receipt`.              |
| `discern accept` | Uses an honored marker to avoid repeating the gate, then returns the page in `data.receipt` and derives `data.receipt_line` by appending the recorded consent source. After the fast-forward, it records the structured receipt as a Git note. |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. `discern standards --pin` is the narrow exception: when it creates a limits-only commit from an honored state, it carries the gate receipt forward ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md)).

## The landed receipt note

After the trunk fast-forward succeeds, `discern accept` attaches the structured `discern done` receipt to the landed commit under `refs/notes/discern` ([ADR 0212](../_adr/0212-landing-receipts-travel-as-git-notes.md)). The note body is the canonical JSON encoding of `data.receipt`, plus one final newline. Trunk history does not change.

Read the current history with:

```sh
git log --notes=discern
```

Read one receipt object with:

```sh
git notes --ref=discern show <commit>
```

The notes commit is authored and committed by `discern-bot <bot@discern.sh>`. Set `DISCERN_NO_ATTRIBUTION` to a non-empty value and the receipt still records, using the repository's configured Git identity. The receipt still exists; only its authorship changes.

The note write happens after landing and fails open. `data.receipt_note.write` says `recorded`, `already_present`, `missing_receipt`, or `record_failed`; a failure carries its cause and never rolls the trunk back. This differs from the pre-gate marker probe: losing the marker would discard a future green result, while losing the durable copy cannot un-land the commit.

### Carry notes between clones

Local recording is on by default and makes no change to remote transport. Enable fetch transport when repository data needs to support verification in another clone:

```toml
[repository]
receipt_notes = "fetch"
```

The next refresh or lifecycle convergence adds this mapping once for each remote:

```text
+refs/notes/discern:refs/discern/remotes/<remote>/notes
```

An ordinary `git fetch` can then update the separate tracking copy. discern never configures `remote.<name>.push`, never changes what plain `git push` means, and never starts a network request. After a landing with fetch transport enabled, the result gives the explicit publication command:

```sh
git push <remote> refs/notes/discern
```

Before writing a local note, acceptance merges any already-fetched `refs/discern/remotes/*/notes` histories. Separate clones can still publish between each other's last fetch and push. If Git rejects a later push as a non-fast-forward, recover with:

```sh
git fetch <remote>
git notes --ref=discern merge refs/discern/remotes/<remote>/notes
git push <remote> refs/notes/discern
```

GitHub stores the ref but does not render notes on its commit page. Git-native readers and discern consume it.

## Re-running an unchanged tree

Beside the receipt, every completed run records the exact tree it judged and the verdict in a last-run marker, including red runs. Ask `discern done` to run again on that identical tree and it refuses read-only before any job or fixer runs. An unchanged tree expects an unchanged verdict. A green rerun repays full gate time for the answer `discern status` already shows; retrying a red run until it passes hides a flake. `discern done --confirmed` re-runs it as an attested, recorded probe. Any edit, commit, or `--dry-run` runs as normal ([ADR 0185](../_adr/0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md)).

The public result fields are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                        | Source                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| Marker identity and validation | [`receipt.ts`](../../../src/engine/gate/receipt.ts)               |
| Write-authority probe          | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)    |
| Receipt facts and markdown     | [`receipt_render.ts`](../../../src/engine/gate/receipt_render.ts) |
| Landed note and fetch mapping  | [`receipt_notes.ts`](../../../src/engine/gate/receipt_notes.ts)   |
| Gate integration               | [`finish.ts`](../../../src/engine/gate/finish.ts)                 |
| Landing validation             | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)       |

## Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_receipt.status` before claiming the branch is ready.
- The marker is a cache of a real gate result. If it is missing, stale, or unreadable, acceptance validates the tree again.
- A marker written by an older discern can carry the validated commit and rendered page without the structured object. Acceptance may still honor that proof, but it reports `missing_receipt` instead of inventing note content.
- The preflight is a point-in-time proof. Receipt writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_receipt`.
- Fetched notes prove the local tracking state. Check publication separately with the explicit push in [Carry notes between clones](#carry-notes-between-clones).
- A logbook hint is advice beside the receipt. The stored markdown and its commit identity remain unchanged.
