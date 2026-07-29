---
title: Receipt notes
description: Keep a landed green receipt with its trunk commit, and opt into fetch transport when another clone needs it.
order: 40
aliases:
  - refs/notes/discern
  - fetch receipt notes
  - publish receipt notes
  - git notes
---

# Receipt notes

_A green landing keeps its structured receipt beside the immutable trunk commit._

After the trunk fast-forward, `discern accept` writes canonical JSON for `data.receipt` under `refs/notes/discern` ([ADR 0215](../_adr/0215-landing-receipts-travel-as-git-notes.md)). It adds no trunk commit.

Read the current history with:

```sh
git log --notes=discern
```

Read one receipt object with:

```sh
git notes --ref=discern show <commit>
```

`discern status` reports a valid local or fetched trunk-tip note as `data.landed_receipt`: commit, source ref, and receipt.

## Authorship and failure

The notes commit uses `discern-bot <bot@discern.sh>` as author and committer. With `DISCERN_NO_ATTRIBUTION` set, it uses the repository's Git identity instead. The receipt still records.

The note write and fetch-configuration reconciliation both fail open. `data.receipt_note.write` and `data.receipt_note.fetch` carry their status and any cause. A transport or recording problem cannot roll the trunk back or turn the completed landing red.

## Carry notes between clones

Local recording changes no remote transport. To carry receipts between clones:

```toml
[repository]
receipt_notes = "fetch"
```

Refresh or lifecycle convergence adds this mapping once per remote:

```text
+refs/notes/discern*:refs/discern/remotes/<remote>/notes*
```

The trailing `*` keeps ordinary fetch usable when the source ref is absent. Git treats a wildcard with no matches as an empty fetch, so `git fetch` succeeds before the remote's first receipt note and after that ref is deleted.

The mapping reserves the `refs/notes/discern*` prefix. Matching sibling refs receive matching suffixes under the tracking path. Receipt readers ignore those siblings and consume only the exact `refs/discern/remotes/<remote>/notes` ref.

An ordinary `git fetch` updates the tracking copy. discern never configures `remote.<name>.push`, changes plain `git push`, or starts a network request. A landing then gives the publication command:

```sh
git push <remote> refs/notes/discern
```

Acceptance merges fetched `refs/discern/remotes/*/notes` histories before writing. A publish race can still reject a later push. Recover with:

```sh
git fetch <remote>
git notes --ref=discern merge refs/discern/remotes/<remote>/notes
git push <remote> refs/notes/discern
```

GitHub stores the ref but does not render it. Git-native readers and discern consume it.

## Where it lives in code

| Concern                    | Source                                                          |
| -------------------------- | --------------------------------------------------------------- |
| Note, merge, and transport | [`receipt_notes.ts`](../../../src/engine/gate/receipt_notes.ts) |
| Acceptance boundary        | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)     |

## Current state and gotchas

- A note proves only the ref you read. Remote publication remains explicit.
- A normal fetch keeps a stale tracking note after the remote deletes it. Run `git fetch --prune <remote>` to remove refs the remote no longer carries.
- Refresh migrates older exact mappings that carry discern's ownership marker. An unmarked exact mapping stays untouched; the refresh result gives the command that removes it.
- An older marker may lack structured data. Acceptance honors its commit proof but reports `missing_receipt`.
- A conflicting note on the same commit fails open. Inspect the cause in `data.receipt_note.write`.
