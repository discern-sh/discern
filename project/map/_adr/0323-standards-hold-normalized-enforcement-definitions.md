# ADR 0323: Standards hold normalized enforcement definitions

**Status**: accepted. Extends the always-on trunk comparison in [ADR 0133](0133-standards-join-the-gate.md) and keeps the breach escalation in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md) separate.

## Context

A Standard holds a number only because that number refers to a stable quality claim. The trunk comparison originally protected the numeric `limit` and deletion, but it interpreted that limit with the branch's `direction` and ignored every other field. A branch could keep the same number while turning a floor into a ceiling, choosing another emitted metric or command, changing a rate's denominator or units, deferring measurement, or narrowing the inputs that require fresh evidence. The number remained visibly held while its meaning moved.

Comparing a Standard table as text would close that hole at the cost of false changes. The current schema supplies defaults, and command fields accept equivalent scalar and list forms. The trunk may also carry an older schema that the current full parser cannot validate. Some fields deliberately do not define the current claim: `margin` affects only a future pin, while `timeout` affects whether an identical measurement finishes within its execution budget.

The field authority is the inferred `StandardConfig` type. A policy that separately copies its keys would create the same drift risk this decision is intended to remove.

## Decision

**An existing Standard holds its normalized enforcement definition as well as its monotonic bound.**

`STANDARD_DEFINITION_POLICIES` is a total projection over `keyof StandardConfig`. Every field has one of three policies and a reason:

- `limit` is the **monotonic bound**. A floor may only rise and a ceiling may only fall.
- `metric`, `direction`, `run`, `per`, `scale`, `measure`, and `inputs` are **enforcement meaning**. They determine what is measured, its units and ordering, or when evidence must be refreshed.
- `margin` and `timeout` are **execution or pinning policy**, not enforcement meaning. `margin` changes only a later `standards --pin` target; it does not change the current measurement or verdict. `timeout` changes the allowed runtime, but not the command's claim or value. A timeout fails explicitly and produces no green evidence.

The type projection makes a new `StandardConfig` field a compile-time demand for a policy decision. The normalized branch and trunk projections are total over the same type, so a new field also requires an explicit normalization choice.

Tier 1 compares enforcement meaning before comparing numbers. It applies current schema defaults on the branch and the same semantic defaults to omitted historical trunk fields. It compares commands through the shared normalized command-list form rather than a rendered shell string, and normalizes scalar and list denominator spellings. The trunk remains a tolerant raw read: a syntactically valid older config need not satisfy today's complete schema.

Only definitions that compare equal reach the numeric check. The numeric check receives both directions and refuses to order the bounds when they differ; the branch can never reinterpret the trunk's floor as a ceiling or the reverse. A Standard new on the branch still passes vacuously, a tighter bound still passes, and deleting a trunk Standard still fails.

A definition change fails before measurement. Its diagnostic names the Standard and every changed field, shows bounded old and new values, and distinguishes redefinition from a measured breach. There is no branch reason, magic comment, or standing bypass. To redefine or recalibrate intentionally, the owner approves the old and new meanings, the definition changes on trunk, and the worktree runs `discern update`. A future one-shot measured-breach override cannot waive this check.

## Consequences

- A held limit now vouches for the same numerator, command, rate, units, direction, measurement cadence, and replay boundary as trunk.
- Default-equivalent config and scalar-versus-singleton command forms do not create false redefinitions. Historical trunk config stays readable without weakening the comparison for known fields.
- Ordinary branches may add Standards, tighten limits, tune a measurement's timeout, or change future pinning headroom. Changing timeout can still turn a slow run from failure to completion; that execution choice is visible in the run rather than a silent change to a green claim.
- Intentional definition changes take a trunk transition and then flow into worktrees through the normal update path. This makes the old and new meanings visible in one owner-controlled history.
- The result envelope retains its existing `standards_limits` vocabulary and `loosened` status for compatibility; per-Standard diagnostics distinguish redefinition, bound loosening, and deletion.

## Alternatives considered

- **Compare the serialized Standard table.** Rejected because omitted defaults and equivalent command forms would fail, while harmless `margin` and `timeout` changes would require owner-controlled redefinition.
- **Protect only `direction` in addition to `limit`.** Rejected because every other meaning-bearing field can change the quality claim or freshness of its evidence.
- **Treat every field as enforcement meaning.** Rejected because current enforcement does not depend on future pin headroom, and execution timeout failures are already explicit rather than green evidence with a changed meaning.
- **Allow a branch-local waiver or reason.** Rejected because a persistent or locally authored escape hatch would let the branch redefine the claim it is meant to prove. Measured breaches and definition changes require different owner decisions.
