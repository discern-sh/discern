# ADR 0215: Landing receipts travel as bot-authored Git notes with fetch-only opt-in transport

**Status**: accepted

## Context

A green `discern done` records its receipt in the accepting worktree's Git-admin directory. `discern accept` uses that record to prove the commit it fast-forwards onto the trunk, then removes the worktree and its receipt marker. Git and the receipt are authoritative evidence; the local logbook remains an advisory history and cannot replace either ([ADR 0160](0160-local-logbook-advisory-readers.md)).

The landed commit is immutable, but a commit in trunk history cannot carry a later ledger commit without changing acceptance's clean fast-forward model. Git notes attach content to an existing object through a separate ref. They preserve trunk history, remain inspectable with ordinary Git commands, and add one small notes commit per landing.

Git does not fetch or push custom notes refs by default. Wiring fetch is additive. Wiring `remote.<name>.push` is not: the first configured push mapping replaces Git's default choice of what a plain `git push` sends. A notes convenience cannot change the meaning of that everyday command.

Notes also have a multi-clone limit. Each clone advances one notes ref. If 2 clones add different receipts from the same remote tip, the second notes push is rejected as a non-fast-forward until the histories are merged. The design needs to reduce that race without making a network request or claiming cross-clone conflict freedom.

GitHub stores custom refs and exposes them through Git, but its commit page does not render Git notes. Branch and tag CI triggers also ignore a notes-only push. Raw push webhooks and integrations that listen to every ref may still observe it.

## Decision

The default worktree branch prefix remains `agent/`. Those branches carry agent-authored work, so changing the default to `discern/` would attribute their diffs to the tool. The prefix remains configurable under `[repository].branch_prefix`.

Refs with a `discern` name are reserved for machinery discern writes. `refs/notes/discern` is the persistent receipt channel. Existing acceptance-transaction refs under `refs/worktree/discern/` remain transient recovery evidence. Fetch tracking for this channel lives under `refs/discern/remotes/<remote>/notes`; those refs mirror remote state and never carry user branches.

After the trunk fast-forward succeeds, acceptance writes the landed gate receipt to the landed commit under `refs/notes/discern`. The note body is the canonical JSON encoding of `data.receipt`, followed by one newline. It is not a Markdown-only rendering. A second landing adds another note without replacing earlier notes.

The notes commit uses `discern-bot <bot@discern.sh>` as author and committer. `DISCERN_NO_ATTRIBUTION` keeps its existing process-wide meaning: when set to a non-empty value, acceptance still writes the receipt note, using Git's configured identity instead. Receipts are records, so suppressing bot attribution does not suppress the record. If Git has no usable identity in that mode, the note write reports the failure.

Receipt-note recording is default-on and has no network effect. It is inspectable with `git log --notes=discern`, removable by deleting the notes ref or individual notes, and never changes trunk history. The write is fail-open because the trunk has already moved. A failed merge or note write leaves acceptance successful and carries its cause in the acceptance result; it never rolls the trunk back.

Transport is opt-in through:

```toml
[repository]
receipt_notes = "fetch"
```

The default is `"local"`. An install that has never enabled fetch transport does not add, remove, or rewrite any remote fetch or push setting. Returning a previously enabled repository to local mode removes only the mappings discern marked as managed. In fetch mode, refresh and lifecycle convergence add this fetch mapping once per remote:

The receipt and trust pages offer this switch when an owner decides the evidence should travel between clones; setup does not opt a repository in. Once enabled, a successful landing with a remote present offers the explicit publication command at the point where the new note exists.

```text
+refs/notes/discern:refs/discern/remotes/<remote>/notes
```

The leading `+` updates a remote-tracking copy only. It cannot overwrite the local `refs/notes/discern` history. Disabling fetch mode removes only mappings discern previously marked as managed. A repository with no remote records local notes and changes no transport configuration.

Discern never writes `remote.<name>.push` and never starts a fetch or push. After a successful landing with fetch mode and a remote, acceptance points to the explicit publication command:

```sh
git push <remote> refs/notes/discern
```

Before adding a new local receipt, acceptance merges every already-fetched `refs/discern/remotes/*/notes` tip into `refs/notes/discern`. This is the local half of the multi-clone policy: an ordinary fetch performed before acceptance supplies the remote history, and acceptance combines it without network access. A conflicting note for the same commit fails open and retains the cause.

A push can still lose a race after the last fetch. The recovery is:

```sh
git fetch <remote>
git notes --ref=discern merge refs/discern/remotes/<remote>/notes
git push <remote> refs/notes/discern
```

The merge is usually automatic because separate landings annotate different immutable trunk commits. The command remains necessary because multi-clone conflict freedom is not a property Git notes provide.

`discern status` reads the configured trunk tip from the local notes ref and any fetched tracking refs. When a valid receipt is present, it reports the receipt and the ref that supplied it. This is the minimal read path for fetched repository evidence; it does not turn status into a history browser.

Anticipated readers share this channel rather than inventing another store: cross-machine `await --green`, CI that requires a green receipt for the deployed tip, `patterns` trajectories reconstructed from landed standards, and signed receipt notes after the owner provisions the bot key. This record does not build those readers or signing.

## Consequences

- A landed tip retains its green receipt after the accepting worktree is removed.
- A clone that opts into fetch transport can verify a fetched trunk tip from repository data without a discern network operation.
- Ordinary branch fetches remain additive, and plain `git push` keeps Git's existing meaning.
- GitHub's commit UI does not show the record. Git-native tools and discern are the readers.
- Notes-only pushes can reach wildcard push-webhook consumers, so transport remains an owner opt-in.
- A note write, identity failure, or notes merge conflict cannot make an already-landed acceptance fail.
- Remote-tracking refs and the managed fetch entries add local Git configuration that refresh and lifecycle convergence must reconcile.
- Multi-clone publication can still race. The exact fetch, merge, and push recovery is part of the public contract.

## Alternatives considered

- **Add a receipt ledger commit after landing.** Rejected because it would replace acceptance's exact fast-forward with a second history mutation.
- **Fetch directly into `refs/notes/discern`.** Rejected because a forced mapping could discard local receipts that have not been published, while a non-forced mapping would make ordinary fetch fail on divergence.
- **Configure a notes push mapping.** Rejected because any `remote.<name>.push` entry changes what a plain `git push` sends.
- **Publish from discern during acceptance.** Rejected because discern makes no network requests and landing must not depend on a remote.
- **Store receipts in the logbook.** Rejected because the logbook is machine-local advisory evidence; the receipt and Git commit are the verification authority.
