# Design-system consumption

## Static production, typed authoring

The homepage source can compose the package's typed React adapters in [`site/page-src/`](../../../site/page-src/). The build renders those compositions with `renderToStaticMarkup` and writes static HTML. React remains an authoring tool: the browser receives no React bundle, hydration, or client framework ([ADR 0135](../_adr/0135-site-pages-use-build-time-react-and-static-runtime.md)).

Layout and display components render completely as semantic HTML. Any browser behavior is a small page-owned progressive enhancement. Product copy, routes, commands, bespoke artwork, docs rendering, and composition CSS remain in Discern; none moves into the reusable package.

[`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the reusable public lockup. The component uses the `md` preset and renders `discern` beside the decorative Unicode mark in the `mono` typeface. During `site:build`, the tagline-free lockup is written to `site/pages/fragments/brand.html`; the docs shell reads that static fragment into its top bar without importing the React adapter. A homepage composition can import the same adapter.

## The homepage composition

The public `/` homepage is authored in [`site/page-src/landing.tsx`](../../../site/page-src/landing.tsx) as an editorial placeholder built from the Editorial and Marketing adapters. It combines the retained article header and clustered actions with 3 placeholder sections, an opening drop cap, one wide pull quote, a placeholder logo cloud, and the grouped site footer. The contents links use the same reduced-motion-aware smooth scrolling as the docs.

Page-owned composition styles live in [`site/page-src/landing.css`](../../../site/page-src/landing.css). Its `.landing-*` selectors compose the page, and one document-level rule supplies the reduced-motion-aware scroll behavior. Component-owned `.discern-*` selectors stay with the package (the consumer-CSS guard below enforces this). The homepage ships no page-owned JavaScript. The static theme toggle in the header is markup only; the shared `/assets/theme.js` wires every `[data-theme-toggle]` control at runtime. [`site/brand.ts`](../../../site/brand.ts) owns the page's title and description.

The generic component catalog, examples, component implementation, assets, and package tooling live only in the package repository. Discern does not mount `/style-guide/` in development or production.

## Consumer guards

[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) reads the public `packageManifest` and the site selection table. It guards:

- the exact config and lockfile coordinate, public imports, and absence of internal or registry-path reach-through;
- each bundle's requested selection and package-resolved dependency closure;
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font licenses, and the absence of a React browser runtime; and
- the rule that consumer styles may compose package classes while leaving component-owned `.discern-*` selectors untouched.

New package components and classes auto-enrol through the published manifest; new site selections and routes auto-enrol through `DESIGN_SYSTEM_BUNDLES`.

## Build and theme

```sh
deno task site:build   # emit both runtimes and the homepage shell
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
```

Only `site:build` grants `NODE_ENV`, because that build process uses React for static rendering. The long-lived `site` and `watch` server processes do not grant it. Their production entry graph is guarded against React runtime modules, keeping an unexpected environment read visible as a permission failure as well as a test failure.

The package's `discern` theme preserves the semantic color, type, spacing, focus, motion, and background roles established during the prototype. Crimson Pro is the display face, Inter serves body and interface roles, and JetBrains Mono serves code. All font binaries and SIL Open Font License texts are copied from the selected package asset pack into local generated output. The optional grain provider adds a bundled local texture to the composition bundle, with no remote browser dependency. `site/theme.ts` gives the homepage and docs one pre-paint system-preference bootstrap; `/assets/theme.js` keeps every design-system `ThemeToggle` in sync and stores an explicit visitor override.
