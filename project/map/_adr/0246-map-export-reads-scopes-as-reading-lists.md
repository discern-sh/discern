# ADR 0246: `discern map --export` reads a configured scope as an ordered reading list

**Status**: accepted

## Context

Scopes have been a pure gate concept since ADR 0018: a `[scopes.<name>]` table names a region of the repository with path globs, and the only consumers were classification (which gates fire, what a standing grant covers). The order of a scope's `paths` array carried no meaning.

Separately, `discern map --export` produced three fixed projections (ADR 0015): `public`, `all`, and the interactive `select` — always the whole admitted tree, always in the map's own reading order. There was no way to export a curated subset of map pages as one stream in a deliberate sequence. The need became concrete with this repository's `canon` scope: the seven pages that define the product's vocabulary, wanted as a single ordered context bundle for prose work. Concatenating them by hand drifts the moment the list changes; the list itself deserved one declared home.

The forces: the curated, ordered list must live somewhere; a scope already names a set of paths in config; and the export flag's value space was already scope-shaped (`--export <scope>` was its literal parameter name).

## Decision

On the `map` verb, an `--export` value that is not a built-in resolves against the project's configured `[scopes.<name>]` tables. The export concatenates the map documents the scope's paths match, **in the scope's declared path order** — a pattern matching several documents keeps their map reading order within it, a document matched by two patterns keeps its first position, and a pattern matching nothing warns rather than silently thinning the stream. Matching reuses the engine's scope-glob matcher, so export and gate classification can never disagree about what a scope contains.

A scope's `paths` declaration order is thereby contractual, not incidental.

The explicit *no*s:

- **No new flag, verb, or config table.** The existing flag's vocabulary widens; a parallel `[export.<name>]` surface would be a second place to declare the same list.
- **Built-in names win.** A configured scope named `public`, `all`, or `select` is unreachable by export; the built-ins stay stable.
- **`docs` never consults project scopes.** It serves the fixed bundled manual, which no project scope describes.
- **`--dir` is refused with a configured scope.** Scope paths are anchored to the configured `[map].dir`; an overridden tree would silently mismatch them.
- **Only map documents export.** A scope may also name paths outside the map (source files, the ledger); those are not read — a scope export is a documentation surface, not a general file-concatenation tool.
- **A configured scope sees the whole tree**, `_`-buried pages included: spelling a buried path is the opt-in, the same width `--export all` already has.

## Consequences

- Scopes are now dual-purpose: an unordered classification set for the gate, and an ordered curation for export. Reordering a scope's `paths` changes an export stream even though gating is order-blind — this record is the pointer for anyone surprised that path order matters.
- A curated bundle stays current by construction: the scope is config, so adding a page to the scope updates every future export, and the gate's config schema validates the table like any other.
- Export discoverability rides the error path: an unknown `--export` value lists the configured scope names alongside the built-ins.
- The MCP surface is unchanged: export remains CLI-only, preserving ADR 0015's choice that an accidental tool call cannot return the whole corpus.

## Alternatives considered

- **A dedicated `[export.<name>]` config table** — a second list-of-paths surface that would drift from the scope naming the same region, for no added power.
- **A separate `--export-scope <name>` flag** — two flags competing for one job, with `--export`'s existing value space already made of scope words.
- **Frontmatter-declared bundles** (each page opts into a bundle) — scatters one list across many files and cannot express order in one place.
- **Ignoring declaration order and exporting in map reading order** — discards the one fact only the scope author holds; the tree's own order is already available through `--export all`.
