# The published design-system dependency

Discern consumes `@discern-sh/design-system` from JSR as an exact, immutable
dependency. The package is authored and released from
[discern-sh/design-system](https://github.com/discern-sh/design-system); this
repository owns only the discern.sh integration and product compositions.

## Dependency boundary

The root `deno.json` exposes one stable alias:

```json
"discern-design-system": "jsr:@discern-sh/design-system@0.1.1"
```

Imports use only that package root and its documented `./runtime` and `./react`
exports. `deno.lock` records the same release. Source trees, registry URLs,
cache internals, distribution files, workspace links, and sibling checkouts are
not consumer APIs.

If Discern finds a package defect, the fix is released from the package
repository and consumed here as a new exact version. Discern never patches a
copy of package source. The temporary minimum-age exception in `deno.json`
names this exact package because the cut-over happened during Deno's registry
cooldown; every other dependency remains subject to the normal age policy.

## Site-owned integration

[`site/design_system.ts`](../../../site/design_system.ts) is the complete thin
integration. Its `DESIGN_SYSTEM_BUNDLES` table declares, once:

| Bundle         | Routes                                              | Selection                                      | Optional assets |
| -------------- | --------------------------------------------------- | ---------------------------------------------- | --------------- |
| `docs`         | `/docs` and its descendants                         | Five shell components                          | fonts           |
| `compositions` | `/design-system-demo`, `/content-design-demo`       | Marketing, Editorial, and shared display parts | fonts and grain |

The table also owns the Discern theme choice and emitted public directories.
[`site/build.ts`](../../../site/build.ts) passes each selection to the public
`./runtime` emitter. The package resolves transitive component dependencies and
writes deterministic CSS, a manifest, and only the requested assets. Discern
does not copy the package manifest, tokens, dependency graph, CSS, or adapters.

The docs shell loads its smaller bundle from
`/assets/design-system/docs/`. The two retained product-composition atlases load
the full selected bundle from `/assets/design-system/compositions/`. Fonts are
an explicit choice for both. Grain is selected only for the compositions; docs
neither emit nor load it. Generated output stays ignored beneath
`site/pages/assets/design-system/`.

## Static production, typed authoring

Page authors compose the package's typed React adapters in
[`site/page-src/`](../../../site/page-src/). The build renders them with
`renderToStaticMarkup` and writes static HTML. React remains an authoring tool:
the browser receives no React bundle, hydration, or client framework
([ADR 0135](../_adr/0135-site-pages-use-build-time-react-and-static-runtime.md)).

Layout and display components render completely as semantic HTML. Any browser
behaviour is a small page-owned progressive enhancement. Product copy, routes,
commands, bespoke artwork, docs rendering, and composition CSS remain in
Discern; none moves into the reusable package.

## Retained compositions

`/design-system-demo` is Discern's Marketing composition atlas. It exercises
the complete published Marketing group with real product copy and artwork.
`/content-design-demo` does the same for the Editorial group and a long-form
reading experience. They remain because they compare possible discern.sh
landing and content compositions, not because Discern owns the generic package
catalogue.

The generic component catalogue, examples, component implementation, assets,
and package tooling live only in the package repository. Discern does not mount
`/style-guide/` in development or production.

## Consumer guards

[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts)
reads the public `packageManifest` and the site selection table. It guards:

- the exact config and lockfile coordinate, public imports, and absence of
  internal or registry-path reach-through;
- each bundle's requested selection and package-resolved dependency closure;
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font
  licences, and the absence of a React browser runtime;
- complete Marketing and Editorial composition coverage from the package
  manifest; and
- the rule that consumer styles may compose package classes but never target a
  component-owned `.discern-*` selector.

New package components and classes auto-enrol through the published manifest;
new site selections and routes auto-enrol through `DESIGN_SYSTEM_BUNDLES`.

## Build and theme

```sh
deno task site:build   # emit both selected runtimes and static compositions
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
```

The package's `discern` theme preserves the semantic colour, type, spacing,
focus, motion, and surface roles established during the prototype. Crimson Pro
is the display face, Inter serves body and interface roles, and JetBrains Mono
serves code. All font binaries and SIL Open Font License texts are copied from
the selected package asset pack into local generated output. The optional grain
provider adds one local texture to the composition bundle; it is never a remote
browser dependency.
