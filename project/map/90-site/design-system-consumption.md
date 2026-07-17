# Design-system consumption

## Static production, typed authoring

Page authors compose the package's typed React adapters in [`site/page-src/`](../../../site/page-src/). The build renders them with `renderToStaticMarkup` and writes static HTML. React remains an authoring tool: the browser receives no React bundle, hydration, or client framework ([ADR 0135](../_adr/0135-site-pages-use-build-time-react-and-static-runtime.md)).

Layout and display components render completely as semantic HTML. Any browser behavior is a small page-owned progressive enhancement. Product copy, routes, commands, bespoke artwork, docs rendering, and composition CSS remain in Discern; none moves into the reusable package.

## Retained compositions

The same complete Marketing composition is the public `/` homepage and remains available at `/design-system-demo` as an explicitly labeled atlas. It exercises the published Marketing group with real product copy and artwork. The previous homepage prototype is preserved under `mockups/landing/`, outside the served tree. `/content-design-demo` does the same for the Editorial group and a long-form reading experience. They remain because they compare possible discern.sh landing and content compositions, not because Discern owns the generic package catalog.

The generic component catalog, examples, component implementation, assets, and package tooling live only in the package repository. Discern does not mount `/style-guide/` in development or production.

## Consumer guards

[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) reads the public `packageManifest` and the site selection table. It guards:

- the exact config and lockfile coordinate, public imports, and absence of internal or registry-path reach-through;
- each bundle's requested selection and package-resolved dependency closure;
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font licenses, and the absence of a React browser runtime;
- complete Marketing and Editorial composition coverage from the package manifest; and
- the rule that consumer styles may compose package classes while leaving component-owned `.discern-*` selectors untouched.

New package components and classes auto-enrol through the published manifest; new site selections and routes auto-enrol through `DESIGN_SYSTEM_BUNDLES`.

## Build and theme

```sh
deno task site:build   # emit both runtimes, the homepage, and two atlases
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
```

The package's `discern` theme preserves the semantic color, type, spacing, focus, motion, and background roles established during the prototype. Crimson Pro is the display face, Inter serves body and interface roles, and JetBrains Mono serves code. All font binaries and SIL Open Font License texts are copied from the selected package asset pack into local generated output. The optional grain provider adds a bundled local texture to the composition bundle, with no remote browser dependency.
