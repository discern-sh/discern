# Glossary

Every icculus-specific term, defined precisely. This is the canonical
dictionary: the names defined here are used verbatim across the whole
documentation tree, and synonyms are not introduced. The few nouns the whole
system is built on come first, because they show up everywhere else.

For a narrative tour of how these terms relate, read [concepts.md](concepts.md).
For the architectural shape, see [system-map.md](system-map.md).

> This doc is a skeleton. The `/bootstrap` skill fills it from the brief at
> `.icculus/brief.md`. Group terms under headings that match the system's parts;
> the structure below is a starting point.

---

## Core nouns

<!-- /bootstrap fills this -->

_(Define the two or three building blocks the rest of the system rests on — the
ones a newcomer must understand before anything else makes sense. One precise
paragraph each. State what the thing is, not how it is built.)_

### ExampleTerm

_(One-paragraph definition. Replace with the project's real core nouns.)_

---

## File dispositions

Every path an install contains has a **disposition** — how `icculus` treats it
on `upgrade`, and where it is edited. The four are mapped across the whole
surface in [install-surface.md](../80-development/install-surface.md).

### Managed file

A file copied verbatim from the kit's [`templates/`](../../templates/) tree and
held byte-identical to it by `selfcheck`. `icculus upgrade` refreshes it, and a
local edit is reported as drift and preserved alongside as `<file>.new`. A
managed file is edited at its `templates/` source, never at its installed path —
the managed set is declared in [`managed.json`](../../templates/managed.json)
(see [ADR 0008](../_adr/0008-declarative-managed-set.md)).

### Seed file

A file written once, at `icculus init`, from a `templates/….tmpl`, then owned by
the project. `upgrade` never refreshes or flags it; it is edited in place.
`icculus.toml`, the project guidelines, the `docs/` tree, and `TODO.md` are
seeds.

### Merged file

A file folded into whatever the project already has rather than written whole,
so an existing project keeps its own content. It is produced only at `init` and
left untouched by `upgrade`, in one of two forms: a structured merge
(`.claude/settings.json`) or an idempotent append (`.gitignore`).

### Generated file

A file produced by a harness command after install rather than copied from a
template, and reproduced by re-running that command rather than edited directly.
The `guidelines` recipe compiles `CLAUDE.md`, `AGENTS.md`, and the
`.claude/skills/` symlinks; the installer writes `.icculus/manifest.json`.

---

## <Area>

<!-- /bootstrap fills this -->

_(Add a section per area of the system — typically aligned with the subsystem
subtrees. Under each, define the terms that area introduces. A term is defined
in exactly one place; other docs cross-link here rather than redefining it.)_

### ExampleTerm

_(One-paragraph definition.)_

---

## Cross-references

- For how these concepts fit together: [concepts.md](concepts.md)
- For the visual map: [system-map.md](system-map.md)
- For the principles that shaped them:
  [design-principles.md](design-principles.md)
