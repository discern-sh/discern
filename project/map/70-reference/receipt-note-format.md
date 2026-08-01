---
title: Receipt note format
description: The DSSE-compatible envelope attached to a landed commit, including its payload, signature boundary, and reading rules.
order: 40
aliases:
  - receipt format
  - receipt note schema
  - durable receipt
  - receipt subject
---

# Receipt note format

_The durable claim `discern accept` attaches to a landed commit._

A landing writes one compact JSON object plus a newline under `refs/notes/discern`. The object uses the Dead Simple Signing Envelope (DSSE) field and payload boundary. Its schema is <https://discern.sh/schema/v1/discern-receipt-note.schema.json>:

```json
{
  "payloadType": "https://discern.sh/schema/v1/discern-receipt-note.schema.json#/$defs/DiscernReceiptNotePayload",
  "payload": "<Base64-encoded payload bytes>",
  "signatures": []
}
```

The Base64 payload decodes to a UTF-8 JSON claim:

```json
{
  "subject": { "commit": "<full commit id>" },
  "receipt": { "branch": "…", "trunk": "…", "head": "…", "files_total": 1, "insertions": 1, "deletions": 0, "line": "…", "markdown": "…" }
}
```

## Contract

- `payloadType` identifies the payload contract and compatibility major.
- `payload` preserves the serialized claim. discern writes standard padded Base64. DSSE accepts standard and Base64url alphabets. discern also accepts omitted padding.
- `signatures` holds DSSE entries with a Base64 `sig` and optional `keyid`. A [standard signed envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) has at least one entry. discern's unsigned extension uses an empty array.

The decoded payload contains the full commit under `subject.commit`, the structured gate `receipt`, optional issuer assertions (`name`, `email`, and `key`), and the reserved optional `brief` reference for future provenance work.

## Signature and identity boundary

The future signature input follows [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md):

```text
PAE(UTF8(payloadType), decoded payload bytes)
```

Only the payload type and decoded payload bytes enter that message. Authenticated claims therefore belong inside the payload. A verifier uses those decoded bytes directly because parsing and serializing the JSON again could change them.

Discern does not sign or verify notes at v1.0.0. Adding a valid signature entry later produces the standard DSSE signed form without moving the payload. The signing profile will choose the algorithm, signature encoding, and key lookup.

Issuer fields assert what the payload claims. A verified signature shows that a signing key endorsed those bytes. A later trust policy binds that key to a person, agent, runner, or organization. The DSSE `keyid` field is an unauthenticated lookup hint.

## Reading rules

1. Require `subject.commit` and the receipt's abbreviated `head` to agree with the commit carrying the note.
2. Let unknown added fields pass at every envelope and payload level within v1.
3. Report an unknown `payloadType` as `data.landed_receipt_unsupported`.
4. Read a bare receipt with no `payloadType` as legacy unsigned evidence.

`data.landed_receipt` means the note is readable and commit-bound. This path performs no cryptographic verification.

## Where it lives in code

| Concern                     | Source                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Envelope, payload, issuer   | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                           |
| Writer, reader, cross-check | [`receipt_notes.ts`](../../../src/engine/gate/receipt_notes.ts)                        |
| Published schema            | [`discern-receipt-note.schema.json`](../../../schema/discern-receipt-note.schema.json) |
