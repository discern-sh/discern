---
aliases:
  - documentation model
  - doc discovery
  - frontmatter
  - public docs
---

# The document model

One validated model in [`src/lib/docs.ts`](../../../src/lib/docs.ts) backs every reader of a documentation tree: `discern map`, `discern docs` (terminal and Model Context Protocol, or MCP), exports, the docs site, and its search/llms derivations. The shared model owns document discovery, filtering, ordering, and titles for every renderer.

## Discovery and the entry

`discoverDocs` walks the configured tree and yields one `DocEntry` per leaf: paths, section, slug, a title from the first heading, and a description from the lead paragraph (`extractTitle` and `leadParagraph` live beside the model). The model also carries `publish`, `order`, `aliases`, `redirectFrom`, and `citedAdrs` (the decisions the page cites, collected by [`src/lib/adr_citations.ts`](../../../src/lib/adr_citations.ts)). `map_overview.ts` reuses `DocEntry.description` rather than re-deriving it.

`resolveDoc` matches a free-form target case-insensitively against each entry's path spellings, slug, and frontmatter `aliases`. A glossary term or a dotted config key can therefore reach its page by name. When several pages claim a name, resolution returns all candidates as an ambiguity. `suggestDocs` ranks the same candidate set fuzzily for misses.

`docRegions` derives every non-internal top-level subtree and its front-door title, description, count, and ordered entries. Map overview, exact region targets, and generated agent guidance consume that one set. `canonicalDocTarget` gives each leaf a docs-root-relative target without the `.md` suffix, suitable for a follow-up map/help call.

Sibling reading order is README-first, then `DocEntry.order`. An explicit frontmatter `order` is authoritative. While a sibling has none, discovery fills it from the section README's authored table or list link order. Only direct sibling Markdown links count, so source links and cross-section "see also" lists cannot reorder a section. The shared model therefore carries the README's existing curation to every renderer.

## Frontmatter: lenient read, two validation tiers

[`src/lib/frontmatter.ts`](../../../src/lib/frontmatter.ts) holds the shared fenced-block scanner (`SKILL.md` identity blocks read it too) and three policies over one set of per-key shape rules ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md), [ADR 0202](../_adr/0202-the-gate-ships-the-map-integrity-preflight.md)):

- `parseFrontmatter` reads leniently. It ignores unknown keys and out-of-shape values, so a metadata mistake cannot make a reader lose the document.
- `frontmatterShapeIssues` is the domain-neutral tier every project's Gate applies through the map-integrity preflight: a broken block (unterminated fence, invalid YAML, non-mapping) and mis-shaped values on discern's known keys fail; unknown keys stay legal, because projects carry third-party frontmatter;
- `validateFrontmatter` layers the strict, closed schema on the same shape rules: unknown-key rejection, `title`'s short-label ceiling, `description` bounds, `redirect_from` as absolute canonical routes, and list-content rules. [`tests/map_frontmatter_test.ts`](../../../tests/map_frontmatter_test.ts) applies this repository's house style to its own Map. The shipped Gate uses the neutral tier.

## The map-integrity preflight

[`src/lib/map_integrity.ts`](../../../src/lib/map_integrity.ts) is the pure `(root, config, cli) → findings` core behind the Gate's documentation precondition (`failed_stage: "map_integrity"`). It applies the scanners in [`src/lib/docs_integrity.ts`](../../../src/lib/docs_integrity.ts) over the current Map corpus (non-`_` subtrees plus root docs) and the `[guidance].sources` files. Intra-Map links and heading anchors resolve against the shared renderer's output. Frontmatter passes the neutral tier. Fenced `discern` examples validate against the live command model with Project Scripts as extra verbs. Published pages (`isPublicDoc` over the corpus) never link into `_internal/` or `_private/`, and code-span Skill citations name a Skill in the effective set. [`tests/map_integrity_test.ts`](../../../tests/map_integrity_test.ts) is a thin layer over the same core: the live-corpus run plus per-rule bite proofs.

## The publication predicate

`isPublicDoc(entry)` is the sole page-level publication test: `publish: false` withholds a page from every published surface identically, while agent surfaces of the project map (`discern map`, the tree on disk) keep everything. `PUBLIC_DOC_SURFACES` is the projection matrix in code; [`tests/public_doc_parity_test.ts`](../../../tests/public_doc_parity_test.ts) forces every enrolled surface onto the predicate and bans hand-rolled `.publish` filtering anywhere else. Tier-level curation is a separate axis. `MANUAL_SECTION_REGISTRY` in [`src/lib/paths.ts`](../../../src/lib/paths.ts) classifies every numbered section, and `BUNDLED_PUBLIC_DOC_DIRS` selects its public entries. Binary docs staging walks the indexed leaves and applies both axes, so the compiled resource contains the published pages in the public-manual tiers and no internal tree ([ADR 0142](../_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Projections

Rendered surfaces strip the frontmatter block and carry its values as structured fields: `publish` when false, `order`, `aliases`, and `cited_adrs`. Raw surfaces (`--raw` and the site's `.md` editions) return pristine bytes by contract. Human-rendered prose (terminal and MCP `docs`, plus site HTML) strips inline ADR citation groups. Agent-readable surfaces retain them ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)). [`tests/adr_citation_form_test.ts`](../../../tests/adr_citation_form_test.ts) enforces the normalized citation form in the Gate. The prose Standards measure the body only: the word count strips frontmatter directly, and Vale lints a frontmatter-blanked staged mirror ([`scripts/prose_lib.ts`](../../../scripts/prose_lib.ts)).

[`src/commands/docs.ts`](../../../src/commands/docs.ts) projects terminal indexes, map regions, and search results through the package's Docs Header and Section Components with explicit terminal capabilities. Picker choices remain plain semantic labels for the shared interaction boundary. Dynamic paths, titles, queries, headings, and snippets cross the process safe-text adapters only at these human presentation edges. [`src/lib/markdown.ts`](../../../src/lib/markdown.ts) remains the focused Markdown parser, while package Components own heading, code-listing, divider, and table presentation and the package-backed text façade owns wrapping and measurement. The terminal renderer retains the existing line-ending normalization and comment removal, then makes controls visible before parsing; it makes hyperlink text and destinations inert before composing package-styled OSC-8 links. The HTML renderer does not use that terminal projection. Narrow and wide TTY headers retain every count and path fact; pipes retain the original one-line summary, and long plain index rows break at package grapheme boundaries. `--raw`, `--json`, and `--export` do not enter the presentation path and retain their established bytes.

`docs --adr` has a source/install split. A source checkout resolves this repository's configured Map and can browse `_adr/`. A customer binary contains no such directory and returns the public decisions-site and repository locations. A target that names `_adr/…` opts into that tree on every surface. Both verbs and MCP resolve the target without the flag because the public records are excluded only from the default browse. `_internal` and `_private` keep their audience boundary for every target form. MCP docs otherwise serves the same staged public set through `docsResult`.

### Search projections

[`src/lib/docs_search.ts`](../../../src/lib/docs_search.ts) turns an admitted `DocEntry` and its prepared Markdown into weighted title, alias, heading, code-term, and body fields. [`src/lib/docs_search.js`](../../../src/lib/docs_search.js) owns those weights and the browser's strict all-term matcher. Code generation copies the browser module into the site's tracked static assets, so a fresh checkout can type-check the browser import without making the engine import the site ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)).

Each surface owns admission and presentation policy before the shared projection runs. The site adapter admits published guidance, excludes decision history, strips inline decision citations, returns web routes, and keeps its human-palette result limit. Map search admits the full agent-visible project map and returns canonical map targets. Docs search admits the bundled public manual.

Map and docs pass the same records to the agent ranker in `docs_search.ts`. Exact technical and high-weight phrases keep phrase-only results. Other searches put complete lexical matches first, then fill unused result slots with partials that clear the query-scaled coverage floor. Partial ordering rewards terms an earlier partial did not cover. Results label complete, partial, and metadata matches. Typo-tolerant metadata recovery runs only after lexical search finds nothing and the query has at least 4 characters. The browser's ranking policy does not change ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

## Redirects

`buildRedirectRegistry` assembles destination-owned `redirect_from` claims into a one-hop table. A source may not be a live route, and no source may be claimed twice, which prevents chains and cycles. The site's serving layer consumes the registry. The Gate validates it against the live routes.
