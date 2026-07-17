# The docs section

`/docs` renders the same product-guidance tree `discern help` serves. Discovery
is the engine's own `discoverDocs`, and the publish boundary is
`BUNDLED_PUBLIC_DOC_DIRS` in [`src/lib/paths.ts`](../../../src/lib/paths.ts) —
the allowlist that already decides which map subtrees ship inside every customer
binary ([ADR 0130](../_adr/0130-docs-site-renders-the-help-tree.md)). A leaf
added to a public tier appears in the nav, the search index, llms.txt, and the
test suite automatically. The map's decision records use the same document model
through a separate, explicitly historical route family
([ADR 0143](../_adr/0143-decisions-on-the-web.md)).

## Sourcing and routes

[`site/docs.ts`](../../../site/docs.ts) filters the discovered tree to the
allowlisted sections, composed with the document model's `isPublicDoc` predicate
— `publish: false` is the sole page-level withhold, shared with every other
published surface
([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)) —
then derives routes by stripping each tier's reading-order prefix —
`/docs/quality-gate/the-receipt`, never `/docs/20-quality-gate/…` — so
renumbering a tier cannot break an inbound link. A section's `README.md` becomes
its landing page and the explicit first `Overview` child in the section nav.
Pages stay in the document model's README-first sequence: explicit frontmatter
`order` wins, and a missing order falls back to the README's structured sibling
link order. The renderer never sorts them again. A build guard refuses a
configured public section without a README or a published leaf without a
section, then verifies that flattening the nav reproduces the complete public
page projection.

The wider model — the strict frontmatter schema, the redirect registry, and the
per-entry metadata the site reads — is documented in
[the document model](../50-engine-internals/the-document-model.md).

| Surface               | Content                                                       |
| --------------------- | ------------------------------------------------------------- |
| `/docs`               | Section index with derived descriptions.                      |
| `/docs/<s>/<leaf>`    | The rendered leaf: nav, breadcrumbs, contents rail, pager.    |
| `/docs/<s>/<leaf>.md` | The pristine Markdown bytes, for any reader.                  |
| `/docs/decisions`     | Project-history index derived from every numbered ADR.        |
| `/docs/decisions/<n>` | One current or visibly superseded decision record.            |
| `/docs/index.json`    | The client-side search index over published product guidance. |
| `/llms.txt`           | The plaintext edition plus a generated docs listing.          |

`DocsSite.sitemapRoutes` is the canonical HTML route source for the sitemap: the
docs landing, every public guidance page, the decisions index, and every
decision record. Decision routes deliberately stay out of `site.pages`, the
guidance-only source used by search and llms.

## Search

[`site/search.ts`](../../../site/search.ts) builds the index from the stripped
public projection. It applies `isPublicDoc` before reading a source and excludes
the decision section independently of the guidance-only caller. Each record
keeps title, `aliases`, headings, code terms, and body text separate so the
client can rank them in that order; descriptions share the body weight. Exact
phrases receive a further boost.

The browser fetches the index once and searches it locally, with no third-party
code, query telemetry, or query persistence. Results carry a contextual body
excerpt or page description and may link directly to a matching heading. An
empty result points readers toward commands, config keys, and exact error text.

## Rendering

Markdown renders at request time and caches for the process lifetime. The
frontmatter block and inline ADR citation groups are stripped before rendering —
human-rendered prose carries neither, while the `.md` editions stay pristine
([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)); the cited decisions
remain available per page as `DocEntry.citedAdrs` and render as an exact,
deduplicated `Related decisions` footer. A section landing appends its canonical
leaf index from the pages' model-owned title, description, and order, so the web
listing enrols a new leaf automatically. Authored table/list indexes are
suppressed on the rendered landing once the derived replacement exists; mixed
reference and "see also" blocks remain. Syntax highlighting is deliberately
monochrome: in this design family, color belongs to verdicts alone. Relative
links rewrite to guidance routes or on-site decision routes when the target is
published, and to the repository on GitHub for internal tiers and source files,
so no reference dead-ends.

The decision index and every record carry a server-rendered `Project history`
notice that directs readers to the manual for current guidance. Superseded
records are marked both in the index and on the record page. The family is
linked from the docs colophon rather than the main sidebar, and raw `.md`
editions retain each record's bytes.

The browser shell is a design-system consumer: the server renders semantic HTML
on the documented `.discern-*` classes, loading the generated tokens and
component styles plus the self-hosted fonts from the minimal
`/assets/design-system/docs/` bundle. Page-specific composition lives in
`site/pages/assets/docs.css` and behaviour in `site/pages/assets/docs.js`.
Rendered Markdown thematic breaks use the editorial rule treatment with a
centred `◮`, discern's mark
([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md)).

## Accessibility and resilience

WCAG 2.2 AA is the shell's working target. The mobile drawer and search palette
move focus into their modal surfaces, make the background inert, trap focus,
close on Escape, and restore focus to the opener. Search exposes its labelled
input, result choices, active option, and result count to assistive technology.

Heading permalinks are siblings of their headings, so they do not change the
heading name. The drawer trigger reports whether it opens or closes navigation,
the theme control reports the action and current pressed state, and copy
controls announce success or failure. Drawer and search transitions honour
reduced motion. Without JavaScript, mobile navigation stays in the document flow
while controls that require scripting remain hidden.

## Reader negotiation

Every docs route negotiates like the rest of the site: a text client receives
the leaf's raw Markdown, and any reader can force it with the `.md` suffix.
Negotiated responses carry `Vary: Accept, User-Agent`.

## Guards

[`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) iterates the
discovered site, so every leaf auto-enrols: it must render for a browser, serve
pristine Markdown to text clients and via `.md`, appear in the nav, search
index, and llms.txt, and keep every local link resolvable after rewriting. The
same suite walks the directory-derived ADR set, pins history labels and
superseded markers, verifies citation-count parity in every related-decision
footer, and keeps decision routes absent from search and llms. Synthetic
projection fixtures prove that a missing section README or a section-less
published leaf fails the build. Unpublished tiers are asserted absent by walking
the map directory's complement of the allowlist, so a new internal tier enrols
in the 404 guard the day it is created.

[`tests/site_search_test.ts`](../../../tests/site_search_test.ts) pins exact
command, config-key, error-string, and alias searches against synthetic source
content. It also guards the field weights, snippets, strict publish boundary,
decision exclusion, and no-telemetry policy.

[`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts)
runs axe against representative guidance and decision pages, including the
search modal, and rejects serious or critical WCAG findings. Focused contract
checks cover responsive, client-generated, reduced-motion, and no-JavaScript
states that the automated audit cannot activate. The Markdown renderer's list
tests guard valid nested-list semantics found by this audit.
