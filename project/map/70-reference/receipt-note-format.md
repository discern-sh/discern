---
title: Receipt note format
description: The durable receipt record attached to a landed commit — its fields, its published schema, and its reading rules.
order: 35
aliases:
  - receipt format
  - receipt note schema
  - durable receipt
  - receipt subject
---

# Receipt note format

_The exact record `discern accept` attaches to a landed commit, and the rules any reader must follow._

A landing writes one note under `refs/notes/discern`. The note body is one line of JSON plus a newline, published at <https://discern.sh/schema/v1/discern-receipt-note.schema.json>:

```json
{
  "format": "https://discern.sh/schema/v1/discern-receipt-note.schema.json",
  "subject": { "commit": "<full commit id>" },
  "receipt": { "branch": "…", "trunk": "…", "head": "…", "files_total": 1, "insertions": 1, "deletions": 0, "line": "…", "markdown": "…" }
}
```

## Fields

- `format` — the published schema identity, carried in the bytes. The release that reads a note is often not the release that wrote it, so the record names its own contract. The `/v1/` path segment is the compatibility major.
- `subject.commit` — the full id of the landed commit. The receipt's short `head` stays for display.
- `receipt` — the same structured receipt `data.receipt` carries after a green gate: branch, trunk, short commit, diffstat, one-line summary, and the page.
- `issuer` and `signature` — reserved for signing. Absence means unsigned, which is every note discern writes today. `issuer` names who issued the record; `signature` carries a `scheme` and a `value`.
- `brief` — reserved for a reference to a signed record of intent. Nothing writes it yet.

## Reading rules

A consumer follows four rules, and the published schema states them beside the fields:

1. Accept a note only when `subject.commit` equals the commit the note annotates.
2. Let unknown added fields pass. Same-major releases only add optional fields, so an older reader reads every newer note.
3. Report an unrecognized `format` value as unsupported evidence. `discern status` reports that case as `data.landed_receipt_unsupported`, naming the format.
4. Read a bare receipt object with no `format` field as a legacy unsigned note from an older discern.

`discern status` reports a valid trunk-tip note as `data.landed_receipt`: the commit, the source ref, the receipt, and the issuer when the record carries one.

## Where it lives in code

| Concern                     | Source                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Record shape and tolerance  | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                           |
| Writer, reader, cross-check | [`receipt_notes.ts`](../../../src/engine/gate/receipt_notes.ts)                        |
| Published schema            | [`discern-receipt-note.schema.json`](../../../schema/discern-receipt-note.schema.json) |
