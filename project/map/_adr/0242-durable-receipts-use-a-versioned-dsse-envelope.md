# ADR 0242: Durable receipts use a versioned DSSE-compatible envelope

**Status**: accepted; amends the note-body decision of [ADR 0215](0215-landing-receipts-travel-as-git-notes.md), applies the contract discipline of [ADR 0208](0208-public-contracts-version-by-schema-major.md) to a channel it deliberately excluded, and leaves the receipt derivation and relay contract of [ADR 0114](0114-the-gate-emits-the-receipt.md) / [ADR 0188](0188-the-receipt-relays-as-one-line.md) unchanged. The frozen identifiers — the schema id, the payload type, and the payload's `proof` field — carry the artifact's successor name from [ADR 0245](0245-receipt-renamed-to-proof.md), landed ahead of the product-wide rename sweep so the durable bytes never need a second identity; this record otherwise keeps the receipt vocabulary current at its writing.

## Context

"Receipt" names three artifacts with different lifetimes. The gate receipt marker and standard-measurement receipt are worktree-local caches. The landed receipt note survives worktree cleanup, travels between clones, and may be read by a different discern release. It is a wire format, but it began as the bare canonical JSON of the strict 8-field runtime `Receipt`: no format identity, no full object id, and no signing boundary.

The first versioned design wrapped that receipt with `format`, `subject`, and optional `issuer` / `signature` fields. That reserved storage without defining a signature protocol. A signature acts on bytes, while equivalent JSON objects may differ in key order, whitespace, or escaping. Omitting the signature value before signing would also need a canonical projection. A third party could locate a signature in the wrapper but could not reconstruct the message it endorsed.

The append-only compatibility ratchet arms at the first release tag. Signing implementation, key management, and the post-launch authorship chain remain outside launch scope, but the byte boundary cannot wait without turning the first signed receipt into a format migration.

## Decision

**Acceptance records the landed receipt as a DSSE-compatible JSON envelope whose payload bytes are preserved in the note.** The note body is one compact JSON object plus a trailing newline:

- `payloadType` is `https://discern.sh/schema/v1/discern-proof-note.schema.json#/$defs/DiscernProofNotePayload`. It identifies the UTF-8 JSON payload contract and is the in-band compatibility-major identity.
- `payload` is Base64 of the serialized payload bytes. Current writers use standard padded Base64; readers accept the standard and URL-safe alphabets and also tolerate omitted padding. A verifier uses the decoded bytes and never reconstructs them from parsed JSON.
- `signatures` is an array of DSSE signature entries. Each entry has the required Base64 `sig` and optional `keyid`. The [standard DSSE JSON envelope](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md) requires at least one signature. Discern v1.0.0 writes an empty array as its unsigned extension. Adding one or more real entries produces the standard signed form without moving the payload.

The payload contains `subject`, `proof` (the structured gate record), and the optional `issuer` and `brief` fields. `subject.commit` is the full object id of the validated landed commit. The writer checks it against the record's abbreviated display head; the reader requires it to equal the commit carrying the Git note.

The signature input follows [DSSE protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md): `PAE(UTF8(payloadType), decoded payload bytes)`. The payload type and every payload field are therefore covered, including unknown future fields, the commit subject, an issuer assertion, and a brief reference. No other outer-envelope field enters the signature input, so future authenticated claims belong inside the payload. No JSON canonicalization is involved.

`issuer` is an assertion inside the signed payload. A verified signature prevents alteration of that assertion and proves possession of a verification key. It does not prove that the key belongs to the named person, agent, runner, or organization. The DSSE `keyid` field remains an unauthenticated key-selection hint. A future signing profile and trust policy define algorithm, signature encoding, key resolution, identity binding, rotation, revocation, and acceptance rules.

The runtime writer is strict and the durable reader is tolerant. Unknown fields pass at every envelope and payload level within v1. An unrecognized `payloadType` yields an explicit `unsupported` reading. A bare 8-field receipt with no `payloadType` remains a legacy unsigned note. The parser currently reads signatures as opaque data and performs no cryptographic verification; `valid` means the payload is readable and bound to its Git commit.

The envelope and decoded payload definition publish together at `schema/discern-proof-note.schema.json`. The payload type points into that publication, and code generation derives the artifact from the Zod schemas. Breaking changes move to a new major path and payload type.

Explicitly not decided here: no signing command, verification verb, signing profile, trust configuration, key management, signature threshold, ledger, in-toto statement, or authorship-chain behavior. The `brief` field only reserves the receipt's signed reference to that future artifact.

## Consequences

- A signer can arrive after v1.0.0 by adding standard DSSE signature entries over the bytes already carried by every current envelope. That turns discern's unsigned extension into the standard signed form; the receipt claim does not move.
- A third party can recover the signature input and identify the key that verified it. Calling that key a trusted human or service requires the later signing profile and the trust policy used by the verifier.
- Unsigned notes are less pleasant to inspect directly because the receipt payload is Base64. `discern status` remains the human reader, and local gate output does not change.
- Unknown compatible payload fields remain authenticated because the envelope preserves their original bytes, even when an older reader ignores them after parsing.
- Legacy bare notes remain readable. The unlanded wrapper draft has no compatibility claim and is replaced before v1.
- The result schema still carries the named `DiscernProof` definition. The note schema embeds the same generated definition, plus the payload contract and DSSE envelope.

## Alternatives considered

- **Keep the wrapper with optional `scheme` / `value`.** Rejected: it reserves field names while leaving the signed projection and byte encoding undefined. A later DSSE adoption would require a new format major.
- **Sign canonical JSON with RFC 8785.** Rejected: discern would own a canonicalization dependency and a rule for removing or retaining signature metadata. DSSE preserves and signs the payload bytes directly.
- **Adopt an in-toto Statement as the payload now.** Rejected: the receipt already has a published subject-and-claim contract, while the wider human-and-agent provenance model remains post-launch work. DSSE standardizes the cryptographic boundary without pre-committing that model.
- **Keep both `format` and `payloadType`.** Rejected: they would duplicate the compatibility identity, and only `payloadType` is authenticated by DSSE.
