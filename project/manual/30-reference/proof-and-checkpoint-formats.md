---
id: reference-proof-and-checkpoint-formats
title: "Proof and checkpoint formats"
description: "Look up the exact format of a Proof note, the worktree's Proof marker, the states of a checkpoint question, and the protocol for a checkpoint's when command."
order: 110
publish: true
kind: reference
aliases:
  - "DISCERN_MATCH"
  - "reference-proof-and-checkpoint-formats"
  - "Proof notes"
  - "refs/notes/discern"
  - "fetch Proof notes"
  - "publish Proof notes"
  - "git notes"
  - "Proof format"
  - "Proof note schema"
  - "Proof note format"
  - "durable Proof"
  - "Proof subject"
  - "Proof note"
  - "Checkpoint state and declarations"
  - "awaiting_declaration"
  - "awaiting_variance"
  - "when command"
  - "declared met"
  - "declared unmet"
  - "--met"
  - "--unmet"
  - "--why"
  - "--variance"
  - "Checkpoint `when` protocol"
  - "checkpoint when input"
  - "checkpoint when command"
---

# Proof and checkpoint formats

Look up the exact formats behind Proof and checkpoints: the Proof note discern attaches to each landed commit, the Proof marker in each worktree (the separate copy of the project where one task happens), the states a checkpoint question moves through, and the protocol a checkpoint's `when` command follows. You need these to inspect stored evidence yourself, or to build a tool on it.

To decide what a Proof means for a change you're reviewing, start with [Proof](../20-understand/proof.md).

| Find                                        | Go to                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Read a landed change's evidence             | [Proof notes](#proof-notes)                                             |
| Fetch or publish notes between clones       | [Carry notes between clones](#carry-notes-between-clones)               |
| Parse the durable JSON record               | [Proof note format](#proof-note-format)                                 |
| Inspect a worktree's current Proof marker   | [The worktree's Proof marker](#the-worktrees-proof-marker)              |
| Interpret a checkpoint state or declaration | [Checkpoint state and declarations](#checkpoint-state-and-declarations) |
| Write a `when` command                      | [Checkpoint `when` protocol](#checkpoint-when-protocol)                 |

## Proof notes

When a change lands, discern attaches its Proof to the landed commit as a **Proof note**, under `refs/notes/discern`. Both values of `[repository].proof_notes_mode` record notes locally: `"local"`, the default, and `"fetch"`. There's no setting that turns notes off. A note stays after the task's worktree is gone, and adds no commit to the trunk.

Read the note history with:

```sh
git log --notes=discern
```

Read one note with:

```sh
git notes --ref=discern show <commit>
```

`discern status` reports a valid local or fetched note on the trunk tip as `data.landed_proof`: the commit, the source ref, and the Proof. A note on the trunk tip that's missing `proof.completion` is reported as `data.landed_proof_stale`. A note in an unknown format is reported as `data.landed_proof_unsupported`. An emergency landing's record appears as `data.landed_exception` instead.

### The durable format

A note keeps the structured evidence separate from how it's presented, inside a version 1 envelope compatible with the Dead Simple Signing Envelope (DSSE). It holds no runtime telemetry. `signatures: []` means the record is unsigned: discern doesn't sign notes, or verify signatures. The [format and reading rules](#proof-note-format) below define the fields that make a note usable evidence, and how readers treat a record they can't use.

### Replay keeps the first presentation

A note's identity is its subject commit, its stable machine-readable Proof claim, and its acceptance evidence. Writing the note again with a changed Proof line, Markdown, or timing returns `already_present`, and leaves the existing note unchanged. A different claim or different acceptance evidence for the same commit is a conflict, and returns `record_failed` ([ADR 0333](https://discern.sh/docs/decisions/0333-proof-note-replay-uses-stable-claim-identity)).

A note write reports `recorded`, `already_present`, `record_failed`, or `missing_proof`. `record_failed` also covers a commit that already has a stale note, a note in an unknown format, or an emergency exception record, which Proof never replaces.

### Authorship and failure

discern writes the notes commit as `discern <done@discern.sh>`, both author and committer. With a non-empty `DISCERN_NO_ATTRIBUTION`, it uses the repository's Git identity instead, and still records the Proof.

If writing the note fails, the landing still stands. The acceptance result reports the write in `data.proof_note.write`, with its status and reason, and marks the note step failed with a `proof-recording-unavailable` advisory. The worktree's acceptance journal keeps the consent, variances, proposals, and Proof pointer, so a retry can record the note without repeating the landing or spending its authority again. A retry is only possible while the worktree survives, because an ordinary cleanup removes the worktree and its journal.

Setup results report `data.proof_note.write` and `data.proof_note.fetch`.

### Carry notes between clones

Recording notes locally changes nothing about your remotes. To carry Proof notes between clones, set:

```toml
[repository]
proof_notes_mode = "fetch"
```

`discern refresh`, or the next lifecycle reconciliation, then adds this fetch mapping, once per remote:

```text
+refs/notes/discern*:refs/discern/remotes/<remote>/notes*
```

The trailing `*` keeps an ordinary fetch working when the remote has no notes. Git treats a wildcard with no matches as an empty fetch, so `git fetch` succeeds before the remote's first Proof note, and after that ref is deleted.

The mapping reserves the `refs/notes/discern*` prefix, so matching sibling refs get matching suffixes under the tracking path. Readers use every tracking ref under `refs/discern/remotes/` whose name ends in `/notes`. Normally that's `refs/discern/remotes/<remote>/notes`.

An ordinary `git fetch` updates the tracking copy. discern never configures `remote.<name>.push`, never changes a plain `git push`, and never starts a network request. After a landing in fetch mode, discern suggests the command that publishes your notes, naming `origin` when you have it:

```sh
git push <remote> refs/notes/discern
```

Before it writes a note, acceptance merges the fetched `refs/discern/remotes/*/notes` histories. A push can still be rejected if someone published in the meantime. Recover with:

```sh
git fetch <remote>
git notes --ref=discern merge refs/discern/remotes/<remote>/notes
git push <remote> refs/notes/discern
```

Switching `proof_notes_mode` back to `"local"`, or removing a remote, removes discern's mappings. GitHub stores the notes ref but doesn't display it; Git's own commands and discern read it.

### Limits to know

- A note covers only the ref you read. Publishing to a remote stays your explicit step.
- `data.landed_proof` means the note is readable and bound to its commit. This check verifies no signature or issuer identity.
- Reading the note directly in Git shows a Base64 payload. Use `discern status --verbose` for the rendered Proof.
- A normal fetch keeps a stale tracking note after the remote deletes it. Run `git fetch --prune <remote>` to remove refs the remote no longer has.
- Refresh reconciles the exact mapping discern owns, and leaves every other mapping untouched.
- A note with a different claim on the same commit stays as a publication conflict. Inspect the write result in `data.proof_note.write` before you retry.

## Proof note format

A Proof note is a JSON Dead Simple Signing Envelope (DSSE). The [published schema](https://discern.sh/schema/v1/discern-proof-note.schema.json) defines the complete contract:

```json
{
  "payloadType": "https://discern.sh/schema/v1/discern-proof-note.schema.json#/$defs/DiscernProofNotePayload",
  "payload": "<Base64-encoded payload bytes>",
  "signatures": []
}
```

The Base64 payload decodes to a UTF-8 JSON claim. This layout shortens the nested evidence; the schema defines the complete objects:

```json
{
  "subject": { "commit": "<full commit id>" },
  "proof": {
    "completion": { "...": "complete candidate and evidence receipts" },
    "branch": "…",
    "trunk": "…",
    "head": "…",
    "files_total": 1,
    "insertions": 1,
    "deletions": 0
  },
  "presentation": { "line": "…", "markdown": "…" }
}
```

### Contract

| Envelope field | Type          | Required | Contract                                                                                        |
| -------------- | ------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `payloadType`  | string        | Yes      | The exact public schema id plus `#/$defs/DiscernProofNotePayload`.                              |
| `payload`      | Base64 string | Yes      | The payload's UTF-8 JSON bytes.                                                                 |
| `signatures`   | array         | Yes      | Zero or more `{ keyid?, sig }` records. Current writers, which don't sign, emit an empty array. |

| Payload field  | Type   | Required | Contract                                                                        |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `subject`      | object | Yes      | `{ commit }`, where `commit` is the full id of the landed commit.               |
| `proof`        | object | Yes      | The stable Proof claim, described below.                                        |
| `presentation` | object | Yes      | The Proof `line` and full `markdown`; not part of the replay identity.          |
| `acceptance`   | object | No       | Consent, authorized variances, and approved standard proposals.                 |
| `issuer`       | object | No       | Reserved for an asserted `name`, `email`, and `key`; current writers emit none. |
| `brief`        | string | No       | Reserved for a reference to signed intent; current writers emit none.           |

| `proof` field        | Type                 | Required | Contract                                                                                                                   |
| -------------------- | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `completion`         | object               | Yes      | The immutable candidate and its source, the composition procedure, complete evidence receipts, policy, and executor facts. |
| `branch`             | string               | Yes      | The validated effort branch.                                                                                               |
| `trunk`              | string               | Yes      | The trunk branch the gate used.                                                                                            |
| `head`               | string               | Yes      | The validated commit id, abbreviated to 12 characters.                                                                     |
| `files_total`        | number               | Yes      | The count of changed files.                                                                                                |
| `insertions`         | number               | Yes      | The count of added lines.                                                                                                  |
| `deletions`          | number               | Yes      | The count of removed lines.                                                                                                |
| `mode`               | `strict` or `report` | No       | `report` marks CI review evidence, which isn't landing authority.                                                          |
| `checkpoint_drops`   | array                | No       | Bounded accounts of checkpoints that failed open.                                                                          |
| `standard_proposals` | array                | No       | Pending standard proposals, each bound to a commit.                                                                        |

When `acceptance` is present, its `consent`, `variances`, and `standard_proposals` fields are all required, and either decision array may be empty.

- **`consent.source`** is `conversation`, `standing-grant`, or `effort-grant`. **`consent.scopes`** appears only for a standing grant, and names the scopes that covered the changed paths.
- **Each `variances[]` member** holds `checkpoint`, `definition_hash`, `subject`, and `why`. Here `subject` is the checkpoint's subject fingerprint, a string, unlike the payload's top-level `subject` object.
- **Each standard proposal** holds `standard`, `commit`, `bound_commit`, `measured_commit`, `definition_fingerprint`, `trunk`, `trunk_commit`, `direction`, `trunk_limit`, `proposed_limit`, `measurement`, `delta`, `reason`, and a non-empty `evidence_paths`. `commit` is the immutable origin commit that changed only the configuration, `measured_commit` is its measured parent, and `bound_commit` is the current measured descendant.

An ordinary landing records its consent, variances, and approved `standard_proposals`. A claim that carries proposals without matching acceptance evidence stays pending, and general consent approves none of them. Setup acceptance writes its note without an `acceptance` block.

The payload has to agree with itself: `subject.commit` equals the candidate head inside `proof.completion`, and `proof.mode` matches the mode recorded there. `proof.mode` is left out for strict Proof. Acceptance never writes report-only evidence as a landing Proof. The durable claim leaves out `waited_ms` and other telemetry, and the runtime Proof's `checkpoints` block. A future signature could authenticate the presentation, but policy decisions use the structured claim. The optional issuer assertions and `brief` support later provenance work ([ADR 0253](https://discern.sh/docs/decisions/0253-durable-proofs-project-runtime-receipts), [ADR 0307](https://discern.sh/docs/decisions/0307-ci-reports-checkpoint-review-and-proof-retains-drops), [ADR 0339](https://discern.sh/docs/decisions/0339-proposed-standard-limits-and-shared-measurements), [ADR 0354](https://discern.sh/docs/decisions/0354-standard-proposals-renew-descendant-evidence)).

Base64 and signatures follow these rules:

- `payloadType` identifies the contract and its compatibility major.
- `payload` preserves the serialized claim. discern writes padded Base64, and its reader accepts the standard and Base64url alphabets, with or without padding.
- `signatures` holds Base64 `sig` entries, each with an optional `keyid`. A [standard signed envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) has at least one entry; discern's unsigned form has none.

### Signature and identity boundary

A future signature would sign this input, as [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md) defines it:

```text
PAE(UTF8(payloadType), decoded payload bytes)
```

A verifier uses those bytes directly, because parsing and re-serializing the JSON could change them. Policy interprets only `proof`.

discern neither signs nor verifies today. A later profile would choose the algorithm, encoding, key lookup, and trust policy. `keyid` is an unauthenticated lookup hint, and issuer fields mean something only when policy trusts the signing key.

### Reading rules

1. Require `subject.commit`, and the abbreviated `proof.head`, to match the noted commit.
2. Accept added v1 fields anywhere in the envelope and payload.
3. Report an unknown `payloadType` as `data.landed_proof_unsupported`.
4. Require the envelope, separate `proof` and `presentation` blocks, an explicit subject, and `signatures`, including the empty unsigned form.
5. Accept standard or Base64url payload alphabets, with or without padding. Current writers emit padded standard Base64.
6. Refuse an unknown value in a closed vocabulary.
7. Treat proposal fields as landing evidence only when both the Proof claim and the acceptance evidence carry the approved records.
8. Require complete candidate evidence. A note missing `proof.completion` reads as stale, and a note missing other required fields reads as no note at all.

`data.landed_proof` means the note is readable and bound to its commit, and no more: this path performs no cryptographic verification. The writer never records report-only evidence as landing Proof, but the reader still accepts a well-formed report-mode note as readable.

## The worktree's Proof marker

Each worktree keeps a local marker that links its clean committed source to the exact candidate and complete evidence of its last completion. It lets discern reuse that evidence while those facts stay current.

Find the marker's path with:

```sh
git rev-parse --git-path discern/gate-proof
```

Its registered JSON format is version 1:

```json
{
  "version": 1,
  "head": "<full commit id>",
  "mode": "strict",
  "completion": {
    "candidate_id": "<candidate id>",
    "proof_id": "<complete Proof id>"
  },
  "proof": { "...": "the structured Proof and both renderings" },
  "evidence": "<checkpoint declaration evidence identity>"
}
```

| Field                     | Meaning                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `head`                    | The full commit of the authored source, checked before and after completion.                                                                        |
| `completion.candidate_id` | The immutable candidate validated for this source.                                                                                                  |
| `completion.proof_id`     | The complete evidence record, in the repository's shared storage.                                                                                   |
| `mode`                    | `strict` for landing evidence, or `report` for report-only evidence.                                                                                |
| `proof`                   | The structured Proof and its renderings, including the live set of standard proposals when there are any. Its `head` names the validated candidate. |
| `evidence`                | The identity of the checkpoint declaration evidence.                                                                                                |

The authored `head` and the Proof's `head` name the same commit, because completion validates the checkout's own committed tip. A CI report gives feedback without landing Proof, and never replaces valid strict evidence.

- A record missing `completion`, `proof`, or `evidence` can't narrow standard measurement, satisfy gate reuse, or skip acceptance validation.
- A text marker without a version counts as missing evidence, and needs a fresh `discern done`.
- A marker with a version newer than 1 is kept, and reports that discern must be updated before it can use or replace the marker.

The marker lives in the worktree, and disappears with it. After landing, the [Proof note](#proof-notes) keeps the evidence on the landed commit.

## Checkpoint state and declarations

A [checkpoint](glossary.md#checkpoint) pairs a deterministic trigger with a question your agent judges. For completion, discern reads the governing definitions from `[checkpoints]` at the candidate's expected predecessor: the trunk's current tip. A CI report uses the comparison policy it declares. That commit is the **policy identity**, which every report and Proof names.

A `stop` checkpoint pauses `discern done` until your agent records a conclusion. An `advise` checkpoint shows the question without blocking.

### Open question states

A `stop` checkpoint that fires opens an **[open question](glossary.md#open-question)** for the effort. It's the record a declaration binds to, and it holds the hash of the resolved definition and the fingerprint of the matched content, called the subject.

| State                  | Meaning                                                                          | Resolved by                                             |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `awaiting_declaration` | The open question has no current conclusion.                                     | `discern done --met <id>`, or `--unmet <id> --why "…"`. |
| `declared_met`         | The agent recorded that the question is satisfied for the current subject.       | Standing evidence. It reopens on a relevant change.     |
| `declared_unmet`       | The agent recorded that it isn't satisfied, with a one-paragraph rationale.      | A variance you authorize at `discern accept`.           |
| `reopened`             | A relevant change unbound the recorded conclusion, so it must be declared again. | A fresh declaration at `discern done`.                  |

A declaration goes stale only when something relevant changes: the checkpoint's definition, or its subject.

- The subject covers the matched paths as they stand on both sides of the change, and any related paths the checkpoint links to them.
- discern reads the base side at the policy commit, so a trunk advance that changes a matched path also reopens the question.
- A checkpoint with `min_commits` also includes the ordered commits since the policy commit, so any new commit reopens it.

Other edits, and trunk advances that don't touch the matched content, leave a declaration standing.

Once a structural trigger opens a question, a later veto from the trigger doesn't close it while that id still governs in `stop` mode. Its current subject and declaration decide whether it needs a conclusion. A recorded question outside the governing policy stays visible as history, and doesn't block completion.

### Strict obligation states

Each governing checkpoint has an `obligation`, which says whether completion needs a conclusion before the gate jobs run:

| Obligation             | Strict meaning                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `none`                 | No checkpoint conclusion is needed.                                                       |
| `will_open`            | The settled trigger will open its question and need a conclusion.                         |
| `awaiting_declaration` | A stored open question already waits for a conclusion.                                    |
| `reopened`             | The subject or definition changed, so it needs a fresh conclusion.                        |
| `declared_met`         | A current declared-met conclusion lets the gate go ahead.                                 |
| `declared_unmet`       | The gate goes ahead, and landing stays bound to a variance you authorize.                 |
| `unknown`              | The store, the subject, the diff, or a pending `when` condition keeps the answer unknown. |

### Declarations at the gate

`discern done --met <id>` records a declared-met conclusion, and can be repeated. `discern done --unmet <id> --why "<rationale>"` records a declared-unmet conclusion, one per invocation, with a required rationale of 1–500 characters in one paragraph.

discern checks every declaration in the invocation before it writes anything. If one id or rationale is invalid, it records nothing and runs nothing. Otherwise it records every conclusion, then goes on into the gate in the same run. `discern done` still refuses while any `stop` question waits for a conclusion, or has reopened.

Recording a conclusion is the agent's own act, so every surface labels it **[declared met](glossary.md#declared-met)** or **[declared unmet](glossary.md#declared-unmet)**: a recorded judgment, distinct from machine-checked results. The Proof carries declared conclusions separately, and changed declaration evidence makes a recorded Proof stale, even at an unchanged `HEAD`.

When a landing composes your change with a newer trunk and the combined code serves a checkpoint question, your agent answers it with `discern accept --met`, or `--unmet` with `--why`, naming the composition receipt it was served with `--composition-receipt`.

### Variance at acceptance

A **variance** is your permission to land a change despite an unmet checkpoint. A current declared-unmet conclusion makes `discern accept` refuse until you authorize each named variance, in the current conversation: `discern accept --confirmed --variance <id>`, which can be repeated. The set of ids must equal the declared-unmet set. Recorded standing and effort grants cover no variance. Each authorization binds to the exact declaration, meaning the checkpoint id, definition hash, subject fingerprint, and rationale, and to the landed commit.

### Read surfaces

`discern checkpoints` reports the governing policy. Its CLI output, `--json`, `--markdown`, and the MCP tool `discern_checkpoints` carry each checkpoint's obligation, question, trigger summary, open-question evidence, and structural preview. They also carry recorded questions outside the governing policy, observed economics, and fail-open advisories.

`discern prepare` and `discern status` show checkpoint obligations as advice, and `discern done --dry-run` previews them. Inspecting checkpoints runs no configured `when` command, and writes no question, declaration, gate marker, or lifecycle observation. An undecided condition reports `unknown`, and says the checkpoint "may require" a conclusion. `discern prepare`'s other steps can still change files.

The [CLI reference](cli-reference.md#discern-checkpoints) covers the command, the [`when` protocol](#checkpoint-when-protocol) covers a command's input and output, and [MCP and results](mcp-and-results.md) covers the result contract.

## Checkpoint `when` protocol

A checkpoint whose structural trigger holds can hand its final firing decision to a command: `when = "<command>"`. During an actual strict or CI run, discern writes one temporary UTF-8 JSON file for the command, and gives its absolute path in `DISCERN_CHECKPOINT_INPUT`. Version 1 has this shape:

```json
{
  "version": 1,
  "checkpoint": { "id": "example", "mode": "stop" },
  "policy_commit": "<governing policy commit id>",
  "changed_files": [
    {
      "path": "src/example.ts",
      "kind": "modified",
      "insertions": 4,
      "deletions": 1,
      "binary": false
    }
  ],
  "history": { "count": 2, "fingerprint": "<ordered-history hash>" }
}
```

- **`changed_files`** is sorted by path, and holds the final changed files after structural narrowing. Each `kind` is `added`, `modified`, or `deleted`. Line counts are non-negative integers, and `binary` is always a known Boolean.
- **`history`** is optional. When present, it describes the ordered list of commits from the governing policy commit to the revision being evaluated.
- The file holds no raw file content, environment dump, question, rationale, or secret.

The input file has mode `0600`, and exists only while its command runs. The command gets a fixed wall-clock budget of 10 seconds, and discern keeps at most 256 KiB of its output. discern removes the file after a fire, a pass, an invalid exit, a timeout, a cancellation, a spawn failure, or an input failure, and finishes that cleanup before an interrupt can be re-raised. `discern checkpoints`, `status`, `prepare`, and dry runs create no input file, and run no `when` command.

Exit `0` fires the checkpoint, and exit `10` passes it. Anything else is indeterminate, with a typed reason:

| Outcome                                | Reason                      |
| -------------------------------------- | --------------------------- |
| Any other exit status                  | `when_invalid_exit`         |
| The command couldn't start             | `when_spawn_failed`         |
| The input file couldn't be prepared    | `when_input_failed`         |
| The command was cancelled              | `when_cancelled`            |
| The command ran past its 10 seconds    | `when_timeout`              |
| The output went past 256 KiB           | `when_output_limit`         |
| discern couldn't remove the input file | `when_input_cleanup_failed` |

When the structural trigger holds, an indeterminate `stop` checkpoint serves its question against the complete structural matched set, and records the typed uncertainty. An indeterminate `advise` checkpoint stays non-blocking, and reports it. A Proof that carries an indeterminate `stop` can't be reused, and acceptance then needs your confirmation in the current conversation; a recorded grant doesn't cover it.

After a decisive fire, `DISCERN_MATCH <path>` lines in the output can narrow the matched set, but can't add a path that isn't in `changed_files`. Without a valid declared match, the checkpoint keeps the structural matched set.

The governing policy commit supplies the command's text. During strict completion, that's the candidate's expected predecessor. The command runs in the candidate worktree, where its scripts, dependencies, configuration, and interpreter resolve. Those dependencies aren't frozen along with the policy's command text.
