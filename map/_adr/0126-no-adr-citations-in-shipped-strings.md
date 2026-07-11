# ADR 0126: Internal ADR citations never ship

**Status**: accepted

## Context

This repo cites its own ADRs constantly — the convention is encouraged in
comments, docs, and commit messages, and it keeps decisions traceable. Agents
working here absorbed the habit and carried it one surface too far: citations
accumulated in _shipped_ output — upgrade-migration notes, schema errors, doctor
copy, coupling hints, the setup instructions, even the gitignore fragment
written into a user's project. Twenty-four instances at the census.

For the receiving project those citations are dead references. Its users and its
agents cannot resolve "ADR 0034" — the number indexes decisions made here,
day-to-day choices no downstream project needs to weigh. At best it is noise; at
worst an agent in the receiving repo treats it as vocabulary to imitate.

The repo's guidance already forbids fixing vocabulary leaks with a gate
denylist: an open-ended domain vocabulary can never be enumerated, and each
banned word relocates the leak into tracked test history. That rule appeared to
bar a gate here too.

## Decision

Numbered ADR references are banned from shipped surfaces, enforced by
`tests/adr_vocab_guard_test.ts` in the always-on gate:

- **string literals under `src/`** — scanned by a comment-skipping lexer, so
  code comments remain the sanctioned home for citations;
- **all text under `templates/`** — shipped verbatim, so no exemption.

The pattern is the citation form (`ADR` + number, numbered `_adr/` paths). The
concept word "ADR" stays legal everywhere — discern ships an ADR discipline, so
its copy must talk about ADRs — as does the skeleton's `_adr/0000-template.md`,
part of that shipped discipline.

The denylist rule does not apply because the class is **structural, not
lexical**: `ADR + number` is a closed pattern one regex defines exactly,
embedding no decision content in the guard. The domain-vocabulary rule guards
against enumerating an open set; this guard matches a shape.

The replacement is displacement, not deletion: the citation moves to a code
comment beside the string (or to `docs/`), and the shipped copy carries only the
explanation a user can act on.

## Consequences

- Shipped copy must stand alone. Losing the shorthand forces the message to say
  the actionable part in full — usually an improvement to the copy.
- Traceability is preserved where it belongs: comments, docs, commit history.
- The guard's lexer is heuristic (regex-literal detection, interpolation
  descent) rather than a full parser; positive-control tests seed violations so
  a lexer regression surfaces as a failing control, not a silent pass.
