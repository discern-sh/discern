---
aliases:
  - discern.sh
  - website internals
  - public site
  - site architecture
---

# The public site — discern.sh

The public pages for discern live in this repository, so the gate checks the site and the engine together ([ADR 0129](../_adr/0129-site-lives-in-repo-behind-one-fetch-handler.md)). This subtree is for contributors. The product manual lives under `project/manual/`; the public map is a separately framed projection of this configured map.

## Shape

[`site/serve.ts`](../../../site/serve.ts) is the production fetch handler. It combines independently owned reading surfaces:

| Surface           | Authority                                                                                                                          | Public role                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`               | [`MARKETING_PAGES`](../../../site/marketing_pages.ts) and the typed compositions under [`site/ui/pages/`](../../../site/ui/pages/) | Desire. The registry also holds the unpublished `/agents` composition.                          |
| `/releases`       | [Release records and comparison](releases.md)                                                                                      | Release history and stable recommendations rendered from the shared comparison model.           |
| `/docs`           | The validated manual projection from `project/manual/`                                                                             | Current product documentation, exact reference, and recovery.                                   |
| `/map`            | The configured Map filtered by canonical tier and publication policy                                                               | Inspectable evidence of the account discern's agents maintain for project work and human audit. |
| `/docs/decisions` | Published records under `project/map/_adr/`                                                                                        | Project history, explicitly outside current product documentation.                              |

The main implementation boundaries are:

| Piece                                                         | Role                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`site/docs.tsx`](../../../site/docs.tsx)                     | Discovers and validates the manual, decision, and map models and renders bodies.     |
| [`site/documents.tsx`](../../../site/documents.tsx)           | Serves every document request: negotiation, raw editions, search index, React pages. |
| [`site/search.ts`](../../../site/search.ts)                   | Builds the reader-visible search projection for the published manual.                |
| [`site/seo.tsx`](../../../site/seo.tsx)                       | Canonical metadata, redirect validation, discovery files, and security policy.       |
| [`site/marketing_pages.ts`](../../../site/marketing_pages.ts) | Enrolls every static public composition in build, serving, prose, and route guards.  |
| [`site/design_system.ts`](../../../site/design_system.ts)     | Owns route bundles, package selections, assets, and theme.                           |
| [`site/build.ts`](../../../site/build.ts)                     | Emits selected package bundles and static marketing shells.                          |
| [`site/build_inputs.ts`](../../../site/build_inputs.ts)       | Defines the site-owned source boundary for watched builds.                           |
| [`site/dev.ts`](../../../site/dev.ts)                         | Runs loopback-only previews and source-driven rebuilds.                              |
| [`scripts/site_smoke.ts`](../../../scripts/site_smoke.ts)     | Crawls the real handler across routes, links, metadata, raw editions, and redirects. |

[The docs section](the-docs-section.md) owns the corpus boundaries, navigation, rendering, search, raw, and admission contracts. [Design-system consumption](design-system-consumption.md) owns static composition and package boundaries. [Publishing](publishing.md) owns local previews and production deployment. [Authoring](authoring.md) explains the TSX structure, component boundary, and browser interaction model.

## Route authority

[`siteRoutes`](../../../site/routes.ts) combines the marketing registry, fixed endpoint registry, and discovered document models. `liveHtmlRoutes` selects its HTML entries for the sitemap. Raw Markdown pairs derive from the same documents; release and schema endpoints retain their product authorities. The generated `project/map/_internal/registry-atlas.md` includes the marketing set, fixed endpoints, and complete public route inventory. The asset subtree is recorded as a namespace rather than a copied build-output list.

Manual search uses its registry-owned endpoint. Map entries link to repository Markdown files from the single `/map` overview; they have no individual site routes or search endpoint. The llms editions project only the manual.

Production's canonical origin is `https://discern.sh`, and page URLs have no trailing slash. Hypertext Transfer Protocol (HTTP), `www`, `.html`, trailing-slash, and `index.html` variants resolve with a 308 before routing. A moved destination owns its old routes in `redirect_from`; section-level moves live in [`STATIC_REDIRECTS`](../../../site/seo.tsx). Both automatically cover `.md`. Addresses that moved before the public launch were never claimed as history. The combined registry rejects dead targets, collisions, chains, and loops ([ADR 0144](../_adr/0144-canonical-site-urls-and-one-hop-redirects.md)). A known route retired without a successor requires an explicit 410 tombstone.

## Reader negotiation

Browsers receive Hypertext Markup Language (HTML). `/` negotiates the shared plaintext edition for command-line text clients. `/releases` negotiates its own model-driven text projection; its explicit `.txt` and `.json` routes retain their formats. Manual and decision routes, plus the map root, serve pristine Markdown to text clients and through their `.md` forms. Negotiated responses carry `Vary: Accept, User-Agent`.

Rendered pages may remove frontmatter, source-only comments, and presentation-only markers. Their raw editions remain the authored bytes. Search is built from the same reader-visible Markdown projection as rendering, so source-only comments cannot become search vocabulary or snippets while literal examples inside inline or fenced code remain searchable.

Generated manual references reuse the canonical definitions. Their follow-up links prefer human explanations in the offline manual; contributor-only reading links to the corresponding repository file. [`scripts/manual_codegen.ts`](../../../scripts/manual_codegen.ts) owns these editorial destinations separately from public URL redirects, so a reading choice does not claim historical ownership of a route. Each destination agrees with the manual's own search: it is the page that claims one of the map page's names, or it at least mentions the map page's title ([`manual_policy_test.ts`](../../../tests/manual_policy_test.ts)).

## Response contract

Every successful HTML response and complete release-input error page receives a canonical link, a bounded description, Open Graph and Twitter fields, and the static branded card. Document pages add breadcrumb metadata. Explicit Markdown responses point at their HTML canonical and carry `noindex, follow`.

Every response class, including assets, redirects, and errors, receives the same nonce-based same-origin Content Security Policy, `nosniff`, no-referrer, permissions restrictions, and framing denial. The policy admits no third-party resource origins. Unknown routes and missing files return 404.

## Guards

- [`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) enrolls every published manual page and public decision in document checks; [`site_map_test.ts`](../../../tests/site_map_test.ts) holds the map directory to its admitted sources and excludes individual map endpoints.
- [`tests/site_search_test.ts`](../../../tests/site_search_test.ts) guards intent-aware ranking and reader-visible snippets, including arbitrary HTML comments outside code.
- [`tests/site_seo_test.ts`](../../../tests/site_seo_test.ts) derives canonical redirects, sitemap parity, metadata, and machine-edition boundaries from the live route model.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) combines axe audits with focus, no-JavaScript, reduced-motion, forced-color, reflow, and print contracts.
- [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) starts the production handler on a real socket and crawls every canonical and raw route, link, anchor, redirect variant, and response class.
- [`tests/site_prose_test.ts`](../../../tests/site_prose_test.ts) enrolls every `MARKETING_PAGES` composition in its declared public register. The manual has its separate product-voice corpus.

- [Release-page guards](releases.md#visual-and-accessibility-review) cover normalized comparison states, query metadata, no-JavaScript operation, and the real browser journey.

## Current state

The homepage is static build output from a typed source. Manual and decision pages render at request time through the document layout. The map overview uses the shared marketing layout and links to repository sources; its entries have no individual website endpoints. The map's public predicate admits the registered project and contributor tiers while rejecting underscore-prefixed protected directories and `publish: false`; it is not an allowlist of page names.

`deno task site:build` owns ignored output under `site/pages/`, and Deno Deploy runs that build before starting the handler. Never hand-edit generated shells or emitted design-system assets.
