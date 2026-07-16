# The public site — discern.sh

The public-facing pages for discern, served from this repository so the same
gate that checks the engine checks the site
([ADR 0129](../_adr/0129-site-lives-in-repo-behind-one-fetch-handler.md)).
Contributor-facing: this subtree is not bundled into `discern help`.

## Shape

Everything lives under [`site/`](../../../site/):

| Piece                                                     | Role                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`site/serve.ts`](../../../site/serve.ts)                 | The one fetch handler: routes, reader negotiation, static fallback, 404s. |
| [`site/main.ts`](../../../site/main.ts)                   | Production entrypoint: a `Deno.serve` over the handler for Deno Deploy.   |
| [`site/dev.ts`](../../../site/dev.ts)                     | Loopback-only local runner and source-driven rebuild watcher.             |
| [`site/build.ts`](../../../site/build.ts)                 | Emits selected package runtimes and the static composition pages.         |
| [`site/build_inputs.ts`](../../../site/build_inputs.ts)   | The site-owned input boundary that triggers a watched build.              |
| [`site/design_system.ts`](../../../site/design_system.ts) | Canonical route bundles, package selections, assets, and theme.           |
| [`site/docs.ts`](../../../site/docs.ts)                   | The `/docs` section — see [the-docs-section.md](the-docs-section.md).     |
| [`site/pages/`](../../../site/pages/)                     | Hand-authored editions and ignored build output served by the handler.    |
| [`site/page-src/`](../../../site/page-src/)               | Authored sources for generated static pages and their composition styles. |
| [`site/text/discern.txt`](../../../site/text/discern.txt) | The plaintext edition — DISCERN(1) as a man-style text document.          |

The routes, from the handler's exported `PAGES` table:

| Route                  | Page                                   | Text client receives                     |
| ---------------------- | -------------------------------------- | ---------------------------------------- |
| `/`                    | the generated design-system homepage   | the plaintext edition                    |
| `/agents`              | the agent's manual                     | the plaintext edition                    |
| `/start`               | the prompt-builders edition            | the same HTML                            |
| `/careers`             | the careers page                       | the same HTML                            |
| `/design-system-demo`  | the generated design-system experiment | the same HTML                            |
| `/content-design-demo` | the generated long-form content atlas  | the same HTML                            |
| `/docs/…`              | the rendered manual                    | the page's raw Markdown                  |
| `/llms.txt`            | —                                      | the plaintext edition plus a docs index, |
|                        |                                        | for every reader                         |

## Reader negotiation

A browser declares `text/html` in its `Accept` header; nothing else reliably
does. On `/` and `/agents` the handler serves the plaintext edition to clients
that omit `text/html` and either match a known text tool (curl, wget, and
friends) or explicitly ask for `text/plain`. So `curl discern.sh` prints the
agent's manual, and the same URL in a browser renders the illustrated edition.
Negotiated responses carry `Vary: Accept, User-Agent`.

## Guards

[`tests/site_serve_test.ts`](../../../tests/site_serve_test.ts) iterates the
exported `PAGES` table — every declared route must serve its page, negotiable
routes must serve the plaintext edition to text clients, and the plaintext file
itself must exist. A page added to the table auto-enrols; a route without its
file fails the gate.
[`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) does the same for
the docs section by iterating the discovered tree — rendering, negotiation,
search-index and llms.txt coverage, and link integrity all auto-enrol a new map
leaf.
[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts)
drives the ignored-output, exact-dependency, bundle selection, local asset,
licence, component-enrolment, and static-runtime guards from the published
package manifest and Discern's selection table.
[`tests/site_development_test.ts`](../../../tests/site_development_test.ts)
guards loopback-only development servers, the browser-facing localhost URL, and
the source boundary used by watch mode.

## Operating it

[publishing.md](publishing.md) covers running the site locally and deploying it
to production.

## Current state & gotchas

- Three older pages load Tailwind from a CDN and fonts from Google Fonts.
  [`project/TODO.md`](../../TODO.md) tracks self-hosting both before launch.
  This applies to `/agents`, `/start`, and `/careers`; `/` and both composition
  atlases use compiled CSS and self-hosted assets with no third-party runtime
  request.
- `mockups/landing/` is the design archive. The homepage replaced in July 2026
  remains there as `previous-homepage-2026-07-16.html`; archived pages are never
  served or kept in sync with the live edition.
- The generated homepage and two composition atlases are the exceptions to
  `site/pages/` being hand-authored and self-contained. Their sources live in
  `site/page-src/`; `deno task site:build` owns their ignored HTML and
  design-system assets under `site/pages/`, and Deno Deploy runs that task
  before starting the handler.
- [the-design-system.md](the-design-system.md) records the external dependency,
  thin integration, bundle, and page-composition boundaries.
