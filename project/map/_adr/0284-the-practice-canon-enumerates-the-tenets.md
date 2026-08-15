# ADR 0284: The practice canon enumerates the tenets

**Status**: accepted

## Context

"The practice" is the category's load word — positioning leads with "an engineering practice for agent-built software" — yet nothing owned its enumeration. At least five surfaces each carried their own account: the brand concept map's nine-noun product role, the positioning document's seven bullets, the machine edition's six-verb loop, the landing specification's eight lifecycle stages beside its fixed five-item project inventory, and the specification's separate reason-to-believe list. No two agreed, and the drift was already substantive: the machine edition's loop omitted retention entirely while the landing page's centerpiece claim is "what you explain once, the project keeps."

The launch-site effort makes this acute. Multiple pages are being drafted in parallel — homepage, practice page, audience pages, trust page, the machine edition — and each explains the practice at a different altitude. Without one source they will keep inventing variants, the same failure the landing specification already fixed once at small scale by freezing the project-inventory list verbatim after draft 02 shuffled four versions of it.

The repo already holds the pattern: the feature canon owns the mechanism account and the benefit canon owns the value account, both as registries with enrolment guards ([ADR 0175](0175-the-feature-canon-compiles-from-a-feature-registry.md), [ADR 0051](0051-canonical-set-parity.md)). What was missing is the layer between them — the obligations the features implement and the value follows from. The bundled-skills canon even names it: "the built-ins ship the practice discern teaches."

## Decision

**The practice is a canonical registry: `scripts/practice_registry.ts` enumerates the tenets, and surfaces render or cite them instead of re-deriving the practice.**

- **A tenet is an obligation, not a feature.** Each can be stated without naming a feature — "done is deterministic", "you decide what lands" — then cites the feature nodes that implement it (`mechanisms`), the benefit clusters it produces (`yields`), and the project-inventory items it maintains (`holds`). The canon is the middle layer of the triptych: features implement tenets; tenets yield benefits.
- **The canon is flat and numbered.** Ten tenets, ordered as one change meets them, with `arc` (`loop` / `craft`) as rendering metadata rather than canonical structure. Craft tenets — cure the class, write it once — are first-class members: the skills that carry them are bundled precisely because they are part of the practice discern teaches.
- **How a tenet is held derives from its carriers.** A carrier is a `set:member` key (`verb:done`, `config:standards`, `skill:discern-cure-a-bug`). Engine carriers mean a machine boundary refuses the violation; skill carriers mean the discipline is taught. Nothing stores the hold — `tenetHolds` derives it, so the honesty layer cannot drift from the mechanism list.
- **Every bundled skill must be claimed.** The enrolment guard (`tests/practice_canon_enrolment_test.ts`) holds each bundled skill to a tenet carrier or a recorded absence, so a future skill forces a canon decision the moment it exists. Citations are checked in the other direction too: carriers, mechanisms, and yields must name live members.
- **The ratchet and the reflection surfaces are one tenet.** "Only better" carries the enforced half (limits never loosen, pins capture gains) and the advisory half (the logbook's readers point at the next gain) in one obligation, matching the brand direction that time is a positive pillar ([ADR 0244](0244-brand-addresses-the-owner.md)).
- **The fixed inventory derives.** The five-item project inventory — its guidance, its working conditions, its checks, its evidence, and its decisions — is registry data (`PROJECT_INVENTORY` rendered by `inventoryPhrase`), each item claimed by the tenets that maintain it, so the landing copy's verbatim-list rule has a source instead of a memory.
- **"Practice" enters the glossary as a common noun.** Lowercase in running prose everywhere; the capitalized form is the glossary headword only. The proper-noun spelling "The Practice" is rejected: it reads as branded methodology, which the concept map's own boundary ("not a vague methodology, consultancy, or ritual") exists to prevent, and it would shrink the category expression the positioning relies on.

The explicit noes: the tenets do not enter the feature canon (they cite it), the properties around them — local, no model inside, stack-neutral, provider-neutral, ordinary files, reversible — are not tenets (they oblige no change to anything), and commissioning is not a tenet (it is the loop applied to its own installation, which is evidence the loop is universal, not a separate obligation).

## Consequences

- The generated `_internal/practice-canon.md` is the internal source page; the public surfaces that explain the practice — the machine edition's loop, the landing pages, the eventual public practice page, the brand concept row — are brought to it as they are touched, and the machine edition's missing retention step gets fixed by that alignment rather than by another hand edit.
- A new bundled skill cannot ship without deciding which tenet teaches it; a renamed verb, config table, feature node, or benefit cluster strands its citation and fails the gate. No guard asserts the count of tenets: growing the canon is a decision, not a defect.
- The tenet layer gives roadmap work a membership test (which tenet does this serve?) and gives claim-checking a skeleton (each tenet's citations bound what its copy may assert).
- Holding "Only better" as one tenet spans two holds — the guard-derived rendering states which half is enforced and which is advisory, and that split must stay visible in public copy.
- The capitalization question is settled law rather than recurring taste.

## Alternatives considered

- **A two-part canon (loop, then craft) as the recorded structure** — honest about the strata but costs the flat, citable numbering; the arc field keeps the strata available to renderers without spending the structure on it.
- **Grouping the tenets under the human/agent/project frame** — maximal brand alignment with the mark, but several tenets straddle vertices and the fit forces. The frame stays the preamble.
- **Keeping the practice as prose in the brand documents** — every surface keeps re-deriving it, which is the observed failure this record exists to end.
- **Enumerating the tenets as feature-canon nodes** — collapses the obligation layer into the mechanism layer; a tenet must survive its implementation changing, which is exactly what a feature node must not.
