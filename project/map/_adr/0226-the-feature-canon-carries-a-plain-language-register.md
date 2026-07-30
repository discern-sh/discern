# ADR 0226: The feature canon carries a plain-language register

**Status**: accepted. Extends the feature registry ([ADR 0175](0175-the-feature-canon-compiles-from-a-feature-registry.md)) and the agent-experience axis ([ADR 0179](0179-the-feature-canon-carries-an-agent-experience-axis.md)).

## Context

discern's positioning reaches owners with no prior technical background: people who run a business, build an app with coding agents, and have never met "coverage" or "lint". Launch work needs the product's story in a register those owners can actually read. The account must also be as enumerable and as guarded as the technical one, because it will feed landing copy, onboarding, release notes, and every surface aimed at the non-technical segment.

A hand-translated plain-language draft of the canon, kept under `_private/maintainer/`, proved both the value and the register. It also demonstrated the failure mode within days: the registry moved (a new verb, a new config table, a renamed skill, reworked mechanisms) and the draft described a product that no longer existed. That is the exact drift ADR 0175 exists to close, now on a second axis. Nothing held the plain telling to existence, to currency, or to register.

The draft's register has an internal logic worth preserving verbatim: **quote the names, translate the concepts.** Command names, config keys, and file names stay in code spans, because they are buttons on the screen. Every concept around them takes one translation, everywhere: worktree → "a separate working copy", the gate → "the final quality check", the trunk → "the main shared version", a hint → "a tip". A kept name gets its explanation on first use ("the computer's standard installed-program list, called `PATH`").

## Decision

**Every feature node carries a required `plain` account, and a second generated page renders the whole tree in that register. A glossary-keyed lexicon, a jargon scan, and a reading-grade standard hold the register itself.**

### The `plain` account

`plain` is a required field on `FeatureNode`: a plain `title` and `what` on every node, with `why` and `agent` present exactly when their technical twins are (parity is test-enforced). Requiring the field puts enrolment at the typecheck stage: a node cannot enter the canon without its plain reading. The closed-set enrolment guards therefore transitively guarantee a plain-language account for every new verb, job, stage, config table, bundled skill, and provider. The account lives inline on the node, beside the sentences it retells: locality is the one defence against the semantic drift no mechanical guard can catch.

### The second page

`deno task codegen` renders the tree twice from one registry: the technical canon, and `_internal/feature-canon-plain.md` with the register's own chrome. That chrome is the **Coding agent:** marker, tips for hints, and translated fixed-list headings — exhaustive over the surface sets, so a new set cannot ship without a plain name. The pages cross-link, share the coverage appendix, and carry identical drift guards.

ADR 0179 rejected a second generated page for the agent axis, and that reasoning stands: the agent axis is a filter — a subset of nodes, same register, same reader, derivable by a helper. The plain axis is a total re-rendering in a different register for a different reader. Every node appears, the chrome itself takes translation, and interleaving two registers on one page would double every node while serving neither audience. The one-tree principle stands — there is exactly one registry and one authoring surface.

### Policing the register, not just requiring it

- **The plain lexicon.** `PLAIN_LEXICON` pairs every glossary term with its plain rendering — translated, or kept with the reason it is already plain — and the register guard holds the key set in bijection with the glossary. A new term cannot enter the product's vocabulary until the same change decides its plain-language rendering. Beyond the guard, the table is the translation canon for any future plain surface (site hover text, plain-language toggles, founder-facing copy).
- **The jargon scan.** No policed term may appear in any node's plain strings outside a code span. Translated glossary terms default their matchers to the glossary entry's own match phrases; `PLAIN_GENERAL_JARGON` extends the scan to software vocabulary the glossary does not own (commit, branch, database, port…) — a ratchet seeded from the draft's translations, not a completeness promise. Terms whose bare name is ordinary English narrow their matcher or record `match: false`; review owns what the scan cannot see.
- **The reading-grade ceiling.** `[standards.plain_reading_grade]` holds a deterministic Flesch-Kincaid grade over the plain prose as a ceiling that may only fall. The scan polices vocabulary, and the number holds simplicity.

### Register typography

The plain register capitalises the product name mid-sentence — "Discern" — because lay readers parse lowercase brand names as typos; the technical register keeps lowercase `discern`. Register owns typography.

## Consequences

- A new node now costs three statements: the technical pair, the agent account where the experience is distinct, and the plain account always. ADR 0175's deliberate two-touch price becomes three; accepted — the audience is real, and the alternative is re-deriving the plain story by hand at every launch moment.
- Four levels hold the plain register: presence (the type system), currency (drift tests over both pages), vocabulary (the lexicon guard), and simplicity (the reading-grade ceiling). No guard judges whether a sentence is genuinely clear — review still owns the register's voice.
- The register guard earns its keep immediately: the seed pass itself leaked jargon three times, and the guard caught all three.
- Creative and marketing work for non-technical audiences reads one enumerable source at every resolution, and the lexicon replaces per-piece re-decisions about how to say a concept plainly.
- The superseded hand draft under `_private/maintainer/` leaves the tree; a stale hand copy beside a compiled register is the failure this decision closes.
- The map's prose corpus grows by roughly ten thousand words that must hold the same Vale bar as the rest of the map — the seed pass paid for that with an active-voice sweep, and the density standard keeps paying attention.

## Alternatives considered

- **A parallel plain registry keyed by node id.** Rejected: two files invite the drift that locality exists to prevent. The plain account belongs beside the technical sentences it retells, and the required field makes the type system the enrolment guard.
- **A language-model translation pass at codegen time.** Rejected on principle: discern ships no model, and the gate's verdicts are reproducible and free. The plain text stays authored data like every other register, and the guards hold its quality without an API key.
- **Interleaving the plain reading into the one canon page.** Rejected: it doubles every node, forces one reader to skip half of every bullet, and cannot translate the page chrome. The two-page shape is what the two-audience reality requires.
- **Extending the glossary with plain fields instead of a canon-owned lexicon.** Rejected: the glossary defines terms for readers of the technical manual; the lexicon is a rendering policy for one register, consumed by that register's guards and kept beside its data.
- **Publishing the plain page.** Rejected for now, on ADR 0175's grounds: `_internal` is a maintainer database, and public surfaces are editorial projections that quote it. Revisit when the site wants a founder-facing "what is discern" page — as a projection, not a relocation.
