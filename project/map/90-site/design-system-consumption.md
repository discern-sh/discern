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

[`site/page-src/landing.tsx`](../../../site/page-src/landing.tsx) contains the public `/` homepage source. The page is a concise product introduction composed from the published design system. It combines an article header, compact product facts beside the main actions, native agent integrations, and the grouped site footer.

The unlabeled integration band is a direct child of the article header, after its inner copy and actions, so the opening reads as one composition. It walks the native agent catalog in its canonical order and reads each label and compact Scalable Vector Graphics (SVG) mark from the provider registry. Each provider also declares an SVG silhouette with a transparent canvas: either the compact mark when it qualifies or a separate first-party asset. Light mode renders the original artwork on its expected field. Dark mode masks every silhouette with the component's semantic mark color and leaves the field transparent. The total provider registries automatically add a new provider to the homepage. The earlier control summary remains in the source as a JavaScript XML (JSX) comment for review. The rendered footer follows the integration band.

Page-owned composition styles live in [`site/page-src/landing.css`](../../../site/page-src/landing.css). Its `.landing-*` selectors compose the page while component-owned `.discern-*` selectors stay with the package; the consumer-CSS guard below enforces this boundary. The homepage ships no page-owned JavaScript. The static theme toggle in the header is markup only. The shared `/assets/theme.js` wires every `[data-theme-toggle]` control at runtime. [`site/brand.ts`](../../../site/brand.ts) owns the page's title and description.

The generic component catalog, examples, component implementation, assets, and package tooling live only in the package repository. The discern site does not mount `/style-guide/` in development or production.

## Development-only visual studies

[`site/page-src/benefit-quality-contour.tsx`](../../../site/page-src/benefit-quality-contour.tsx) owns the reusable Scalable Vector Graphics (SVG) artwork for the Quality that only improves benefit. Retained contours tighten in one direction around a split triangular culmination; the newest boundary carries the restrained accent. [`site/page-src/benefit-quality-contour-preview.tsx`](../../../site/page-src/benefit-quality-contour-preview.tsx) presents the study inside fixed light and dark token roots, while [`site/page-src/benefit-quality-contour.css`](../../../site/page-src/benefit-quality-contour.css) owns its responsive composition and optional tracer motion. The earlier homepage artefact sheet remains authored in [`site/page-src/specimens.tsx`](../../../site/page-src/specimens.tsx) and [`site/page-src/specimens.css`](../../../site/page-src/specimens.css), outside the current focused preview.

[`site/specimens.ts`](../../../site/specimens.ts) builds the normal static design-system assets and serves the specimen document plus its composition CSS directly from source on the worktree's local port:

```sh
deno task site:specimens
```

The command prints the preview address. The study is static HTML, inline SVG, and CSS with the shared theme controller as its only external browser script. It is absent from `PAGES`, returns `404` through the production handler, and carries `noindex` response headers. [`tests/site_specimens_test.ts`](../../../tests/site_specimens_test.ts) guards the development boundary and live stylesheet; [`tests/site_benefit_quality_contour_test.ts`](../../../tests/site_benefit_quality_contour_test.ts) guards the paired themes, accessible SVG title and description, unique identifiers, six-contour structure, static runtime, and complete reduced-motion state.

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
```

Only `site:build` grants `NODE_ENV`, because that build process uses React for static rendering. The long-lived `site` and `watch` server processes do not grant it. A guard rejects React runtime modules in their production entry graph. An unexpected environment read therefore appears as both a permission failure and a test failure.

The package's `discern` theme preserves the semantic color, type, spacing, focus, motion, and background roles established during the prototype. Crimson Pro is the display face, Inter serves body and interface roles, and JetBrains Mono serves code. The build copies all font binaries and SIL Open Font License texts from the selected package asset pack into local generated output. The optional grain provider adds a bundled local texture to the composition bundle, with no remote browser dependency. `site/theme.ts` gives the homepage and docs one pre-paint system-preference bootstrap. `/assets/theme.js` keeps every design-system `ThemeToggle` in sync and stores an explicit visitor override.
