# The document model

One validated model in [`src/lib/docs.ts`](../../../src/lib/docs.ts) backs every reader of a documentation tree: `discern map`, `discern help` (terminal and MCP), exports, the docs site, and its search/llms derivations. No renderer rediscovers, filters, orders, or titles documents on its own.

## Discovery and the entry

`discoverDocs` walks the configured tree and yields one `DocEntry` per leaf: paths, section, slug, a title from the first heading, and a description from the lead paragraph (`extractTitle` and `leadParagraph` live beside the model). The model also carries `publish`, `order`, `aliases`, `redirectFrom`, and `citedAdrs` (the decisions the page cites, collected by [`src/lib/adr_citations.ts`](../../../src/lib/adr_citations.ts)). `map_overview.ts` reuses `DocEntry.description` rather than re-deriving it.

Sibling reading order is README-first, then `DocEntry.order`. An explicit frontmatter `order` is authoritative; while a sibling has none, discovery fills it from the section README's authored table/list link order. Only direct sibling Markdown links count, so source links and cross-section "see also" lists cannot reorder a section. This makes the README's existing curation part of the model rather than something each renderer must rediscover.

## Frontmatter: lenient read, strict gate

[`src/lib/frontmatter.ts`](../../../src/lib/frontmatter.ts) holds the shared fenced-block scanner (`SKILL.md` identity blocks read it too) and two policies over it ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)):

- `parseFrontmatter` reads leniently — unknown keys and out-of-shape values are ignored, so no reader can lose a document to a metadata mistake;
- `validateFrontmatter` applies the strict, closed schema (`title` with its short-label ceiling, `description` bounds, integer `order`, boolean `publish`, `redirect_from` as absolute canonical routes, `aliases`), and [`tests/map_frontmatter_test.ts`](../../../tests/map_frontmatter_test.ts) walks the live map so any violation fails the gate.

## The publication predicate

`isPublicDoc(entry)` is the sole page-level publication test: `publish: false` withholds a page from every published surface identically, while agent surfaces of the project map (`discern map`, the tree on disk) keep everything. `PUBLIC_DOC_SURFACES` is the projection matrix in code; [`tests/public_doc_parity_test.ts`](../../../tests/public_doc_parity_test.ts) forces every enrolled surface onto the predicate and bans hand-rolled `.publish` filtering anywhere else. Tier-level curation is a separate axis. `MANUAL_SECTION_REGISTRY` in [`src/lib/paths.ts`](../../../src/lib/paths.ts) classifies every numbered section, and `BUNDLED_PUBLIC_DOC_DIRS` selects its public entries. Binary help staging walks the indexed leaves and applies both axes, so the compiled resource contains the published pages in the product-help tiers and no internal tree ([ADR 0142](../_adr/0142-customer-binaries-carry-only-public-docs.md)).

## Projections

Rendered surfaces strip the frontmatter block (its values travel as structured fields — `publish` when false, `order`, `aliases`, `cited_adrs`); RAW surfaces (`--raw`, the site's `.md` editions) return pristine bytes by contract. Inline ADR citation groups are stripped from human-rendered prose only (terminal and MCP `help`, site HTML) and retained everywhere agents read ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)); the normalized citation form is gate-enforced by [`tests/adr_citation_form_test.ts`](../../../tests/adr_citation_form_test.ts). Both prose standards measure the body only: the word count strips frontmatter directly, and Vale lints a frontmatter-blanked staged mirror ([`scripts/prose_lib.ts`](../../../scripts/prose_lib.ts)).

`help --adr` has a source/install split. A source checkout resolves this repo's configured map and can browse `_adr/`; a customer binary contains no such directory and returns the public decisions-site and repository locations. MCP help has no internal mode and serves the same staged public set through `helpResult`.

## Redirects

`buildRedirectRegistry` assembles destination-owned `redirect_from` claims into a one-hop table: a source may not be a live route and no source is claimed twice, so chains and cycles are impossible by construction. The site's serving layer consumes the registry; the gate validates it against the live routes.
