# ADR 0154: Launch standards recalibrate to the public corpus at programme end

**Status**: accepted; extends [ADR 0133](0133-standards-join-the-gate.md) and [ADR 0140](0140-validated-frontmatter-and-the-publish-predicate.md)

## Context

The docs-site launch programme rewrote the public manual and its platform across five waves of parallel agents. The owner ruled at the outset (decision D13 of the launch strategy) that the pre-rewrite prose and density pins were set aside for the duration: agents would not contort a rewrite to keep limits green that described the corpus being replaced, and the programme would end with one owner-sanctioned recalibration on the trunk. Standards otherwise never loosen, and a branch cannot loosen one at all — the gate compares every limit against the trunk's committed copy on every run.

The verification wave then surfaced two limits that no longer described the tree honestly:

- `public_doc_leaf_density` measured every `publish`-true map page, including the contributor tiers (`50`, `80`, `90`) that the manual section registry withholds from every public surface. The programme's own salvage rule moves material cut from public pages into exactly those tiers, so the floor punished the sanctioned move: 299 contributor-only words added under `90-site` pushed the whole-map measure to 11.33 against the 11.4 floor while the public manual was untouched.
- `docs_search_index_size` was pinned at 261,352 bytes against the 47-page search index that predated surface verification. That verification restored the `/docs` front door to every machine projection — a required fix — and the completed 48-page corpus measures 263,867 bytes.

## Decision

`public_doc_leaf_density` measures the public guidance projection, not the whole map. The measurement composes the same two predicates every published surface serves — the manual section registry's tier allowlist and the page-level publication predicate — so the corpus the standard budgets is the corpus readers get. Contributor tiers are deliberately unbudgeted: they absorb what public pages shed. Registry-driven tests pin the exclusion so a re-audienced or new section enrols automatically.

The search-index ceiling rises once, on the trunk, to the measured 48-page value: 263,867 bytes, no headroom. It falls from here as ever.

Every remaining launch standard re-pins at the value measured on the final corpus, captured with `discern standards --pin` so each move can only tighten: the corrected density floor rises from 11.4 to the public corpus's measured 12.68 leaves per 10,000 words, the prose ceiling falls from 10.73 to 10.6 alerts per 1,000 words, and the guidance word ceiling falls from 828 to 827. Coverage and the binary-size ceiling hold their existing limits — both measured inside their pin margins. The docs page, CSS, and JavaScript ceilings keep the launch values the verification wave pinned days earlier.

This recalibration is the programme-end settlement D13 sanctioned, taken in daylight on the trunk with this record. It is not a precedent for adjusting a limit on a branch, and the never-loosen rule resumes in full from these values.

## Consequences

- The density floor now defends the public manual's editorial gains — small, focused pages — and contributor documentation can grow freely without breaching a budget meant for readers who never see it.
- Every gain the rewrite made is a limit the gate holds from here: the corpus can gain focus and shed lint density, but it cannot quietly drift back.
- The search index carries the full 48-page corpus with zero headroom; the next record added to it must either pay for itself elsewhere or come back to the owner.
- A future re-audiencing of a manual section moves pages into or out of the measured corpus, so the density measure will move with it; the registry-driven tests make that shift visible rather than silent.
