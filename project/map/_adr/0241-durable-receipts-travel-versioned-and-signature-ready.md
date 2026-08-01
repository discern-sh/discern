# ADR 0241: The durable receipt travels as a versioned, signature-ready record

**Status**: accepted; amends the note-body decision of [ADR 0215](0215-landing-receipts-travel-as-git-notes.md), applies the contract discipline of [ADR 0208](0208-public-contracts-version-by-schema-major.md) to a channel it deliberately excluded, and leaves the receipt derivation and relay contract of [ADR 0114](0114-the-gate-emits-the-receipt.md) / [ADR 0188](0188-the-receipt-relays-as-one-line.md) unchanged.

## Context

"Receipt" names three artifacts with different lifetimes. The gate receipt marker and the standard-measurement receipt are worktree-local caches, written and read by the same binary within one worktree's life. The landed receipt note (ADR 0215) is different: it survives worktree cleanup, travels between clones over opt-in fetch transport, and the release that reads it is often not the release that wrote it. It is a wire format — but the implementation treated it as another runtime object:

- The note body was the bare canonical JSON of the 8-field runtime `Receipt`, with no format identity, no issuer, no signature room, and no room to reference anything else.
- `parseReceiptNote` validated it with the **strict** runtime `ReceiptSchema`, so the first additive field a newer binary wrote would make an older binary reject the whole note — violating the additive-tolerance rule of ADR 0208 exactly where mixed-version readers are the expected case.
- `Receipt.head` is a fixed 12-character abbreviation chosen for display. The durable record carried no full object id, and the reader accepted any note whose abbreviated head merely prefixed the annotated commit.

ADR 0208 rejected an in-payload version field for results because a CLI or MCP caller already selects a published schema — the `$id` is the identity, and repeating it per payload adds nothing. A Git note has no such selection channel: nobody negotiates a schema before `git notes show`. The durable bytes are the only place their own identity can live.

The append-only compatibility ratchet arms at the first release tag, so this is the last free moment to change the durable format. Two anticipated consumers shape what "signature-ready" must mean: signed receipts after the owner provisions a signing identity (anticipated by ADR 0215), and a post-launch authorship-chain feature that will thread a signed record of human intent through execution, verification, and landing — the receipt is its verification link and needs a slot to reference the intent artifact.

## Decision

**Acceptance records the landed receipt as a self-describing wrapper record, versioned by the published schema identity it carries in-band, with optional issuer, signature, and intent-reference fields whose absence means unsigned.**

The note body is one JSON object plus a trailing newline:

- `format` — the published schema `$id`, `https://discern.sh/schema/v1/discern-receipt-note.schema.json`. This is not the payload version field ADR 0208 rejected: it is the **same** identity that record makes authoritative, delivered through the only channel a durable artifact has. The `/v1/` path segment is the compatibility major.
- `subject` — the binding to the exact validated commit: `subject.commit` is the **full** object id. The runtime receipt keeps its 12-character `head` for display; the durable subject is never abbreviated.
- `receipt` — the unchanged 8-field structured receipt (branch, trunk, abbreviated head, diffstat, line, markdown), exactly what `data.receipt` carries in the result envelope.
- `issuer`, `signature` — optional. Absence means unsigned; a legacy bare note reads as unsigned with no issuer. Nothing writes them at v1.0.0; they reserve where a signing identity and its signature travel so signing can arrive within this major.
- `brief` — optional, reserved. A reference to a signed intent artifact for the post-launch authorship chain. Nothing writes it at v1.0.0; the published format definition documents it as reserved.

**The durable reader is tolerant; the writer stays strict.** A note whose `format` equals the current identity parses tolerantly — unknown fields pass at every level, so an older v1 binary reads every newer v1 note. A note carrying any other `format` value yields an explicit `unsupported` reading that names the format (`status` reports it); it is never a crash and never silently "no receipt". A note with no `format` field parses as today's bare 8-field receipt and reads as unsigned legacy. This is the same strict-runtime/tolerant-consumer split ADR 0208 established for results, applied at the seam that needed it most.

**The subject is cross-checked at both ends.** The writer refuses to record a receipt whose abbreviated head does not prefix the commit it is annotating. The reader accepts a v1 note only when `subject.commit` equals the annotated commit exactly (legacy notes keep the prefix check — the strongest binding their bytes allow).

**The format becomes its own published contract.** `schema/discern-receipt-note.schema.json`, served at its `$id`, joins `PUBLIC_SCHEMA_PUBLICATIONS` under the additive result-output policy: the artifact derives from the same Zod source as the runtime schema, permits unknown fields as the reader does, and a breaking change to the note format is a new major path — mirrored in-band by a new `format` value that old readers report as `unsupported`. The receipt object itself becomes the named `DiscernReceipt` definition inside the results schema, referenced by every contract that carries one instead of inlined per contract. It does not get a second standalone `$id`: the results contract owns the receipt's identity inside results, and the note schema embeds its own copy so a note consumer reads one self-contained definition.

Explicitly **not** decided here: no signing implementation, no key management, no verification verb, no trust policy, and no adoption of the in-toto/DSSE statement shape today. When signing is built it must define its byte coverage so that a v1 reader can keep ignoring the fields it does not verify; if it instead needs an enveloped byte-exact payload (DSSE), that is a new format major, dispatched in-band like any other.

## Consequences

- A mixed-version clone reads forward: older v1 binaries accept newer v1 notes, and a genuinely unreadable future note is reported as such instead of vanishing.
- A third party can build a receipt consumer from the published definition alone: the format tells them what they hold, the subject names the exact commit, and the issuer/signature fields define where "who issued this" will be proven once signing writes them.
- Legacy bare notes remain readable forever under this major, honestly labelled unsigned; nothing rewrites them.
- Local behaviour is unchanged: the marker, the fast path, the rendered line and page, and `data.receipt` in result envelopes are byte-identical to before. Only the durable bytes and their reader changed.
- The receipt shape is now generated into two artifacts from one Zod source. The codegen and compatibility guards hold them together; the cost is two published copies to re-generate on any receipt change.
- The `unsupported` reading depends on future majors keeping the in-band identity discipline: a hypothetical writer that dropped `format` would be read as a malformed legacy note, not a newer major.

## Alternatives considered

- **Add a version field to the bare receipt object.** Rejected: it conflates the runtime result member with the wire record (the runtime `Receipt` would carry a wire-format fact into every result envelope), and it leaves signature and issuer inside the object a future signature must cover, forcing a canonicalization scheme before any signing design exists. The wrapper keeps the claim, its binding, and its future endorsement separable.
- **Adopt the in-toto Statement v1 + DSSE shape now.** Rejected for launch: its value — byte-exact signing and third-party attestation tooling — arrives only with signatures, which are out of scope, and an unsigned statement in attestation clothing reads as more proof than it is. The in-band major leaves that door open: a signed DSSE record can arrive later as its own format, and the predicate content defined here maps onto one.
- **Reuse the results schema `$id` as the note's identity.** Rejected: the note is a separate compatibility domain. Results are selected per invocation by a caller who can be told to upgrade; notes are read from durable history with no negotiation, so their major must be free to move independently of result-contract majors.
- **A compact format string (`gate-receipt/v1`) instead of the schema `$id`.** Rejected: it mints a second identity for the same contract and forces every consumer to learn the mapping to the published definition. The `$id` is one identity that both names the major and locates the definition.
