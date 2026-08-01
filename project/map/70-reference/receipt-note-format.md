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

_The durable claim `discern accept` attaches to a landed commit, and the rules every reader follows._

A landing writes one note under `refs/notes/discern`. The note body is a compact JSON form of the Dead Simple Signing Envelope (DSSE) plus a newline, published at <https://discern.sh/schema/v1/discern-receipt-note.schema.json>:

```json
{
  "payloadType": "https://discern.sh/schema/v1/discern-receipt-note.schema.json#/$defs/DiscernReceiptNotePayload",
  "payload": "<Base64-encoded payload bytes>",
  "signatures": []
}
```

Decode `payload` from Base64 to read the UTF-8 JSON claim:

```json
{
  "subject": { "commit": "<full commit id>" },
  "receipt": {
    "branch": "…",
    "trunk": "…",
    "head": "…",
    "files_total": 1,
    "insertions": 1,
    "deletions": 0,
    "line": "…",
    "markdown": "…"
  }
}
```

## Envelope fields

- `payloadType` identifies the payload contract and its compatibility major. It is also part of the future signature input.
- `payload` preserves the claim's serialized bytes as Base64. Discern writes standard padded Base64. DSSE permits the standard and Base64url alphabets; discern readers also tolerate omitted padding.
- `signatures` holds standard DSSE signature entries. Each entry has a Base64 `sig` and may carry a `keyid` lookup hint. A [standard signed envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) has at least one entry. discern v1.0.0 writes an empty array as its unsigned extension.

The decoded payload holds:

- `subject.commit`, the full object id of the landed commit;
- `receipt`, the structured gate receipt with branch, trunk, abbreviated commit, diffstat, line, and page;
- optional `issuer`, identity details asserted inside the payload;
- optional `brief`, reserved for a signed-intent reference used by a future provenance feature.

## What a future signature covers

The envelope fixes the message a future signer will sign. Following [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md), the signature input is:

```text
PAE(UTF8(payloadType), decoded payload bytes)
```

The payload type and every payload byte form the authenticated message. No other outer-envelope field enters it, so future claims that need authentication belong inside the payload. A verifier feeds the decoded bytes from the envelope directly into verification. Parsing and serializing the JSON again could produce a different message. This lets later releases add a signer without changing the receipt claim or inventing a JSON canonicalization rule.

Discern does not sign or verify receipt notes at v1.0.0. The current `signatures` array is empty. Adding one or more real signature entries will produce the standard signed DSSE form without changing the payload bytes. A future signing profile will choose the algorithm, signature encoding, key lookup, and trust rules.

## Issuer assertions and identity

`issuer.name`, `issuer.email`, and `issuer.key` are claims inside the payload. Once a signature exists, successful verification will show that those claims have not changed since the signing key endorsed the payload. It will not, by itself, show that the key belongs to the named person, agent, runner, or organization.

That identity link belongs to a later trust policy. The DSSE `keyid` field is only a key-selection hint and is not authenticated. At v1.0.0, discern returns an issuer block when one is present. This read path performs no signature or identity verification.

## Reading rules

A consumer follows these rules:

1. Accept a current payload only when `subject.commit` equals the commit carrying the note. Its abbreviated receipt head must also agree.
2. Preserve the encoded payload bytes for signature verification. Unknown added fields may pass at every envelope and payload level within v1.
3. Report an unrecognized `payloadType` as unsupported evidence. `discern status` exposes it as `data.landed_receipt_unsupported`.
4. Read a bare receipt object with no `payloadType` as a legacy unsigned note.

`discern status` reports a readable, commit-bound trunk-tip note as `data.landed_receipt`. That result describes the note's structure and commit binding. This path performs no cryptographic verification.

## Where it lives in code

| Concern                     | Source                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Envelope, payload, issuer   | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                           |
| Writer, reader, cross-check | [`receipt_notes.ts`](../../../src/engine/gate/receipt_notes.ts)                        |
| Published schema            | [`discern-receipt-note.schema.json`](../../../schema/discern-receipt-note.schema.json) |
