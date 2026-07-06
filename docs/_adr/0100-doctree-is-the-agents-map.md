# ADR 0100: The doctree is the agent-maintained map, not the project's documentation

**Status**: accepted; builds on
[ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md);
extends [ADR 0080](0080-configured-agent-docs-root.md)

## Context

Two different artifacts have shared the name "docs", and discern has never
formally distinguished them:

1. **The project's documentation** — human-authored, structured to the team's
   taste, possibly public-facing or auto-published from the repo. It belongs
   entirely to the user.
2. **The doctree discern maintains** — scaffolded by setup, structured by
   discern's discipline (a markdown tree, ADRs, scope manifests), kept current
   by gate hints, its staleness treated as a defect. In practice it is
   written almost entirely *by agents*: it records what an agent can infer
   about the codebase, which is not the same thing as what a human would
   choose to write about it.

The conflation is dangerous in exactly one direction. `[docs].dir` has
defaulted to `docs/` — the conventional home of artifact 1 — while discern's
guidance instructs agents to keep "the docs" current after a green finish. In
a brownfield repo whose `docs/` is real, published documentation, that is an
instruction to restructure someone's website. Setup has papered over the
collision with an all-or-nothing skeleton skip and an advisory `docs/discern/`
suggestion — advisory patches on a structural problem, and everything merely
advised degrades
([ADR 0077](0077-setup-agent-is-the-configuration-engine.md)).

Meanwhile the doctree's actual audience was never written down. The
`discern.toml` template gestures at it ("conceptually distinct from
human-curated project docs"), and discern's own doctree — written ~99% by
agents — demonstrates it, but no doc states it.

## Decision

- **The doctree discern maintains is the *map*: an agent-first artifact.**
  Agents infer it, write it, and read it; humans read it to audit what their
  agents actually understand about the codebase. Its structure, format
  (markdown), and upkeep discipline are discern's to prescribe — that is what
  makes it useful as an instrument. A wrong or shallow map is itself a
  finding about the agent's understanding.
- **Its default home is inside the namespace: `discern/docs/`** (per
  [ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md)).
  The project's own documentation is out of discern's reach by construction:
  discern never writes to a path it wasn't defaulted or pointed to, so the
  restructure-someone's-website failure mode becomes impossible rather than
  warned against.
- **Pointing `[docs].dir` at real documentation is deliberate consent** to
  apply the map discipline there — the right choice for some projects
  (discern's own repo does exactly this), and always the user's explicit act,
  offered as a question during setup rather than silently defaulted.
- **The map is eager, and never empty.** Scaffolding-then-filling the map is
  part of `setup begin`, not a lazy afterthought: an install without a map is
  the product without its point, and laziness was only ever a hedge against
  imposing on the user's tree — a hedge the namespace makes unnecessary. A
  skeleton must not land without the authoring pass that fills it; a blank
  map is worse than none.
- **`TODO.md` gets the same classification.** It is the harness's
  deferred-work ledger — written and read by agents in discern's workflow,
  not the team's backlog (that is their tracker). It lives at
  `discern/TODO.md` by default, with its own config key for teams who want it
  elsewhere.

## Consequences

- The two-docs distinction enters the glossary and orientation docs; guidance
  and skill prose say "the map" where they mean discern's doctree, and never
  direct agents at documentation the user didn't point discern to.
- Setup simplifies: the existing-docs conflict detection and `docs/discern/`
  suggestion machinery reduce to one consent question ("should discern manage
  your existing docs, or keep its map in its own folder?").
- The map becomes honest positioning: a living, agent-authored read of the
  codebase the user can audit — and the claim may appear in public docs only
  once the behaviour ships.
- Projects that want discern's discipline over their real docs still get it,
  by pointing — nothing is lost relative to today except the accident.

## Alternatives considered

- **Keep defaulting to `docs/` and warn.** Rejected: the failure mode is an
  agent restructuring published documentation; a warning is advice, and
  advice degrades. Structure or nothing.
- **Detect existing docs and choose a default conditionally.** Rejected: a
  default that differs per repo is not a default; agents and docs could no
  longer state where the map lives, and support would carry the ambiguity
  forever.
- **Keep the map lazy.** Rejected: every reason for laziness was collision
  avoidance, which the namespace solves; what laziness actually produced was
  installs whose central artifact might never appear.
