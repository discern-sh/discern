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

The manual claims no pre-public address as historical. After publication, a moved destination can own an explicit redirect; validation resolves each historical address directly to its live successor and rejects chains and generic root fallbacks.

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

The manual and decision pages consume the design system's Docs bundle through its React adapters inside the [document layout](authoring.md#shared-layouts), including its Table component. Page composition owns the grid, drawer, search, copy, and contents behavior. The server emits heading permalink groups and scroll-contained table wrappers in the initial document; JavaScript only adds behavior, so enhancement cannot rearrange prose after first paint. Without JavaScript, disclosure controls stay hidden and the full navigation remains in flow.

Package boundaries stay explicit rather than recreated. The contents rail keeps the site's renderer in [`document_toc.tsx`](../../../site/document_toc.tsx) because the package Table of contents numbers every top-level item itself and cannot honor authored procedure numbers. The package Search palette is a hydrated component, so the layout renders its frame, field, and hint statically while the results region carries the page-owned hooks `docs.js` activates; that script also binds the package close control and owns the results anatomy it creates. Model-derived blocks — the cover's front doors and directory, a section landing's leaf list — carry no heading permalinks: the permalink anatomy belongs to the Markdown decorator, and nothing links to those headings.

Rooted navigation shows destination names without repeating each page's editorial kind, and its link hit areas form one contiguous vertical run. The contents rail derives ordinary section numbers, but when an authored procedure numbers its headings, those numbers remain authoritative and unnumbered framing sections stay unnumbered. Tables preserve words and useful column widths, then scroll inside the prose measure when their exact content needs more room.

The drawer and search palette trap focus, close on Escape, restore focus, and make the background inert. The search palette retains an accessible page-owned fallback for browsers that expose `<dialog>` without `showModal()`. Skip links, landmarks, heading order, visible focus, forced colors, reduced motion, print, narrow reflow, and wide table/code containment are part of the guarded shell contract.

## Guards

- [`tests/manual_curation_test.ts`](../../../tests/manual_curation_test.ts) proves section membership, kinds, order, publication, and the central promoted set are total.
- [`tests/manual_surface_parity_test.ts`](../../../tests/manual_surface_parity_test.ts) compares manual identities across website, terminal, MCP, search, sitemap, llms, raw, export, and staging, and proves historical routes resolve in one hop.
- [`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) derives document route, navigation, raw, metadata, and link assertions from discovered sources; [`site_map_test.ts`](../../../tests/site_map_test.ts) checks directory membership and endpoint exclusion.
- [`tests/site_search_test.ts`](../../../tests/site_search_test.ts) covers title/task/kind ranking and adversarial source comments; a comment-only `phantom-capability` term cannot produce a result or snippet.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) audits representative routes and exercises focus, modal, no-JavaScript, print, motion, contrast, and responsive contracts.
- [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) crawls the complete live route model through the real production handler.
