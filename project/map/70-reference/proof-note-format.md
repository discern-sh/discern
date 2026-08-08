---
title: Proof note format
description: The DSSE-compatible envelope attached to a landed commit, including its payload, signature boundary, and reading rules.
order: 40
aliases:
  - proof format
  - proof note schema
  - durable proof
  - proof subject
  - proof note
  - proof note schema
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

The Base64 payload decodes to a UTF-8 JSON claim:

```json
{
  "subject": { "commit": "<full commit id>" },
  "proof": { "branch": "…", "trunk": "…", "head": "…", "files_total": 1, "insertions": 1, "deletions": 0 },
  "presentation": { "line": "…", "markdown": "…" }
}
```

## Contract

- `payloadType` identifies the contract and compatibility major.
- `payload` preserves the serialized claim. discern writes padded Base64; its reader accepts standard and Base64url alphabets, with or without padding.
- `signatures` holds Base64 `sig` entries with optional `keyid`. A [standard signed envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) has at least one. discern's unsigned extension has none.

`subject.commit` is the full commit. `proof` is the closed machine-readable claim; `presentation` holds the line and page. The writer projects both field by field, excluding `waited_ms` and other runtime telemetry. A future signature authenticates presentation, but policy treats it as non-authoritative. Optional issuer assertions and `brief` support later provenance work ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)).

## Signature and identity boundary

The future signature input follows [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md):

```text
PAE(UTF8(payloadType), decoded payload bytes)
```

The verifier uses those bytes directly; parsing and serializing the JSON could change them. Policy interprets only `proof`.

discern v1.0.0 neither signs nor verifies. A later profile chooses the algorithm, encoding, key lookup, and trust policy. `keyid` is an unauthenticated lookup hint; issuer fields gain meaning only when policy trusts the signing key.

## Reading rules

1. Require `subject.commit` and abbreviated `proof.head` to match the noted commit.
2. Accept additive v1 fields throughout the envelope and payload.
3. Report an unknown `payloadType` as `data.landed_proof_unsupported`.
4. Read a bare Proof with no `payloadType` as legacy unsigned evidence.
5. Read pre-correction v1 presentation from `proof`, dropping runtime-only fields.

`data.landed_proof` means the note is readable and commit-bound. This path performs no cryptographic verification.

## Where it lives in code

| Concern                     | Source                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Envelope, payload, issuer   | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                       |
| Writer, reader, cross-check | [`proof_notes.ts`](../../../src/engine/gate/proof_notes.ts)                        |
| Published schema            | [`discern-proof-note.schema.json`](../../../schema/discern-proof-note.schema.json) |
