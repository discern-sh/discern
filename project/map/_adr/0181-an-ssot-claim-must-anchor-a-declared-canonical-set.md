# ADR 0181: An SSOT claim must anchor a declared canonical set

**Status**: accepted; extends the meta-registry contract ([ADR 0176](0176-the-closed-sets-are-a-closed-set.md)).

## Context

[ADR 0176](0176-the-closed-sets-are-a-closed-set.md) holds the canonical-set discipline to the repository in both directions, but its reverse sweeps see only the pattern's conventional footprint: guard tests matching five filename suffixes, codegen write targets, and formerly the fmt-exclusions. The decision named the hole honestly — a registry that grows none of that footprint is invisible to the sweeps. A July 2026 audit proved the hole real rather than theoretical: eight canonical sets lived outside the registry precisely because their class tests are named outside the convention (`patterns_test.ts`, `improve_catalog_test.ts`, `engine_consent_gate_test.ts`, and kin). The audit enrolled the instances; nothing closed the class, and a ninth escape was a matter of time.

The escape route has a signature. Every registry in this codebase announces itself in its doc comments — "the single source of truth for …", "the SSOT for …" — because the announcement is how an author tells the next reader not to fork the set. That is the one footprint a registry grows at the moment it is born, before any test or artifact exists, and it is authored intent rather than inferred shape.

## Decision

**The claim itself is the enrolment trigger.** A gate sweep (`tests/ssot_claim_guard_test.ts`, named inside the suffix convention so the existing reverse sweep polices it) scans the authored-TypeScript universe (`AUTHORED_TS_FILES`). A module whose module-level or export-attached doc blocks claim single-source-of-truth status for the module's own exports must be exactly one of two things: some entry's `source.module` in `scripts/canonical_sets.ts`, or a recorded absence in the new `UNAFFILIATED_SETS` ledger — module path (or `path#EXPORT`) to reason, mirroring `UNAFFILIATED_GUARDS`, rendered in the registry atlas beside the other unaffiliated records.

The matcher is conservative by construction. It fires on three claim shapes — predicative ("the SSOT for the mode vocabulary"), appositive after an em-dash ("The kit version — single source of truth."), and copular ("this table is the single source of truth") — and never on reference forms: a parenthetical aside ("iterates KNOWN_JOBS (the SSOT)"), a possessive holder ("the config's single source of truth"), or a sentence naming another module. Test files are excluded; their prose describes the sets they guard, never sets they own. Controls hold each shape and each veto, both sweep directions, and the staleness of every ledger record — a record whose module no longer exists, no longer claims, or lost its named export fails the gate. An anti-rot floor pins the matcher to the enrolled registries' own live claims, so it cannot silently go blind.

The explicit noes: the sweep reads claim text only — it never imports, executes, or shape-analyzes a scanned module, and ADR 0176's rejection of registry-shaped-export detection stands. There is no denylist of the phrase, and rewording a comment to dodge the sweep is the one move this decision forbids culturally: the honest answer to a fired claim is a declaration or a recorded reason, never quieter prose.

## Consequences

- The blind spot that let eight sets escape is structurally closed at its cheapest point: the next author who writes "single source of truth" above a new registry is stopped by the gate until the registry is declared or its absence reasoned. Enrolment friction lands exactly when the set is born.
- The residual is named: a claim phrased outside the three shapes, made in a line comment, or never written at all evades the sweep. The suffix conventions, the codegen chokepoint, and authoring discipline remain the other legs; this adds the earliest tripwire, not a replacement.
- Claim prose becomes load-bearing. Rewording a recorded module's doc comment can stale its ledger record, and the gate fails until the record follows. That is deliberate — records may never rot — but it makes comment edits on recorded modules slightly costlier.
- The first population surfaced two records that are enrolment debts, not settled absences: `src/engine/worktree/side_restrictions.ts` and `src/shared/git_admin_state.ts` are true registries whose class tests are named outside the convention. They are recorded as candidates for enrolment; declaring them is an owner decision for a later change.

## Alternatives considered

- **Widen the suffix conventions, or rename the eight escaped tests into them.** Rejected: renames churn test history for no behavioral gain, and the next author who names a class test naturally (`patterns_test.ts`) re-opens the hole. The convention polices names, and names are exactly what escaped.
- **Sweep for registry-shaped exports.** Already rejected by ADR 0176, and the reasons hold: `export const X = […] as const` is shape, not intent, and false enrolment demands teach authors to game the detector.
- **A structured annotation instead of prose matching.** A tag would be precise, but it is a second vocabulary to teach, migrate onto, and police — and its absence is as silent as the hole it replaces. The prose claim already exists in every registry written to date; reading it costs authors nothing.
