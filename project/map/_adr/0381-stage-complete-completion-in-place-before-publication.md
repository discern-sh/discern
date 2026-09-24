# ADR 0381: Stage complete completion in place before publication

**Status**: accepted. A current Proof note carries no separate authority field: the landing's consent, variances, and approved standard limits travel in its `acceptance` block, and a note is stale only when it lacks `proof.completion`.

## Context

Complete completion requires candidate, source, procedure, component, executor and settled authority facts. The repository has no predecessor release publication. [ADR 0208](0208-public-contracts-version-by-schema-major.md) makes untagged trunk provisional and requires the first publication to start at major 1.

## Decision

The configuration, setup, result, CLI, MCP, conventions and Proof-note publications remain at major 1. Their generated artifacts change in place under the root `schema/` directory. No second major, historical schema publication, or prelaunch install migration is introduced. The install schema remains 1 with an empty migration registry; private prelaunch installs receive explicit configuration edits.

The Proof-note public major is bound to the on-disk format version: `PROOF_NOTE_SCHEMA_MAJOR` derives from `ON_DISK_FORMATS.proofNote.version`. The DSSE payload type names that major's published payload definition. Both remain at 1; the unsigned envelope and its original payload bytes are preserved.

Current Proof notes require complete candidate evidence and settled source authority when acceptance is recorded. Prelaunch notes missing those fields are stale. Readers report that absence without filling fields, converting the note, or treating it as current authority. Invalid or substituted current facts remain invalid. No separate public schema describes an incomplete note.

Interrupted-landing recovery preserves its recorded expected-to-target transition and authority settlement. Retrying that recovery cannot start a new legacy landing or spend authority twice. This retained recovery does not establish a historical public-schema contract.

The compatibility guard requires major 1 for every registered publication whenever no predecessor publication exists, including the first release tag at `HEAD`. After publication, the existing tagged compatibility comparison applies.

## Consequences

The first release has one coherent version-one contract. Code generation and references use one publication registry. Existing incomplete evidence cannot become authority merely because its payload type still names v1. Private install edits preserve commands, inputs and limits while removing obsolete measurement deferrals; later public migrations start from the released schema-one baseline.
