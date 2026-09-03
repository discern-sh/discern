---
aliases:
  - documentation site
  - docs routes
  - manual website
  - docs search
  - public Map
---

# The docs section

`/docs` is the authored product manual. `/map` is a separate trust exhibit of the configured project Map. They share neutral discovery, Markdown, link, search-record, and rendering primitives, but each route family owns its admission, navigation, search scope, metadata, raw policy, and reader promise ([ADR 0314](../_adr/0314-separate-public-manual-and-project-map.md)).

## Authorities and route families

[`site/docs.ts`](../../../site/docs.ts) discovers each corpus, asks its shared model to decide what is published, and adapts the result to browser routes. It does not maintain page allowlists.

| Route family                         | Source and policy                                                            | Reader promise                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/docs` and `/docs/<section>/<page>` | [`buildManualProjection`](../../../src/lib/manual.ts) over `project/manual/` | Current tutorials, guides, explanations, reference, and troubleshooting.                      |
| `/docs/index.json`                   | Every published manual page                                                  | Manual-only local search.                                                                     |
| `/map` and `/map/<section>/<page>`   | The configured Map filtered by [`isPublicMapEntry`](../../../site/docs.ts)   | A live, inspectable internal-use account—not product documentation or independent validation. |
| `/map/index.json`                    | Every admitted Map page                                                      | Map-only local search.                                                                        |
| `/docs/decisions` and its records    | Published `_adr/` records                                                    | Labelled project history.                                                                     |

Every document route has a pristine `.md` edition and text-client negotiation. The sitemap derives from the same admitted route sets. `/llms.txt` and `/llms-full.txt` list the manual and exclude the Map; decisions remain outside ordinary manual search and navigation.

## The manual journey

[`MANUAL_SECTION_REGISTRY`](../../../src/shared/manual.ts) owns the five sections and their order. Strict publication validation requires one index per section and makes every published page reachable. A page's kind drives labels while the canonical sequence drives breadcrumbs and previous/next movement.

The manual root contains the central front-door authority. `DocsSite.frontDoors` adapts those marked links to the browser landing; the site never copies the promotion set. The compact root rail shows section landings. The browser projection keeps the authored introduction and durable reader orientation, removes the authored maintenance lists and section table, then renders the promoted journeys and complete published tree directly from the model. Raw Markdown remains unchanged. Leaf pages use the complete rooted manual navigation.

The manual claims no pre-public address as historical. After publication, a moved destination can own an explicit redirect; validation resolves each historical address directly to its live successor and rejects chains and generic root fallbacks.

## Reader-visible search

[`buildSearchDocument`](../../../src/lib/docs_search.ts) is the shared search-record projection used by the site and other readers. The record retains stable target, kind, title, summary, aliases and task vocabulary, headings, visible body, and code terms. Ranking favors exact title and task intent, then kind-appropriate guide and troubleshooting matches, before incidental body density. The default palette is bounded; an explicit control reveals the exhaustive corpus.

[`readerVisibleMarkdown`](../../../src/lib/markdown.ts) removes every HTML comment outside inline and fenced code before headings, body text, code terms, ranking, or snippets are derived. The predicate is syntax-based rather than marker-name-based. Authored and generated ownership comments therefore remain in raw Markdown and exports without leaking into the reading or search experience, while a literal `<!-- example -->` inside code remains visible and searchable.

Each browser fetches its index once and searches locally. There is no query telemetry or persistence. Manual results target only `/docs`; Map results target only `/map`. Published/admitted inputs are selected before index construction, so snippets cannot expose withheld pages, protected Map material, frontmatter, or source-only comments.

## The public Map exhibit

The Map projection widens discovery first, then applies the canonical safe predicate. It admits the root README and every public document in a registered Map section, including intended contributor tiers. It rejects `_internal`, `_private`, `_adr`, any other underscore-prefixed protected directory, unregistered tiers, and `publish: false`.

The exhibit has a rooted navigation tree, its own breadcrumbs and pager, unique metadata even when authored titles repeat, isolated search, pristine raw Markdown, sitemap enrollment, and corpus-specific empty/not-found responses. Its persistent label explains that discern is developed under its own practice, making the Map working evidence from internal use rather than independent validation. Every Map page points readers back to `/docs` for product documentation.

The predicate follows [`MAP_SECTION_REGISTRY`](../../../src/lib/paths.ts) and [`isPublicDoc`](../../../src/lib/docs.ts); adding a safe page enrolls it automatically, and adding protected material creates a tested rejection. The site must never add a hand-picked Map page list.

## Rendering and resilience

Markdown renders at request time and caches for the process lifetime. The shared renderer strips frontmatter and source-only comments for HTML, preserves code examples, rewrites links only within the active corpus, and keeps raw bytes untouched. Manual workflow markers project ordinary Markdown into browser semantics; the source remains complete without Cascading Style Sheets (CSS) or JavaScript.

The manual and Map consume the design system's Docs bundle, including its Table component. Page composition owns layout, drawer, search, copy, and contents behavior. The server emits heading permalink groups and scroll-contained table wrappers in the initial document; JavaScript only adds behavior, so enhancement cannot rearrange prose after first paint. Without JavaScript, disclosure controls stay hidden and the full navigation remains in flow.

Rooted navigation shows destination names without repeating each page's editorial kind, and its link hit areas form one contiguous vertical run. The contents rail derives ordinary section numbers, but when an authored procedure numbers its headings, those numbers remain authoritative and unnumbered framing sections stay unnumbered. Tables preserve words and useful column widths, then scroll inside the prose measure when their exact content needs more room.

The drawer and search palette trap focus, close on Escape, restore focus, and make the background inert. The search palette retains an accessible page-owned fallback for browsers that expose `<dialog>` without `showModal()`. Skip links, landmarks, heading order, visible focus, forced colors, reduced motion, print, narrow reflow, and wide table/code containment are part of the guarded shell contract.

## Guards

- [`tests/manual_curation_test.ts`](../../../tests/manual_curation_test.ts) proves section membership, kinds, order, publication, and the central promoted set are total.
- [`tests/manual_surface_parity_test.ts`](../../../tests/manual_surface_parity_test.ts) compares manual identities across website, terminal, MCP, search, sitemap, llms, raw, export, and staging, and proves historical routes resolve in one hop.
- [`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) derives manual and Map route, navigation, admission, rejection, raw, metadata, search isolation, and link assertions from discovered source sets.
- [`tests/site_search_test.ts`](../../../tests/site_search_test.ts) covers title/task/kind ranking and adversarial source comments; a comment-only `phantom-capability` term cannot produce a result or snippet.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) audits representative routes and exercises focus, modal, no-JavaScript, print, motion, contrast, and responsive contracts.
- [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) crawls the complete live route model through the real production handler.
