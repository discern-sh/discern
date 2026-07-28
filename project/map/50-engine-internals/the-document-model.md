---
aliases:
  - documentation model
  - doc discovery
  - frontmatter
  - public docs
---

# The document model

One validated model in [`src/lib/docs.ts`](../../../src/lib/docs.ts) backs every reader of a documentation tree: `discern map`, `discern help` (terminal and MCP), exports, the docs site, and its search/llms derivations. No renderer rediscovers, filters, orders, or titles documents on its own.

## Discovery and the entry

`discoverDocs` walks the configured tree and yields one `DocEntry` per leaf: paths, section, slug, a title from the first heading, and a description from the lead paragraph (`extractTitle` and `leadParagraph` live beside the model). The model also carries `publish`, `order`, `aliases`, `redirectFrom`, and `citedAdrs` (the decisions the page cites, collected by [`src/lib/adr_citations.ts`](../../../src/lib/adr_citations.ts)). `map_overview.ts` reuses `DocEntry.description` rather than re-deriving it.

`resolveDoc` matches a free-form target against each entry's path spellings, slug, and frontmatter `aliases`, case-insensitively — so a glossary term or a dotted config key reaches its page by name. When several pages claim a name, resolution returns all candidates as an ambiguity. `suggestDocs` ranks the same candidate set fuzzily for misses.

`docRegions` derives every non-internal top-level subtree and its front-door title, description, count, and ordered entries. Map overview, exact region targets, and generated agent guidance consume that one set. `canonicalDocTarget` gives each leaf a docs-root-relative target without the `.md` suffix, suitable for a follow-up map/help call.

Sibling reading order is README-first, then `DocEntry.order`. An explicit frontmatter `order` is authoritative; while a sibling has none, discovery fills it from the section README's authored table/list link order. Only direct sibling Markdown links count, so source links and cross-section "see also" lists cannot reorder a section. This makes the README's existing curation part of the model rather than something each renderer must rediscover.

## Frontmatter: lenient read, two validation tiers

[`src/lib/frontmatter.ts`](../../../src/lib/frontmatter.ts) holds the shared fenced-block scanner (`SKILL.md` identity blocks read it too) and three policies over one set of per-key shape rules ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md), [ADR 0199](../_adr/0199-the-gate-ships-the-map-integrity-preflight.md)):

- `parseFrontmatter` reads leniently — unknown keys and out-of-shape values are ignored, so no reader can lose a document to a metadata mistake;
- `frontmatterShapeIssues` is the domain-neutral tier every project's gate applies through the map-integrity preflight: a broken block (unterminated fence, invalid YAML, non-mapping) and mis-shaped values on discern's known keys fail; unknown keys stay legal, because projects carry third-party frontmatter;
- `validateFrontmatter` layers the strict, closed schema on the same shape rules (unknown-key rejection, `title`'s short-label ceiling, `description` bounds, `redirect_from` as absolute canonical routes, list-content rules); [`tests/map_frontmatter_test.ts`](../../../tests/map_frontmatter_test.ts) holds this repo's own map to it — it is house style, not part of the shipped gate.

## The map-integrity preflight

[`src/lib/map_integrity.ts`](../../../src/lib/map_integrity.ts) is the pure `(root, config, cli) → findings` core behind the gate's documentation precondition (`failed_stage: "map_integrity"`), applying the scanners in [`src/lib/docs_integrity.ts`](../../../src/lib/docs_integrity.ts) over the current map corpus (non-`_` subtrees plus root docs) and the `[guidance].sources` files: intra-map links and heading anchors resolve against the shared renderer's output, frontmatter passes the neutral tier, fenced `discern` examples validate against the live command model with Project Scripts as extra verbs, published pages (`isPublicDoc` over the corpus) never link into `_internal/`/`_private/`, and code-span skill citations name a skill in the effective set. [`tests/map_integrity_test.ts`](../../../tests/map_integrity_test.ts) is a thin layer over the same core: the live-corpus run plus per-rule bite proofs.

## The publication predicate

`isPublicDoc(entry)` is the sole page-level publication test: `publish: false` withholds a page from every published surface identically, while agent surfaces of the project map (`discern map`, the tree on disk) keep everything. `PUBLIC_DOC_SURFACES` is the projection matrix in code; [`tests/public_doc_parity_test.ts`](../../../tests/public_doc_parity_test.ts) forces every enrolled surface onto the predicate and bans hand-rolled `.publish` filtering anywhere else. Tier-level curation is a separate axis. `MANUAL_SECTION_REGISTRY` in [`src/lib/paths.ts`](../../../src/lib/paths.ts) classifies every numbered section, and `BUNDLED_PUBLIC_DOC_DIRS` selects its public entries. Binary help staging walks the indexed leaves and applies both axes, so the compiled resource contains the published pages in the product-help tiers and no internal tree ([ADR 0142](../_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Projections

Rendered surfaces strip the frontmatter block (its values travel as structured fields — `publish` when false, `order`, `aliases`, `cited_adrs`); RAW surfaces (`--raw`, the site's `.md` editions) return pristine bytes by contract. Inline ADR citation groups are stripped from human-rendered prose only (terminal and MCP `help`, site HTML) and retained everywhere agents read ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)); the normalized citation form is gate-enforced by [`tests/adr_citation_form_test.ts`](../../../tests/adr_citation_form_test.ts). Both prose standards measure the body only: the word count strips frontmatter directly, and Vale lints a frontmatter-blanked staged mirror ([`scripts/prose_lib.ts`](../../../scripts/prose_lib.ts)).

`help --adr` has a source/install split. A source checkout resolves this repo's configured map and can browse `_adr/`; a customer binary contains no such directory and returns the public decisions-site and repository locations. MCP help has no internal mode and serves the same staged public set through `helpResult`.

### Search projections

[`src/lib/docs_search.ts`](../../../src/lib/docs_search.ts) turns an admitted `DocEntry` and its prepared Markdown into weighted title, alias, heading, code-term, and body fields. [`src/lib/docs_search.js`](../../../src/lib/docs_search.js) owns those weights and the browser's strict all-term matcher. Code generation copies the browser module into the site's tracked static assets, so a fresh checkout can type-check the browser import without making the engine import the site ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)).

Each surface owns admission and presentation policy before the shared projection runs. The site adapter admits published guidance, excludes decision history, strips inline decision citations, returns web routes, and keeps its human-palette result limit. Map search admits the full agent-visible project map and returns canonical map targets. Help search admits the bundled public manual.

Map and help pass the same records to the agent ranker in `docs_search.ts`. Exact technical and high-weight phrases keep phrase-only results. Other searches put complete lexical matches first, then fill unused result slots with partials that clear the query-scaled coverage floor. Partial ordering rewards terms an earlier partial did not cover. Results label complete, partial, and metadata matches. Typo-tolerant metadata recovery runs only after lexical search finds nothing and the query has at least 4 characters. The browser's ranking policy does not change ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

## Redirects

`buildRedirectRegistry` assembles destination-owned `redirect_from` claims into a one-hop table: a source may not be a live route and no source is claimed twice, so chains and cycles are impossible by construction. The site's serving layer consumes the registry; the gate validates it against the live routes.
