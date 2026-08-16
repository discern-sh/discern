---
aliases:
  - discern.sh
  - website internals
  - public site
  - site architecture
---

# The public site — discern.sh

The public pages for discern live in this repository, so the project's final quality check (the Gate) checks the site and the Engine together ([ADR 0129](../_adr/0129-site-lives-in-repo-behind-one-fetch-handler.md)). This subtree is for contributors and is not bundled into `discern docs`.

## Shape

The site source lives under [`site/`](../../../site/):

| Piece                                                             | Role                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`site/serve.ts`](../../../site/serve.ts)                         | Fetch handler for routes, reader negotiation, static fallback, and 404s.         |
| [`site/main.ts`](../../../site/main.ts)                           | Production entrypoint: a `Deno.serve` over the handler for Deno Deploy.          |
| [`site/dev.ts`](../../../site/dev.ts)                             | Loopback-only local runner and source-driven rebuild watcher.                    |
| [`site/build.ts`](../../../site/build.ts)                         | Emits selected package bundles and the static homepage shell.                    |
| [`site/build_inputs.ts`](../../../site/build_inputs.ts)           | The site-owned input boundary that triggers a watched build.                     |
| [`site/marketing_pages.ts`](../../../site/marketing_pages.ts)     | Canonical marketing routes, outputs, authored sources, and prose registers.      |
| [`site/brand.ts`](../../../site/brand.ts)                         | Canonical homepage metadata, favicon route, and drawn-mark geometry.             |
| [`site/design_system.ts`](../../../site/design_system.ts)         | Canonical route bundles, package selections, assets, and theme.                  |
| [`site/theme.ts`](../../../site/theme.ts)                         | Shared pre-paint theme bootstrap and asset paths for site and docs pages.        |
| [`site/docs.ts`](../../../site/docs.ts)                           | The `/docs` section. See [the-docs-section.md](the-docs-section.md).             |
| [`site/seo.ts`](../../../site/seo.ts)                             | Canonical metadata, redirects, discovery files, and security policy.             |
| [`site/security.ts`](../../../site/security.ts)                   | Security-reporting coordinates and the Request for Comments (RFC) 9116 response. |
| [`scripts/site_smoke.ts`](../../../scripts/site_smoke.ts)         | Process-level crawl for local and deployed release artifacts.                    |
| [`scripts/site_prose_lib.ts`](../../../scripts/site_prose_lib.ts) | Shared visible-prose projection for the site scope and Standards.                |
| [`site/pages/`](../../../site/pages/)                             | Static assets and ignored build output served by the handler.                    |
| [`site/page-src/`](../../../site/page-src/)                       | Authored sources for generated static pages and their composition styles.        |
| [`site/text/discern.txt`](../../../site/text/discern.txt)         | The plaintext `llms.txt` edition, following llmstxt.org.                         |

The marketing routes originate in `MARKETING_PAGES`; the handler derives its exported `PAGES` table from that registry:

| Route                       | Page                             | Text client receives                     |
| --------------------------- | -------------------------------- | ---------------------------------------- |
| `/`                         | the generated homepage           | the plaintext edition                    |
| `/docs/…`                   | the rendered manual              | the page's raw Markdown                  |
| `/docs/decisions/…`         | project-history decision records | the record's raw Markdown                |
| `/llms.txt`                 | —                                | the plaintext edition plus a docs index, |
|                             |                                  | for every reader                         |
| `/llms-full.txt`            | —                                | the complete public Markdown projection  |
| `/sitemap.xml`              | —                                | canonical HTML URLs from the route model |
| `/robots.txt`               | —                                | crawler policy plus the sitemap address  |
| `/.well-known/security.txt` | —                                | vulnerability-reporting coordinates      |

## Reader negotiation

A browser declares `text/html` in its `Accept` header. Other clients do not do so reliably. On `/`, the handler serves the plaintext edition to clients that omit `text/html` and either match a known text tool, such as curl or wget, or explicitly ask for `text/plain`. `curl discern.sh` therefore prints the machine edition, while the same web address in a browser renders the homepage shell. Negotiated responses carry `Vary: Accept, User-Agent`.

## URL and response contract

Production's canonical origin is `https://discern.sh`, and page URLs have no trailing slash. Hypertext Transfer Protocol (HTTP), `www`, `.html`, trailing-slash, and `index.html` variants resolve with a 308 before routing. The same hop includes a historical redirect. Destination pages own `redirect_from`, while section-level moves live in `STATIC_REDIRECTS`. Both automatically cover `.md`. The combined registry refuses dead targets, collisions, chains, and loops ([ADR 0144](../_adr/0144-canonical-site-urls-and-one-hop-redirects.md)).

### Canonical public routes

The public address set freezes at launch. Before launch, experimental pages may be removed without creating redirects or tombstones. After launch, adding a page extends the contract. Renaming, moving, or removing a page does not erase its old address.

[`liveHtmlRoutes(site)`](../../../site/serve.ts) returns the complete canonical HTML set: the keys of `PAGES` plus `DocsSite.sitemapRoutes`. Those registries are the authority for the route list. The live registries contain 354 routes as of August 16, 2026:

| Source               | Current routes                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static pages         | `/`                                                                                                                                                                    |
| Docs index           | `/docs`                                                                                                                                                                |
| Product instructions | The 77 routes in the section table below.                                                                                                                              |
| Project history      | `/docs/decisions` plus `/docs/decisions/<file-stem>` for each of the 274 published records discovered under `_adr/`, including its archive; 145 existed at the freeze. |

Each product-instructions row records its section landing and, after the colon, every leaf appended to that route:

| Section route              | Frozen leaf suffixes                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/docs/orientation`        | `concepts`, `design-principles`, `glossary`, `system-map`, `the-practice`, `trust-and-data`                                                                                                                                                                                                                    |
| `/docs/getting-started`    | `after-setup`, `faq`, `quickstart`, `tasks`, `upgrade-discern`, `walkthrough`                                                                                                                                                                                                                                  |
| `/docs/quality-gate`       | `ci`, `concurrent-test-runs`, `coupling`, `improvement`, `pattern-investigations`, `patterns`, `patterns-decision-evidence`, `practice-stats`, `proof-notes`, `standards`, `strand-detection`, `the-proof`, `tidy`, `validation-findings`, `when-the-gate-fails`                                               |
| `/docs/worktrees`          | `acceptance-recovery`, `awaiting-the-fleet`, `desk-tips`, `drop-recovery`, `hand-work-back`, `identity-and-env`, `landing-authority`, `lifecycle`, `multi-repo-workspaces`, `reappeared-worktree-paths`, `reclaiming-contained-worktrees`, `status`, `team-workflow`, `the-desk`, `the-resources`, `the-trunk` |
| `/docs/agent-instructions` | `compile-and-check-instructions`, `write-project-instructions`                                                                                                                                                                                                                                                 |
| `/docs/skills`             | `author-a-skill`, `bundled-skills`, `customize-or-exclude`, `teach-the-project`, `what-a-skill-is`                                                                                                                                                                                                             |
| `/docs/agent-integrations` | `claude-code`, `codex`, `cursor`, `gemini`, `github-copilot`                                                                                                                                                                                                                                                   |
| `/docs/reference`          | `artifact-ownership`, `cli-reference`, `config-reference`, `crash-reports`, `environment-variables`, `logbook-lifecycle`, `mcp-and-results`, `mcp-call-duration`, `platforms-and-prereqs`, `project-payload-license`, `proof-note-format`, `result-surfaces`, `temp-files-and-retention`, `the-logbook`        |

The stable non-HTML endpoints are `/docs/index.json`, `/install`, `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, and `/.well-known/security.txt`. `/install` serves the repository's own `install.sh` byte-for-byte and joined the set with ADR 0156. `/docs.md` and the `.md` form of every instructions and decision route share the corresponding canonical HTML page's identity and redirect behavior.

A leaf or decision rename puts its old path in the destination page's `redirect_from`. A section-prefix or static-page move adds every displaced path to `STATIC_REDIRECTS`. A heading rename retains the old fragment as an alias anchor. A known URL removed without a replacement needs an explicit tombstone and a 410. The prelaunch route set creates no redirect debt.

Every successful HTML response receives a canonical link, bounded description, Open Graph and Twitter fields, and the static branded card. Docs pages and the homepage place `◮` beside `discern` in their brand and link `/assets/favicon.svg`. The favicon and social card draw the half-filled triangle from Scalable Vector Graphics (SVG) paths. The social card carries the homepage's “A bolder way to build” identity; the favicon switches its foreground color with the browser theme ([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md)). Docs pages add a `BreadcrumbList`, and the landing page adds a `SoftwareApplication`. Explicit Markdown responses point at their HTML canonical and carry `noindex, follow`.

Every response, including assets, redirects, and errors, carries the same security baseline: a nonce-based same-origin Content Security Policy (CSP), `nosniff`, no-referrer, permissions restrictions, and framing denial. The handler adds a nonce to inline theme bootstraps. The policy admits no third-party resource origins.

Unknown routes and missing files return 404. Use 410 for a known public address retired without a replacement and entered as an explicit tombstone. There are no tombstones before launch. When renaming a published heading, keep its old fragment as an explicit alias anchor in the page because fragments do not reach this handler.

## Guards

[`tests/brand_mark_test.ts`](../../../tests/brand_mark_test.ts) pins the text mark's code point and the README title. [`tests/site_serve_test.ts`](../../../tests/site_serve_test.ts) iterates the exported `PAGES` table. Every declared route must serve its page, include the shared favicon, and negotiate the plaintext edition where configured. [`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) checks the current hero and its nine composition slots, then checks the complete signed-off sequence preserved at `/old`: one `h1`, the compact Standard trajectory, the four full specimens' exclusion, the install command as text, design-system markup, local assets, and no React runtime. Its structural layout detectors reject viewport-scaled grid-gap shorthands and numbered headings whose decoration indents the heading away from the content below. [`tests/site_copy_prompt_test.ts`](../../../tests/site_copy_prompt_test.ts) executes the page's vanilla Copy-prompt controller, pins the exact clipboard payload, proves the static prompt survives without JavaScript, and refuses external requests. The route test pins the favicon's theme-aware SVG geometry. A page added to the registry enrolls automatically; a route without its file fails the Gate.

[`tests/site_prose_test.ts`](../../../tests/site_prose_test.ts) binds serving, building, and public prose to `MARKETING_PAGES`. The shared projection removes markup, attributes, code, artefact data, and duplicate rendered strings before Vale sees the declared brand register. The `site` scope blocks error-severity findings. The `site_prose` Standard holds the launch density at 10 alerts across 1,437 projected words, or 6.96 per 1,000 words; `site_reading_grade` holds the same corpus at 9.33. Both ceilings may only fall. Run `deno task site:prose-check` for the blocking pass, `deno task site:prose` for the density, and `deno task site:reading-grade` for the reading grade.

[`tests/site_docs_test.ts`](../../../tests/site_docs_test.ts) iterates the discovered Map projection. Rendering, shared branding, pristine negotiation, command-line interface (CLI) and Model Context Protocol (MCP) parity, search-index and llms coverage, and link integrity all enroll a new Map leaf automatically. [`tests/security_disclosure_test.ts`](../../../tests/security_disclosure_test.ts) binds the human policy and RFC 9116 response to one disclosure registry and fails before its expiry grows stale. [`tests/site_smoke_test.ts`](../../../tests/site_smoke_test.ts) starts the production handler on a real local socket. It drives [`scripts/site_smoke.ts`](../../../scripts/site_smoke.ts) across every HTML and Markdown route, internal link and anchor, metadata field, security response, redirect variant, machine projection, 404, and method refusal.

The design-system runtime test drives the ignored-output, exact-dependency, bundle-selection, local-asset, license, component-enrollment, and static-runtime guards from the published package manifest and discern's selection table. [`tests/site_development_test.ts`](../../../tests/site_development_test.ts) guards loopback-only development servers, the browser-facing localhost address, and the source boundary used by watch mode. [`tests/site_seo_test.ts`](../../../tests/site_seo_test.ts) derives from the live route set and pins canonical redirects, redirect-registry behavior, sitemap parity, metadata, machine-edition headers, llms-full, the social card's mark geometry, and every security-header response class. [`tests/site_release_deploy_test.ts`](../../../tests/site_release_deploy_test.ts) keeps the sole production deploy inside the release-tag workflow.

## Operating it

[publishing.md](publishing.md) covers running the site locally and deploying it to production.

## Current state & gotchas

- The homepage source lives in `site/page-src/` and uses the same system-aware theme bootstrap and reversible two-state controller as the docs shell. A visitor override stays pinned until the next chosen theme matches the current system preference, which clears it and resumes system following. `deno task site:build` owns its ignored HTML and design-system assets under `site/pages/`, and Deno Deploy runs that task before starting the handler.
- [the-design-system.md](the-design-system.md) records the external dependency, thin integration, and bundle boundary.
- [design-system-consumption.md](design-system-consumption.md) records static page composition, build commands, and consumer guards.
