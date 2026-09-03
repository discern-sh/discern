---
id: reference-proof-and-checkpoint-formats
title: "Proof and checkpoint formats"
description: "Look up Proof-note fields, checkpoint states/declarations, variance fields, and the when protocol exactly."
order: 50
publish: true
kind: reference
aliases:
  - "DISCERN_MATCH"
  - "reference-proof-and-checkpoint-formats"
  - "Proof notes"
  - "refs/notes/discern"
  - "fetch proof notes"
  - "publish proof notes"
  - "git notes"
  - "proof format"
  - "proof note schema"
  - "Proof note format"
  - "durable proof"
  - "proof subject"
  - "proof note"
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

Look up Proof-note fields, checkpoint states, declarations, variance fields, and the `when` protocol.

Prerequisite: a Proof field, checkpoint id/state, declaration, variance, or `when` input you need to interpret. Linked explanations add context but are not required to use these contracts.

## Proof notes

_A green landing keeps its structured Proof beside the immutable trunk commit._

After the trunk fast-forward, `discern accept` and `discern setup accept` write the durable Proof record under `refs/notes/discern` ([ADR 0215](https://discern.sh/docs/decisions/0215-landing-receipts-travel-as-git-notes), [ADR 0242](https://discern.sh/docs/decisions/0242-durable-receipts-use-a-versioned-dsse-envelope), [ADR 0313](https://discern.sh/docs/decisions/0313-setup-completion-and-acceptance-bind-one-final-proof)). It adds no trunk commit.

Read the current history with:

```sh
git log --notes=discern
```

Read one record with:

```sh
git notes --ref=discern show <commit>
```

`discern status` reports a valid local or fetched trunk-tip note as `data.landed_proof`: commit, source ref, and Proof.

### The durable format

The DSSE-compatible Base64 payload separates structured result facts from human presentation and excludes runtime telemetry. A future signature covers both; verification policy reads only the `proof` field. `signatures: []` records no signature, and discern signs or verifies nothing today ([ADR 0253](https://discern.sh/docs/decisions/0253-durable-proofs-project-runtime-receipts)).

Readers accept additive fields and older bare or pre-correction notes; unknown payload types report unsupported. [Proof note format](proof-and-checkpoint-formats.md) defines the contract and reading rules.

### Replay keeps the first presentation

The write identity is the annotated subject commit plus the stable machine-readable Proof claim. Repeating a note write with changed proof-line wording, Markdown, or runtime timing returns `already_present` and leaves the existing note bytes unchanged. Legacy bare notes use the commit they annotate as their subject. A different stable claim for the same commit remains a conflict and returns `record_failed` ([ADR 0333](https://discern.sh/docs/decisions/0333-proof-note-replay-uses-stable-claim-identity)).

### Authorship and failure

The notes commit uses `discern <done@discern.sh>` as author and committer. With `DISCERN_NO_ATTRIBUTION` set, it uses the repository's Git identity instead. The Proof still records.

The note write and fetch-configuration reconciliation both fail open. `data.proof_note.write` and `data.proof_note.fetch` carry their status and any cause. A transport or recording problem cannot roll the trunk back or turn the completed landing red.

### Carry notes between clones

Local recording changes no remote transport. To carry Proofs between clones:

```toml
[repository]
proof_notes = "fetch"
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

### Where it lives in code

| Concern                    | Source                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Note, merge, and transport | [`proof_notes.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/proof_notes.ts) |
| Acceptance boundary        | [`lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts) |
| Setup acceptance boundary  | [`setup_accept.ts`](https://github.com/jackwh/discern/blob/main/src/commands/setup_accept.ts)  |

### Current state and gotchas

- A note covers only the ref you read. Remote publication remains explicit.
- `data.landed_proof` reports a readable note that is bound to its commit. This read path performs no signature or issuer-identity verification.
- Direct Git inspection shows a Base64 payload. Use `discern status --verbose` for the rendered Proof.
- A normal fetch keeps a stale tracking note after the remote deletes it. Run `git fetch --prune <remote>` to remove refs the remote no longer carries.
- Refresh migrates older exact mappings that carry discern's ownership marker. An unmarked exact mapping stays untouched; the refresh result gives the command that removes it.
- An older marker may lack structured data. Acceptance honors its commit identity but reports `missing_proof`.
- A note with a different stable claim on the same commit fails open. Inspect the cause in `data.proof_note.write`.

## Proof note format

_A Proof note is the durable claim that `discern accept` attaches to a landed commit._

A landing writes one JSON Dead Simple Signing Envelope (DSSE) under `refs/notes/discern`. Its schema is <https://discern.sh/schema/v1/discern-proof-note.schema.json>:

```json
{
  "payloadType": "https://discern.sh/schema/v1/discern-proof-note.schema.json#/$defs/DiscernProofNotePayload",
  "payload": "<Base64-encoded payload bytes>",
  "signatures": []
}
```

The Base64 payload decodes to a UTF-8 JSON claim:

```json
{
  "subject": { "commit": "<full commit id>" },
  "proof": {
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

| Envelope field | Type          | Required | Contract                                                                      |
| -------------- | ------------- | -------- | ----------------------------------------------------------------------------- |
| `payloadType`  | string        | Yes      | Exact public schema id plus `#/$defs/DiscernProofNotePayload`.                |
| `payload`      | Base64 string | Yes      | UTF-8 JSON bytes for the payload.                                             |
| `signatures`   | array         | Yes      | Zero or more `{ keyid?, sig }` records; discern v1.0.0 writes an empty array. |

| Payload field  | Type   | Required | Contract                                                          |
| -------------- | ------ | -------- | ----------------------------------------------------------------- |
| `subject`      | object | Yes      | `{ commit }`, where `commit` is the full landed object id.        |
| `proof`        | object | Yes      | Stable Proof claim described below.                               |
| `presentation` | object | Yes      | Human `line` and full `markdown`; excluded from replay identity.  |
| `acceptance`   | object | No       | Consent, authorized variances, and approved Standard proposals.   |
| `issuer`       | object | No       | Reserved asserted `name`, `email`, and `key`; v1.0.0 writes none. |
| `brief`        | string | No       | Reserved signed-intent reference; v1.0.0 writes none.             |

| `proof` field        | Type                 | Required | Contract                                                     |
| -------------------- | -------------------- | -------- | ------------------------------------------------------------ |
| `branch`             | string               | Yes      | Validated effort branch.                                     |
| `trunk`              | string               | Yes      | Integration branch used by the Gate.                         |
| `head`               | string               | Yes      | Validated commit id.                                         |
| `files_total`        | number               | Yes      | Changed-file count.                                          |
| `insertions`         | number               | Yes      | Added-line count.                                            |
| `deletions`          | number               | Yes      | Removed-line count.                                          |
| `mode`               | `strict` or `report` | No       | `report` is CI review evidence and is not landing authority. |
| `checkpoint_drops`   | array                | No       | Bounded fail-open checkpoint accounts.                       |
| `standard_proposals` | array                | No       | Commit-bound pending Standard proposals.                     |

Acceptance has optional `consent`, `variances`, and `standard_proposals` fields. `consent.source` is `conversation`, `standing-grant`, or `effort-grant`; `scopes` is optional. Each `variances[]` member contains `checkpoint`, `definition_hash`, `subject`, and `why`. A Standard proposal contains `standard`, `commit`, `bound_commit`, `measured_commit`, `definition_fingerprint`, `trunk`, `trunk_commit`, `direction`, `trunk_limit`, `proposed_limit`, `measurement`, `delta`, `reason`, and non-empty `evidence_paths`.

- `payloadType` identifies the contract and compatibility major.
- `payload` preserves the serialized claim. discern writes padded Base64; its reader accepts standard and Base64url alphabets, with or without padding.
- `signatures` holds Base64 `sig` entries with optional `keyid`. A [standard signed envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) has at least one. discern's unsigned extension has none.

`subject.commit` is the full commit; `proof` is the closed claim; `presentation` holds its line and page. Optional `checkpoint_drops` retains bounded failed-open accounts. Optional `standard_proposals` retains pending decisions. `commit` is the immutable config-only origin. `measured_commit` is its measured parent. `bound_commit` is the current measured descendant. The remaining fields give fingerprint, limits, measurement, delta, reason, and paths. Optional `mode` identifies report-only CI Proof and is absent in strict local markers; acceptance never writes it as landing evidence. The writer excludes `waited_ms` and other telemetry. A future signature authenticates presentation. Policy remains non-authoritative. Optional issuer assertions and `brief` support later provenance work ([ADR 0253](https://discern.sh/docs/decisions/0253-durable-proofs-project-runtime-receipts), [ADR 0307](https://discern.sh/docs/decisions/0307-ci-reports-checkpoint-review-and-proof-retains-drops), [ADR 0339](https://discern.sh/docs/decisions/0339-proposed-standard-limits-and-shared-measurements), [ADR 0354](https://discern.sh/docs/decisions/0354-standard-proposals-renew-descendant-evidence)).

Normal acceptance adds consent, variances, and approved `standard_proposals`. A proposal-bearing claim without matching acceptance remains pending; generic consent approves none.

Write replay identity consists of `subject.commit` and the canonical `proof` claim. `presentation` differences return `already_present` and do not replace the standing note. A different canonical claim for the same subject is a conflict. Legacy bare notes use their annotated commit as the implied subject ([ADR 0333](https://discern.sh/docs/decisions/0333-proof-note-replay-uses-stable-claim-identity)).

### Signature and identity boundary

The future signature input follows [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md):

```text
PAE(UTF8(payloadType), decoded payload bytes)
```

The verifier uses those bytes directly; parsing and serializing the JSON could change them. Policy interprets only `proof`.

discern v1.0.0 neither signs nor verifies. A later profile chooses the algorithm, encoding, key lookup, and trust policy. `keyid` is an unauthenticated lookup hint; issuer fields gain meaning only when policy trusts the signing key.

### Reading rules

1. Require `subject.commit` and abbreviated `proof.head` to match the noted commit.
2. Accept additive v1 fields throughout the envelope and payload.
3. Report an unknown `payloadType` as `data.landed_proof_unsupported`.
4. Read a bare Proof with no `payloadType` as legacy unsigned evidence.
5. Read pre-correction v1 presentation from `proof`, dropping runtime-only fields.
6. Treat proposal fields as structured landing evidence only when the proof claim and acceptance evidence both carry the approved records.

`data.landed_proof` means the note is readable and commit-bound. This path performs no cryptographic verification.

### Where it lives in code

| Concern                     | Source                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Envelope, payload, issuer   | [`result_schemas.ts`](https://github.com/jackwh/discern/blob/main/src/shared/result_schemas.ts)                       |
| Writer, reader, cross-check | [`proof_notes.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/proof_notes.ts)                        |
| Published schema            | [`discern-proof-note.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-proof-note.schema.json) |

## Checkpoint state and declarations

A [checkpoint](glossary.md#checkpoint) pairs a deterministic trigger with a question the agent judges. This page is the reference for its states, flags, and surfaces. The governing definitions are read from `[checkpoints]` at the effort's merge-base with the trunk — the **policy identity** every report and Proof names. A `stop` checkpoint interlocks `discern done`; an `advise` checkpoint serves its question through the advisory channel and blocks nothing.

### Open question states

A fired `stop` checkpoint opens an effort-scoped **[open question](glossary.md#open-question)** — the record a declaration binds to, carrying the resolved-definition hash and the subject fingerprint of the matched content.

| State                  | Meaning                                                                       | Resolved by                                            |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `awaiting_declaration` | The open question has no current conclusion.                                  | `discern done --met <id>`, or `--unmet <id> --why "…"` |
| `declared_met`         | The agent recorded that the question is satisfied for the current subject.    | Standing evidence; reopens on a relevant change        |
| `declared_unmet`       | The agent recorded that it is not satisfied, with a one-paragraph rationale.  | An owner-authorized variance at `discern accept`       |
| `reopened`             | A relevant change unbound the recorded conclusion; it must be declared again. | A fresh declaration at `discern done`                  |

Reopening is relevance-sensitive: a declaration stales only when the checkpoint's definition or the matched content changes. Unrelated edits and trunk advances leave it standing.

The structural trigger opens a question. A readable open question whose id still governs in `stop` mode remains active after a later trigger veto. Its projected subject and declaration state therefore outrank an idle structural preview; a recorded question outside the governing policy remains visible as history but does not interlock.

### Strict obligation states

Every governing row projects one `obligation`, the decision a bare `discern done` would make before Gate jobs:

| Obligation             | Strict meaning                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `none`                 | No checkpoint conclusion is required.                                                |
| `will_open`            | The settled trigger will open its question and require a conclusion.                 |
| `awaiting_declaration` | A persisted open question already awaits a conclusion.                               |
| `reopened`             | Subject or definition currency requires a fresh conclusion.                          |
| `declared_met`         | A current declared-met conclusion lets the Gate proceed.                             |
| `declared_unmet`       | The Gate proceeds; landing remains bound to an owner-authorized variance.            |
| `unknown`              | Store, subject, diff, or a pending `when` condition keeps the read decision unknown. |

### Declarations at the gate

`discern done --met <id>` (repeatable) records a declared-met conclusion; `discern done --unmet <id> --why "<rationale>"` records a declared-unmet conclusion, one per invocation, with a required rationale of 1–500 characters in one paragraph. A declaring invocation records every valid conclusion first, then proceeds into the gate in the same run. Recording a conclusion is the caller's own act; every surface qualifies it as **[declared met](glossary.md#declared-met)** or **[declared unmet](glossary.md#declared-unmet)** — recorded judgment, distinct from machine-verified results. The Proof carries declared conclusions separately, and changed declaration evidence stales a recorded Proof even at an unchanged `HEAD`.

### Variance at acceptance

A current declared-unmet conclusion makes `discern accept` refuse until the owner authorizes each named variance in the current conversation: `discern accept --confirmed --variance <id>` (repeatable; the id set must equal the declared-unmet set). Recorded standing and effort grants cover no variance. Each authorization binds to the exact declaration (checkpoint id, definition hash, subject fingerprint, rationale) and to the landed commit.

### Read surfaces

`discern checkpoints` (CLI, `--json`, `--markdown`, and the MCP tool `discern_checkpoints`) reports the governing policy with each checkpoint's canonical obligation, question, trigger summary, open-question evidence, and structural preview, plus recorded questions outside the governing policy, observed economics, and fail-open advisories. `discern prepare` and `discern status` route the same obligation through the advisory channel, and `discern done --dry-run` describes the same refusal-or-proceed decision. Every read surface is effect-free: it runs no configured `when` command (an undecided condition reports as `unknown` and “may require”) and writes no open question, declaration, Gate marker, or checkpoint lifecycle observation. Command details live in the [CLI reference](cli-reference.md#discern-checkpoints), executable input and output in the [`when` protocol](proof-and-checkpoint-formats.md), and the result contract in [MCP tools & results](mcp-and-results.md).

## Checkpoint `when` protocol

A structurally holding checkpoint may delegate its final firing decision to `when = "<command>"`. An actual strict or CI run creates one temporary UTF-8 JSON file for the command and exposes its absolute path as `DISCERN_CHECKPOINT_INPUT`. Version 1 has this shape:

```json
{
  "version": 1,
  "checkpoint": { "id": "example", "mode": "stop" },
  "policy_commit": "<merge-base object id>",
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

`changed_files` is sorted by path and contains the final structurally narrowed changed evidence. Each `kind` is `added`, `modified`, or `deleted`; line counts are non-negative integers and `binary` is a known Boolean. `history` is optional and, when present, describes the ordered merge-base-to-`HEAD` commit list. The object contains no raw file content, environment dump, question, rationale, or secret.

The registered input file has mode `0600` and exists only while its command runs. The fixed wall-clock budget is 10 seconds and retained protocol output is capped at 256 KiB. discern removes the file after fire, pass, invalid exit, timeout, cancellation, spawn failure, or input failure, completing cleanup before an interrupt can be re-raised. A cleanup failure or output beyond the cap fails the checkpoint open and leaves a typed drop. `discern checkpoints`, `status`, `prepare`, and every dry run create no input file and run no command.

Exit 0 fires, exit 1 passes, and another exit or execution error fails open. `DISCERN_MATCH <path>` lines may narrow the matched set but cannot admit a path absent from `changed_files`. Without a valid declared match, the command retains the structural matched set.

The merge-base governs the command text. The command runs in the candidate worktree, so its scripts, dependencies, configuration, and interpreter resolve there and do not form a hermetic policy dependency closure ([ADR 0308](https://discern.sh/docs/decisions/0308-checkpoint-triggers-use-bounded-facts-and-versioned-input)).
