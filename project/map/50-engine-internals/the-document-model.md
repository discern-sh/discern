---
aliases:
  - documentation model
  - doc discovery
  - frontmatter
  - public docs
---

# The document model

One neutral model in [`src/lib/docs.ts`](../../../src/lib/docs.ts) backs every reader of a documentation tree: `discern map`, `discern docs` (terminal and Model Context Protocol, or MCP), exports, the docs site, and its search and machine-readable derivations. The shared model discovers, orders, resolves, searches, and renders Markdown without deciding whether it is reading a configured project Map or discern's product manual. [`src/lib/manual.ts`](../../../src/lib/manual.ts) applies the repository manual's closed corpus policy. This is one document engine with two policy models ([ADR 0314](../_adr/0314-separate-public-manual-and-project-map.md)).

## Discovery and the entry

`discoverDocs` walks an admitted tree and yields one `DocEntry` per page: paths, section, slug, a title from the first heading, and a description from the lead paragraph (`extractTitle` and `leadParagraph` live beside the model). The model also carries `publish`, `order`, `aliases`, `redirectFrom`, stable `pageId`, optional `manualKind`, and `citedAdrs` (the decisions the page cites, collected by [`src/lib/adr_citations.ts`](../../../src/lib/adr_citations.ts)). Reading remains lenient; corpus validation decides which of those fields are required. `map_overview.ts` reuses `DocEntry.description` rather than re-deriving it.

`resolveDoc` matches a free-form target case-insensitively against each entry's path spellings, slug, and frontmatter `aliases`. A glossary term or a dotted config key can therefore reach its page by name. When several pages claim a name, resolution returns all candidates as an ambiguity. `suggestDocs` ranks the same candidate set fuzzily for misses.

`docRegions` derives every non-internal top-level subtree and its front-door title, description, count, and ordered entries. Map overview, exact region targets, and generated agent instructions consume that one set. `canonicalDocTarget` gives each leaf a docs-root-relative target without the `.md` suffix, suitable for a follow-up map/help call.

Sibling reading order is README-first, then `DocEntry.order`. An explicit frontmatter `order` is authoritative. While a sibling has none, discovery fills it from the section README's authored table or list link order. Only direct sibling Markdown links count, so source links and cross-section "see also" lists cannot reorder a section. The shared model therefore carries the README's existing curation to every renderer.

## Frontmatter: lenient read, corpus-specific validation

[`src/lib/frontmatter.ts`](../../../src/lib/frontmatter.ts) holds the shared fenced-block scanner (`SKILL.md` identity blocks read it too) and three policies over one set of per-key shape rules ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md), [ADR 0202](../_adr/0202-the-gate-ships-the-map-integrity-preflight.md)):

- `parseFrontmatter` reads leniently. It ignores unknown keys and out-of-shape values, so a metadata mistake cannot make a reader lose the document.
- `frontmatterShapeIssues` is the domain-neutral tier every project's Gate applies through the map-integrity preflight: a broken block (unterminated fence, invalid YAML, non-mapping) and mis-shaped values on discern's known keys fail; unknown keys stay legal, because projects carry third-party frontmatter;
- `validateFrontmatter` layers the strict, closed schema on the same shape rules: unknown-key rejection, `title`'s short-label ceiling, `description` bounds, `redirect_from` as absolute canonical routes, and list-content rules. [`tests/map_frontmatter_test.ts`](../../../tests/map_frontmatter_test.ts) applies this repository's house style to its own Map. The shipped Gate uses the neutral tier.

The repository manual wrapper adds the facts only that corpus can require. Every root, section index, and leaf must declare one `id`, `title`, `description`, `order`, `publish`, `aliases`, and registered `kind`. It rejects unregistered sections, stray files, symbolic links, oversized or invalid UTF-8 pages, duplicate identities, route or alias ownership collisions, unresolved reachable links, invalid redirects, and incomplete section indexes. A Map page may carry `kind`, but Map discovery and integrity do not require it.

## The map-integrity preflight

[`src/lib/map_integrity.ts`](../../../src/lib/map_integrity.ts) is the pure `(root, config, cli) → findings` core behind the Gate's documentation precondition (`failed_stage: "map_integrity"`). It applies the scanners in [`src/lib/docs_integrity.ts`](../../../src/lib/docs_integrity.ts) over the current Map corpus (non-`_` subtrees plus root docs) and the `[instructions].sources` files. Intra-Map links and heading anchors resolve against the shared renderer's output. Frontmatter passes the neutral tier. Fenced `discern` examples validate against the live command model with Project Scripts as extra verbs. The fully attached entry point owns that model and injects its projection into Gate-capable callers; the integrity core never imports the binary entry point ([ADR 0327](../_adr/0327-shipped-runtime-module-graph-is-a-dag.md)). Published pages (`isPublicDoc` over the corpus) never link into `_internal/` or `_private/`, and code-span Skill citations name a Skill in the effective set. [`tests/map_integrity_test.ts`](../../../tests/map_integrity_test.ts) is a thin layer over the same core: the live-corpus run plus per-rule bite proofs.

## Two corpus authorities

The configured Map resolves through `[map].dir`. [`MAP_SECTION_REGISTRY`](../../../src/lib/paths.ts) classifies discern's own numbered Map sections for project or contributor use; it does not publish a product manual. `discern map`, Map search, instruction projections, and the map-integrity preflight continue to consume that configured tree unchanged.

The manual has one repository-only source boundary: [`REPOSITORY_MANUAL_REL`](../../../src/shared/manual.ts) resolves `project/manual/`, and [`MANUAL_SECTION_REGISTRY`](../../../src/shared/manual.ts) owns the five route families in navigation order. [`MANUAL_KIND_REGISTRY`](../../../src/shared/manual.ts) owns the five editorial purposes and their comprehension checkpoints. There is no end-user config key for this source.

`isPublicDoc(entry)` remains the sole page-level publication predicate. The strict manual projection applies it once after validating every admitted source. A published page automatically enters complete navigation, target resolution, terminal and MCP results, raw Markdown, export, browser search, sitemap, `/llms.txt`, and binary staging through [`PUBLIC_DOC_SURFACES`](../../../src/lib/docs.ts). A withheld page enters none of those surfaces and cannot own redirects. [`tests/public_doc_parity_test.ts`](../../../tests/public_doc_parity_test.ts) bans a parallel publication predicate.

Publication does not imply promotion. The marked direct links in [`project/manual/README.md`](../../manual/README.md) are the single front-door authority. Website and terminal starting journeys project that small ordered set; every other published page remains reachable through the complete surfaces. A falling Standard counts the authored links directly, and a stop checkpoint judges additions or replacements.

## Projections

Rendered surfaces strip the frontmatter block and carry its values as structured fields, including stable `page_id` and `manual_kind` where the result contract needs them. Raw surfaces (`--raw` and the site's `.md` editions) return pristine bytes by contract. Reader-facing rendered prose (terminal and MCP `docs`, plus site HTML) strips inline decision-citation groups. Source-preserving surfaces retain them ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)). [`tests/adr_citation_form_test.ts`](../../../tests/adr_citation_form_test.ts) enforces the normalized citation form in the Gate.

[`src/commands/docs.ts`](../../../src/commands/docs.ts) projects terminal indexes, map regions, and search results through the package's Docs Header and Section Components with explicit terminal capabilities. Picker choices remain plain semantic labels for the shared interaction boundary. Dynamic paths, titles, queries, headings, and snippets cross the process safe-text adapters only at these terminal presentation edges. For a selected document, [`src/lib/markdown.ts`](../../../src/lib/markdown.ts) passes the source and resolved measure through the same bound presenter to the package's first-class Markdown Component. The package parser, neutral model, safety boundary, block composition, semantic-inline renderer, Components, wrapping, and hyperlink policy are the complete terminal authority; the adapter contains no terminal grammar. The request-time website retains a separate React-free HTML emitter for its Workflow and glossary hooks and does not enter the terminal projection. Narrow and wide TTY headers retain every count and path fact; pipes retain the original one-line summary, and long plain index rows break at package grapheme boundaries. `--raw`, `--json`, `--markdown`, and `--export` do not enter the terminal presentation path and retain their established result contracts.

`docs --adr` has a source/install split. A source checkout separately resolves this repository's configured Map and can browse `_adr/`. A customer binary contains no such directory and returns the public decisions-site and repository locations. A target that names `_adr/…` opts into that tree on every surface. `_internal` and `_private` keep their audience boundary for every target form. MCP docs otherwise serves the same staged manual through `docsResult`.

### Search projections

[`src/lib/docs_search.ts`](../../../src/lib/docs_search.ts) turns an admitted `DocEntry` and its prepared Markdown into weighted title, alias, heading, code-term, and body fields. [`src/lib/docs_search.js`](../../../src/lib/docs_search.js) owns those weights and the browser's strict all-term matcher. Code generation copies the browser module into the site's tracked static assets, so a fresh checkout can type-check the browser import without making the engine import the site ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)).

Each corpus owns admission before the shared search projection runs. Map search admits the full agent-visible project Map and returns canonical Map targets. Manual search receives only the canonical published projection; the site adapter adds web routes and its human-palette result limit. Decision history remains a separate route family and stays out of product-manual search.

Map and docs pass the same records to the agent ranker in `docs_search.ts`. Exact technical and high-weight phrases keep phrase-only results. Other searches put complete lexical matches first, then fill unused result slots with partials that clear the query-scaled coverage floor. Partial ordering rewards terms an earlier partial did not cover. Results label complete, partial, and metadata matches. Typo-tolerant metadata recovery runs only after lexical search finds nothing and the query has at least 4 characters. The browser's ranking policy does not change ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

## Redirects

`buildRedirectRegistry` assembles destination-owned `redirect_from` claims into a one-hop table. A source may not be a live route, and no source may be claimed twice, which prevents chains and cycles. The site's serving layer consumes the registry. The Gate validates it against the live routes.

## Prose, comprehension, and benefits

Map prose remains one configured corpus under [`scripts/prose_lib.ts`](../../../scripts/prose_lib.ts) and its existing Standard. Manual prose projects the published pages separately through [`scripts/manual_prose_lib.ts`](../../../scripts/manual_prose_lib.ts): every kind receives product-voice, terminology, command, link, and exactness checks; tutorials, guides, explanations, and troubleshooting also receive the reading-complexity measure; reference stays outside that one measure. Frontmatter and code do not enter prose numerators. The public leaf-density Standard measures the actual manual projection.

Each entry in `MANUAL_KIND_REGISTRY` selects one purpose-specific stop checkpoint. The bounded matcher reads current pages or deleted governing blobs, derives publication and kind from the canonical registries, and fails closed when path, bytes, size, or metadata cannot be trusted. [`tests/manual_doc_checkpoint_test.ts`](../../../tests/manual_doc_checkpoint_test.ts) proves all five kinds and the future-member seam.

[`scripts/manual_benefits.ts`](../../../scripts/manual_benefits.ts) maps selected Human Benefit ids to stable published tutorial, guide, or explanation page ids. The Human Benefit Canon remains the authority for feature-to-benefit relationships. The manual mapping owns only documentation obligations and the retained reason for every unselected benefit.

## Source checkout and customer binary

[`resolveBundledManualDir`](../../../src/lib/paths.ts) checks an explicit test override, then a build-staged manual, then this repository's fixed manual source. It never falls back to `[map].dir`. [`stageBundledManual`](../../../scripts/build.ts) creates a fresh byte-identical directory from the validated published projection before compilation. The compiler embeds that directory only, so installed customer binaries carry no Map or protected decision tree ([ADR 0142](../_adr/0142-customer-binaries-carry-only-public-docs.md)).

[`tests/manual_curation_test.ts`](../../../tests/manual_curation_test.ts) holds the corpus and section shape. [`tests/manual_surface_parity_test.ts`](../../../tests/manual_surface_parity_test.ts) compares canonical page ids across complete delivery surfaces, proves a fresh published page enrolls without promotion, and rejects protected bytes in staging. [`tests/manual_policy_test.ts`](../../../tests/manual_policy_test.ts) guards kinds, front doors, prose projections, and benefit obligations.
