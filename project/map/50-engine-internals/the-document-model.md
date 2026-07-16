# The document model

One validated model in [`src/lib/docs.ts`](../../../src/lib/docs.ts) backs every
surface that reads a documentation tree — `discern map`, `discern help`
(terminal and MCP), exports, the docs site, and its search/llms derivations. No
renderer rediscovers, filters, orders, or titles documents on its own.

## Discovery and the entry

`discoverDocs` walks the configured tree and yields one `DocEntry` per leaf:
paths, section, slug, a title from the first heading, a description from the
lead paragraph (`extractTitle` and `leadParagraph` live beside the model — they
are its only content-derived fields), plus the frontmatter-carried metadata:
`publish`, `order`, `aliases`, `redirectFrom`, and `citedAdrs` (the decisions
the page cites, collected by
[`src/lib/adr_citations.ts`](../../../src/lib/adr_citations.ts)).
`map_overview.ts` reuses `DocEntry.description` rather than re-deriving it.

## Frontmatter: lenient read, strict gate

[`src/lib/frontmatter.ts`](../../../src/lib/frontmatter.ts) holds the ONE
fenced-block scanner (`SKILL.md` identity blocks read it too) and two policies
over it
([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)):

- `parseFrontmatter` reads leniently — unknown keys and out-of-shape values are
  ignored, so no reader can lose a document to a metadata mistake;
- `validateFrontmatter` applies the strict, closed schema (`title` with its
  short-label ceiling, `description` bounds, integer `order`, boolean `publish`,
  `redirect_from` as absolute canonical routes, `aliases`), and
  [`tests/map_frontmatter_test.ts`](../../../tests/map_frontmatter_test.ts)
  walks the live map so any violation fails the gate.

## The publication predicate

`isPublicDoc(entry)` is the sole page-level publication test: `publish: false`
withholds a page from every published surface identically, while agent surfaces
of the project map (`discern map`, the tree on disk) keep everything.
`PUBLIC_DOC_SURFACES` is the projection matrix in code;
[`tests/public_doc_parity_test.ts`](../../../tests/public_doc_parity_test.ts)
forces every enrolled surface onto the predicate and bans hand-rolled `.publish`
filtering anywhere else. Tier-level curation (`BUNDLED_PUBLIC_DOC_DIRS` in
[`src/lib/paths.ts`](../../../src/lib/paths.ts)) is a separate axis.

## Projections

Rendered surfaces strip the frontmatter block (its values travel as structured
fields — `publish` when false, `order`, `aliases`, `cited_adrs`); RAW surfaces
(`--raw`, the site's `.md` editions) return pristine bytes by contract. Inline
ADR citation groups are stripped from human-rendered prose only (terminal and
MCP `help`, site HTML) and retained everywhere agents read
([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)); the normalized
citation form is gate-enforced by
[`tests/adr_citation_form_test.ts`](../../../tests/adr_citation_form_test.ts).
Both prose standards measure the body only: the word count strips frontmatter
directly, and Vale lints a frontmatter-blanked staged mirror
([`scripts/prose_lib.ts`](../../../scripts/prose_lib.ts)).

## Redirects

`buildRedirectRegistry` assembles destination-owned `redirect_from` claims into
a one-hop table: a source may not be a live route and no source is claimed
twice, so chains and cycles are impossible by construction. The site's serving
layer consumes the registry; the gate validates it against the live routes.
