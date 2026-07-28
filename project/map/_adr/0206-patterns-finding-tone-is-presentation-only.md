# ADR 0206: Patterns finding tone is presentation only

**Status**: accepted

## Context

`discern patterns` reports facts and recommended next steps from the local logbook. Its findings previously offered no machine-readable distinction between sustained standard headroom, an informational cohort comparison, and a repeated gate failure. The human report therefore rendered favorable and concerning evidence alike.

[ADR 0063](0063-doctor-execution-model.md) requires discern to report facts without turning them into judgments. [ADR 0160](0160-local-logbook-advisory-readers.md) also fixes every logbook reader as advisory: a finding cannot affect a command outcome or the gate. A presentation field could violate either decision if it became a severity score, a ranking input, persisted state, or an enforcement signal.

The detector authors already hold the facts needed for the distinction. Standard trajectory detection knows each reading's direction and limit, while the human renderer does not. Deriving the distinction in the renderer would duplicate detector policy and would be impossible for some findings from the wire data available before this change.

## Decision

Every patterns finding carries a required `tone`: `good`, `neutral`, or `attention`. Tone is deterministic presentation metadata derived from the same recorded facts as `observed` and `evidence`. Each detector declares a default. A finding overrides that default when its own facts decide, as standard trajectory findings do from direction-aware movement and sustained headroom.

Detectors for repeated workflow failures and gate pathologies default to `attention`. Informational inventory and cohort-comparison detectors default to `neutral`, because comparison alone implies no verdict. Standard trajectories derive their tone per finding.

Tone is additive to the plain-count evidence. It is computed when the logbook is read and is never stored. `strength` remains the only ranking key. Tone never sorts findings, changes a gate or verb outcome, triggers an effect, or feeds a standard.

Each finding also carries a required one-line `brief`, authored beside its full observation. Numeric prose is formatted at that authoring boundary so the compact and full forms use the same readable values. The tone and detector-family vocabularies are canonical sets; schemas, detector declarations, tests, and renderers derive from them.

## Consequences

- Human renderers can distinguish favorable, neutral, and attention-worthy evidence without reconstructing detector policy.
- JSON and MCP consumers receive the same additive metadata while retaining the original evidence, ordering, and advisory boundary.
- A new detector must choose a default tone and author a brief for every finding. Registry-driven tests enroll it in that obligation.
- Three values deliberately compress nuance. The evidence and observation remain authoritative when a reader needs the detail behind a glyph or color.

## Alternatives considered

- **Infer tone in the renderer.** Rejected because the renderer lacks direction-aware limit history and would become a second policy authority.
- **Add severity levels or a score.** Rejected because severity invites sorting and enforcement, which conflicts with the facts-only and advisory decisions.
- **Keep one visual treatment for every finding.** Rejected because favorable standard movement then remains indistinguishable from a recurring failure in the human report.
