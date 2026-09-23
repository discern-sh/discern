---
aliases:
  - documentation site
  - docs routes
  - manual website
  - docs search
  - public Map
---

# The docs section

`/docs` is the authored product manual. `/map` is a directory of the configured project map, with entries hosted in the source repository. The corpora share neutral discovery and publication primitives while keeping separate reader promises ([ADR 0314](../_adr/0314-separate-public-manual-and-project-map.md), [ADR 0403](../_adr/0403-the-site-map-is-a-directory-of-repository-sources.md)).

## Authorities and route families

[`site/docs.tsx`](../../../site/docs.tsx) discovers each corpus, asks its shared model to decide what is published, and adapts the result to browser routes; [`site/documents.tsx`](../../../site/documents.tsx) serves those routes. Neither maintains page allowlists.

| Route family                         | Source and policy                                                            | Reader promise                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/docs` and `/docs/<section>/<page>` | [`buildManualProjection`](../../../src/lib/manual.ts) over `project/manual/` | Current tutorials, guides, explanations, reference, and troubleshooting.                      |
| `/docs/index.json`                   | Every published manual page                                                  | Manual-only local search.                                                                     |
| `/map`                               | The configured Map filtered by [`isPublicMapEntry`](../../../site/docs.tsx)  | A live, inspectable internal-use account—not product documentation or independent validation. |
| `/docs/decisions` and its records    | Published `_adr/` records                                                    | Labelled project history.                                                                     |

Manual and decision routes, plus the map root, have pristine `.md` editions and text-client negotiation. The sitemap derives from the same admitted route sets. `/llms.txt` and `/llms-full.txt` list the manual and exclude the map; decisions remain outside ordinary manual search and navigation.

## The manual journey

Manual prose addresses the human directing the project. The shared `manual-public-reader` stop in [`discern.toml`](../../../discern.toml) serves the manual authoring procedure for every changed authored, published page; the per-kind checkpoint judges the page's specific job. Both use [`manual_doc_checkpoint.ts`](../../../scripts/manual_doc_checkpoint.ts), which reads publication and kind from the canonical model, including governing versions of deleted pages. Review firing frequency and declarations with `discern checkpoints` after landed efforts accumulate.

[`MANUAL_SECTION_REGISTRY`](../../../src/shared/manual.ts) owns the five sections and their order. Strict publication validation requires one index per section and makes every published page reachable. A page's kind drives labels while the canonical sequence drives breadcrumbs and previous/next movement.

The manual root contains the central front-door authority. `DocsSite.frontDoors` adapts those marked links to the browser landing; the site never copies the promotion set. The compact root rail shows section landings. The browser projection keeps the authored introduction and durable reader orientation, removes the authored maintenance lists and section table, then renders the promoted journeys and complete published tree directly from the model. Raw Markdown remains unchanged. Leaf pages use the complete rooted manual navigation.

A moved page keeps its old address working. It lists the old page route in `redirect_from`, and the site derives the matching `.md` redirect; declaring the `.md` route as well is rejected as a conflict. Validation resolves each old address directly to its live successor and rejects chains and generic root fallbacks.

To move a page, keep its `id`, which registries and agents use to address it. Rename the file and add the old route to `redirect_from`. Then update every link to the old path, in the manual, in [`site/navigation.ts`](../../../site/navigation.ts), and in the map, and run `deno task codegen` to refresh generated links such as the glossary's. If the generated glossary still links to the old path, correct that link by hand first: the manual's link validation runs before codegen can regenerate it. `project/manual/20-understand/how-discern-works.md` is an example.

## Reader-visible search

[`buildSearchDocument`](../../../src/lib/docs_search.ts) is the shared search-record projection used by the site and other readers. The record retains stable target, kind, title, summary, aliases and task vocabulary, headings, visible body, and code terms. Ranking favors exact title and task intent, then kind-appropriate guide and troubleshooting matches, before incidental body density. The default palette is bounded; an explicit control reveals the exhaustive corpus.

[`readerVisibleMarkdown`](../../../src/lib/markdown.ts) removes every HTML comment outside inline and fenced code before headings, body text, code terms, ranking, or snippets are derived. The predicate is syntax-based rather than marker-name-based. Authored and generated ownership comments therefore remain in raw Markdown and exports without leaking into the reading or search experience, while a literal `<!-- example -->` inside code remains visible and searchable.

Each browser fetches its index once and searches locally. There is no query telemetry or persistence. Search results target only `/docs`. Published/admitted inputs are selected before index construction, so snippets cannot expose withheld pages, protected map material, frontmatter, or source-only comments.

## The public Map exhibit

The map projection widens discovery first, then applies the canonical safe predicate. It admits the root README and every public document in a registered map section, including intended contributor tiers. It rejects `_internal`, `_private`, `_adr`, any other underscore-prefixed protected directory, unregistered tiers, and `publish: false`.

[`MapPage.tsx`](../../../site/ui/pages/MapPage.tsx) renders the directory with the shared public header and footer. Section headings and entries link directly to their Markdown files through the repository URL authority. The complete grouped list is visible without a disclosure or document sidebars. Its notice frames the map as working evidence from internal use and points readers to the manual for product instructions.

Only `/map` enters the HTML route inventory. Individual map entries, section indexes, raw leaf editions, and the former map search endpoint return 404. The root's raw edition still returns the configured README unchanged. The project README retains its contributor navigation; the website overview owns its shorter introduction. These launch addresses claim no historical redirect ownership. The predicate follows [`MAP_SECTION_REGISTRY`](../../../src/lib/paths.ts) and [`isPublicDoc`](../../../src/lib/docs.ts); adding a safe page enrolls its repository link automatically, and adding protected material creates a tested rejection. The site must never add a hand-picked map page list.

## Rendering and resilience

Markdown renders at request time and caches for the process lifetime. The shared renderer strips frontmatter and source-only comments for HTML, preserves code examples, rewrites links only within the active corpus, and keeps raw bytes untouched. Manual workflow markers project ordinary Markdown into browser semantics; the source remains complete without Cascading Style Sheets (CSS) or JavaScript.

The manual and decision pages consume the design system's Docs bundle through its React adapters inside the [document layout](authoring.md#shared-layouts): the Docs layout owns the columns, the sticky rails, and the navigation drawer, whose `docs-drawer` behavior arrives in the emitted runtime; the Table of contents numbers the contents rail from [`document_toc.ts`](../../../site/document_toc.ts), which passes an authored procedure's own numbers through; the Search palette renders in its static mode, whose `search-palette` behavior in the same runtime opens it from the header's search control or ⌘K and `/`, and owns its dismissal and focus; [`docs.js`](../../../site/pages/assets/docs.js) answers the behavior's open and close events with the query, the one-way index request, and the results it builds in the package's option anatomy. Page-owned script keeps only those search results, copy controls, the navigation column's scroll position, and the contents scroll spy. The server emits heading permalink rows and scroll-contained table wrappers in the initial document; JavaScript only adds behavior, so enhancement cannot rearrange prose after first paint. Model-derived headings — the cover's front doors and chapters, a section landing's leaf index — render through the package Anchor heading, and [`document_html.tsx`](../../../site/document_html.tsx) gives Markdown headings the same anatomy; [`site_docs_test.ts`](../../../tests/site_docs_test.ts) holds the two byte for byte. Without JavaScript the drawer toggle and search control stay hidden and the full navigation remains in flow above the document.

Rooted navigation shows destination names without repeating each page's editorial kind, and its link hit areas form one contiguous vertical run. The contents rail derives ordinary section numbers, but when an authored procedure numbers its headings, those numbers remain authoritative and unnumbered framing sections stay unnumbered. Tables preserve words and useful column widths, then scroll inside the prose measure when their exact content needs more room.

The package behaviors give the drawer and search palette the same contract: they trap focus, close on Escape, restore focus, and make the background inert; opening search closes an open drawer and returns focus to its toggle afterwards, and the palette keeps that contract in browsers that expose `<dialog>` without `showModal()`. Skip links, landmarks, heading order, visible focus, forced colors, reduced motion, print, narrow reflow, and wide table/code containment are part of the guarded shell contract. The drawer follows a container query, so its contract runs in a real browser in [`tests/site_docs_shell_browser_test.ts`](../../../tests/site_docs_shell_browser_test.ts).

## Guards

- [`tests/manual_curation_test.ts`](../../../tests/manual_curation_test.ts) proves section membership, kinds, order, publication, and the central promoted set are total.
- [`tests/manual_surface_parity_test.ts`](../../../tests/manual_surface_parity_test.ts) compares manual identities across website, terminal, MCP, search, sitemap, llms, raw, export, and staging, and proves historical routes resolve in one hop.
- [`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) derives document route, navigation, raw, metadata, and link assertions from discovered sources; [`site_map_test.ts`](../../../tests/site_map_test.ts) checks directory membership and endpoint exclusion.
- [`tests/site_search_test.ts`](../../../tests/site_search_test.ts) covers title/task/kind ranking and adversarial source comments; a comment-only `phantom-capability` term cannot produce a result or snippet.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) audits representative routes and exercises the search modal, copy, navigation position, print, motion, and responsive contracts; [`tests/site_docs_shell_browser_test.ts`](../../../tests/site_docs_shell_browser_test.ts) drives the drawer, the skip link, and the no-JavaScript shell in a browser.
- [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) crawls the complete live route model through the real production handler.
