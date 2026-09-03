# ADR 0333: Proof-note replay uses stable claim identity

> **Launch-format amendment (2026-09-03):** replay identity applies only to the current split v1 envelope with its explicit subject. The bare private-development reader and implied-subject rule were retired before v1; the stable-claim identity and first-presentation behavior stand.

**Status**: accepted. Refines the durable Proof projection in [ADR 0253](0253-durable-proofs-project-runtime-receipts.md) and the Git-note transport in [ADR 0215](0215-landing-receipts-travel-as-git-notes.md).

## Context

A Proof note separates the machine-readable claim from presentation. The claim identifies the branch, trunk, landed commit, diff counts, mode, and checkpoint drops. Presentation carries the proof line and Markdown page. The durable claim excludes runtime telemetry, and rendering can change without changing what the Gate proved.

The note writer's replay check compared the full canonical Proof. A repeated landing-note write for the same commit and machine claim could therefore conflict after line wording, Markdown layout, or timing fields changed. Rewriting the note would discard the original durable record, while treating every note on the commit as equivalent would hide a changed claim.

Legacy bare notes add another compatibility boundary. They have no explicit subject block because Git already attaches the note to a commit.

## Decision

**An existing Proof note has the same write identity when its subject commit and `canonicalProofClaim` match the proposed note.**

Presentation is outside replay identity. A retry with changed line text, Markdown, or runtime telemetry returns `already_present` and leaves the existing note bytes unchanged. A current envelope's `subject.commit` must equal the annotated commit. A legacy bare note uses its annotated commit as the implied subject.

A different stable claim on the same commit remains `record_failed` with the existing-note conflict. The writer does not overwrite, merge, or replace that record. The Dead Simple Signing Envelope (DSSE) payload still carries presentation, and a future signature still authenticates the serialized payload bytes. Replay identity only decides whether another write represents the same durable claim.

## Consequences

- Retrying note recording is idempotent across display and timing changes.
- The first durable presentation remains attached to the commit. A later renderer does not rewrite historical bytes.
- A changed machine claim cannot hide behind the same subject commit.
- Legacy notes participate in the same identity rule without a migration.
- Tests must cover current envelopes, legacy notes, presentation changes, and stable-claim differences.

## Alternatives considered

- **Compare the complete serialized note.** Rejected because presentation and telemetry can change while the Gate claim stays the same.
- **Use only the subject commit.** Rejected because two different claims for one commit would become indistinguishable.
- **Force-rewrite a note when presentation changes.** Rejected because another clone may already have fetched or published the durable record.
