---
aliases:
  - "@discern-sh/design-system"
  - design system dependency
  - component bundles
  - runtime emitter
---

# The published design-system dependency

discern consumes `@discern-sh/design-system` from the JavaScript Registry (JSR) at an exact version. The [discern-sh/design-system](https://github.com/discern-sh/design-system) repository authors and releases the package. This repository owns the discern.sh integration and product compositions.

## Dependency boundary

The root `deno.json` exposes one stable alias:

```json
"discern-design-system": "jsr:@discern-sh/design-system@0.12.1"
```

Site imports use only that package root and its documented `./runtime` and `./react` exports. The CLI consumer additionally uses the documented `./cli` and `./cli/interactive` exports. `deno.lock` records the same release. Those public exports are the complete consumer application programming interface (API); source trees, registry addresses, cache internals, distribution files, workspace links, and sibling checkouts remain internal.

When a package defect affects discern, release the fix from the package repository and update this repository to the new exact version. Package source remains in its own repository. The temporary minimum-age exception in `deno.json` names this exact package because the cutover happened during Deno's registry holding period. Every other dependency remains subject to the normal age policy.

## CLI-owned integration

The package's `./cli` graph owns pure Components, Token roles, generic terminal text/layout, and reusable triangle motifs. Its `./cli/interactive` graph owns terminal I/O, key decoding, grapheme editing, prompt machines, painting, cancellation, and restoration. [`src/lib/terminal.ts`](../../../src/lib/terminal.ts) remains Discern's process and safe-text boundary; [`src/lib/prompts.ts`](../../../src/lib/prompts.ts) remains its product interaction choke point. Discern owns product facts, action legality, effects, streams, machine schemas, raw child bytes, and product artwork.

Consumer conformance proves both CLI graphs are React-free and resolved from the exact external release. Cliffy's Command package remains a separate parser boundary. Discern has no direct Cliffy presentation dependency or import; Command's package-owned transitive Table node remains in the lock and notices only as part of the derived parser closure ([ADR 0278](../_adr/0278-external-terminal-rendering-crosses-one-process-boundary.md)).

## Site-owned integration

[`site/design_system.ts`](../../../site/design_system.ts) contains the complete integration. Its `DESIGN_SYSTEM_BUNDLES` table declares:

| Bundle         | Routes                      | Selection                                              | Optional assets |
| -------------- | --------------------------- | ------------------------------------------------------ | --------------- |
| `docs`         | `/docs` and its descendants | Docs, shared chrome, and the 6 rendered Workflow roots | fonts           |
| `compositions` | `/`                         | Marketing, Editorial, and shared display parts         | fonts and grain |

The table also owns the discern theme choice and emitted public directories. [`site/build.ts`](../../../site/build.ts) passes each selection to the public `./runtime` emitter. The package resolves transitive component dependencies and writes deterministic CSS, selection-scoped browser scripts, a manifest, and the requested assets. The discern integration reads those outputs instead of copying the package manifest, tokens, dependency graph, CSS, behavior source, or adapters.

The docs shell loads its smaller bundle from `/assets/design-system/docs/`, including the emitted `discern.js` that promotes Glossary term's Hover card panels above clipping ancestors. The homepage loads the full selected bundle from `/assets/design-system/compositions/`. That selection currently emits no package browser script. Both bundles select fonts. Only the compositions bundle selects grain, and the docs bundle neither emits nor loads it. Generated output stays ignored beneath `site/pages/assets/design-system/`.

The docs bundle selects the `Docs` group plus the shared `icon`, `icon-button`, `theme-toggle`, `brand`, `divider`, `heading`, `kicker`, `table`, `breadcrumbs`, and `table-of-contents` components. Its explicit Workflow roots are `procedure`, `command`, `result-summary`, `path-reference`, `ownership-badge`, and `branch-choice`; the package adds their dependencies in manifest order. A selected Workflow root must appear on a real manual journey, and a rendered root must resolve into this bundle.

Both bundles select the Core `Brand` component, which brings its `Logo` dependency with it. [`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the canonical public lockup: the decorative `◮`, the visible `discern` name, the `mono` typeface, and an optional context tagline. The docs shell reuses its statically rendered markup, and the homepage can compose its React adapter. The browser receives the component's semantic HTML, selected CSS, and any framework-neutral behavior script declared by that selection, with no React runtime.

The static page boundary, homepage composition, build commands, and manifest-driven consumer guards are recorded separately in [design-system-consumption.md](design-system-consumption.md).
