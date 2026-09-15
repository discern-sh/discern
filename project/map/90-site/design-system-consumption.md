---
aliases:
  - design system integration
  - static rendering
  - site components
  - component consumption
---

# Design-system consumption

## Static production, typed authoring

The public marketing sources can compose the package's typed React adapters in [`site/page-src/`](../../../site/page-src/). The build renders those compositions with `renderToStaticMarkup` and writes static Hypertext Markup Language (HTML). React runs only during authoring and build; the browser receives static output with no React bundle, hydration, or client framework ([ADR 0135](../_adr/0135-site-pages-use-build-time-react-and-static-runtime.md)).

Layout and display components render completely as semantic HTML. The package emits selection-scoped, framework-neutral enhancements for reusable component behavior. Page behavior remains page-owned. Product copy, routes, commands, bespoke artwork, docs rendering, and composition Cascading Style Sheets (CSS) remain in discern.

## Workflow projections in the manual

The Markdown remains the complete manual for terminal, Model Context Protocol (MCP), negotiated text, `.md`, search, and browser readers. Some source blocks carry explicit `discern-workflow` HTML-comment markers around ordinary Markdown. [`site/workflow.ts`](../../../site/workflow.ts) parses those marked blocks and emits the package's semantic Procedure, Command, Result summary, Path reference, Ownership badge, and Branch choice anatomy for browser pages. It reads meaning only from the explicit markers.

[`site/workflow_registry.ts`](../../../site/workflow_registry.ts) is the canonical directive vocabulary and component selection. Each member must have a strict parser, a real source example, and a rendered root covered by the bundle tests. Malformed or unknown markers fail at the source path. The decision and rejected alternatives are recorded in [ADR 0205](../_adr/0205-browser-workflow-semantics-are-explicit-markdown-projections.md).

The marked Markdown is the authority for every command and outcome in the projection. When CSS or JavaScript is unavailable, the server HTML still states the complete procedure, result, ownership, and next action. Site-owned JavaScript adds the Command copy control in the package's documented slot. The production graph remains framework-free.

[`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the reusable public lockup. The component uses the `md` preset and renders `discern` beside the decorative Unicode mark in the `mono` typeface. During `site:build`, the builder writes the tagline-free lockup to `site/pages/fragments/brand.html`. The docs shell reads that static fragment into its top bar without importing the React adapter. Marketing compositions can import the same adapter.

## The homepage composition

[`site/page-src/landing.tsx`](../../../site/page-src/landing.tsx) owns the homepage composition, route metadata boundary, and asset selection. It presents a monochrome Harmonic backdrop with the launch introduction, a Get started link to `/docs/start`, and three benefit blocks. The manual holds the detailed product information.

[`site/page-src/campaign.tsx`](../../../site/page-src/campaign.tsx) owns the route-neutral campaign shell, standard header and footer adapters, product-name treatment, theme control, `COPY_PROMPT_TEXT`, and accessible Copy prompt markup. A composition supplies the header navigation, actions, footer destinations, and an unconstrained body. [`site/page-src/campaign.css`](../../../site/page-src/campaign.css) carries only the stable product-name and footer treatments. [`site/page-src/copy-prompt.js`](../../../site/page-src/copy-prompt.js) independently reveals every shared Copy prompt control, copies the exact visible instruction with a bounded clipboard attempt, announces success, resets its two-word default label, and selects the source text when clipboard access fails. The prompt stays visible and selectable when JavaScript is unavailable. The shared `/assets/theme.js` separately wires every `[data-theme-toggle]` control.

[`site/page-src/landing.css`](../../../site/page-src/landing.css) owns the homepage layout and responsive styles. Component behavior and artwork come from the selected design-system runtime; the homepage has no page-specific browser script. [`site/brand.ts`](../../../site/brand.ts) owns the homepage's title and description.

## The For Agents composition

[`site/page-src/agents.tsx`](../../../site/page-src/agents.tsx) contains the public agent-native composition at `/agents`. It moves from context economy and callable operations through session continuity, isolated work, human authority, provider continuity, deterministic boundaries, and exact machine routes. Its provider compiler derives labels, instruction files, and marks from the same total agent and provider registries as the integrations themselves. The route therefore gains a newly supported provider without a copied marketing list. `/llms.txt` is the machine-readable handoff; the campaign has no overlapping Markdown companion.

[`site/page-src/agents.css`](../../../site/page-src/agents.css) owns its `.agents-*` composition selectors. The page composes static package components through their typed slots and published CSS variables; consumer selectors never reach into package-owned classes. It uses the shared system-aware theme bootstrap without presenting its own theme toggle. [`site/page-src/renderers.ts`](../../../site/page-src/renderers.ts) exhaustively maps each `MARKETING_PAGES` route to its static renderer, so adding a registry member without a composition fails type checking.

## The trust composition

[`site/page-src/trust.tsx`](../../../site/page-src/trust.tsx) is the concise evaluator gateway at `/trust`. It frames local control, inspectable gate and Proof evidence, and the inspectable map without becoming another product or security authority. Every material statement is selected from [`PUBLIC_CLAIMS`](../../../scripts/brand/claims.ts), and each evidence card links to the exact manual or public-Map destination that owns the detail.

[`site/page-src/trust.css`](../../../site/page-src/trust.css) owns only its `.trust-*` composition selectors. The page is static, has no page-specific JavaScript, and shares the compositions bundle, theme bootstrap, skip-link contract, metadata path, and generated branding with the other marketing pages.

## The release composition

The [human release page](releases.md#the-human-page) is rendered at request time from the shared comparison model. It uses the same package through its public semantic HTML contract, preserving a framework-free handler and browser. The version card and installer command use package components; the reading rail and responsive rhythm belong to the release stylesheet. All comparison states and complete notes work without scripts.

## Public-site prose

[`site/marketing_pages.ts`](../../../site/marketing_pages.ts) enrolls every public marketing composition in building, serving, route discovery, runtime checks, and public prose checks. Each member names its output, authored source, register, negotiation policy, and prose policy. A guarded page joins [`scripts/site_prose_lib.ts`](../../../scripts/site_prose_lib.ts), the site scope, and the site prose standards through that registration. The homepage and `/trust` use the brand register; `/agents` uses the public agent register.

The projection keeps the authored blocks a visitor reads and removes markup, attributes, code, artefact data, and repeated rendered copies. It stages each page under its declared register so the generated brand rules apply. `deno task site:prose-check` blocks Vale errors. `deno task site:prose` emits the alert numerator and exact word denominator consumed by `[standards.site_prose]`; `deno task site:reading-grade` reads the same projection for `[standards.site_reading_grade]`.

The generic component catalog, examples, component implementation, assets, and package tooling live only in the package repository. The discern site does not mount `/style-guide/` in development or production.

## Development-only artefact specimens

[`site/page-src/specimens.tsx`](../../../site/page-src/specimens.tsx) composes the complete delegation, commissioning, Standard, and Proof artefacts from the published design-system primitives. [`site/page-src/specimens.css`](../../../site/page-src/specimens.css) owns their editorial layout without targeting package-owned `.discern-*` selectors. Each artefact renders inside fixed light and dark token roots, side by side where space permits, so the owner can review both themes in the same document. This sheet is the retained source for full artefacts removed or simplified on the homepage.

[`site/specimens.ts`](../../../site/specimens.ts) builds the normal static design-system assets and serves the specimen document plus its composition CSS directly from source on the worktree's local port:

```sh
deno task site:specimens
```

The command prints the preview address. The sheet is static HTML and CSS with the shared theme controller as its only external browser script. It is absent from `PAGES`, returns `404` through the production handler, and carries `noindex` response headers. [`tests/site_specimens_test.ts`](../../../tests/site_specimens_test.ts) guards that development boundary, the paired themes, the evidence text, unique document identifiers, absence of a browser framework runtime, and the rule that monospace appears only on the product name and code.

The same local development server exposes the internal art archive at `/art/`; `deno task site:art` is the memorable alias for starting it. [`BROWSER_ARTWORKS`](../../../art/browser/registry.ts) owns the approved browser studies, their order, labels, recorded source commits, and stylesheet enrollment; a member still under review carries an all-zero placeholder until its source head is pinned. Its neighboring typed renderer table is exhaustive over that membership. [`site/page-src/art-gallery.tsx`](../../../site/page-src/art-gallery.tsx) derives the paired light/dark gallery and projects the terminal registries from [`art/terminal/`](../../../art/terminal/) into static terminal mockups below it. Geometry and motion remain artwork-owned rather than passing through a common animation framework.

Every browser study keeps its TypeScript JSX (TSX) renderer and art-only CSS together under [`art/browser/`](../../../art/browser/). The page chrome remains in [`site/page-src/art-gallery.css`](../../../site/page-src/art-gallery.css). The figure-series studies named by the registry's `FIGURE_SERIES_SLUGS` export also share one foundation stylesheet, [`art/browser/figures.css`](../../../art/browser/figures.css), holding the series' beat, easing curves, stroke scale, opacity steps, palette bindings, and reduced-motion switch. [`tests/art_browser_gallery_test.ts`](../../../tests/art_browser_gallery_test.ts) guards `/art/` as development-only, derives stylesheet coverage from the registry, proves prospective-member enrollment, and rejects browser framework runtime. Each study's `browser_art_*_test.ts` file retains its own geometry and motion contracts, and [`tests/browser_art_figures_test.ts`](../../../tests/browser_art_figures_test.ts) holds every enrolled figure to the shared metre: token-only color, one phrase clock on a whole beat multiple, motion loops that close where they open, and a bounded animated-property set.

## Consumer guards

[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) reads the public `packageManifest` and the site selection table. It guards:

- the exact config and lockfile coordinate, public imports, and absence of internal or registry-path reach-through;
- each bundle's requested selection and package-resolved dependency closure;
- every package browser script emitted for a selection being loaded by every route that uses that bundle;
- runtime-manifest schema 4 and Appearance-scope selection;
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font licenses, and the absence of a React browser runtime; and
- the rule that consumer styles may compose package classes while leaving component-owned `.discern-*` selectors untouched.

The published manifest automatically enrolls new package components and classes. `DESIGN_SYSTEM_BUNDLES` automatically enrolls new site selections and routes.

[`scripts/site_component_coverage.ts`](../../../scripts/site_component_coverage.ts) uses the same authorities to census selected components that have no manifest-owned class in any assigned live route. `[standards.site_component_gaps]` prevents that raw deficit from rising while the site converges on complete use of what it emits. [`tests/site_component_coverage_test.ts`](../../../tests/site_component_coverage_test.ts) keeps every live HTML route inside a selected component boundary.

[`tests/site_workflow_test.ts`](../../../tests/site_workflow_test.ts) ties the directive registry to its source examples, package roots, dependency closure, and pristine raw editions. The canonical-set atlas enrolls the directive set, so a new projection inherits those obligations.

## Build and theme

```sh
deno task site:build   # emit both runtimes and the static marketing shells
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
deno task site:prose-check # run the public-copy Vale gate
deno task site:prose   # measure the pinned public-copy density
deno task site:reading-grade # measure the pinned reading grade
```

Only `site:build` grants `NODE_ENV`, because that build process uses React for static rendering. The long-lived `site` and `watch` server processes do not grant it. A guard rejects React runtime modules in their production entry graph. An unexpected environment read therefore appears as both a permission failure and a test failure.

The package's browser roles default to monochrome. [`SITE_APPEARANCE`](../../../site/appearance.ts) emits the symmetric Appearance scopes. Its root helper uses blue hue 255 by default; a page can select the monochrome projection through [`site/page-src/document.ts`](../../../site/page-src/document.ts). The homepage and release page select monochrome with `data-discern-accent="none"`. The other marketing pages, docs, and the Canon Editor retain the shared blue Accent, while fixed-theme specimen and art roots inherit that hue. Browser Appearance remains separate from terminal theme selection.

The display role prefers Iowan Old Style where the visitor has it, then uses bundled Crimson Pro as its first portable fallback. Inter serves body and interface roles, and JetBrains Mono serves code. The build copies the bundled fonts and SIL Open Font License texts from the selected package asset pack into local generated output. `site/theme.ts` gives every static composition and document page one pre-paint system-preference bootstrap.

`/assets/theme.js` keeps the theme controls in sync with a stored light/dark override or the system preference. Each control names and displays the opposite of the resolved theme; its pressed state reflects the dark selection. The release shell uses this same bootstrap and client, including on invalid-version pages.
