# The docs section

`/docs` renders the same documentation tree `discern help` serves. Discovery is
the engine's own `discoverDocs`, and the publish boundary is
`BUNDLED_PUBLIC_DOC_DIRS` in [`src/lib/paths.ts`](../../src/lib/paths.ts) — the
allowlist that already decides which map subtrees ship inside every customer
binary ([ADR 0130](../_adr/0130-docs-site-renders-the-help-tree.md)). There is
no site-side content list: a leaf added to a public tier appears in the nav, the
search index, llms.txt, and the test suite with no site change.

## Sourcing and routes

[`site/docs.ts`](../../site/docs.ts) filters the discovered tree to the
allowlisted sections (honouring a leaf's `publish: false` frontmatter), then
derives routes by stripping each tier's reading-order prefix —
`/docs/quality-gate/the-receipt`, never `/docs/20-quality-gate/…` — so
renumbering a tier cannot break an inbound link. A section's `README.md` becomes
its landing page.

| Surface               | Content                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `/docs`               | Section index with derived descriptions.                          |
| `/docs/<s>/<leaf>`    | The rendered leaf: nav, breadcrumbs, contents rail, pager.        |
| `/docs/<s>/<leaf>.md` | The pristine Markdown bytes, for any reader.                      |
| `/docs/index.json`    | The search-palette index: routes, titles, descriptions, headings. |
| `/llms.txt`           | The plaintext edition plus a generated docs listing.              |

## Rendering

Markdown renders at request time and caches for the process lifetime — files are
immutable per deployment, so the cache never invalidates. Syntax highlighting is
deliberately monochrome (weights and shades of ink): in this design family,
color belongs to verdicts alone. Relative links rewrite to routes when the
target is published, and to the repository on GitHub when it is not (ADRs,
internal tiers, source files), so no reference dead-ends.

The browser shell is a design-system consumer: the server renders semantic HTML
on the documented `.ds-*` classes, loading the generated tokens and component
styles plus the self-hosted fonts from `/assets/design-system/`. Page-specific
composition lives in `site/pages/assets/docs.css` and behaviour in
`site/pages/assets/docs.js`; no React runtime ships.

## Reader negotiation

Every docs route negotiates like the rest of the site: a text client receives
the leaf's raw Markdown — the same bytes `discern help <leaf> --raw` prints —
and any reader can force it with the `.md` suffix. Negotiated responses carry
`Vary: Accept, User-Agent`.

## Guards

[`tests/site_docs_test.ts`](../../tests/site_docs_test.ts) iterates the
discovered site, so every leaf auto-enrols: it must render for a browser, serve
pristine Markdown to text clients and via `.md`, appear in the search index and
llms.txt, and keep every local link resolvable after rewriting. Unpublished
tiers are asserted absent by walking the map directory's complement of the
allowlist, so a new internal tier enrols in the 404 guard the day it is created.
