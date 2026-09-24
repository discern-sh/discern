---
title: Proof note format
description: The DSSE-compatible envelope attached to a landed commit, including its payload, signature boundary, and reading rules.
order: 50
aliases:
  - proof format
  - proof note schema
  - durable proof
  - proof subject
  - proof note
---

# Proof note format

_A Proof note is the durable claim that `discern accept` attaches to a landed commit._

A landing writes one JSON Dead Simple Signing Envelope (DSSE) under `refs/notes/discern`. Its schema is <https://discern.sh/schema/v1/discern-proof-note.schema.json>:

```json
{
  "payloadType": "https://discern.sh/schema/v1/discern-proof-note.schema.json#/$defs/DiscernProofNotePayload",
  "payload": "<Base64-encoded payload bytes>",
  "signatures": []
}
```

The Base64 payload decodes to the versioned JSON claim. Its `proof.completion` records the immutable candidate, committed source, composition procedure, complete validation evidence and executors. A note an accepted landing writes also carries the `acceptance` block described below. The [published schema](../../../schema/discern-proof-note.schema.json) is the field authority; a prelaunch payload without complete evidence is stale and cannot establish current authority.

## Contract

- `payloadType` identifies the contract and compatibility major.
- `payload` preserves the serialized claim. discern writes padded Base64; its reader accepts standard and Base64url alphabets, with or without padding.
- `signatures` holds Base64 `sig` entries with optional `keyid`. A [standard signed envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) has at least one. discern's unsigned extension has none.

`subject.commit` is the full commit. `proof` is the closed machine-readable claim. `presentation` holds the line and page. The optional `checkpoint_drops` array retains bounded structured accounts of checkpoint enforcement that failed open. The optional `standard_proposals` array retains each standard limit proposal awaiting a decision, including its commit identities, definition fingerprint, limits, measurement, delta, reason, and responsible paths. The optional `mode` is absent for ordinary strict Proof and identifies report-only CI Proof in local markers. Acceptance never writes report-only identity as landing evidence. The writer projects both blocks field by field, excluding `waited_ms` and other runtime telemetry. A future signature authenticates presentation. Policy treats it as non-authoritative. Optional issuer assertions and `brief` support later provenance work ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md), [ADR 0307](../_adr/0307-ci-reports-checkpoint-review-and-proof-retains-drops.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

Normal acceptance adds an `acceptance` block with its consent evidence, checkpoint variances, and `standard_proposals`. The proposal array records the owner-approved tuples for that landing. A proposal-bearing Proof claim without matching acceptance evidence remains a pending decision. A generic consent source does not imply approval.

Write replay identity consists of `subject.commit` and the canonical `proof` claim. `presentation` differences return `already_present` and do not replace the standing note. A different canonical claim for the same subject is a conflict ([ADR 0333](../_adr/0333-proof-note-replay-uses-stable-claim-identity.md)).

## Signature and identity boundary

The future signature input follows [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md):

```text
PAE(UTF8(payloadType), decoded payload bytes)
```

The verifier uses those bytes directly; parsing and serializing the JSON could change them. Policy interprets only `proof`.

discern neither signs nor verifies today. A later profile chooses the algorithm, encoding, key lookup, and trust policy. `keyid` is an unauthenticated lookup hint; issuer fields gain meaning only when policy trusts the signing key.

## Reading rules

1. Require `subject.commit` and abbreviated `proof.head` to match the noted commit.
2. Read the declared payload type and required evidence fields. Preserve original bytes; notes missing complete evidence are stale and cannot supply current completion or authority.
3. Report an unknown `payloadType` as `data.landed_proof_unsupported`.
4. Require the envelope, split `proof` and `presentation` blocks, an explicit subject, and `signatures`, including the empty unsigned extension.
5. Accept standard or Base64url payload alphabets, with or without padding; current writers emit padded standard Base64.
6. Treat proposal fields as structured landing evidence only when the proof claim and acceptance evidence both carry the approved records.

`data.landed_proof` means the note is readable and commit-bound. This path performs no cryptographic verification.

## Where it lives in code

| Concern                     | Source                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Envelope, payload, issuer   | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                       |
| Writer, reader, cross-check | [`proof_notes.ts`](../../../src/engine/gate/proof_notes.ts)                        |
| Published schema            | [`discern-proof-note.schema.json`](../../../schema/discern-proof-note.schema.json) |
