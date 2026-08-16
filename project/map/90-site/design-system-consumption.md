---
aliases:
  - design system integration
  - static rendering
  - site components
  - component consumption
---

# Design-system consumption

## Static production, typed authoring

The homepage source can compose the package's typed React adapters in [`site/page-src/`](../../../site/page-src/). The build renders those compositions with `renderToStaticMarkup` and writes static Hypertext Markup Language (HTML). React runs only during authoring and build; the browser receives static output with no React bundle, hydration, or client framework ([ADR 0135](../_adr/0135-site-pages-use-build-time-react-and-static-runtime.md)).

Layout and display components render completely as semantic HTML. The package emits selection-scoped, framework-neutral enhancements for reusable component behavior. Page behavior remains page-owned. Product copy, routes, commands, bespoke artwork, docs rendering, and composition Cascading Style Sheets (CSS) remain in discern.

## Workflow projections in the manual

The Markdown remains the complete manual for terminal, Model Context Protocol (MCP), negotiated text, `.md`, search, and browser readers. Some source blocks carry explicit `discern-workflow` HTML-comment markers around ordinary Markdown. [`site/workflow.ts`](../../../site/workflow.ts) parses those marked blocks and emits the package's semantic Procedure, Command, Result summary, Path reference, Ownership badge, and Branch choice anatomy for browser pages. It reads meaning only from the explicit markers.

[`site/workflow_registry.ts`](../../../site/workflow_registry.ts) is the canonical directive vocabulary and component selection. Each member must have a strict parser, a real source example, and a rendered root covered by the bundle tests. Malformed or unknown markers fail at the source path. The decision and rejected alternatives are recorded in [ADR 0205](../_adr/0205-browser-workflow-semantics-are-explicit-markdown-projections.md).

The marked Markdown is the authority for every command and outcome in the projection. When CSS or JavaScript is unavailable, the server HTML still states the complete procedure, result, ownership, and next action. Site-owned JavaScript adds the Command copy control in the package's documented slot. The production graph remains framework-free.

[`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the reusable public lockup. The component uses the `md` preset and renders `discern` beside the decorative Unicode mark in the `mono` typeface. During `site:build`, the builder writes the tagline-free lockup to `site/pages/fragments/brand.html`. The docs shell reads that static fragment into its top bar without importing the React adapter. A homepage composition can import the same adapter.

## The homepage composition

[`site/page-src/landing.tsx`](../../../site/page-src/landing.tsx) contains the public `/` homepage source. It typesets the signed-off ten-part argument: the ambition-led hero followed by the cultural moment, delegation, commissioning, Standards, the enduring practice, the audience bridge, provider continuity and agent ergonomics, trust and founder credibility, and the closing invitation. The homepage projects the Standard specimen down to its two current-value boxes and graph. The complete delegation, commissioning, Standard, and Proof specimens remain available from [`site/page-src/specimens.tsx`](../../../site/page-src/specimens.tsx) without shipping their dense annotated forms on `/`.

The provider cloud closes the hero and walks the native agent catalog in its canonical order. It reads each label and compact Scalable Vector Graphics (SVG) mark from the provider registry. Each provider also declares an SVG silhouette with a transparent canvas: either the compact mark when it qualifies or a separate first-party asset. Light mode renders the original artwork on its expected field. Dark mode masks every silhouette with the component's semantic mark color and leaves the field transparent. The total provider registries automatically add a new provider to the homepage.

Page-owned composition styles live in [`site/page-src/landing.css`](../../../site/page-src/landing.css). Its `.landing-*` selectors compose the page while component-owned `.discern-*` selectors stay with the package; the consumer-CSS guard below enforces this boundary. [`site/page-src/landing.js`](../../../site/page-src/landing.js) owns the Copy prompt behavior. It reveals each control, copies the exact visible instruction, reports success, and selects the source text when clipboard access fails. The prompt stays visible and selectable when JavaScript is unavailable. The shared `/assets/theme.js` separately wires every `[data-theme-toggle]` control. [`site/brand.ts`](../../../site/brand.ts) owns the page's exact title and description.

## Public-site prose

[`site/marketing_pages.ts`](../../../site/marketing_pages.ts) is the shared authority for marketing routes, output files, authored sources, and prose registers. The builder's renderer table must cover every route in that registry, the handler derives `PAGES` from it, and [`scripts/site_prose_lib.ts`](../../../scripts/site_prose_lib.ts) projects every member into Vale. A future marketing page therefore joins building, serving, the site scope, and both prose Standards through one registration.

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
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font licenses, and the absence of a React browser runtime; and
- the rule that consumer styles may compose package classes while leaving component-owned `.discern-*` selectors untouched.

The published manifest automatically enrolls new package components and classes. `DESIGN_SYSTEM_BUNDLES` automatically enrolls new site selections and routes.

[`tests/site_workflow_test.ts`](../../../tests/site_workflow_test.ts) ties the directive registry to its source examples, package roots, dependency closure, and pristine raw editions. The canonical-set atlas enrolls the directive set, so a new projection inherits those obligations.

## Build and theme

```sh
deno task site:build   # emit both runtimes and the homepage shell
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
deno task site:prose-check # run the public-copy Vale gate
deno task site:prose   # measure the pinned public-copy density
deno task site:reading-grade # measure the pinned reading grade
```

Only `site:build` grants `NODE_ENV`, because that build process uses React for static rendering. The long-lived `site` and `watch` server processes do not grant it. A guard rejects React runtime modules in their production entry graph. An unexpected environment read therefore appears as both a permission failure and a test failure.

The package's `discern` theme preserves the semantic color, type, spacing, focus, motion, and background roles established during the prototype. The display role prefers Iowan Old Style where the visitor has it, then uses the bundled Crimson Pro as its first portable fallback. Inter serves body and interface roles, and JetBrains Mono serves code. The build copies the bundled font binaries and SIL Open Font License texts from the selected package asset pack into local generated output. The homepage hero's glow interpolates fully opaque accent-and-canvas colors in `oklab`. It uses no filtered transparency or grain layer, so the browser paints the gradient directly instead of compositing it over the canvas. `site/theme.ts` gives the homepage and docs one pre-paint system-preference bootstrap.

`/assets/theme.js` keeps every design-system `ThemeToggle` in sync behind one optional visitor override. Each two-state control names and displays the opposite of the resolved theme. Choosing a theme different from the current system preference stores that explicit override; choosing the theme the system already requests removes storage and resumes following the system. A later system change that merely comes to match an existing override never clears it. The controls are action buttons rather than pressed-state buttons: their changing accessible name states the destination, and they expose no competing `aria-pressed` state.
