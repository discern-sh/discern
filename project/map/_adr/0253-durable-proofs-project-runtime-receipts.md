# ADR 0253: Durable proofs project runtime receipts

**Status**: accepted; amends the payload decision in [ADR 0242](0242-durable-receipts-use-a-versioned-dsse-envelope.md) before the first release tag

## Context

The DSSE payload originally placed the strict runtime `Receipt` object under `proof`. That made the live result schema and the durable wire contract one object: adding an optional runtime field also added a field to the bytes a future signer would endorse.

Slot-wait accounting exposed the coupling. `waited_ms` explains how long one invocation spent queued behind the repository's test-run cap. It belongs in the result envelope, the logbook, and live output. It says nothing about which tree passed, what the gate checked, or whether a verifier should accept the proof. The same receipt object also carries `line` and `markdown`, which are human renderings rather than verification inputs.

Discern has no release tags, so [ADR 0208](0208-public-contracts-version-by-schema-major.md) still permits an in-place correction to the v1 publication. Notes already written by development builds should remain readable.

## Decision

**The durable proof payload is an explicit projection of the runtime receipt.** Its current writer carries:

- `subject`, with the full landed commit;
- `proof`, a `DiscernProofClaim` containing branch and trunk labels, the abbreviated validated head, and whole-diff statistics;
- `presentation`, a `DiscernProofPresentation` containing the line and Markdown page;
- optional `issuer` and `brief` claims.

`presentation` remains inside the DSSE payload, so a future signature protects its bytes. Verification policy treats it as non-authoritative and never parses it for proof facts.

Runtime telemetry does not enter either durable block. `waited_ms` stays in the top-level command result and logbook event, and positive waits render beside the live run summary. The receipt line, receipt page, and durable note omit it.

The canonical writer projects each durable block field by field. The tolerant reader also accepts the pre-correction layout, where presentation lived inside `proof`, and drops unknown runtime fields while reconstructing the live receipt. A schema guard fixes the durable field sets and rejects a fresh-named extra field, so later result additions cannot widen the proof contract through reuse.

The v1 schema id and `payloadType` do not change. This correction happens before the compatibility ratchet arms at the first release tag.

## Consequences

- Runtime results and operational telemetry can evolve without changing the durable proof claim.
- Proof facts and human presentation have distinct schemas and verification roles.
- Development notes written before this correction continue to read. A pre-correction binary cannot read the corrected payload, which is accepted before the first release.
- Adding a durable proof fact now requires an explicit schema and canonical-projection change. It cannot arrive as a side effect of a receipt-field addition.
- The payload still carries human presentation for cross-clone inspection. Its bytes are authenticated when signatures arrive, but they never decide verification.

## Alternatives considered

- **Keep `ReceiptSchema` as the proof claim and exclude only `waited_ms`.** Rejected because the next runtime-only field would recreate the same leak.
- **Sign only the structured claim and discard presentation after landing.** Rejected because `discern status --verbose` must retain the gate-authored page across worktree cleanup and clones.
- **Move presentation outside the DSSE envelope.** Rejected because an unsigned rendering could contradict the authenticated claim. Keeping it as a separate payload block preserves integrity without making it authoritative.
