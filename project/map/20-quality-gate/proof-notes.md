---
title: Proof notes
description: Keep a landed green Proof with its trunk commit, and opt into fetch transport when another clone needs it.
order: 50
aliases:
  - refs/notes/discern
  - fetch proof notes
  - publish proof notes
  - git notes
  - proof format
  - proof note schema
---

# Proof notes

_A green landing keeps its structured Proof beside the immutable trunk commit._

After the trunk fast-forward, `discern accept` and `discern setup accept` write the durable Proof record under `refs/notes/discern` ([ADR 0215](../_adr/0215-landing-receipts-travel-as-git-notes.md), [ADR 0242](../_adr/0242-durable-receipts-use-a-versioned-dsse-envelope.md), [ADR 0313](../_adr/0313-setup-completion-and-acceptance-bind-one-final-proof.md)). It adds no trunk commit.

Read the current history with:

```sh
git log --notes=discern
```

Read one record with:

```sh
git notes --ref=discern show <commit>
```

`discern status` reports a valid local or fetched trunk-tip note as `data.landed_proof`: commit, source ref, and Proof.

## The durable format

The DSSE-compatible Base64 payload separates structured result facts from human presentation and excludes runtime telemetry. A future signature covers both; verification policy reads only the `proof` field. `signatures: []` records no signature, and discern signs or verifies nothing today ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)).

Current v1 records carry the landed commit, its complete component evidence, and the Proof presentation. A note an accepted landing writes also carries an `acceptance` block: the consent source, the owner-authorized variances, and the approved standard limits. A note written in a pre-launch shape has no reader and never becomes authority through conversion. Unknown payload types report unsupported; bare and pre-split private formats are not Proof notes. [Proof note format](../70-reference/proof-note-format.md) defines the contract and reading rules.

## Replay keeps the first presentation

The write identity is the explicit subject commit plus the stable machine-readable Proof claim. Repeating a note write with changed Proof-line wording, Markdown, or runtime timing returns `already_present` and leaves the existing note bytes unchanged. A different stable claim for the same commit remains a conflict and returns `record_failed` ([ADR 0333](../_adr/0333-proof-note-replay-uses-stable-claim-identity.md)).

## Authorship and failure

The notes commit uses `discern <done@discern.sh>` as author and committer. With `DISCERN_NO_ATTRIBUTION` set, it uses the repository's Git identity instead. The Proof still records.

A failed note write leaves the landing standing and keeps what a retry needs. `discern accept` keeps the effort's checkout, its branch, its resources, and its acceptance journal, and the result's first sentence names the retry: `discern accept` from that checkout. The retry records the note from the journal's Proof pointer and consent evidence, including after later landings moved the trunk on, then cleans up as a landing does. It never moves the trunk or spends the grant again, and a retry whose write still fails keeps everything for the next one. `discern setup accept` keeps the setup branch and the gate Proof the note is written from; running it again from that branch records the note. A landed commit with no complete Proof left to record stays landed without a note, and nothing is kept for a retry. Fetch transport still reports its own result.

## Carry notes between clones

Local recording changes no remote transport. To carry Proofs between clones:

```toml
[repository]
proof_notes_mode = "fetch"
```

Refresh or lifecycle convergence adds this mapping once per remote:

```text
+refs/notes/discern*:refs/discern/remotes/<remote>/notes*
```

The trailing `*` keeps ordinary fetch usable when the source ref is absent. Git treats a wildcard with no matches as an empty fetch, so `git fetch` succeeds before the remote's first Proof note and after that ref is deleted.

The mapping reserves the `refs/notes/discern*` prefix. Matching sibling refs receive matching suffixes under the tracking path. Proof readers ignore those siblings and consume only the exact `refs/discern/remotes/<remote>/notes` ref.

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

| Concern                    | Source                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Note, merge, and transport | [`proof_notes.ts`](../../../src/engine/gate/proof_notes.ts)                           |
| Acceptance boundary        | [`accept_proof_recording.ts`](../../../src/engine/worktree/accept_proof_recording.ts) |
| Setup acceptance boundary  | [`setup_accept.ts`](../../../src/commands/setup_accept.ts)                            |
| Retry routes for a note    | [`proof_note_recovery.ts`](../../../src/shared/proof_note_recovery.ts)                |

## Current state and gotchas

- A note covers only the ref you read. Remote publication remains explicit.
- `data.landed_proof` reports a readable note that is bound to its commit. This read path performs no signature or issuer-identity verification.
- Direct Git inspection shows a Base64 payload. Use `discern status --verbose` for the rendered Proof.
- A normal fetch keeps a stale tracking note after the remote deletes it. Run `git fetch --prune <remote>` to remove refs the remote no longer carries.
- Refresh migrates older exact mappings that carry discern's ownership marker. An unmarked exact mapping stays untouched; the refresh result gives the command that removes it.
- An older marker without complete evidence is stale. It cannot authorize a current landing.
- A note with a different stable claim on the same commit fails open. Inspect the cause in `data.proof_note.write`.
