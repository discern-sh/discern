# ADR 0138: All ruled config banners are managed regions

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** `[ratchets]` and `[docs]` below name historical schema inputs; current config uses `[standards]` and `[map]`. **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** `[recipes]` below names the historical schema input; current config uses `[scripts]`. **Glossary vocabulary amendment ([ADR 0169](0169-the-launch-glossary-canon.md)):** Current pointers use `Co-managed seed` / co-managed file → `Shared file`; the decision and reasoning are unchanged.

> **Formatter amendment ([ADR 0178](0178-discern-tidy-is-the-embedded-convention-for-discern-owned-surfaces.md)):** The ownership boundary below stands, but every engine mutation of `discern.toml` now passes the complete result through a comment-preserving canonical formatter. Upgrade still preserves values and project comments; it no longer promises to preserve their surrounding whitespace byte-for-byte.

**Status**: accepted

**Supersedes**: [ADR 0107](_superseded/0107-config-banners-are-managed-regions.md)

## Context

`discern.toml` is both executable configuration and the local explanation of the installed binary. ADR 0092 made its fixed structure shared with discern: upgrade restores an absent section or key with the current template documentation, but leaves comments beside existing structure untouched. ADR 0107 then made the ruled record-family banners managed because those banners are the only route by which new record knobs reach an existing install.

That split left fixed-section banners in an ambiguous state. Their opening and closing `# ───` rules look owned, but upgrade treated the prose between them as project content whenever the section still existed. Ordinary template copy changes therefore never reached existing projects. More seriously, the schema 17→18, 18→19, and 19→20 migrations renamed live tables while deliberately preserving all comments. They left `# [ratchets]`, `# [docs]`, and `# [recipes]` banners behind. The first was no longer recognizable as the managed `[standards]` record banner; the other two sat above current `[map]` and `[scripts]` sections that reconciliation considered complete.

The file still needs a safe place for project explanation. Comments attached to individual keys and comments outside ruled regions carry local intent and must survive. Prose inside an explicitly delimited banner instead describes discern's config contract and must converge with the installed binary.

## Decision

Every clean `# ───`-delimited config banner authored by the current template is a discern-owned managed region.

- A fixed-section banner auto-enrols when its bracketed identity names a live section in the template. Upgrade associates an installed banner with the live section immediately following it, so stale identity prose cannot prevent convergence. It replaces the entire ruled region with the rendered current template, or inserts the region when the section exists without it.
- Record-family shape banners remain managed as decided by ADR 0107. A missing fixed banner never consumes an adjacent record banner.
- A top-level table-rename migration renames the first path segment of any clean ruled-banner identity it owns. The subsequent reconciliation pass then replaces the region wholesale. Ordinary comments containing the same word are not lexical migration targets.
- The project continues to own every config value, named record table, comment attached to an individual key, and comment outside a ruled region. Upgrade does not reformat or normalize those bytes.
- A malformed or half-delimited block is not consumed speculatively. The reconciler inserts the canonical fixed banner where needed and leaves the ambiguous project text intact.

The template structure is the enrollment source. Adding a differently named fixed section with a ruled banner requires no registry or migration-test list change before its banner becomes managed.

## Consequences

Existing projects receive current fixed-section documentation on every upgrade, not only missing keys and record-family knobs. Removing just the `[scripts]` banner makes `upgrade --check` report drift and a normal upgrade restores it. Vocabulary migrations cannot leave an old ruled identity behind.

The ownership boundary is visually checkable: prose between the two rules can be overwritten, while prose outside them remains the project's. A project that put local notes inside a ruled banner loses those notes on the next upgrade; that is the deliberate cost of making the delimiter an honest ownership marker.

Reconciliation still is not a formatter. It does not rewrite key comments, values, table order, named records, or arbitrary prose outside managed regions.

## Alternatives considered

- **Patch each vocabulary migration.** This repairs known stale names but leaves ordinary fixed-banner copy drift and the next rename dependent on another bespoke patch.
- **Keep only record-family banners managed.** This retains the previous narrow blast radius, but the identical rule delimiters would express two ownership models and fixed documentation would continue to age silently.
- **Regenerate the whole config.** This guarantees textual convergence but cannot preserve project values and annotations with the same narrow safety boundary.
