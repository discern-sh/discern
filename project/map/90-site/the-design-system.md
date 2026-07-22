# The published design-system dependency

Discern consumes `@discern-sh/design-system` from JSR as an exact, immutable dependency. The package is authored and released from [discern-sh/design-system](https://github.com/discern-sh/design-system); this repository owns only the discern.sh integration and product compositions.

## Dependency boundary

The root `deno.json` exposes one stable alias:

```json
"discern-design-system": "jsr:@discern-sh/design-system@0.7.0"
```

Imports use only that package root and its documented `./runtime` and `./react` exports. `deno.lock` records the same release. Source trees, registry URLs, cache internals, distribution files, workspace links, and sibling checkouts are not consumer APIs.

If Discern finds a package defect, the fix is released from the package repository and consumed here as a new exact version. Package source remains in its own repository. The temporary minimum-age exception in `deno.json` names this exact package because the cut-over happened during Deno's registry holding period; every other dependency remains subject to the normal age policy.

## Site-owned integration

[`site/design_system.ts`](../../../site/design_system.ts) is the complete thin integration. Its `DESIGN_SYSTEM_BUNDLES` table declares, once:

| Bundle         | Routes                      | Selection                                                            | Optional assets |
| -------------- | --------------------------- | -------------------------------------------------------------------- | --------------- |
| `docs`         | `/docs` and its descendants | Docs chrome and shared display parts                                 | fonts           |
| `compositions` | `/`                         | Marketing, Editorial, Agents session parts, and shared display parts | fonts and grain |

The table also owns the Discern theme choice and emitted public directories. [`site/build.ts`](../../../site/build.ts) passes each selection to the public `./runtime` emitter. The package resolves transitive component dependencies and writes deterministic CSS, a manifest, and only the requested assets. Discern does not copy the package manifest, tokens, dependency graph, CSS, or adapters.

The docs shell loads its smaller bundle from `/assets/design-system/docs/`. The homepage loads the full selected bundle from `/assets/design-system/compositions/`. Fonts are an explicit choice for both. Grain is selected only for the compositions; docs neither emit nor load it. Generated output stays ignored beneath `site/pages/assets/design-system/`.

Both bundles select the Core `Brand` component, which brings its `Logo` dependency with it. [`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the canonical public lockup: the decorative `◮`, the visible `discern` name, the `mono` typeface, and an optional context tagline. The docs shell reuses its statically rendered markup, and the homepage can compose its React adapter. The browser receives the component's semantic HTML and selected CSS, with no React runtime.

The static page boundary, homepage composition, build commands, and manifest-driven consumer guards are recorded separately in [design-system-consumption.md](design-system-consumption.md).
