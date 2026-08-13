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
"discern-design-system": "jsr:@discern-sh/design-system@0.12.2"
```

Site imports use only that package root and its documented `./runtime` and `./react` exports. The CLI consumer additionally uses the documented `./cli` and `./cli/interactive` exports. `deno.lock` records the same release. Those public exports are the complete consumer application programming interface (API); source trees, registry addresses, cache internals, distribution files, workspace links, and sibling checkouts remain internal.

When a package defect affects discern, release the fix from the package repository and update this repository to the new exact version. Package source remains in its own repository. The temporary minimum-age exception in `deno.json` names this exact package because the cutover happened during Deno's registry holding period. Every other dependency remains subject to the normal age policy.

## Local package iteration

Use the `site-design-system` Project Script to review changes that span both repositories before publication. Give it the root directory of the active design-system checkout or worktree:

```sh
discern scripts site-design-system /absolute/path/to/design-system-worktree
```

The script validates the package name and the root, React, and Runtime exports. It creates a temporary copy of discern's Deno configuration and links the selected checkout there. The temporary configuration has no lockfile or `node_modules` directory. Before building, the script proves that the public Runtime export resolves from the selected checkout.

The script serves the normal site on this worktree's assigned port. Its watcher covers discern's site inputs, the linked package's `src/` tree, and its `deno.json`. Every rebuild uses the same temporary configuration. Stopping the script removes that configuration. The script also verifies that the committed `deno.json` and `deno.lock` remained unchanged.

Use a one-shot build when another process already serves the generated site:

```sh
discern scripts site-design-system -- --build-only /absolute/path/to/design-system-worktree
```

`DISCERN_DESIGN_SYSTEM_PATH` may supply the checkout instead of the positional path. The local link provides visual and integration evidence only. The full Gate, release workflow, and production build continue to resolve the exact JSR version. After a release reaches JSR, update the committed pin and return to the ordinary production build.

## CLI-owned integration

The package's `./cli` graph owns Components, Tokens, layout, motifs, and separate repertoire, style, and cursor-control facts. Its `./cli/interactive` graph owns input, prompts, and safe repaint refusal. Process, safe-text, product, effect, stream, machine, raw-child, and artwork authority remain with discern through [`terminal.ts`](../../../src/lib/terminal.ts) and [`prompts.ts`](../../../src/lib/prompts.ts).

Consumer conformance proves both CLI graphs are React-free and resolved from the exact external release. Cliffy's Command package remains a separate parser boundary. No direct Cliffy presentation dependency or import remains in discern; Command's package-owned transitive Table node remains in the lock and notices only as part of the derived parser closure ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)).

## Site-owned integration

[`site/design_system.ts`](../../../site/design_system.ts) contains the complete integration. Its `DESIGN_SYSTEM_BUNDLES` table declares:

| Bundle         | Routes                      | Selection                                              | Optional assets |
| -------------- | --------------------------- | ------------------------------------------------------ | --------------- |
| `docs`         | `/docs` and its descendants | Docs, shared chrome, and the 6 rendered Workflow roots | fonts           |
| `compositions` | `/` and `/lipsum`           | Marketing, Editorial, and shared display parts         | fonts           |

The table also owns the discern theme choice and emitted public directories. [`site/build.ts`](../../../site/build.ts) passes each selection to the public `./runtime` emitter. The package resolves transitive component dependencies and writes deterministic CSS, selection-scoped browser scripts, a manifest, and the requested assets. The discern integration reads those outputs instead of copying the package manifest, tokens, dependency graph, CSS, behavior source, or adapters.

The docs shell loads its smaller bundle from `/assets/design-system/docs/`, including the emitted `discern.js` that promotes Glossary term's Hover card panels above clipping ancestors. The homepage loads the full selected bundle from `/assets/design-system/compositions/`. That selection currently emits no package browser script. Both bundles select fonts; neither selects the optional grain asset. Generated output stays ignored beneath `site/pages/assets/design-system/`.

The docs bundle selects the `Docs` group plus the shared `icon`, `icon-button`, `theme-toggle`, `brand`, `divider`, `heading`, `kicker`, `table`, `breadcrumbs`, and `table-of-contents` components. Its explicit Workflow roots are `procedure`, `command`, `result-summary`, `path-reference`, `ownership-badge`, and `branch-choice`; the package adds their dependencies in manifest order. A selected Workflow root must appear on a real manual journey, and a rendered root must resolve into this bundle.

Both bundles select the Core `Brand` component, which brings its `Logo` dependency with it. [`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the canonical public lockup: the decorative `◮`, the visible `discern` name, the `mono` typeface, and an optional context tagline. The docs shell reuses its statically rendered markup. The homepage passes the same mark and name treatment into the Marketing `SiteHeader` campaign variant.

The homepage also uses the Marketing `HeroBlock` showcase layout with its atmospheric surface and the `LogoCloud` strip variant. Its product-state composition remains site-owned inside the Display `Window` showcase variant, and its agent-result composition uses the Display `Terminal` showcase variant. Provider assets, page copy, and the inner product evidence remain consumer content; the shared scale, spacing, chrome, colour-scheme handling, and responsive behavior come from the published package. The browser receives semantic HTML, selected CSS, and any framework-neutral behavior script declared by that selection, with no React runtime.

The static page boundary, homepage composition, build commands, and manifest-driven consumer guards are recorded separately in [design-system-consumption.md](design-system-consumption.md).
