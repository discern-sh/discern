# Discern design system

The Discern design system is a local, independently testable Deno package. Its
default graph is framework-neutral; React is an explicit authoring adapter for
consumers that render static HTML. The extraction programme records
`@discern-sh/design-system` as its intended JSR coordinate; this wave remains
local and unpublished.

## Public imports

Discern's root import map currently binds these package-shaped specifiers to the
local source. A future immutable release keeps the same export paths.

| Import                                | Contract                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `discern-design-system`               | Token metadata, component/group metadata types, the package manifest, and `semanticClass` |
| `discern-design-system/manifest`      | Framework-neutral manifest schema and the complete package ownership manifest             |
| `discern-design-system/runtime`       | Deterministic selected-runtime emitter                                                    |
| `discern-design-system/tokens`        | Primitive, semantic, and Discern-preset token metadata                                    |
| `discern-design-system/theme/discern` | Default branded blue preset                                                               |
| `discern-design-system/react`         | Optional React components and their public prop types                                     |

Only `./react` resolves React. The package keeps React and React DOM as
catalogue development dependencies and peer dependencies, while its root,
manifest, runtime, token, and theme graphs do not import them.

## Root, theme, and semantic HTML

Generated foundations apply only inside an opted-in boundary. Put
`data-discern-root` on that boundary and choose light or dark roles with
`data-discern-theme`:

```html
<main data-discern-root data-discern-theme="light">
  <button class="discern-button discern-button--primary discern-button--md">
    <span class="discern-button__label">Continue</span>
  </button>
</main>
```

Load the emitted `discern.css` before consumer composition styles. Semantic HTML
does not require React or a browser runtime. Public classes, custom properties,
data attributes, layers, and keyframes use the `discern` namespace. Consumer
styles may add their own composition class, but must not target a component's
`ownedClasses` from `manifest.json`.

Core typography uses documented system fallbacks. Selecting the optional font
pack changes the public font-role tokens without changing component CSS.

## Emit a selected runtime

The emitter accepts explicit component IDs, canonical groups, or the explicit
`all` catalogue selection. It resolves dependencies from generated component
metadata and writes stable output order to a dedicated directory:

```ts
import { emitDesignSystemRuntime } from "discern-design-system/runtime";

const result = await emitDesignSystemRuntime({
  outputRoot: new URL("./public/design-system/", import.meta.url),
  groups: ["Editorial"],
  components: ["button", "icon"],
  assets: ["fonts"],
});

console.log(result.manifest.selection.resolvedComponents);
```

`outputRoot` must end in `/` and must be dedicated to the runtime because each
emission replaces it. Every selection writes:

- `discern.css`, containing tokens, the selected theme, root-scoped foundations,
  utilities, and dependency-ordered component CSS;
- `manifest.json`, containing schema version, requested and resolved selections,
  canonical groups, component dependencies, owned classes, public token names,
  output paths, media types, byte sizes, and SHA-256 integrity; and
- only the optional assets requested by the consumer.

Use `{ all: true }` for the complete catalogue. Repeated emissions with the same
inputs are byte-for-byte identical.

## Optional assets

No asset is copied by default. Asset selections are independent:

- `fonts` emits `fonts.css`, four stable WOFF2 filenames, and all three SIL Open
  Font Licence texts;
- `grain` emits `grain.css` and `textures/grain.png`;
- selecting either one never copies the other.

Component CSS has no hidden texture dependency. The core `.discern-grain-wash`
utility remains useful as a gradient without the optional texture; `grain.css`
adds the texture only when a consumer chooses it. Consumers should read emitted
asset paths from the manifest rather than infer a cache or registry location.

## Custom themes

Semantic component roles are separate from the default blue preset. The runtime
uses that preset unless `theme: "none"` is requested. A consumer can override
public tokens in its own layer without forking a component stylesheet:

```css
@layer discern.consumer {
  :where([data-discern-root]) {
    --discern-accent-hue: 145;
    --discern-color-success: oklch(58% 0.16 190);
    --discern-color-success-soft: oklch(95% 0.045 190);
    --discern-color-success-deep: oklch(34% 0.1 190);
  }

  :where([data-discern-root][data-discern-theme="dark"]) {
    --discern-color-success: oklch(74% 0.13 190);
    --discern-color-success-soft: oklch(30% 0.055 190);
    --discern-color-success-deep: oklch(90% 0.08 190);
  }
}
```

The distinct success hue is deliberate: a green accent must not erase the
difference between brand actions and successful outcomes. Automated package
tests cover light/dark text contrast, accent/success/warning/danger separation,
reduced-motion rules, forced-colour focus outlines, and unchanged component CSS.
Manual browser review still checks visible focus shape and status recognition in
the consumer's actual type, layout, zoom, and operating-system colour settings.

Inverse surface and ink roles remain dark-on-light in purpose across both site
themes; they do not invert with the ordinary canvas and ink roles.

## Optional React adapter

React consumers import only the explicit adapter and can render the same class
contract to static HTML:

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "discern-design-system/react";

const html = renderToStaticMarkup(
  <Button variant="secondary">Continue</Button>,
);
```

Discern uses this adapter at build time under ADR 0135. The browser receives
static HTML and CSS, with no React bundle, hydration, or implicit component
behaviour. Stateful catalogue examples require a consumer-owned browser strategy
if they are used outside the catalogue.

## Commands and local proof

Run these from this directory:

```sh
deno task check
deno task build
deno task test
deno task verify
deno task serve
```

`deno task test` creates a temporary external Deno project. Its neutral fixture
declares no React dependency, imports only documented package exports, emits a
runtime, and is exercised again with `deno run --cached-only`. A second fixture
adds the React peer contract and renders static HTML through `./react`. Neither
fixture reaches into `dist/`, relies on a global Deno-cache path, uses
`--unstable-raw-imports`, or fetches an asset at runtime.

The repository root's `deno task site:build` consumes only the public runtime
and React entrypoints. `deno task watch` rebuilds the static pages and serves
the complete local catalogue at `/style-guide/`.

## Boundary measurements

Unminified bytes measured on 2026-07-15. Before this boundary, every consumer
received the same 115,510-byte all-component CSS and all 292,467 authored asset
bytes.

| Selection                     | Before CSS | After CSS | Before assets | After assets | After manifest |
| ----------------------------- | ---------: | --------: | ------------: | -----------: | -------------: |
| Full catalogue, fonts + grain |    115,510 |   127,113 |       292,467 |      293,116 |         58,545 |
| Docs components, fonts only   |    115,510 |    15,072 |       292,467 |      193,674 |          9,323 |

The full CSS grows because the permanent namespace changes from `ds` to
`discern` and the theme seam becomes explicit. The docs-sized selection drops
unrelated Marketing and Editorial component CSS. A core selection with no
optional assets emits zero asset bytes.

## Authoring rules

- Change token values in `src/tokens/tokens.ts`; do not edit emitted CSS.
- Every component folder owns its implementation, CSS, metadata, examples, and
  `mod.ts`. Metadata and group order generate the runtime registry, React export
  surface, catalogue registry, and dependency graph.
- Run `deno task codegen` after changing component metadata, component CSS,
  component imports, or package assets. Do not edit `src/generated/` or
  `styleguide/generated/` by hand.
- Keep examples generic. Product claims, customer names, routes, commands, and
  bespoke artwork belong to the consumer and enter components through props or
  slots.
- Preserve `--discern-font-size-xs` as the authored interface-text floor and
  pair the UI font role with its central OpenType feature set.
- Preserve the stable inverse roles rather than using ordinary theme-relative
  canvas and ink as an inverse palette.
- Keep font licences with their files and the repository's Apache-2.0 terms.
- `dist/`, `styleguide/generated/`, and Discern's generated site runtime are
  ignored outputs.

The package test suite cannot import Discern parent source. Site routes,
generated-page assertions, static-runtime checks, and consumer CSS ownership
guards belong to the repository-level consumer tests.
