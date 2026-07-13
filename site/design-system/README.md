# Discern design system

Framework-neutral visual foundations with typed React adapters. This directory
owns reusable visual decisions; discern.sh page composition and product copy
live in `site/page-src/`.

## Commands

- `deno task build` — generate CSS, the component registry, manifest, and the
  browser styleguide bundle.
- `deno task check` — formatting, linting, and strict type checking.
- `deno task verify` — the complete local gate.
- `deno task serve` — optionally build and serve the styleguide alone at
  `http://127.0.0.1:8010/styleguide/`.

From the repository root, `deno task site:build` uses these adapters only at
build time to generate static public HTML and CSS. No React runtime ships with
the landing-page demo. Root `deno task watch` serves both that demo and the
local catalogue at `/styleguide/`, rebuilding them together when authored
design-system or page inputs change.

## Source rules

- Change design values in `src/tokens/tokens.ts`; generated CSS is never edited.
- Every public component owns a folder containing its implementation, styles,
  metadata, examples, and `mod.ts` export.
- Consumer styles may compose components through an added consumer class, but
  never target a component-owned `.ds-*` selector. Component internals remain
  reproducible from this directory alone.
- Component source contains no product copy and no remote asset URLs.
- Icons are renderable slots. `assets/fonts.css` is the optional, self-hosted
  provider for the font roles; consumers may replace it without changing the
  component runtime.
- New `*.meta.ts` + `*.examples.tsx` pairs are discovered by the build and
  automatically enter the styleguide.
- `assets/` owns reproducible fonts, licences, and textures. The build copies
  that complete tree into every runtime output.
- `dist/`, `styleguide/generated/`, and the public runtime under
  `site/pages/assets/design-system/` are ignored build output.

## Public surfaces

- `src/mod.ts` — React component exports and token types.
- `dist/discern.css` — tokens, foundations, utilities, and component styles.
- `assets/fonts.css` — optional local font faces matching the typography roles.
- Components can also be reproduced as semantic HTML using the documented
  `.ds-*` classes; React is an adapter rather than a CSS dependency.

The body and UI family roles remain separate tokens even though both currently
resolve to Inter. UI rules pair `--ds-font-ui` with `--ds-font-features-ui`;
body copy does not inherit that interface-specific OpenType set. The bundled
provider therefore ships one Inter face for both roles, alongside Crimson Pro
for display type and JetBrains Mono for code.

`Kicker` keeps its optional index in the mono role and renders its trailing
label with the UI family and feature set; size, weight, tracking, colour, and
uppercase treatment remain shared by both parts.

## Authoring a page from this directory

This directory is the complete visual handoff. A page author should not need an
existing page or mock-up to recover component decisions:

1. Run `deno task build`. Load `assets/fonts.css` when using the bundled faces,
   followed by `dist/discern.css`.
2. Put `data-ds-root` on the page boundary and set `data-ds-theme="light"` or
   `"dark"` there.
3. Import React adapters and public types only from `src/mod.ts`. Start page
   structure with `Section`, `Container`, `Stack`, `Cluster`, and `Grid`.
4. Use `Heading` for document and section headlines. Card descendants use the UI
   title role automatically; its size is `--ds-font-size-card-title` in
   `src/tokens/tokens.ts`.
5. For each component, read its `*.meta.ts` for intent and accessibility, its
   `*.tsx` for the exhaustive prop contract, and its `*.examples.tsx` for a
   representative composition. The same examples are generated into the local
   catalogue.
6. Add consumer classes for page-specific composition. Do not restyle a
   component-owned `.ds-*` selector; visual variants belong in the component.

Stateful catalogue components still need an explicit browser-runtime strategy
when a consumer is rendered to static HTML. That is a page architecture choice,
not an implicit dependency of the visual system.
