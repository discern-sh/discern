# ADR 0130: The docs site renders the help tree through the shared discovery module

> **Amendments.**
>
> - **[ADR 0143](0143-decisions-on-the-web.md) — ADRs on site:** the ADRs-stay-off-site deferral is lifted — decision records render on the site as project history outside product guidance.
> - **[ADR 0218](0218-docs-owns-the-manual-help-owns-cli-reference.md) — command name:** the shared manual tree now renders through `discern docs`; the `/docs` route and one-document-model decision stand.
> - **[ADR 0314](0314-separate-public-manual-and-project-map.md) — corpus boundary:** `/docs` and the installed manual move from a filtered Map projection to a dedicated manual source. The shared discovery and rendering engine remains; the safely admitted Map publishes separately as a trust exhibit.

**Status**: accepted

## Context

The site (ADR 0129) needed a documentation section with the usability of a modern docs product: sidebar navigation, search, pagination, per-page contents. The content already existed twice over — the `map/` tree documents the system, and `BUNDLED_PUBLIC_DOC_DIRS` already curates which of its subtrees ship inside every customer binary as `discern help`. The risk in adding a docs site was adding a third copy: a separate content tree, or a site-side list of what to publish, either of which would drift from what the binary actually serves.

Listings also needed per-page metadata (a one-line description for navigation, search, and index files) that no doc carried. Requiring authored metadata on every leaf would create a surface agents forget to maintain — the exact staleness the map discipline exists to prevent.

## Decision

`/docs` renders the help tree. The site imports the engine's own `discoverDocs` and filters to `BUNDLED_PUBLIC_DOC_DIRS`: the allowlist that decides what ships in a customer binary is, unchanged, the boundary that decides what publishes on the web. There is no site-side content list.

Metadata is derived first, overridden second. Discovery now derives every doc's description from its lead paragraph (the derivation map-overview regions already used), and an optional frontmatter block (`title`, `description`, `order`, `publish`) can override a derived value when the derivation reads poorly. Parsing lives in the engine, so every discern project's `map`/`help` records carry descriptions, not just this site.

Routes strip the reading-order prefixes (`/docs/quality-gate/the-receipt`, not `/docs/20-quality-gate/…`) so renumbering a tier never breaks an inbound link. Every page negotiates like the rest of the site: text clients — or a `.md` suffix — receive the pristine Markdown bytes, the same bytes `discern help <leaf> --raw` prints. Relative links rewrite to routes when the target is published and to the repository on GitHub when it is not, so a reference to an internal tier or an ADR never dead-ends.

The ADRs themselves stay off the site for now — links point at GitHub — until the public-audience prose review recorded in `TODO.md` has happened.

## Consequences

- The site cannot drift from the binary: what `discern help` serves and what discern.sh/docs serves are one derivation apart from the same allowlist. A leaf added to the map appears in the nav, search index, llms.txt, and the test suite with no site change.
- The auto-enrolling suite (`tests/site_docs_test.ts`) now guards link integrity for the published tree — a cross-reference into an unpublished tier must rewrite cleanly or the build fails. This protects the bundled `discern help` reading experience too.
- Frontmatter is a new, optional engine surface. Its restricted grammar (scalar `key: value` lines only) is deliberate: anything richer passes through as document content rather than risking silent content loss.
- Descriptions being derived means a poorly-opening leaf gets a poor listing line — visible in `/docs` and `discern map --json` — which is pressure on the prose itself rather than on a metadata sidecar.
