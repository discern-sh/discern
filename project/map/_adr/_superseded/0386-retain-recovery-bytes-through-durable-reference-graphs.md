# ADR 0386: Retain recovery bytes through durable reference graphs

> **Superseded by [ADR 0389](../0389-the-workspace-contract.md).** Temporary execution, capture, restoration, and reclamation retired with the borrowed substrate; no recovery bytes are captured, so the durable reference graph and its storage lease have no subject.

**Status**: superseded by [ADR 0389](../0389-the-workspace-contract.md) on 2026-09-12; previously accepted

## Context

Source validation runs producers in the authored checkout. Requiring restoration payloads for that execution makes unrelated local data and repository boundaries admission conditions. Temporary execution does need preservation before it changes a checkout. Repeated snapshots can retain the same large ignored files many times; ignored status does not establish that those bytes can be regenerated.

A successful restoration can remove candidate drift just as an interrupted restoration can. Captures need durable references before those effects. Cleanup also needs historical landing and recovery references, while payload observation cannot occupy the shared publication lock.

## Decision

Source execution observes attachment and index semantics without installing a candidate or capturing restoration bytes. Producers observe their demanded input closure, dependencies, extractors and extent denominators. Partial observation retains the complete requirement identity and cannot assemble complete Proof. The existing shared producer and test capacity policy remains in force.

Recovery manifests refer to immutable, streamed payloads by digest and byte count. Repeated content shares storage. Native recovery retains exact index bytes; source and release observations cannot authorize restoration. Each execution publishes its intent and subsequent required captures into environment revision history before destructive effects. The completion envelope advances to version 4; reviewed older envelopes remain readable without inventing capture references.

Reclamation requires complete current and historical records, known artifact contracts and a closed reference graph. Older attempts with implicit recovery references remain retained. Writers share a storage lease through durable reference publication. Inventory runs under shared storage access, then a bounded deletion batch acquires exclusive access. Under the common lock it checks the publication witness and invalidates that witness before deleting parents ahead of children. Record and manifest publishers invalidate the same witness before mutation. Unknown state cannot grant deletion.

## Alternatives

Inline aggregate snapshots duplicate unchanged bytes and require memory proportional to the complete payload. Age-based expiry or ignored-file regeneration would discard data without an ownership or regeneration contract. Holding the common lock for capture avoids a publication race but blocks unrelated short publications. Streamed content storage, explicit references and revision rechecks preserve those guarantees with bounded working memory and brief common-lock work.

## Consequences

Retained payload storage grows with distinct required bytes rather than repeated captures of unchanged files. Fixed buffers and metadata limits bound observation memory. Required historical bytes have no age-based expiry; distinct required content can still grow storage. Limits and unsupported preservation retain the checkout for reconciliation instead of authorizing deletion.

Hashing and streaming cost additional file reads. The witness adds a small durable write to publication, while large observations stay outside the common lock. Interrupted deletion leaves a closed remaining graph. Retirement callers must hold the storage lease until their reference is durable, then invoke the tested reclamation interface after retirement authority is settled.

The map's execution-storage page described the source, recovery and retirement boundaries; it retired with this record.
