---
aliases:
  - documentation site
  - docs routes
  - manual website
  - docs search
---

# The docs section

`/docs` renders the same product-guidance tree `discern help` serves. The engine's `discoverDocs` finds that tree. [`MANUAL_SECTION_REGISTRY`](../../../src/lib/paths.ts) lists every numbered map section in reading order and classifies its audience. `BUNDLED_PUBLIC_DOC_DIRS` selects the public entries and decides which subtrees ship inside every customer binary ([ADR 0130](../_adr/0130-docs-site-renders-the-help-tree.md)). A leaf added to a public tier appears in the nav, search index, llms.txt, and test suite automatically. A new numbered tier must first join the total registry. The map's decision records use the same document model through a separate, explicitly historical route family ([ADR 0143](../_adr/0143-decisions-on-the-web.md)).

## Sourcing and routes

[`site/docs.ts`](../../../site/docs.ts) filters the discovered tree to the allowlisted sections and composes that filter with the document model's `isPublicDoc` predicate. `publish: false` is the sole page-level withhold across published outputs ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). The router strips each tier's reading-order prefix, producing `/docs/quality-gate/the-receipt` from the numbered source directory. Renumbering a tier therefore leaves inbound links intact. A section's `README.md` becomes its landing page and the first `Overview` child in the section nav. Pages stay in the document model's README-first sequence: explicit frontmatter `order` wins, and a missing order falls back to the README's structured sibling link order. The renderer preserves that sequence. A build guard refuses a configured public section without a README or a published leaf without a section, then verifies that flattening the nav reproduces the complete public page projection.

The wider model includes the strict frontmatter schema, the redirect registry, and the per-entry metadata the site reads. It is documented in [the document model](../50-engine-internals/the-document-model.md).

| Route                 | Content                                                        |
| --------------------- | -------------------------------------------------------------- |
| `/docs`               | Browser cover; the pristine map-root README for text readers.  |
| `/docs/<s>/<leaf>`    | The rendered leaf: nav, breadcrumbs, contents rail, pager.     |
| `/docs/<s>/<leaf>.md` | The pristine Markdown bytes, for any reader.                   |
| `/docs/decisions`     | Browser index; the pristine `_adr/README.md` for text readers. |
| `/docs/decisions/<n>` | One current or visibly superseded decision record.             |
| `/docs/index.json`    | The client-side search index over published product guidance.  |
| `/llms.txt`           | The plaintext edition plus a generated docs listing.           |

`DocsSite.sitemapRoutes` is the canonical HTML route source for the sitemap: the docs landing, every public guidance page, the decisions index, and every decision record. Decision routes stay out of `site.pages`; search and llms prepend `DocsSite.landing` to that guidance-only sequence, while the sitemap alone adds project history.

## Navigation and sequence

The left rail has one server-rendered tree: every public section and page, once, in the same canonical order as help, search, and the pager. [`docsNavigationProjection`](../../../site/docs.ts) adds context to that tree from the current page's position. An ordinary guide initially shows its current section and page, the previous page as nearby context, and the next canonical page as `Recommended`. A boundary neighbor carries its own section into the focused view. This is reading-order guidance, not an invented task relationship; the task index remains the source for outcome-shaped routes across sections.

`Full manual` expands the same DOM tree. In the full state, the control becomes `Focused navigation` and collapses back without moving focus. The state is page-local and ephemeral: it is neither persisted nor encoded in the URL. `/docs` and project-history routes have no current guidance page, so they intentionally show the full tree and no disclosure control. Section landings use the ordinary section context; their model-derived page index in the main column remains the complete section overview.

JavaScript applies `hidden` only after the complete tree reaches the browser. Without JavaScript, the disclosure control stays hidden and every page remains navigable in document flow. The mobile drawer wraps this same focused or full tree; it does not introduce another menu or modal. A future public page joins both states through `DocsSite.pages`, with no navigation registry to update.

## Search

[`site/search.ts`](../../../site/search.ts) builds the index from the stripped public projection. It applies `isPublicDoc` before reading a source and excludes the decision section independently of the guidance-only caller. Each record keeps title, `aliases`, headings, code terms, and body text separate so the client can rank them in that order; descriptions share the body weight. Exact phrases receive a further boost.

The browser fetches the index once and searches it locally, with no third-party code, query telemetry, or query persistence. Its palette requires every query term in one page. Results carry a contextual body excerpt or page description and may link directly to a matching heading. An empty result points readers toward commands, config keys, and exact error text. Map and help reuse the fields and weights through an agent-specific task-language ranker. The browser policy stays fixed ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

## Rendering

Markdown renders at request time and caches for the process lifetime. Rendering strips the frontmatter block and inline ADR citation groups, while the `.md` editions stay pristine ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)). The cited decisions remain available per page as `DocEntry.citedAdrs` and render as a deduplicated `Related decisions` footer, with only each `ADR NNNN` reference linked. The generated glossary is the exception because a decision footer there describes the generator rather than the terms readers came to find. A section landing appends its canonical leaf index from the pages' model-owned title, description, and order, so the web listing enrolls a new leaf automatically. The rendered landing suppresses authored table and list indexes once the derived replacement exists; mixed reference and "see also" blocks remain. Syntax highlighting is monochrome because this design family reserves color for verdicts. Relative links rewrite to guidance routes or on-site decision routes when the target is published, and to the repository on GitHub for internal tiers and source files, preventing reference dead ends.

The glossary registry supplies first-mention summary cards to rendered prose. Each entry's summary defaults to the full definition's first sentence, while its matching phrases default to the canonical term. Accept, Update, Patterns, and Preset match only their `discern <verb>` forms because the manual also uses their bare words in ordinary prose. Matching phrases run longest first, so Gate job wins over Gate without becoming ambiguous. Headings, code, emphasis, and existing links keep their authored semantics. Summary links pass through the page's route renderer, and each card links its canonical term to the full glossary entry. Later matches for that entry stay plain text. Raw Markdown and terminal readers continue to receive the full authored page ([ADR 0171](../_adr/0171-glossary-display-and-matching-are-separate-data.md)).

The decision index and every record carry a server-rendered `Project history` notice that directs readers to the manual for current guidance. Superseded records are marked both in the index and on the record page. The family is linked from the docs colophon rather than the main sidebar, and raw `.md` editions retain the original `_adr/README.md` or record bytes.

The browser shell is a design-system consumer: the docs bundle selects the package's Docs group plus named display components, so the skip link, top bar, brand lockup, section nav, breadcrumbs, contents rail, pager, search palette, keyboard keys, copy buttons, heading permalinks, tables, and the superseded badge all render on component-owned `.discern-*` classes from the emitted `/assets/design-system/docs/` bundle. Page-specific composition lives in `site/pages/assets/docs.css`, which owns layout, the drawer shell, and code-sheet chrome while leaving component-owned classes unchanged. Package-owned floating-surface behavior comes from the selection-scoped `/assets/design-system/docs/discern.js`; page-owned drawer, search, copy, and contents behavior remains in `site/pages/assets/docs.js`. The reading column uses one `46rem` cap for prose, headings, code, tables, and supporting panels. The top-bar `Brand` composes the decorative `◮` through its `Logo` dependency beside the visible `discern` name in the package's `mono` typeface. The `/docs` suffix shares the lockup's centered alignment, and the search and theme controls share one height. The site and docs resolve a stored theme override or the system preference through `site/theme.ts` and the shared `/assets/theme.js` controller. Every page links the shared drawn favicon. Rendered Markdown thematic breaks use the editorial rule treatment with the same centered glyph ([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md)).

## Accessibility and resilience

WCAG 2.2 AA is the shell's working target. The mobile drawer moves focus inside the modal, makes the background inert, traps focus, closes on Escape, and restores focus to the opener. The search palette is a native dialog, so the platform owns focus containment, the inert background, Escape dismissal, and focus restoration. Escape first clears a non-empty query, following the search-input convention. Search exposes its labelled input, result choices, active option, and result count to assistive technology.

Permalinks sit beside h2–h4 headings. Their labels do not change heading names for assistive technology. A glossary mention is a semantic `dfn` connected to its summary through `aria-details`, so pointer hover and keyboard focus expose the same content without browser JavaScript. The left rail keeps one `aria-current="page"` on the current guide. The contents rail separately exposes one `aria-current="location"` for the active heading, including an initial fragment and later hash changes. Near the bottom of the page, its reading marker moves from the top of the browser window toward the bottom. Each short section near the end becomes active before the last heading takes over. An explicit contents link stays active while the page scrolls to its heading. The drawer trigger names its action. Theme, disclosure, and copy controls report their state or result. Drawer and search motion respects reduced motion. Without JavaScript, navigation stays in flow and script-only controls remain hidden.

Asset size budgets live with the design system: the `@discern-sh/design-system` package holds its own CSS and JavaScript standards in its repository.

## Reader negotiation

Every docs route negotiates like the rest of the site: a text client receives the leaf's raw Markdown, and any reader can force it with the `.md` suffix. Negotiated responses carry `Vary: Accept, User-Agent`.

## Guards

[`tests/map_curation_test.ts`](../../../tests/map_curation_test.ts) makes section membership a total invariant. The numbered directories must equal `MANUAL_SECTION_REGISTRY`. The manual's section table, bundled-help allowlist, help projection, and site model must each equal its public subset in registry order. An adversarial fresh-name fixture proves that the guard catches an unclassified tier or a public tier missing from one projection. For every public section, the same suite requires explicit descriptions, aliases, and leaf orders. It then compares the README's structured direct-sibling links with the document model's order. Orders are increasing multiples of ten, with gaps available for later insertion.

[`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) iterates the discovered site, so every front door and leaf enrolls automatically: it must render for a browser, serve pristine Markdown to text clients and via `.md`, appear in the exact CLI/MCP/site/search/llms guidance sequence where applicable, and keep every local link resolvable after rewriting. The full nav must contain every public page once in canonical order. Every guide page must derive one current page, its previous neighbor, and its next recommendation; the docs and history fallbacks must declare the full mode. The same suite walks the directory-derived ADR set, pins history labels and superseded markers, verifies citation-count parity in every related-decision footer, and keeps decision routes absent from search and llms. Its glossary fixtures prove matching overrides, opt-outs, ambiguous-phrase rejection, Gate job's precedence over Gate, one card per term, summary-link rewriting, unique panel relationships, and the design-system class contract. Synthetic projection fixtures prove that a missing section README or a section-less published leaf fails the build. Unpublished tiers are asserted absent by walking the map directory's complement of the derived public allowlist, so a new contributor tier enrolls in the 404 guard the day it is created.

[`tests/site_search_test.ts`](../../../tests/site_search_test.ts) pins exact command, config-key, error-string, and alias searches against synthetic source content. It also guards the field weights, snippets, strict publish boundary, decision exclusion, and no-telemetry policy.

[`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) runs axe on the docs landing, one page per public section, and decision pages. The audit rejects serious or critical WCAG findings. Browser-DOM guards exercise drawer focus, disclosure state and focus preservation, initial and changed fragment context, and permalinks outside headings. Contracts cover reduced motion, no JavaScript, print, and other inactive states. Renderer tests preserve list semantics. [`tests/site_theme_test.ts`](../../../tests/site_theme_test.ts) keeps the site and docs theme bootstrap in lockstep and exercises system changes and stored overrides. [`tests/site_docs_scroll_spy_test.ts`](../../../tests/site_docs_scroll_spy_test.ts) guards the contents-rail selection rule, including a short final section at document bottom.
