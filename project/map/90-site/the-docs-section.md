---
aliases:
  - documentation site
  - docs routes
  - manual website
  - docs search
---

# The docs section

`/docs` renders the same dedicated product manual that `discern docs` serves. The neutral `discoverDocs` engine reads `project/manual/`, then [`buildManualProjection`](../../../src/lib/manual.ts) applies section, identity, publication, kind, route, redirect, link, and front-door policy once. [`MANUAL_SECTION_REGISTRY`](../../../src/shared/manual.ts) owns `start`, `guides`, `understand`, `reference`, and `troubleshooting` in navigation order. A published page appears automatically in navigation, search, raw Markdown, sitemap, `/llms.txt`, terminal, MCP, export, and binary staging. The Map is a separate configured knowledge corpus ([ADR 0130](../_adr/0130-docs-site-renders-the-help-tree.md), [ADR 0314](../_adr/0314-separate-public-manual-and-project-map.md)).

The Map's published decision records use the same neutral document engine through a separate, explicitly historical route family ([ADR 0143](../_adr/0143-decisions-on-the-web.md)). Decisions never join product-manual navigation or customer binaries.

## Sourcing and routes

[`site/docs.ts`](../../../site/docs.ts) adapts the already validated manual projection to the browser model; it does not re-derive publication. `publish: false` is the only per-page control that withholds an admitted page from published outputs ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). The section registry supplies stable route slugs independently of the numbered source directories. A section's `README.md` becomes its landing page and first navigation child. Pages remain README-first and then follow their required explicit `order`. The strict projection refuses a registered section without one published index, a published page outside a section, an unreachable page, or any mismatch between flattened navigation and the canonical page sequence.

The marked direct links in the manual root are a smaller promotion authority. `DocsSite.frontDoors` adapts those links for the browser landing while terminal starting journeys read the same set. Promotion never controls publication, navigation, or search.

[The document model](../50-engine-internals/the-document-model.md) describes the strict frontmatter schema, redirect registry, and per-entry metadata that the site reads.

| Route                 | Content                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `/docs`               | Browser cover; the pristine manual-root README for text readers. |
| `/docs/<s>/<leaf>`    | The rendered leaf: nav, breadcrumbs, contents rail, pager.       |
| `/docs/<s>/<leaf>.md` | The pristine Markdown bytes, for any reader.                     |
| `/docs/decisions`     | Browser index; the pristine `_adr/README.md` for text readers.   |
| `/docs/decisions/<n>` | One current or visibly superseded decision record.               |
| `/docs/index.json`    | The client-side search index over the published manual.          |
| `/llms.txt`           | The plaintext edition plus a generated docs listing.             |

`DocsSite.sitemapRoutes` is the canonical Hypertext Markup Language (HTML) route source for the sitemap. It contains the docs landing, every public manual page, the decisions index, and every decision record. Decision routes stay out of `site.pages`. Search and llms prepend `DocsSite.landing` to that public-document sequence, while the sitemap adds project history.

## Navigation and sequence

The left rail has one server-rendered tree containing every published section and page once, in the same canonical order as terminal docs, search, MCP, and the pager. [`docsNavigationProjection`](../../../site/docs.ts) adds context to that tree from the current page's position. An ordinary guide initially shows its current section and page, the previous page as nearby context, and the next canonical page as `Recommended`. A boundary neighbor carries its own section into the focused view. These relationships follow reading order. The guide index remains the source for outcome-shaped routes across sections.

`Full manual` expands the same Document Object Model (DOM) tree. In the full state, the control becomes `Focused navigation` and collapses back without moving focus. The state is local to the page and lasts only for that view. The site does not persist it or encode it in the web address. `/docs` and project-history routes have no current manual page, so they show the full tree with no disclosure control. Section landings use the ordinary section context. Their model-derived page index in the main column remains the complete section overview.

JavaScript applies `hidden` only after the complete tree reaches the browser. Without JavaScript, the disclosure control stays hidden and every page remains navigable in document flow. The mobile drawer wraps the same focused or full tree and introduces no additional menu or modal. A future public page joins both states through `DocsSite.pages`; no navigation registry update is required.

## Search

[`site/search.ts`](../../../site/search.ts) builds the index from the stripped canonical manual projection. Admission has already happened, so this adapter only excludes separately supplied decision-history records before reading a source. Each record keeps title, `aliases`, headings, code terms, and body text separate, so the client can rank them in that order. Descriptions share the body weight. Exact phrases receive a further boost.

The browser fetches the index once and searches it locally. The search uses no third-party code, query telemetry, or query persistence. Its palette requires every query term to appear in one page. Results carry a contextual body excerpt or page description and may link directly to a matching heading. An empty result points readers toward commands, config keys, and exact error text. The Map and docs reuse the fields and weights through an agent-specific task-language ranker. The browser policy stays fixed ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

## Rendering

Markdown renders at request time and caches for the process lifetime. Rendering strips the frontmatter block and inline ADR citation groups, while the `.md` editions stay pristine ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)). Each page retains its cited decisions as `DocEntry.citedAdrs`. They render in a deduplicated `Related decisions` footer, with only each `ADR NNNN` reference linked. The generated glossary omits that footer because its citations describe the generator instead of the terms readers came to find.

A section landing appends its canonical leaf index from the pages' model-owned title, description, and order, so the web listing enrolls a new leaf automatically. Once the derived replacement exists, the rendered landing suppresses authored table and list indexes but retains mixed reference and "see also" blocks. Syntax highlighting is monochrome because this design family reserves color for verdicts. Relative links stay inside the reachable manual projection or point to on-site decision routes. Repository and Map links point to their truthful GitHub source.

The glossary registry supplies first-mention summary cards to rendered prose. Each entry's summary defaults to the full definition's first sentence, while its matching phrases default to the canonical term. Accept, Update, Patterns, and Preset match only their `discern <verb>` forms because the manual also uses their bare words in ordinary prose. Matching phrases run longest first, so Gate job takes precedence over Gate without ambiguity. Headings, code, emphasis, and existing links keep their authored semantics. Summary links pass through the page's route renderer, and each card links its canonical term to the full glossary entry. Later matches for that entry stay plain text. Raw Markdown and terminal readers continue to receive the full authored page ([ADR 0171](../_adr/0171-glossary-display-and-matching-are-separate-data.md)).

The decision index and every record carry a server-rendered `Project history` notice that directs readers to the current manual. Both the index and record page mark superseded records. The docs colophon links to this route family, and the main sidebar omits it. Raw `.md` editions retain the original `_adr/README.md` or record bytes.

The browser shell consumes the design system. The docs bundle selects the package's Docs group plus named display components. The skip link, top bar, brand lockup, section navigation, breadcrumbs, contents rail, pager, search palette, keyboard keys, copy buttons, heading permalinks, tables, and superseded badge all render on component-owned `.discern-*` classes from the emitted `/assets/design-system/docs/` bundle. Page-specific composition lives in `site/pages/assets/docs.css`, which owns layout, the drawer shell, and code-sheet chrome while leaving component-owned classes unchanged. Package-owned floating-surface behavior comes from the selection-scoped `/assets/design-system/docs/discern.js`. Page-owned drawer, search, copy, and contents behavior remains in `site/pages/assets/docs.js`.

The reading column uses one `46rem` cap for prose, headings, code, tables, and supporting panels. The top-bar `Brand` composes the decorative `◮` through its `Logo` dependency beside the visible `discern` name in the package's `mono` typeface. The `/docs` suffix shares the lockup's centered alignment, and the search and theme controls share one height. The site and docs resolve a stored theme override or the system preference through `site/theme.ts` and the shared `/assets/theme.js` controller. Every page links the shared drawn favicon. Rendered Markdown thematic breaks use the editorial rule treatment with the same centered glyph ([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md)).

## Accessibility and resilience

WCAG 2.2 AA is the shell's working accessibility target. The mobile drawer moves focus inside the modal, makes the background inert, traps focus, closes on Escape, and restores focus to the opener. The search palette is a native dialog, so the platform owns focus containment, the inert background, Escape dismissal, and focus restoration. Escape first clears a non-empty query, following the search-input convention. Search exposes its labeled input, result choices, active option, and result count to assistive technology.

Permalinks sit beside h2–h4 headings. Their labels do not change heading names for assistive technology. A glossary mention is a semantic `dfn` connected to its summary through `aria-details`, so pointer hover and keyboard focus expose the same content without browser JavaScript. The left rail keeps one `aria-current="page"` on the current guide. The contents rail separately exposes one `aria-current="location"` for the active heading, including an initial fragment and later hash changes. Near the bottom of the page, its reading marker moves from the top of the browser window toward the bottom. Each short section near the end becomes active before the last heading takes over. An explicit contents link stays active while the page scrolls to its heading. The drawer trigger names its action. Theme, disclosure, and copy controls report their state or result. Drawer and search motion respects reduced motion. Without JavaScript, navigation stays in flow and script-only controls remain hidden.

Asset size budgets live with the design system: the `@discern-sh/design-system` package holds its own CSS and JavaScript standards in its repository.

## Reader negotiation

Every docs route negotiates like the rest of the site: a text client receives the leaf's raw Markdown, and any reader can force it with the `.md` suffix. Negotiated responses carry `Vary: Accept, User-Agent`.

## Guards

[`tests/manual_curation_test.ts`](../../../tests/manual_curation_test.ts) makes manual section and page membership a total invariant. Physical directories must equal `MANUAL_SECTION_REGISTRY`, every page must satisfy the strict metadata and order contract, and the root's marked direct links must resolve to the canonical promoted set. A future page or section cannot remain unclassified.

[`tests/manual_surface_parity_test.ts`](../../../tests/manual_surface_parity_test.ts) compares stable page ids across website, CLI and MCP models, search, sitemap, `/llms.txt`, raw and export inputs, and build staging. Its fresh-name fixture proves a published page enrolls everywhere without becoming promoted. It also proves every old route resolves directly to its final destination and that staged binaries receive no Map or protected bytes.

[`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) iterates the discovered site, so every promoted journey and published page enrolls automatically. Each must render for a browser, serve pristine Markdown to text clients and through `.md`, retain its structured kind, and keep every local link resolvable after rewriting. The full navigation contains every page once in canonical order. Every guide page derives its current page, previous neighbor, and next recommendation. The docs and history fallbacks declare full mode.

The same suite walks the directory-derived ADR set, pins history labels and superseded markers, verifies citation-count parity in every related-decision footer, and keeps decision routes absent from search and llms. Its glossary fixtures check matching overrides, opt-outs, ambiguous-phrase rejection, Gate job's precedence over Gate, one card per term, summary-link rewriting, unique panel relationships, and the design-system class contract. Synthetic projection fixtures prove that a missing section README or section-less published leaf fails the build. It also asserts that protected Map paths never enter the manual site model; Map section membership remains guarded independently.

[`tests/site_search_test.ts`](../../../tests/site_search_test.ts) pins exact command, config-key, error-string, and alias searches against synthetic source content. It also guards the field weights, snippets, strict publish boundary, decision exclusion, and no-telemetry policy.

[`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) runs axe on every registry-owned marketing page, the docs landing, one page per public section, and decision pages. The audit rejects serious or critical WCAG findings. Browser-DOM guards exercise drawer focus, disclosure state and focus preservation, initial and changed fragment context, and permalinks outside headings. Contracts cover reduced motion, no JavaScript, print, and other inactive states. Renderer tests preserve list semantics. [`tests/site_theme_test.ts`](../../../tests/site_theme_test.ts) keeps the site and docs theme bootstrap in lockstep and exercises system changes and stored overrides. [`tests/site_docs_scroll_spy_test.ts`](../../../tests/site_docs_scroll_spy_test.ts) guards the contents-rail selection rule, including a short final section at document bottom.
