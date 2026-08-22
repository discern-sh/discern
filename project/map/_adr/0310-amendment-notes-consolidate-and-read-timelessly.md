# ADR 0310: Amendment notes consolidate into one timeless block, and supersession hygiene is gate-enforced

**Status**: accepted. Applies the forcing-function discipline of [ADR 0051](0051-canonical-set-parity.md) to the decision archive itself, joining the number-uniqueness guard of [ADR 0186](0186-adr-number-uniqueness-is-gate-enforced.md); the currency audit that motivated it moved [ADR 0227](_superseded/0227-await-bounds-follow-repository-evidence.md) and [ADR 0066](_superseded/0066-grouped-cli-help.md).

## Context

Agents read the decision archive as instruction material, so a current record carrying a stale claim is misinformation delivered with the archive's authority. A corpus-wide currency audit found the rot concentrated in three shapes.

**Amendment stacks.** A record attracts one leading blockquote per later amendment. The heavily-amended records open with several consecutive multi-paragraph banners, and a reader must merge them mentally before the record itself begins.

**Drift-prone specifics.** Notes that restate a count or a version go false the next time the number moves — the audit found a note asserting a bundled-set size the set had since outgrown, dependency pins behind the lockfile, a renamed config key and environment variable presented as current, and a Git-admin path that no longer exists. A note exists to keep a record honest; a note that itself rots inverts the purpose.

**One-way supersession.** Later records declared they superseded or amended an earlier clause while the earlier record carried no matching note — and one record whose own status declared full supersession still sat among the current records.

## Decision

**One amendment block per record.** All amendment notes on a record live in a single leading blockquote, one entry per amending decision, each citing its ADR and stating the delta in a sentence or two. Shared boilerplate is stated once for the block, not repeated per entry.

**Notes read timelessly.** An amendment note states the direction of a change, never a re-stateable current value: no counts a later change would falsify, no version pins, no "is now N". Where the current value matters, the note names the live authority — the config, a registry, the lockfile — instead of restating it.

**Supersession is recorded on both records in the same change.** A record that supersedes, amends, or narrows an earlier clause adds the matching note to the earlier record as it lands. A record whose whole decision falls moves to `_superseded/`, with a banner naming its successor and whatever survives.

**A guard enforces the mechanical half.** The gate fails when a current record's status declares it superseded, when a status line deviates from the `**Status**:` form, and when a current record claims to supersede a sibling current record that carries no reference back. The editorial half — consolidation, timelessness — stays with the writer; the README states it as the format.

## Consequences

- Heavily-amended records regain a readable opening: one block to absorb, then the record.
- Amendment notes stop being a second source of drift. The price is one indirection when a reader wants the current value, paid at the named authority.
- The guard catches only the checkable failures. It cannot check timelessness — a numeric claim can still rot — so the convention and review carry that half.
- Dated notes lose some point-in-time color; Git history retains it.

## Alternatives considered

- **Keep stacking one banner per amendment.** Rejected: the stacks had already grown past readability on the most-amended records, and each banner repeated the boilerplate of its siblings.
- **Edit records in place instead of annotating.** Rejected: a revisited decision gets a new record, never a rewritten old one — the history of the decision must stay legible.
- **Enforce timelessness mechanically.** Rejected: a denylist of numbers would misfire on the many counts that are the decision itself. The guard checks structure; prose stays a writing discipline.
