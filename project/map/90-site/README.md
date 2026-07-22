# The public site — discern.sh

The public-facing pages for discern, served from this repository so the same gate that checks the engine checks the site ([ADR 0129](../_adr/0129-site-lives-in-repo-behind-one-fetch-handler.md)). Contributor-facing: this subtree is not bundled into `discern help`.

## Shape

Everything lives under [`site/`](../../../site/):

| Piece                                                     | Role                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`site/serve.ts`](../../../site/serve.ts)                 | Fetch handler for routes, reader negotiation, static fallback, and 404s.  |
| [`site/main.ts`](../../../site/main.ts)                   | Production entrypoint: a `Deno.serve` over the handler for Deno Deploy.   |
| [`site/dev.ts`](../../../site/dev.ts)                     | Loopback-only local runner and source-driven rebuild watcher.             |
| [`site/build.ts`](../../../site/build.ts)                 | Emits selected package bundles and the static composition pages.          |
| [`site/build_inputs.ts`](../../../site/build_inputs.ts)   | The site-owned input boundary that triggers a watched build.              |
| [`site/brand.ts`](../../../site/brand.ts)                 | Canonical text mark, favicon route, and drawn-mark geometry.              |
| [`site/design_system.ts`](../../../site/design_system.ts) | Canonical route bundles, package selections, assets, and theme.           |
| [`site/theme.ts`](../../../site/theme.ts)                 | Shared pre-paint theme bootstrap and asset paths for site and docs pages. |
| [`site/docs.ts`](../../../site/docs.ts)                   | The `/docs` section — see [the-docs-section.md](the-docs-section.md).     |
| [`site/seo.ts`](../../../site/seo.ts)                     | Canonical metadata, redirects, discovery files, and security policy.      |
| [`scripts/site_smoke.ts`](../../../scripts/site_smoke.ts) | Process-level crawl for local and deployed release artifacts.             |
| [`site/pages/`](../../../site/pages/)                     | Hand-authored editions and ignored build output served by the handler.    |
| [`site/page-src/`](../../../site/page-src/)               | Authored sources for generated static pages and their composition styles. |
| [`site/text/discern.txt`](../../../site/text/discern.txt) | The plaintext edition — DISCERN(1) as a man-style text document.          |

The routes, from the handler's exported `PAGES` table:

| Route                  | Page                                   | Text client receives                     |
| ---------------------- | -------------------------------------- | ---------------------------------------- |
| `/`                    | the generated landing page             | the plaintext edition                    |
| `/agents`              | the agent's manual                     | the plaintext edition                    |
| `/start`               | the prompt-builders edition            | the same HTML                            |
| `/careers`             | the careers page                       | the same HTML                            |
| `/design-system-demo`  | the generated design-system experiment | the same HTML                            |
| `/content-design-demo` | the generated long-form content atlas  | the same HTML                            |
| `/docs/…`              | the rendered manual                    | the page's raw Markdown                  |
| `/docs/decisions/…`    | project-history decision records       | the record's raw Markdown                |
| `/llms.txt`            | —                                      | the plaintext edition plus a docs index, |
|                        |                                        | for every reader                         |
| `/llms-full.txt`       | —                                      | the complete public Markdown projection  |
| `/sitemap.xml`         | —                                      | canonical HTML URLs from the route model |
| `/robots.txt`          | —                                      | crawler policy plus the sitemap address  |

## Reader negotiation

A browser declares `text/html` in its `Accept` header; nothing else reliably does. On `/` and `/agents` the handler serves the plaintext edition to clients that omit `text/html` and either match a known text tool (curl, wget, and friends) or explicitly ask for `text/plain`. So `curl discern.sh` prints the agent's manual, and the same URL in a browser renders the illustrated edition. Negotiated responses carry `Vary: Accept, User-Agent`.

## URL and response contract

Production's canonical origin is `https://discern.sh`; page URLs have no trailing slash. HTTP, `www`, `.html`, trailing-slash, and `index.html` variants resolve with a 308 before routing, and a historical redirect is folded into the same hop. Destination pages own `redirect_from`; section-level moves live in `STATIC_REDIRECTS`. Both automatically cover `.md`, and the combined registry refuses dead targets, collisions, chains, and loops ([ADR 0144](../_adr/0144-canonical-site-urls-and-one-hop-redirects.md)).

### Frozen public routes

The public URL set freezes with wave 3A's landing on July 17, 2026. From that landing onward, adding a page extends the contract. Renaming, moving, or removing one does not erase its old address.

The exhaustive canonical HTML set is the result of [`liveHtmlRoutes(site)`](../../../site/serve.ts): the keys of `PAGES` plus `DocsSite.sitemapRoutes`. Those registries remain the single source of truth rather than a second hand-maintained route list. The freeze contained 200 routes. The live registries contain 224 routes as of July 21, 2026:

| Source           | Frozen routes                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static pages     | `/`, `/agents`, `/start`, `/careers`, `/design-system-demo`, `/content-design-demo`                                                                                    |
| Docs index       | `/docs`                                                                                                                                                                |
| Product guidance | The 50 routes in the section table below.                                                                                                                              |
| Project history  | `/docs/decisions` plus `/docs/decisions/<file-stem>` for each of the 166 published records discovered under `_adr/`, including its archive; 145 existed at the freeze. |

Each product-guidance row records its section landing and, after the colon, every leaf appended to that route:

| Section route              | Frozen leaf suffixes                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/docs/orientation`        | `concepts`, `design-principles`, `trust-and-data`, `system-map`, `glossary`                            |
| `/docs/getting-started`    | `quickstart`, `walkthrough`, `after-setup`, `faq`, `upgrade-discern`                                   |
| `/docs/quality-gate`       | `when-the-gate-fails`, `standards`, `the-receipt`, `strand-detection`, `ci`, `improvement`, `coupling` |
| `/docs/worktrees`          | `lifecycle`, `the-resources`, `identity-and-env`, `team-workflow`, `the-desk`                          |
| `/docs/agent-guidance`     | `write-project-guidance`, `compile-and-check-guidance`                                                 |
| `/docs/skills`             | `what-a-skill-is`, `bundled-skills`, `author-a-skill`, `customize-or-exclude`, `teach-the-project`     |
| `/docs/agent-integrations` | `claude-code`, `codex`, `gemini`, `cursor`, `github-copilot`                                           |
| `/docs/reference`          | `cli-reference`, `config-reference`, `mcp-and-results`, `artifact-ownership`, `platforms-and-prereqs`  |

The stable non-HTML endpoints are `/docs/index.json`, `/install`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, and `/robots.txt` — `/install` serves the repository's own `install.sh` byte-for-byte and joined the set with ADR 0156. `/docs.md` and the `.md` form of every guidance and decision route share the corresponding canonical HTML page's identity and redirect behavior.

A leaf or decision rename puts its old path in the destination page's `redirect_from`. A section-prefix or static-page move adds every displaced path to `STATIC_REDIRECTS`. A heading rename retains the old fragment as an alias anchor. A known URL removed without a replacement needs an explicit tombstone and a 410. The freeze creates no retroactive redirect debt for pre-freeze names.

Every successful HTML response receives a canonical link, bounded description, Open Graph and Twitter fields, and the static branded card. Active content pages place `◮` beside `discern` in their brand and link `/assets/favicon.svg`; the empty homepage placeholder keeps the favicon and carries no visible body. The favicon and social card draw the half-filled triangle from SVG paths. The favicon switches its foreground color with the browser theme ([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md)). Docs pages add a `BreadcrumbList`; the landing page adds a `SoftwareApplication`. Explicit Markdown responses point at their HTML canonical and carry `noindex, follow`.

Every response, including assets, redirects, and errors, carries the same security baseline: a nonce-based same-origin CSP, `nosniff`, no-referrer, permissions restrictions, and framing denial. The handler adds a nonce to inline theme bootstraps; third-party resource origins are not admitted.

Unknown routes return 404. A 410 is reserved for a known public URL retired without a replacement and entered as an explicit tombstone. Missing files continue to return 404, and there are no tombstones before launch. When a published heading is renamed, keep its old fragment as an explicit alias anchor in the page; fragments do not reach this handler.

## Guards

[`tests/brand_mark_test.ts`](../../../tests/brand_mark_test.ts) pins the text mark's code point and the README title. [`tests/site_serve_test.ts`](../../../tests/site_serve_test.ts) iterates the exported `PAGES` table: every declared route must serve its page, include the shared favicon, and negotiate the plaintext edition where configured. Content pages also place the project mark beside `discern` in a brand link; the homepage placeholder instead proves its body is empty in [`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts). The route test pins the favicon's theme-aware SVG geometry. A page added to the table auto-enrolls; a route without its file fails the gate. [`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) does the same for the docs section by iterating the discovered tree — rendering, shared branding, pristine negotiation, CLI/MCP parity, search-index and llms coverage, and link integrity all auto-enroll a new map leaf. [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) starts the production handler on a real local socket and drives [`scripts/site_smoke.ts`](../../../scripts/site_smoke.ts) across every HTML and Markdown route, internal link and anchor, metadata field, security response, redirect variant, machine projection, 404, and method refusal. The design-system runtime test drives the ignored-output, exact-dependency, bundle selection, local asset, license, component-enrollment, and static-runtime guards from the published package manifest and Discern's selection table. [`tests/site_development_test.ts`](../../../tests/site_development_test.ts) guards loopback-only development servers, the browser-facing localhost URL, and the source boundary used by watch mode. [`tests/site_seo_test.ts`](../../../tests/site_seo_test.ts) derives from the live route set and pins canonical redirects, redirect-registry safety, sitemap parity, metadata, machine-edition headers, llms-full, the social card's mark geometry, and every security-header response class. [`tests/site_release_deploy_test.ts`](../../../tests/site_release_deploy_test.ts) keeps the sole production deploy inside the release-tag workflow.

## Operating it

[publishing.md](publishing.md) covers running the site locally and deploying it to production.

## Current state & gotchas

- Three older pages still name Tailwind's CDN and Google Fonts in their source. The production CSP admits neither origin, so no visitor request reaches them; their remote Tailwind compilation and fonts are consequently unavailable. [`project/TODO.md`](../../TODO.md) tracks their migration to local compiled assets as a separate launch blocker. `/` and both composition atlases already use compiled CSS and self-hosted assets.
- `mockups/landing/` is the design archive. The two homepages replaced in July 2026 remain there as `previous-homepage-2026-07-16.html` and `previous-homepage-2026-07-18.html`; archived pages stay confined to the archive and preserve their historical content.
- The generated landing page and two composition atlases are the exceptions to `site/pages/` being hand-authored and self-contained. Their sources live in `site/page-src/`, sharing one document skeleton (`document.ts`) and the same system-aware theme bootstrap and controller as the docs shell. `deno task site:build` owns their ignored HTML and design-system assets under `site/pages/`, and Deno Deploy runs that task before starting the handler.
- [the-design-system.md](the-design-system.md) records the external dependency, thin integration, and bundle boundary.
- [design-system-consumption.md](design-system-consumption.md) records static page composition, retained atlases, build commands, and consumer guards.
