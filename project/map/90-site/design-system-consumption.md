---
aliases:
  - design system integration
  - static rendering
  - site components
  - component consumption
---

# Design-system consumption

## Static production, typed authoring

The homepage source can compose the package's typed React adapters in [`site/page-src/`](../../../site/page-src/). The build renders those compositions with `renderToStaticMarkup` and writes static HTML. React remains an authoring tool: the browser receives no React bundle, hydration, or client framework ([ADR 0135](../_adr/0135-site-pages-use-build-time-react-and-static-runtime.md)).

Layout and display components render completely as semantic HTML. Reusable component behavior is a selection-scoped, framework-neutral progressive enhancement emitted by the package; page behavior remains page-owned. Product copy, routes, commands, bespoke artwork, docs rendering, and composition CSS remain in Discern; none moves into the reusable package.

## Workflow projections in the manual

The Markdown remains the complete manual for terminal, MCP, negotiated text, `.md`, search, and browser readers. A few source blocks carry explicit `discern-workflow` HTML-comment markers around otherwise ordinary Markdown. [`site/workflow.ts`](../../../site/workflow.ts) parses those marked blocks and emits the package's semantic Procedure, Command, Result summary, Path reference, Ownership badge, and Branch choice anatomy for browser pages. It does not infer meaning from arbitrary fences, lists, headings, or tables.

[`site/workflow_registry.ts`](../../../site/workflow_registry.ts) is the canonical directive vocabulary and component selection. Each member must have a strict parser, a real source example, and a rendered root covered by the bundle tests. Malformed or unknown markers fail at the source path. The decision and rejected alternatives are recorded in [ADR 0205](../_adr/0205-browser-workflow-semantics-are-explicit-markdown-projections.md).

The projection contains no second copy of a command or outcome: the marked Markdown supplies every fact. With CSS or JavaScript unavailable, the server HTML still states the complete procedure, result, ownership, and next action. Site-owned JavaScript adds the Command copy control in the package's documented slot; the production graph remains framework-free.

[`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the reusable public lockup. The component uses the `md` preset and renders `discern` beside the decorative Unicode mark in the `mono` typeface. During `site:build`, the tagline-free lockup is written to `site/pages/fragments/brand.html`; the docs shell reads that static fragment into its top bar without importing the React adapter. A homepage composition can import the same adapter.

## The homepage composition

The public `/` homepage is authored in [`site/page-src/landing.tsx`](../../../site/page-src/landing.tsx) as a concise product introduction composed from the published design system. It combines an article header, compact product facts beside the main actions, native agent integrations, and the grouped site footer.

The unlabeled integration band is a direct child of the article header, after its inner copy and actions, so the opening reads as one continuous composition. It walks the native agent catalogue in its canonical order and reads each label and compact SVG mark from the provider registry. Each provider also declares an SVG silhouette with a transparent canvas: the compact mark itself when it qualifies, or a separate first-party asset when it does not. Light mode renders the original artwork on its expected field. Dark mode masks every silhouette with the component's semantic mark color and leaves the field transparent. A provider added to those total registries joins the homepage without a second page-owned list. The earlier control summary remains in the source as a JSX comment for review; the rendered footer therefore follows the integration band.

Page-owned composition styles live in [`site/page-src/landing.css`](../../../site/page-src/landing.css). Its `.landing-*` selectors compose the page while component-owned `.discern-*` selectors stay with the package (the consumer-CSS guard below enforces this). The homepage ships no page-owned JavaScript. The static theme toggle in the header is markup only; the shared `/assets/theme.js` wires every `[data-theme-toggle]` control at runtime. [`site/brand.ts`](../../../site/brand.ts) owns the page's title and description.

The generic component catalog, examples, component implementation, assets, and package tooling live only in the package repository. Discern does not mount `/style-guide/` in development or production.

## Consumer guards

[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) reads the public `packageManifest` and the site selection table. It guards:

- the exact config and lockfile coordinate, public imports, and absence of internal or registry-path reach-through;
- each bundle's requested selection and package-resolved dependency closure;
- every package browser script emitted for a selection being loaded by every route that uses that bundle;
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font licenses, and the absence of a React browser runtime; and
- the rule that consumer styles may compose package classes while leaving component-owned `.discern-*` selectors untouched.

New package components and classes auto-enrol through the published manifest; new site selections and routes auto-enrol through `DESIGN_SYSTEM_BUNDLES`.

[`tests/site_workflow_test.ts`](../../../tests/site_workflow_test.ts) ties the directive registry to its source examples, package roots, dependency closure, and pristine raw editions. The directive set itself is enrolled in the canonical-set atlas, so a new projection cannot bypass those obligations.

## Build and theme

```sh
deno task site:build   # emit both runtimes and the homepage shell
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
```

Only `site:build` grants `NODE_ENV`, because that build process uses React for static rendering. The long-lived `site` and `watch` server processes do not grant it. Their production entry graph is guarded against React runtime modules, keeping an unexpected environment read visible as a permission failure as well as a test failure.

The package's `discern` theme preserves the semantic color, type, spacing, focus, motion, and background roles established during the prototype. Crimson Pro is the display face, Inter serves body and interface roles, and JetBrains Mono serves code. All font binaries and SIL Open Font License texts are copied from the selected package asset pack into local generated output. The optional grain provider adds a bundled local texture to the composition bundle, with no remote browser dependency. `site/theme.ts` gives the homepage and docs one pre-paint system-preference bootstrap; `/assets/theme.js` keeps every design-system `ThemeToggle` in sync and stores an explicit visitor override.
