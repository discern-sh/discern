# ADR 0129: Setup never offers to adopt existing docs — and "docs tree" retires with it

**Status**: accepted; amends
[ADR 0100](0100-project-map-is-the-agents-map.md)

## Context

[ADR 0100](0100-project-map-is-the-agents-map.md) separated the two artifacts
that had shared the name "docs" — the project's own documentation and the tree
discern maintains, the map — and reduced setup's collision machinery to one
consent question: keep the map in its own folder, or point it at the project's
existing docs. [ADR 0120](0120-launch-verb-canon.md) then promoted "map" to the
verb and the address (`map/`), retiring the `docs` spelling from every contract
position.

The question survived both decisions, and it aged badly:

- **It re-teaches the conflation the rename ended.** The first thing a new user
  hears about the map is an offer to point it at their human-curated
  documentation — the restructure-someone's-website failure mode ADR 0100 made
  impossible by construction, reintroduced as a suggestion at first contact.
- **It spends a consent slot on the wrong default.** The consent conversation
  is deliberately short (courier agents prune long messages); a question
  implies a live choice, and adoption is the right choice for almost nobody. A
  project that truly wants the map discipline over its real docs can still
  configure that deliberately.
- **The vocabulary survived in the walls.** "docs tree" persisted across
  comments, test names (29 map-browser tests still opened with the retired
  `docs` verb), the landing mockups (which still staged the retired question),
  the eval rubric (grading a `docs/discern/` recommendation two defaults old),
  and the map's own installer pages.

## Decision

- **Setup reassures; it never offers.** When the project has its own `docs/`
  folder, the consent message states that it stays untouched and that the map
  is discern's separate tree at its own home — a statement, not a question. The
  `--map` coda after the message fence retires with it: the consent surface
  never mentions the flag.
- **`[map].dir` remains address configuration, not an adoption channel.** The
  flag and the key still accept any directory, but no shipped surface suggests
  pointing them at human-curated documentation.
- **The phrase "docs tree" retires from every authored surface.** The tree is
  _the map_; a literal directory stays describable as "the `docs/` folder". The
  development-vocabulary guard grows a class-level check
  (`tests/dev_vocab_guard_test.ts`) banning the phrase outside frozen records —
  historical ADRs, archived briefs, recorded eval transcripts, and historical
  install fixtures.

## Consequences

- ADR 0100's "offered as a question during setup" consequence is superseded;
  its map identity, namespace-default, and eager-scaffold decisions stand
  unchanged (an amendment note marks it there).
- The consent message now names the map's real default home (`map/`) in its
  footprint bullet — it previously placed the map inside the `discern/` folder,
  a leftover of the pre-ADR-0120 default.
- The eval harness loses its `--map-answer` knob; the scripted continuation
  answers any docs question an older baseline checkout still asks with a fixed
  keep-mine-untouched line, and the rubric grades the reassurance instead.
- A future decision to support deliberate adoption (documentation-migration
  tooling, say) must clear the guard deliberately — new vocabulary and a new
  consent design, not a revival of the old question.

## Alternatives considered

- **Keep the question, reword it** — any phrasing that offers adoption at first
  contact still teaches the conflation; the offer, not the wording, was the
  defect.
- **Drop the `--map` flag too** — the address must stay configurable (ADR 0120
  kept it so); the defect was the suggestion, not the capability.
- **Guard only the offer, not the phrase** — the behavioral tests pin the
  offer's absence, but the phrase is how the concept re-enters prose; both are
  guarded.
