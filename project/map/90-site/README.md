---
aliases:
  - discern.sh
  - website internals
  - public site
  - site architecture
---

# The public site — discern.sh

The public pages for discern live in this repository, so the Gate checks the site and the Engine together ([ADR 0129](../_adr/0129-site-lives-in-repo-behind-one-fetch-handler.md)). This subtree is for contributors. The product manual lives under `project/manual/`; the public Map is a separately framed projection of this configured Map.

## Shape

[`site/serve.ts`](../../../site/serve.ts) is the production fetch handler. It combines three independently owned reading surfaces:

| Surface                  | Authority                                                                                                                          | Public role                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`, `/agents`, `/trust` | [`MARKETING_PAGES`](../../../site/marketing_pages.ts) and the typed compositions under [`site/page-src/`](../../../site/page-src/) | Desire, agent-native orientation, and the short trust gateway.                                  |
| `/docs`                  | The validated manual projection from `project/manual/`                                                                             | Current product documentation, exact reference, and recovery.                                   |
| `/map`                   | The configured Map filtered by canonical tier and publication policy                                                               | Inspectable evidence of the account discern's agents maintain for project work and human audit. |
| `/docs/decisions`        | Published records under `project/map/_adr/`                                                                                        | Project history, explicitly outside current product documentation.                              |

The main implementation boundaries are:

| Piece                                                         | Role                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`site/docs.ts`](../../../site/docs.ts)                       | Adapts the shared document model to manual, Map, and decision route families.           |
| [`site/search.ts`](../../../site/search.ts)                   | Builds the shared reader-visible search projection; each corpus receives its own index. |
| [`site/seo.ts`](../../../site/seo.ts)                         | Canonical metadata, redirect validation, discovery files, and security policy.          |
| [`site/marketing_pages.ts`](../../../site/marketing_pages.ts) | Enrolls every static public composition in build, serving, prose, and route guards.     |
| [`site/design_system.ts`](../../../site/design_system.ts)     | Owns route bundles, package selections, assets, and theme.                              |
| [`site/build.ts`](../../../site/build.ts)                     | Emits selected package bundles and static marketing shells.                             |
| [`site/build_inputs.ts`](../../../site/build_inputs.ts)       | Defines the site-owned source boundary for watched builds.                              |
| [`site/dev.ts`](../../../site/dev.ts)                         | Runs loopback-only previews and source-driven rebuilds.                                 |
| [`scripts/site_smoke.ts`](../../../scripts/site_smoke.ts)     | Crawls the real handler across routes, links, metadata, raw editions, and redirects.    |

[The docs section](the-docs-section.md) owns the corpus boundaries, navigation, rendering, search, raw, and admission contracts. [Design-system consumption](design-system-consumption.md) owns static composition and package boundaries. [Publishing](publishing.md) owns local and release operation.

## Route authority

There is no copied site route list. [`liveHtmlRoutes(site)`](../../../site/serve.ts) combines the static `PAGES` projection with `DocsSite.sitemapRoutes`. The latter derives the manual, decision, and public-Map routes from their source models. A published document therefore joins its declared browser, raw, metadata, and sitemap surfaces without a second site-side registry.

The stable non-HTML endpoints are `/docs/index.json`, `/map/index.json`, `/install`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, and `/.well-known/security.txt`. Manual search uses `/docs/index.json`; Map search uses `/map/index.json`. The llms editions project only the manual.

Production's canonical origin is `https://discern.sh`, and page URLs have no trailing slash. Hypertext Transfer Protocol (HTTP), `www`, `.html`, trailing-slash, and `index.html` variants resolve with a 308 before routing. Destination documents own `redirect_from`; section-level moves live in [`STATIC_REDIRECTS`](../../../site/seo.ts). Both automatically cover `.md`. The combined registry rejects dead targets, collisions, chains, and loops ([ADR 0144](../_adr/0144-canonical-site-urls-and-one-hop-redirects.md)). A known route retired without a successor requires an explicit 410 tombstone.

## Reader negotiation

Browsers receive Hypertext Markup Language (HTML). `/` and `/agents` negotiate the shared plaintext edition for command-line text clients; `/trust` is an ordinary non-negotiated brand page. Manual, Map, and decision routes serve pristine Markdown to text clients and through their `.md` forms. Negotiated responses carry `Vary: Accept, User-Agent`.

Rendered pages may remove frontmatter, source-only comments, and presentation-only markers. Their raw editions remain the authored bytes. Search is built from the same reader-visible Markdown projection as rendering, so source-only comments cannot become search vocabulary or snippets while literal examples inside inline or fenced code remain searchable.

## Response contract

Every successful HTML response receives a canonical link, a bounded description, Open Graph and Twitter fields, and the static branded card. Document pages add breadcrumb metadata. Explicit Markdown responses point at their HTML canonical and carry `noindex, follow`.

Every response class, including assets, redirects, and errors, receives the same nonce-based same-origin Content Security Policy, `nosniff`, no-referrer, permissions restrictions, and framing denial. The policy admits no third-party resource origins. Unknown routes and missing files return 404.

## Guards

- [`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) enrolls every published manual page, admitted Map page, and public decision in rendering, route, raw, link, navigation, search-isolation, and admission checks.
- [`tests/site_search_test.ts`](../../../tests/site_search_test.ts) guards intent-aware ranking and reader-visible snippets, including arbitrary HTML comments outside code.
- [`tests/site_seo_test.ts`](../../../tests/site_seo_test.ts) derives canonical redirects, sitemap parity, metadata, and machine-edition boundaries from the live route model.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) combines axe audits with focus, no-JavaScript, reduced-motion, forced-color, reflow, and print contracts.
- [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) starts the production handler on a real socket and crawls every canonical and raw route, link, anchor, redirect variant, and response class.
- [`tests/site_prose_test.ts`](../../../tests/site_prose_test.ts) enrolls every `MARKETING_PAGES` composition in its declared public register. The manual has its separate product-voice corpus.

## Current state

The homepage, For Agents page, and trust gateway are static build output from typed sources. The manual and Map use the same server-rendered reading shell but remain different corpora with different navigation, search endpoints, framing, raw policies, and machine reach. The Map's public predicate admits the registered project and contributor tiers while rejecting underscore-prefixed protected directories and `publish: false`; it is not an allowlist of page names.

`deno task site:build` owns ignored output under `site/pages/`, and Deno Deploy runs that build before starting the handler. Never hand-edit generated shells or emitted design-system assets.
